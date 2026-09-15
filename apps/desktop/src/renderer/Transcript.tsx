import { useEffect, useState, type JSX } from 'react';

import { agentColor } from './agent-color.js';
import { api } from './api.js';

export interface TranscriptLane {
  taskId: string;
  agentId: string;
}

/**
 * Agent pane transcripts — on demand via taskTranscript, never a render loop.
 * `prefix` is an optimistic local line shown until the pane catches up.
 */
export function Transcript({
  lanes,
  filter,
  active,
  refreshKey,
  prefix,
}: {
  lanes: TranscriptLane[];
  filter?: string | null;
  active: boolean;
  refreshKey: number | string | null;
  prefix?: string;
}): JSX.Element {
  const shown = filter ? lanes.filter((l) => l.agentId === filter) : lanes;
  const empty = shown.length === 0;

  if (empty && !prefix) {
    return (
      <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 'var(--t-s)' }}>
        Nothing here yet. Write below to start this chat.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {prefix && shown.length === 0 && <pre className="mono" style={preStyle}>{prefix}</pre>}
      {shown.map((lane) => (
        <LaneTranscript
          key={lane.taskId}
          lane={lane}
          tagged={lanes.length > 1 && !filter}
          active={active}
          refreshKey={refreshKey}
          prefix={prefix}
        />
      ))}
    </div>
  );
}

function LaneTranscript({
  lane,
  tagged,
  active,
  refreshKey,
  prefix,
}: {
  lane: TranscriptLane;
  tagged: boolean;
  active: boolean;
  refreshKey: number | string | null;
  prefix?: string;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colour = agentColor(lane.agentId);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void api
      .taskTranscript(lane.taskId)
      .then((result) => {
        if (cancelled) return;
        setText(result.text);
        setTruncated(result.truncated);
        setError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setText(null);
        setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [lane.taskId, active, refreshKey]);

  const body = [prefix, text].filter((part) => part && part.length > 0).join('\n\n');

  return (
    <section
      style={{
        borderLeft: tagged ? `2px solid ${colour}` : undefined,
        paddingLeft: tagged ? 12 : 0,
      }}
    >
      {tagged && (
        <div
          className="mono"
          style={{ color: colour, fontSize: 'var(--t-xs)', marginBottom: 6 }}
        >
          {lane.agentId}
        </div>
      )}
      {truncated && (
        <p style={{ margin: '0 0 8px', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}>
          Truncated — showing the recent tail.
        </p>
      )}
      {error && !prefix ? (
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>{error}</p>
      ) : text == null && !prefix ? (
        <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 'var(--t-s)' }}>Loading transcript…</p>
      ) : (
        <pre className="mono" style={preStyle}>
          {body || '(empty)'}
        </pre>
      )}
    </section>
  );
}

const preStyle = {
  margin: 0,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
  fontSize: 'var(--t-s)',
  color: 'var(--ink)',
};
