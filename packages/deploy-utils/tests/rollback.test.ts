/**
 * Tests for schema rollback against real local SQLite.
 *
 * `rollbackSchema` introspects the live database (via `introspectTableREST`),
 * compares it to a hand-built `ExistingTable[]` snapshot, and emits + executes
 * statements that drop columns/tables/indexes added since the snapshot. It
 * cannot restore dropped columns or data. All assertions verify real post-state
 * by re-introspecting the SQLite file with PRAGMA/SELECT via `executeD1DDL`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { rollbackSchema } from '../src/deploy/rollback';
import { executeD1DDL, provisionD1Database } from '../src/deploy/d1';
import type { ExistingTable } from '../src/schema/types';
import { TEST_CONFIG, setupDataDir, teardownDataDir } from './helpers/local-db';

beforeEach(() => {
  setupDataDir();
});
afterEach(() => {
  teardownDataDir();
});

/** Snapshot of `tasks` as it stood before any schema drift (id, title + system cols). */
const PREV_TASKS: ExistingTable = {
  name: 'tasks',
  columns: [
    { name: 'id', type: 'INTEGER', pk: true, notnull: false, dflt_value: null },
    { name: 'title', type: 'TEXT', pk: false, notnull: true, dflt_value: null },
    { name: 'owner_id', type: 'TEXT', pk: false, notnull: true, dflt_value: null },
    { name: 'created_at', type: 'TEXT', pk: false, notnull: true, dflt_value: null },
    { name: 'updated_at', type: 'TEXT', pk: false, notnull: true, dflt_value: null },
  ],
  indexes: [{ name: 'idx_tasks_owner_id', columns: ['owner_id'], unique: false }],
};

