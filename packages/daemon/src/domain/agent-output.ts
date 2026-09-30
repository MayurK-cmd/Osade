/**
 * Normalized agent output from signals Osade actually receives.
 *
 * Claude and Codex are screen-detected: partial text is a pane delta, activity is a terminal
 * title. OpenCode and Pi report lifecycle state through `pane.report_agent` (and a blocked
 * label), not tool calls or token streams. `tool_name` / `final_message` are used only when a
 * fact row already has them. Nothing here invents a tool event from prose.
 */

export const EMPTY_COMPLETION = 'Completed with no output.';

export type AgentOutputKind = 'partial_output' | 'final_output' | 'activity' | 'tool' | 'idle';

export type AgentOutputSource = 'pane' | 'provider' | 'title' | 'none';

export interface AgentOutput {
  kind: AgentOutputKind;
  source: AgentOutputSource;
  text: string | null;
  tool: string | null;
}

export interface OutputFact {
  stream_text?: string | null;
  final_message?: string | null;
  activity_text?: string | null;
  tool_name?: string | null;
  substrate_state?: string | null;
}

export function normalizeAgentOutput(fact: OutputFact | null | undefined): AgentOutput {
  if (!fact) return { kind: 'idle', source: 'none', text: null, tool: null };

  const stream = fact.stream_text?.trim() ?? '';
  if (stream.length > 0) {
    return { kind: 'partial_output', source: 'pane', text: stream, tool: null };
  }

  const finalMessage = fact.final_message?.trim() ?? '';
  if (finalMessage.length > 0) {
    return { kind: 'final_output', source: 'provider', text: finalMessage, tool: null };
  }

  const tool = fact.tool_name?.trim() ?? '';
  if (tool.length > 0) {
    return { kind: 'tool', source: 'provider', text: null, tool };
  }

  const activity = meaningfulActivity(fact.activity_text);
  if (activity) return { kind: 'activity', source: 'title', text: activity, tool: null };

  return { kind: 'idle', source: 'none', text: null, tool: null };
}

/** Phrase the transcript can show. Tool lines come from `tool_name`, not from parsed prose. */
export function outputPhrase(output: AgentOutput): string | null {
  if (output.kind === 'tool' && output.tool) return `Using ${output.tool}`;
  return output.text;
}

/**
 * Provider final message, then the pane delta, then the last streamed delta.
 * An empty turn becomes a completion record instead of disappearing.
 */
export function chooseFinalReply(input: {
  finalMessage?: string | null;
  paneText?: string | null;
  streamText?: string | null;
}): { source: 'provider' | 'pane' | 'stream' | 'empty'; text: string } {
  const finalMessage = input.finalMessage?.trim() ?? '';
  if (finalMessage.length > 0) return { source: 'provider', text: finalMessage };
  const pane = input.paneText?.trim() ?? '';
  if (pane.length > 0) return { source: 'pane', text: pane };
  const stream = input.streamText?.trim() ?? '';
  if (stream.length > 0) return { source: 'stream', text: stream };
  return { source: 'empty', text: EMPTY_COMPLETION };
}

/** Null means "do not write" — identical text, or a blank poll that must not wipe the stream. */
export function nextStreamText(current: string | null | undefined, incoming: string): string | null {
  const body = incoming.trim();
  if (body.length === 0) return null;
  if ((current ?? '').trim() === body) return null;
  return body;
}

/** Title from a status event, else the label the substrate attached to that state. */
export function activityFromStatus(input: {
  title?: string | null;
  status?: string | null;
  stateLabels?: Record<string, string> | null;
}): string | undefined {
  const title = input.title?.trim();
  if (title) return title;
  const status = input.status?.trim();
  if (!status || !input.stateLabels) return undefined;
  const label = input.stateLabels[status]?.trim();
  return label || undefined;
}

function meaningfulActivity(text: string | null | undefined): string | null {
  const value = text?.trim() ?? '';
  if (value.length === 0) return null;
  if (/^claude(?:\s+code)?$/iu.test(value)) return null;
  if (/^codex$/iu.test(value)) return null;
  if (/^opencode$/iu.test(value)) return null;
  if (/^pi$/iu.test(value)) return null;
  return value;
}
