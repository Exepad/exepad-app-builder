/**
 * Tests for `sys_list` foreign-key auto-expansion (PR-2 of platform
 * StayNexus follow-ups). Every FK column whose name ends in `_id` is
 * resolved to a joined sub-object on each row, named by stripping the
 * `_id` suffix. No SDK option, no opt-in — the LLM just writes
 * `row.guest?.full_name` and it works.
 */

import { describe, it, expect } from 'vitest';
import { sysList } from '../src/crud/list';
import { collectExpandableFKs } from '../src/crud/expand-fks';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_USER, TEST_ADMIN } from './helpers/mock-env';
import type { ModelProps } from '@exepad/types';

/** A SHARED-scope, read-restricted model referenced by an FK — the leak case. */
const SALARIES_MODEL: ModelProps = {
  uuid: 'salaries-uuid',
  name: 'salaries',
  ownerScope: 'shared',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'amount', type: 'integer' },
  ],
  crudPolicy: { read: 'role:admin', list: 'role:admin' },
};
/** Owner-scoped parent any authenticated user can list, with an FK to salaries. */
const EMPLOYEES_MODEL: ModelProps = {
  uuid: 'employees-uuid',
  name: 'employees',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'name', type: 'text' },
    { name: 'salary_id', type: 'integer', references: { model: 'salaries', column: 'id' } },
  ],
  crudPolicy: { list: 'authenticated' },
};


// ── Test models ──────────────────────────────────────────────────

const GUESTS_MODEL: ModelProps = {
  uuid: 'guests-uuid',
  name: 'guests',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'full_name', type: 'text' },
    { name: 'email', type: 'text' },
  ],
};

const ROOMS_MODEL: ModelProps = {
  uuid: 'rooms-uuid',
  name: 'rooms',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'room_number', type: 'text' },
    { name: 'room_type', type: 'text' },
  ],
};

const RESERVATIONS_MODEL: ModelProps = {
  uuid: 'res-uuid',
  name: 'reservations',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    {
      name: 'guest_id',
      type: 'integer',
      references: { model: 'guests', column: 'id' },
    },
    {
      name: 'room_id',
      type: 'integer',
      references: { model: 'rooms', column: 'id' },
    },
    { name: 'check_in_date', type: 'text' },
  ],
};


// ── Mock helpers ─────────────────────────────────────────────────

interface TableResults {
  reservations?: Record<string, unknown>[];
  guests?: Record<string, unknown>[];
  rooms?: Record<string, unknown>[];
  /** Fallback for the COUNT query and any unmatched table. */
  count?: number;
}

/**
 * Create a mock D1 that routes each `SELECT ... FROM <table>` to its own
 * row set. Different from the simple `createListDb` because FK expansion
 * issues parent + multiple joined queries per call and each must
 * resolve against its own table.
 */
function createTableAwareDb(tables: TableResults) {
  // Identifiers are double-quoted by ``escapeIdentifier``, so the SQL
  // emitted by ``buildListQuery`` contains ``FROM "reservations"`` etc.
  // The COUNT query precedes the FROM, so match it before any FROM-based
  // patterns by adding it first to the iteration order.
  const map = new Map<string, Record<string, unknown>[]>();
  map.set('SELECT COUNT', [{ count: tables.count ?? tables.reservations?.length ?? 0 }]);
  if (tables.reservations) map.set('FROM "reservations"', tables.reservations);
  if (tables.guests) map.set('FROM "guests"', tables.guests);
  if (tables.rooms) map.set('FROM "rooms"', tables.rooms);

  return createMockD1({ results: map, defaultResult: [] });
}


// ── collectExpandableFKs (pure helper) ───────────────────────────

