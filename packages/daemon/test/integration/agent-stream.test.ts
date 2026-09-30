import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ServerMessage } from '@osade/contract';

import { openDb, type Db } from '../../src/db/index.js';
import { settleAgentReply } from '../../src/domain/chat-turns.js';
import { EMPTY_COMPLETION } from '../../src/domain/agent-output.js';
import { CdcBroadcaster } from '../../src/server/cdc-broadcaster.js';

const NOW = 1_756_000_000_000;

let db: Db;

function seed(id: string, agentId: string, chatId: string): void {
  db.prepare(
    `INSERT INTO task (id, repo_id, title, intent, origin_kind, agent_id, chat_id, base_ref, base_sha,
                       branch, worktree_path, created_at)
     VALUES (?, 'r1', 'fix', 'fix it', 'manual', ?, ?, 'main', 'headsha', ?, '/wt', ?)`,
  ).run(id, agentId, chatId, `osade/fix/${agentId}`, NOW);
}

beforeEach(() => {
  db = openDb(':memory:');
  db.prepare('INSERT INTO org (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'acme', NOW);
  db.prepare(
    'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('r1', 'o1', '/repo', 'main', NOW);
  seed('t_claude', 'claude', 'chat-1');
  seed('t_codex', 'codex', 'chat-1');
});

afterEach(() => {
  db.close();
});

describe('lane streams', () => {
  it('delivers each lane’s stream on its own task upsert', () => {
    const broadcaster = new CdcBroadcaster(db, { now: () => NOW });
    const seen: ServerMessage[] = [];
    broadcaster.subscribe((message) => seen.push(message));

    db.prepare(
      `INSERT INTO agent_fact (task_id, substrate_pane_id, substrate_state, pane_alive, state_change_seq, stream_text)
       VALUES ('t_claude', 'w1:p1', 'working', 1, 1, 'Claude is editing auth.ts')`,
    ).run();
    db.prepare(
      `INSERT INTO agent_fact (task_id, substrate_pane_id, substrate_state, pane_alive, state_change_seq, stream_text)
       VALUES ('t_codex', 'w1:p2', 'working', 1, 1, 'Codex is reading api.ts')`,
    ).run();
    expect(broadcaster.tick()).toBe(2);

    const upserts = seen.filter((message) => message.type === 'task.upserted');
    const claude = upserts.find((message) => message.type === 'task.upserted' && message.task.task.id === 't_claude');
    const codex = upserts.find((message) => message.type === 'task.upserted' && message.task.task.id === 't_codex');
    if (claude?.type !== 'task.upserted' || codex?.type !== 'task.upserted') {
      throw new Error('expected both lanes');
    }
    expect(claude.task.agentId).toBe('claude');
    expect(claude.task.chatId).toBe('chat-1');
    expect(claude.task.output).toMatchObject({
      kind: 'partial_output',
      source: 'pane',
      text: 'Claude is editing auth.ts',
    });
    expect(codex.task.agentId).toBe('codex');
    expect(codex.task.agent?.stream_text).toBe('Codex is reading api.ts');
    expect(codex.task.agent?.stream_text).not.toContain('auth.ts');
    expect(claude.task.agent?.stream_text).not.toContain('api.ts');
  });

  it('persists one final reply and an empty completion once', () => {
    db.prepare(
      `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
       VALUES ('u1', 't_claude', 1, 'user', 'human', 'fix auth', 'accepted', ?)`,
    ).run(NOW);
    db.prepare(
      `INSERT INTO agent_fact (task_id, substrate_state, pane_alive, state_change_seq, final_message, stream_text)
       VALUES ('t_claude', 'done', 1, 2, 'Fixed auth.ts', 'Fixed auth.ts')`,
    ).run();
    const first = settleAgentReply(db, 't_claude', NOW, { body: 'Fixed auth.ts' });
    const again = settleAgentReply(db, 't_claude', NOW, { body: 'Fixed auth.ts' });
    expect(first?.text).toBe('Fixed auth.ts');
    expect(again).toBeNull();

    db.prepare(
      `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
       VALUES ('u2', 't_codex', 1, 'user', 'human', 'look', 'accepted', ?)`,
    ).run(NOW);
    const empty = settleAgentReply(db, 't_codex', NOW, { body: EMPTY_COMPLETION });
    expect(empty?.task_id).toBe('t_codex');
    expect(empty?.text).toBe(EMPTY_COMPLETION);
    const rows = db
      .prepare(`SELECT task_id, text FROM chat_turn WHERE role = 'agent' ORDER BY task_id`)
      .all() as { task_id: string; text: string }[];
    expect(rows).toEqual([
      { task_id: 't_claude', text: 'Fixed auth.ts' },
      { task_id: 't_codex', text: EMPTY_COMPLETION },
    ]);
  });
});
