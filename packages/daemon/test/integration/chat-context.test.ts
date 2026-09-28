import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import {
  ContextReadOnlyError,
  assertWritablePath,
  attachContextRepo,
  contextManifestPath,
  listChatContext,
} from '../../src/domain/chat-context.js';
import { composeAgentPrompt, promptWithCollab } from '../../src/domain/collab-context.js';
import { writeFile } from '../../src/domain/files.js';
import { LaunchTask } from '../../src/domain/launch-task.js';
import { toTaskView } from '../../src/domain/task-view.js';
import type { SubstrateClient } from '../../src/substrate/client.js';
import type { SubstrateEventSubscriber } from '../../src/substrate/event-subscriber.js';

const NOW = 1_756_000_000_000;

let dir: string;
let home: string;
let dbPath: string;
let frontend: string;
let backend: string;
let typesRepo: string;
let db: Db;
let launcher: LaunchTask;

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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'osade-repos-'));
  home = join(dir, 'home');
  process.env.OSADE_HOME = home;
  dbPath = join(home, 'osade.db');
  frontend = initRepo('frontend', 'App.tsx');
  backend = initRepo('backend', 'api.ts');
  typesRepo = initRepo('shared-types', 'types.ts');
  db = openDb(dbPath);
  launcher = new LaunchTask(
    db,
    { request: async () => ({}) } as unknown as SubstrateClient,
    { watchPane() {}, unwatchPane() {} } as unknown as SubstrateEventSubscriber,
    { now: () => NOW },
  );
});

afterEach(() => {
  db.close();
  delete process.env.OSADE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe('chat context repositories', () => {
  it('persists context repos, reloads them, and keeps the primary checkout editable', async () => {
    const chat = await launcher.createTask({
      repoPath: frontend,
      title: 'Fix frontend/API integration',
      intent: 'compare the API with the frontend',
      agentId: 'claude',
    });
    const backendRow = await launcher.ensureRepo(backend);
    const typesRow = await launcher.ensureRepo(typesRepo);
    const added = attachContextRepo(db, chat.taskId, backendRow, NOW);
    attachContextRepo(db, chat.taskId, typesRow, NOW + 1);
    expect(added.access).toBe('read');
    expect(added.path).toBe(backend);
    expect(listChatContext(db, chat.taskId).map((repo) => repo.name)).toEqual(['backend', 'shared-types']);

    const manifest = JSON.parse(readFileSync(contextManifestPath(chat.taskId), 'utf8')) as {
      primary: { access: string; path: string };
      context: { access: string; path: string }[];
    };
    expect(manifest.primary.access).toBe('edit');
    expect(manifest.primary.path).toBe(frontend);
    expect(manifest.context.map((repo) => repo.access)).toEqual(['read', 'read']);

    const prompt = 'compare the API in the backend with the frontend';
    const handed = await composeAgentPrompt(db, chat.taskId, prompt);
    expect(handed).toContain('<osade_context>');
    expect(handed).toContain(frontend);
    expect(handed).toContain(backend);
    expect(handed).toContain(typesRepo);
    expect(handed).toContain('api.ts');
    expect(handed).toContain('types.ts');
    expect(handed).toContain('access: read');
    expect(handed).toContain('access: edit');
    expect(handed.endsWith(prompt)).toBe(true);

    let sent = '';
    db.prepare(
      `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
       VALUES ('ct1', ?, 1, 'user', 'human', ?, 'sending', ?)`,
    ).run(chat.taskId, prompt, NOW);
    await promptWithCollab(db, chat.taskId, prompt, async (full) => {
      sent = full;
    });
    expect(sent).toContain(backend);
    expect(sent).toContain(typesRepo);
    expect(sent).toContain('api.ts');

    const again = await composeAgentPrompt(db, chat.taskId, 'find why the frontend and backend are incompatible');
    expect(again).toContain(backend);
    expect(again).toContain(typesRepo);

    assertWritablePath(db, chat.taskId, join(frontend, 'App.tsx'));
    writeFile(frontend, 'note.ts', 'export const ok = true;\n');
    expect(existsSync(join(frontend, 'note.ts'))).toBe(true);

    expect(() => assertWritablePath(db, chat.taskId, join(backend, 'api.ts'))).toThrow(ContextReadOnlyError);
    expect(() => assertWritablePath(db, chat.taskId, join(typesRepo, 'types.ts'))).toThrow(/read-only/);
    await expect(
      launcher.createTask({
        repoPath: backend,
        title: 'Fix frontend/API integration',
        intent: 'edit the API',
        chatId: chat.taskId,
        agentId: 'codex',
      }),
    ).rejects.toThrow(ContextReadOnlyError);

    db.close();
    db = openDb(dbPath);
    const reloaded = listChatContext(db, chat.taskId);
    expect(reloaded.map((repo) => repo.path)).toEqual([backend, typesRepo]);
    expect(reloaded.every((repo) => repo.access === 'read')).toBe(true);
    const view = toTaskView(db, chat.taskId, NOW);
    expect(view?.contextRepos?.map((repo) => repo.repoId)).toEqual([backendRow, typesRow]);
    expect(view?.contextRepos?.[0]?.remote).toBeNull();
    expect(view?.task.repo_id).not.toBe(backendRow);

    const fanout = db
      .prepare(`SELECT row_id FROM change_log WHERE table_name = 'chat_context' AND row_id = ?`)
      .all(chat.taskId) as { row_id: string }[];
    expect(fanout.length).toBeGreaterThan(0);
  });

  it('refuses to attach the primary repository as context', async () => {
    const chat = await launcher.createTask({
      repoPath: frontend,
      title: 'Only primary',
      intent: 'edit here',
      agentId: 'claude',
    });
    const primary = await launcher.ensureRepo(frontend);
    expect(() => attachContextRepo(db, chat.taskId, primary, NOW)).toThrow(/primary repository/);
    expect(listChatContext(db, chat.taskId)).toEqual([]);
  });
});
