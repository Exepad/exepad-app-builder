/**
 * Tests for D1 introspection against real local SQLite.
 *
 * `introspectTableREST` runs real PRAGMA queries (table_info / index_list /
 * index_info) against a `better-sqlite3` file provisioned under
 * `$EXEPAD_DATA_DIR/apps/{appId}/{mode}.sqlite`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { introspectTableREST } from '../src/deploy/d1-introspect';
import { executeD1DDL, provisionD1Database } from '../src/deploy/d1';
import { TEST_CONFIG, setupDataDir, teardownDataDir } from './helpers/local-db';

beforeEach(() => {
  setupDataDir();
});
afterEach(() => {
  teardownDataDir();
});

describe('introspectTableREST', () => {
  it('returns null when the table does not exist', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    const result = await introspectTableREST(TEST_CONFIG, uuid, 'nonexistent');
    expect(result).toBeNull();
  });

  it('returns columns (name/type/notnull/dflt_value/pk) for a created table', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      `CREATE TABLE test_table (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        notes TEXT DEFAULT 'default'
      )`,
    );

    const result = await introspectTableREST(TEST_CONFIG, uuid, 'test_table');

    expect(result).not.toBeNull();
    expect(result!.name).toBe('test_table');
    expect(result!.columns).toHaveLength(3);

    const id = result!.columns.find((c) => c.name === 'id')!;
    expect(id.type).toBe('INTEGER');
    expect(id.pk).toBe(true);

    const name = result!.columns.find((c) => c.name === 'name')!;
    expect(name.type).toBe('TEXT');
    expect(name.notnull).toBe(true);
    expect(name.pk).toBe(false);

    const notes = result!.columns.find((c) => c.name === 'notes')!;
    expect(notes.notnull).toBe(false);
    expect(notes.dflt_value).toBe("'default'");
  });

  it('has empty indexes for a table without secondary indexes', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE TABLE plain (id INTEGER PRIMARY KEY, name TEXT)',
    );

    const result = await introspectTableREST(TEST_CONFIG, uuid, 'plain');
    expect(result).not.toBeNull();
    expect(result!.indexes).toEqual([]);
  });

  it('reports a UNIQUE index created via CREATE UNIQUE INDEX', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE TABLE test_table (id INTEGER PRIMARY KEY, owner_id TEXT, name TEXT)',
    );
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE UNIQUE INDEX idx_test_owner_id ON test_table (owner_id)',
    );

    const result = await introspectTableREST(TEST_CONFIG, uuid, 'test_table');

    expect(result).not.toBeNull();
    const idx = result!.indexes.find((i) => i.name === 'idx_test_owner_id');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(true);
    expect(idx!.columns).toEqual(['owner_id']);
  });

  it('reports a multi-column non-unique index in column order', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE TABLE test_table (id INTEGER PRIMARY KEY, a TEXT, b TEXT)',
    );
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE INDEX idx_a_b ON test_table (a, b)',
    );

    const result = await introspectTableREST(TEST_CONFIG, uuid, 'test_table');

    const idx = result!.indexes.find((i) => i.name === 'idx_a_b');
    expect(idx).toBeDefined();
    expect(idx!.unique).toBe(false);
    expect(idx!.columns).toEqual(['a', 'b']);
  });

  it('skips sqlite_autoindex_* entries (e.g. from a UNIQUE column constraint)', async () => {
    const { uuid } = await provisionD1Database(TEST_CONFIG);
    // A UNIQUE column constraint makes SQLite create a sqlite_autoindex_*.
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE TABLE test_table (id INTEGER PRIMARY KEY, email TEXT UNIQUE)',
    );
    // Plus one explicit, named index that should survive.
    await executeD1DDL(
      TEST_CONFIG,
      uuid,
      'CREATE INDEX idx_custom ON test_table (email)',
    );

    const result = await introspectTableREST(TEST_CONFIG, uuid, 'test_table');

    expect(result).not.toBeNull();
    // No sqlite_autoindex_* entries leak through — only the explicit index remains.
    expect(result!.indexes.every((i) => !i.name.startsWith('sqlite_autoindex_'))).toBe(true);
    expect(result!.indexes).toHaveLength(1);
    expect(result!.indexes[0].name).toBe('idx_custom');
  });
});
