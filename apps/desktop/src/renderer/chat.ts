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
 * Chat turns: your message, then Claude's reply, then yours, then Claude's.
 *
 * The pane is a CLI dump. We locate each user prompt in it and take the text *between* prompts
 * as the reply — never the whole TUI as one blob under the conversation.
 */
export function chatLines(
  task: TaskView,
  followUps: readonly string[] = [],
  paneText?: string | null,
): ChatLine[] {
  const agentId = task.agentId || 'claude';
  const users = userTexts(task, followUps);
  const working = task.status === 'implementing' || task.status === 'verifying';
  const replies = splitPaneReplies(paneText ?? '', users);
  const lines: ChatLine[] = [];

  for (let i = 0; i < users.length; i++) {
    const user = users[i]!;
    lines.push({
      id: i === 0 ? `${task.task.id}-intent` : `${task.task.id}-follow-${i - 1}`,
      role: 'user',
      agentId,
      text: user,
      live: false,
    });

    const reply = replies[i]?.trim() ?? '';
    const last = i === users.length - 1;
    if (reply) {
      lines.push({
        id: `${task.task.id}-agent-${i}`,
        role: 'agent',
        agentId,
        text: reply,
        live: last && working,
      });
      continue;
    }
    if (!last) continue;
    const fallback = agentLine(task);
    if (fallback) {
      lines.push({
        id: `${task.task.id}-agent-${i}`,
        role: 'agent',
        agentId,
        text: fallback.text,
        live: fallback.live,
      });
    }
  }

  return lines;
}

function userTexts(task: TaskView, followUps: readonly string[]): string[] {
  const intent = visibleUserText(task.task.intent);
  const users: string[] = [];
  const seen = new Set<string>();
  if (intent) {
    users.push(intent);
    seen.add(intent);
  }
  for (const raw of followUps) {
    const text = visibleUserText(raw);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    users.push(text);
  }
  return users;
}

/** One reply per user turn, sliced out of the pane. Empty when that turn has no output yet. */
export function splitPaneReplies(paneText: string, users: readonly string[]): string[] {
  const replies = users.map(() => '');
  if (users.length === 0) return replies;

  const peeled = peelBoxes(paneText);
  if (!peeled.trim()) return replies;

  const spans: { start: number; end: number }[] = [];
  let from = 0;
  for (const user of users) {
    const found = locateUser(peeled, user, from);
    if (!found) {
      spans.push({ start: -1, end: -1 });
      continue;
    }
    spans.push(found);
    from = found.end;
  }

  const foundAny = spans.some((s) => s.start >= 0);
  if (!foundAny) {
    replies[replies.length - 1] = cleanReply(peeled, users);
    return replies;
  }

  for (let i = 0; i < users.length; i++) {
    const span = spans[i]!;
    if (span.start < 0) continue;
    const next = spans.slice(i + 1).find((s) => s.start >= 0);
    const raw = peeled.slice(span.end, next ? next.start : peeled.length);
    replies[i] = cleanReply(raw, users);
  }
  return replies;
}

function locateUser(
  haystack: string,
  user: string,
  from: number,
): { start: number; end: number } | null {
  const slice = haystack.slice(from);
  const needles = [`then: ${user}`, `> ${user}`, user];
  for (const needle of needles) {
    const found = findIgnoreWs(slice, needle);
    if (found) return { start: from + found.start, end: from + found.end };
  }
  const shortened = user.replace(/\s+/g, ' ').trim().slice(0, 48);
  if (shortened.length >= 12 && shortened !== user) {
    const found = findIgnoreWs(slice, shortened);
    if (found) return { start: from + found.start, end: from + found.end };
  }
  return null;
}

function findIgnoreWs(haystack: string, needle: string): { start: number; end: number } | null {
  const target = compactChars(needle);
  if (target.length === 0) return null;

  const map: number[] = [];
  let compact = '';
  for (let i = 0; i < haystack.length; i++) {
    const ch = haystack[i]!;
    if (/\s/u.test(ch)) continue;
    map.push(i);
    compact += ch.toLowerCase();
  }

  const at = compact.indexOf(target);
  if (at < 0) return null;
  const last = at + target.length - 1;
  const start = map[at];
  const endIdx = map[last];
  if (start == null || endIdx == null) return null;
  return { start, end: endIdx + 1 };
}

function compactChars(text: string): string {
  let out = '';
  for (const ch of text) {
    if (/\s/u.test(ch)) continue;
    out += ch.toLowerCase();
  }
  return out;
}

function peelBoxes(text: string): string {
  return text.replace(/[─━│┃┌┐└┘├┤┬┴┼╭╮╯╰═║╔╗╚╝╠╣╦╩╬▀▄]/gu, ' ');
}

function cleanReply(text: string, users: readonly string[]): string {
  const skipUser = new Set(users.map((u) => compactChars(u)).filter((u) => u.length > 0));
  const lines = text.split(/\r?\n/u).map((line) => line.replace(/^\s*[>|❯]\s?/u, ''));
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push('');
      continue;
    }
    if (/^esc to interrupt/iu.test(trimmed)) continue;
    if (/^to interrupt/iu.test(trimmed)) continue;
    if (/ctrl\s*[+c-]/iu.test(trimmed) && trimmed.length < 48) continue;
    if (/^first read .+, then:/iu.test(trimmed)) continue;
    if (/^claude(?:\s+code)?$/iu.test(trimmed)) continue;
    if (/^ready for you to look$/iu.test(trimmed)) continue;
    if (skipUser.has(compactChars(trimmed))) continue;
    kept.push(line.replace(/\s+$/u, ''));
  }
  return kept.join('\n').replace(/\n{3,}/gu, '\n\n').trim();
}

function agentLine(task: TaskView): { text: string; live: boolean } | null {
  const fact = task.agent;
  const final = fact?.final_message?.trim();
  if (final) return { text: final, live: false };

  const activity = fact?.activity_text?.trim() ?? '';
  const tool = fact?.tool_name?.trim();
  const working = task.status === 'implementing' || task.status === 'verifying';

  if (working) {
    const parts = [activity || '…', tool ? `Using ${tool}` : ''].filter(Boolean);
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
