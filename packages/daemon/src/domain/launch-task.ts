import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { basename, join } from 'node:path';

import type { Db } from '../db/index.js';
import { getTask } from '../db/task-repo.js';
import {
  SubstrateApiError,
  type SubstrateClient,
  type SubstrateMethodParams,
} from '../substrate/client.js';
import type { SubstrateEventSubscriber } from '../substrate/event-subscriber.js';
import { Conventions } from '../knowledge/conventions.js';
import { renderContextFile } from '../knowledge/context-file.js';
import { worktreePathFor } from '../paths.js';
import { agentEntry, DAEMON_DEFAULT_AGENT, hasCapability, requireAgent } from './agent-catalog.js';
import type { Checkpoints } from './checkpoints.js';
import {
  DEFAULT_MIRROR_PATHS,
  defaultBranch,
  githubRemote,
  mirrorPaths,
  pruneWorktrees,
  resolveSha,
} from './git.js';

/**
 * The launch sequence — OSADE.md §8.2.
 *
 * The ordering here is load-bearing and is not the ordering the spec originally had.
 * `agent.start` does not spawn a process: it resolves `kind` to a fixed executable, appends
 * args, and **types the command line into an existing idle shell pane**
 * (`backend/src/app/agents.rs:145-225`). Three consequences:
 *
 *   - the lane must exist and be at a shell prompt before the agent starts;
 *   - **environment cannot be set at `agent.start`** — it is set when the workspace or tab is
 *     created, so `OSADE_TASK_ID` is decided at lane creation;
 *   - a pane hosts at most one agent.
 */

/** A repo-level lock, per §9 rule 2: substrate has no cross-call lock and concurrent creates race. */
const repoLocks = new Map<string, Promise<unknown>>();

async function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T> {
  const previous = repoLocks.get(repoPath) ?? Promise.resolve();
  // Chain rather than reject: a queued launch should wait, not fail.
  const next = previous.then(fn, fn);
  repoLocks.set(
    repoPath,
    next.catch(() => {}),
  );
  try {
    return await next;
  } finally {
    if (repoLocks.get(repoPath) === next) repoLocks.delete(repoPath);
  }
}

export interface CreateTaskInput {
  repoPath: string;
  title: string;
  intent: string;
  agentId?: string | undefined;
  chatId?: string | undefined;
  baseRef?: string | undefined;
}

export interface LaunchResult {
  workspaceId: string;
  tabId: string;
  paneId: string;
  worktreePath: string;
  /** `<worktree>/.osade/CONTEXT.md` — §8.2 step 5. */
  contextPath: string;
  /** False on platforms where substrate cannot pass args to agent.start. See #agentStartArgs. */
  argsSupported: boolean;
  /** True when the first-run trust prompt fired and was resolved (§8.3). */
  resolvedTrustPrompt: boolean;
}

export interface LaunchTaskOptions {
  now?: () => number;
  defaultAgent?: string;
  onWarning?: (message: string) => void;
  /**
   * §9.1 — turn checkpoints. Optional so a caller that does not want undo history can skip
   * it; when present, launch captures one and a capture failure never fails the launch.
   */
  checkpoints?: Checkpoints;
}

/**
 * Timeouts. Note that `agent.start` is NOT a readiness barrier — it can return success with
 * `launch_pending: true` — so AGENT_SETTLE_TIMEOUT_MS is the one that actually matters.
 */
const AGENT_START_TIMEOUT_MS = 60_000;
const AGENT_SETTLE_TIMEOUT_MS = 90_000;

/**
 * §8.3 — Claude and Codex ask "do you trust this folder?" and Osade's cwd is a freshly created
 * worktree every single time, so this fires constantly. Matched narrowly on purpose: any other
 * `blocked` is §6 row 4, and answering that for the user is the one thing this must not do.
 */
const TRUST_PROMPT_MATCHES: readonly string[] = [
  'Is this a project you created',
  'Do you trust the files in this folder',
  'do you trust this folder',
];

/** How many times a visible trust prompt is answered before we stop and let a human see it. */
const MAX_TRUST_PROMPT_ANSWERS = 3;

