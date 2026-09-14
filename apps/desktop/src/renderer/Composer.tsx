import { useState, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { api } from './api.js';
import { chord } from './chords.js';

export function isLiveAgent(task: TaskView): boolean {
  return task.agent?.pane_alive === true && task.agent.terminated !== true;
}

/** Prompt the live agent. Does not patch task state — the change arrives through useLedger. */
export function Composer({ task }: { task: TaskView }): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = isLiveAgent(task);
  const ready = live && text.trim().length > 0 && !busy;

  function send(): void {
    if (!ready) return;
    const payload = text.trim();
    setBusy(true);
    setError(null);
    void api
      .taskSend(task.task.id, payload)
      .then(() => setText(''))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }

  return (
    <div
      style={{
        borderTop: '0.5px solid var(--line)',
        padding: '10px 16px 12px',
        background: 'var(--bg-1)',
        borderRadius: '0 0 var(--radius-panel) var(--radius-panel)',
      }}
    >
      <textarea
        rows={3}
        disabled={!live || busy}
        value={text}
        placeholder={live ? 'Write to the agent' : 'No live agent on this task'}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            send();
          }
        }}
        style={{ fontSize: 'var(--t-m)' }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <button className="primary" disabled={!ready} onClick={send}>
          {busy ? 'Sending…' : 'Send'}
        </button>
        <kbd>{chord('enter')}</kbd>
        {error && (
          <span className="mono" style={{ color: 'var(--st-fail)', fontSize: 'var(--t-xs)' }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
