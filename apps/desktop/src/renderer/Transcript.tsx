import { useEffect, useState, type CSSProperties, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { agentColor } from './agent-color.js';
import { chatLines, type ChatLine } from './chat.js';

/**
 * Chat for one or more lanes. Agents keep running in their panes; this view never reads the
 * terminal (no pane.read, no TUI dump).
 */
export function Transcript({
  tasks,
  extraUser,
  followTaskId,
  isolatedNotice,
}: {
  tasks: TaskView[];
  extraUser?: string;
  followTaskId?: string;
  isolatedNotice?: string;
}): JSX.Element {
  const [followUps, setFollowUps] = useState<string[]>([]);

  useEffect(() => {
    const text = extraUser?.trim();
    if (!text) return;
    setFollowUps((prev) => (prev.includes(text) ? prev : [...prev, text]));
  }, [extraUser]);

  const lines =
    tasks.length === 0
      ? extraUser
        ? [
            {
              id: 'draft',
              role: 'user' as const,
              agentId: 'claude',
              text: extraUser,
              live: false,
            },
          ]
        : []
      : tasks.flatMap((task) =>
          chatLines(
            task,
            followTaskId == null || task.task.id === followTaskId || tasks.length === 1
              ? followUps
              : [],
          ),
        );

  if (lines.length === 0) {
    return (
      <div>
        {isolatedNotice && (
          <p style={{ margin: '0 0 10px', color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>
            {isolatedNotice}
          </p>
        )}
        <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 'var(--t-s)' }}>
          Nothing here yet. Write below to start this chat.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: '42em' }}>
      {lines.map((line) => (
        <Bubble key={line.id} line={line} />
      ))}
    </div>
  );
}

function Bubble({ line }: { line: ChatLine }): JSX.Element {
  const colour = agentColor(line.agentId);
  const mine = line.role === 'user';
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: mine ? 'flex-end' : 'flex-start',
        gap: 4,
      }}
    >
      <span className="mono" style={{ fontSize: 'var(--t-xs)', color: mine ? 'var(--ink-3)' : colour }}>
        {mine ? 'You' : line.agentId}
        {line.live ? ' · working' : ''}
      </span>
      <div
        style={{
          ...bodyStyle,
          background: mine ? 'var(--bg-2)' : 'transparent',
          borderLeft: mine ? undefined : `2px solid ${colour}`,
          padding: mine ? '8px 12px' : '2px 0 2px 12px',
          borderRadius: mine ? 'var(--radius)' : 0,
        }}
      >
        {line.text}
      </div>
    </div>
  );
}

const bodyStyle: CSSProperties = {
  fontSize: 'var(--t-m)',
  lineHeight: 1.5,
  color: 'var(--ink)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxWidth: '100%',
};
