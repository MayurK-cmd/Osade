import { useState, type JSX, type ReactNode } from 'react';

import type { TaskView } from '@osade/contract';

import { Detail } from './Detail.js';
import { NewTask } from './NewTask.js';
import { GLYPH, STATUS, TONE_COLOUR, ago, summarise } from './status.js';
import { useLedger } from './useLedger.js';

/**
 * The ledger — OSADE.md §19.
 *
 * A record of machine work on a public commons. One question organises the whole screen, because
 * with eight agents running it is the only question a person actually has: **who needs me?** The
 * tasks that need a human sit at the top, under their own heading, on a tinted band, behind a
 * flag. Everything else is deliberately quiet.
 *
 * §18.1 — App.tsx is a composition root only. Behaviour lives in the panels it arranges.
 */

export function App(): JSX.Element {
  const { tasks, connection, error } = useLedger();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const working = tasks.filter((t) => t.status === 'implementing' || t.status === 'verifying');
  const needsYou = tasks.filter((t) => t.needsYou);
  const rest = tasks.filter((t) => !t.needsYou);
  const selected = tasks.find((t) => t.task.id === selectedId) ?? null;

  return (
    <div
      /*
       * The ledger is a scannable list of short rows; the detail pane is where reading and
       * deciding happen. Giving the list the flexible column left a 970px void beside one task
       * and squeezed the thing being read, so the weight is the other way round.
       */
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
        height: '100%',
      }}
    >
      <main
        style={{
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          borderRight: '1px solid var(--rule)',
          background: 'var(--surface)',
        }}
      >
        <Header
          connection={connection}
          error={error}
          summary={summarise({
            needsYou: needsYou.length,
            working: working.length,
            total: tasks.length,
          })}
          onNew={() => setComposing(true)}
        />

        {composing && (
          <NewTask
            onClose={() => setComposing(false)}
            onCreated={(id) => {
              setSelectedId(id);
              setComposing(false);
            }}
          />
        )}

        {tasks.length === 0 && !composing ? (
          <Empty connection={connection} onNew={() => setComposing(true)} />
        ) : (
          <>
            {needsYou.length > 0 && (
              <Band
                title={
                  needsYou.length === 1 ? 'needs you' : `needs you · ${needsYou.length}`
                }
              >
                {needsYou.map((task) => (
                  <Row
                    key={task.task.id}
                    task={task}
                    selected={task.task.id === selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </Band>
            )}

            {rest.length > 0 && (
              <Section title={needsYou.length > 0 ? 'everything else' : 'tasks'}>
                {rest.map((task) => (
                  <Row
                    key={task.task.id}
                    task={task}
                    selected={task.task.id === selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </Section>
            )}
          </>
        )}
        <SidebarFoot
          working={working.length}
          total={tasks.length}
          connected={connection === 'live'}
        />
      </main>

      <aside style={{ overflow: 'auto' }}>
        {selected ? <Detail task={selected} /> : <NothingSelected hasTasks={tasks.length > 0} />}
      </aside>
    </div>
  );
}

/**
 * The sidebar's footer — label left, reading right, on one line.
 *
 * Borrowed from the terminal this sits beside, where the sidebar ends in exactly this shape. It
 * earns the space by carrying the two facts that are true of the whole window rather than of any
 * one task: how many agents are actually running, and whether the daemon is there at all.
 */
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
        position: 'sticky',
        bottom: 0,
        marginTop: 'auto',
        background: 'var(--surface)',
        borderTop: '1px solid var(--rule)',
        padding: '6px 0',
      }}
    >
      <FootRow label="agents" value={working === 0 ? 'idle' : `${working} running`} />
      <FootRow label="tasks" value={String(total)} />
      <FootRow
        label="daemon"
        value={connected ? 'connected' : 'reconnecting'}
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
        color: 'var(--ink-soft)',
      }}
    >
      <span>{label}</span>
      <span style={{ color: tone ?? 'var(--ink)' }}>{value}</span>
    </div>
  );
}

