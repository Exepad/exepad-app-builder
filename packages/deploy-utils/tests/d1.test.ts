/**
 * Tests for local SQLite database provisioning + execution.
 *
 * The deploy pipeline runs against real `better-sqlite3` files under
 * `$EXEPAD_DATA_DIR/apps/{appId}/{mode}.sqlite` — no Cloudflare D1 REST API.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import {
  createD1Database,
  deleteD1Database,
  executeD1DDL,
  executeD1DDLBatch,
  executeD1Query,
  listD1Databases,
  getD1Database,
  provisionD1Database,
} from '../src/deploy/d1';
import { appDbPath } from '@exepad/local-adapters/db';
import { TEST_CONFIG, configFor, setupDataDir, teardownDataDir } from './helpers/local-db';

beforeEach(() => {
  setupDataDir();
});
afterEach(() => {
  teardownDataDir();
});

describe('provisionD1Database', () => {
  it('creates the SQLite file at apps/{appId}/published.sqlite', async () => {
    const result = await provisionD1Database(TEST_CONFIG);
    expect(result.uuid).toBe(appDbPath('testapp01', 'published'));
    expect(result.name).toBe('exepad-testapp01');
    expect(existsSync(result.uuid)).toBe(true);
  });

  it('infers preview mode from the d1NamingPattern', async () => {
    const result = await provisionD1Database({
      ...TEST_CONFIG,
      d1NamingPattern: 'exepad-preview-testapp01',
    });
    expect(result.uuid).toBe(appDbPath('testapp01', 'preview'));
    expect(result.name).toBe('exepad-preview-testapp01');
  });

  it('honors an explicit mode on the config', async () => {
    const result = await provisionD1Database({ ...TEST_CONFIG, mode: 'preview' });
    expect(result.uuid).toBe(appDbPath('testapp01', 'preview'));
  });

  it('is idempotent — re-provisioning returns the same path', async () => {
    const a = await provisionD1Database(TEST_CONFIG);
    const b = await provisionD1Database(TEST_CONFIG);
    expect(a.uuid).toBe(b.uuid);
  });
});

describe('createD1Database / getD1Database', () => {
  it('createD1Database opens the file; getD1Database then finds it', async () => {
    expect(await getD1Database(TEST_CONFIG, 'exepad-testapp01')).toBeNull();
    const created = await createD1Database(TEST_CONFIG, 'exepad-testapp01');
    expect(created.name).toBe('exepad-testapp01');
    const found = await getD1Database(TEST_CONFIG, 'exepad-testapp01');
    expect(found).not.toBeNull();
    expect(found!.uuid).toBe(created.uuid);
  });

  it('getD1Database returns null when the database does not exist', async () => {
    expect(await getD1Database(TEST_CONFIG, 'exepad-nope')).toBeNull();
  });

  it('distinguishes preview vs published by name', async () => {
    await createD1Database(TEST_CONFIG, 'exepad-preview-testapp01');
    expect(await getD1Database(TEST_CONFIG, 'exepad-preview-testapp01')).not.toBeNull();
    expect(await getD1Database(TEST_CONFIG, 'exepad-testapp01')).toBeNull();
  });
});

describe('deleteD1Database', () => {
  it('removes the database file', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    expect(existsSync(uuid)).toBe(true);
    await deleteD1Database(TEST_CONFIG, uuid);
    expect(existsSync(uuid)).toBe(false);
  });

  it('is a no-op for a missing file', async () => {
    await expect(deleteD1Database(TEST_CONFIG, appDbPath('ghost', 'published'))).resolves.toBeUndefined();
  });
});

describe('listD1Databases', () => {
  it('returns all provisioned databases across apps + modes', async () => {
    await provisionD1Database(configFor('appaaa', 'published'));
    await provisionD1Database(configFor('appaaa', 'preview'));
    await provisionD1Database(configFor('appbbb', 'published'));

    const dbs = await listD1Databases(TEST_CONFIG);
    const names = dbs.map((d) => d.name).sort();
    expect(names).toEqual(['exepad-appaaa', 'exepad-appbbb', 'exepad-preview-appaaa']);
  });

  it('filters by exact name', async () => {
    await provisionD1Database(configFor('appaaa', 'published'));
    await provisionD1Database(configFor('appbbb', 'published'));
    const dbs = await listD1Databases(TEST_CONFIG, { name: 'exepad-appbbb' });
    expect(dbs).toHaveLength(1);
    expect(dbs[0].name).toBe('exepad-appbbb');
  });

  it('returns [] when nothing is provisioned', async () => {
    expect(await listD1Databases(TEST_CONFIG)).toEqual([]);
  });
});

describe('executeD1DDL', () => {
  it('runs DDL then returns rows for a SELECT', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE t (id INTEGER PRIMARY KEY, n TEXT)');
    await executeD1DDL(TEST_CONFIG, uuid, "INSERT INTO t (n) VALUES ('a')");

    const res = await executeD1DDL(TEST_CONFIG, uuid, 'SELECT n FROM t');
    expect(res.success).toBe(true);
    expect(res.results).toEqual([{ n: 'a' }]);
  });

  it('runs a multi-statement string atomically (no result rows)', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    const res = await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE a (x); CREATE TABLE b (y);');
    expect(res.success).toBe(true);
    expect(res.results).toEqual([]);
    // Both tables exist.
    const tables = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b') ORDER BY name",
    );
    expect((tables.results as Array<{ name: string }>).map((r) => r.name)).toEqual(['a', 'b']);
  });

  it('rolls back a failed multi-statement batch', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE t (id INTEGER PRIMARY KEY)');
    // Second statement is invalid → whole exec rolls back, first insert reverted.
    await expect(
      executeD1DDL(TEST_CONFIG, uuid, 'INSERT INTO t (id) VALUES (1); INSERT INTO t (id) VALUES (1);'),
    ).rejects.toThrow();
    const count = await executeD1DDL(TEST_CONFIG, uuid, 'SELECT COUNT(*) AS c FROM t');
    expect((count.results[0] as { c: number }).c).toBe(0);
  });

  it('throws on a genuine SQL error', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await expect(executeD1DDL(TEST_CONFIG, uuid, 'SELECT * FROM does_not_exist')).rejects.toThrow();
  });
});

describe('executeD1Query', () => {
  it('binds ? params and reports change counts', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE t (id INTEGER PRIMARY KEY, n TEXT)');

    const ins = await executeD1Query(TEST_CONFIG, uuid, 'INSERT INTO t (n) VALUES (?)', ['x']);
    expect(ins.success).toBe(true);
    expect((ins.meta as { changes: number }).changes).toBe(1);

    const sel = await executeD1Query(TEST_CONFIG, uuid, 'SELECT n FROM t WHERE n = ?', ['x']);
    expect(sel.results).toEqual([{ n: 'x' }]);
  });

  it('normalizes null params', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(TEST_CONFIG, uuid, 'CREATE TABLE t (id INTEGER PRIMARY KEY, n TEXT)');
    await executeD1Query(TEST_CONFIG, uuid, 'INSERT INTO t (n) VALUES (?)', [null]);
    const sel = await executeD1Query(TEST_CONFIG, uuid, 'SELECT n FROM t');
    expect(sel.results).toEqual([{ n: null }]);
  });
});

describe('executeD1DDLBatch', () => {
  it('returns success for an empty batch', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    const res = await executeD1DDLBatch(TEST_CONFIG, uuid, []);
    expect(res).toEqual({ success: true, results: [] });
  });

  it('applies every statement atomically', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDLBatch(TEST_CONFIG, uuid, [
      'CREATE TABLE a (x)',
      'CREATE TABLE b (y)',
      'CREATE TABLE c (z)',
    ]);
    const tables = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('a','b','c') ORDER BY name",
    );
    expect((tables.results as Array<{ name: string }>).map((r) => r.name)).toEqual(['a', 'b', 'c']);
  });

  it('rolls back the whole batch on a failing statement', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await expect(
      executeD1DDLBatch(TEST_CONFIG, uuid, ['CREATE TABLE a (x)', 'CREATE TABLE a (x)']),
    ).rejects.toThrow();
    const tables = await executeD1DDL(
      TEST_CONFIG,
      uuid,
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'a'",
    );
    expect(tables.results).toEqual([]);
  });
});
