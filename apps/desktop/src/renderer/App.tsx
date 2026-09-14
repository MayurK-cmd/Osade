import { useEffect, useMemo, useState, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { CommandPalette } from './CommandPalette.js';
import { Detail, type Lane } from './Detail.js';
import { NewTask } from './NewTask.js';
import { api } from './api.js';
import { chord } from './chords.js';
import { STATUS, TONE_COLOUR, ago, summarise } from './status.js';
import { useLedger } from './useLedger.js';
import { useRepo } from './useRepo.js';

type Group = 'needs' | 'running' | 'idle' | 'done';

const GROUP_ORDER: Group[] = ['needs', 'running', 'idle', 'done'];
const GROUP_LABEL: Record<Group, string> = {
  needs: 'Needs you',
  running: 'Running',
  idle: 'Idle',
  done: 'Done',
};
const LANES: Lane[] = ['transcript', 'checks', 'diff', 'rules'];

function groupOf(task: TaskView): Group {
  if (task.needsYou) return 'needs';
  if (task.status === 'implementing' || task.status === 'verifying') return 'running';
  if (task.status === 'merged' || task.status === 'archived') return 'done';
  return 'idle';
}

export function App(): JSX.Element {
  const { tasks: allTasks, connection, error } = useLedger();
  const { repo, error: repoError } = useRepo();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [palette, setPalette] = useState(false);
  const [lane, setLane] = useState<Lane>('transcript');
  const [actionError, setActionError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  const scoped = repo ? allTasks.filter((t) => t.task.repo_id === repo.repoId) : allTasks;
  const tasks = scoped.filter((t) => t.status !== 'archived');

  const grouped = useMemo(() => {
    const buckets: Record<Group, TaskView[]> = { needs: [], running: [], idle: [], done: [] };
    for (const task of tasks) buckets[groupOf(task)].push(task);
    return buckets;
  }, [tasks]);

  const flat = useMemo(
    () => GROUP_ORDER.flatMap((group) => grouped[group]),
    [grouped],
  );

  const working = grouped.running.length;
  const selected = tasks.find((t) => t.task.id === selectedId) ?? null;

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const modKey = event.metaKey || event.ctrlKey;
      const typing = isTyping(event.target);

      if (modKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPalette((open) => !open);
        return;
      }
      if (modKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        setPalette(false);
        setComposing(true);
        return;
      }

      if (palette && event.key === 'Escape') {
        event.preventDefault();
        setPalette(false);
        return;
      }
      if (menu && event.key === 'Escape') {
        event.preventDefault();
        setMenu(null);
        return;
      }

      if (palette) return;

      if (modKey && event.key === 'Enter' && !typing) {
        event.preventDefault();
        void decideGate(selected, 'approve', setActionError);
        return;
      }
      if (modKey && event.key === 'Backspace' && !typing) {
        event.preventDefault();
        void decideGate(selected, 'deny', setActionError);
        return;
      }

      if (typing) return;

      if (event.key === 'j' || event.key === 'k') {
        event.preventDefault();
        const delta = event.key === 'j' ? 1 : -1;
        const index = selectedId ? flat.findIndex((t) => t.task.id === selectedId) : -1;
        const next = flat[clamp((index < 0 ? (delta > 0 ? -1 : 0) : index) + delta, 0, flat.length - 1)];
        if (next) setSelectedId(next.task.id);
        return;
      }

      if (event.key === 'Enter' && selectedId == null && flat[0]) {
        event.preventDefault();
        setSelectedId(flat[0].task.id);
        return;
      }

      const digit = event.key === '1' || event.key === '2' || event.key === '3' || event.key === '4';
      if (digit && selected) {
        event.preventDefault();
        setLane(LANES[Number(event.key) - 1]!);
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, menu, palette, selected, selectedId]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
        height: '100%',
        background: 'var(--bg-0)',
      }}
    >
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRight: '0.5px solid var(--line)',
          background: 'var(--bg-1)',
        }}
      >
        <Header
          repo={repo}
          connection={connection}
          error={error ?? repoError ?? actionError}
          summary={summarise({
            needsYou: grouped.needs.length,
            working,
            total: tasks.length,
          })}
          onNew={() => setComposing(true)}
        />

        {composing && (
          <NewTask
            repoPath={repo?.path ?? ''}
            onClose={() => setComposing(false)}
            onCreated={(id) => {
              setSelectedId(id);
              setComposing(false);
            }}
          />
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {tasks.length === 0 && !composing ? (
            <Empty connection={connection} repo={repo} onNew={() => setComposing(true)} />
          ) : (
            GROUP_ORDER.map((group) => {
              const rows = grouped[group];
              if (rows.length === 0) return null;
              return (
                <section key={group}>
                  <h2
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      margin: 0,
                      padding: '8px 16px',
                      fontSize: 'var(--t-xs)',
                      fontWeight: 600,
                      color: group === 'needs' ? 'var(--st-needs)' : 'var(--ink-2)',
                      background: 'var(--bg-1)',
                      borderBottom: '0.5px solid var(--line)',
                    }}
                  >
                    {GROUP_LABEL[group]} · {rows.length}
                  </h2>
                  {rows.map((task) => (
                    <Row
                      key={task.task.id}
                      task={task}
                      selected={task.task.id === selectedId}
                      onSelect={setSelectedId}
                      onMenu={(x, y) => setMenu({ id: task.task.id, x, y })}
                    />
                  ))}
                </section>
              );
            })
          )}
        </div>

        <SidebarFoot
          working={working}
          total={tasks.length}
          connected={connection === 'live'}
        />
      </main>

      <aside style={{ overflow: 'hidden', minWidth: 0 }}>
        {selected ? (
          <Detail task={selected} lane={lane} onLane={setLane} />
        ) : (
          <NothingSelected hasTasks={tasks.length > 0} />
        )}
      </aside>

      <CommandPalette
        open={palette}
        onClose={() => setPalette(false)}
        selected={selected}
        repo={repo}
        onNewTask={() => {
          setPalette(false);
          setComposing(true);
        }}
        onError={setActionError}
      />

      {menu && (
        <RowMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onDelete={() => {
            const id = menu.id;
            setMenu(null);
            void api.taskArchive(id).then(
              () => {
                setSelectedId((current) => (current === id ? null : current));
              },
              (err: Error) => setActionError(err.message),
            );
          }}
        />
      )}
    </div>
  );
}

