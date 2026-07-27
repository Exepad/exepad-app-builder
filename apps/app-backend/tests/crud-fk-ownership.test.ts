/**
 * Cross-tenant foreign-key ownership guard (2026-06-27).
 *
 * Live-found on the LedgerLite SaaS audit: SQLite's FK constraint only checks
 * that the referenced row EXISTS, never who owns it. So user B could create an
 * invoice with `client_id` pointing at user A's (owner-scoped) client — FK ids
 * are small + enumerable. Nothing leaks through the owner-scoped auto-CRUD read
 * path (FK auto-expansion resolves the sibling to null), but it breaks the
 * invariant reasonable server code relies on: a custom dashboard handler that
 * scoped invoices by owner_id and JOINed clients then surfaced A's client NAME
 * to B. The fix rejects cross-tenant FK references at the write chokepoint.
 *
 * These tests prove: a cross-tenant FK is rejected (ForbiddenError); a same-owner
 * FK is allowed; shared/reference models are exempt; null FK + authDisabled +
 * no-models all skip; and the ownership probe is owner-scoped (binds the caller).
 */

import { describe, it, expect } from 'vitest';
import { sysCreate } from '../src/crud/create';
import { sysUpdate } from '../src/crud/update';
import { assertForeignKeyOwnership } from '../src/crud/fk-ownership';
import { ForbiddenError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_USER } from './helpers/mock-env';
import type { ModelProps } from '../src/types/env';

const CLIENTS: ModelProps = {
  uuid: 'm-clients',
  name: 'clients',
  ownerScope: 'user',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'name', type: 'text' },
  ],
};
const CLIENTS_SHARED: ModelProps = { ...CLIENTS, uuid: 'm-clients-shared', ownerScope: 'shared' };
const INVOICES: ModelProps = {
  uuid: 'm-invoices',
  name: 'invoices',
  ownerScope: 'user',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'client_id', type: 'integer', references: { model: 'clients', column: 'id' } },
    { name: 'total', type: 'real' },
  ],
};

/** Mock DB whose FK-ownership probe ("SELECT 1 FROM ...") returns a row when
 *  `owns` is true (caller owns the referenced row) or null when false. */
function dbForFk(owns: boolean) {
  const results = new Map<string, Record<string, unknown>[]>();
  if (owns) results.set('SELECT 1 FROM', [{ '1': 1 }]);
  results.set('INSERT INTO', [{ id: 1, client_id: 1, total: 10, owner_id: TEST_USER.id }]);
  results.set('UPDATE', [{ id: 5, client_id: 1, total: 10, owner_id: TEST_USER.id }]);
  // Existence check for sys_update (SELECT "id" FROM "invoices" ...) — owned.
  results.set('FROM "invoices"', [{ id: 5 }]);
  return createMockD1({ results });
}

describe('assertForeignKeyOwnership', () => {
  it('rejects an FK that points at a row the caller does not own', async () => {
    const db = dbForFk(false);
    await expect(
      assertForeignKeyOwnership(INVOICES, { client_id: 1, total: 10 }, TEST_USER, db, [CLIENTS, INVOICES]),
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows an FK that points at the caller-owned row, scoping the probe to owner_id', async () => {
    const db = dbForFk(true);
    await assertForeignKeyOwnership(
      INVOICES, { client_id: 7, total: 10 }, TEST_USER, db, [CLIENTS, INVOICES],
    );
    const probe = db._queries.find((q) => q.sql.includes('SELECT 1 FROM "clients"'));
    expect(probe).toBeDefined();
    expect(probe!.sql).toContain('owner_id = ?');
    // Binds the FK value AND the caller id — the owner scoping that closes the hole.
    expect(probe!.binds).toEqual([7, TEST_USER.id]);
  });

  it('exempts references to shared/reference models (cross-tenant by design)', async () => {
    const db = dbForFk(false); // probe would fail — but it must not even run
    await assertForeignKeyOwnership(
      INVOICES, { client_id: 1, total: 10 }, TEST_USER, db, [CLIENTS_SHARED, INVOICES],
    );
    expect(db._queries.some((q) => q.sql.includes('SELECT 1 FROM'))).toBe(false);
  });

  it('skips null / empty FK values', async () => {
    const db = dbForFk(false);
    await assertForeignKeyOwnership(
      INVOICES, { client_id: null, total: 10 }, TEST_USER, db, [CLIENTS, INVOICES],
    );
    expect(db._queries.some((q) => q.sql.includes('SELECT 1 FROM'))).toBe(false);
  });

  it('skips when auth is disabled (owner gating relaxed platform-wide)', async () => {
    const db = dbForFk(false);
    await assertForeignKeyOwnership(
      INVOICES, { client_id: 1, total: 10 }, TEST_USER, db, [CLIENTS, INVOICES], { authDisabled: true },
    );
    expect(db._queries.some((q) => q.sql.includes('SELECT 1 FROM'))).toBe(false);
  });

  it('is a no-op when the model list is unavailable (cannot resolve the ref scope)', async () => {
    const db = dbForFk(false);
    await assertForeignKeyOwnership(INVOICES, { client_id: 1, total: 10 }, TEST_USER, db, undefined);
    expect(db._queries.some((q) => q.sql.includes('SELECT 1 FROM'))).toBe(false);
  });
});

describe('sysCreate FK ownership', () => {
  it('rejects creating a row whose FK references another tenant', async () => {
    const db = dbForFk(false);
    await expect(
      sysCreate(INVOICES, { data: { client_id: 1, total: 10 } }, TEST_USER, db, [CLIENTS, INVOICES]),
    ).rejects.toThrow(ForbiddenError);
    // Must reject BEFORE the INSERT runs.
    expect(db._queries.some((q) => q.sql.includes('INSERT INTO'))).toBe(false);
  });

  it('allows creating a row whose FK references the caller-owned row', async () => {
    const db = dbForFk(true);
    const res = await sysCreate(
      INVOICES, { data: { client_id: 1, total: 10 } }, TEST_USER, db, [CLIENTS, INVOICES],
    );
    expect(res.success).toBe(true);
    expect(db._queries.some((q) => q.sql.includes('INSERT INTO'))).toBe(true);
  });
});

describe('sysUpdate FK ownership', () => {
  it('rejects re-pointing an FK at another tenant', async () => {
    const db = dbForFk(false);
    await expect(
      sysUpdate(INVOICES, { id: 5, data: { client_id: 1 } }, TEST_USER, db, [CLIENTS, INVOICES]),
    ).rejects.toThrow(ForbiddenError);
    expect(db._queries.some((q) => q.sql.includes('UPDATE'))).toBe(false);
  });
});
