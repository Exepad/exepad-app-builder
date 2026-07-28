/**
 * Handler `ctx.db` system-column auto-fill.
 *
 * Reproduces the Verdant (2026-07-10) checkout defect: the `createOrder`
 * handler ran `INSERT INTO orders (customer_name, item_count, status, total)
 * VALUES (?, ?, ?, ?)` with no `owner_id` — and every model table declares
 * `owner_id`/`created_at`/`updated_at` NOT NULL with no default, so SQLite
 * rejected the row with `NOT NULL constraint failed: orders.owner_id`.
 *
 * The wrapper must auto-fill those columns for raw INSERTs into known model
 * tables, leave the caller's binds untouched, respect columns the handler
 * already set, and never touch a statement whose shape it doesn't recognise.
 */

import { describe, it, expect } from 'vitest';
import {
  injectSystemColumnsIntoInsert,
  wrapHandlerDb,
} from '../src/context/handler-db';
import { buildHandlerContext } from '../src/context/builder';
import { createMockD1, getExecutedQueries } from './helpers/mock-d1';
import { createMockEnv, TEST_USER } from './helpers/mock-env';
import type { ModelProps } from '../src/types/env';

const MODELS: ModelProps[] = [
  {
    uuid: 'm-orders',
    name: 'orders',
    columns: [
      { name: 'customer_name', type: 'text' },
      { name: 'item_count', type: 'integer' },
      { name: 'status', type: 'text' },
      { name: 'total', type: 'real' },
    ],
  },
  {
    uuid: 'm-order-items',
    name: 'order_items',
    columns: [
      { name: 'order_id', type: 'integer', references: { model: 'orders', column: 'id' } },
      { name: 'plant_id', type: 'integer', references: { model: 'plants', column: 'id' } },
      { name: 'quantity', type: 'integer' },
      { name: 'unit_price', type: 'real' },
    ],
  },
];

const NAMES = new Set(MODELS.map((m) => m.name));
const VALUES = { owner_id: 'user-123', created_at: '2026-07-10T00:00:00.000Z', updated_at: '2026-07-10T00:00:00.000Z' };

// ── Pure rewriter ──────────────────────────────────────────────────

