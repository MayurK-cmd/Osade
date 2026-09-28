import { describe, expect, it } from 'vitest';

import type { ChatTurn, TaskView } from '@osade/contract';

import { chatLines, visibleUserText } from '../src/renderer/chat.js';
import { groupChats } from '../src/renderer/lanes.js';
import { lanePrompt, laneTarget, parseMentions } from '../src/renderer/mentions.js';

const CATALOG = ['claude', 'codex', 'opencode', 'pi'];

describe('lane routing', () => {
  it('one @agent mention is one target and one chat lane', () => {
    const parsed = parseMentions('@claude fix the authentication bug', CATALOG);
    expect(parsed.targets).toEqual([{ agentId: 'claude', text: 'fix the authentication bug' }]);
    expect(lanePrompt(parsed, parsed.targets[0]!, '@claude fix the authentication bug')).toBe(
      'fix the authentication bug',
    );
    const chats = groupChats([view('claude')]);
    expect(chats).toHaveLength(1);
    expect(chats[0]!.lanes).toHaveLength(1);
  });

  it('two mentions are two lanes in one chat', () => {
    const parsed = parseMentions('@claude fix auth\n@codex write tests', CATALOG);
    expect(parsed.targets.map((t) => t.agentId)).toEqual(['claude', 'codex']);
    const chats = groupChats([view('claude'), view('codex', { id: 't2' })]);
    expect(chats).toHaveLength(1);
    expect(chats[0]!.lanes.map((l) => l.agentId)).toEqual(['claude', 'codex']);
  });

  it('a follow-up @codex routes to the existing Codex lane', () => {
    const lanes = [view('claude'), view('codex', { id: 't2' })];
    const parsed = parseMentions('@codex review Claude’s changes', CATALOG);
    expect(parsed.targets).toEqual([{ agentId: 'codex', text: 'review Claude’s changes' }]);
    expect(laneTarget(lanes, 'codex')?.task.id).toBe('t2');
    expect(laneTarget(lanes, 'opencode')).toBeNull();
    expect(laneTarget(lanes, 'pi')).toBeNull();
  });

  it('keeps a single-agent chat on its only lane', () => {
    const parsed = parseMentions('refactor the token refresh', CATALOG);
    expect(parsed.targets).toEqual([]);
    const lanes = [view('claude')];
    expect(laneTarget(lanes, 'claude')?.task.id).toBe('t1');
    expect(groupChats(lanes)[0]!.lanes).toHaveLength(1);
  });
});

describe('reply association', () => {
  it('attributes each reply to the lane that produced it', () => {
    const claude = chatLines(
      view('claude', {
        turns: [turn('t1', 1, 'user', 'fix auth'), turn('t1', 2, 'agent', 'Fixed auth.ts and added tests.')],
      }),
    );
    const codex = chatLines(
      view('codex', {
        id: 't2',
        turns: [
          turn('t2', 1, 'user', 'review Claude’s changes'),
          turn('t2', 2, 'agent', 'The token check allows empty secrets.'),
        ],
      }),
    );
    expect(claude.filter((l) => l.role === 'agent')).toEqual([
      expect.objectContaining({ agentId: 'claude', taskId: 't1', text: 'Fixed auth.ts and added tests.' }),
    ]);
    expect(codex.filter((l) => l.role === 'agent')).toEqual([
      expect.objectContaining({
        agentId: 'codex',
        taskId: 't2',
        text: 'The token check allows empty secrets.',
      }),
    ]);
  });
});

describe('visible collaboration context', () => {
  it('hides the patch block and leaves the user’s words', () => {
    const shown = visibleUserText(
      [
        '<osade_collab>',
        'changed files:',
        '- auth.ts  added  +4 -0',
        '```diff',
        '+export function login() { return true; }',
        '```',
        '</osade_collab>',
        '',
        'review Claude’s changes',
      ].join('\n'),
    );
    expect(shown).toBe('review Claude’s changes');
    expect(shown).not.toContain('auth.ts');
  });
});

function turn(taskId: string, seq: number, role: ChatTurn['role'], text: string): ChatTurn {
  return {
    id: `${taskId}-${seq}`,
    task_id: taskId,
    seq,
    role,
    origin: role === 'user' ? 'human' : 'provider',
    text,
    delivery: 'accepted',
    created_at: seq,
  };
}

function view(
  agentId: string,
  over: { id?: string; turns?: ChatTurn[] } = {},
): TaskView {
  const taskId = over.id ?? 't1';
  return {
    task: {
      id: taskId,
      repo_id: 'r1',
      chat_id: 'c1',
      title: 'Auth bug',
      intent: 'x',
      origin_kind: 'manual',
      origin_ref: null,
      agent_id: agentId,
      base_ref: 'main',
      base_sha: 'abc',
      branch: `osade/auth/${agentId}`,
      worktree_path: `/wt/${agentId}`,
      substrate_workspace_id: null,
      archived_at: null,
      created_at: agentId === 'claude' ? 1 : 2,
    },
    status: 'queued',
    agent: null,
    scm: null,
    openGates: [],
    latestVerifyRuns: [],
    needsYou: false,
    chatId: 'c1',
    agentId,
    attachment: 'worktree',
    branch: `osade/auth/${agentId}`,
    cwd: `/wt/${agentId}`,
    turns: over.turns,
  };
}