export class LaunchTask {
  readonly #db: Db;
  readonly #substrate: SubstrateClient;
  readonly #subscriber: SubstrateEventSubscriber;
  readonly #now: () => number;
  readonly #defaultAgent: string;
  readonly #onWarning: (message: string) => void;
  readonly #checkpoints: Checkpoints | null;

  constructor(
    db: Db,
    substrate: SubstrateClient,
    subscriber: SubstrateEventSubscriber,
    options: LaunchTaskOptions = {},
  ) {
    this.#db = db;
    this.#substrate = substrate;
    this.#subscriber = subscriber;
    this.#now = options.now ?? Date.now;
    this.#defaultAgent = options.defaultAgent ?? DAEMON_DEFAULT_AGENT;
    this.#onWarning = options.onWarning ?? (() => {});
    this.#checkpoints = options.checkpoints ?? null;
  }

  /** Registers a repo and a task row. No substrate calls, no worktree — that is `launch`. */
  async createTask(input: CreateTaskInput): Promise<string> {
    if (input.agentId) requireAgent(input.agentId);

    const repoId = await this.ensureRepo(input.repoPath);
    const repo = this.#db.prepare('SELECT * FROM repo WHERE id = ?').get(repoId) as {
      path: string;
      default_branch: string;
      default_agent: string | null;
    };

    const sibling = input.chatId
      ? (this.#db
          .prepare(
            `SELECT title, base_ref, base_sha FROM task
              WHERE chat_id = ? ORDER BY created_at ASC LIMIT 1`,
          )
          .get(input.chatId) as { title: string; base_ref: string; base_sha: string } | undefined)
      : undefined;

    const baseRef = input.baseRef ?? sibling?.base_ref ?? repo.default_branch;
    const baseSha =
      sibling && input.baseRef == null ? sibling.base_sha : await resolveSha(repo.path, baseRef);

    const taskId = `t_${randomUUID().slice(0, 8)}`;
    const chatId = input.chatId ?? taskId;
    const resolvedAgent = input.agentId ?? repo.default_agent ?? this.#defaultAgent;
    const slug = slugify(sibling?.title ?? input.title);
    const branch = `osade/${slug}/${resolvedAgent}`;
    const worktreePath = worktreePathFor(basename(repo.path), taskId);

