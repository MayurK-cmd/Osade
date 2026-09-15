import type { ChatTurn, TaskView } from '@osade/contract';

export interface ChatLine {
  id: string;
  role: 'user' | 'agent';
  agentId: string;
  text: string;
  live: boolean;
  held?: boolean;
}

/** Strip the sibling-lane digest so it never shows up as a chat bubble. */
export function visibleUserText(text: string): string {
  return text.replace(/<osade_lanes>[\s\S]*?<\/osade_lanes>\s*/g, '').trim();
}

/**
 * Chat turns from the daemon's durable timeline — never from a pane scrape.
 *
 * A live agent line is overlaid from agent_fact while a turn is in flight; settled replies
 * are stored as agent turns when the pane goes quiet.
 */
export function chatLines(task: TaskView, followUps: readonly string[] = []): ChatLine[] {
  const agentId = task.agentId || 'claude';
  const turns = [...(task.turns ?? [])].sort((a, b) => a.seq - b.seq);
  const lines: ChatLine[] = [];

  if (turns.length === 0) {
    const intent = visibleUserText(task.task.intent);
    if (intent) {
      lines.push({ id: `${task.task.id}-intent`, role: 'user', agentId, text: intent, live: false });
    }
    for (let i = 0; i < followUps.length; i++) {
      const text = visibleUserText(followUps[i] ?? '');
      if (!text || text === intent) continue;
      lines.push({
        id: `${task.task.id}-follow-${i}`,
        role: 'user',
        agentId,
        text,
        live: false,
        held: true,
      });
    }
    const live = agentOverlay(task);
    if (live) lines.push(live);
    return lines;
  }

  for (const turn of turns) {
    const text = turn.role === 'user' ? visibleUserText(turn.text) : turn.text.trim();
    if (!text) continue;
    lines.push(lineFromTurn(turn, agentId, text));
  }

  const seen = new Set(lines.filter((l) => l.role === 'user').map((l) => l.text));
  for (let i = 0; i < followUps.length; i++) {
    const text = visibleUserText(followUps[i] ?? '');
    if (!text || seen.has(text)) continue;
    seen.add(text);
    lines.push({
      id: `${task.task.id}-follow-${i}`,
      role: 'user',
      agentId,
      text,
      live: false,
      held: true,
    });
  }

  const lastTurn = turns.at(-1);
  const lastLine = lines.at(-1);
  const overlay =
    lastTurn?.role === 'user' || lastLine?.held ? agentOverlay(task) : lastTurn == null ? agentOverlay(task) : null;
  if (overlay && lastLine?.role === 'agent' && lastLine.text === overlay.text) return lines;
  if (overlay) lines.push(overlay);
  return lines;
}

function lineFromTurn(turn: ChatTurn, agentId: string, text: string): ChatLine {
  return {
    id: turn.id,
    role: turn.role,
    agentId,
    text,
    live: turn.delivery === 'sending',
    held: turn.delivery === 'queued',
  };
}

function agentOverlay(task: TaskView): ChatLine | null {
  const fact = task.agent;
  const final = fact?.final_message?.trim();
  if (final) {
    return { id: `${task.task.id}-agent-live`, role: 'agent', agentId: task.agentId, text: final, live: false };
  }
  const working = task.status === 'implementing' || task.status === 'verifying' || task.status === 'queued';
  if (working) {
    const tool = fact?.tool_name?.trim();
    const activity = workingLabel(fact?.activity_text ?? '', task.agentId);
    const parts = [activity, tool ? `Using ${tool}` : ''].filter(Boolean);
    return {
      id: `${task.task.id}-agent-live`,
      role: 'agent',
      agentId: task.agentId,
      text: parts.join('\n'),
      live: true,
    };
  }
  if (task.status === 'needs_input') {
    return {
      id: `${task.task.id}-agent-live`,
      role: 'agent',
      agentId: task.agentId,
      text: workingLabel(fact?.activity_text ?? '', task.agentId) || 'Waiting for you.',
      live: false,
    };
  }
  return null;
}

function workingLabel(activity: string, agentId: string): string {
  const t = activity.trim();
  if (!t) return '…';
  if (t.toLowerCase() === (agentId || 'claude').toLowerCase()) return '…';
  if (/^claude(?:\s+code)?$/iu.test(t)) return '…';
  return t;
}
