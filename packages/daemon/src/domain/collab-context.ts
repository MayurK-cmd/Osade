import type { Db } from '../db/index.js';
import { getAgentFact, getTask } from '../db/task-repo.js';
import { agentDisplayName } from './agent-catalog.js';
import { contextPromptBlock } from './chat-context.js';
import { taskCwd } from './cwd.js';
import { listWorkingChanges, parseNameStatus, readChangeDiff, type WorkingChange } from './files.js';
import { git } from './git.js';

/**
 * Cross-lane review context.
 *
 * Each lane keeps its own checkout. When a follow-up asks about another agent's work, the
 * receiving prompt gets that lane's real diff, file list, commits, and latest reply. The
 * status digest (`<osade_lanes>`) is not this — it has no patch.
 */

const OPEN = '<osade_collab>';
const CLOSE = '</osade_collab>';

const MAX_DIFF_CHARS = 24_000;
const MAX_REPLY_CHARS = 6_000;
const MAX_FILES = 80;

const REVIEW_ASK = /\b(review|reviews|reviewing|feedback|findings|comments)\b/iu;
const CHANGE_ASK = /\b(changes|change|diff|patch|work|edits|edit)\b/iu;

export function stripMachineContext(text: string): string {
  return text
    .replace(/<osade_lanes>[\s\S]*?<\/osade_lanes>\s*/g, '')
    .replace(/<osade_collab>[\s\S]*?<\/osade_collab>\s*/g, '')
    .trim();
}

export function asksForSiblingWork(text: string): boolean {
  const body = stripMachineContext(text);
  if (REVIEW_ASK.test(body) && CHANGE_ASK.test(body)) return true;
  if (/\b(address|apply|respond to|incorporate|fix)\b/iu.test(body) && REVIEW_ASK.test(body)) return true;
  if (/\b(their|other agents?|siblings?)\b/iu.test(body) && (CHANGE_ASK.test(body) || REVIEW_ASK.test(body))) {
    return true;
  }
  return false;
}

/** Sibling agent ids the prompt is about. Empty when this turn is independent work. */
export function collabAgentIds(
  userText: string,
  siblingIds: readonly string[],
): string[] {
  const body = stripMachineContext(userText);
  const named = siblingIds.filter((id) => new RegExp(`\\b${escapeRegExp(id)}\\b`, 'iu').test(body));
  if (named.length > 0) return named;
  if (asksForSiblingWork(userText)) return [...siblingIds];
  return [];
}

export async function composeAgentPrompt(db: Db, taskId: string, text: string): Promise<string> {
  const body = text.replace(/<osade_context>[\s\S]*?<\/osade_context>\s*/g, '').trim();
  let withCollab = body;
  if (!body.includes(OPEN)) {
    try {
      const block = await collabBlock(db, taskId, body);
      if (block) withCollab = `${block}\n\n${body}`;
    } catch {
      withCollab = body;
    }
  }
  try {
    const context = await contextPromptBlock(db, taskId);
    if (!context) return withCollab;
    return `${context}\n\n${withCollab}`;
  } catch {
    return withCollab;
  }
}

/**
 * Build the snapshot at dispatch time and hand that exact string to the agent.
 * The stored user turn is updated to the same string so pane-delta can strip the echo.
 */
export async function promptWithCollab(
  db: Db,
  taskId: string,
  text: string,
  prompt: (full: string) => Promise<void>,
): Promise<void> {
  const full = await composeAgentPrompt(db, taskId, text);
  if (full !== text) {
    db.prepare(
      `UPDATE chat_turn SET text = ?
         WHERE task_id = ? AND role = 'user' AND delivery = 'sending' AND text = ?`,
    ).run(full, taskId, text);
  }
  await prompt(full);
}

async function collabBlock(db: Db, taskId: string, userText: string): Promise<string | null> {
  const self = getTask(db, taskId);
  if (!self) return null;
  const siblings = db
    .prepare(
      `SELECT id FROM task
         WHERE chat_id = ? AND id != ? AND archived_at IS NULL
         ORDER BY created_at ASC`,
    )
    .all(self.chat_id, self.id) as { id: string }[];
  if (siblings.length === 0) return null;

  const byAgent = new Map<string, string>();
  for (const row of siblings) {
    const task = getTask(db, row.id);
    if (!task?.agent_id) continue;
    if (!byAgent.has(task.agent_id)) byAgent.set(task.agent_id, task.id);
  }
  const wanted = collabAgentIds(userText, [...byAgent.keys()]);
  if (wanted.length === 0) return null;

  const sections: string[] = [];
  let budget = MAX_DIFF_CHARS;
  for (const agentId of wanted) {
    const id = byAgent.get(agentId);
    if (!id) continue;
    const section = await siblingSection(db, id, budget);
    if (!section) continue;
    sections.push(section.text);
    budget = section.budget;
  }
  if (sections.length === 0) return null;

  return [
    OPEN,
    'Read-only work from other agents in this chat. Their checkouts stay isolated — do not edit those paths.',
    'Use the file list, diff, commits, and reply below. This is the actual patch, not a status line.',
    '',
    ...sections,
    CLOSE,
  ].join('\n');
}