function decideGate(
  selected: TaskView | null,
  decision: 'approve' | 'deny',
  onError: (message: string) => void,
): Promise<void> {
  const gate = selected?.openGates.find((g) => g.decided_at == null);
  if (!gate) return Promise.resolve();
  return api.gateDecide(gate.id, decision).then(
    () => undefined,
    (err: Error) => onError(err.message),
  );
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function clamp(n: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, n));
}

function SidebarFoot({
  working,
  total,
  connected,
}: {
  working: number;
  total: number;
  connected: boolean;
}): JSX.Element {
  return (
    <div
      style={{
        background: 'var(--bg-1)',
        borderTop: '0.5px solid var(--line)',
        padding: '6px 0',
      }}
    >
      <FootRow label="Agents" value={working === 0 ? 'Idle' : `${working} running`} />
      <FootRow label="Tasks" value={String(total)} />
      <FootRow
        label="Daemon"
        value={connected ? 'Connected' : 'Reconnecting'}
        tone={connected ? undefined : 'var(--st-fail)'}
      />
    </div>
  );
}

function FootRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '2px 16px',
        fontSize: 'var(--t-xs)',
        color: 'var(--ink-2)',
      }}
    >
      <span>{label}</span>
      <span className="mono" style={{ color: tone ?? 'var(--ink)' }}>
        {value}
      </span>
    </div>
  );
}

function Header({
  repo,
  connection,
  error,
  summary,
  onNew,
}: {
  repo: { name: string; slug: string | null } | null;
  connection: string;
  error: string | null;
  summary: string;
  onNew: () => void;
}): JSX.Element {
  const connected = connection === 'live';
  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '10px 16px',
        borderBottom: '0.5px solid var(--line)',
        background: 'var(--bg-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
        <span
          style={{
            fontSize: 'var(--t-m)',
            fontWeight: 600,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={repo?.slug ?? undefined}
        >
          {repo ? repo.name : 'Osade'}
        </span>
        <span style={{ color: 'var(--ink-2)', fontSize: 'var(--t-xs)' }}>{summary}</span>
      </div>

      <span style={{ flex: 1 }} />

      <button data-new-task onClick={onNew}>
        New task <kbd>{chord('n')}</kbd>
      </button>

      {(error || !connected) && (
        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--st-fail)', whiteSpace: 'nowrap' }}>
          {error ?? 'Reconnecting'}
        </span>
      )}
    </header>
  );
}

