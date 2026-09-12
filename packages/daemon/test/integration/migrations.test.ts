import { describe, expect, it } from 'vitest';

import { migrate, openDb, type Db } from '../../src/db/index.js';

const NOW = 1_756_000_000_000;

/**
 * Migration 6 renames the three columns that were named after the substrate rather than after
 * their role. A ledger that already exists has the old names, so the rename has to be a
 * migration and not an edit to migration 1 — and it has to be a no-op on a database created
 * after the change, which is the part that is easy to get wrong.
 */

function columns(db: Db, table: string): Set<string> {
  const rows = db.pragma(`table_info(${table})`) as { name: string }[];
  return new Set(rows.map((row) => row.name));
}

/** Turns a current database back into one written before the rename. */
function ageBackwards(db: Db): void {
  db.exec(`
    ALTER TABLE task RENAME COLUMN substrate_workspace_id TO herdr_workspace_id;
    ALTER TABLE agent_fact RENAME COLUMN substrate_pane_id TO herdr_pane_id;
    ALTER TABLE agent_fact RENAME COLUMN substrate_state TO herdr_state;
    DELETE FROM schema_migration WHERE id = 6;
  `);
}

function seed(db: Db): void {
  db.prepare('INSERT INTO org (id, name, created_at) VALUES (?, ?, ?)').run('o1', 'acme', NOW);
  db.prepare(
    'INSERT INTO repo (id, org_id, path, default_branch, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run('r1', 'o1', '/repo', 'main', NOW);
}

describe('migration 6 — the substrate columns', () => {
  it('renames the columns of a ledger written before the change, keeping the rows', () => {
    const db = openDb(':memory:');
    seed(db);
    ageBackwards(db);

    db.prepare(
      `INSERT INTO task (id, repo_id, title, intent, origin_kind, base_ref, base_sha, branch,
                         worktree_path, created_at, herdr_workspace_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run('t1', 'r1', 'a task', 'do it', 'human', 'main', 'abc', 'osade/t1', '/wt', NOW, 'ws_7');

    expect(columns(db, 'task').has('herdr_workspace_id')).toBe(true);

    migrate(db);

    expect(columns(db, 'task').has('substrate_workspace_id')).toBe(true);
    expect(columns(db, 'task').has('herdr_workspace_id')).toBe(false);
    expect(columns(db, 'agent_fact').has('substrate_pane_id')).toBe(true);
    expect(columns(db, 'agent_fact').has('substrate_state')).toBe(true);

    const row = db.prepare('SELECT substrate_workspace_id AS ws FROM task WHERE id = ?').get('t1');
    expect((row as { ws: string }).ws).toBe('ws_7');
  });

  it('is a no-op on a database that was never old, and still records itself', () => {
    const db = openDb(':memory:');

    expect(columns(db, 'task').has('substrate_workspace_id')).toBe(true);

    const applied = db
      .prepare('SELECT id FROM schema_migration ORDER BY id')
      .all()
      .map((r) => (r as { id: number }).id);
    expect(applied).toContain(6);

    // Running again must not try the rename a second time.
    expect(() => migrate(db)).not.toThrow();
  });

  it('keeps the index on the renamed column', () => {
    const db = openDb(':memory:');
    seed(db);
    ageBackwards(db);
    migrate(db);

    const indexes = db.pragma('index_list(agent_fact)') as { name: string }[];
    const pane = indexes.find((index) => index.name === 'agent_fact_pane_idx');
    expect(pane).toBeDefined();

    const on = db.pragma('index_info(agent_fact_pane_idx)') as { name: string }[];
    expect(on.map((column) => column.name)).toContain('substrate_pane_id');
  });
});
