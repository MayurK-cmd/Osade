import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDb, type Db } from '../../src/db/index.js';
import {
  dispatchQueued,
  listTurns,
  sendTurn,
  settleAgentReply,
  turnInFlight,
} from '../../src/domain/chat-turns.js';

const NOW = 1_756_000_000_000;

let db: Db;
const prompts: string[] = [];

function seed(): void {
  db.prepare('INSERT INTO org (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'acme', NOW);
  db.prepare(
    'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('r1', 'o1', '/repo', 'main', NOW);
  db.prepare(
    `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                       worktree_path, created_at)
     VALUES ('t1', 'r1', 'fix', 'first prompt', 'manual', 'main', 'headsha', 'osade/fix', '/wt', ?)`,
  ).run(NOW);
  db.prepare(
    `INSERT INTO agent_fact (task_id, substrate_pane_id, substrate_state, pane_alive, state_change_seq)
     VALUES ('t1', 'w3:p2', 'idle', 1, 1)`,
  ).run();
}

async function send(text: string) {
  return sendTurn(db, async (_id, body) => {
    prompts.push(body);
  }, { taskId: 't1', text, origin: 'human', now: NOW });
}

beforeEach(() => {
  db = openDb(':memory:');
  prompts.length = 0;
  seed();
});

afterEach(() => {
  db.close();
});

describe('chat turns — typed send, not keystrokes', () => {
  it('sends immediately when nothing is in flight', async () => {
    const turn = await send('first prompt');
    expect(turn.delivery).toBe('accepted');
    expect(prompts).toEqual(['first prompt']);
    expect(listTurns(db, 't1').map((t) => t.role)).toEqual(['user']);
  });

  it('queues a follow-up while the agent is still on the last turn', async () => {
    await send('first prompt');
    db.prepare("UPDATE agent_fact SET substrate_state = 'working' WHERE task_id = 't1'").run();
    expect(turnInFlight(db, 't1')).toBe(true);

    const held = await send('also write tests');
    expect(held.delivery).toBe('queued');
    expect(prompts).toEqual(['first prompt']);
    expect(listTurns(db, 't1').map((t) => t.text)).toEqual(['first prompt', 'also write tests']);
  });

  it('seeds the original intent when the first stored follow-up differs', async () => {
    await send('also write tests');
    expect(listTurns(db, 't1').map((t) => ({ role: t.role, text: t.text, delivery: t.delivery }))).toEqual([
      { role: 'user', text: 'first prompt', delivery: 'accepted' },
      { role: 'user', text: 'also write tests', delivery: 'accepted' },
    ]);
    expect(prompts).toEqual(['also write tests']);
  });

  it('dispatches the held turn after the pane goes quiet', async () => {
    await send('first prompt');
    db.prepare("UPDATE agent_fact SET substrate_state = 'working' WHERE task_id = 't1'").run();
    await send('also write tests');

    db.prepare(
      "UPDATE agent_fact SET substrate_state = 'done', activity_text = 'All files listed' WHERE task_id = 't1'",
    ).run();
    const reply = settleAgentReply(db, 't1', NOW);
    expect(reply?.text).toBe('All files listed');
    await dispatchQueued(db, async (_id, body) => {
      prompts.push(body);
    }, 't1', false, NOW);

    expect(prompts).toEqual(['first prompt', 'also write tests']);
    expect(listTurns(db, 't1').map((t) => ({ role: t.role, delivery: t.delivery }))).toEqual([
      { role: 'user', delivery: 'accepted' },
      { role: 'agent', delivery: 'accepted' },
      { role: 'user', delivery: 'accepted' },
    ]);
  });

  it('does not persist a Claude-named activity line as a reply', () => {
    db.prepare(
      `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
       VALUES ('ct_1', 't1', 1, 'user', 'human', 'first prompt', 'accepted', ?)`,
    ).run(NOW);
    db.prepare("UPDATE agent_fact SET activity_text = 'claude' WHERE task_id = 't1'").run();
    expect(settleAgentReply(db, 't1', NOW)).toBeNull();
  });

  it('marks a failed prompt so it is not retried as queued', async () => {
    await expect(
      sendTurn(db, async () => {
        throw new Error('pane gone');
      }, { taskId: 't1', text: 'first prompt', origin: 'human', now: NOW }),
    ).rejects.toThrow('pane gone');
    expect(listTurns(db, 't1')[0]?.delivery).toBe('failed');
  });
});