    this.#db
      .prepare(
        `INSERT INTO task (id, repo_id, title, intent, origin_kind, agent_id, chat_id, base_ref,
                           base_sha, branch, worktree_path, created_at)
         VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        taskId,
        repoId,
        input.title,
        input.intent,
        input.agentId ?? null,
        chatId,
        baseRef,
        baseSha,
        branch,
        worktreePath,
        this.#now(),
      );

    return taskId;
  }

  /** The §8.2 sequence. Serialized per repo, because substrate has no cross-call lock. */
  async launch(taskId: string): Promise<LaunchResult> {
    const task = getTask(this.#db, taskId);
    if (!task) throw new Error(`unknown task ${taskId}`);

    const repo = this.#db.prepare('SELECT * FROM repo WHERE id = ?').get(task.repo_id) as {
      id: string;
      path: string;
      default_agent: string | null;
      gh_owner: string | null;
      gh_name: string | null;
    };

    const agentId = task.agent_id ?? repo.default_agent ?? this.#defaultAgent;
    const entry = agentEntry(agentId);
    if (!entry) throw new Error(`no catalog entry for agent ${agentId}`);

    return withRepoLock(repo.path, async () => {
      // 2. prune → worktree → mirror, all before anything is spawned.
      await pruneWorktrees(repo.path);

      // 3. One call gives the git worktree AND its workspace. The root pane is the shell lane.
      const created = await this.#substrate.request<
        'worktree.create',
        { workspace: { workspace_id: string }; root_pane: { pane_id: string } }
      >(
        'worktree.create',
        {
          cwd: repo.path,
          branch: task.branch,
          base: task.base_sha,
          path: task.worktree_path,
          label: task.title,
          focus: false,
        },
        60_000,
      );

      const workspaceId = created.workspace.workspace_id;
      this.#db
        .prepare('UPDATE task SET substrate_workspace_id = ? WHERE id = ?')
        .run(workspaceId, taskId);

      // §9 rule 5 — after the worktree exists, before the agent starts. Without this, half of
      // real repos will not even boot in a worktree.
      const mirrored = await mirrorPaths(repo.path, task.worktree_path, DEFAULT_MIRROR_PATHS);
      if (mirrored.length > 0) {
        this.#onWarning(`mirrored into worktree: ${mirrored.join(', ')}`);
      }

      // 4. The agent lane. This is the ONLY opportunity to set environment (§8.2).
      const tab = await this.#substrate.request<
        'tab.create',
        { tab: { tab_id: string }; root_pane: { pane_id: string } }
      >('tab.create', {
        workspace_id: workspaceId,
        label: 'agent',
        focus: false,
        env: {
          OSADE_TASK_ID: taskId,
          OSADE_REPO_PATH: repo.path,
        },
      });

      const paneId = tab.root_pane.pane_id;
      const tabId = tab.tab.tab_id;

      // Ensure the fact row exists so the subscriber can bind the pane to the task.
      this.#db.prepare('INSERT OR IGNORE INTO agent_fact (task_id) VALUES (?)').run(taskId);

      // 6. Subscribe BEFORE starting, so the launch transition is not missed.
      this.#subscriber.watchPane(taskId, paneId);

      // 5. Render the launch context (§8.2 step 5, §13.5). Always written, because it is the
      //    delivery mechanism whenever system-prompt args are unavailable.
      const contextPath = await this.#writeContext(task, repo);

      // 7. Build args from the catalog. the substrate picks the executable itself (§8.1).
      const args = this.#agentStartArgs(entry);

      // `agent.start` is not a reliable readiness signal in either direction, verified against
      // the substrate 0.8.2-p20:
      //   - it can return **success** immediately with `launch_pending: true` and
      //     `agent_status: unknown`, before the agent has rendered anything;
      //   - it can return **`agent_not_ready`** when its own detector saw `blocked` during
      //     startup, which for a fresh worktree is almost always the trust prompt (§8.3).
      // So the call is made, its outcome is recorded rather than trusted, and readiness is
      // established afterwards by `#awaitAgentReady`.
      let startError: SubstrateApiError | null = null;
      try {
        await this.#substrate.request(
          'agent.start',
          {
            name: `osade-${taskId}`,
            kind: entry.id,
            pane_id: paneId,
            args,
            timeout_ms: AGENT_START_TIMEOUT_MS,
          },
          AGENT_START_TIMEOUT_MS + 10_000,
        );
      } catch (err) {
        if (err instanceof SubstrateApiError && err.code === 'agent_not_ready') {
          startError = err;
        } else {
          throw err;
        }
      }

      const ready = await this.#awaitAgentReady(paneId, AGENT_SETTLE_TIMEOUT_MS);
      if (!ready.interactive) {
        throw (
          startError ??
          new Error(
            `pane ${paneId}: ${entry.id} started but never became interactive. ` +
              `Last pane output:\n${ready.lastOutput.slice(-800)}`,
          )
        );
      }
      const resolvedTrustPrompt = ready.resolvedTrustPrompt;

      // 8. Best-effort checkpoint. §9.1 — a capture failure never fails a launch.
      // §8.2 step 8 / §9.1 — best-effort, and `Checkpoints.capture` never throws.
      // Delegated rather than inlined: two implementations of "record a checkpoint" produced
      // two rows for one launch, which the M1 acceptance test caught.
      await this.#checkpoints?.capture(taskId, 'launch');

