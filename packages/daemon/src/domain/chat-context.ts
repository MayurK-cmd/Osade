import { existsSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, delimiter, dirname, isAbsolute, relative, resolve, win32 } from 'node:path';

import type { Db } from '../db/index.js';
import { getTask } from '../db/task-repo.js';
import { taskCwd } from './cwd.js';
import { currentBranch } from './git.js';
import { osadePaths } from '../paths.js';

/**
 * Multi-repo context for one chat.
 *
 * The primary repository is the task's `repo_id` and stays editable.
 * Attached repositories are `chat_context` rows. This version only inserts `access = 'read'`.
 * Promoting one to `edit` (its own lane and worktree) is a later explicit step; nothing here
 * opens a pull request in a context repo.
 *
 * Osade's own writes go through `assertWritablePath`. The agent PTY runs as the user, so locking
 * the checkout with filesystem ACLs would also lock the user out of that repository.
 */

export type ContextAccess = 'read' | 'edit';

export interface ChatContextRepo {
  repoId: string;
  path: string;
  name: string;
  remote: string | null;
  branch: string;
  access: ContextAccess;
}

export class ContextReadOnlyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContextReadOnlyError';
  }
}

const SKIP = new Set(['.git', 'node_modules', 'dist', '.next', 'target', '__pycache__']);

export function listChatContext(db: Db, chatId: string): ChatContextRepo[] {
  const rows = db
    .prepare(
      `SELECT c.repo_id, c.access, r.path, r.default_branch, r.gh_owner, r.gh_name, r.upstream_remote
         FROM chat_context c
         JOIN repo r ON r.id = c.repo_id
        WHERE c.chat_id = ?
        ORDER BY c.created_at ASC`,
    )
    .all(chatId) as {
    repo_id: string;
    access: string;
    path: string;
    default_branch: string;
    gh_owner: string | null;
    gh_name: string | null;
    upstream_remote: string | null;
  }[];
  return rows.map((row) => ({
    repoId: row.repo_id,
    path: row.path,
    name: basename(row.path) || row.path,
    remote: remoteLabel(row),
    branch: row.default_branch,
    access: row.access === 'edit' ? 'edit' : 'read',
  }));
}

export function attachContextRepo(db: Db, chatId: string, repoId: string, now: number): ChatContextRepo {
  const primary = db
    .prepare(
      `SELECT repo_id FROM task WHERE chat_id = ? AND archived_at IS NULL ORDER BY created_at ASC LIMIT 1`,
    )
    .get(chatId) as { repo_id: string } | undefined;
  if (!primary) throw new Error('unknown chat');
  if (primary.repo_id === repoId) {
    throw new Error('Context repos must be different from this chat’s primary repository.');
  }
  const repo = db.prepare('SELECT id FROM repo WHERE id = ?').get(repoId);
  if (!repo) throw new Error('unknown repo');

  db.prepare(
    `INSERT INTO chat_context (chat_id, repo_id, access, created_at)
     VALUES (?, ?, 'read', ?)
     ON CONFLICT(chat_id, repo_id) DO NOTHING`,
  ).run(chatId, repoId, now);

  writeContextManifests(db, chatId);
  const attached = listChatContext(db, chatId).find((row) => row.repoId === repoId);
  if (!attached) throw new Error('could not attach context repo');
  return attached;
}

export function detachContextRepo(db: Db, chatId: string, repoId: string): void {
  db.prepare('DELETE FROM chat_context WHERE chat_id = ? AND repo_id = ?').run(chatId, repoId);
  writeContextManifests(db, chatId);
}

/** A read-mode context repo cannot become a lane of the same chat. */
export function assertCanEditRepo(db: Db, chatId: string, repoId: string): void {
  const row = db
    .prepare('SELECT access FROM chat_context WHERE chat_id = ? AND repo_id = ?')
    .get(chatId, repoId) as { access: string } | undefined;
  if (row?.access === 'read') {
    throw new ContextReadOnlyError(
      'That repository is attached to this chat as read-only context. Edits stay in the primary repository.',
    );
  }
}

/**
 * Reject a write whose target sits inside a read-only context checkout for this task's chat.
 * The primary checkout is not in `chat_context`, so its files stay writable.
 */
export function assertWritablePath(db: Db, taskId: string, targetPath: string): void {
  const task = getTask(db, taskId);
  if (!task) throw new Error('unknown task');
  const target = canonicalize(targetPath);
  for (const repo of listChatContext(db, task.chat_id)) {
    if (repo.access !== 'read') continue;
    if (isInside(canonicalize(repo.path), target)) {
      throw new ContextReadOnlyError(
        `${repo.name} is a read-only context repository for this chat (${repo.path}).`,
      );
    }
  }
}

