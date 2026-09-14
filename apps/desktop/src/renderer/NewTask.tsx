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
  repoPath: initialRepo = '',
  onClose,
  onCreated,
}: {
  /** Prefilled when the window was opened on a repository — `osade .` already answered this. */
  repoPath?: string;
  onClose: () => void;
  onCreated: (taskId: string) => void;
}): JSX.Element {
  const [repoPath, setRepoPath] = useState(initialRepo);
  const [intent, setIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  /** The repository a chosen folder resolved to, once the daemon has said which one it is. */
  const [chosenRepo, setChosenRepo] = useState<string | null>(null);

  // Only inside the app: a plain browser has no folder picker to call.
  const canChoose = typeof window !== 'undefined' && Boolean(window.osade?.chooseRepository);
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

  /**
   * The operating system's folder picker, then the daemon's answer about what was picked.
   *
   * The daemon owns the git question: it resolves a subfolder to its repository's root, and a
   * folder that is not a repository fails here — where the person is looking — rather than at
   * "create task".
   */
  function chooseRepository(): void {
    const bridge = window.osade;
    if (!bridge || choosing) return;
    setChoosing(true);
    setError(null);

    void bridge
      .chooseRepository(repoPath.trim() || undefined)
      .then(async (folder) => {
        if (!folder) return;
        setRepoPath(folder);
        setChosenRepo(null);
        const repo = await api.repoOpen(folder);
        setRepoPath(repo.path);
        setChosenRepo(repo.slug ?? repo.name);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setChoosing(false));
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

      <div style={{ marginBottom: 12 }}>
        <label
          htmlFor="new-task-repository"
          style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}
        >
          Repository
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            id="new-task-repository"
            className="mono"
            autoFocus={initialRepo === '' && !canChoose}
            value={repoPath}
            // Short on purpose: the sidebar is narrow, and the button beside it already says
            // "choose folder".
            placeholder={canChoose ? 'Or paste a path' : '/path/to/the/repository'}
            style={{ minWidth: 0 }}
            onChange={(event) => {
              setRepoPath(event.target.value);
              setChosenRepo(null);
            }}
            onKeyDown={(event) => event.key === 'Escape' && onClose()}
          />
          {canChoose && (
            <button
              type="button"
              data-choose-repository
              autoFocus={initialRepo === ''}
              disabled={choosing}
              style={{ flexShrink: 0 }}
              onClick={chooseRepository}
              onKeyDown={(event) => event.key === 'Escape' && onClose()}
            >
              {choosing ? 'Opening…' : 'Choose folder…'}
            </button>
          )}
        </div>
        <span
          style={{
            display: 'block',
            marginTop: 4,
            color: 'var(--ink-soft)',
            fontSize: 'var(--t-xs)',
          }}
        >
          {chosenRepo ? (
            <>
              <span className="mono" style={{ color: 'var(--ink)' }}>
                {chosenRepo}
              </span>
              {' — '}Osade works in its own worktree and never touches your checkout.
            </>
          ) : (
            'A git repository already on this machine. Osade works in its own worktree and never touches your checkout.'
          )}
        </span>
      </div>

      <label style={{ display: 'block', marginBottom: 14 }}>
        <span style={{ display: 'block', marginBottom: 4, color: 'var(--ink-soft)' }}>
          What should the agent do?
        </span>
        <textarea
          rows={3}
          autoFocus={initialRepo !== ''}
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
