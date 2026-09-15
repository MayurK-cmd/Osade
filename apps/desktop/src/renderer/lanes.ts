import type { TaskStatus, TaskView } from '@osade/contract';

import { SORT_RANK } from './status.js';

export interface ChatGroup {
  chatId: string;
  title: string;
  lanes: TaskView[];
  status: TaskStatus;
  needsYou: boolean;
}

export function groupChats(tasks: TaskView[]): ChatGroup[] {
  const map = new Map<string, TaskView[]>();
  for (const task of tasks) {
    const id = task.chatId || task.task.chat_id || task.task.id;
    const list = map.get(id) ?? [];
    list.push(task);
    map.set(id, list);
  }
  return [...map.values()].map((lanes) => {
    const ordered = [...lanes].sort((a, b) => a.task.created_at - b.task.created_at);
    const first = ordered[0]!;
    return {
      chatId: first.chatId || first.task.chat_id || first.task.id,
      title: first.task.title,
      lanes: ordered,
      status: worstStatus(ordered.map((l) => l.status)),
      needsYou: ordered.some((l) => l.needsYou),
    };
  });
}

export function primaryLane(chat: ChatGroup): TaskView {
  return chat.lanes[0]!;
}

export function worstStatus(statuses: TaskStatus[]): TaskStatus {
  let best: TaskStatus = statuses[0] ?? 'queued';
  let bestRank = SORT_RANK[best];
  for (const status of statuses) {
    const rank = SORT_RANK[status];
    if (rank < bestRank) {
      best = status;
      bestRank = rank;
    }
  }
  return best;
}

export function laneDigest(self: TaskView, lanes: TaskView[]): string | null {
  const siblings = lanes.filter((lane) => lane.task.id !== self.task.id);
  if (siblings.length === 0) return null;

  const since = self.agent?.last_event_at ?? 0;
  const lines: string[] = [];
  for (const lane of siblings) {
    if (lines.length >= 6) break;
    const at = lane.agent?.last_event_at ?? lane.task.created_at;
    if (at < since) continue;
    lines.push(`- ${lane.agentId} on ${lane.task.branch}: ${digestLine(lane)}`);
  }
  if (lines.length === 0) return null;
  return ['<osade_lanes>', 'Other agents in this chat, since your last turn:', ...lines, '</osade_lanes>'].join(
    '\n',
  );
}

function digestLine(lane: TaskView): string {
  const bits: string[] = [lane.status.replace(/_/g, ' ')];
  if (lane.scm?.checks_state === 'success') bits.push('checks passing');
  if (lane.scm?.checks_state === 'failure') bits.push('checks failing');
  if (lane.latestVerifyRuns.some((r) => r.finished_at == null)) bits.push('verifying');
  const failed = lane.latestVerifyRuns.some((r) => r.required && r.exit_code != null && r.exit_code !== 0);
  if (failed) bits.push('verify failed');
  return bits.join(', ');
}

export function withDigest(text: string, digest: string | null): string {
  if (digest == null) return text;
  return `${digest}\n\n${text}`;
}