export function contextManifestPath(taskId: string): string {
  return resolve(osadePaths().root, 'tasks', taskId, 'context-repos.json');
}

export function writeContextManifests(db: Db, chatId: string): void {
  const context = listChatContext(db, chatId);
  const tasks = db
    .prepare(
      `SELECT id, repo_id, worktree_path FROM task
        WHERE chat_id = ? AND archived_at IS NULL`,
    )
    .all(chatId) as { id: string; repo_id: string; worktree_path: string | null }[];
  for (const task of tasks) {
    const repo = db.prepare('SELECT path FROM repo WHERE id = ?').get(task.repo_id) as
      | { path: string }
      | undefined;
    if (!repo) continue;
    const dest = contextManifestPath(task.id);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(
      dest,
      JSON.stringify(
        {
          primary: {
            repoId: task.repo_id,
            path: task.worktree_path ?? repo.path,
            access: 'edit',
          },
          context,
        },
        null,
        2,
      ),
      'utf8',
    );
  }
}

/** Prompt block built from daemon rows, plus a live branch and a top-level listing. */
export async function contextPromptBlock(db: Db, taskId: string): Promise<string> {
  const task = getTask(db, taskId);
  if (!task) return '';
  const repos = listChatContext(db, task.chat_id);
  if (repos.length === 0) return '';
  const primary = db.prepare('SELECT path, default_branch FROM repo WHERE id = ?').get(task.repo_id) as
    | { path: string; default_branch: string }
    | undefined;
  if (!primary) return '';
  const cwd = taskCwd(task, primary.path);
  const lines = [
    '<osade_context>',
    'Repositories for this chat, from Osade (not a hint pasted by the window):',
    `Primary (editable): ${basename(primary.path) || primary.path}`,
    `  path: ${cwd}`,
    `  branch: ${await liveBranch(cwd, task.branch || primary.default_branch)}`,
    `  access: edit`,
    'Context (read-only for this chat):',
  ];
  for (const repo of repos) {
    lines.push(`- ${repo.name} (${repo.repoId})`);
    lines.push(`  path: ${repo.path}`);
    lines.push(`  branch: ${await liveBranch(repo.path, repo.branch)}`);
    lines.push(`  access: ${repo.access}`);
    if (repo.remote) lines.push(`  remote: ${repo.remote}`);
    const names = topLevel(repo.path);
    if (names.length > 0) lines.push(`  entries: ${names.join(', ')}`);
  }
  lines.push(`Manifest: ${contextManifestPath(task.id)}`);
  lines.push('Read context checkouts in place. Do not edit them, commit in them, or open a lane against them from this chat.');
  lines.push('Edits, diffs, and checks stay in the primary checkout above.');
  lines.push('</osade_context>');
  return lines.join('\n');
}

export function contextRepoPaths(db: Db, chatId: string): string[] {
  return listChatContext(db, chatId).map((repo) => repo.path);
}

/** Set on the lane when it is created. Later attachments arrive through the prompt and manifest. */
export function contextEnv(db: Db, chatId: string): Record<string, string> {
  const paths = contextRepoPaths(db, chatId);
  if (paths.length === 0) return {};
  return { OSADE_CONTEXT_REPOS: paths.join(delimiter) };
}

function remoteLabel(row: {
  gh_owner: string | null;
  gh_name: string | null;
  upstream_remote: string | null;
}): string | null {
  if (row.gh_owner && row.gh_name) return `${row.gh_owner}/${row.gh_name}`;
  return row.upstream_remote;
}

async function liveBranch(cwd: string, fallback: string): Promise<string> {
  if (!existsSync(cwd)) return fallback;
  try {
    return await currentBranch(cwd);
  } catch {
    return fallback;
  }
}

function topLevel(cwd: string): string[] {
  if (!existsSync(cwd)) return [];
  try {
    return readdirSync(cwd, { withFileTypes: true })
      .filter((entry) => !SKIP.has(entry.name))
      .slice(0, 40)
      .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  } catch {
    return [];
  }
}

function canonicalize(path: string): string {
  const resolved = resolve(path);
  let real = resolved;
  try {
    if (existsSync(resolved)) real = realpathSync(resolved);
  } catch {
    real = resolved;
  }
  return process.platform === 'win32' ? win32.normalize(real).toLowerCase() : real;
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === '') return true;
  return !rel.startsWith('..') && !isAbsolute(rel);
}