describe('collectExpandableFKs', () => {
  it('collects FKs whose column ends in _id and target model exists', () => {
    const fks = collectExpandableFKs(RESERVATIONS_MODEL, [
      RESERVATIONS_MODEL,
      GUESTS_MODEL,
      ROOMS_MODEL,
    ]);
    expect(fks.map((f) => f.alias).sort()).toEqual(['guest', 'room']);
  });

  it('skips FK columns whose name does not end in _id', () => {
    const model: ModelProps = {
      ...RESERVATIONS_MODEL,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'parent', type: 'integer', references: { model: 'guests', column: 'id' } },
      ],
    };
    expect(collectExpandableFKs(model, [model, GUESTS_MODEL])).toEqual([]);
  });

  it('skips when alias collides with an existing column', () => {
    const model: ModelProps = {
      ...RESERVATIONS_MODEL,
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'guest', type: 'text' },
        { name: 'guest_id', type: 'integer', references: { model: 'guests', column: 'id' } },
      ],
    };
    expect(collectExpandableFKs(model, [model, GUESTS_MODEL])).toEqual([]);
  });

  it('skips when target model is not declared', () => {
    expect(collectExpandableFKs(RESERVATIONS_MODEL, [RESERVATIONS_MODEL])).toEqual([]);
  });

  it('respects autoExpandFKs: false on the parent', () => {
    const parent: ModelProps = { ...RESERVATIONS_MODEL, autoExpandFKs: false };
    expect(collectExpandableFKs(parent, [parent, GUESTS_MODEL, ROOMS_MODEL])).toEqual([]);
  });

  it('respects autoExpandFKs: false on the joined model', () => {
    const guests: ModelProps = { ...GUESTS_MODEL, autoExpandFKs: false };
    const fks = collectExpandableFKs(RESERVATIONS_MODEL, [
      RESERVATIONS_MODEL,
      guests,
      ROOMS_MODEL,
    ]);
    // ``guest`` skipped, ``room`` still expands.
    expect(fks.map((f) => f.alias)).toEqual(['room']);
  });
});


// ── End-to-end sysList integration ───────────────────────────────

