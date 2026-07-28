/**
 * End-to-end CRUD against a REAL local SQLite database (better-sqlite3 via
 * LocalD1), instead of the hand-rolled mock-d1. This is the integration proof
 * for the single-container runtime: the app-backend's CRUD SQL, the deploy
 * pipeline's schema builder, and the LocalD1 D1-compatibility layer all work
 * together against an actual database.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LocalD1 } from '@exepad/local-adapters/db';
import { generateCreateTableSQL, generateIndexSQL } from '@exepad/deploy-utils';
import { sysCreate } from '../src/crud/create';
import { sysRead } from '../src/crud/read';
import { sysList } from '../src/crud/list';
import { sysUpdate } from '../src/crud/update';
import { sysDelete } from '../src/crud/delete';
import { TEST_MODEL, TEST_USER } from './helpers/mock-env';

let db: D1Database;

beforeEach(() => {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  raw.exec(generateCreateTableSQL(TEST_MODEL));
  for (const idx of generateIndexSQL(TEST_MODEL)) raw.exec(idx);
  db = new LocalD1(raw) as unknown as D1Database;
});

describe('CRUD against real LocalD1', () => {
  it('creates a row and reads it back', async () => {
    const created = await sysCreate(
      TEST_MODEL,
      { data: { name: 'Alice', email: 'alice@example.com' } },
      TEST_USER,
      db,
    );
    expect(created.success).toBe(true);
    const row = created.data as Record<string, unknown>;
    expect(row.name).toBe('Alice');
    expect(row.owner_id).toBe(TEST_USER.id);
    expect(typeof row.id).toBe('number');

    const read = await sysRead(TEST_MODEL, { id: row.id as number }, TEST_USER, db);
    expect(read.success).toBe(true);
    expect((read.data as Record<string, unknown>).email).toBe('alice@example.com');
  });

  it('lists owner-scoped rows', async () => {
    await sysCreate(TEST_MODEL, { data: { name: 'A', email: 'a@x.com' } }, TEST_USER, db);
    await sysCreate(TEST_MODEL, { data: { name: 'B', email: 'b@x.com' } }, TEST_USER, db);

    const list = await sysList(TEST_MODEL, {}, TEST_USER, db);
    expect(list.success).toBe(true);
    const records = list.data as Record<string, unknown>[];
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.name).sort()).toEqual(['A', 'B']);
  });

  it('enforces the unique index from the schema builder', async () => {
    await sysCreate(TEST_MODEL, { data: { name: 'A', email: 'dup@x.com' } }, TEST_USER, db);
    // email is isUnique → second insert violates the generated UNIQUE index.
    await expect(
      sysCreate(TEST_MODEL, { data: { name: 'B', email: 'dup@x.com' } }, TEST_USER, db),
    ).rejects.toThrow();
  });

  it('updates a row', async () => {
    const created = await sysCreate(
      TEST_MODEL,
      { data: { name: 'Bob', email: 'bob@x.com' } },
      TEST_USER,
      db,
    );
    const id = (created.data as Record<string, unknown>).id as number;

    const updated = await sysUpdate(TEST_MODEL, { id, data: { name: 'Bobby' } }, TEST_USER, db);
    expect(updated.success).toBe(true);

    const read = await sysRead(TEST_MODEL, { id }, TEST_USER, db);
    expect((read.data as Record<string, unknown>).name).toBe('Bobby');
  });

  it('deletes a row', async () => {
    const created = await sysCreate(
      TEST_MODEL,
      { data: { name: 'Carol', email: 'carol@x.com' } },
      TEST_USER,
      db,
    );
    const id = (created.data as Record<string, unknown>).id as number;

    const del = await sysDelete(TEST_MODEL, { id }, TEST_USER, db);
    expect(del.success).toBe(true);

    const list = await sysList(TEST_MODEL, {}, TEST_USER, db);
    expect(list.data as unknown[]).toHaveLength(0);
  });
});
