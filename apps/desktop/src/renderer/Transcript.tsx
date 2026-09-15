import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { agentColor } from './agent-color.js';
import { api } from './api.js';
import { chatLines, type ChatLine } from './chat.js';

/**
 * Chat for one or more lanes: your text, then Claude's reply, repeating.
 *
 * User bubbles are the prompts Osade sent. Replies are sliced out of on-demand `pane.read`
 * (§4.4.1) at ≤1 Hz — Claude/codex never write `final_message`.
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
  const panes = usePaneTranscripts(tasks);

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
            panes[task.task.id],
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
      <ScrollAnchor token={lines.map((l) => l.id + l.text.length).join('|')} />
    </div>
  );
}

/** §4.4.1 — one pane.read per live lane per second, skipped when revision is unchanged. */
function usePaneTranscripts(tasks: TaskView[]): Record<string, string> {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const revisions = useRef<Record<string, number>>({});
  const lastErrorLog = useRef(0);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const stamp = tasks
    .map((t) => `${t.task.id}:${t.agent?.substrate_pane_id ?? ''}:${t.agent?.last_event_at ?? 0}:${t.status}`)
    .join('|');

  useEffect(() => {
    let cancelled = false;

    async function pull(): Promise<void> {
      await Promise.all(
        tasksRef.current.map(async (task) => {
          if (!task.agent?.substrate_pane_id) return;
          try {
            const result = await api.taskTranscript(task.task.id, 400);
            if (cancelled) return;
            if (revisions.current[task.task.id] === result.revision) return;
            revisions.current[task.task.id] = result.revision;
            setTexts((prev) =>
              prev[task.task.id] === result.text ? prev : { ...prev, [task.task.id]: result.text },
            );
          } catch (err) {
            const now = Date.now();
            if (now - lastErrorLog.current > 5_000) {
              lastErrorLog.current = now;
              window.osade?.log?.(`taskTranscript ${task.task.id}: ${(err as Error).message}`);
            }
          }
        }),
      );
    }

    void pull();
    const tick = window.setInterval(() => void pull(), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [stamp]);

  return texts;
}

function ScrollAnchor({ token }: { token: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'end' });
  }, [token]);
  return <div ref={ref} />;
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
