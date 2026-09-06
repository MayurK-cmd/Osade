import type { Db } from '../db/index.js';
import type { ScmClient } from '../scm/client.js';
import { fetchCorpus, fetchReviewRounds } from '../scm/corpus.js';

import { Conventions, type ConventionWithEvidence } from './conventions.js';
import { compareInjection, type Comparison } from './measure.js';
import { Miner, type MineResult } from './miner.js';
import type { ModelPort } from './model.js';

/**
 * The mining service — OSADE.md §13.
 *
 * Everything the API and the UI need in one place: whether mining is even possible, running it,
 * and the human half of §13.4 — confirming or rejecting a candidate with its evidence in front
 * of you.
 *
 * Mining is **always explicit**. It costs GitHub quota and model tokens, it takes minutes, and
 * §13.4 says re-mine "weekly, or on demand". Nothing here starts on its own, and launching a
 * task never waits on it.
 */

export interface MineRunRow {
  id: string;
  startedAt: number;
  finishedAt: number | null;
  highWaterPr: number | null;
  observations: number;
  candidates: number;
  error: string | null;
}

export interface MiningAvailability {
  available: boolean;
  /** Why not, in words a user can act on. */
  reason: string | null;
}

export interface KnowledgeOptions {
  now?: () => number;
  onWarning?: (message: string) => void;
}

export class Knowledge {
  readonly #db: Db;
  readonly #scm: ScmClient | null;
  readonly #model: ModelPort | null;
  readonly #now: () => number;
  readonly #onWarning: (message: string) => void;
  readonly #conventions: Conventions;
  /** Repos with a run in flight. Mining twice at once would double-count evidence. */
  readonly #running = new Set<string>();

  constructor(
    db: Db,
    scm: ScmClient | null,
    model: ModelPort | null,
    options: KnowledgeOptions = {},
  ) {
    this.#db = db;
    this.#scm = scm;
    this.#model = model;
    this.#now = options.now ?? Date.now;
    this.#onWarning = options.onWarning ?? (() => {});
    this.#conventions = new Conventions(db, { now: this.#now });
  }

  get conventions(): Conventions {
    return this.#conventions;
  }

  /**
   * Whether this repo can be mined right now, and if not, why.
   *
   * Reported rather than discovered halfway through: a button that fails after two minutes of
   * work is worse than one that is disabled with a reason next to it.
   */
  availability(repoId: string): MiningAvailability {
    if (!this.#model) {
      return {
        available: false,
        reason:
          'no model configured. Set OSADE_ANTHROPIC_API_KEY in the daemon’s environment; ' +
          'Osade never writes it to disk.',
      };
    }
    if (!this.#scm) {
      return { available: false, reason: 'no GitHub token configured (OSADE_GITHUB_TOKEN).' };
    }

    const repo = this.#repo(repoId);
    if (!repo) return { available: false, reason: 'unknown repository.' };
    if (!repo.gh_owner || !repo.gh_name) {
      return {
        available: false,
        reason:
          'this repository has no GitHub remote, so there is no review record to mine. ' +
          'Conventions can still be added by hand.',
      };
    }
    if (this.#running.has(repoId)) {
      return { available: false, reason: 'a mining run is already in progress.' };
    }
    return { available: true, reason: null };
  }

  isRunning(repoId: string): boolean {
    return this.#running.has(repoId);
  }

  lastRun(repoId: string): MineRunRow | null {
    const row = this.#db
      .prepare('SELECT * FROM mine_run WHERE repo_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(repoId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: row.id as string,
      startedAt: row.started_at as number,
      finishedAt: (row.finished_at as number | null) ?? null,
      highWaterPr: (row.high_water_pr as number | null) ?? null,
      observations: row.observations as number,
      candidates: row.candidates as number,
      error: (row.error as string | null) ?? null,
    };
  }

  /**
   * Fetch, mine, store. Incremental by default (§13.4).
   *
   * Decay runs first: a rule that has gone 180 days without confirmation should be a candidate
   * *before* this run gets its chance to re-confirm it, or a stale rule would be quietly renewed
   * by a run that never saw fresh evidence for it.
   */
  async mine(repoId: string, options: { full?: boolean } = {}): Promise<MineResult> {
    const availability = this.availability(repoId);
    if (!availability.available) throw new Error(availability.reason ?? 'mining unavailable');

    const repo = this.#repo(repoId);
    const scm = this.#scm;
    const model = this.#model;
    if (!repo?.gh_owner || !repo.gh_name || !scm || !model) {
      throw new Error(availability.reason ?? 'mining unavailable');
    }

    this.#running.add(repoId);
    try {
      const decayed = this.#conventions.decay();
      if (decayed > 0) {
        this.#onWarning(`${decayed} convention(s) went 180 days unconfirmed and are candidates`);
      }

      const miner = new Miner(this.#db, model, {
        now: this.#now,
        onWarning: this.#onWarning,
      });

      const { corpus, partial } = await fetchCorpus(
        scm,
        { id: repoId, owner: repo.gh_owner, name: repo.gh_name },
        {
          sinceNumber: options.full ? null : miner.highWaterPr(repoId),
          onWarning: this.#onWarning,
        },
      );

      if (partial) {
        this.#onWarning(
          'the corpus is partial: GitHub rate limit budget ran low. Re-run later to cover the rest.',
        );
      }

      return await miner.mine(corpus);
    } finally {
      this.#running.delete(repoId);
    }
  }

  /**
   * §13.6 — review rounds to merge, with and without injected conventions.
   *
   * Needs a token but not a model: measuring is not mining, and the answer matters most exactly
   * when someone is deciding whether mining was worth it.
   */
  async measure(repoId: string): Promise<Comparison> {
    const repo = this.#repo(repoId);
    const scm = this.#scm;
    if (!scm || !repo?.gh_owner || !repo.gh_name) {
      throw new Error('measuring review rounds needs a GitHub token and a GitHub remote');
    }
    const owner = repo.gh_owner;
    const name = repo.gh_name;

    return compareInjection(this.#db, repoId, (prNumber) =>
      fetchReviewRounds(scm, { owner, name }, prNumber),
    );
  }

  list(repoId: string): ConventionWithEvidence[] {
    // Candidates first: those are the ones asking for a decision (§13.4).
    const order = { candidate: 0, active: 1, retired: 2, rejected: 3 } as const;
    return this.#conventions
      .list(repoId)
      .sort((a, b) => order[a.lifecycle] - order[b.lifecycle] || b.confidence - a.confidence);
  }

  /** §13.4 — one-click human confirmation, with the evidence shown next to the toggle. */
  confirm(id: string): boolean {
    return this.#conventions.promote(id, 'human');
  }

  reject(id: string, reason: string): void {
    this.#conventions.reject(id, reason);
  }

  #repo(repoId: string): { gh_owner: string | null; gh_name: string | null } | null {
    return (
      (this.#db.prepare('SELECT gh_owner, gh_name FROM repo WHERE id = ?').get(repoId) as
        | { gh_owner: string | null; gh_name: string | null }
        | undefined) ?? null
    );
  }
}
