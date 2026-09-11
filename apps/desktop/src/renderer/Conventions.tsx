import { useCallback, useEffect, useState, type CSSProperties, type JSX } from 'react';

import type { ConventionView, MineStatus } from '@osade/contract';

import { api } from './api.js';

/**
 * Repository conventions — OSADE.md §13.4.
 *
 * > Promotion to `active` requires either confidence ≥ 0.8 or one-click human confirmation in
 * > the UI. **Show the evidence next to the toggle.**
 *
 * That last sentence is the whole design of this panel. A rule with its citations beside it is
 * something you can check; the same rule alone on a line is indistinguishable from a model's
 * opinion, and confirming it would be an act of faith. So evidence is not behind a disclosure
 * triangle and not summarised — it is the row, and the links go to the pull request that
 * actually said it.
 */

const CATEGORY_LABEL: Record<ConventionView['category'], string> = {
  review_process: 'review process',
  scope_limits: 'scope',
  commit_style: 'commits',
  test_requirements: 'tests',
  file_ownership: 'ownership',
  communication: 'communication',
  ci_gates: 'CI',
};

const EVIDENCE_LABEL: Record<ConventionView['evidence'][number]['kind'], string> = {
  rejected_pr: 'rejected',
  merged_pr: 'merged',
  review_comment: 'review',
  ci_config: 'CI config',
  doc: 'stated',
};

export function Conventions({ repoId }: { repoId: string }): JSX.Element {
  const [status, setStatus] = useState<MineStatus | null>(null);
  const [rules, setRules] = useState<ConventionView[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [nextStatus, nextRules] = await Promise.all([
      api.mineStatus(repoId),
      api.conventionList(repoId),
    ]);
    setStatus(nextStatus);
    setRules(nextRules);
  }, [repoId]);

  useEffect(() => {
    void refresh().catch((err: Error) => setError(err.message));
  }, [refresh]);

  /**
   * Poll only while a run is live.
   *
   * Mining takes minutes and the daemon runs it in the background, so this is the one place the
   * panel needs a clock. It stops the moment the run does — §18.1's rule that the renderer is
   * never the source of truth cuts both ways, and a timer that keeps asking a finished question
   * is just noise on the wire.
   */
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(() => {
      void refresh().catch((err: Error) => setError(err.message));
    }, 2_000);
    return () => clearInterval(timer);
  }, [status?.running, refresh]);

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const candidates = rules.filter((r) => r.lifecycle === 'candidate');
  const active = rules.filter((r) => r.lifecycle === 'active');
  const dismissed = rules.filter((r) => r.lifecycle === 'rejected' || r.lifecycle === 'retired');

  return (
    <section style={{ padding: '8px 0' }}>
      {/* The heading lives on the disclosure that wraps this; repeating it here read as two
          panels stacked. The counts stay, because they are the reason to open it. */}
      <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)', margin: '0 0 10px' }}>
        <strong style={{ color: 'var(--ink)', fontWeight: 600 }}>
          {active.length} in use
          {candidates.length > 0 ? ` · ${candidates.length} awaiting you` : ''}
        </strong>
        <br />
        Mined from this repository&rsquo;s own review record. Every rule cites what it came from —
        check it before you turn it on, because active rules are given to every agent you launch.
      </p>

      {/* §13.4 — mining is explicit. It spends GitHub quota and model tokens. */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <button
          disabled={busy || !status?.available}
          title={status?.reason ?? undefined}
          style={buttonStyle}
          onClick={() => void run(() => api.mineRepo(repoId))}
        >
          {status?.running ? 'Mining…' : status?.lastRun ? 'Mine again' : 'Mine this repository'}
        </button>
        {status?.running && <Progress run={status.lastRun} />}
        {status && !status.available && !status.running && (
          <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>{status.reason}</span>
        )}
        {!status?.running && status?.lastRun?.error && (
          <span style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
            last run failed: {status.lastRun.error}
          </span>
        )}
      </div>

      {/* §13.4's weekly re-mine — offered, never performed unasked. */}
      {status?.dueForRemine && !status.running && (
        <p style={{ color: 'var(--st-needs)', fontSize: 'var(--t-xs)', margin: '-6px 0 12px' }}>
          Last mined over a week ago. Re-mining reads only what is new since then.
        </p>
      )}

      {error && <Err message={error} />}
      {note && (
        <p className="mono" style={{ fontSize: 'var(--t-xs)' }}>
          {note}
        </p>
      )}

      {candidates.length > 0 && (
        <Group title="Not in use yet" hint="Confirm one and every agent you launch is told about it.">
          {candidates.map((rule) => (
            <Rule
              key={rule.id}
              rule={rule}
              busy={busy}
              onConfirm={() => void run(() => api.conventionConfirm(rule.id))}
              onReject={() =>
                void run(() => api.conventionReject(rule.id, 'not a rule of this project'))
              }
            />
          ))}
        </Group>
      )}

      {active.length > 0 && (
        <Group
          title="In use"
          hint="Written into every agent's context, most confident and most recent first."
        >
          {active.map((rule) => (
            <Rule
              key={rule.id}
              rule={rule}
              busy={busy}
              onReject={() => void run(() => api.conventionReject(rule.id, 'turned off by you'))}
            />
          ))}
        </Group>
      )}

      {dismissed.length > 0 && (
        <Group title="Set aside" hint="Kept with their evidence, so the same rule is not re-mined blindly.">
          {dismissed.map((rule) => (
            <Rule key={rule.id} rule={rule} busy={busy} />
          ))}
        </Group>
      )}

      {rules.length === 0 && status?.lastRun && !status.lastRun.error && (
        <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
          Nothing met the evidence bar: a rule needs three observations from two different pull
          requests, or one from a CI config. That is a real answer about this repository, not a
          failure.
        </p>
      )}

      {/* §13.6 — the one number this feature exists to move. Allowed to disappoint. */}
      <button
        disabled={busy}
        style={{ ...buttonStyle, marginTop: 12 }}
        onClick={() =>
          void run(async () => {
            const impact = await api.conventionImpact(repoId);
            setNote(
              `review rounds to merge — with: ${fmt(impact.withConventions.meanReviewRounds)} ` +
                `(n=${impact.withConventions.n}), without: ` +
                `${fmt(impact.withoutConventions.meanReviewRounds)} (n=${impact.withoutConventions.n}). ` +
                impact.verdict,
            );
          })
        }
      >
        Did this help?
      </button>
    </section>
  );
}

