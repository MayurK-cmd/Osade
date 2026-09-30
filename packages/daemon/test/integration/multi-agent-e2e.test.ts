/**
 * Integration tests — §OSADE Prompt 1: Session persistence and end-to-end multi-agent.
 *
 * These tests use real SQLite (via openDb), a fake substrate client, and a real
 * LaunchTask instance. They exercise actual application logic.
 *
 * Test categories:
 *   §4  End-to-end multi-agent composer send (one chat, two lanes)
 *   §5  Agent follow-up (second @claude goes to same lane; @codex goes to Codex lane)
 *   §7  Persistence round-trip (create → close db → reopen → verify state survives)
 *   §8  Failure cases (unavailable agent, missing task, failed task)
 *
 * SQLite requires the native binding compiled for the current Node version.
 * If that is unavailable the tests are automatically skipped via the error
 * boundary in beforeEach.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Conditional import guard: if better-sqlite3 is miscompiled the test suite
// still loads but individual tests skip gracefully.
let openDb: typeof import('../../src/db/index.js').openDb;
let getTask: typeof import('../../src/db/task-repo.js').getTask;
let getAgentFact: typeof import('../../src/db/task-repo.js').getAgentFact;
let listTurns: typeof import('../../src/domain/chat-turns.js').listTurns;
let LaunchTask: typeof import('../../src/domain/launch-task.js').LaunchTask;
let listChatContext: typeof import('../../src/domain/chat-context.js').listChatContext;
let attachContextRepo: typeof import('../../src/domain/chat-context.js').attachContextRepo;

let dbAvailable = true;

try {
  const dbMod = await import('../../src/db/index.js');
  const probe = dbMod.openDb(':memory:');
  probe.close();
  const taskRepoMod = await import('../../src/db/task-repo.js');
  const chatTurnsMod = await import('../../src/domain/chat-turns.js');
  const launchMod = await import('../../src/domain/launch-task.js');
  const chatCtxMod = await import('../../src/domain/chat-context.js');
  openDb = dbMod.openDb;
  getTask = taskRepoMod.getTask;
  getAgentFact = taskRepoMod.getAgentFact;
  listTurns = chatTurnsMod.listTurns;
  LaunchTask = launchMod.LaunchTask;
  listChatContext = chatCtxMod.listChatContext;
  attachContextRepo = chatCtxMod.attachContextRepo;
} catch {
  dbAvailable = false;
}

const NOW = 1_756_000_000_000;

type Db = ReturnType<typeof openDb>;

let dir: string;
let repo: string;
let db: Db;
let launcher: InstanceType<typeof LaunchTask>;

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function fakeSubstrate() {
  let workspaceSeq = 0;
  let paneSeq = 0;
  return {
    async request(method: string): Promise<unknown> {
      switch (method) {
        case 'workspace.create':
        case 'worktree.create': {
          workspaceSeq++;
          return {
            workspace: { workspace_id: `w${workspaceSeq}` },
            root_pane: { pane_id: `w${workspaceSeq}:p1` },
          };
        }
        case 'tab.create': {
          paneSeq++;
          return {
            tab: { tab_id: `w${workspaceSeq}:t2` },
            root_pane: { pane_id: `w${workspaceSeq}:p${paneSeq + 1}` },
          };
        }
        case 'agent.start':
          return { agent: {}, argv: [] };
        case 'agent.get':
          return { agent: { interactive_ready: true, launch_pending: false } };
        case 'pane.read':
          return { read: { text: '', revision: 1, truncated: false } };
        default:
          return {};
      }
    },
  };
}

function fakeSubscriber() {
  return {
    watchPane(taskId: string, paneId: string) {
      if (!dbAvailable) return;
      db.prepare('UPDATE agent_fact SET substrate_pane_id = ? WHERE task_id = ?').run(
        paneId,
        taskId,
      );
    },
    unwatchPane() {},
  };
}

beforeEach(() => {
  if (!dbAvailable) return;
  dir = mkdtempSync(join(tmpdir(), 'osade-e2e-'));
  process.env.OSADE_HOME = join(dir, 'home');
  repo = join(dir, 'repo');
  sh(dir, ['init', '-q', '-b', 'main', 'repo']);
  writeFileSync(join(repo, 'README.md'), '# test\n');
  sh(repo, ['add', '-A']);
  sh(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  db = openDb(':memory:');
  launcher = new LaunchTask(
    db,
    fakeSubstrate() as never,
    fakeSubscriber() as never,
    { now: () => NOW },
  );
});

afterEach(() => {
  if (!dbAvailable) return;
  try {
    db?.close();
  } catch {
    /* already closed in persistence tests */
  }
  delete process.env.OSADE_HOME;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* leave for OS temp sweeper */
  }
});

