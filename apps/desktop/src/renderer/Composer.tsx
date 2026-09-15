import { useEffect, useMemo, useRef, useState, type JSX } from 'react';

import { agentColor } from './agent-color.js';
import { chord } from './chords.js';
import { parseMentions } from './mentions.js';
import type { CatalogAgent } from './RepoSettings.js';

/** Composer for a chat or a local draft tab. Parent owns the send path. */
export function Composer({
  placeholder,
  disabled,
  autoFocus,
  catalog = [],
  onSend,
}: {
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  catalog?: CatalogAgent[];
  onSend: (text: string) => Promise<void>;
}): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const ready = !disabled && !busy && text.trim().length > 0;

  const ids = catalog.map((a) => a.id);
  const mentions = useMemo(() => parseMentions(text, ids), [text, ids]);
  const prefix = mentionPrefix(text);
  const suggestions = prefix == null
    ? []
    : catalog.filter((a) => a.id.startsWith(prefix) || a.displayName.toLowerCase().startsWith(prefix));

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    setHint(0);
  }, [prefix]);

  function send(): void {
    if (!ready) return;
    const payload = text.trim();
    setBusy(true);
    setError(null);
    void onSend(payload)
      .then(() => setText(''))
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }

  function insertMention(id: string): void {
    const next = text.replace(/(?:^|\n)@[a-z0-9_-]*$/iu, (chunk) => {
      const lead = chunk.startsWith('\n') ? '\n' : '';
      return `${lead}@${id} `;
    });
    setText(next.endsWith(`@${id} `) || next.includes(`@${id} `) ? next : `${text.replace(/@[a-z0-9_-]*$/iu, '')}@${id} `);
    ref.current?.focus();
  }

  return (
    <div
      style={{
        borderTop: '0.5px solid var(--line)',
        padding: '10px 16px 12px',
        background: 'var(--bg-1)',
      }}
    >
      {mentions.targets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {mentions.targets.map((target) => (
            <span
              key={target.agentId}
              className="mono"
              style={{
                fontSize: 'var(--t-xs)',
                color: agentColor(target.agentId),
                border: `0.5px solid ${agentColor(target.agentId)}`,
                borderRadius: 999,
                padding: '1px 8px',
              }}
            >
              @{target.agentId}
            </span>
          ))}
        </div>
      )}
      <div style={{ position: 'relative' }}>
        <textarea
          ref={ref}
          rows={3}
          disabled={disabled || busy}
          value={text}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (suggestions.length > 0 && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              event.preventDefault();
              const delta = event.key === 'ArrowDown' ? 1 : -1;
              setHint((h) => (h + delta + suggestions.length) % suggestions.length);
              return;
            }
            if (suggestions.length > 0 && (event.key === 'Tab' || event.key === 'Enter') && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              const pick = suggestions[hint];
              if (pick && pick.installed) insertMention(pick.id);
              return;
            }
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.stopPropagation();
              send();
            }
          }}
          style={{ fontSize: 'var(--t-m)' }}
        />
        {suggestions.length > 0 && (
          <ul
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: '100%',
              margin: 0,
              padding: '4px 0',
              listStyle: 'none',
              background: 'var(--bg-2)',
              border: '0.5px solid var(--line)',
              borderRadius: 'var(--radius)',
              zIndex: 5,
            }}
          >
            {suggestions.map((agent, i) => (
              <li key={agent.id}>
                <button
                  type="button"
                  disabled={!agent.installed}
                  title={agent.installed ? undefined : `${agent.displayName} is not on PATH`}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (agent.installed) insertMention(agent.id);
                  }}
                  style={{
                    display: 'flex',
                    width: '100%',
                    justifyContent: 'space-between',
                    background: i === hint ? 'var(--bg-3)' : 'transparent',
                    border: 'none',
                    borderRadius: 0,
                    color: agent.installed ? agentColor(agent.id) : 'var(--ink-3)',
                    textAlign: 'left',
                    padding: '5px 10px',
                  }}
                >
                  <span>@{agent.id}</span>
                  <span style={{ color: 'var(--ink-3)', fontSize: 'var(--t-xs)' }}>
                    {agent.installed ? agent.displayName : 'Not on PATH'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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

function mentionPrefix(text: string): string | null {
  const line = text.split(/\r?\n/u).at(-1) ?? '';
  const match = /^@([a-z0-9_-]*)$/iu.exec(line);
  return match ? (match[1] ?? '').toLowerCase() : null;
}
