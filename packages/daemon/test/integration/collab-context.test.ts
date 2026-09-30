import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import { getTask } from '../../src/db/task-repo.js';
import { listTurns } from '../../src/domain/chat-turns.js';
import {
  asksForSiblingWork,
  collabAgentIds,
  composeAgentPrompt,
  promptWithCollab,
  stripMachineContext,
} from '../../src/domain/collab-context.js';
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
  dir = mkdtempSync(join(tmpdir(), 'osade-collab-'));
  process.env.OSADE_HOME = join(dir, 'home');
  repo = join(dir, 'repo');
  sh(dir, ['init', '-q', '-b', 'main', 'repo']);
  writeFileSync(join(repo, 'README.md'), '# auth\n');
  writeFileSync(join(repo, 'gone.ts'), 'export const old = true;\n');
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

describe('collab agent selection', () => {
  it('names the sibling the user asked about, including every catalog id', () => {
    expect(collabAgentIds('review Claude’s changes', ['claude', 'codex', 'opencode', 'pi'])).toEqual([
      'claude',
    ]);
    expect(collabAgentIds('address Codex feedback', ['claude', 'codex'])).toEqual(['codex']);
    expect(collabAgentIds('review OpenCode’s patch', ['opencode', 'pi'])).toEqual(['opencode']);
    expect(collabAgentIds("look at Pi's diff", ['pi', 'claude'])).toEqual(['pi']);
  });

  it('includes every sibling when the ask is collective', () => {
    expect(asksForSiblingWork('review the other agents’ changes')).toBe(true);
    expect(collabAgentIds('review the other agents’ changes', ['claude', 'codex', 'pi'])).toEqual([
      'claude',
      'codex',
      'pi',
    ]);
  });

  it('ignores a status digest and independent work', () => {
    const text = '<osade_lanes>\n- claude on osade/x/claude: implementing\n</osade_lanes>\n\nwrite tests';
    expect(stripMachineContext(text)).toBe('write tests');
    expect(collabAgentIds(text, ['claude'])).toEqual([]);
    expect(collabAgentIds('fix the authentication bug', ['claude', 'codex'])).toEqual([]);
  });
});

