import { useState, type JSX } from 'react';

import { api } from './api.js';

/**
 * Start a task without leaving the window.
 *
 * Until now the empty state told you to go and type `osade task create` in a terminal, which is
 * a strange thing for an application to say — §17's point is that the CLI and the UI are the
 * *same* surface, not that the UI is a viewer for work begun elsewhere.
 *
 * Two fields, because two is what the daemon needs: a repository, and what you want done. The
 * title is derived from the instruction rather than asked for separately — nobody wants to name
 * a task and then describe it.
 *
 * Creating does **not** start an agent. §8.2's launch is a separate, deliberate act, and a
 * button that quietly spawned a process would be the wrong lesson to teach on first use.
 */
export function NewTask({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (taskId: string) => void;
}): JSX.Element {
  const [repoPath, setRepoPath] = useState('');
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = repoPath.trim().length > 0 && intent.trim().length > 0;

  function create(): void {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);

    void api
      .taskCreate({ repoPath: repoPath.trim(), title: titleFrom(intent), intent: intent.trim() })
      .then((result) => onCreated(result.taskId))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <section
      style={{
        padding: '18px 22px 20px',
        borderBottom: '1px solid var(--rule)',
        background: 'var(--field)',
      }}
    >
      <h2 style={{ margin: '0 0 12px', fontSize: 'var(--t-m)', fontWeight: 600 }}>New task</h2>

      <label style={{ display: 'block', marginBottom: 12 }}>
        <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>
          Repository
        </span>
        <input
          className="mono"
          autoFocus
          value={repoPath}
          placeholder="/path/to/the/repository"
          onChange={(event) => setRepoPath(event.target.value)}
          onKeyDown={(event) => event.key === 'Escape' && onClose()}
        />
        <span
          style={{
            display: 'block',
            marginTop: 4,
            color: 'var(--ink-soft)',
            fontSize: 'var(--t-xs)',
          }}
        >
          A git repository already on this machine. Osade works in its own worktree and never
          touches your checkout.
        </span>
      </label>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>
          What should the agent do?
        </span>
        <textarea
          rows={3}
          value={intent}
          placeholder="Fix the flaky retry test in the poller — it fails intermittently on slow machines."
          onChange={(event) => setIntent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            // Enter for a newline, Cmd/Ctrl+Enter to commit — the instruction is prose and
            // wants to be more than one line.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) create();
          }}
        />
        <span
          style={{
            display: 'block',
            marginTop: 4,
            color: 'var(--ink-soft)',
            fontSize: 'var(--t-xs)',
          }}
        >
          Write it as you would to a contributor. Specific beats short.
        </span>
      </label>

      {error && (
        <p className="mono" style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
          {error}
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="primary" disabled={!ready || busy} onClick={create}>
          {busy ? 'Creating…' : 'Create task'}
        </button>
        <button onClick={onClose}>Cancel</button>
        <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
          Creates the task. You start the agent yourself.
        </span>
      </div>
    </section>
  );
}

/**
 * A short name from the instruction.
 *
 * The ledger needs something scannable on one line and people write instructions, not titles.
 * Taking the first sentence is a guess, but it is a guess that is right often enough to be worth
 * not asking a second question for.
 */
function titleFrom(intent: string): string {
  const firstSentence = intent.trim().split(/(?<=[.!?])\s/)[0] ?? intent.trim();
  const clean = firstSentence.replace(/\s+/g, ' ').replace(/[.\s]+$/, '');
  return clean.length > 72 ? `${clean.slice(0, 69).trimEnd()}…` : clean;
}