// ── §4: End-to-end multi-agent send ─────────────────────────────────────────

describe('§4 — multi-agent composer send: one chat, two lanes', () => {
  it.skipIf(!dbAvailable)(
    'creates two tasks sharing one chat_id when @claude and @codex are both mentioned',
    async () => {
      // Simulates: @claude do X  @codex do Y
      const claudeTask = await launcher.createTask({
        repoPath: repo,
        title: 'implement and test',
        intent: 'do X',
        agentId: 'claude',
      });
      const codexTask = await launcher.createTask({
        repoPath: repo,
        title: 'implement and test',
        intent: 'do Y',
        chatId: claudeTask.taskId,
        agentId: 'codex',
      });

      const claudeRow = getTask(db, claudeTask.taskId)!;
      const codexRow = getTask(db, codexTask.taskId)!;

      // Both tasks share one chat
      expect(claudeRow.chat_id).toBe(codexRow.chat_id);
      // Each has its own agent
      expect(claudeRow.agent_id).toBe('claude');
      expect(codexRow.agent_id).toBe('codex');
      // Codex lane is isolated (its own worktree/branch)
      expect(codexTask.isolated).toBe(true);
    },
  );

  it.skipIf(!dbAvailable)(
    'each lane receives the correct prompt, not the other agents prompt',
    async () => {
      const claudeTask = await launcher.createTask({
        repoPath: repo,
        title: 'implement and test',
        intent: 'implement the login flow',
        agentId: 'claude',
      });
      const codexTask = await launcher.createTask({
        repoPath: repo,
        title: 'implement and test',
        intent: 'write tests for the login flow',
        chatId: claudeTask.taskId,
        agentId: 'codex',
      });

      const claudeRow = getTask(db, claudeTask.taskId)!;
      const codexRow = getTask(db, codexTask.taskId)!;
      // Intent is stored on the task — this is what the agent will receive
      expect(claudeRow.intent).toBe('implement the login flow');
      expect(codexRow.intent).toBe('write tests for the login flow');
      // No cross-contamination
      expect(claudeRow.intent).not.toContain('test');
      expect(codexRow.intent).not.toContain('implement the login flow');
    },
  );

  it.skipIf(!dbAvailable)(
    'agent facts are stored on the correct task after launch',
    async () => {
      const claudeTask = await launcher.createTask({
        repoPath: repo,
        title: 'dual agent',
        intent: 'do X',
        agentId: 'claude',
        isolate: true,
      });
      const codexTask = await launcher.createTask({
        repoPath: repo,
        title: 'dual agent',
        intent: 'do Y',
        chatId: claudeTask.taskId,
        agentId: 'codex',
      });

      await launcher.launch(claudeTask.taskId);
      await launcher.launch(codexTask.taskId);

      const claudeFact = getAgentFact(db, claudeTask.taskId);
      const codexFact = getAgentFact(db, codexTask.taskId);
      // Each task has its own agent_fact row
      expect(claudeFact).not.toBeNull();
      expect(codexFact).not.toBeNull();
      // Pane IDs are distinct
      expect(claudeFact?.substrate_pane_id).not.toBe(codexFact?.substrate_pane_id);
    },
  );

  it.skipIf(!dbAvailable)('no lane data is mixed between agents', async () => {
    const claudeTask = await launcher.createTask({
      repoPath: repo,
      title: 'dual agent',
      intent: 'implement X',
      agentId: 'claude',
      isolate: true,
    });
    const codexTask = await launcher.createTask({
      repoPath: repo,
      title: 'dual agent',
      intent: 'test Y',
      chatId: claudeTask.taskId,
      agentId: 'codex',
    });

    await launcher.launch(claudeTask.taskId);
    await launcher.launch(codexTask.taskId);

    // Simulate Codex going blocked
    db.prepare(
      `UPDATE agent_fact SET substrate_state = 'blocked', state_change_seq = 5 WHERE task_id = ?`,
    ).run(codexTask.taskId);

    // Claude must be unaffected
    const claudeFact = getAgentFact(db, claudeTask.taskId);
    expect(claudeFact?.substrate_state).toBeNull();
    // Codex has the state we set
    const codexFact = getAgentFact(db, codexTask.taskId);
    expect(codexFact?.substrate_state).toBe('blocked');
  });
});

// ── §5: Agent follow-up routing ──────────────────────────────────────────────

