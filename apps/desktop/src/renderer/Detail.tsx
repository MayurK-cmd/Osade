import { useState, type JSX } from 'react';

import type { TaskView, VerifyRun } from '@osade/contract';

import { api } from './api.js';
import { Composer } from './Composer.js';
import { Conventions } from './Conventions.js';
import { GateCard } from './GateCard.js';
import { PrOpen } from './PrOpen.js';
import { STATUS, TONE_COLOUR, ago } from './status.js';
import { Transcript } from './Transcript.js';
import { VerifyPlanReview } from './VerifyPlanReview.js';

export type Lane = 'transcript' | 'checks' | 'diff' | 'rules';

const LANES: { id: Lane; label: string; chord: string }[] = [
  { id: 'transcript', label: 'Transcript', chord: '1' },
  { id: 'checks', label: 'Checks', chord: '2' },
  { id: 'diff', label: 'Diff', chord: '3' },
  { id: 'rules', label: 'Rules', chord: '4' },
];

/**
 * One task: header, gate banner, lane tabs, composer.
 * Existing panels keep their behaviour; only their parent changes.
 */
export function Detail({
  task,
  lane,
  onLane,
}: {
  task: TaskView;
  lane: Lane;
  onLane: (lane: Lane) => void;
}): JSX.Element {
  const copy = STATUS[task.status];
  const colour = TONE_COLOUR[copy.tone];
  const openGates = task.openGates.filter((gate) => gate.decided_at == null);
  const sha = task.task.base_sha.slice(0, 12);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bg-0)',
      }}
    >
      <header style={{ padding: '14px 16px 12px', borderBottom: '0.5px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <h1
            style={{
              fontSize: 'var(--t-l)',
              fontWeight: 600,
              lineHeight: 1.3,
              margin: 0,
              flex: 1,
              minWidth: 0,
            }}
          >
            {task.task.title}
          </h1>
          <span
            style={{
              flexShrink: 0,
              fontSize: 'var(--t-xs)',
              color: colour,
              border: '0.5px solid var(--line)',
              background: 'var(--bg-2)',
              borderRadius: 'var(--radius)',
              padding: '2px 8px',
            }}
          >
            {copy.label}
          </span>
        </div>
        <div
          className="mono"
          style={{ marginTop: 6, fontSize: 'var(--t-s)', color: 'var(--ink-2)' }}
        >
          {task.task.branch}
          {sha ? ` · ${sha}` : ''}
          {task.scm?.pr_number != null ? ` · PR #${task.scm.pr_number}` : ''}
        </div>
        <p style={{ margin: '6px 0 0', color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>
          {copy.meaning}
        </p>
      </header>

      {openGates.length > 0 ? (
        <section
          style={{
            background: 'var(--bg-1)',
            borderBottom: '0.5px solid var(--line)',
            borderLeft: '2px solid var(--st-needs)',
            padding: '12px 16px',
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
              padding: '10px 16px',
              borderBottom: '0.5px solid var(--line)',
              color: 'var(--ink-2)',
              fontSize: 'var(--t-s)',
            }}
          >
            {copy.next}
          </section>
        )
      )}

      {task.status === 'queued' && <StartTask taskId={task.task.id} />}

      <nav
        style={{
          display: 'flex',
          gap: 2,
          padding: '8px 12px 0',
          borderBottom: '0.5px solid var(--line)',
        }}
      >
        {LANES.map((item) => {
          const selected = lane === item.id;
          return (
            <button
              key={item.id}
              data-lane={item.id}
              onClick={() => onLane(item.id)}
              style={{
                background: selected ? 'var(--bg-2)' : 'transparent',
                border: '0.5px solid',
                borderColor: selected ? 'var(--line)' : 'transparent',
                borderBottom: selected ? '0.5px solid var(--bg-2)' : '0.5px solid transparent',
                borderRadius: 'var(--radius) var(--radius) 0 0',
                marginBottom: -1,
                color: selected ? 'var(--ink)' : 'var(--ink-2)',
              }}
            >
              {item.label} <kbd>{item.chord}</kbd>
            </button>
          );
        })}
      </nav>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 16px' }}>
        {lane === 'transcript' && (
          <Transcript
            taskId={task.task.id}
            active
            refreshKey={task.agent?.last_event_at ?? null}
          />
        )}
        {lane === 'checks' && (
          <>
            <VerifyPlanReview taskId={task.task.id} />
            <VerifyRuns runs={task.latestVerifyRuns} />
          </>
        )}
        {lane === 'diff' && (
          <>
            <PrOpen task={task} />
            <ScmFacts task={task} />
            <TechnicalDetails task={task} />
          </>
        )}
        {lane === 'rules' && <Conventions repoId={task.task.repo_id} />}
      </div>

      <Composer task={task} />
    </div>
  );
}

function StartTask({ taskId }: { taskId: string }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <section style={{ padding: '12px 16px', borderBottom: '0.5px solid var(--line)' }}>
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
      <p style={{ margin: '8px 0 0', color: 'var(--ink-2)', fontSize: 'var(--t-xs)' }}>
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

function VerifyRuns({ runs }: { runs: VerifyRun[] }): JSX.Element | null {
  if (runs.length === 0) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <h2 style={{ margin: '0 0 8px', fontSize: 'var(--t-s)', fontWeight: 600 }}>Latest runs</h2>
      {runs.map((run) => (
        <div
          key={run.id}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto',
            gap: 8,
            padding: '6px 0',
            borderBottom: '0.5px solid var(--line)',
            fontSize: 'var(--t-s)',
          }}
        >
          <code className="mono" style={{ fontSize: 'var(--t-xs)' }}>
            {run.cmd}
          </code>
          <span className="mono" style={{ color: 'var(--ink-2)', fontSize: 'var(--t-xs)' }}>
            {run.exit_code == null
              ? 'Running'
              : run.exit_code === 0
                ? 'Passed'
                : `Exit ${run.exit_code}`}
            {run.finished_at ? ` · ${ago(run.finished_at)}` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

function ScmFacts({ task }: { task: TaskView }): JSX.Element | null {
  const scm = task.scm;
  if (!scm) return null;
  return (
    <div style={{ marginTop: 16 }}>
      {scm.pr_url && <Field label="Pull request" value={scm.pr_url} mono />}
      {scm.checks_state && <Field label="Checks" value={scm.checks_state} />}
      {scm.review_state && <Field label="Review" value={scm.review_state} />}
      {scm.mergeable && <Field label="Mergeable" value={scm.mergeable} />}
    </div>
  );
}

function TechnicalDetails({ task }: { task: TaskView }): JSX.Element {
  const probeFailures = task.agent?.probe_failures ?? 0;

  return (
    <section style={{ marginTop: 16 }}>
      <details>
        <summary style={{ cursor: 'default', color: 'var(--ink-2)' }}>
          Where this is running
        </summary>

        <div style={{ marginTop: 10 }}>
          <Field label="Branch" value={task.task.branch} mono />
          <Field
            label="Based on"
            value={`${task.task.base_sha.slice(0, 12)} on ${task.task.base_ref}`}
            mono
          />
          <Field label="Worktree" value={task.task.worktree_path} mono />
          <Field
            label="Workspace"
            value={task.task.substrate_workspace_id ?? 'Not created yet'}
            mono
          />
          <Field label="Pane" value={task.agent?.substrate_pane_id ?? 'No agent running'} mono />
          {task.scm?.pr_url && <Field label="Pull request" value={task.scm.pr_url} mono />}

          {probeFailures > 0 && (
            <p style={{ color: 'var(--st-rest)', fontSize: 'var(--t-xs)', marginTop: 8 }}>
              {probeFailures} failed {probeFailures === 1 ? 'probe' : 'probes'} — the status above
              may be behind what is really happening.
            </p>
          )}
        </div>
      </details>

      <div style={{ marginTop: 14 }}>
        <button onClick={() => void window.osade?.openInSubstrate()}>Open the terminal</button>
        <p style={{ margin: '8px 0 0', color: 'var(--ink-2)', fontSize: 'var(--t-xs)' }}>
          Watch the agent work, or talk to it directly. Osade does not embed a terminal
          (ADR 0001); this opens a real one on the same session.
        </p>
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 12, padding: '3px 0', alignItems: 'baseline' }}>
      <span style={{ width: 92, flexShrink: 0, color: 'var(--ink-2)', fontSize: 'var(--t-xs)' }}>
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
