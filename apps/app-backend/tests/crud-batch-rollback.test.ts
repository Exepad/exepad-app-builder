/**
 * Execute-time atomicity for sys_batch against a REAL local SQLite database
 * (better-sqlite3 via LocalD1).
 *
 * The existing crud-batch.test.ts uses the hand-rolled mock-d1 and therefore
 * only proves the *pre-validation* pass: it catches malformed operations
 * before any SQL runs. It does NOT prove what happens when an operation is
 * individually valid but fails at *execute* time because of a database
 * constraint (UNIQUE / FOREIGN KEY) that only the real engine enforces.
 *
 * LocalD1.batch() wraps every prepared statement in a single
 * better-sqlite3 `db.transaction()`, so D1's all-or-nothing semantics must
 * hold: if statement N throws, statements 0..N-1 must be rolled back and
 * leave ZERO partial writes. These tests assert that invariant by reading
 * the table back through the same LocalD1 handle afterwards.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LocalD1 } from '@exepad/local-adapters/db';
import { generateCreateTableSQL, generateIndexSQL } from '@exepad/deploy-utils';
import { sysBatch } from '../src/crud/batch';
import { sysCreate } from '../src/crud/create';
import { sysList } from '../src/crud/list';
import { sysRead } from '../src/crud/read';
import { ForbiddenError } from '../src/utils/errors';
import { TEST_MODEL, TEST_MODEL_SHARED, TEST_USER, TEST_ADMIN } from '../tests/helpers/mock-env';
import type { ModelProps, InjectedProps } from '../src/types/env';

// ── Models ───────────────────────────────────────────────────────
// `contacts` (TEST_MODEL) already carries a UNIQUE constraint on `email`.

// A parent model and a child whose `parent_id` FK RESTRICTs deletes and
// requires the referenced row to exist on insert.
const PARENT_MODEL: ModelProps = {
  uuid: 'parent-uuid',
  name: 'parents',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'label', type: 'text' },
  ],
};

const CHILD_MODEL: ModelProps = {
  uuid: 'child-uuid',
  name: 'children',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'note', type: 'text' },
    {
      name: 'parent_id',
      type: 'integer',
      references: { model: 'parents', column: 'id', onDelete: 'restrict' },
    },
  ],
};

const CONFIG: InjectedProps = {
  models: [TEST_MODEL, TEST_MODEL_SHARED, PARENT_MODEL, CHILD_MODEL],
  handlers: [],
};

let db: D1Database;
let rawDb: Database.Database;

beforeEach(() => {
  rawDb = new Database(':memory:');
  // Foreign keys are OFF by default in SQLite; the runtime turns them on.
  rawDb.pragma('foreign_keys = ON');
  for (const model of CONFIG.models) {
    rawDb.exec(generateCreateTableSQL(model));
    for (const idx of generateIndexSQL(model)) rawDb.exec(idx);
  }
  db = new LocalD1(rawDb) as unknown as D1Database;
});

/** Direct row count via the raw handle — bypasses owner scoping entirely. */
function rowCount(table: string): number {
  const row = rawDb.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get() as { c: number };
  return row.c;
}

