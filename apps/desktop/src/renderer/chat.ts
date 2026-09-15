import type { TaskView } from '@osade/contract';

import { STATUS } from './status.js';

export interface ChatLine {
  id: string;
  role: 'user' | 'agent';
  agentId: string;
  text: string;
  live: boolean;
}

/** Strip the sibling-lane digest so it never shows up as a chat bubble. */
export function visibleUserText(text: string): string {
  return text.replace(/<osade_lanes>[\s\S]*?<\/osade_lanes>\s*/g, '').trim();
}

/**
 * Chat lines from facts the websocket already has — never pane.read.
 *
 * Claude Code (and every other registered agent) still runs in its pane; this is what the
 * person reads instead of that TUI.
 */
export function chatLines(task: TaskView, followUps: readonly string[] = []): ChatLine[] {
  const lines: ChatLine[] = [];
  const agentId = task.agentId || 'claude';
  const intent = visibleUserText(task.task.intent);
  if (intent) {
    lines.push({
      id: `${task.task.id}-intent`,
      role: 'user',
      agentId,
      text: intent,
      live: false,
    });
  }
  const seen = new Set([intent]);
  for (const [i, raw] of followUps.entries()) {
    const text = visibleUserText(raw);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push({
      id: `${task.task.id}-follow-${i}`,
      role: 'user',
      agentId,
      text,
      live: false,
    });
  }
  const agent = agentLine(task);
  if (agent) {
    lines.push({
      id: `${task.task.id}-agent`,
      role: 'agent',
      agentId,
      text: agent.text,
      live: agent.live,
    });
  }
  return lines;
}

function agentLine(task: TaskView): { text: string; live: boolean } | null {
  const fact = task.agent;
  const final = fact?.final_message?.trim();
  if (final) return { text: final, live: false };

  const activity = fact?.activity_text?.trim() ?? '';
  const tool = fact?.tool_name?.trim();
  const working = task.status === 'implementing' || task.status === 'verifying';

  if (working) {
    const parts = [activity || STATUS[task.status].label, tool ? `Using ${tool}` : ''].filter(Boolean);
    return { text: parts.join('\n'), live: true };
  }
  if (task.status === 'queued') return { text: 'Starting…', live: true };
  if (task.status === 'needs_input') return { text: activity || 'Waiting for you.', live: false };
  if (activity) return { text: activity, live: false };
  if (task.status === 'awaiting_review' || task.status === 'awaiting_approval') {
    return { text: STATUS[task.status].label, live: false };
  }
  return null;
}
