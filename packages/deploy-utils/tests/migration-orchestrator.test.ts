/**
 * Tests for the migration orchestrator against the local SQLite backend.
 *
 * planMigrations()/applyMigrations() now introspect + execute against real
 * `better-sqlite3` files under `$EXEPAD_DATA_DIR/apps/{appId}/{mode}.sqlite`
 * (no Cloudflare D1 REST API). We provision a real database per test, apply
 * migrations, then verify the schema by querying `sqlite_master` / PRAGMA.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { planMigrations, applyMigrations } from '../src/deploy/migration-orchestrator';
import { executeD1DDL, provisionD1Database } from '../src/deploy/d1';
import { TEST_CONFIG, setupDataDir, teardownDataDir } from './helpers/local-db';
import type { ModelProps } from '@exepad/types';

beforeEach(() => {
  setupDataDir();
});
afterEach(() => {
  teardownDataDir();
});

const TASKS_MODEL: ModelProps = {
  uuid: 'm1',
  name: 'tasks',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'title', type: 'text' },
    { name: 'done', type: 'integer', defaultValue: 0 },
  ],
  indexes: [{ name: 'idx_tasks_title', columns: ['title'] }],
};

const USERS_MODEL: ModelProps = {
  uuid: 'm2',
  name: 'users',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'email', type: 'text', isUnique: true },
    { name: 'name', type: 'text' },
  ],
};

/** True if `table` exists in the SQLite schema. */
async function tableExists(dbId: string, table: string): Promise<boolean> {
  const res = await executeD1DDL(
    TEST_CONFIG,
    dbId,
    `SELECT name FROM sqlite_master WHERE type='table' AND name='${table}'`,
  );
  return (res.results as Array<{ name: string }>).length > 0;
}

/** Lowercased column names of an existing table, via PRAGMA. */
async function columnNames(dbId: string, table: string): Promise<string[]> {
  const res = await executeD1DDL(TEST_CONFIG, dbId, `PRAGMA table_info("${table}")`);
  return (res.results as Array<{ name: string }>).map((r) => r.name);
}

describe('planMigrations', () => {
  it('plans CREATE TABLE + index statements for a brand-new model', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    const result = await planMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);

    expect(result.statements.length).toBeGreaterThan(0);
    expect(result.isDestructive).toBe(false);
    expect(result.warnings).toEqual([]);

    const createTable = result.statements.find((s) => s.includes('CREATE TABLE'));
    expect(createTable).toBeDefined();
    expect(createTable).toContain('tasks');

    const createIndex = result.statements.find((s) => s.includes('CREATE INDEX'));
    expect(createIndex).toBeDefined();
  });

  it('is a pure preview — it does not create the table', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    await planMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);

    expect(await tableExists(uuid, 'tasks')).toBe(false);
  });

  it('plans CREATE TABLE for every model', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    const result = await planMigrations(TEST_CONFIG, uuid, [TASKS_MODEL, USERS_MODEL]);

    const createTables = result.statements.filter((s) => s.includes('CREATE TABLE'));
    expect(createTables).toHaveLength(2);
  });

  it('plans an additive ALTER TABLE for a new nullable column on an existing table', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    // Create the table from the base model first.
    await applyMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);

    // Augment the model with a new nullable column.
    const augmented: ModelProps = {
      ...TASKS_MODEL,
      columns: [...TASKS_MODEL.columns, { name: 'priority', type: 'integer', isNullable: true }],
    };

    const result = await planMigrations(TEST_CONFIG, uuid, [augmented]);

    const alterStmt = result.statements.find(
      (s) => s.includes('ALTER TABLE') && s.includes('priority'),
    );
    expect(alterStmt).toBeDefined();
    expect(alterStmt).toContain('ADD COLUMN');
    expect(result.isDestructive).toBe(false);
  });

  it('plans no ALTER statements when the existing schema already matches', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await applyMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);

    const result = await planMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);

    expect(result.isDestructive).toBe(false);
    const alterStmts = result.statements.filter((s) => s.includes('ALTER TABLE'));
    expect(alterStmts).toHaveLength(0);
  });
});

describe('applyMigrations', () => {
  it('actually creates the table and its columns', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    const result = await applyMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);
    expect(result.statements.length).toBeGreaterThan(0);

    // Verify via sqlite_master that the table now exists.
    expect(await tableExists(uuid, 'tasks')).toBe(true);

    // Verify the user-defined + system columns landed.
    const cols = await columnNames(uuid, 'tasks');
    expect(cols).toEqual(expect.arrayContaining(['id', 'title', 'done', 'owner_id', 'created_at', 'updated_at']));
  });

  it('creates every model in a multi-model migration', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    await applyMigrations(TEST_CONFIG, uuid, [TASKS_MODEL, USERS_MODEL]);

    expect(await tableExists(uuid, 'tasks')).toBe(true);
    expect(await tableExists(uuid, 'users')).toBe(true);
  });

  it('creates the user-defined indexes', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await applyMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);

    const res = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_title'",
    );
    expect((res.results as Array<{ name: string }>)).toHaveLength(1);
  });

  it('re-applying the same model is an effective no-op (idempotent, no throw)', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);

    await applyMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);

    // Second apply: existing-table diff yields no ALTER/index statements.
    const second = await applyMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);
    expect(second.isDestructive).toBe(false);
    expect(second.statements.filter((s) => s.includes('ALTER TABLE'))).toHaveLength(0);

    // Table + columns are still intact and unchanged.
    expect(await tableExists(uuid, 'tasks')).toBe(true);
    const cols = await columnNames(uuid, 'tasks');
    expect(cols).toEqual(expect.arrayContaining(['id', 'title', 'done']));
  });

  it('applies an additive column on a subsequent run', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await applyMigrations(TEST_CONFIG, uuid, [TASKS_MODEL]);

    const augmented: ModelProps = {
      ...TASKS_MODEL,
      columns: [...TASKS_MODEL.columns, { name: 'priority', type: 'integer', isNullable: true }],
    };
    await applyMigrations(TEST_CONFIG, uuid, [augmented]);

    const cols = await columnNames(uuid, 'tasks');
    expect(cols).toContain('priority');
  });

  it('returns the same result structure as planMigrations', async () => {
    const planDb = await provisionD1Database(TEST_CONFIG);
    const plan = await planMigrations(TEST_CONFIG, planDb.uuid, [TASKS_MODEL]);

    // Fresh database so apply plans against an identical (empty) starting state.
    teardownDataDir();
    setupDataDir();
    const applyDb = await provisionD1Database(TEST_CONFIG);
    const applied = await applyMigrations(TEST_CONFIG, applyDb.uuid, [TASKS_MODEL]);

    expect(applied.statements).toEqual(plan.statements);
    expect(applied.warnings).toEqual(plan.warnings);
    expect(applied.isDestructive).toEqual(plan.isDestructive);
  });
});
