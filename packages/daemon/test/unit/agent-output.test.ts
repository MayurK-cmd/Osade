import { describe, expect, it } from 'vitest';

import {
  EMPTY_COMPLETION,
  activityFromStatus,
  chooseFinalReply,
  nextStreamText,
  normalizeAgentOutput,
  outputPhrase,
} from '../../src/domain/agent-output.js';

describe('normalizeAgentOutput', () => {
  it('keeps a pane delta as partial output', () => {
    expect(normalizeAgentOutput({ stream_text: 'Fixed auth.ts', substrate_state: 'working' })).toEqual({
      kind: 'partial_output',
      source: 'pane',
      text: 'Fixed auth.ts',
      tool: null,
    });
  });

  it('prefers a provider final message over a leftover stream', () => {
    expect(
      normalizeAgentOutput({ stream_text: '', final_message: 'Done.', substrate_state: 'done' }).kind,
    ).toBe('final_output');
  });

  it('emits a tool event only when tool_name is set', () => {
    const output = normalizeAgentOutput({ tool_name: 'read_file', activity_text: 'Reading auth.ts' });
    expect(output).toMatchObject({ kind: 'tool', source: 'provider', tool: 'read_file' });
    expect(outputPhrase(output)).toBe('Using read_file');
  });

  it('treats a terminal title as activity, not a tool call', () => {
    expect(normalizeAgentOutput({ activity_text: 'Reading auth.ts', substrate_state: 'working' })).toEqual({
      kind: 'activity',
      source: 'title',
      text: 'Reading auth.ts',
      tool: null,
    });
  });

  it('drops agent-name chrome', () => {
    expect(normalizeAgentOutput({ activity_text: 'claude' }).kind).toBe('idle');
    expect(normalizeAgentOutput({ activity_text: 'codex' }).kind).toBe('idle');
  });
});

describe('chooseFinalReply', () => {
  it('uses the provider message, then the pane, then the stream', () => {
    expect(chooseFinalReply({ finalMessage: 'native', paneText: 'pane', streamText: 'stream' })).toEqual({
      source: 'provider',
      text: 'native',
    });
    expect(chooseFinalReply({ paneText: 'pane', streamText: 'stream' }).source).toBe('pane');
    expect(chooseFinalReply({ streamText: 'stream' }).source).toBe('stream');
  });

  it('records an empty completion instead of dropping the turn', () => {
    expect(chooseFinalReply({})).toEqual({ source: 'empty', text: EMPTY_COMPLETION });
  });
});

describe('nextStreamText', () => {
  it('does not write a blank poll or the same text twice', () => {
    expect(nextStreamText('hello', '   ')).toBeNull();
    expect(nextStreamText('hello', 'hello')).toBeNull();
    expect(nextStreamText('hello', 'hello there')).toBe('hello there');
    expect(nextStreamText(null, 'hello')).toBe('hello');
  });
});

describe('activityFromStatus', () => {
  it('uses the title, then the label for that state', () => {
    expect(activityFromStatus({ title: 'Reading auth.ts', status: 'working', stateLabels: { working: 'busy' } })).toBe(
      'Reading auth.ts',
    );
    expect(activityFromStatus({ status: 'blocked', stateLabels: { blocked: 'Needs approval' } })).toBe(
      'Needs approval',
    );
    expect(activityFromStatus({ status: 'working', stateLabels: {} })).toBeUndefined();
  });
});