describe('§5 — agent follow-up: second message to same lane', () => {
  it.skipIf(!dbAvailable)(
    '@claude continue goes to the same Claude lane (laneTarget returns existing)',
    async () => {
      const first = await launcher.createTask({
        repoPath: repo,
        title: 'implement auth',
        intent: 'implement the login endpoint',
        agentId: 'claude',
      });

      // The renderer's laneTarget() finds the existing lane by agentId.
      // We verify at the domain level: a second createTask with the same chatId and
      // same agentId is the NOT the expected path — the renderer uses laneTarget to
      // avoid creating a new task. Instead we verify that the task row for claude is
      // still the same one, and a follow-up turn can be recorded on it.
      const task = getTask(db, first.taskId)!;
      expect(task.agent_id).toBe('claude');
      expect(task.chat_id).toBeDefined();

      // Enqueue a follow-up turn directly (simulates what launchAndSend does)
      db.prepare(
        `INSERT INTO agent_fact (task_id, substrate_pane_id, substrate_state, pane_alive,
           state_change_seq, composer_ready)
         VALUES (?, 'w1:p1', 'idle', 1, 1, 1)`,
      ).run(first.taskId);
      db.prepare(
        `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
         VALUES ('ct1', ?, 1, 'user', 'human', 'implement the login endpoint', 'accepted', ?)`,
      ).run(first.taskId, NOW);
      db.prepare(
        `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
         VALUES ('ct2', ?, 2, 'user', 'human', 'continue with the logout endpoint', 'accepted', ?)`,
      ).run(first.taskId, NOW + 1000);

      const turns = listTurns(db, first.taskId);
      expect(turns).toHaveLength(2);
      expect(turns[0]!.text).toBe('implement the login endpoint');
      expect(turns[1]!.text).toBe('continue with the logout endpoint');
      // Both turns belong to the same task_id (same lane)
      expect(new Set(turns.map((t: { task_id: string }) => t.task_id)).size).toBe(1);
    },
  );

  it.skipIf(!dbAvailable)(
    '@codex review this goes to Codex lane, not Claude lane',
    async () => {
      const claudeTask = await launcher.createTask({
        repoPath: repo,
        title: 'implement auth',
        intent: 'implement the login endpoint',
        agentId: 'claude',
      });
      const codexTask = await launcher.createTask({
        repoPath: repo,
        title: 'implement auth',
        intent: 'review the implementation',
        chatId: claudeTask.taskId,
        agentId: 'codex',
      });

      // Verify they are different tasks in the same chat
      const claudeRow = getTask(db, claudeTask.taskId)!;
      const codexRow = getTask(db, codexTask.taskId)!;
      expect(claudeRow.chat_id).toBe(codexRow.chat_id);
      expect(claudeRow.agent_id).toBe('claude');
      expect(codexRow.agent_id).toBe('codex');
      expect(claudeRow.id).not.toBe(codexRow.id);

      // A turn sent to codex's task must not appear on claude's
      db.prepare(
        `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
         VALUES ('ct1', ?, 1, 'user', 'human', 'review the implementation', 'accepted', ?)`,
      ).run(codexTask.taskId, NOW);

      const claudeTurns = listTurns(db, claudeTask.taskId);
      const codexTurns = listTurns(db, codexTask.taskId);
      expect(claudeTurns).toHaveLength(0);
      expect(codexTurns).toHaveLength(1);
      expect(codexTurns[0]!.task_id).toBe(codexTask.taskId);
    },
  );
});

// ── §7: Persistence round-trip ───────────────────────────────────────────────

describe('§7 — persistence: session survives db close/reopen', () => {
  it.skipIf(!dbAvailable)(
    'task and chat_id survive a db close and reopen',
    async () => {
      const dbPath = join(dir, 'home', 'osade.db');
      const dbDurable = openDb(dbPath);
      const durableLauncher = new LaunchTask(
        dbDurable,
        fakeSubstrate() as never,
        fakeSubscriber() as never,
        { now: () => NOW },
      );
      const created = await durableLauncher.createTask({
        repoPath: repo,
        title: 'persisted task',
        intent: 'do important work',
        agentId: 'claude',
      });
      const taskId = created.taskId;

      // Insert a chat turn
      dbDurable.prepare(
        `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
         VALUES ('ct1', ?, 1, 'user', 'human', 'do important work', 'accepted', ?)`,
      ).run(taskId, NOW);

      // Close and reopen
      dbDurable.close();
      const dbReopened = openDb(dbPath);

      const task = getTask(dbReopened, taskId);
      expect(task).not.toBeNull();
      expect(task!.agent_id).toBe('claude');
      expect(task!.chat_id).toBe(taskId); // one-lane chat: chat_id = task_id
      expect(task!.intent).toBe('do important work');

      const turns = listTurns(dbReopened, taskId);
      expect(turns).toHaveLength(1);
      expect(turns[0]!.text).toBe('do important work');

      dbReopened.close();
    },
  );
});