describe('injectSystemColumnsIntoInsert', () => {
  it('appends all three system columns to a raw INSERT that omits them', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT INTO orders (customer_name, item_count, status, total) VALUES (?, ?, ?, ?)',
      NAMES,
      VALUES,
    );
    expect(out).toBe(
      "INSERT INTO orders (customer_name, item_count, status, total, owner_id, created_at, updated_at) " +
        "VALUES (?, ?, ?, ?, 'user-123', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z')",
    );
  });

  it('handles a child table with two FK columns (order_items)', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT INTO order_items (order_id, plant_id, quantity, unit_price) VALUES (?, ?, ?, ?)',
      NAMES,
      VALUES,
    );
    expect(out).toContain('order_id, plant_id, quantity, unit_price, owner_id, created_at, updated_at');
    expect(out).toContain("VALUES (?, ?, ?, ?, 'user-123',");
  });

  it('only injects the missing columns when the handler already set owner_id', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT INTO orders (customer_name, owner_id) VALUES (?, ?)',
      NAMES,
      VALUES,
    );
    // owner_id preserved (still a bound '?'), created_at/updated_at appended.
    expect(out).toBe(
      "INSERT INTO orders (customer_name, owner_id, created_at, updated_at) " +
        "VALUES (?, ?, '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z')",
    );
  });

  it('returns null (no rewrite) when all system columns are already present', () => {
    const sql =
      'INSERT INTO orders (customer_name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)';
    expect(injectSystemColumnsIntoInsert(sql, NAMES, VALUES)).toBeNull();
  });

  it('leaves UPDATE / DELETE / SELECT untouched', () => {
    expect(injectSystemColumnsIntoInsert('UPDATE plants SET stock = stock - ? WHERE id = ?', NAMES, VALUES)).toBeNull();
    expect(injectSystemColumnsIntoInsert('DELETE FROM orders WHERE id = ?', NAMES, VALUES)).toBeNull();
    expect(injectSystemColumnsIntoInsert('SELECT * FROM orders', NAMES, VALUES)).toBeNull();
  });

  it('leaves INSERTs into unknown / non-model tables untouched', () => {
    expect(
      injectSystemColumnsIntoInsert('INSERT INTO _files (id, owner_id) VALUES (?, ?)', NAMES, VALUES),
    ).toBeNull();
    expect(
      injectSystemColumnsIntoInsert('INSERT INTO widgets (a) VALUES (?)', NAMES, VALUES),
    ).toBeNull();
  });

  it('fills EVERY tuple of a multi-row INSERT … VALUES (…),(…)', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT INTO order_items (order_id, plant_id, quantity, unit_price) VALUES (?, ?, ?, ?), (?, ?, ?, ?)',
      NAMES,
      VALUES,
    );
    expect(out).toBe(
      'INSERT INTO order_items (order_id, plant_id, quantity, unit_price, owner_id, created_at, updated_at) ' +
        "VALUES (?, ?, ?, ?, 'user-123', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z'), " +
        "(?, ?, ?, ?, 'user-123', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z')",
    );
  });

  it('fills all three tuples of a 3-row INSERT', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT INTO orders (customer_name) VALUES (?), (?), (?)',
      NAMES,
      VALUES,
    );
    // owner_id literal appears once per tuple.
    expect((out!.match(/'user-123'/g) ?? []).length).toBe(3);
    expect(out).toContain('(customer_name, owner_id, created_at, updated_at)');
  });

  it('fills a multi-row INSERT that has a trailing ON CONFLICT clause', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT INTO orders (customer_name, total) VALUES (?, ?), (?, ?) ON CONFLICT(customer_name) DO NOTHING',
      NAMES,
      VALUES,
    );
    expect((out!.match(/'user-123'/g) ?? []).length).toBe(2);
    expect(out).toContain('ON CONFLICT(customer_name) DO NOTHING'); // tail preserved
  });

  it('matches the model table case-insensitively', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT INTO Orders (customer_name) VALUES (?)',
      NAMES,
      VALUES,
    );
    expect(out).toContain('(customer_name, owner_id, created_at, updated_at)');
  });

  it('handles REPLACE INTO a model table', () => {
    const out = injectSystemColumnsIntoInsert(
      'REPLACE INTO orders (customer_name) VALUES (?)',
      NAMES,
      VALUES,
    );
    expect(out).toContain('(customer_name, owner_id, created_at, updated_at)');
  });

  it('refuses INSERT … SELECT (no VALUES tuple to extend)', () => {
    const sql = 'INSERT INTO orders (customer_name, total) SELECT name, price FROM plants';
    expect(injectSystemColumnsIntoInsert(sql, NAMES, VALUES)).toBeNull();
  });

  it('refuses INSERT without an explicit column list', () => {
    expect(injectSystemColumnsIntoInsert('INSERT INTO orders VALUES (?, ?, ?, ?)', NAMES, VALUES)).toBeNull();
  });

  it('handles quoted table names and INSERT OR IGNORE', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT OR IGNORE INTO "orders" (customer_name) VALUES (?)',
      NAMES,
      VALUES,
    );
    expect(out).toContain('(customer_name, owner_id, created_at, updated_at)');
  });

  it('does not misfire on a string literal that contains a closing paren', () => {
    const out = injectSystemColumnsIntoInsert(
      "INSERT INTO orders (customer_name, status) VALUES (?, 'shipped (partial)')",
      NAMES,
      VALUES,
    );
    // The literal's ')' must not be mistaken for the tuple close.
    expect(out).toBe(
      "INSERT INTO orders (customer_name, status, owner_id, created_at, updated_at) " +
        "VALUES (?, 'shipped (partial)', 'user-123', '2026-07-10T00:00:00.000Z', '2026-07-10T00:00:00.000Z')",
    );
  });

  it('escapes single quotes in the injected owner_id', () => {
    const out = injectSystemColumnsIntoInsert(
      'INSERT INTO orders (customer_name) VALUES (?)',
      NAMES,
      { ...VALUES, owner_id: "o'brien" },
    );
    expect(out).toContain("'o''brien'");
  });
});

// ── Integration through buildHandlerContext ────────────────────────

