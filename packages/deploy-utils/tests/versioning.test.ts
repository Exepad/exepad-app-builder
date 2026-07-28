/**
 * Tests for deployment versioning against the local SQLite backend.
 *
 * saveDeploymentSnapshot / getPreviousSchema / getSchemaVersion introspect the
 * real model tables and persist a JSON snapshot into the `_exepad_meta` table.
 * No Cloudflare D1 REST API — everything runs against `better-sqlite3` files
 * under `$EXEPAD_DATA_DIR`.
 */

import { existsSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  saveDeploymentSnapshot,
  getPreviousSchema,
  getSchemaVersion,
  backupAppDatabase,
  listAppDatabaseBackups,
  pruneAppDatabaseBackups,
  restoreAppDatabase,
} from '../src/deploy/versioning';
import { provisionD1Database, executeD1DDL, executeD1Query } from '../src/deploy/d1';
import { generateCreateTableSQL } from '../src/schema/builder';
import type { ModelProps } from '../src/schema/types';
import { TEST_CONFIG, setupDataDir, teardownDataDir } from './helpers/local-db';

beforeEach(() => {
  setupDataDir();
});
afterEach(() => {
  teardownDataDir();
});

const TASKS_MODEL: ModelProps = {
  uuid: 'm-tasks',
  name: 'tasks',
  columns: [{ name: 'title', type: 'text' }],
};

const USERS_MODEL: ModelProps = {
  uuid: 'm-users',
  name: 'users',
  columns: [{ name: 'email', type: 'text', isUnique: true }],
};

/** Create the real SQLite tables for the given models. */
async function createTables(dbId: string, models: ModelProps[]): Promise<void> {
  for (const model of models) {
    await executeD1DDL(TEST_CONFIG, dbId, generateCreateTableSQL(model));
  }
}

describe('getPreviousSchema (no snapshot yet)', () => {
  it('returns null before any snapshot has been saved', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    expect(await getPreviousSchema(TEST_CONFIG, uuid)).toBeNull();
  });
});

describe('getSchemaVersion (no snapshot yet)', () => {
  it('returns null before any snapshot has been saved', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    expect(await getSchemaVersion(TEST_CONFIG, uuid)).toBeNull();
  });
});

describe('saveDeploymentSnapshot', () => {
  it('returns an ISO version string and persists the snapshot', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTables(uuid, [TASKS_MODEL]);

    const version = await saveDeploymentSnapshot(TEST_CONFIG, uuid, [TASKS_MODEL]);
    expect(version).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);

    // The _exepad_meta table now exists and holds both keys.
    const meta = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `SELECT "key" FROM "_exepad_meta" ORDER BY "key"`,
    );
    const keys = (meta.results as Array<{ key: string }>).map((r) => r.key);
    expect(keys).toEqual(['previous_schema', 'schema_version']);
  });

  it('handles a model whose table does not exist yet (empty snapshot)', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    // No tables created — introspection finds nothing.
    const version = await saveDeploymentSnapshot(TEST_CONFIG, uuid, [TASKS_MODEL]);
    expect(version).toBeTruthy();

    const schema = await getPreviousSchema(TEST_CONFIG, uuid);
    expect(schema).toEqual([]);
  });

  it('records every existing model table in the snapshot', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTables(uuid, [TASKS_MODEL, USERS_MODEL]);

    await saveDeploymentSnapshot(TEST_CONFIG, uuid, [TASKS_MODEL, USERS_MODEL]);

    const schema = await getPreviousSchema(TEST_CONFIG, uuid);
    expect(schema).not.toBeNull();
    const names = schema!.map((t) => t.name).sort();
    expect(names).toEqual(['tasks', 'users']);
  });
});

describe('getPreviousSchema (after snapshot)', () => {
  it('returns the introspected ExistingTable[] including the created table', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTables(uuid, [TASKS_MODEL]);
    await saveDeploymentSnapshot(TEST_CONFIG, uuid, [TASKS_MODEL]);

    const schema = await getPreviousSchema(TEST_CONFIG, uuid);
    expect(schema).not.toBeNull();
    expect(schema).toHaveLength(1);

    const table = schema![0];
    expect(table.name).toBe('tasks');

    // Introspection should surface the user column plus auto-added system columns.
    const columnNames = table.columns.map((c) => c.name);
    expect(columnNames).toContain('title');
    expect(columnNames).toContain('id');
    expect(columnNames).toContain('owner_id');
    expect(columnNames).toContain('created_at');
    expect(columnNames).toContain('updated_at');

    // The injected primary key is introspected as such.
    const idCol = table.columns.find((c) => c.name === 'id');
    expect(idCol?.pk).toBe(true);
  });

  it('only re-reads what was snapshotted, not the live table', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTables(uuid, [TASKS_MODEL]);
    await saveDeploymentSnapshot(TEST_CONFIG, uuid, [TASKS_MODEL]);

    // Add a brand-new table AFTER the snapshot — it must not appear in the
    // previous-schema snapshot.
    await createTables(uuid, [USERS_MODEL]);

    const schema = await getPreviousSchema(TEST_CONFIG, uuid);
    expect(schema!.map((t) => t.name)).toEqual(['tasks']);
  });
});

