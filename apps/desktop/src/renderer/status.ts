import type { TaskStatus } from '@osade/contract';

/**
 * What each status means, in the user's words — OSADE.md §19.4.
 *
 * The statuses are the daemon's vocabulary: `awaiting_approval`, `verify_failed`, `to_review`.
 * Accurate, and meaningless to someone watching agents work. This is the translation, and it is
 * the difference between a screen you can read and a screen you have to have written.
 *
 * Every status answers three questions, because those are the three a person actually has:
 *
 *   what is happening   — `label`, short enough for a row
 *   what does that mean — `meaning`, one sentence, no jargon
 *   what do I do        — `next`, or nothing when the honest answer is "wait"
 *
 * Tone is reserved for the two things worth interrupting someone over: needing them, and
 * failing. Everything else is quiet on purpose — a screen where everything is coloured is a
 * screen where nothing is.
 */

export type Tone = 'needs' | 'live' | 'fail' | 'rest' | 'done';

export interface StatusCopy {
  label: string;
  meaning: string;
  /** The action a person can take right now. Absent when the honest answer is "wait". */
  next?: string;
  tone: Tone;
}

export const STATUS: Record<TaskStatus, StatusCopy> = {
  awaiting_approval: {
    label: 'Needs your approval',
    meaning: 'An agent wants to do something public. Nothing leaves this machine until you say so.',
    next: 'Read what it wants to send, then approve or deny it.',
    tone: 'needs',
  },
  needs_input: {
    label: 'Waiting for you',
    meaning: 'The agent stopped to ask something and cannot continue until it is answered.',
    next: 'Reply in the composer, or open the terminal.',
    tone: 'needs',
  },
  review_changes_requested: {
    label: 'Changes requested',
    meaning: 'A reviewer asked for changes on the pull request. The agent has been given their exact words.',
    next: 'Watch, or write in the composer to steer it.',
    tone: 'needs',
  },
  awaiting_review: {
    label: 'Ready for you to look',
    meaning: 'The agent thinks it is finished. Nothing has been published.',
    next: 'Read the diff, then open a pull request when you are happy.',
    tone: 'needs',
  },
  implementing: {
    label: 'Working',
    meaning: 'Writing code in its own worktree. Your checkout is untouched.',
    tone: 'live',
  },
  verifying: {
    label: 'Checking its work',
    meaning: 'Running this project’s own tests and checks before asking you to look.',
    tone: 'live',
  },
  verify_failed: {
    label: 'Checks failed',
    meaning: 'The work did not pass. The agent has been told what broke and is trying again.',
    tone: 'fail',
  },
  ci_failed: {
    label: 'CI failed',
    meaning: 'GitHub’s checks failed on the pull request.',
    next: 'Read the failure on GitHub, or let the agent try again.',
    tone: 'fail',
  },
  pr_open: {
    label: 'Pull request open',
    meaning: 'Published and waiting on the project’s maintainers.',
    tone: 'rest',
  },
  queued: {
    label: 'Not started',
    meaning: 'Created, with a worktree ready. No agent is running yet.',
    next: 'Start it when you are ready.',
    tone: 'rest',
  },
  idle: {
    label: 'Idle',
    meaning: 'Nothing is happening on this task right now.',
    tone: 'rest',
  },
  stopped: {
    label: 'Stopped',
    meaning: 'The agent’s process ended. Its work is still in the worktree.',
    tone: 'rest',
  },
  merged: {
    label: 'Merged',
    meaning: 'This landed upstream.',
    tone: 'done',
  },
  archived: {
    label: 'Archived',
    meaning: 'Hidden from the ledger. Nothing was deleted.',
    tone: 'done',
  },
};

/**
 * §19.3 — a fixed-width, fixed-position gutter, so the needs-you set scans peripherally without
 * being read. The flag is the only glyph that means "stop and look".
 */
export const GLYPH: Record<Tone, string> = {
  needs: '⚑',
  live: '●',
  fail: '✗',
  rest: '○',
  done: '✓',
};

export const TONE_COLOUR: Record<Tone, string> = {
  needs: 'var(--st-needs)',
  live: 'var(--st-live)',
  fail: 'var(--st-fail)',
  rest: 'var(--st-rest)',
  done: 'var(--st-rest)',
};

/**
 * How long ago, in the units a person would say out loud.
 *
 * Exact timestamps are for a log. What matters on this screen is whether something has been
 * waiting for a minute or since yesterday.
 */
export function ago(at: number | null | undefined, now = Date.now()): string {
  if (at == null) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'Just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/** A one-line summary of the whole ledger, for the header. */
export function summarise(counts: { needsYou: number; working: number; total: number }): string {
  if (counts.total === 0) return 'Nothing running';

  const parts: string[] = [];
  if (counts.working > 0) parts.push(`${counts.working} working`);
  if (counts.needsYou > 0) {
    parts.push(`${counts.needsYou} ${counts.needsYou === 1 ? 'task needs' : 'tasks need'} you`);
  }
  if (parts.length === 0) return `${counts.total} ${counts.total === 1 ? 'task' : 'tasks'} · idle`;
  return parts.join(' · ');
}
