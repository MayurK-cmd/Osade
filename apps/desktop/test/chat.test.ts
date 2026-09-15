import { describe, expect, it } from 'vitest';

import type { TaskView } from '@osade/contract';

import { chatLines, splitPaneReplies, visibleUserText } from '../src/renderer/chat.js';

describe('visibleUserText', () => {
  it('drops the sibling-lane digest', () => {
    expect(
      visibleUserText('<osade_lanes>\n- codex on osade/x/codex: working\n</osade_lanes>\n\nreal work'),
    ).toBe('real work');
  });
});

describe('splitPaneReplies', () => {
  it('interleaves each user prompt with the text Claude produced after it', () => {
    const pane = [
      'Welcome to Claude Code',
      'First read C:\\Users\\asus\\.osade\\tasks\\t_abc\\CONTEXT.md, then: what are the files in the repo',
      '',
      'Here are the files:',
      'README.md',
      'package.json',
      '',
      '> show the files present, list them down',
      '',
      'README.md, package.json, src/',
    ].join('\n');

    expect(
      splitPaneReplies(pane, ['what are the files in the repo', 'show the files present, list them down']),
    ).toEqual(['Here are the files:\nREADME.md\npackage.json', 'README.md, package.json, src/']);
  });

  it('does not treat the whole CLI dump as the only reply', () => {
    const pane = '╭──╮\n│ > list files │\n╰──╯\nREADME.md';
    const replies = splitPaneReplies(pane, ['list files']);
    expect(replies).toHaveLength(1);
    expect(replies[0]).toContain('README.md');
    expect(replies[0]).not.toMatch(/╭|│/);
  });

  it('strips Claude Code tool-call chrome from a reply', () => {
    const pane = [
      'list files',
      'Read(src/index.ts)',
      'Thinking…',
      'Here are the files:',
      'README.md',
    ].join('\n');
    expect(splitPaneReplies(pane, ['list files'])).toEqual(['Here are the files:\nREADME.md']);
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

  it('does not invent a status-label reply when the agent is done', () => {
    const lines = chatLines(view({ intent: 'list the files', status: 'awaiting_review' }));
    expect(lines.map((l) => l.role)).toEqual(['user']);
    expect(lines[0]!.text).toBe('list the files');
  });

  it('is user, reply, user, reply — not all users then a CLI dump', () => {
    const pane = [
      'then: list the files',
      'README.md',
      'package.json',
      'show the files present, list them down',
      'src/main.ts',
    ].join('\n');
    const lines = chatLines(
      view({ intent: 'list the files', status: 'awaiting_review' }),
      ['show the files present, list them down'],
      pane,
    );
    expect(lines.map((l) => ({ role: l.role, text: l.text }))).toEqual([
      { role: 'user', text: 'list the files' },
      { role: 'agent', text: 'README.md\npackage.json' },
      { role: 'user', text: 'show the files present, list them down' },
      { role: 'agent', text: 'src/main.ts' },
    ]);
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