describe('handler ctx.db auto-fill (integration)', () => {
  it('a raw INSERT run through ctx.db carries owner_id + timestamps, binds untouched', async () => {
    const db = createMockD1();
    const env = createMockEnv({ DB: db });
    const ctx = buildHandlerContext('createOrder', TEST_USER, env, {}, MODELS);

    await ctx.db
      .prepare('INSERT INTO orders (customer_name, item_count, status, total) VALUES (?, ?, ?, ?)')
      .bind('Ada Lovelace', 2, 'pending', 115)
      .run();

    const q = getExecutedQueries(db)[0];
    expect(q.sql).toContain('owner_id');
    expect(q.sql).toContain('created_at');
    expect(q.sql).toContain('updated_at');
    expect(q.sql).toContain("'user-123'"); // TEST_USER.id
    // Caller's positional binds are unchanged — we injected literals, not binds.
    expect(q.binds).toEqual(['Ada Lovelace', 2, 'pending', 115]);
  });

  it('statements built via ctx.db and dispatched through ctx.batch are also filled', async () => {
    const db = createMockD1();
    const env = createMockEnv({ DB: db });
    const ctx = buildHandlerContext('createOrder', TEST_USER, env, {}, MODELS);

    const stmts = [
      ctx.db.prepare('INSERT INTO order_items (order_id, plant_id, quantity, unit_price) VALUES (?, ?, ?, ?)').bind(1, 5, 2, 45),
      ctx.db.prepare('UPDATE plants SET stock = stock - ? WHERE id = ?').bind(2, 5),
    ];
    await ctx.batch(stmts);

    const insert = getExecutedQueries(db).find((r) => r.sql.startsWith('INSERT INTO order_items'));
    expect(insert?.sql).toContain('owner_id, created_at, updated_at');
    const update = getExecutedQueries(db).find((r) => r.sql.startsWith('UPDATE plants'));
    expect(update?.sql).toBe('UPDATE plants SET stock = stock - ? WHERE id = ?'); // untouched
  });

  it('fills a multi-row INSERT issued through ctx.db (batched line items)', async () => {
    const db = createMockD1();
    const env = createMockEnv({ DB: db });
    const ctx = buildHandlerContext('createOrder', TEST_USER, env, {}, MODELS);

    await ctx.db
      .prepare('INSERT INTO order_items (order_id, plant_id, quantity, unit_price) VALUES (?, ?, ?, ?), (?, ?, ?, ?)')
      .bind(1, 5, 2, 45, 1, 7, 1, 30)
      .run();

    const q = getExecutedQueries(db)[0];
    expect((q.sql.match(/'user-123'/g) ?? []).length).toBe(2); // both rows attributed
    expect(q.binds).toEqual([1, 5, 2, 45, 1, 7, 1, 30]); // binds untouched
  });

  it('leaves ctx.db.prepare of a non-model INSERT untouched', async () => {
    const db = createMockD1();
    const env = createMockEnv({ DB: db });
    const ctx = buildHandlerContext('h', TEST_USER, env, {}, MODELS);

    await ctx.db.prepare('INSERT INTO widgets (a) VALUES (?)').bind(1).run();
    expect(getExecutedQueries(db)[0].sql).toBe('INSERT INTO widgets (a) VALUES (?)');
  });

  it('ctx.batch and ctx.db passthrough survive when there are no models', async () => {
    const db = createMockD1();
    const env = createMockEnv({ DB: db });
    const ctx = buildHandlerContext('h', TEST_USER, env, {}, []);
    // With no models, ctx.db is the raw handle — prepare still works.
    await ctx.db.prepare('INSERT INTO orders (customer_name) VALUES (?)').bind('x').run();
    expect(getExecutedQueries(db)[0].sql).toBe('INSERT INTO orders (customer_name) VALUES (?)');
  });
});

// ── wrapHandlerDb passthrough ──────────────────────────────────────

describe('wrapHandlerDb', () => {
  it('returns the original handle unchanged when ownerId is empty', () => {
    const db = createMockD1();
    expect(wrapHandlerDb(db, MODELS, '')).toBe(db);
  });

  it('proxies non-prepare methods (batch/exec) to the real handle', async () => {
    const db = createMockD1();
    const wrapped = wrapHandlerDb(db, MODELS, 'user-123');
    await wrapped.exec('PRAGMA foreign_keys = ON');
    expect(getExecutedQueries(db).some((q) => q.sql.includes('PRAGMA'))).toBe(true);
  });
});
