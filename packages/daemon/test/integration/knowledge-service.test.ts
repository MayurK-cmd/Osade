import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import { Knowledge } from '../../src/knowledge/service.js';
import type { ModelPort, ModelRequest } from '../../src/knowledge/model.js';
import { ScmClient, type ScmRequest } from '../../src/scm/client.js';

const NOW = 1_756_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

let db: Db;

const silentModel: ModelPort = {
  async complete(req: ModelRequest) {
    if (req.pass === 'extract') return '{"observations":[]}';
    if (req.pass === 'cluster') return '{"rules":[]}';
    return '{"supported":0,"violated":0,"unknown":0,"notes":null}';
  },
};

function scmClient(handler: (route: string) => unknown = () => []): ScmClient {
  const request: ScmRequest = async (route) => ({
    status: 200,
    headers: {
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4900',
      'x-ratelimit-reset': String(Math.floor(NOW / 1000) + 3600),
    },
    data: handler(route),
  });
  return new ScmClient({ request, now: () => NOW });
}

function seedRepo(id: string, owner: string | null, name: string | null): void {
  db.prepare(
    'INSERT INTO repo (id, path, default_branch, gh_owner, gh_name, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, `/repo-${id}`, 'main', owner, name, NOW);
}

beforeEach(() => {
  db = openDb(':memory:');
  seedRepo('r1', 'acme', 'widget');
});

afterEach(() => {
  db.close();
});

describe('mining availability is reported, not discovered halfway through', () => {
  it('says so when no model is configured', () => {
    const knowledge = new Knowledge(db, scmClient(), null, { now: () => NOW });
    const availability = knowledge.availability('r1');

    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('OSADE_ANTHROPIC_API_KEY');
  });

  it('says so when there is no GitHub token', () => {
    const knowledge = new Knowledge(db, null, silentModel, { now: () => NOW });
    expect(knowledge.availability('r1').reason).toContain('OSADE_GITHUB_TOKEN');
  });

  it('explains that a repo with no GitHub remote has no review record to mine', () => {
    seedRepo('r2', null, null);
    const knowledge = new Knowledge(db, scmClient(), silentModel, { now: () => NOW });

    const availability = knowledge.availability('r2');
    expect(availability.available).toBe(false);
    expect(availability.reason).toContain('no review record to mine');
  });

  it('refuses to mine when it is unavailable, rather than half-running', async () => {
    const knowledge = new Knowledge(db, scmClient(), null, { now: () => NOW });
    await expect(knowledge.mine('r1')).rejects.toThrow(/OSADE_ANTHROPIC_API_KEY/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM mine_run').get()).toEqual({ n: 0 });
  });
});

describe('one run at a time', () => {
  it('refuses a second concurrent run on the same repo', async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => (release = resolve));

    const slowModel: ModelPort = {
      async complete(req) {
        await blocked;
        return silentModel.complete(req);
      },
    };

    const knowledge = new Knowledge(db, scmClient(() => []), slowModel, { now: () => NOW });
    const first = knowledge.mine('r1');

    expect(knowledge.isRunning('r1')).toBe(true);
    await expect(knowledge.mine('r1')).rejects.toThrow(/already in progress/);

    release();
    await first;
    expect(knowledge.isRunning('r1')).toBe(false);
  });

  it('clears the guard when a run throws', async () => {
    const angryModel: ModelPort = {
      async complete() {
        throw new Error('boom');
      },
    };
    const knowledge = new Knowledge(db, scmClient(), angryModel, { now: () => NOW });

    await knowledge.mine('r1');
    expect(knowledge.isRunning('r1')).toBe(false);
  });
});

describe('decay runs before mining, not after', () => {
  it('demotes a stale rule rather than letting the run silently renew it', async () => {
    let now = NOW;
    const knowledge = new Knowledge(db, scmClient(), silentModel, { now: () => now });

    const id = knowledge.conventions.write({
      repoId: 'r1',
      category: 'commit_style',
      ruleText: 'Sign every commit off.',
      confidence: 0.9,
      evidence: [
        { kind: 'doc', url: 'https://github.com/acme/widget/blob/main/CONTRIBUTING.md', observedAt: NOW },
      ],
    });
    knowledge.conventions.promote(id, 'confidence');

    now = NOW + 200 * DAY;
    const warnings: string[] = [];
    const watching = new Knowledge(db, scmClient(), silentModel, {
      now: () => now,
      onWarning: (m) => warnings.push(m),
    });
    await watching.mine('r1');

    expect(watching.conventions.get(id)?.lifecycle).toBe('candidate');
    expect(warnings.some((w) => w.includes('180 days'))).toBe(true);
  });
});

describe('what the UI reads', () => {
  it('lists candidates first — those are the ones asking for a decision', () => {
    const knowledge = new Knowledge(db, scmClient(), silentModel, { now: () => NOW });
    const evidence = [
      { kind: 'ci_config' as const, url: 'https://github.com/acme/widget/ci.yml', observedAt: NOW },
    ];

    const active = knowledge.conventions.write({
      repoId: 'r1',
      category: 'ci_gates',
      ruleText: 'Keep CI green.',
      confidence: 0.9,
      evidence,
    });
    knowledge.conventions.promote(active, 'confidence');
    knowledge.conventions.write({
      repoId: 'r1',
      category: 'commit_style',
      ruleText: 'Sign your commits.',
      confidence: 0.4,
      evidence,
    });

    expect(knowledge.list('r1').map((c) => c.lifecycle)).toEqual(['candidate', 'active']);
  });

  it('reports the last run, including a failed one', async () => {
    const brokenModel: ModelPort = {
      async complete(req) {
        return req.pass === 'cluster' ? 'nonsense' : silentModel.complete(req);
      },
    };
    const knowledge = new Knowledge(db, scmClient(), brokenModel, { now: () => NOW });
    await knowledge.mine('r1');

    const last = knowledge.lastRun('r1');
    expect(last?.startedAt).toBe(NOW);
    expect(last?.finishedAt).toBe(NOW);
  });
});
