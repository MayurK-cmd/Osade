import { describe, expect, it } from 'vitest';

import { orchestratorId, type TaskStatus } from '@osade/contract';

import { boardColumn, chatLabel, showPinnedNeedsYou, type ChatGroup } from '../src/renderer/lanes.js';

describe('showPinnedNeedsYou', () => {
  it('hides the group when it would contain every visible chat', () => {
    expect(showPinnedNeedsYou(1, 1)).toBe(false);
    expect(showPinnedNeedsYou(3, 3)).toBe(false);
  });

  it('shows the group when some chats do not need you', () => {
    expect(showPinnedNeedsYou(1, 2)).toBe(true);
  });
});

describe('boardColumn', () => {
  it('places chats from derived status, never a stored field', () => {
    expect(boardColumn(chat({ needsYou: true, status: 'implementing' }))).toBe('needs');
    expect(boardColumn(chat({ status: 'implementing' }))).toBe('working');
    expect(boardColumn(chat({ status: 'verifying' }))).toBe('working');
    expect(boardColumn(chat({ status: 'pr_open' }))).toBe('review');
    expect(boardColumn(chat({ status: 'merged' }))).toBe('ready');
    expect(boardColumn(chat({ status: 'queued' }))).toBe('rest');
  });

  it('needs-you wins over working', () => {
    expect(boardColumn(chat({ needsYou: true, status: 'verifying' }))).toBe('needs');
  });
});

describe('chatLabel', () => {
  it('calls the orchestrator home lane Plan', () => {
    expect(chatLabel({ chatId: orchestratorId('r1'), title: 'Plan' })).toBe('Plan');
    expect(chatLabel({ chatId: 't_abc', title: 'Fix the poller' })).toBe('Fix the poller');
  });
});

function chat(over: { status: TaskStatus; needsYou?: boolean }): ChatGroup {
  return {
    chatId: 'c1',
    title: 'Work',
    lanes: [],
    status: over.status,
    needsYou: over.needsYou ?? false,
  };
}