describe('sys_batch execute-time rollback (real LocalD1)', () => {
  // ── UNIQUE violation mid-batch ─────────────────────────────────
  it('rolls back ALL inserts when a later insert hits a UNIQUE violation', async () => {
    // Op 0 (Alice) and Op 1 (Carol) are both valid. Op 2 reuses Alice's
    // email, which only the real UNIQUE index can detect — pre-validation
    // passes it through. The whole batch must roll back.
    await expect(
      sysBatch(
        {
          operations: [
            { method: 'sys_create', model: 'contacts', params: { data: { name: 'Alice', email: 'dup@x.com' } } },
            { method: 'sys_create', model: 'contacts', params: { data: { name: 'Carol', email: 'carol@x.com' } } },
            { method: 'sys_create', model: 'contacts', params: { data: { name: 'Bob', email: 'dup@x.com' } } },
          ],
        },
        TEST_USER,
        CONFIG,
        db,
      ),
    ).rejects.toThrow();

    // Atomicity: not even the two valid rows survive.
    expect(rowCount('contacts')).toBe(0);
    const list = await sysList(TEST_MODEL, {}, TEST_USER, db);
    expect(list.data as unknown[]).toHaveLength(0);
  });

  it('surfaces a DatabaseError (not a raw SQLite error) on execute-time failure', async () => {
    const err = await sysBatch(
      {
        operations: [
          { method: 'sys_create', model: 'contacts', params: { data: { name: 'A', email: 'same@x.com' } } },
          { method: 'sys_create', model: 'contacts', params: { data: { name: 'B', email: 'same@x.com' } } },
        ],
      },
      TEST_USER,
      CONFIG,
      db,
    ).then(
      () => null,
      (e) => e as Error,
    );

    expect(err).toBeInstanceOf(Error);
    // batch.ts wraps engine errors as `Batch operation failed: ...`.
    expect((err as Error).message).toContain('Batch operation failed');
    expect(rowCount('contacts')).toBe(0);
  });

  // ── Pre-existing rows are untouched ────────────────────────────
  it('leaves PRE-EXISTING committed rows untouched after a failed batch', async () => {
    // Seed a committed row outside the batch.
    const seed = await sysCreate(
      TEST_MODEL,
      { data: { name: 'Existing', email: 'existing@x.com' } },
      TEST_USER,
      db,
    );
    const seedId = (seed.data as Record<string, unknown>).id as number;
    expect(rowCount('contacts')).toBe(1);

    // A batch that creates one new row then collides on the seeded email.
    await expect(
      sysBatch(
        {
          operations: [
            { method: 'sys_create', model: 'contacts', params: { data: { name: 'New', email: 'new@x.com' } } },
            { method: 'sys_create', model: 'contacts', params: { data: { name: 'Clash', email: 'existing@x.com' } } },
          ],
        },
        TEST_USER,
        CONFIG,
        db,
      ),
    ).rejects.toThrow();

    // The seeded row is the ONLY row; the batch's first insert was rolled back.
    expect(rowCount('contacts')).toBe(1);
    const read = await sysRead(TEST_MODEL, { id: seedId }, TEST_USER, db);
    expect((read.data as Record<string, unknown>).name).toBe('Existing');
  });

  // ── Update inside a failing batch is reverted ──────────────────
  it('reverts an earlier UPDATE when a later op in the same batch fails', async () => {
    const a = await sysCreate(TEST_MODEL, { data: { name: 'A', email: 'a@x.com' } }, TEST_USER, db);
    await sysCreate(TEST_MODEL, { data: { name: 'B', email: 'b@x.com' } }, TEST_USER, db);
    const aId = (a.data as Record<string, unknown>).id as number;

    // Op 0 renames A successfully; Op 1 tries to set A's email to B's → UNIQUE
    // violation. The rename must NOT persist.
    await expect(
      sysBatch(
        {
          operations: [
            { method: 'sys_update', model: 'contacts', params: { id: aId, data: { name: 'A-renamed' } } },
            { method: 'sys_update', model: 'contacts', params: { id: aId, data: { email: 'b@x.com' } } },
          ],
        },
        TEST_USER,
        CONFIG,
        db,
      ),
    ).rejects.toThrow();

    const read = await sysRead(TEST_MODEL, { id: aId }, TEST_USER, db);
    expect((read.data as Record<string, unknown>).name).toBe('A');
    expect((read.data as Record<string, unknown>).email).toBe('a@x.com');
  });

  // ── FOREIGN KEY violation mid-batch ────────────────────────────
  it('rolls back the whole batch when an insert violates a FOREIGN KEY constraint', async () => {
    // Seed a real parent so the first child insert is satisfiable.
    const parent = await sysCreate(PARENT_MODEL, { data: { label: 'root' } }, TEST_USER, db);
    const parentId = (parent.data as Record<string, unknown>).id as number;
    expect(rowCount('parents')).toBe(1);

    // Op 0: valid child → existing parent. Op 1: child → nonexistent parent
    // (id 999999) → FK violation that only the engine catches.
    await expect(
      sysBatch(
        {
          operations: [
            { method: 'sys_create', model: 'children', params: { data: { note: 'ok', parent_id: parentId } } },
            { method: 'sys_create', model: 'children', params: { data: { note: 'orphan', parent_id: 999999 } } },
          ],
        },
        TEST_USER,
        CONFIG,
        db,
      ),
    ).rejects.toThrow();

    // The first, valid child must NOT survive.
    expect(rowCount('children')).toBe(0);
    const list = await sysList(CHILD_MODEL, {}, TEST_USER, db);
    expect(list.data as unknown[]).toHaveLength(0);
  });

  it('rolls back a batch DELETE blocked by ON DELETE RESTRICT', async () => {
    const parent = await sysCreate(PARENT_MODEL, { data: { label: 'root' } }, TEST_USER, db);
    const parentId = (parent.data as Record<string, unknown>).id as number;
    await sysCreate(CHILD_MODEL, { data: { note: 'dep', parent_id: parentId } }, TEST_USER, db);

    // Op 0: create a second parent (valid). Op 1: delete the referenced parent
    // → blocked by ON DELETE RESTRICT (a dependent child exists). The new
    // parent from Op 0 must be rolled back too.
    await expect(
      sysBatch(
        {
          operations: [
            { method: 'sys_create', model: 'parents', params: { data: { label: 'second' } } },
            { method: 'sys_delete', model: 'parents', params: { id: parentId } },
          ],
        },
        TEST_USER,
        CONFIG,
        db,
      ),
    ).rejects.toThrow();

    // Still exactly one parent (the original); Op 0's parent did not commit
    // and the referenced parent was not deleted.
    expect(rowCount('parents')).toBe(1);
    const remaining = rawDb.prepare(`SELECT id FROM "parents"`).get() as { id: number };
    expect(remaining.id).toBe(parentId);
  });

  // ── Sanity: a fully valid batch DOES commit on real LocalD1 ────
  it('commits every operation when the whole batch is valid (positive control)', async () => {
    const result = await sysBatch(
      {
        operations: [
          { method: 'sys_create', model: 'contacts', params: { data: { name: 'One', email: 'one@x.com' } } },
          { method: 'sys_create', model: 'contacts', params: { data: { name: 'Two', email: 'two@x.com' } } },
        ],
      },
      TEST_USER,
      CONFIG,
      db,
    );

    expect(result.success).toBe(true);
    expect((result.data as { results: unknown[] }).results).toHaveLength(2);
    expect(rowCount('contacts')).toBe(2);
    const list = await sysList(TEST_MODEL, {}, TEST_USER, db);
    expect(list.data as unknown[]).toHaveLength(2);
  });
});