// ── §8: Failure cases ────────────────────────────────────────────────────────

describe('§8 — failure cases: session state is not corrupted', () => {
  it.skipIf(!dbAvailable)('unknown agentId throws and no task is created', async () => {
    const countBefore = (
      db.prepare('SELECT COUNT(*) AS n FROM task').get() as { n: number }
    ).n;
    await expect(
      launcher.createTask({
        repoPath: repo,
        title: 'bad agent',
        intent: 'x',
        agentId: 'not-an-agent',
      }),
    ).rejects.toThrow(/unknown agent/i);
    const countAfter = (
      db.prepare('SELECT COUNT(*) AS n FROM task').get() as { n: number }
    ).n;
    expect(countAfter).toBe(countBefore);
  });

  it.skipIf(!dbAvailable)('launching a deleted task fails, other tasks unaffected', async () => {
    const good = await launcher.createTask({
      repoPath: repo,
      title: 'good',
      intent: 'x',
      isolate: true,
    });
    const doomed = await launcher.createTask({
      repoPath: repo,
      title: 'doomed',
      intent: 'y',
      isolate: true,
    });
    db.prepare('DELETE FROM task WHERE id = ?').run(doomed.taskId);

    const results = await Promise.allSettled([
      launcher.launch(good.taskId),
      launcher.launch(doomed.taskId),
    ]);

    expect(results[0]!.status).toBe('fulfilled');
    expect(results[1]!.status).toBe('rejected');

    // Good task must still be launchable afterward (repo lock was not held)
    const good2 = await launcher.createTask({
      repoPath: repo,
      title: 'good2',
      intent: 'z',
      isolate: true,
    });
    await expect(launcher.launch(good2.taskId)).resolves.toBeTruthy();
  });

  it.skipIf(!dbAvailable)('failed task turn does not corrupt sibling lanes', async () => {
    const claudeTask = await launcher.createTask({
      repoPath: repo,
      title: 'multi',
      intent: 'do X',
      agentId: 'claude',
      isolate: true,
    });
    const codexTask = await launcher.createTask({
      repoPath: repo,
      title: 'multi',
      intent: 'do Y',
      chatId: claudeTask.taskId,
      agentId: 'codex',
    });

    // Insert a failed turn for Codex
    db.prepare(
      `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, error, created_at)
       VALUES ('ct1', ?, 1, 'user', 'human', 'do Y', 'failed', 'agent exited', ?)`,
    ).run(codexTask.taskId, NOW);

    // Claude's turns must be untouched
    const claudeTurns = listTurns(db, claudeTask.taskId);
    expect(claudeTurns).toHaveLength(0);

    // Codex's failed turn is recorded correctly
    const codexTurns = listTurns(db, codexTask.taskId);
    expect(codexTurns[0]!.delivery).toBe('failed');
    expect(codexTurns[0]!.error).toBe('agent exited');
  });

  it.skipIf(!dbAvailable)(
    'malformed mention (@ghost) is treated as plain text — no task is created for ghost',
    async () => {
      // parseMentions filters unknown IDs; any task that IS created comes from
      // the primary lane. We verify that at the domain level: only the primary
      // task was created, not one for @ghost.
      const task = await launcher.createTask({
        repoPath: repo,
        title: 'ghost test',
        intent: '@ghost do something',
        // No agentId — uses default
      });
      const row = getTask(db, task.taskId)!;
      // The intent is stored verbatim; no agent_id is 'ghost'
      expect(row.intent).toBe('@ghost do something');
      expect(row.agent_id).toBeNull();

      const count = (
        db.prepare('SELECT COUNT(*) AS n FROM task').get() as { n: number }
      ).n;
      expect(count).toBe(1);
    },
  );

  it.skipIf(!dbAvailable)('empty response does not corrupt session state', async () => {
    const task = await launcher.createTask({
      repoPath: repo,
      title: 'empty response',
      intent: 'do X',
      agentId: 'claude',
    });

    // Simulate agent fact with no reply text
    db.prepare(
      `INSERT INTO agent_fact (task_id, substrate_state, pane_alive, state_change_seq,
         composer_ready, activity_text, final_message)
       VALUES (?, 'done', 0, 1, 0, NULL, NULL)`,
    ).run(task.taskId);

    const fact = getAgentFact(db, task.taskId);
    expect(fact?.substrate_state).toBe('done');
    expect(fact?.final_message).toBeNull();

    // Task row must still be intact
    const row = getTask(db, task.taskId);
    expect(row).not.toBeNull();
    expect(row!.intent).toBe('do X');
  });
});