async function siblingSection(
  db: Db,
  taskId: string,
  budget: number,
): Promise<{ text: string; budget: number } | null> {
  const task = getTask(db, taskId);
  if (!task) return null;
  const repo = db.prepare('SELECT path FROM repo WHERE id = ?').get(task.repo_id) as
    | { path: string }
    | undefined;
  if (!repo) return null;

  const cwd = taskCwd(task, repo.path);
  const reply = latestReply(db, taskId);
  let snap: Snap | null = null;
  try {
    snap = await readSnap(cwd, task.base_sha);
  } catch {
    snap = null;
  }
  const files = snap?.files ?? [];
  const commits = snap?.commits ?? [];
  if (files.length === 0 && commits.length === 0 && reply.length === 0) return null;

  const agentId = task.agent_id ?? 'agent';
  const lines = [
    `## ${agentDisplayName(agentId)} (${agentId})`,
    `branch: ${task.branch}`,
    `base: ${task.base_ref} @ ${task.base_sha.slice(0, 12)}`,
    `checkout: ${cwd}`,
    snap?.head ? `head: ${snap.head}` : null,
  ].filter((line): line is string => line != null);

  if (commits.length > 0) {
    lines.push('commits:');
    for (const commit of commits.slice(0, 20)) {
      lines.push(`- ${commit.sha} ${commit.subject}`);
    }
  }

  if (files.length > 0) {
    lines.push('changed files:');
    for (const file of files.slice(0, MAX_FILES)) {
      lines.push(`- ${file.path}  ${flagLabel(file.flag)}  +${file.insertions} -${file.deletions}`);
    }
    if (files.length > MAX_FILES) lines.push(`- … ${files.length - MAX_FILES} more files`);
  }

  let nextBudget = budget;
  if (snap && snap.diff.trim().length > 0 && budget > 0) {
    const raw = escapeClose(snap.diff.trim());
    const taken = raw.slice(0, budget);
    nextBudget = budget - taken.length;
    lines.push('diff:');
    lines.push('```diff');
    lines.push(taken);
    if (taken.length < raw.length) lines.push('… diff truncated …');
    lines.push('```');
  } else if (files.length > 0) {
    lines.push('diff: (unavailable)');
  }

  if (reply.length > 0) {
    lines.push('latest reply:');
    lines.push(escapeClose(reply));
  }

  return { text: lines.join('\n'), budget: nextBudget };
}

interface Snap {
  files: WorkingChange[];
  commits: { sha: string; subject: string }[];
  diff: string;
  head: string;
}

async function readSnap(cwd: string, baseSha: string): Promise<Snap> {
  const listed = await listWorkingChanges(cwd, baseSha);
  const named = await git(cwd, ['diff', '--name-status', '--find-renames', baseSha]).catch(() => '');
  const files = labelFiles(listed.files, named);
  let diff = await git(cwd, ['diff', '--find-renames', baseSha]).catch(() => '');
  for (const file of files) {
    if (file.flag !== '?') continue;
    const part = await readChangeDiff(cwd, file.path, 'working', baseSha).catch(() => null);
    if (!part?.diff) continue;
    diff += diff.endsWith('\n') || diff.length === 0 ? '' : '\n';
    diff += `${part.diff}\n`;
  }
  const head = (await git(cwd, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim();
  return {
    files,
    commits: listed.outgoing?.commits ?? [],
    diff,
    head,
  };
}

function latestReply(db: Db, taskId: string): string {
  const turn = db
    .prepare(
      `SELECT text FROM chat_turn
         WHERE task_id = ? AND role = 'agent' AND delivery = 'accepted'
         ORDER BY seq DESC LIMIT 1`,
    )
    .get(taskId) as { text: string } | undefined;
  const fact = getAgentFact(db, taskId);
  const text = (turn?.text ?? fact?.final_message ?? '').trim();
  if (text.length === 0) return '';
  const clipped = text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS)}\n… reply truncated …` : text;
  return clipped;
}

function labelFiles(files: WorkingChange[], nameStatus: string): WorkingChange[] {
  const labeled = new Map(parseNameStatus(nameStatus, new Map()).map((file) => [file.path, file.flag]));
  return files.map((file) => ({
    ...file,
    flag: file.flag === '?' ? '?' : (labeled.get(file.path) ?? file.flag),
  }));
}

function flagLabel(flag: WorkingChange['flag']): string {
  if (flag === 'A' || flag === '?') return 'added';
  if (flag === 'D') return 'deleted';
  return 'modified';
}

function escapeClose(text: string): string {
  return text.replaceAll(CLOSE, '<\\/osade_collab>');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
