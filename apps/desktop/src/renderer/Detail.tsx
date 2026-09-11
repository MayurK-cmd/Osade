import { useState, type JSX, type ReactNode } from 'react';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';
import { Conventions } from './Conventions.js';
import { GateCard } from './GateCard.js';
import { PrOpen } from './PrOpen.js';
import { STATUS, TONE_COLOUR, ago } from './status.js';
import { VerifyPlanReview } from './VerifyPlanReview.js';

/**
 * One task, answering the questions in the order a person asks them — OSADE.md §19.4.
 *
 *   1. what is this, and what is happening to it
 *   2. **what do you need from me**
 *   3. how is it going
 *   4. (only if you go looking) which branch, which worktree, which pane
 *
 * The old version answered 4 first: branch, base, worktree, workspace id, pane id, agent state,
 * last event. All true, all the daemon's vocabulary, and none of it any help in deciding whether
 * to approve a pull request. Identifiers are now behind a disclosure, where they belong — useful
 * when something is wrong, noise the rest of the time.
 *
 * Panels appear when they are relevant. A task that has not started has nothing to say about
 * pull requests, and showing an empty one teaches people to ignore the panel.
 */

export function Detail({ task }: { task: TaskView }): JSX.Element {
  const copy = STATUS[task.status];
  const openGates = task.openGates.filter((gate) => gate.decided_at == null);

  // §10.2 — verification is the gate on review, so it earns a place once work exists. Before
  // that it is a question nobody has asked yet.
  const started = task.status !== 'queued';
  const showPr = ['awaiting_review', 'pr_open', 'ci_failed', 'review_changes_requested'].includes(
    task.status,
  );

  return (
    <div>
      <header style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--rule)' }}>
        <h1
          style={{
            fontSize: 'var(--t-xl)',
            fontWeight: 600,
            lineHeight: 1.2,
            letterSpacing: '-0.015em',
            margin: '0 0 8px',
          }}
        >
          {task.task.title}
        </h1>

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 8,
            color: TONE_COLOUR[copy.tone],
            fontWeight: 600,
          }}
        >
          {copy.label}
          <span style={{ color: 'var(--st-rest)', fontWeight: 400, fontSize: 'var(--t-xs)' }}>
            {ago(task.agent?.last_event_at ?? task.task.created_at)}
          </span>
        </div>

        <p style={{ margin: '6px 0 0', color: 'var(--ink-soft)', lineHeight: 1.55 }}>
          {copy.meaning}
        </p>
      </header>

      {/* 2. What the task needs from you — the reason this window exists. */}
      {openGates.length > 0 ? (
        <section
          style={{
            background: 'var(--wash-needs)',
            borderBottom: '1px solid var(--edge-needs)',
            borderLeft: '3px solid var(--st-needs)',
            padding: '14px 22px',
          }}
        >
          {openGates.map((gate) => (
            <GateCard key={gate.id} gate={gate} task={task} onDecided={() => {}} />
          ))}
        </section>
      ) : (
        copy.next && (
          <section
            style={{
              padding: '12px 24px',
              borderBottom: '1px solid var(--rule)',
              color: 'var(--ink-soft)',
            }}
          >
            {copy.next}
          </section>
        )
      )}

      {task.status === 'queued' && <StartTask taskId={task.task.id} />}

      {/* 3. How it is going. */}
      {started && (
        <Panel title="Checks" hint="What this project runs before work is reviewable.">
          <VerifyPlanReview taskId={task.task.id} />
        </Panel>
      )}

      {showPr && (
        <Panel title="Pull request" hint="Nothing is published until you approve it.">
          <PrOpen task={task} />
        </Panel>
      )}

      {/*
        * Repo-level, not task-level — the same rules appear on every task of the repository. It
        * is collapsed so it stops competing with the task's own gate for "needs you" attention,
        * and left open enough to notice: the summary carries the counts.
        */}
      <section style={{ padding: '14px 24px', borderBottom: '1px solid var(--rule)' }}>
        <details>
          <summary style={{ cursor: 'default' }}>What this project expects of contributors</summary>
          <div style={{ marginTop: 6 }}>
            <Conventions repoId={task.task.repo_id} />
          </div>
        </details>
      </section>

      {/* 4. The identifiers, for when something has gone wrong. */}
      <TechnicalDetails task={task} />
    </div>
  );
}

function StartTask({ taskId }: { taskId: string }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section style={{ padding: '14px 24px', borderBottom: '1px solid var(--rule)' }}>
      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void api
            .taskLaunch(taskId)
            .catch((err: Error) => setError(err.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Starting…' : 'Start the agent'}
      </button>
      <p style={{ margin: '8px 0 0', color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
        Creates a worktree and launches the agent inside it. Your own checkout is not touched.
      </p>
      {error && (
        <p className="mono" style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
          {error}
        </p>
      )}
    </section>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string | null;
  hint?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section style={{ padding: '16px 24px', borderBottom: '1px solid var(--rule)' }}>
      {title && (
        <h2 style={{ margin: 0, fontSize: 'var(--t-m)', fontWeight: 600 }}>
          {title}
        </h2>
      )}
      {hint && (
        <p style={{ margin: '2px 0 0', color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
          {hint}
        </p>
      )}
      {children}
    </section>
  );
}

/**
 * Where the daemon's vocabulary is allowed to appear.
 *
 * Closed by default. These are the things you want the moment something is wrong and never
 * otherwise, which is exactly what a disclosure is for.
 */
function TechnicalDetails({ task }: { task: TaskView }): JSX.Element {
  const probeFailures = task.agent?.probe_failures ?? 0;

  return (
    <section style={{ padding: '14px 24px 28px' }}>
      <details>
        <summary style={{ cursor: 'default', color: 'var(--ink-soft)' }}>
          Where this is running
        </summary>

        <div style={{ marginTop: 10 }}>
          <Field label="Branch" value={task.task.branch} mono />
          <Field label="Based on" value={`${task.task.base_sha.slice(0, 12)} on ${task.task.base_ref}`} mono />
          <Field label="Worktree" value={task.task.worktree_path} mono />
          <Field label="Workspace" value={task.task.herdr_workspace_id ?? 'not created yet'} mono />
          <Field label="Pane" value={task.agent?.herdr_pane_id ?? 'no agent running'} mono />
          {task.scm?.pr_url && <Field label="Pull request" value={task.scm.pr_url} mono />}

          {/* §5.2 — a failed probe is a note about confidence, never a state change. */}
          {probeFailures > 0 && (
            <p style={{ color: 'var(--st-rest)', fontSize: 'var(--t-xs)', marginTop: 8 }}>
              {probeFailures} failed {probeFailures === 1 ? 'probe' : 'probes'} — the status above
              may be behind what is really happening.
            </p>
          )}
        </div>
      </details>

      <div style={{ marginTop: 14 }}>
        <button onClick={() => void window.osade?.openInHerdr()}>Open the terminal</button>
        <p style={{ margin: '8px 0 0', color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
          Watch the agent work, or talk to it directly. Osade does not embed a terminal
          (ADR 0001); this opens a real one on the same session.
        </p>
      </div>
    </section>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '3px 0', alignItems: 'baseline' }}>
      <span style={{ width: 92, flexShrink: 0, color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
        {label}
      </span>
      <span
        className={mono ? 'mono' : undefined}
        style={{ fontSize: 'var(--t-xs)', wordBreak: 'break-all' }}
      >
        {value}
      </span>
    </div>
  );
}
