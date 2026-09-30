/**
 * Integration tests — §OSADE Prompt 1: Context repository persistence (§6 + §7).
 *
 * Verifies that context repos survive db close/reopen (they are in chat_context table,
 * not renderer state). Uses a durable SQLite file (not :memory:) to prove the round-trip.
 *
 * §6: primary repo A + context repo B → agent receives both contexts
 * §7: reload → B remains attached
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let openDb: typeof import('../../src/db/index.js').openDb;
let listChatContext: typeof import('../../src/domain/chat-context.js').listChatContext;
let attachContextRepo: typeof import('../../src/domain/chat-context.js').attachContextRepo;
let detachContextRepo: typeof import('../../src/domain/chat-context.js').detachContextRepo;
let contextManifestPath: typeof import('../../src/domain/chat-context.js').contextManifestPath;
let LaunchTask: typeof import('../../src/domain/launch-task.js').LaunchTask;
let toTaskView: typeof import('../../src/domain/task-view.js').toTaskView;

let dbAvailable = true;

try {
  const dbMod = await import('../../src/db/index.js');
  const probe = dbMod.openDb(':memory:');
  probe.close();
  const chatCtxMod = await import('../../src/domain/chat-context.js');
  const launchMod = await import('../../src/domain/launch-task.js');
  const taskViewMod = await import('../../src/domain/task-view.js');
  openDb = dbMod.openDb;
  listChatContext = chatCtxMod.listChatContext;
  attachContextRepo = chatCtxMod.attachContextRepo;
  detachContextRepo = chatCtxMod.detachContextRepo;
  contextManifestPath = chatCtxMod.contextManifestPath;
  LaunchTask = launchMod.LaunchTask;
  toTaskView = taskViewMod.toTaskView;
} catch {
  dbAvailable = false;
}

const NOW = 1_756_000_000_000;

type Db = ReturnType<typeof openDb>;

let dir: string;
let home: string;
let dbPath: string;
let primaryRepo: string;
let contextRepo: string;
let db: Db;
let launcher: InstanceType<typeof LaunchTask>;

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function initRepo(name: string, file: string): string {
  const path = join(dir, name);
  sh(dir, ['init', '-q', '-b', 'main', name]);
  writeFileSync(join(path, file), `${name}\n`);
  sh(path, ['add', '-A']);
  sh(path, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  return path;
}

function fakeSubstrate() {
  return { async request(): Promise<unknown> { return {}; } };
}

function fakeSubscriber() {
  return { watchPane() {}, unwatchPane() {} };
}

beforeEach(() => {
  if (!dbAvailable) return;
  dir = mkdtempSync(join(tmpdir(), 'osade-ctx-'));
  home = join(dir, 'home');
  process.env.OSADE_HOME = home;
  dbPath = join(home, 'osade.db');
  primaryRepo = initRepo('primary', 'index.ts');
  contextRepo = initRepo('context-b', 'api.ts');
  db = openDb(dbPath);
  launcher = new LaunchTask(
    db,
    fakeSubstrate() as never,
    fakeSubscriber() as never,
    { now: () => NOW },
  );
});

afterEach(() => {
  if (!dbAvailable) return;
  try { db?.close(); } catch { /* already closed */ }
  delete process.env.OSADE_HOME;
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch { /* leave for OS */ }
});

