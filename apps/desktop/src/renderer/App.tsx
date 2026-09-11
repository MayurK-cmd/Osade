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
      style={{ display: 'grid', gridTemplateColumns: 'minmax(420px, 1fr) 470px', height: '100%' }}
    >
      <main style={{ overflow: 'auto', borderRight: '1px solid var(--rule)' }}>
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
                  needsYou.length === 1 ? '1 task needs you' : `${needsYou.length} tasks need you`
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
              <Section title={needsYou.length > 0 ? 'Everything else' : 'Tasks'}>
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
      </main>

      <aside style={{ overflow: 'auto' }}>
        {selected ? <Detail task={selected} /> : <NothingSelected hasTasks={tasks.length > 0} />}
      </aside>
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
        padding: '15px 22px',
        borderBottom: '1px solid var(--rule)',
        position: 'sticky',
        top: 0,
        background: 'var(--paper)',
        zIndex: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--t-l)', fontWeight: 600, letterSpacing: '-0.01em' }}>
          Osade
        </span>
        <span style={{ color: 'var(--ink-soft)' }}>{summary}</span>
      </div>

      <span style={{ flex: 1 }} />

      <button onClick={onNew}>New task</button>

      {/* Connection is a fact about the app, not about the work — so it stays the quietest thing
          on the screen, and only speaks up when it is bad news. */}
      <span
        title={connected ? 'Connected to the daemon' : 'Not connected to the daemon'}
        style={{
          fontSize: 'var(--t-xs)',
          color: connected ? 'var(--st-rest)' : 'var(--st-fail)',
          whiteSpace: 'nowrap',
        }}
      >
        {error ?? (connected ? 'connected' : 'reconnecting…')}
      </span>
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
          padding: '13px 22px 3px',
          fontSize: 'var(--t-s)',
          fontWeight: 600,
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
          padding: '18px 22px 3px',
          fontSize: 'var(--t-xs)',
          fontWeight: 600,
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
        columnGap: 12,
        padding: '10px 22px',
        borderTop: '1px solid var(--rule)',
        background: selected ? 'var(--field)' : 'transparent',
        cursor: 'default',
      }}
    >
      <span className="mono" style={{ color: colour, lineHeight: 1.45 }} aria-hidden="true">
        {GLYPH[copy.tone]}
      </span>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 'var(--t-m)',
            lineHeight: 1.35,
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
        <p style={{ marginTop: 0, fontSize: 'var(--t-m)' }}>Connecting to the daemon.</p>
        <p style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>
          Agents keep running while this window is closed, so nothing has been lost. This should
          only take a moment.
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: '34px 22px', maxWidth: 490 }}>
      <p style={{ marginTop: 0, fontSize: 'var(--t-m)' }}>No tasks yet.</p>
      <p style={{ color: 'var(--ink-soft)', lineHeight: 1.55 }}>
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
    <div style={{ padding: '34px 24px', color: 'var(--ink-soft)', maxWidth: 380 }}>
      <p style={{ marginTop: 0, lineHeight: 1.55 }}>
        {hasTasks
          ? 'Pick a task to see what it has done, and what it needs from you.'
          : 'Nothing to show yet.'}
      </p>
    </div>
  );
}
