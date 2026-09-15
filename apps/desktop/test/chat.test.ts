import { describe, expect, it } from 'vitest';

import type { TaskView } from '@osade/contract';

import { chatLines, visibleUserText } from '../src/renderer/chat.js';

describe('visibleUserText', () => {
  it('drops the sibling-lane digest', () => {
    expect(
      visibleUserText('<osade_lanes>\n- codex on osade/x/codex: working\n</osade_lanes>\n\nreal work'),
    ).toBe('real work');
  });
});

describe('chatLines', () => {
  it('is a user bubble plus a live agent line, never a terminal dump', () => {
    const lines = chatLines(
      view({
        intent: 'Retry the flaky poller test',
        status: 'implementing',
        activity: 'Editing retry.ts',
      }),
    );
    expect(lines.map((l) => l.role)).toEqual(['user', 'agent']);
    expect(lines[0]!.text).toBe('Retry the flaky poller test');
    expect(lines[1]!.text).toBe('Editing retry.ts');
    expect(lines[1]!.live).toBe(true);
    expect(lines.some((l) => l.text.includes('\x1b[') || l.text.includes('claude --'))).toBe(false);
  });

  it('keeps a follow-up that is not the original intent', () => {
    const lines = chatLines(view({ intent: 'first', status: 'implementing', activity: 'Working' }), [
      'first',
      'also write tests',
    ]);
    expect(lines.filter((l) => l.role === 'user').map((l) => l.text)).toEqual(['first', 'also write tests']);
  });

  it('uses the agent final_message when there is one', () => {
    const lines = chatLines(
      view({ intent: 'ping', status: 'awaiting_review', final: 'PONG' }),
    );
    expect(lines.at(-1)).toMatchObject({ role: 'agent', text: 'PONG', live: false });
  });
});

function view(over: {
  intent?: string;
  status?: TaskView['status'];
  activity?: string;
  final?: string;
}): TaskView {
  return {
    task: {
      id: 't1',
      repo_id: 'r1',
      chat_id: 'c1',
      title: 'Token refresh',
      intent: over.intent ?? 'x',
      origin_kind: 'manual',
      origin_ref: null,
      agent_id: 'claude',
      base_ref: 'main',
      base_sha: 'abc',
      branch: 'osade/token-refresh/claude',
      worktree_path: '/wt',
      substrate_workspace_id: null,
      archived_at: null,
      created_at: 1,
    },
    status: over.status ?? 'queued',
    agent:
      over.activity == null && over.final == null
        ? null
        : {
            task_id: 't1',
            substrate_pane_id: null,
            substrate_state: 'working',
            last_event: 'activity',
            last_event_at: 1,
            activity_text: over.activity ?? null,
            tool_name: null,
            final_message: over.final ?? null,
            agent_session_id: null,
            pane_alive: true,
            last_probe_at: null,
            probe_failures: 0,
            terminated: false,
            external_block: null,
            state_change_seq: 1,
            controller_generation: 0,
          },
    scm: null,
    openGates: [],
    latestVerifyRuns: [],
    needsYou: false,
    chatId: 'c1',
    agentId: 'claude',
    attachment: 'worktree',
    branch: 'osade/token-refresh/claude',
    cwd: '/wt',
  };
}
