import { useEffect, useState, type JSX } from 'react';

import { api } from './api.js';

/**
 * Agent pane transcript — on demand via taskTranscript, never a render loop.
 * Refetches when the agent's last event moves, which arrives through useLedger.
 */
export function Transcript({
  taskId,
  active,
  refreshKey,
}: {
  taskId: string;
  active: boolean;
  refreshKey: number | string | null;
}): JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void api
      .taskTranscript(taskId)
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
  }, [taskId, active, refreshKey]);

  if (error) {
    return (
      <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>{error}</p>
    );
  }

  if (text == null) {
    return (
      <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 'var(--t-s)' }}>Loading transcript…</p>
    );
  }

  return (
    <div>
      {truncated && (
        <p style={{ margin: '0 0 8px', color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}>
          Truncated — showing the recent tail.
        </p>
      )}
      <pre
        className="mono"
        style={{
          margin: 0,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: 'var(--t-s)',
          color: 'var(--ink)',
        }}
      >
        {text || '(empty)'}
      </pre>
    </div>
  );
}