function Row({
  task,
  selected,
  onSelect,
  onMenu,
}: {
  task: TaskView;
  selected: boolean;
  onSelect: (id: string) => void;
  onMenu: (x: number, y: number) => void;
}): JSX.Element {
  const copy = STATUS[task.status];
  const colour = TONE_COLOUR[copy.tone];
  const activity = task.agent?.activity_text?.trim();
  const at = task.agent?.last_event_at ?? task.task.created_at;
  const secondary = activity || copy.next || copy.label;

  return (
    <div
      data-task-id={task.task.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      className="ledger-row"
      onClick={() => onSelect(task.task.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(task.task.id);
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '2px 1fr auto',
        gridTemplateRows: 'auto auto',
        columnGap: 10,
        rowGap: 1,
        padding: '7px 16px 7px 0',
        borderBottom: '0.5px solid var(--line)',
        cursor: 'default',
      }}
    >
      <span
        style={{
          gridRow: '1 / span 2',
          background: colour,
          borderRadius: 1,
        }}
        aria-hidden="true"
      />

      <div
        style={{
          fontSize: 'var(--t-m)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {task.task.title}
      </div>

      <span
        className="mono"
        style={{
          fontSize: 'var(--t-xs)',
          color: 'var(--ink-3)',
          whiteSpace: 'nowrap',
          textAlign: 'right',
        }}
        title={new Date(at).toLocaleString()}
      >
        {ago(at)}
      </span>

      <div
        style={{
          gridColumn: 2,
          fontSize: 'var(--t-s)',
          color: 'var(--ink-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {secondary}
      </div>
    </div>
  );
}

function RowMenu({
  x,
  y,
  onClose,
  onDelete,
}: {
  x: number;
  y: number;
  onClose: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 30 }}
    >
      <div
        role="menu"
        onClick={(event) => event.stopPropagation()}
        style={{
          position: 'fixed',
          left: x,
          top: y,
          minWidth: 140,
          background: 'var(--bg-2)',
          border: '0.5px solid var(--line)',
          borderRadius: 'var(--radius)',
          padding: '4px 0',
        }}
      >
        <button
          role="menuitem"
          onClick={onDelete}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'transparent',
            border: 'none',
            borderRadius: 0,
            padding: '6px 12px',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

function Empty({
  connection,
  repo,
  onNew,
}: {
  connection: string;
  repo: { name: string } | null;
  onNew: () => void;
}): JSX.Element {
  if (connection !== 'live') {
    return (
      <div style={{ padding: '34px 22px', maxWidth: 460 }}>
        <p style={{ marginTop: 0 }}>Connecting to the daemon…</p>
        <p style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
          Agents keep running while this window is closed, so nothing has been lost. This should
          only take a moment.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '34px 22px', maxWidth: 490 }}>
      <p style={{ marginTop: 0 }}>{repo ? `No tasks in ${repo.name} yet` : 'No tasks yet'}</p>
      <p style={{ color: 'var(--ink-2)', lineHeight: 1.45 }}>
        A task is one piece of work on one repository. Osade gives it its own git worktree, runs an
        agent inside it, and stops for you before anything is published.
      </p>
      <button className="primary" onClick={onNew} style={{ marginTop: 8 }}>
        New task
      </button>
    </div>
  );
}

function NothingSelected({ hasTasks }: { hasTasks: boolean }): JSX.Element {
  return (
    <div style={{ padding: '34px 24px', color: 'var(--ink-2)', maxWidth: 380 }}>
      <p style={{ marginTop: 0, lineHeight: 1.45 }}>
        {hasTasks
          ? 'Pick a task to see what it has done, and what it needs from you.'
          : 'Nothing to show yet.'}
      </p>
    </div>
  );
}
