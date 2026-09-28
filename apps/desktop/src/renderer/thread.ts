import type { ChatLine } from './chat.js';
import type { PendingLane } from './delivery.js';
import { startingLine } from './delivery.js';

export function mergeChatLines(lines: ChatLine[]): ChatLine[] {
  const ordered = [...lines].sort((a, b) => a.at - b.at);
  const seen = new Set<string>();
  return ordered.filter((line) => {
    if (line.role !== 'user') return true;
    const key = `${line.text}@${Math.floor(line.at / 2000)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function isAgentStatusLine(text: string): boolean {
  const t = text.trim();
  return t === '…' || t.startsWith('starting ') || /^Using \S+$/u.test(t);
}

const ACTIVITY_LINE =
  /^(?:using |reading |inspecting |checking |running |searching |editing |writing |looking |opening |starting |modified |updated |added |ran )\S/iu;

/**
 * Pull leading tool/activity lines off an agent message so the reply stays visible.
 * A message that is only activity is left intact as the response.
 */
export function partitionAgentText(text: string): { activity: string[]; response: string } {
  const raw = text.replace(/\r\n/gu, '\n').trim();
  if (!raw) return { activity: [], response: '' };
  const lines = raw.split('\n');
  const activity: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!.trim();
    if (line.length === 0) {
      if (activity.length === 0) {
        index += 1;
        continue;
      }
      break;
    }
    if (line === '…' || ACTIVITY_LINE.test(line)) {
      activity.push(line);
      index += 1;
      continue;
    }
    break;
  }
  const response = lines.slice(index).join('\n').trim();
  if (!response) return { activity: [], response: raw };
  return { activity, response };
}

export function formatWorkDuration(start: number, end: number): string {
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function agentStatusPhrase(live: boolean, duration: string | null): string {
  if (!duration) return '';
  return live ? `working for ${duration}` : `worked for ${duration}`;
}

export function summarizeFileChanges(stats: {
  files: number;
  add: number;
  del: number;
}): string {
  const noun = stats.files === 1 ? 'file' : 'files';
  return `${stats.files} changed ${noun} +${stats.add} -${stats.del}`;
}

/** Intent passed to the Diff tab for a lane's task. */
export function openDiffIntent(taskId: string): { taskId: string; lane: 'diff' } {
  return { taskId, lane: 'diff' };
}

export function pendingChatLines(
  pending: readonly PendingLane[],
  taskIdsByAgent: ReadonlyMap<string, string>,
): ChatLine[] {
  const now = Date.now();
  return pending.map((p) => ({
    id: `pending-${p.chatId}-${p.agentId}`,
    role: 'agent',
    agentId: p.agentId,
    taskId: taskIdsByAgent.get(p.agentId) ?? `pending-${p.agentId}`,
    text: p.phase === 'failed' ? (p.error ?? 'Launch failed') : startingLine(p.agentId),
    live: p.phase === 'starting',
    failed: p.phase === 'failed',
    at: now,
  }));
}
