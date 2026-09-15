import { useEffect, useRef, useState, type CSSProperties, type JSX } from 'react';

import type { TaskView } from '@osade/contract';

import { agentColor } from './agent-color.js';
import { api } from './api.js';
import { chatLines, type ChatLine } from './chat.js';

/** Survives Chat ↔ Files remounts for this window. */
const followUpsByTask = new Map<string, string[]>();

/**
 * Chat for one or more lanes: your text, then the agent's reply, repeating.
 *
 * User bubbles are the prompts Osade sent. Replies are sliced out of on-demand `pane.read`
 * (§4.4.1) — only while the agent is live, never as a TUI dump.
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
  const [, bump] = useState(0);
  const panes = usePaneTranscripts(tasks);

  useEffect(() => {
    const text = extraUser?.trim();
    const id = followTaskId;
    if (!text || !id) return;
    const prev = followUpsByTask.get(id) ?? [];
    if (prev.includes(text)) return;
    followUpsByTask.set(id, [...prev, text]);
    bump((n) => n + 1);
  }, [extraUser, followTaskId]);

  if (tasks.length === 0 && !extraUser) {
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

  const lanes =
    tasks.length === 0
      ? [
          {
            id: 'draft',
            agentId: 'claude',
            lines: extraUser
              ? [
                  {
                    id: 'draft',
                    role: 'user' as const,
                    agentId: 'claude',
                    text: extraUser,
                    live: false,
                  },
                ]
              : [],
          },
        ]
      : tasks.map((task) => ({
          id: task.task.id,
          agentId: task.agentId,
          lines: chatLines(task, followUpsByTask.get(task.task.id) ?? [], panes[task.task.id]),
        }));

  const token = lanes.flatMap((l) => l.lines).map((l) => `${l.id}:${l.text.length}`).join('|');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, maxWidth: '38em' }}>
      {isolatedNotice && (
        <p style={{ margin: 0, color: 'var(--ink-2)', fontSize: 'var(--t-s)' }}>{isolatedNotice}</p>
      )}
      {lanes.map((lane) => (
        <section key={lane.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {lanes.length > 1 && lane.agentId && (
            <div
              className="mono"
              style={{ fontSize: 'var(--t-xs)', color: agentColor(lane.agentId), paddingLeft: 2 }}
            >
              {lane.agentId}
            </div>
          )}
          {lane.lines.map((line) => (
            <Bubble key={line.id} line={line} />
          ))}
        </section>
      ))}
      <ScrollAnchor token={token} />
    </div>
  );
}

/** §4.4.1 — pane.read while the agent is live; one shot once it settles. */
function usePaneTranscripts(tasks: TaskView[]): Record<string, string> {
  const [texts, setTexts] = useState<Record<string, string>>({});
  const revisions = useRef<Record<string, number>>({});
  const lastErrorLog = useRef(0);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const live = tasks.some(
    (t) => t.status === 'implementing' || t.status === 'verifying' || t.status === 'queued',
  );
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
    if (!live) return () => {
      cancelled = true;
    };
    const tick = window.setInterval(() => void pull(), 800);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
    };
  }, [stamp, live]);

  return texts;
}

function ScrollAnchor({ token }: { token: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    const scroller = node?.closest('[data-chat-scroll]') as HTMLElement | null;
    if (!scroller) {
      node?.scrollIntoView({ block: 'end' });
      return;
    }
    const gap = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (gap < 96) scroller.scrollTop = scroller.scrollHeight;
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
        gap: 3,
      }}
    >
      <span className="mono" style={{ fontSize: 'var(--t-xs)', color: mine ? 'var(--ink-3)' : colour }}>
        {mine ? 'You' : line.agentId}
        {line.live ? ' · working' : ''}
      </span>
      <div
        style={{
          ...bodyStyle,
          background: mine ? 'var(--bg-2)' : 'var(--bg-1)',
          border: '0.5px solid var(--line)',
          borderLeft: mine ? '0.5px solid var(--line)' : `2px solid ${colour}`,
          padding: '8px 12px',
          borderRadius: 'var(--radius)',
          maxWidth: 'min(100%, 32em)',
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
};
