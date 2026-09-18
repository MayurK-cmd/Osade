import { describe, expect, it } from 'vitest';

import { orchestratorId, type TaskStatus } from '@osade/contract';

import { boardColumn, chatLabel, displayBranch, agentInitials, showPinnedNeedsYou, type ChatGroup } from '../src/renderer/lanes.js';
import { hasBrandLogo } from '../src/renderer/agent-icon.js';

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

describe('displayBranch', () => {
  it('drops the osade/<slug>/ prefix and keeps the tail', () => {
    expect(displayBranch('osade/token-refresh/claude')).toBe('claude');
    expect(displayBranch('osade/retry-flaky-poller')).toBe('retry-flaky-poller');
    expect(displayBranch('main')).toBe('main');
    expect(displayBranch('feat/hold-checkout')).toBe('feat/hold-checkout');
  });
});

describe('agentInitials', () => {
  it('takes two letters from the agent id', () => {
    expect(agentInitials('claude')).toBe('CL');
    expect(agentInitials('codex')).toBe('CO');
    expect(agentInitials('opencode')).toBe('OP');
    expect(agentInitials('open-code')).toBe('OC');
  });
});

describe('hasBrandLogo', () => {
  it('knows the catalog agents that have a mark', () => {
    expect(hasBrandLogo('claude')).toBe(true);
    expect(hasBrandLogo('codex')).toBe(true);
    expect(hasBrandLogo('opencode')).toBe(true);
    expect(hasBrandLogo('pi')).toBe(false);
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
