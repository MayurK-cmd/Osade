import { describe, expect, it } from 'vitest';

import {
  agentStatusPhrase,
  mergeChatLines,
  openDiffIntent,
  partitionAgentText,
  pendingChatLines,
  summarizeFileChanges,
} from '../src/renderer/thread.js';

describe('mergeChatLines', () => {
  it('dedupes identical user prompts in the same time bucket', () => {
    const merged = mergeChatLines([
      {
        id: 'a',
        role: 'user',
        agentId: 'claude',
        taskId: 't1',
        text: 'same',
        live: false,
        at: 1000,
      },
      {
        id: 'b',
        role: 'user',
        agentId: 'codex',
        taskId: 't2',
        text: 'same',
        live: false,
        at: 1100,
      },
      {
        id: 'c',
        role: 'agent',
        agentId: 'claude',
        taskId: 't1',
        text: 'ok',
        live: false,
        at: 1200,
      },
    ]);
    expect(merged.filter((l) => l.role === 'user')).toHaveLength(1);
    expect(merged).toHaveLength(2);
  });
});

describe('agentStatusPhrase', () => {
  it('uses working vs worked wording', () => {
    expect(agentStatusPhrase(true, '12s')).toBe('working for 12s');
    expect(agentStatusPhrase(false, '12s')).toBe('worked for 12s');
  });
});

describe('openDiffIntent', () => {
  it('targets the diff lane for a task', () => {
    expect(openDiffIntent('task-9')).toEqual({ taskId: 'task-9', lane: 'diff' });
  });
});

describe('pendingChatLines', () => {
  it('surfaces per-agent launch failures without repeating the user prompt', () => {
    const lines = pendingChatLines(
      [{ chatId: 'c1', agentId: 'codex', prompt: 'ignored', phase: 'failed', error: 'codex CLI missing' }],
      new Map(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      role: 'agent',
      agentId: 'codex',
      failed: true,
      text: 'codex CLI missing',
    });
    expect(lines[0]!.text).not.toContain('ignored');
  });
});

describe('partitionAgentText', () => {
  it('folds leading activity and keeps the reply', () => {
    expect(
      partitionAgentText('Reading auth.ts\nUsing grep\n\nFound the issue in token validation.'),
    ).toEqual({
      activity: ['Reading auth.ts', 'Using grep'],
      response: 'Found the issue in token validation.',
    });
  });

  it('leaves a status-only line as the response', () => {
    expect(partitionAgentText('starting claude')).toEqual({
      activity: [],
      response: 'starting claude',
    });
  });
});

describe('summarizeFileChanges', () => {
  it('formats file counts and deltas', () => {
    expect(summarizeFileChanges({ files: 2, add: 3, del: 1 })).toBe('2 changed files +3 -1');
  });
});

describe('simultaneous agents', () => {
  it('keeps distinct agent ids on parallel status lines', () => {
    const claude = pendingChatLines(
      [{ chatId: 'c1', agentId: 'claude', prompt: '', phase: 'starting' }],
      new Map([['claude', 't1']]),
    );
    const codex = pendingChatLines(
      [{ chatId: 'c1', agentId: 'codex', prompt: '', phase: 'starting' }],
      new Map([['codex', 't2']]),
    );
    const merged = mergeChatLines([...claude, ...codex]);
    expect(new Set(merged.map((l) => l.agentId))).toEqual(new Set(['claude', 'codex']));
  });
});