function Header({
  connection,
  error,
  summary,
  onNew,
}: {
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
        borderBottom: '1px solid var(--rule)',
        position: 'sticky',
        top: 0,
        background: 'var(--surface)',
        zIndex: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--t-m)', fontWeight: 600 }}>osade</span>
        <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>{summary}</span>
      </div>

      <span style={{ flex: 1 }} />

      <button onClick={onNew}>new task</button>

      {/* Only when it is bad news. The steady-state reading lives in the footer. */}
      {(error || !connected) && (
        <span style={{ fontSize: 'var(--t-xs)', color: 'var(--st-fail)', whiteSpace: 'nowrap' }}>
          {error ?? 'reconnecting'}
        </span>
      )}
    </header>
  );
}

/** The needs-you set, as one block — findable without being read (§19.3). */
function Band({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section
      style={{
        background: 'var(--wash-needs)',
        borderBottom: '1px solid var(--edge-needs)',
        borderLeft: '3px solid var(--st-needs)',
      }}
    >
      <h2
        style={{
          margin: 0,
          padding: '9px 16px 2px',
          fontSize: 'var(--t-xs)',
          fontWeight: 400,
          color: 'var(--st-needs)',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <section>
      <h2
        style={{
          margin: 0,
          padding: '14px 16px 2px',
          fontSize: 'var(--t-xs)',
          fontWeight: 400,
          color: 'var(--ink-soft)',
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({
  task,
  selected,
  onSelect,
}: {
  task: TaskView;
  selected: boolean;
  onSelect: (id: string) => void;
}): JSX.Element {
  const copy = STATUS[task.status];
  const colour = TONE_COLOUR[copy.tone];
  // What it is *doing* beats what it *is*: "running pnpm test" says more than "verifying", and
  // the status is already in the gutter and the label beside it.
  const activity = task.agent?.activity_text?.trim();
  const at = task.agent?.last_event_at ?? task.task.created_at;

  return (
    <div
      data-task-id={task.task.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={() => onSelect(task.task.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(task.task.id);
        }
      }}
      style={{
        display: 'grid',
        gridTemplateColumns: '18px 1fr auto',
        alignItems: 'start',
        columnGap: 10,
        padding: '6px 16px',
        borderTop: '1px solid var(--rule)',
        background: selected ? 'var(--field)' : 'transparent',
        boxShadow: selected ? 'inset 2px 0 0 var(--accent)' : 'none',
        cursor: 'default',
      }}
    >
      <span className="mono" style={{ color: colour, lineHeight: 1.45 }} aria-hidden="true">
        {GLYPH[copy.tone]}
      </span>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--t-s)',
            lineHeight: 1.45,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {task.task.title}
        </div>
        <div
          style={{
            marginTop: 1,
            fontSize: 'var(--t-xs)',
            color: 'var(--ink-soft)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: colour }}>{copy.label}</span>
          {activity ? ` — ${activity}` : ''}
        </div>
      </div>

      <span
        style={{ fontSize: 'var(--t-xs)', color: 'var(--st-rest)', whiteSpace: 'nowrap' }}
        title={new Date(at).toLocaleString()}
      >
        {ago(at)}
      </span>
    </div>
  );
}

function Empty({ connection, onNew }: { connection: string; onNew: () => void }): JSX.Element {
  // §19.4 — an empty screen is an invitation to act, not a mood.
  if (connection !== 'live') {
    return (
      <div style={{ padding: '34px 22px', maxWidth: 460 }}>
        <p style={{ marginTop: 0 }}>connecting to the daemon…</p>
        <p style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>
          Agents keep running while this window is closed, so nothing has been lost. This should
          only take a moment.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '34px 22px', maxWidth: 490 }}>
      <p style={{ marginTop: 0 }}>no tasks yet</p>
      <p style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>
        A task is one piece of work on one repository. Osade gives it its own git worktree, runs an
        agent inside it, and stops for you before anything is published.
      </p>
      <button className="primary" onClick={onNew} style={{ marginTop: 8 }}>
        new task
      </button>
    </div>
  );
}

function NothingSelected({ hasTasks }: { hasTasks: boolean }): JSX.Element {
  return (
    <div style={{ padding: '34px 24px', color: 'var(--ink-soft)', maxWidth: 380 }}>
      <p style={{ marginTop: 0, lineHeight: 1.55 }}>
        {hasTasks
          ? 'Pick a task to see what it has done, and what it needs from you.'
          : 'Nothing to show yet.'}
      </p>
    </div>
  );
}