// ── Cross-tenant write authorization on shared-scope models ──────────
// Regression guard for the sys_batch owner-check bypass: batch update/delete
// on a shared-scope model MUST enforce the same owner-or-admin rule as the
// single-record path. Before the fix, any authenticated user could mutate or
// delete another user's rows by id through sys_batch.
describe('sys_batch shared-scope write authorization (real LocalD1)', () => {
  const OTHER_USER = {
    id: 'user-456',
    email: 'mallory@example.com',
    roles: [] as string[],
    isAuthenticated: true,
  };

  async function seedSharedRowOwnedByUser(): Promise<number> {
    const created = await sysCreate(
      TEST_MODEL_SHARED,
      { data: { name: 'Owned', email: 'owner-row@x.com' } },
      TEST_USER,
      db,
    );
    return (created.data as Record<string, unknown>).id as number;
  }

  it('rejects a batch sys_update of another user\'s shared row (Forbidden, row unchanged)', async () => {
    const id = await seedSharedRowOwnedByUser();

    const err = await sysBatch(
      { operations: [{ method: 'sys_update', model: 'announcements', params: { id, data: { name: 'Hijacked' } } }] },
      OTHER_USER,
      CONFIG,
      db,
    ).then(() => null, (e) => e as Error);

    expect(err).toBeInstanceOf(ForbiddenError);
    // The victim's row must be untouched.
    const read = await sysRead(TEST_MODEL_SHARED, { id }, TEST_USER, db);
    expect((read.data as Record<string, unknown>).name).toBe('Owned');
  });

  it('rejects a batch sys_delete of another user\'s shared row (Forbidden, row survives)', async () => {
    const id = await seedSharedRowOwnedByUser();

    const err = await sysBatch(
      { operations: [{ method: 'sys_delete', model: 'announcements', params: { id } }] },
      OTHER_USER,
      CONFIG,
      db,
    ).then(() => null, (e) => e as Error);

    expect(err).toBeInstanceOf(ForbiddenError);
    expect(rowCount('announcements')).toBe(1);
  });

  it('allows the owner to update their own shared row via batch', async () => {
    const id = await seedSharedRowOwnedByUser();

    const result = await sysBatch(
      { operations: [{ method: 'sys_update', model: 'announcements', params: { id, data: { name: 'Owner-edit' } } }] },
      TEST_USER,
      CONFIG,
      db,
    );

    expect(result.success).toBe(true);
    const read = await sysRead(TEST_MODEL_SHARED, { id }, TEST_USER, db);
    expect((read.data as Record<string, unknown>).name).toBe('Owner-edit');
  });

  it('allows an admin to delete any user\'s shared row via batch', async () => {
    const id = await seedSharedRowOwnedByUser();

    const result = await sysBatch(
      { operations: [{ method: 'sys_delete', model: 'announcements', params: { id } }] },
      TEST_ADMIN,
      CONFIG,
      db,
    );

    expect(result.success).toBe(true);
    expect(rowCount('announcements')).toBe(0);
  });
});
