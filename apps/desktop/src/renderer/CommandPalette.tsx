import { useEffect, useMemo, useState, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';
import { chord } from './chords.js';

export interface PaletteRepo {
  repoId: string;
}

interface Item {
  id: string;
  label: string;
  chord?: string;
  disabled?: boolean;
  run: () => void | Promise<void>;
}

export function CommandPalette({
  open,
  onClose,
  selected,
  repo,
  onNewChat,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  selected: TaskView | null;
  repo: PaletteRepo | null;
  onNewChat: () => void;
  onError: (message: string) => void;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const items = useMemo<Item[]>(() => {
    const repoId = repo?.repoId ?? selected?.task.repo_id ?? null;
    return [
      {
        id: 'new',
        label: 'New chat',
        chord: chord('t'),
        run: onNewChat,
      },
      {
        id: 'launch',
        label: 'Start agent',
        disabled: selected == null,
        run: async () => {
          await api.taskLaunch(selected!.task.id);
        },
      },
      {
        id: 'verify',
        label: 'Run checks',
        disabled: selected == null,
        run: async () => {
          await api.verifyRun(selected!.task.id);
        },
      },
      {
        id: 'pr',
        label: 'Request pull request',
        disabled: selected == null,
        run: async () => {
          await api.prOpenRequest(selected!.task.id, selected!.task.title, '');
        },
      },
      {
        id: 'mine',
        label: 'Mine repository',
        disabled: repoId == null,
        run: async () => {
          await api.mineRepo(repoId!);
        },
      },
    ];
  }, [onNewChat, repo, selected]);

  const filtered = items.filter((item) =>
    item.label.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    if (!open) {
      setQuery('');
      setCursor(0);
    }
  }, [open]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  if (!open) return null;

  function run(item: Item): void {
    if (item.disabled) return;
    onClose();
    void Promise.resolve(item.run()).catch((err: Error) => onError(err.message));
  }

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(16, 18, 16, 0.72)',
        display: 'flex',
        justifyContent: 'center',
        paddingTop: 80,
        zIndex: 20,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 440,
          maxWidth: 'calc(100% - 32px)',
          background: 'var(--bg-1)',
          border: '0.5px solid var(--line)',
          borderRadius: 'var(--radius-panel)',
          overflow: 'hidden',
        }}
      >
        <input
          autoFocus
          value={query}
          placeholder="Run a command"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
              return;
            }
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setCursor((c) => Math.min(c + 1, Math.max(filtered.length - 1, 0)));
              return;
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault();
              setCursor((c) => Math.max(c - 1, 0));
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              const item = filtered[cursor];
              if (item) run(item);
            }
          }}
          style={{
            border: 'none',
            borderBottom: '0.5px solid var(--line)',
            borderRadius: 0,
            padding: '10px 12px',
            background: 'var(--bg-1)',
          }}
        />
        <ul style={{ listStyle: 'none', margin: 0, padding: '6px 0' }}>
          {filtered.length === 0 && (
            <li style={{ padding: '8px 12px', color: 'var(--ink-3)', fontSize: 'var(--t-s)' }}>
              No matching commands
            </li>
          )}
          {filtered.map((item, i) => (
            <li key={item.id}>
              <button
                disabled={item.disabled}
                onClick={() => run(item)}
                onMouseEnter={() => setCursor(i)}
                style={{
                  display: 'flex',
                  width: '100%',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  background: i === cursor ? 'var(--bg-2)' : 'transparent',
                  border: 'none',
                  borderRadius: 0,
                  textAlign: 'left',
                  padding: '7px 12px',
                }}
              >
                <span>{item.label}</span>
                {item.chord && <kbd>{item.chord}</kbd>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