/**
 * What a running mine is doing.
 *
 * Extraction is one model call per pull request and is where a run spends nearly all of its
 * time, so it is the only phase with a count worth showing. The others say what is happening and
 * leave it there rather than inventing a percentage.
 */
function Progress({ run }: { run: MineStatus['lastRun'] }): JSX.Element | null {
  if (!run?.phase) return null;

  const label: Record<NonNullable<MineStatus['lastRun']>['phase'] & string, string> = {
    fetching: 'reading the review record from GitHub',
    extracting: 'reading pull requests',
    clustering: 'grouping what it found',
    verifying: 'testing each rule against merged pull requests',
    interrupted: 'interrupted',
  };

  const counted = run.progressTotal > 0 ? ` ${run.progressDone}/${run.progressTotal}` : '';
  return (
    <span style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)' }}>
      {label[run.phase]}
      {counted}
    </span>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ font: 'inherit', fontSize: 'var(--t-s)', margin: '0 0 2px' }}>{title}</h4>
      <p style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)', margin: '0 0 6px' }}>{hint}</p>
      {children}
    </div>
  );
}

function Rule({
  rule,
  busy,
  onConfirm,
  onReject,
}: {
  rule: ConventionView;
  busy: boolean;
  onConfirm?: () => void;
  onReject?: () => void;
}): JSX.Element {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto',
        gap: 8,
        padding: '7px 0',
        borderBottom: '1px solid var(--rule)',
        opacity: rule.lifecycle === 'rejected' || rule.lifecycle === 'retired' ? 0.55 : 1,
      }}
    >
      <div>
        <div style={{ fontSize: 'var(--t-s)' }}>{rule.ruleText}</div>
        <div style={{ color: 'var(--ink-soft)', fontSize: 'var(--t-xs)', marginTop: 2 }}>
          {CATEGORY_LABEL[rule.category]} · confidence {rule.confidence.toFixed(2)}
          {rule.retiredReason && ` · ${rule.retiredReason}`}
        </div>

        {/* The evidence, beside the toggle — §13.4. */}
        <ul style={{ margin: '4px 0 0', padding: 0, listStyle: 'none' }}>
          {rule.evidence.slice(0, 5).map((e) => (
            <li key={e.url} style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-soft)' }}>
              <a href={e.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink-soft)' }}>
                {EVIDENCE_LABEL[e.kind]}
              </a>
              {e.excerpt && <span className="mono"> “{e.excerpt}”</span>}
            </li>
          ))}
          {rule.evidence.length > 5 && (
            <li style={{ fontSize: 'var(--t-xs)', color: 'var(--ink-soft)' }}>
              +{rule.evidence.length - 5} more
            </li>
          )}
        </ul>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {onConfirm && (
          <button disabled={busy} style={buttonStyle} onClick={onConfirm}>
            Use it
          </button>
        )}
        {onReject && (
          <button disabled={busy} style={buttonStyle} onClick={onReject}>
            {rule.lifecycle === 'active' ? 'Turn off' : 'Not a rule'}
          </button>
        )}
      </div>
    </div>
  );
}

function fmt(n: number | null): string {
  return n === null ? '—' : n.toFixed(2);
}

function Err({ message }: { message: string }): JSX.Element {
  // §19.4 — failures state what broke, in the interface's voice, never apologising.
  return (
    <p className="mono" style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
      {message}
    </p>
  );
}

const buttonStyle: CSSProperties = {
  padding: '5px 12px',
  border: '1px solid var(--rule)',
  borderRadius: 'var(--radius)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  font: 'inherit',
  cursor: 'pointer',
};