describe('getSchemaVersion (after snapshot)', () => {
  it('returns the same ISO timestamp that saveDeploymentSnapshot returned', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTables(uuid, [TASKS_MODEL]);

    const version = await saveDeploymentSnapshot(TEST_CONFIG, uuid, [TASKS_MODEL]);
    const stored = await getSchemaVersion(TEST_CONFIG, uuid);

    expect(stored).toBe(version);
    expect(stored).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/);
  });

  it('overwrites the version on a subsequent snapshot', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await createTables(uuid, [TASKS_MODEL]);

    const first = await saveDeploymentSnapshot(TEST_CONFIG, uuid, [TASKS_MODEL]);
    // Force a distinct timestamp.
    await new Promise((r) => setTimeout(r, 5));
    const second = await saveDeploymentSnapshot(TEST_CONFIG, uuid, [TASKS_MODEL]);

    expect(second).not.toBe(first);
    expect(await getSchemaVersion(TEST_CONFIG, uuid)).toBe(second);
  });
});

describe('byte-level backup / restore', () => {
  /** Insert one row into tasks and return the live row count. */
  async function seedRow(uuid: string, title: string): Promise<void> {
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `INSERT INTO "tasks" (title, owner_id, created_at, updated_at) VALUES ('${title}', 'u1', 't', 't')`,
    );
  }
  async function titles(uuid: string): Promise<string[]> {
    const res = await executeD1Query(TEST_CONFIG, uuid, `SELECT title FROM "tasks" ORDER BY title`);
    return (res.results as Array<{ title: string }>).map((r) => r.title);
  }

  it('backupAppDatabase writes a non-empty file under backups/ with row data intact', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, generateCreateTableSQL(TASKS_MODEL));
    await seedRow(uuid, 'keep-me');

    const backup = await backupAppDatabase(uuid, 'corr-123');

    expect(existsSync(backup.path)).toBe(true);
    expect(backup.path).toContain('backups');
    expect(backup.path).toContain('corr-123');
    expect(backup.bytes).toBeGreaterThan(0);
    expect(listAppDatabaseBackups(uuid)).toContain(backup.path);
  });

  it('restoreAppDatabase reverts row data written after the backup', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, generateCreateTableSQL(TASKS_MODEL));
    await seedRow(uuid, 'original');

    const backup = await backupAppDatabase(uuid);

    // Mutate AFTER the backup: add a row and drop a column's worth of data.
    await seedRow(uuid, 'added-after-backup');
    expect(await titles(uuid)).toEqual(['added-after-backup', 'original']);

    await restoreAppDatabase(uuid, backup.path);

    // The post-backup row is gone; the pre-backup state is restored.
    expect(await titles(uuid)).toEqual(['original']);
  });

  it('restoreAppDatabase reverts a dropped table (schema + data)', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, generateCreateTableSQL(TASKS_MODEL));
    await seedRow(uuid, 'original');

    const backup = await backupAppDatabase(uuid);

    // Simulate a destructive migration that dropped the whole table.
    await executeD1DDL(TEST_CONFIG, uuid, `DROP TABLE "tasks"`);
    const gone = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'`,
    );
    expect((gone.results as unknown[]).length).toBe(0);

    await restoreAppDatabase(uuid, backup.path);

    // Table + its row are back.
    expect(await titles(uuid)).toEqual(['original']);
  });

  it('restoreAppDatabase throws when the backup file is missing', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await expect(restoreAppDatabase(uuid, '/nonexistent/backup.sqlite')).rejects.toThrow();
  });

  it('pruneAppDatabaseBackups keeps only the newest N, deleting older ones', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, generateCreateTableSQL(TASKS_MODEL));

    // Take several backups with distinct timestamps.
    for (let i = 0; i < 4; i++) {
      await backupAppDatabase(uuid, `b${i}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(listAppDatabaseBackups(uuid)).toHaveLength(4);

    const pruned = pruneAppDatabaseBackups(uuid, 2);
    expect(pruned).toHaveLength(2);
    const remaining = listAppDatabaseBackups(uuid);
    expect(remaining).toHaveLength(2);
    // The two kept are the newest (b2, b3), sorted chronologically.
    expect(remaining[0]).toContain('b2');
    expect(remaining[1]).toContain('b3');
  });
});
