import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import { getTask } from '../../src/db/task-repo.js';
import { isAttached, taskCwd } from '../../src/domain/cwd.js';
import { LaunchTask } from '../../src/domain/launch-task.js';
import type { SubstrateClient } from '../../src/substrate/client.js';
import type { SubstrateEventSubscriber } from '../../src/substrate/event-subscriber.js';

const NOW = 1_756_000_000_000;

let dir: string;
let repo: string;
let db: Db;
let launcher: LaunchTask;

function sh(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'osade-attached-'));
  process.env.OSADE_HOME = join(dir, 'home');
  repo = join(dir, 'repo');
  sh(dir, ['init', '-q', '-b', 'main', 'repo']);
  writeFileSync(join(repo, 'README.md'), '# x\n');
  sh(repo, ['add', '-A']);
  sh(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init']);
  db = openDb(':memory:');
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

describe('attached lanes', () => {
  it('a new chat is attached: no worktree path, branch is the checkout', async () => {
    const created = await launcher.createTask({
      repoPath: repo,
      title: 'New chat',
      intent: 'hi',
    });
    const task = getTask(db, created.taskId)!;
    expect(created.isolated).toBe(false);
    expect(task.worktree_path).toBeNull();
    expect(isAttached(task)).toBe(true);
    expect(task.branch).toBe('main');
    expect(taskCwd(task, repo)).toBe(repo);
  });

  it('a second chat in the same repo is forced isolated', async () => {
    const first = await launcher.createTask({ repoPath: repo, title: 'One', intent: 'a' });
    const second = await launcher.createTask({ repoPath: repo, title: 'Two', intent: 'b' });
    expect(first.isolated).toBe(false);
    expect(second.isolated).toBe(true);
    expect(second.isolatedBecause?.title).toBe('One');
    const a = getTask(db, first.taskId)!;
    const b = getTask(db, second.taskId)!;
    expect(a.worktree_path).toBeNull();
    expect(b.worktree_path).toBeTruthy();
    expect(b.branch).toMatch(/^osade\//);
  });

  it('isolate: true always creates a worktree even when the slot is free', async () => {
    const created = await launcher.createTask({
      repoPath: repo,
      title: 'Token refresh',
      intent: 'fix it',
      isolate: true,
    });
    const task = getTask(db, created.taskId)!;
    expect(created.isolated).toBe(true);
    expect(created.isolatedBecause).toBeUndefined();
    expect(task.worktree_path).toBeTruthy();
    expect(task.branch).toBe('osade/token-refresh/claude');
  });
});