describe('multi-agent collaboration', () => {
  it('one agent is one lane, and a second mention joins the same chat', async () => {
    const claude = await launcher.createTask({
      repoPath: repo,
      title: 'Auth bug',
      intent: 'fix the authentication bug',
      agentId: 'claude',
    });
    const only = getTask(db, claude.taskId)!;
    expect(only.chat_id).toBe(claude.taskId);
    expect(only.agent_id).toBe('claude');
    expect(claude.isolated).toBe(false);

    const codex = await launcher.createTask({
      repoPath: repo,
      title: 'Auth bug',
      intent: 'review Claude’s changes',
      chatId: claude.taskId,
      agentId: 'codex',
      isolate: true,
    });
    const review = getTask(db, codex.taskId)!;
    expect(review.chat_id).toBe(only.chat_id);
    expect(review.id).not.toBe(only.id);
    expect(review.agent_id).toBe('codex');
    expect(codex.isolated).toBe(true);
    expect(review.worktree_path).not.toBe(only.worktree_path);
  });

  it('keeps each reply on the lane that produced it', async () => {
    const claude = await launcher.createTask({
      repoPath: repo,
      title: 'Auth bug',
      intent: 'fix the authentication bug',
      agentId: 'claude',
    });
    const codex = await launcher.createTask({
      repoPath: repo,
      title: 'Auth bug',
      intent: 'review',
      chatId: claude.taskId,
      agentId: 'codex',
      isolate: true,
    });
    insertTurn(claude.taskId, 1, 'agent', 'Fixed auth.ts and added tests.');
    insertTurn(codex.taskId, 1, 'agent', 'The token check allows empty secrets.');
    expect(listTurns(db, claude.taskId).map((t) => t.text)).toEqual(['Fixed auth.ts and added tests.']);
    expect(listTurns(db, codex.taskId).map((t) => t.text)).toEqual([
      'The token check allows empty secrets.',
    ]);
    expect(listTurns(db, claude.taskId)[0]!.task_id).toBe(claude.taskId);
    expect(listTurns(db, codex.taskId)[0]!.task_id).toBe(codex.taskId);
  });

  it('gives Codex Claude’s real patch, and leaves a lone agent prompt untouched', async () => {
    const claude = await launcher.createTask({
      repoPath: repo,
      title: 'Auth bug',
      intent: 'fix the authentication bug',
      agentId: 'claude',
    });
    writeFileSync(join(repo, 'README.md'), '# auth\nfixed the header check\n');
    writeFileSync(join(repo, 'auth.ts'), 'export function login() { return true; }\n');
    unlinkSync(join(repo, 'gone.ts'));
    sh(repo, ['add', 'README.md', 'gone.ts']);
    sh(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'fix auth header']);

    const alone = await composeAgentPrompt(db, claude.taskId, 'fix the authentication bug');
    expect(alone).toBe('fix the authentication bug');

    const codex = await launcher.createTask({
      repoPath: repo,
      title: 'Auth bug',
      intent: 'review',
      chatId: claude.taskId,
      agentId: 'codex',
      isolate: true,
    });
    const unrelated = await composeAgentPrompt(db, codex.taskId, 'write a migration');
    expect(unrelated).toBe('write a migration');
    expect(unrelated).not.toContain('auth.ts');

    const review = await composeAgentPrompt(db, codex.taskId, 'review Claude’s changes');
    expect(review).toContain('<osade_collab>');
    expect(review).toContain('review Claude’s changes');
    expect(review).toContain('auth.ts');
    expect(review).toContain('added');
    expect(review).toContain('README.md');
    expect(review).toContain('modified');
    expect(review).toContain('gone.ts');
    expect(review).toContain('deleted');
    expect(review).toContain('```diff');
    expect(review).toContain('fix auth header');
    expect(review).toContain(repo);
    expect(review).not.toContain('<osade_lanes>');
    expect(review).not.toMatch(/implementing|checks passing/);
    expect(review).toContain('export function login()');
    expect(review).toContain('fixed the header check');

    insertTurn(codex.taskId, 1, 'user', 'review Claude’s changes', 'sending');
    let handed = '';
    await promptWithCollab(db, codex.taskId, 'review Claude’s changes', async (full) => {
      handed = full;
    });
    expect(handed).toContain('export function login()');
    expect(handed).toContain('diff --git');
    const stored = listTurns(db, codex.taskId).find((t) => t.role === 'user');
    expect(stored?.text).toBe(handed);
    expect(stored?.text).toContain('gone.ts');
  });

  it('passes Codex’s reply back when Claude is asked to address the feedback', async () => {
    const claude = await launcher.createTask({
      repoPath: repo,
      title: 'Auth bug',
      intent: 'fix the authentication bug',
      agentId: 'claude',
    });
    const codex = await launcher.createTask({
      repoPath: repo,
      title: 'Auth bug',
      intent: 'review',
      chatId: claude.taskId,
      agentId: 'codex',
      isolate: true,
    });
    insertTurn(codex.taskId, 1, 'agent', 'The token check allows empty secrets.');
    const prompt = await composeAgentPrompt(db, claude.taskId, 'address Codex’s feedback');
    expect(prompt).toContain('The token check allows empty secrets.');
    expect(prompt).toContain('codex');
    expect(prompt).toContain('address Codex’s feedback');
    expect(prompt).not.toContain('<osade_lanes>');
  });
});

function insertTurn(
  taskId: string,
  seq: number,
  role: 'user' | 'agent',
  text: string,
  delivery = 'accepted',
): void {
  db.prepare(
    `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(`ct_${taskId}_${seq}_${role}`, taskId, seq, role, role === 'user' ? 'human' : 'provider', text, delivery, NOW);
}