describe('§6 — context repository: agent receives both A and B', () => {
  it.skipIf(!dbAvailable)(
    'attached context repo appears in listChatContext and contextRepos on TaskView',
    async () => {
      const chat = await launcher.createTask({
        repoPath: primaryRepo,
        title: 'Inspect both repos',
        intent: 'inspect A and B',
        agentId: 'claude',
      });
      const ctxRepoId = await launcher.ensureRepo(contextRepo);

      attachContextRepo(db, chat.taskId, ctxRepoId, NOW);

      const context = listChatContext(db, chat.taskId);
      expect(context).toHaveLength(1);
      expect(context[0]!.path).toBe(contextRepo);
      expect(context[0]!.access).toBe('read');

      const view = toTaskView(db, chat.taskId, NOW);
      expect(view?.contextRepos).toHaveLength(1);
      expect(view?.contextRepos?.[0]?.repoId).toBe(ctxRepoId);
    },
  );

  it.skipIf(!dbAvailable)(
    'primary repo is not included in context list (it is on the task itself)',
    async () => {
      const chat = await launcher.createTask({
        repoPath: primaryRepo,
        title: 'Only primary',
        intent: 'edit here',
        agentId: 'claude',
      });
      const primaryId = await launcher.ensureRepo(primaryRepo);

      // Attaching the primary repo must be rejected
      expect(() => attachContextRepo(db, chat.taskId, primaryId, NOW)).toThrow(
        /primary repository/,
      );
      expect(listChatContext(db, chat.taskId)).toHaveLength(0);
    },
  );

  it.skipIf(!dbAvailable)('context manifest file is written with correct access levels', async () => {
    const chat = await launcher.createTask({
      repoPath: primaryRepo,
      title: 'manifest check',
      intent: 'inspect both',
      agentId: 'claude',
    });
    const ctxId = await launcher.ensureRepo(contextRepo);
    attachContextRepo(db, chat.taskId, ctxId, NOW);

    const manifestFile = contextManifestPath(chat.taskId);
    expect(existsSync(manifestFile)).toBe(true);

    const manifest = JSON.parse(
      readFileSync(manifestFile, 'utf8'),
    ) as {
      primary: { access: string; path: string };
      context: { access: string }[];
    };
    expect(manifest.primary.access).toBe('edit');
    expect(manifest.primary.path).toBe(primaryRepo);
    expect(manifest.context[0]!.access).toBe('read');
  });
});

describe('§7 — context repo persistence: B remains attached after reload', () => {
  it.skipIf(!dbAvailable)(
    'context repos survive db close and reopen',
    async () => {
      const chat = await launcher.createTask({
        repoPath: primaryRepo,
        title: 'persisted context',
        intent: 'inspect A and B',
        agentId: 'claude',
      });
      const ctxId = await launcher.ensureRepo(contextRepo);
      attachContextRepo(db, chat.taskId, ctxId, NOW);

      // Close the real db
      db.close();

      // Reopen from disk
      const dbReopened = openDb(dbPath);

      const context = listChatContext(dbReopened, chat.taskId);
      expect(context).toHaveLength(1);
      expect(context[0]!.path).toBe(contextRepo);
      expect(context[0]!.access).toBe('read');

      const view = toTaskView(dbReopened, chat.taskId, NOW);
      expect(view?.contextRepos?.[0]?.repoId).toBe(ctxId);

      dbReopened.close();
    },
  );

  it.skipIf(!dbAvailable)('detached context repo does not reappear after reload', async () => {
    const chat = await launcher.createTask({
      repoPath: primaryRepo,
      title: 'detach test',
      intent: 'inspect',
      agentId: 'claude',
    });
    const ctxId = await launcher.ensureRepo(contextRepo);
    attachContextRepo(db, chat.taskId, ctxId, NOW);
    detachContextRepo(db, chat.taskId, ctxId);

    db.close();
    const dbReopened = openDb(dbPath);
    expect(listChatContext(dbReopened, chat.taskId)).toHaveLength(0);
    dbReopened.close();
  });

  it.skipIf(!dbAvailable)(
    'CDC triggers fire on context attach so the renderer knows to refresh',
    async () => {
      const chat = await launcher.createTask({
        repoPath: primaryRepo,
        title: 'cdc test',
        intent: 'check cdc',
        agentId: 'claude',
      });
      const ctxId = await launcher.ensureRepo(contextRepo);

      const logsBefore = (
        db.prepare(`SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'chat_context'`).get() as {
          n: number;
        }
      ).n;

      attachContextRepo(db, chat.taskId, ctxId, NOW);

      const logsAfter = (
        db.prepare(`SELECT COUNT(*) AS n FROM change_log WHERE table_name = 'chat_context'`).get() as {
          n: number;
        }
      ).n;
      expect(logsAfter).toBeGreaterThan(logsBefore);
    },
  );
});