describe('sysList — FK auto-expansion', () => {
  it('attaches a joined sub-object on each row when allModels is supplied', async () => {
    const db = createTableAwareDb({
      reservations: [
        { id: 1, guest_id: 10, room_id: 20, owner_id: 'user-123' },
        { id: 2, guest_id: 11, room_id: 21, owner_id: 'user-123' },
      ],
      guests: [
        { id: 10, full_name: 'Eleanor Vance', email: 'e@example.com' },
        { id: 11, full_name: 'Luke Sanderson', email: 'l@example.com' },
      ],
      rooms: [
        { id: 20, room_number: '101', room_type: 'standard' },
        { id: 21, room_number: '202', room_type: 'deluxe' },
      ],
      count: 2,
    });

    const result = await sysList(
      RESERVATIONS_MODEL,
      undefined,
      TEST_USER,
      db,
      [RESERVATIONS_MODEL, GUESTS_MODEL, ROOMS_MODEL],
    );

    expect(result.success).toBe(true);
    const rows = result.data as Record<string, unknown>[];
    expect(rows).toHaveLength(2);

    expect(rows[0].guest_id).toBe(10);
    expect(rows[0].guest).toMatchObject({ id: 10, full_name: 'Eleanor Vance' });
    expect(rows[0].room).toMatchObject({ id: 20, room_number: '101' });

    expect(rows[1].guest).toMatchObject({ id: 11, full_name: 'Luke Sanderson' });
    expect(rows[1].room).toMatchObject({ id: 21, room_number: '202' });
  });

  it('is a no-op when allModels is omitted (back-compat for internal callers)', async () => {
    const db = createTableAwareDb({
      reservations: [{ id: 1, guest_id: 10, room_id: 20, owner_id: 'user-123' }],
      count: 1,
    });

    const result = await sysList(RESERVATIONS_MODEL, undefined, TEST_USER, db);
    const rows = result.data as Record<string, unknown>[];

    expect(rows[0].guest_id).toBe(10);
    expect(rows[0].guest).toBeUndefined();
    expect(rows[0].room).toBeUndefined();
  });

  it('attaches null when the FK value is null', async () => {
    const db = createTableAwareDb({
      reservations: [{ id: 1, guest_id: null, room_id: null, owner_id: 'user-123' }],
      count: 1,
    });

    const result = await sysList(
      RESERVATIONS_MODEL,
      undefined,
      TEST_USER,
      db,
      [RESERVATIONS_MODEL, GUESTS_MODEL, ROOMS_MODEL],
    );
    const rows = result.data as Record<string, unknown>[];
    expect(rows[0].guest).toBeNull();
    expect(rows[0].room).toBeNull();
  });

  it('attaches null when the joined row is missing (deleted, other-owner, soft-deleted)', async () => {
    // Parent references guest 99 + room 20, but the guests query returns nothing.
    const db = createTableAwareDb({
      reservations: [{ id: 1, guest_id: 99, room_id: 20, owner_id: 'user-123' }],
      guests: [], // empty
      rooms: [{ id: 20, room_number: '101', room_type: 'standard' }],
      count: 1,
    });

    const result = await sysList(
      RESERVATIONS_MODEL,
      undefined,
      TEST_USER,
      db,
      [RESERVATIONS_MODEL, GUESTS_MODEL, ROOMS_MODEL],
    );
    const rows = result.data as Record<string, unknown>[];
    expect(rows[0].guest).toBeNull();
    expect(rows[0].room).toMatchObject({ id: 20 });
  });

  it('runs at most one joined query per FK regardless of parent count', async () => {
    const parents = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      guest_id: (i % 5) + 1, // 5 unique guest ids across 50 rows
      room_id: (i % 3) + 100, // 3 unique room ids
      owner_id: 'user-123',
    }));
    const db = createTableAwareDb({
      reservations: parents,
      guests: [
        { id: 1, full_name: 'g1' }, { id: 2, full_name: 'g2' },
        { id: 3, full_name: 'g3' }, { id: 4, full_name: 'g4' },
        { id: 5, full_name: 'g5' },
      ],
      rooms: [
        { id: 100, room_number: 'R100' },
        { id: 101, room_number: 'R101' },
        { id: 102, room_number: 'R102' },
      ],
      count: 50,
    });

    await sysList(
      RESERVATIONS_MODEL,
      { limit: 50 },
      TEST_USER,
      db,
      [RESERVATIONS_MODEL, GUESTS_MODEL, ROOMS_MODEL],
    );

    // Inspect: parent SELECT (1) + COUNT (1) + guests join (1) + rooms join (1) = 4 queries total.
    // No per-row N+1 amplification.
    const guestQueries = db._queries.filter((q) => q.sql.includes('FROM "guests"'));
    const roomQueries = db._queries.filter((q) => q.sql.includes('FROM "rooms"'));
    expect(guestQueries.length).toBe(1);
    expect(roomQueries.length).toBe(1);
  });

  it('chunks the joined IN-query when unique FK count exceeds MAX_FILTER_ARRAY_SIZE', async () => {
    // ``MAX_FILTER_ARRAY_SIZE`` is 100; build a parent batch with 250
    // unique guest_ids to force chunking (250 / 100 = 3 chunks).
    const parents = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      guest_id: i + 1,
      room_id: null,
      owner_id: 'user-123',
    }));
    const guestRows = Array.from({ length: 250 }, (_, i) => ({
      id: i + 1,
      full_name: `g${i + 1}`,
    }));
    const db = createTableAwareDb({
      reservations: parents,
      guests: guestRows,
      count: 250,
    });

    const result = await sysList(
      RESERVATIONS_MODEL,
      { limit: 500 },
      TEST_USER,
      db,
      [RESERVATIONS_MODEL, GUESTS_MODEL, ROOMS_MODEL],
    );

    expect(result.success).toBe(true);
    const rows = result.data as Record<string, unknown>[];
    // Every row gets its joined object — no DatabaseError thrown.
    expect(rows.length).toBe(250);
    for (const row of rows) {
      expect(row.guest).not.toBeNull();
    }
    // Joined query was chunked: ceil(250 / 100) = 3 calls against guests.
    const guestQueries = db._queries.filter((q) => q.sql.includes('FROM "guests"'));
    expect(guestQueries.length).toBe(3);
  });

  it('does not auto-expand for self-references at depth > 1 (cap)', async () => {
    // users.manager_id → users. The joined row is the manager — that
    // manager's own ``manager`` field must NOT be re-expanded.
    const usersModel: ModelProps = {
      uuid: 'users-uuid',
      name: 'users',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'name', type: 'text' },
        {
          name: 'manager_id',
          type: 'integer',
          references: { model: 'users', column: 'id' },
          isNullable: true,
        },
      ],
    };

    // ``createTableAwareDb`` only knows about reservations/guests/rooms,
    // so build a users-aware mock directly.
    const map = new Map<string, Record<string, unknown>[]>();
    map.set('SELECT COUNT', [{ count: 2 }]);
    map.set('FROM "users"', [
      { id: 1, name: 'Alice', manager_id: 2, owner_id: 'user-123' },
      { id: 2, name: 'Bob', manager_id: null, owner_id: 'user-123' },
    ]);
    const usersDb = createMockD1({ results: map, defaultResult: [] });

    const result = await sysList(
      usersModel,
      undefined,
      TEST_USER,
      usersDb,
      [usersModel],
    );
    const rows = result.data as Record<string, unknown>[];

    // Each row gets a `manager` sibling — but the manager row itself
    // doesn't get its own `manager` field re-attached. That's because
    // the recursive expansion is not triggered: ``expandForeignKeys``
    // is called only on the parent set, never on joined rows.
    expect(rows[0].manager).toMatchObject({ id: 2, name: 'Bob' });
    // Bob's own row in the parent list has manager_id null → manager is null.
    expect(rows[1].manager).toBeNull();
    // The joined-`manager` sub-object on Alice does NOT recursively
    // contain its own `manager` key — depth capped at 1.
    expect((rows[0].manager as Record<string, unknown>).manager).toBeUndefined();
  });
});


