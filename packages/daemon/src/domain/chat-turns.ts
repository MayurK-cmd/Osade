import { randomUUID } from 'node:crypto';

import type { ChatTurn } from '@osade/contract';

import type { Db } from '../db/index.js';
import { getAgentFact } from '../db/task-repo.js';

export type TurnPrompt = (taskId: string, text: string, wait: boolean) => Promise<void>;

const INSERT = `INSERT INTO chat_turn (id, task_id, seq, role, origin, text, delivery, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

export function listTurns(db: Db, taskId: string): ChatTurn[] {
  return (
    db
      .prepare(
        `SELECT id, task_id, seq, role, origin, text, delivery, created_at
           FROM chat_turn WHERE task_id = ? ORDER BY seq ASC`,
      )
      .all(taskId) as ChatTurn[]
  );
}

export function turnInFlight(db: Db, taskId: string): boolean {
  const sending = db
    .prepare(`SELECT 1 FROM chat_turn WHERE task_id = ? AND delivery = 'sending' LIMIT 1`)
    .get(taskId);
  if (sending) return true;
  // Mid-turn hold — AO queues while the live turn is working, then flushes on quiet.
  const fact = getAgentFact(db, taskId);
  return fact?.substrate_state === 'working';
}

export function enqueueTurn(
  db: Db,
  input: { taskId: string; text: string; origin: ChatTurn['origin']; now: number },
): ChatTurn {
  const text = input.text.trim();
  if (text.length === 0) throw new Error('Write something to send');

  return db.transaction(() => {
    const count = (
      db.prepare('SELECT COUNT(*) AS n FROM chat_turn WHERE task_id = ?').get(input.taskId) as {
        n: number;
      }
    ).n;
    if (count === 0) {
      const intent = (
        db.prepare('SELECT intent FROM task WHERE id = ?').get(input.taskId) as
          | { intent: string }
          | undefined
      )?.intent?.trim();
      if (intent && intent !== text) {
        insertRow(db, {
          taskId: input.taskId,
          seq: 1,
          role: 'user',
          origin: 'human',
          text: intent,
          delivery: 'accepted',
          now: input.now,
        });
      }
    }
    const seq =
      (
        db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM chat_turn WHERE task_id = ?').get(
          input.taskId,
        ) as { seq: number }
      ).seq + 1;
    return insertRow(db, {
      taskId: input.taskId,
      seq,
      role: 'user',
      origin: input.origin,
      text,
      delivery: 'queued',
      now: input.now,
    });
  })();
}

export async function dispatchQueued(
  db: Db,
  prompt: TurnPrompt,
  taskId: string,
  wait = false,
  now = Date.now(),
): Promise<void> {
  for (;;) {
    if (turnInFlight(db, taskId)) return;
    const next = db
      .prepare(
        `SELECT id, text FROM chat_turn
           WHERE task_id = ? AND role = 'user' AND delivery = 'queued'
           ORDER BY seq ASC LIMIT 1`,
      )
      .get(taskId) as { id: string; text: string } | undefined;
    if (!next) return;
    setDelivery(db, next.id, 'sending');
    try {
      await prompt(taskId, next.text, wait);
      setDelivery(db, next.id, 'accepted');
    } catch (err) {
      setDelivery(db, next.id, 'failed');
      throw err;
    }
    const fact = getAgentFact(db, taskId);
    if (fact?.substrate_state === 'done' || fact?.substrate_state === 'blocked') {
      settleAgentReply(db, taskId, now);
      continue;
    }
    return;
  }
}

export async function sendTurn(
  db: Db,
  prompt: TurnPrompt,
  input: { taskId: string; text: string; origin: ChatTurn['origin']; now: number; wait?: boolean },
): Promise<ChatTurn> {
  const turn = enqueueTurn(db, input);
  await dispatchQueued(db, prompt, input.taskId, input.wait === true, input.now);
  const stored = db
    .prepare(
      `SELECT id, task_id, seq, role, origin, text, delivery, created_at FROM chat_turn WHERE id = ?`,
    )
    .get(turn.id) as ChatTurn;
  return stored;
}

/** After a turn settles (`done` / `blocked`), persist the agent's last words if we have them. */
export function settleAgentReply(db: Db, taskId: string, now: number): ChatTurn | null {
  const lastUser = db
    .prepare(
      `SELECT seq FROM chat_turn
         WHERE task_id = ? AND role = 'user' AND delivery = 'accepted'
         ORDER BY seq DESC LIMIT 1`,
    )
    .get(taskId) as { seq: number } | undefined;
  if (!lastUser) return null;

  const laterAgent = db
    .prepare(
      `SELECT 1 FROM chat_turn WHERE task_id = ? AND role = 'agent' AND seq > ? LIMIT 1`,
    )
    .get(taskId, lastUser.seq);
  if (laterAgent) return null;

  const fact = getAgentFact(db, taskId);
  const text = settleText(fact?.final_message ?? null, fact?.activity_text ?? null);
  if (text.length === 0) return null;

  const lastAgent = db
    .prepare(
      `SELECT text FROM chat_turn WHERE task_id = ? AND role = 'agent' ORDER BY seq DESC LIMIT 1`,
    )
    .get(taskId) as { text: string } | undefined;
  if (lastAgent?.text === text) return null;

  return db.transaction(() => {
    const later = db
      .prepare(
        `SELECT id, seq FROM chat_turn WHERE task_id = ? AND seq > ? ORDER BY seq DESC`,
      )
      .all(taskId, lastUser.seq) as { id: string; seq: number }[];
    for (const row of later) {
      db.prepare('UPDATE chat_turn SET seq = ? WHERE id = ?').run(row.seq + 1, row.id);
    }
    return insertRow(db, {
      taskId,
      seq: lastUser.seq + 1,
      role: 'agent',
      origin: 'provider',
      text,
      delivery: 'accepted',
      now,
    });
  })();
}

function settleText(finalMessage: string | null, activityText: string | null): string {
  const final = finalMessage?.trim() ?? '';
  if (final.length > 0) return final;
  const activity = activityText?.trim() ?? '';
  if (activity.length === 0) return '';
  if (/^claude(?:\s+code)?$/iu.test(activity)) return '';
  return activity;
}

function setDelivery(db: Db, id: string, delivery: ChatTurn['delivery']): void {
  db.prepare('UPDATE chat_turn SET delivery = ? WHERE id = ?').run(delivery, id);
}

function insertRow(
  db: Db,
  row: {
    taskId: string;
    seq: number;
    role: ChatTurn['role'];
    origin: ChatTurn['origin'];
    text: string;
    delivery: ChatTurn['delivery'];
    now: number;
  },
): ChatTurn {
  const id = `ct_${randomUUID().slice(0, 8)}`;
  db.prepare(INSERT).run(id, row.taskId, row.seq, row.role, row.origin, row.text, row.delivery, row.now);
  return {
    id,
    task_id: row.taskId,
    seq: row.seq,
    role: row.role,
    origin: row.origin,
    text: row.text,
    delivery: row.delivery,
    created_at: row.now,
  };
}
