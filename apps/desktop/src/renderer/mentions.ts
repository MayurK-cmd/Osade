export interface MentionTarget {
  agentId: string;
  text: string;
}

export interface ParsedMentions {
  shared: string;
  targets: MentionTarget[];
}

function isMentionBoundary(before: string): boolean {
  return before.length === 0 || /\s/u.test(before.at(-1)!);
}

/** Mentions at line start or after whitespace, against known catalog ids. */
export function parseMentions(raw: string, catalog: readonly string[]): ParsedMentions {
  const known = new Set(catalog.map((id) => id.toLowerCase()));
  const shared: string[] = [];
  const byAgent = new Map<string, string[]>();
  let activeAgent: string | null = null;
  let seenMention = false;

  function appendShared(text: string): void {
    const t = text.trimEnd();
    if (t.length > 0) shared.push(t);
  }

  function appendAgent(text: string): void {
    if (!activeAgent) return;
    const list = byAgent.get(activeAgent) ?? [];
    list.push(text);
    byAgent.set(activeAgent, list);
  }

  function startAgent(id: string): void {
    seenMention = true;
    activeAgent = id;
    if (!byAgent.has(id)) byAgent.set(id, []);
  }

  function tryMentionAt(line: string, index: number): { id: string; end: number } | null {
    if (!isMentionBoundary(line.slice(0, index))) return null;
    const match = /^@([a-z][a-z0-9_-]*)/iu.exec(line.slice(index));
    if (!match) return null;
    const id = match[1]!.toLowerCase();
    if (!known.has(id)) return null;
    return { id, end: index + match[0].length };
  }

  for (const line of raw.split(/\r?\n/u)) {
    if (!line.includes('@')) {
      if (!seenMention) shared.push(line);
      else appendAgent(line);
      continue;
    }

    let i = 0;
    let chunk = '';
    while (i < line.length) {
      if (line[i] === '@') {
        const mention = tryMentionAt(line, i);
        if (mention) {
          if (chunk.length > 0) {
            if (!seenMention) appendShared(chunk);
            else appendAgent(chunk);
            chunk = '';
          }
          startAgent(mention.id);
          i = mention.end;
          if (line[i] === ' ') i++;
          continue;
        }
      }
      chunk += line[i]!;
      i++;
    }
    if (chunk.length > 0) {
      if (!seenMention) appendShared(chunk);
      else appendAgent(chunk);
    }
  }

  return {
    shared: shared.join('\n').trim(),
    targets: [...byAgent.entries()].map(([agentId, lines]) => ({
      agentId,
      text: lines.join('\n').trim(),
    })),
  };
}

export function composeLanePrompt(shared: string, text: string): string {
  if (shared.length === 0) return text;
  if (text.length === 0) return shared;
  return `${shared}\n\n${text}`;
}

/** Existing lane for this agent, or null when the mention should open a new one. */
export function laneTarget<T extends { agentId: string }>(
  lanes: readonly T[],
  agentId: string,
): T | null {
  return lanes.find((lane) => lane.agentId === agentId) ?? null;
}

/** What actually gets sent to a lane. Empty `@claude` with no body must not become "". */
export function lanePrompt(parsed: ParsedMentions, target: MentionTarget, raw: string): string {
  const composed = composeLanePrompt(parsed.shared, target.text).trim();
  if (composed.length > 0) return composed;
  return raw.replace(/^@[a-z][a-z0-9_-]*\s*/iu, '').trim();
}
