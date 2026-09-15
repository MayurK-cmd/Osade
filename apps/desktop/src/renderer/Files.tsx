import { useEffect, useRef, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';

const TREE_KEY = 'osade.files-tree-width';
const TREE_DEFAULT = 200;

type Flag = 'M' | 'A' | 'D' | '?';

export interface FsEntry {
  name: string;
  path: string;
  kind: 'dir' | 'file';
  flag: Flag | null;
  insertions: number;
  deletions: number;
}

/**
 * Files lane — tree of this chat's cwd, contents in Plex Mono, dirty files marked.
 *
 * Refresh is tied to agent facts (CDC already pushed those) plus a 2s tick while this lane is
 * open, so an attached checkout does not sit stale between events. No websocket of its own:
 * §5.4 still has one event path.
 */
export function Files({ task }: { task: TaskView }): JSX.Element {
  const [width, setWidth] = useState(() => loadWidth());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']));
  const [listed, setListed] = useState<Record<string, FsEntry[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [file, setFile] = useState<{
    path: string;
    text: string | null;
    binary: boolean;
    truncated: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ start: number; width: number } | null>(null);
  const stamp = `${task.task.id}:${task.cwd}:${task.agent?.last_event_at ?? 0}:${task.status}`;

  useEffect(() => {
    let cancelled = false;

    async function refresh(): Promise<void> {
      try {
        const dirs = [...expanded];
        const result = await api.taskFsList(task.task.id, dirs);
        const next: Record<string, FsEntry[]> = {};
        for (const row of result.listings) next[row.dir] = row.entries;
        if (!cancelled) {
          setListed(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }

    void refresh();
    const tick = window.setInterval(() => void refresh(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [stamp, expanded, task.task.id]);

  useEffect(() => {
    if (selected == null) {
      setFile(null);
      return;
    }
    let cancelled = false;
    void api
      .taskFsRead(task.task.id, selected)
      .then((next) => {
        if (!cancelled) setFile(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, stamp, task.task.id]);

  function toggleDir(path: string): void {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function onDragStart(event: ReactMouseEvent<HTMLDivElement>): void {
    event.preventDefault();
    drag.current = { start: event.clientX, width };
    function move(ev: MouseEvent): void {
      if (!drag.current) return;
      const next = Math.min(420, Math.max(140, drag.current.width + (ev.clientX - drag.current.start)));
      setWidth(next);
    }
    function up(): void {
      drag.current = null;
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setWidth((current) => {
        try {
          localStorage.setItem(TREE_KEY, String(current));
        } catch {
          // ignore
        }
        return current;
      });
    }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div
        style={{
          width,
          flexShrink: 0,
          overflow: 'auto',
          borderRight: '0.5px solid var(--line)',
          padding: '8px 0',
        }}
      >
        <Tree
          entries={listed[''] ?? []}
          listed={listed}
          expanded={expanded}
          selected={selected}
          depth={0}
          onDir={toggleDir}
          onFile={setSelected}
        />
        {error && (
          <p style={{ margin: '8px 12px', color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>{error}</p>
        )}
      </div>
      <div
        onMouseDown={onDragStart}
        style={{
          width: 5,
          cursor: 'col-resize',
          flexShrink: 0,
          background: 'transparent',
        }}
      />
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '12px 16px' }}>
        <FileBody file={file} selected={selected} />
      </div>
    </div>
  );
}

function Tree({
  entries,
  listed,
  expanded,
  selected,
  depth,
  onDir,
  onFile,
}: {
  entries: FsEntry[];
  listed: Record<string, FsEntry[]>;
  expanded: Set<string>;
  selected: string | null;
  depth: number;
  onDir: (path: string) => void;
  onFile: (path: string) => void;
}): JSX.Element {
  return (
    <>
      {entries.map((entry) => {
        const open = entry.kind === 'dir' && expanded.has(entry.path);
        const active = selected === entry.path;
        const colour = flagColour(entry.flag);
        return (
          <div key={entry.path}>
            <button
              onClick={() => (entry.kind === 'dir' ? onDir(entry.path) : onFile(entry.path))}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: '100%',
                padding: '2px 10px 2px',
                paddingLeft: 10 + depth * 12,
                border: 'none',
                borderRadius: 0,
                background: active ? 'var(--bg-2)' : 'transparent',
                color: colour ?? 'var(--ink)',
                textAlign: 'left',
                fontSize: 'var(--t-s)',
              }}
            >
              <span style={{ color: 'var(--ink-3)', width: 8, flexShrink: 0 }}>
                {entry.kind === 'dir' ? (open ? '⌄' : '›') : ''}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {entry.name}
              </span>
              <Diffstat entry={entry} />
            </button>
            {open && (
              <Tree
                entries={listed[entry.path] ?? []}
                listed={listed}
                expanded={expanded}
                selected={selected}
                depth={depth + 1}
                onDir={onDir}
                onFile={onFile}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function Diffstat({ entry }: { entry: FsEntry }): JSX.Element | null {
  if (entry.flag === '?') {
    return (
      <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--st-live)', flexShrink: 0 }}>
        ?
      </span>
    );
  }
  if (entry.insertions === 0 && entry.deletions === 0) return null;
  return (
    <span className="mono" style={{ fontSize: 'var(--t-xs)', flexShrink: 0 }}>
      {entry.insertions > 0 && <span style={{ color: 'var(--st-live)' }}>+{entry.insertions}</span>}
      {entry.insertions > 0 && entry.deletions > 0 ? ' ' : ''}
      {entry.deletions > 0 && <span style={{ color: 'var(--st-fail)' }}>−{entry.deletions}</span>}
    </span>
  );
}

function FileBody({
  file,
  selected,
}: {
  file: { path: string; text: string | null; binary: boolean; truncated: boolean } | null;
  selected: string | null;
}): JSX.Element {
  if (selected == null) {
    return <p style={{ margin: 0, color: 'var(--ink-2)' }}>Select a file</p>;
  }
  if (file == null) {
    return <p style={{ margin: 0, color: 'var(--ink-2)' }}>Opening {selected}…</p>;
  }
  if (file.binary) {
    return <p style={{ margin: 0, color: 'var(--ink-2)' }}>{file.path} is binary</p>;
  }
  return (
    <div>
      <div className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-2)', marginBottom: 8 }}>
        {file.path}
        {file.truncated ? ' · truncated' : ''}
      </div>
      <pre
        className="mono"
        style={{
          margin: 0,
          fontSize: 'var(--t-s)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {file.text ?? ''}
      </pre>
    </div>
  );
}

function flagColour(flag: Flag | null): string | undefined {
  if (flag === 'D') return 'var(--st-fail)';
  if (flag === 'A' || flag === '?' || flag === 'M') return 'var(--st-live)';
  return undefined;
}

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(TREE_KEY));
    if (Number.isFinite(raw) && raw >= 140 && raw <= 420) return raw;
  } catch {
    // ignore
  }
  return TREE_DEFAULT;
}