/** Create the `tasks` table matching {@link PREV_TASKS}, optionally with extra column DDL. */
async function createTasksTable(uuid: string, extraColumns = ''): Promise<void> {
  await executeD1DDL(
    TEST_CONFIG,
    uuid,
    `CREATE TABLE "tasks" (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      ${extraColumns}
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  );
  await executeD1DDL(
    TEST_CONFIG,
    uuid,
    'CREATE INDEX "idx_tasks_owner_id" ON "tasks" (owner_id)',
  );
}

/** Return the live column names of a table. */
async function columnNames(uuid: string, table: string): Promise<string[]> {
  const res = await executeD1DDL(TEST_CONFIG, uuid, `PRAGMA table_info("${table}")`);
  return (res.results as Array<{ name: string }>).map((r) => r.name);
}

/** Return the live user-table names. */
async function tableNames(uuid: string): Promise<string[]> {
  const res = await executeD1DDL(
    TEST_CONFIG,
    uuid,
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  return (res.results as Array<{ name: string }>).map((r) => r.name);
}

describe('rollbackSchema', () => {
  it('drops a column that was added since the snapshot', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    // Live table has an extra `priority` column not present in PREV_TASKS.
    await createTasksTable(uuid, 'priority INTEGER,');
    expect(await columnNames(uuid, 'tasks')).toContain('priority');

    const result = await rollbackSchema(TEST_CONFIG, uuid, [PREV_TASKS]);

    expect(result.success).toBe(true);
    expect(result.statements.some((s) => s.includes('DROP COLUMN') && s.includes('priority'))).toBe(
      true,
    );
    expect(result.details).toContainEqual(
      expect.stringContaining('Dropping added column: priority'),
    );

    // The column is actually gone from the real table.
    expect(await columnNames(uuid, 'tasks')).not.toContain('priority');
    // Snapshot columns survive.
    expect(await columnNames(uuid, 'tasks')).toEqual(
      expect.arrayContaining(['id', 'title', 'owner_id', 'created_at', 'updated_at']),
    );
  });

  it('drops a table created since the snapshot (not in previousSchema)', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTasksTable(uuid);
    // A brand-new table absent from the snapshot.
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE TABLE "comments" (id INTEGER PRIMARY KEY, body TEXT)',
    );
    expect(await tableNames(uuid)).toContain('comments');

    const result = await rollbackSchema(TEST_CONFIG, uuid, [PREV_TASKS]);

    expect(result.success).toBe(true);
    expect(
      result.statements.some((s) => s.includes('DROP TABLE') && s.includes('comments')),
    ).toBe(true);
    expect(result.details).toContainEqual(
      expect.stringContaining('Dropping newly created table: comments'),
    );

    // The new table is gone; the snapshot table remains.
    const tables = await tableNames(uuid);
    expect(tables).not.toContain('comments');
    expect(tables).toContain('tasks');
  });

  it('does not drop system columns owner_id/created_at/updated_at', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTasksTable(uuid);

    // Snapshot lists only id + title — system columns are "added" relative to it,
    // but rollback must never drop them.
    const prevNoSystem: ExistingTable = {
      name: 'tasks',
      columns: [
        { name: 'id', type: 'INTEGER', pk: true, notnull: false, dflt_value: null },
        { name: 'title', type: 'TEXT', pk: false, notnull: true, dflt_value: null },
      ],
      indexes: [{ name: 'idx_tasks_owner_id', columns: ['owner_id'], unique: false }],
    };

    const result = await rollbackSchema(TEST_CONFIG, uuid, [prevNoSystem]);

    expect(result.success).toBe(true);
    expect(
      result.statements.filter(
        (s) =>
          s.includes('DROP COLUMN') &&
          (s.includes('owner_id') || s.includes('created_at') || s.includes('updated_at')),
      ),
    ).toHaveLength(0);

    // System columns still present on the real table.
    expect(await columnNames(uuid, 'tasks')).toEqual(
      expect.arrayContaining(['owner_id', 'created_at', 'updated_at']),
    );
  });

  it('is a no-op when the live schema matches the snapshot', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTasksTable(uuid);

    const result = await rollbackSchema(TEST_CONFIG, uuid, [PREV_TASKS]);

    expect(result.success).toBe(true);
    expect(result.statements).toHaveLength(0);
    expect(result.details).toContainEqual(
      expect.stringContaining('No rollback actions needed'),
    );

    // Nothing changed on disk.
    expect(await columnNames(uuid, 'tasks')).toEqual([
      'id',
      'title',
      'owner_id',
      'created_at',
      'updated_at',
    ]);
    expect(await tableNames(uuid)).toEqual(['tasks']);
  });

  it('drops indexes that were added since the snapshot', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTasksTable(uuid);
    // An extra index not present in the snapshot.
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE INDEX "idx_tasks_title" ON "tasks" (title)');

    const result = await rollbackSchema(TEST_CONFIG, uuid, [PREV_TASKS]);

    expect(result.success).toBe(true);
    expect(
      result.statements.some((s) => s.includes('DROP INDEX') && s.includes('idx_tasks_title')),
    ).toBe(true);

    // The added index is gone; the snapshot index survives.
    const idx = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='tasks' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
    );
    const names = (idx.results as Array<{ name: string }>).map((r) => r.name);
    expect(names).not.toContain('idx_tasks_title');
    expect(names).toContain('idx_tasks_owner_id');
  });

  it('recreates an index that was removed since the snapshot', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTasksTable(uuid);

    // Snapshot had a unique index on title that no longer exists live.
    const prevWithUnique: ExistingTable = {
      ...PREV_TASKS,
      indexes: [
        { name: 'idx_tasks_owner_id', columns: ['owner_id'], unique: false },
        { name: 'idx_tasks_title_unique', columns: ['title'], unique: true },
      ],
    };

    const result = await rollbackSchema(TEST_CONFIG, uuid, [prevWithUnique]);

    expect(result.success).toBe(true);
    const recreate = result.statements.find(
      (s) => s.includes('CREATE') && s.includes('UNIQUE') && s.includes('idx_tasks_title_unique'),
    );
    expect(recreate).toBeDefined();

    // The removed unique index is back on the real table.
    const idx = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `SELECT name, "unique" AS uniq FROM pragma_index_list('tasks') WHERE name='idx_tasks_title_unique'`,
    );
    const rows = idx.results as Array<{ name: string; uniq: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].uniq).toBe(1);
  });

  it('NEVER drops platform/system tables (any `_`-prefixed name) absent from the snapshot', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTasksTable(uuid);
    // Live per-app system tables that hold real end-user auth + file metadata.
    // These are NOT in the model snapshot, so the broken `_exepad_%` LIKE would
    // have dropped them (a `_` is a single-char LIKE wildcard). They must survive.
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE "_auth_users" (id TEXT PRIMARY KEY, email TEXT)');
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE "_files" (id TEXT PRIMARY KEY)');

    const result = await rollbackSchema(TEST_CONFIG, uuid, [PREV_TASKS]);

    expect(result.success).toBe(true);
    // No DROP TABLE for any `_`-prefixed platform table.
    expect(
      result.statements.some((s) => s.includes('DROP TABLE') && (s.includes('_auth_users') || s.includes('_files'))),
    ).toBe(false);

    const tables = await tableNames(uuid);
    expect(tables).toContain('_auth_users');
    expect(tables).toContain('_files');
  });

  it('with an allow-list, preserves a removed-model table and only drops tables in the set', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTasksTable(uuid);
    // `orders` is a model that was REMOVED from the config — it still holds live
    // rows and must not be dropped. `comments` is genuinely new in this deploy.
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE "orders" (id INTEGER PRIMARY KEY, total INTEGER)');
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE "comments" (id INTEGER PRIMARY KEY, body TEXT)');

    // This deploy's model set is tasks + comments (NOT orders).
    const result = await rollbackSchema(TEST_CONFIG, uuid, [PREV_TASKS], ['tasks', 'comments']);

    expect(result.success).toBe(true);
    // `comments` (in the set, new since snapshot) is dropped; `orders` is preserved.
    expect(result.statements.some((s) => s.includes('DROP TABLE') && s.includes('comments'))).toBe(true);
    expect(result.statements.some((s) => s.includes('DROP TABLE') && s.includes('orders'))).toBe(false);
    expect(result.details).toContainEqual(expect.stringContaining('Preserving table outside'));

    const tables = await tableNames(uuid);
    expect(tables).toContain('orders');
    expect(tables).not.toContain('comments');
    expect(tables).toContain('tasks');
  });

  it('notes when a snapshot table no longer exists (cannot restore)', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    // `tasks` was never created — it is missing relative to the snapshot.
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE TABLE "unrelated" (id INTEGER PRIMARY KEY)',
    );

    const result = await rollbackSchema(TEST_CONFIG, uuid, [PREV_TASKS]);

    expect(result.details).toContainEqual(
      expect.stringContaining('Table missing — cannot restore without data'),
    );
    // No DROP COLUMN is emitted for the missing table.
    expect(result.statements.some((s) => s.includes('DROP COLUMN'))).toBe(false);
  });
});
