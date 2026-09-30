export interface MentionTarget {
  agentId: string;
  text: string;
}

export interface ParsedMentions {
  shared: string;
  targets: MentionTarget[];
}

/**
 * A mentioned agent that was not installed when the message was composed.
 *
 * Validation runs before any task is created so the user sees the problem
 * before a broken lane appears in the sidebar.
 */
export interface UnavailableAgent {
  agentId: string;
}

export interface MentionValidation {
  /** Agents present in the parsed mention set that are not installed. */
  unavailable: UnavailableAgent[];
  /** Agents present in the catalog that are not installed, indexed by id. */
  ok: boolean;
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

/**
 * Validate mentioned agents against the installed catalog BEFORE creating any task.
 *
 * The catalog carries `installed: boolean` from the daemon's `agentCatalogList` query,
 * which probes PATH at call time (§8.1). A mentioned agent that has a valid catalog id
 * but is not installed should be reported here so the compositor can show a clear error
 * rather than letting the launch fail silently later.
 *
 * If no mentions are present the validation is vacuously successful — the primary lane
 * uses whatever default agent is configured for the repo, and that is validated separately
 * at launch time by the daemon.
 *
 * Unknown @names (not in catalog at all) are not in `parsed.targets` — parseMentions
 * already filters them to shared text — so they cannot trigger this path.
 */
export function validateMentionedAgents(
  parsed: ParsedMentions,
  catalog: ReadonlyArray<{ id: string; installed: boolean }>,
): MentionValidation {
  if (parsed.targets.length === 0) return { unavailable: [], ok: true };

  const byId = new Map(catalog.map((a) => [a.id, a]));
  const unavailable: UnavailableAgent[] = [];

  for (const target of parsed.targets) {
    const entry = byId.get(target.agentId);
    // entry will always be present because parseMentions only accepts known catalog IDs,
    // but guard defensively.
    if (entry && !entry.installed) {
      unavailable.push({ agentId: target.agentId });
    }
  }

  return { unavailable, ok: unavailable.length === 0 };
}

/**
 * Human-readable error for one or more unavailable agents.
 *
 * When some agents in a multi-mention message are available and some are not, the caller
 * decides whether to proceed with the available ones or block the whole send. This function
 * formats the diagnostic that is surfaced to the user either way.
 */
export function unavailableAgentMessage(unavailable: UnavailableAgent[]): string {
  if (unavailable.length === 0) return '';
  const names = unavailable.map((u) => `@${u.agentId}`).join(', ');
  const verb = unavailable.length === 1 ? 'is' : 'are';
  return (
    `${names} ${verb} not installed. Install the agent binary and ensure it is on PATH, ` +
    `then try again.`
  );
}