// ── FK-expansion read gate ───────────────────────────────────────
// FK auto-expansion must NOT hand a caller the columns of a shared-scope
// model whose `read` policy they can't satisfy (the joined query runs with no
// owner filter for shared models). The gate that protects the direct
// list/aggregate paths is applied to each joined model too.
describe('sysList — FK auto-expansion read gate', () => {
  // Mock D1 that resolves employees + salaries SELECTs to their own rows.
  function empDb(emps: Record<string, unknown>[], salaries: Record<string, unknown>[] | null, count?: number) {
    const map = new Map<string, Record<string, unknown>[]>();
    map.set('SELECT COUNT', [{ count: count ?? emps.length }]);
    map.set('FROM "employees"', emps);
    if (salaries) map.set('FROM "salaries"', salaries);
    return createMockD1({ results: map, defaultResult: [] });
  }

  it('attaches null (does NOT expand) a shared read-restricted model for a non-admin', async () => {
    // The salaries row IS available in the DB — so if the gate were absent the
    // join would expand it. The gate must deny BEFORE the join → salary is null.
    const db = empDb(
      [{ id: 1, name: 'A', salary_id: 100, owner_id: 'user-123' }],
      [{ id: 100, amount: 5000 }],
      1,
    );
    const res = await sysList(
      EMPLOYEES_MODEL,
      undefined,
      TEST_USER, // authenticated non-admin: clears employees list gate
      db,
      [EMPLOYEES_MODEL, SALARIES_MODEL],
      { authDisabled: false },
    );
    expect(res.success).toBe(true);
    const rows = res.data as Array<Record<string, unknown>>;
    // salaries is shared + read:role:admin → gate denies → salary attaches null
    // even though the row exists (proves the gate, not an empty join, nulled it).
    expect(rows[0].salary).toBeNull();
  });

  it('DOES expand the same model for an admin', async () => {
    const db = empDb(
      [{ id: 1, name: 'A', salary_id: 100, owner_id: 'admin-1' }],
      [{ id: 100, amount: 5000 }],
      1,
    );
    const res = await sysList(
      EMPLOYEES_MODEL,
      undefined,
      TEST_ADMIN,
      db,
      [EMPLOYEES_MODEL, SALARIES_MODEL],
      { authDisabled: false },
    );
    const rows = res.data as Array<Record<string, unknown>>;
    expect(rows[0].salary).toMatchObject({ id: 100, amount: 5000 });
  });

  it('expands for a non-admin when the security kill-switch is on', async () => {
    const db = empDb(
      [{ id: 1, name: 'A', salary_id: 100, owner_id: 'user-123' }],
      [{ id: 100, amount: 5000 }],
      1,
    );
    const res = await sysList(EMPLOYEES_MODEL, undefined, TEST_USER, db, [EMPLOYEES_MODEL, SALARIES_MODEL], {
      authDisabled: true,
    });
    const rows = res.data as Array<Record<string, unknown>>;
    expect(rows[0].salary).toMatchObject({ id: 100, amount: 5000 });
  });
});