      return {
        workspaceId,
        tabId,
        paneId,
        worktreePath: task.worktree_path,
        contextPath,
        argsSupported: agentStartArgsSupported(),
        resolvedTrustPrompt,
      };
    });
  }

  /**
   * Args for `agent.start`, or none on a platform where the substrate cannot pass them.
   *
   * **Windows limitation, verified against the substrate 0.8.2-p20.** With no args, the substrate submits
   * `& claude` and the agent starts. With args it submits
   * `Start-Process -FilePath claude -ArgumentList '...' -NoNewWindow -Wait -PassThru`, and
   * PowerShell's `Start-Process` cannot execute an extensionless npm shim — the pane shows
   * `%1 is not a valid Win32 application` and no agent ever appears. Since most agent CLIs on
   * Windows are npm shims, passing args there is a silent launch failure.
   *
   * So on Windows the agent starts bare and the launch context is delivered through
   * `<worktree>/.osade/CONTEXT.md` (§13.5 already provides for agents with no system-prompt
   * flag). Mode args such as `--permission-mode` are lost, which is a real capability
   * reduction and is reported rather than hidden.
   */
  #agentStartArgs(entry: ReturnType<typeof agentEntry> & object): string[] {
    if (!agentStartArgsSupported()) {
      this.#onWarning(
        `agent.start args are unsupported on this platform; starting ${entry.id} bare and ` +
          `delivering context through .osade/CONTEXT.md (mode args are not applied)`,
      );
      return [];
    }
    const args = [...entry.autonomousArgs];
    if (entry.systemPromptFlag && hasCapability(entry, 'system-prompt-injection')) {
      args.push(entry.systemPromptFlag, `@.osade/CONTEXT.md`);
    }
    return args;
  }

  /**
   * The opening prompt — §13.5.
   *
   * When system-prompt args could not be passed, the context file is referenced here instead,
   * which is exactly what §13.5 prescribes for agents without system-prompt injection.
   */
  openingPrompt(intent: string, argsSupported: boolean): string {
    if (argsSupported) return intent;
    return `First read .osade/CONTEXT.md in this worktree, then: ${intent}`;
  }

  /**
   * Waits until the substrate reports the pane's agent as interactive, answering the first-run trust
   * prompt if it appears while we wait.
   *
   * This exists because `agent.start` is not a readiness signal (see the call site). The two
   * outcomes are interleaved rather than sequenced: the prompt may already be on screen when
   * the call returns, or may appear a second later, so both are handled in one loop with a
   * single deadline.
   *
   * A bounded launch handshake, not a status feed: once per launch, hard deadline, never
   * drives the UI. Live status comes from the pane subscription (§7.2), already open by now.
   */
  async #awaitAgentReady(
    paneId: string,
    timeoutMs: number,
  ): Promise<{ interactive: boolean; resolvedTrustPrompt: boolean; lastOutput: string }> {
    const deadline = this.#now() + timeoutMs;
    let resolvedTrustPrompt = false;
    let answerAttempts = 0;
    let lastOutput = '';

    while (this.#now() < deadline) {
      try {
        const info = await this.#substrate.request<
          'agent.get',
          { agent: { interactive_ready?: boolean; launch_pending?: boolean } }
        >('agent.get', { target: paneId }, 5_000);
        if (info.agent.interactive_ready === true && info.agent.launch_pending !== true) {
          return { interactive: true, resolvedTrustPrompt, lastOutput };
        }
      } catch {
        // Not yet a named agent — the substrate is still detecting. Keep waiting.
      }

      lastOutput = await this.#readPane(paneId);

      // §8.3 — matched narrowly on purpose. Any other blocked state is §6 row 4, and
      // answering that on the user's behalf is the one thing this must not do. The live
      // selector must be on screen too: the prompt text alone can be stale scrollback from a
      // prompt that was already answered.
      if (
        answerAttempts < MAX_TRUST_PROMPT_ANSWERS &&
        TRUST_PROMPT_MATCHES.some((m) => lastOutput.includes(m)) &&
        trustSelection(lastOutput) != null
      ) {
        answerAttempts++;
        if (await this.#answerTrustPrompt(paneId)) resolvedTrustPrompt = true;
        // Give the TUI time to repaint before deciding whether the prompt is really gone.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        continue;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return { interactive: false, resolvedTrustPrompt, lastOutput };
  }

  /**
   * Answers the trust prompt by **confirming the selection moved before committing it**.
   *
   * Sending `Down` then `Enter` blind is wrong, and the failure is bad: keystrokes sent while
   * the TUI is still painting are dropped, so a dropped `Down` leaves "❯ No, exit" selected and
   * `Enter` then *exits Claude*. That looked like an intermittent 90-second launch timeout and
   * was actually Osade declining the folder on the user's behalf.
   *
   * So each `Down` is verified against a re-read of the pane, and `Enter` is only sent once the
   * trust option is actually selected. Returns false if it never gets there — the human should
   * see that, not have it guessed at.
   */
  async #answerTrustPrompt(paneId: string): Promise<boolean> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const selection = trustSelection(await this.#readPane(paneId));
      if (selection == null) return false;

      if (selection === 'trust') {
        await this.#substrate.request('pane.send_keys', { pane_id: paneId, keys: ['Enter'] });
        return true;
      }

      await this.#substrate.request('pane.send_keys', { pane_id: paneId, keys: ['Down'] });
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    this.#onWarning(
      `pane ${paneId}: could not move the trust prompt selection onto the trust option; ` +
        `leaving it for a human rather than guessing`,
    );
    return false;
  }

  async #readPane(paneId: string): Promise<string> {
    try {
      const result = await this.#substrate.request<'pane.read', { read: { text: string } }>(
        'pane.read',
        { pane_id: paneId, source: 'visible', lines: 60, format: 'text', strip_ansi: true },
        5_000,
      );
      return result.read.text;
    } catch {
      return '';
    }
  }

  /**
   * Tears a task's the substrate workspace down — §9 rule 6.
   *
   * Order matters and is not obvious: **every pane must be closed before the worktree is
   * removed.** A live shell holds its cwd open, and on Windows that makes the directory
   * undeletable — `worktree.remove` fails with `Permission denied` even with `force: true`.
   * the substrate's own rule ("no live pane in the task's workspace") is therefore a hard prerequisite
   * rather than a courtesy.
   *
   * `force` still means what §9 rule 6 says: it overrides *uncommitted changes*, not live
   * panes, and belongs behind a typed confirmation in the UI.
   */
  async teardown(taskId: string, options: { force?: boolean } = {}): Promise<void> {
    const task = getTask(this.#db, taskId);
    if (!task?.substrate_workspace_id) return;

    const paneId = this.#paneFor(taskId);
    if (paneId) this.#subscriber.unwatchPane(paneId);

    const panes = await this.#substrate
      .request<'pane.list', { panes: { pane_id: string }[] }>('pane.list', {
        workspace_id: task.substrate_workspace_id,
      })
      .catch(() => ({ panes: [] as { pane_id: string }[] }));

    // Close every pane but one. `worktree.remove` is addressed by workspace id, and the substrate
    // closes a workspace when its last pane goes — so closing them all leaves nothing to
    // address and the call fails with `workspace_not_found`. One pane has to survive the
    // removal.
    const [survivor, ...doomed] = panes.panes;
    for (const pane of doomed) {
      await this.#substrate.request('pane.close', { pane_id: pane.pane_id }).catch(() => {});
    }

    // …and that survivor must not be sitting in the directory about to be deleted. A shell
    // holds its working directory open, which on Windows makes the checkout undeletable and
    // surfaces as `Permission denied` from `worktree.remove` even with force. `cd ~` is valid
    // in both POSIX shells and PowerShell.
    if (survivor) {
      await this.#substrate
        .request('pane.send_input', { pane_id: survivor.pane_id, text: 'cd ~\r' })
        .catch(() => {});
      // Wait on the observed cwd rather than on a fixed delay: the shell processes the `cd`
      // asynchronously, and a sleep that is long enough on an idle machine is not long enough
      // on a busy one.
      await this.#waitForCwdOutside(survivor.pane_id, task.worktree_path, 10_000);
    }

    await this.#removeWorktree(task.substrate_workspace_id, task.worktree_path, options.force ?? false);

    this.#db.prepare('UPDATE task SET substrate_workspace_id = NULL WHERE id = ?').run(taskId);
    this.#db
      .prepare('UPDATE agent_fact SET pane_alive = 0, substrate_pane_id = NULL WHERE task_id = ?')
      .run(taskId);
  }

  /** Polls the pane's reported cwd until it is no longer inside the checkout. */
  async #waitForCwdOutside(paneId: string, worktreePath: string, timeoutMs: number): Promise<void> {
    const target = worktreePath.replace(/\\/g, '/').toLowerCase();
    const deadline = this.#now() + timeoutMs;

    while (this.#now() < deadline) {
      const info = await this.#substrate
        .request<'pane.get', { pane: { cwd?: string | null } }>(
          'pane.get',
          { pane_id: paneId },
          5_000,
        )
        .catch(() => null);

      const cwd = info?.pane.cwd?.replace(/\\/g, '/').toLowerCase() ?? '';
      if (cwd === '' || !cwd.startsWith(target)) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    this.#onWarning(`pane ${paneId} is still inside ${worktreePath}; removal may fail`);
  }

  /**
   * Removes the checkout, retrying while the OS still holds it.
   *
   * On Windows a handle released by an exiting process is not immediately reflected, so
   * `Permission denied` here is usually transient rather than a real refusal. Retried a few
   * times with backoff; a genuine refusal — a dirty checkout without `force` — is a different
   * error and is rethrown at once.
   *
   * **`worktree.remove` is not atomic.** the substrate closes the workspace first and deletes the
   * directory second, so a transient `Permission denied` leaves the workspace already gone. A
   * naive retry then fails with `workspace_not_found` and reports *that* instead of the real
   * problem. So after the first attempt the absence of the workspace is evidence, not an
   * error: if the directory is gone the removal finished, and if it is still there the removal
   * half-succeeded and says so plainly.
   */
  async #removeWorktree(
    workspaceId: string,
    worktreePath: string,
    force: boolean,
  ): Promise<void> {
    const attempts = 5;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await this.#substrate.request('worktree.remove', { workspace_id: workspaceId, force });
        return;
      } catch (err) {
        const message = err instanceof SubstrateApiError ? err.message : String(err);

        if (attempt > 1 && /workspace_not_found/i.test(message)) {
          // the substrate's registration is gone; only the directory is left. Its own removal already
          // ran, so finishing the job is no longer worktree *lifecycle* — it is deleting a
          // leftover directory, which §1's carve-out covers.
          await this.#reapLeftoverCheckout(worktreePath);
          return;
        }

        const transient = /permission denied|being used by another/i.test(message);
        if (!transient || attempt === attempts) throw err;
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }

  /**
   * Deletes a checkout the substrate has already deregistered.
   *
   * A just-exited PTY can hold its working directory for a moment on Windows, so the directory
   * outlives the workspace. Waited on rather than slept through, then removed, then pruned so
   * git's registration does not outlive the directory either (§9 rule 3 in reverse).
   */
  async #reapLeftoverCheckout(worktreePath: string): Promise<void> {
    const deadline = this.#now() + 10_000;
    while (this.#now() < deadline) {
      if (!existsSync(worktreePath)) return;
      try {
        await rm(worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        if (!existsSync(worktreePath)) return;
      } catch {
        // Still held. Wait and try again until the deadline.
      }
      await new Promise((resolve) => setTimeout(resolve, 400));
    }

    this.#onWarning(
      `the substrate removed the workspace for ${worktreePath} but the directory is still on disk; ` +
        `something outside Osade is holding it open. Run \`git worktree prune\` after it frees.`,
    );
  }

  /**
   * Sends a prompt into the task's agent lane.
   *
   * `wait` is retried once on `agent_prompt_stalled`: the substrate requires an observed state change
   * within 5s of a submission from a non-working state, and an agent that has just gone idle
   * can miss that window without anything being wrong. A second submission is safe because the
   * first one was rejected before any input was sent.
   */
  async prompt(taskId: string, text: string, wait: boolean): Promise<void> {
    const paneId = this.#paneFor(taskId);
    if (!paneId) throw new Error(`task ${taskId} has no live agent pane`);

    // §4.2 — prefer one blocking call over prompt-then-poll: each connection is a substrate thread.
    const params: SubstrateMethodParams['agent.prompt'] = wait
      ? {
          target: paneId,
          text,
          // Any settled state ends the wait; §6.1 decides what each one means, not this call.
          wait: { until: ['idle', 'done', 'blocked'], timeout_ms: 300_000 },
        }
      : { target: paneId, text };
    const timeout = wait ? 310_000 : 30_000;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await this.#substrate.request('agent.prompt', params, timeout);
        return;
      } catch (err) {
        const stalled = err instanceof SubstrateApiError && err.code === 'agent_prompt_stalled';
        if (!stalled || attempt === 2) throw err;
        this.#onWarning(`prompt to ${taskId} stalled on submission; retrying once`);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  }

  /** §4.4.1 — the only screen content the pinned schema exposes. On demand, at most 1 Hz. */
  async readTranscript(
    taskId: string,
    lines: number,
  ): Promise<{ text: string; revision: number; truncated: boolean } | null> {
    const paneId = this.#paneFor(taskId);
    if (!paneId) return null;
    // `pane_read` wraps its payload: { type: 'pane_read', read: PaneReadResult }.
    const result = await this.#substrate.request<
      'pane.read',
      { read: { text: string; revision: number; truncated: boolean } }
    >('pane.read', {
      pane_id: paneId,
      source: 'recent',
      lines,
      format: 'text',
      strip_ansi: true,
    });
    return {
      text: result.read.text,
      revision: result.read.revision,
      truncated: result.read.truncated,
    };
  }

  /**
   * §8.2.1 — relaunch after a substrate restart.
   *
   * the substrate restores panes but not agent processes, so a restored pane is back at a shell prompt
   * and `agent_pane_busy` will not fire. Never sets `terminated`: the task is queued.
   */
  async relaunchAfterRestart(taskId: string): Promise<void> {
    const task = getTask(this.#db, taskId);
    if (!task) return;
    const fact = this.#db
      .prepare('SELECT substrate_pane_id, agent_session_id FROM agent_fact WHERE task_id = ?')
      .get(taskId) as { substrate_pane_id: string | null; agent_session_id: string | null } | undefined;
    if (!fact?.substrate_pane_id) return;

    const repo = this.#db.prepare('SELECT default_agent FROM repo WHERE id = ?').get(task.repo_id) as
      | { default_agent: string | null }
      | undefined;
    const entry = agentEntry(task.agent_id ?? repo?.default_agent ?? this.#defaultAgent);
    if (!entry) return;

    const args = [...entry.autonomousArgs];
    if (fact.agent_session_id && hasCapability(entry, 'resume')) args.push(...entry.resumeArgs);

    this.#subscriber.watchPane(taskId, fact.substrate_pane_id);
    await this.#substrate.request(
      'agent.start',
      {
        name: `osade-${taskId}`,
        kind: entry.id,
        pane_id: fact.substrate_pane_id,
        args,
        timeout_ms: AGENT_START_TIMEOUT_MS,
      },
      AGENT_START_TIMEOUT_MS + 10_000,
    );
  }

  #paneFor(taskId: string): string | null {
    const row = this.#db
      .prepare('SELECT substrate_pane_id FROM agent_fact WHERE task_id = ?')
      .get(taskId) as { substrate_pane_id: string | null } | undefined;
    return row?.substrate_pane_id ?? null;
  }

  /**
   * §8.2 step 5 / §13.5 — render the launch context into the worktree.
   *
   * The active conventions for this repo go in here, capped at 40 rules and ~2000 tokens by
   * `renderContextFile`. A repo that has never been mined simply has no rules section: mining is
   * a separate, explicit action (§13.4), and launching must never block on it.
   */
  async #writeContext(
    task: { id: string; worktree_path: string; intent: string; base_ref: string; base_sha: string },
    repo: { id: string; path: string; gh_owner: string | null; gh_name: string | null },
  ): Promise<string> {
    const dir = join(task.worktree_path, '.osade');
    const path = join(dir, 'CONTEXT.md');

    const { injected, overflow } = new Conventions(this.#db).forInjection(repo.id);
    const rendered = renderContextFile({
      repoSlug:
        repo.gh_owner && repo.gh_name ? `${repo.gh_owner}/${repo.gh_name}` : basename(repo.path),
      intent: task.intent,
      baseRef: task.base_ref,
      baseSha: task.base_sha,
      conventions: injected,
      verifySteps: this.#verifyStepsFor(repo.id),
      overflow,
    });

    if (rendered.omitted > 0) {
      this.#onWarning(
        `${rendered.omitted} active convention(s) did not fit the context budget and were not injected`,
      );
    }

    // §13.6 — instrument it from day one. Which side of the comparison this task falls on is
    // only knowable now: by the time its PR merges, the repo's conventions will have changed.
    this.#db
      .prepare(
        `INSERT INTO task_injection (task_id, rule_count, omitted, injected_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           rule_count = excluded.rule_count,
           omitted = excluded.omitted,
           injected_at = excluded.injected_at`,
      )
      .run(task.id, rendered.included, rendered.omitted, this.#now());

    await mkdir(dir, { recursive: true });
    await writeFile(path, rendered.body, 'utf8');
    return path;
  }

  /**
   * The verification the agent will actually be held to.
   *
   * Only a **confirmed** plan is named here. §10.1 is explicit that an inferred command is never
   * run silently the first time, and telling an agent to satisfy commands that will not run is
   * the same mistake wearing a different hat — it spends the agent's attention on a guess.
   */
  #verifyStepsFor(repoId: string): { name: string; cmd: string }[] {
    const row = this.#db
      .prepare('SELECT steps_json, needs_review FROM verify_plan WHERE repo_id = ?')
      .get(repoId) as { steps_json: string; needs_review: number } | undefined;
    if (!row || row.needs_review !== 0) return [];

    try {
      const steps = JSON.parse(row.steps_json) as { name: string; cmd: string }[];
      return steps.map((s) => ({ name: s.name, cmd: s.cmd }));
    } catch {
      return [];
    }
  }

  /**
   * Registers a repo, once, under concurrency.
   *
   * A check-then-insert is a race here: `defaultBranch` is async, so four concurrent
   * `createTask` calls all observe no row, all try to insert, and three die on
   * `UNIQUE constraint failed: repo.path`. That is not hypothetical — it is what four parallel
   * tasks on one repo do, and it is what `test/integration/parallel-tasks.test.ts` caught.
   *
   * The async work happens first, then a single atomic upsert: sqlite serializes statements, so
   * `ON CONFLICT DO NOTHING` followed by a read is race-free without a lock of our own.
   */
  async ensureRepo(repoPath: string): Promise<string> {
    const existing = this.#db.prepare('SELECT id FROM repo WHERE path = ?').get(repoPath) as
      | { id: string }
      | undefined;
    if (existing) return existing.id;

    const branch = await defaultBranch(repoPath);
    // §11 — read the GitHub identity from the remote rather than asking the user for something
    // git already knows. Null for a local-only repo, which is a valid task target that simply
    // cannot open pull requests.
    const remote = await githubRemote(repoPath);

    this.#db
      .prepare(
        `INSERT INTO repo (id, path, default_branch, gh_owner, gh_name, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO NOTHING`,
      )
      .run(
        `r_${randomUUID().slice(0, 8)}`,
        repoPath,
        branch,
        remote?.owner ?? null,
        remote?.name ?? null,
        this.#now(),
      );

    const row = this.#db.prepare('SELECT id FROM repo WHERE path = ?').get(repoPath) as {
      id: string;
    };
    return row.id;
  }
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'task'
  );
}

/**
 * Whether `agent.start` can carry args on this platform.
 *
 * See `LaunchTask.#agentStartArgs` for the Windows failure this guards, verified against
 * the substrate 0.8.2-p20.
 */
export function agentStartArgsSupported(): boolean {
  return platform() !== 'win32';
}

/**
 * Which option the trust prompt currently has selected, or null when no live selector is on
 * screen.
 *
 * Claude Code marks the selection with `❯`. Reading it — rather than assuming the default and
 * navigating blind — is what makes answering the prompt safe: the alternative failure mode is
 * pressing Enter on "No, exit".
 */
export function trustSelection(paneText: string): 'trust' | 'decline' | null {
  let sawOption = false;
  let selected: 'trust' | 'decline' | null = null;

  for (const line of paneText.split('\n')) {
    const isTrust = /yes,\s*i trust/i.test(line);
    const isDecline = /\bno,\s*exit\b/i.test(line);
    if (!isTrust && !isDecline) continue;

    sawOption = true;
    if (line.includes('❯') || line.trimStart().startsWith('>')) {
      selected = isTrust ? 'trust' : 'decline';
    }
  }

  // Options with no selector means the prompt is scrollback, not a live question.
  return sawOption ? selected : null;
}
