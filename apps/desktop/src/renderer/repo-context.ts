import type { TaskView } from '@osade/contract';

export interface ContextRepo {
  repoId: string;
  path: string;
  name: string;
}

/** Context repos for a chat, from the daemon snapshot rather than window state. */
export function contextReposForChat(tasks: readonly TaskView[], chatId: string): ContextRepo[] {
  const lane = tasks.find((task) => (task.chatId || task.task.chat_id) === chatId);
  return (lane?.contextRepos ?? []).map((repo) => ({
    repoId: repo.repoId,
    path: repo.path,
    name: repo.name,
  }));
}

const CONTEXT_BLOCK =
  /<osade_context>[\s\S]*?<\/osade_context>\s*/g;

/** Strip the read-only context block from visible chat text. */
export function stripContextBlock(text: string): string {
  return text.replace(CONTEXT_BLOCK, '').trim();
}

export function formatReadOnlyContextBlock(opts: {
  primaryWorktree: string;
  contextRepos: readonly Pick<ContextRepo, 'path' | 'name'>[];
}): string {
  if (opts.contextRepos.length === 0) return '';
  const lines = [
    '<osade_context>',
    'Read-only context repositories (do not edit these paths):',
    ...opts.contextRepos.map((repo) => `- ${repo.name}: ${repo.path}`),
    '',
    `All edits must happen only in the primary worktree: ${opts.primaryWorktree}`,
    'Context repositories are read-only reference; agents must not create tasks, worktrees, or diffs there.',
    '</osade_context>',
  ];
  return lines.join('\n');
}

export function withReadOnlyContext(prompt: string, block: string): string {
  const body = prompt.trim();
  const ctx = block.trim();
  if (ctx.length === 0) return body;
  if (body.length === 0) return ctx;
  return `${ctx}\n\n${body}`;
}
