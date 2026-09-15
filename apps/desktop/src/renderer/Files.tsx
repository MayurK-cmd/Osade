import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';
import { flagColour, highlight } from './highlight.js';

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
 * Files lane — tree of this chat's cwd, editable contents with Dark+ colouring, dirty files marked.
 *
 * Refresh is tied to agent facts (CDC already pushed those) plus a 2s tick while this lane is
 * open. Open-file contents are not overwritten while the buffer is dirty.
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
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<{ start: number; width: number } | null>(null);
  const dirty = file != null && !file.binary && !file.truncated && text !== saved;
  const stamp = `${task.task.id}:${task.cwd}:${task.agent?.last_event_at ?? 0}:${task.status}`;
  const drafts = useRef(new Map<string, string>());

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
      setText('');
      setSaved('');
      return;
    }
    let cancelled = false;
    void api
      .taskFsRead(task.task.id, selected)
      .then((next) => {
        if (cancelled) return;
        setFile(next);
        const disk = next.text ?? '';
        const draft = drafts.current.get(selected);
        setText(draft ?? disk);
        setSaved(disk);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, stamp, task.task.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void save();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  async function save(): Promise<void> {
    if (selected == null || file == null || file.binary || file.truncated || text === saved) return;
    setSaving(true);
    try {
      await api.taskFsWrite(task.task.id, selected, text);
      drafts.current.delete(selected);
      setSaved(text);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

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
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <FileBody
          file={file}
          selected={selected}
          text={text}
          dirty={dirty}
          saving={saving}
          onChange={(next) => {
            if (selected) {
              if (next === saved) drafts.current.delete(selected);
              else drafts.current.set(selected, next);
            }
            setText(next);
          }}
          onSave={() => void save()}
        />
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
        U
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
  text,
  dirty,
  saving,
  onChange,
  onSave,
}: {
  file: { path: string; text: string | null; binary: boolean; truncated: boolean } | null;
  selected: string | null;
  text: string;
  dirty: boolean;
  saving: boolean;
  onChange: (next: string) => void;
  onSave: () => void;
}): JSX.Element {
  if (selected == null) {
    return (
      <p style={{ margin: 0, padding: '12px 16px', color: 'var(--ink-2)' }}>Select a file</p>
    );
  }
  if (file == null) {
    return (
      <p style={{ margin: 0, padding: '12px 16px', color: 'var(--ink-2)' }}>Opening {selected}…</p>
    );
  }
  if (file.binary) {
    return (
      <p style={{ margin: 0, padding: '12px 16px', color: 'var(--ink-2)' }}>{file.path} is binary</p>
    );
  }
  if (file.truncated) {
    return (
      <div style={{ padding: '12px 16px' }}>
        <div className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-2)', marginBottom: 8 }}>
          {file.path} · too large to edit here
        </div>
        <pre className="mono" style={{ margin: 0, fontSize: 'var(--t-s)', whiteSpace: 'pre-wrap' }}>
          {file.text ?? ''}
        </pre>
      </div>
    );
  }
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          borderBottom: '0.5px solid var(--line)',
          flexShrink: 0,
        }}
      >
        <span className="mono" style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-2)', flex: 1, minWidth: 0 }}>
          {file.path}
          {dirty ? ' · unsaved' : ''}
        </span>
        <button type="button" disabled={!dirty || saving} onClick={onSave} style={{ fontSize: 'var(--t-xs)' }}>
          {saving ? 'Saving' : 'Save'}
        </button>
      </div>
      <CodeEditor path={file.path} value={text} onChange={onChange} />
    </>
  );
}

function CodeEditor({
  path,
  value,
  onChange,
}: {
  path: string;
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const preRef = useRef<HTMLPreElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const tokens = highlight(value, path);

  function syncScroll(): void {
    const pre = preRef.current;
    const ta = taRef.current;
    if (!pre || !ta) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    const ta = event.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const next = `${value.slice(0, start)}  ${value.slice(end)}`;
    onChange(next);
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = start + 2;
    });
  }

  return (
    <div className="code-editor" style={{ position: 'relative', flex: 1, minHeight: 0 }}>
      <pre
        ref={preRef}
        aria-hidden
        style={{
          position: 'absolute',
          inset: 0,
          margin: 0,
          padding: '12px 16px',
          overflow: 'hidden',
          pointerEvents: 'none',
          background: 'var(--bg-0)',
        }}
      >
        {tokens.map((tok, i) => (
          <span key={i} className={`tok-${tok.kind}`}>
            {tok.text}
          </span>
        ))}
        {value.endsWith('\n') ? '\n' : null}
      </pre>
      <textarea
        ref={taRef}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={syncScroll}
        onKeyDown={onKeyDown}
        style={{
          position: 'absolute',
          inset: 0,
          overflow: 'auto',
        }}
      />
    </div>
  );
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
