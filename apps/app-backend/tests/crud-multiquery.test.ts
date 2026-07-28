/**
 * Tests for sys_multi_query (apps/app-backend/src/crud/multiQuery.ts)
 *
 * Focus: per-query error isolation (Promise.allSettled — one failing query
 * does NOT sink the batch), the MAX_QUERIES cap, the read-only method
 * allowlist (writes rejected up front), API-key per-query scope enforcement,
 * and per-query owner scoping proven against a REAL LocalD1 database.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { LocalD1 } from '@exepad/local-adapters/db';
import { generateCreateTableSQL, generateIndexSQL } from '@exepad/deploy-utils';
import { sysMultiQuery } from '../src/crud/multiQuery';
import type { MultiQueryParams } from '../src/crud/multiQuery';
import { sysCreate } from '../src/crud/create';
import { createMockD1 } from './helpers/mock-d1';
import { createMockConfig, TEST_USER, TEST_ANON, TEST_ADMIN } from './helpers/mock-env';
import type { InjectedProps, ModelProps } from '../src/types/env';
import type { UserContext } from '../src/rpc/types';

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** Owner-scoped model (default ownerScope === 'user'). */
const CONTACTS: ModelProps = {
  uuid: 'contacts-uuid',
  name: 'contacts',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'name', type: 'text' },
    { name: 'email', type: 'text', isNullable: true },
  ],
};

/** Second owner-scoped model — proves multiple distinct tables in one batch. */
const NOTES: ModelProps = {
  uuid: 'notes-uuid',
  name: 'notes',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'body', type: 'text' },
  ],
};

/** Admin-only read policy — used to prove per-query auth pre-validation. */
const SECRETS: ModelProps = {
  uuid: 'secrets-uuid',
  name: 'secrets',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'value', type: 'text' },
  ],
  crudPolicy: { list: 'role:admin' },
};

/**
 * SHARED-scope model whose `read` policy is STRICTER than its `list` policy.
 * This is the exact shape that exposed the multi-query read-policy bypass: the
 * standalone /rpc path gates sys_read against `read` (admin-only), but
 * multi-query used to gate every read against `list` (authenticated) — letting a
 * non-admin read an admin-only row via multi-query. Shared scope means there is
 * no owner filter to fall back on, so the row really does leak.
 */
const SHARED_SECRETS: ModelProps = {
  uuid: 'shared-secrets-uuid',
  name: 'shared_secrets',
  ownerScope: 'shared',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'value', type: 'text' },
  ],
  crudPolicy: { read: 'role:admin', list: 'authenticated' },
};

/** SHARED-scope model whose read is NOT stricter than list — proves the read
 *  gate is a no-op here (no over-block of legitimate shared listing). */
const SHARED_OPEN: ModelProps = {
  uuid: 'shared-open-uuid',
  name: 'shared_open',
  ownerScope: 'shared',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'value', type: 'text' },
  ],
  crudPolicy: { read: 'authenticated', list: 'authenticated' },
};

const CONFIG: InjectedProps = createMockConfig([CONTACTS, NOTES, SECRETS, SHARED_SECRETS, SHARED_OPEN]);

/** A second user, to prove owner isolation against real data. */
const OTHER_USER: UserContext = {
  id: 'user-999',
  email: 'other@example.com',
  roles: [],
  isAuthenticated: true,
};

// ---------------------------------------------------------------------------
// Real LocalD1 harness — proves the actual SQL runs and owner scoping holds.
// ---------------------------------------------------------------------------

let realDb: D1Database;

beforeEach(() => {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys = ON');
  for (const model of [CONTACTS, NOTES, SECRETS, SHARED_SECRETS, SHARED_OPEN]) {
    raw.exec(generateCreateTableSQL(model));
    for (const idx of generateIndexSQL(model)) raw.exec(idx);
  }
  realDb = new LocalD1(raw) as unknown as D1Database;
});

/** Pull the per-query results array out of a multi-query response. */
function resultsOf(res: { data?: unknown }): Array<{
  alias: string;
  success: boolean;
  data?: unknown;
  pagination?: unknown;
  error?: { code: string; message: string };
}> {
  return (res.data as { results: ReturnType<typeof resultsOf> }).results;
}

// ===========================================================================
// Input validation / shape
// ===========================================================================

describe('sys_multi_query — request validation', () => {
  it('rejects a missing params object', async () => {
    await expect(
      sysMultiQuery(undefined, TEST_USER, CONFIG, createMockD1()),
    ).rejects.toThrow('Missing or empty "queries" array');
  });

  it('rejects a missing queries array', async () => {
    await expect(
      sysMultiQuery({} as MultiQueryParams, TEST_USER, CONFIG, createMockD1()),
    ).rejects.toThrow('Missing or empty "queries" array');
  });

  it('rejects an empty queries array', async () => {
    await expect(
      sysMultiQuery({ queries: [] }, TEST_USER, CONFIG, createMockD1()),
    ).rejects.toThrow('Missing or empty "queries" array');
  });

  it('rejects a non-array queries value', async () => {
    await expect(
      sysMultiQuery(
        { queries: { alias: 'x' } as unknown as [] },
        TEST_USER,
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow('Missing or empty "queries" array');
  });

  it('rejects a query missing an alias', async () => {
    await expect(
      sysMultiQuery(
        { queries: [{ model: 'contacts', method: 'sys_list' } as never] },
        TEST_USER,
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow(/Query 0: missing or invalid "alias"/);
  });

  it('rejects a query missing a model', async () => {
    await expect(
      sysMultiQuery(
        { queries: [{ alias: 'a', method: 'sys_list' } as never] },
        TEST_USER,
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow(/Query 0 \(a\): missing or invalid "model"/);
  });

  it('rejects a reference to an unknown model', async () => {
    await expect(
      sysMultiQuery(
        { queries: [{ alias: 'a', model: 'ghost', method: 'sys_list' }] },
        TEST_USER,
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow(/model "ghost" not found/);
  });
});

// ===========================================================================
// MAX_QUERIES cap
// ===========================================================================

describe('sys_multi_query — MAX_QUERIES cap', () => {
  const makeQuery = (i: number) => ({
    alias: `q${i}`,
    model: 'contacts',
    method: 'sys_list',
    params: {},
  });

  it('accepts exactly 50 queries (the boundary)', async () => {
    const queries = Array.from({ length: 50 }, (_, i) => makeQuery(i));
    const db = createMockD1({ defaultResult: [] });

    const res = await sysMultiQuery({ queries }, TEST_USER, CONFIG, db);
    expect(res.success).toBe(true);
    expect(resultsOf(res)).toHaveLength(50);
  });

  it('rejects 51 queries — one over the cap', async () => {
    const queries = Array.from({ length: 51 }, (_, i) => makeQuery(i));

    await expect(
      sysMultiQuery({ queries }, TEST_USER, CONFIG, createMockD1()),
    ).rejects.toThrow(/exceeds maximum of 50 queries \(got 51\)/);
  });

  it('rejects a wildly oversized batch', async () => {
    const queries = Array.from({ length: 500 }, (_, i) => makeQuery(i));

    await expect(
      sysMultiQuery({ queries }, TEST_USER, CONFIG, createMockD1()),
    ).rejects.toThrow(/exceeds maximum of 50 queries/);
  });
});

// ===========================================================================
// Read-only allowlist — writes must never execute
// ===========================================================================

describe('sys_multi_query — read-only allowlist', () => {
  for (const writeMethod of ['sys_create', 'sys_update', 'sys_delete', 'sys_upsert']) {
    it(`rejects ${writeMethod} as a disallowed method`, async () => {
      await expect(
        sysMultiQuery(
          { queries: [{ alias: 'w', model: 'contacts', method: writeMethod }] },
          TEST_USER,
          CONFIG,
          createMockD1(),
        ),
      ).rejects.toThrow(/invalid method/);
    });
  }

  it('rejects an unknown / garbage method', async () => {
    await expect(
      sysMultiQuery(
        { queries: [{ alias: 'x', model: 'contacts', method: 'DROP_TABLE' }] },
        TEST_USER,
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow(/invalid method "DROP_TABLE"/);
  });

  it('rejects the whole batch if a single later query uses a write method', async () => {
    // Pre-validation is all-or-nothing: one bad method aborts before any
    // query runs, so a write hidden among reads can never slip through.
    const db = createMockD1({ defaultResult: [] });
    await expect(
      sysMultiQuery(
        {
          queries: [
            { alias: 'ok', model: 'contacts', method: 'sys_list' },
            { alias: 'bad', model: 'contacts', method: 'sys_delete' },
          ],
        },
        TEST_USER,
        CONFIG,
        db,
      ),
    ).rejects.toThrow(/invalid method/);
    // Nothing should have touched the DB.
    expect(db._queries).toHaveLength(0);
  });

  it('accepts the three allowed read methods', async () => {
    const db = createMockD1({ defaultResult: [{ id: 1, name: 'A' }] });
    const res = await sysMultiQuery(
      {
        queries: [
          { alias: 'l', model: 'contacts', method: 'sys_list', params: {} },
          { alias: 'r', model: 'contacts', method: 'sys_read', params: { id: 1 } },
          {
            alias: 'g',
            model: 'contacts',
            method: 'sys_aggregate',
            params: { aggregations: [{ function: 'count', alias: 'total' }] },
          },
        ],
      },
      TEST_USER,
      CONFIG,
      db,
    );
    expect(res.success).toBe(true);
    const results = resultsOf(res);
    expect(results.map((r) => r.alias)).toEqual(['l', 'r', 'g']);
  });
});

// ===========================================================================
// Per-query auth pre-validation (uses the per-METHOD policy, matching /rpc)
// ===========================================================================

describe('sys_multi_query — per-query auth pre-validation', () => {
  it('rejects the batch when ANY query targets a model the user cannot read', async () => {
    // contacts is open to any authenticated user, but secrets requires admin.
    await expect(
      sysMultiQuery(
        {
          queries: [
            { alias: 'ok', model: 'contacts', method: 'sys_list' },
            { alias: 'denied', model: 'secrets', method: 'sys_list' },
          ],
        },
        TEST_USER,
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow(/Role 'admin' required/);
  });

  it('allows an admin to read an admin-gated model', async () => {
    const db = createMockD1({ defaultResult: [{ id: 1, value: 's' }] });
    const res = await sysMultiQuery(
      { queries: [{ alias: 's', model: 'secrets', method: 'sys_list' }] },
      TEST_ADMIN,
      CONFIG,
      db,
    );
    expect(res.success).toBe(true);
    expect(resultsOf(res)[0].success).toBe(true);
  });

  it('rejects an unauthenticated user against an authenticated-default model', async () => {
    await expect(
      sysMultiQuery(
        { queries: [{ alias: 'a', model: 'contacts', method: 'sys_list' }] },
        TEST_ANON,
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow(/Authentication required/);
  });

  it('honours the security kill-switch (auth disabled) for anon callers', async () => {
    const disabledCfg: InjectedProps = {
      ...CONFIG,
      security: { enabled: false } as InjectedProps['security'],
    };
    const db = createMockD1({ defaultResult: [] });
    const res = await sysMultiQuery(
      { queries: [{ alias: 'a', model: 'secrets', method: 'sys_list' }] },
      TEST_ANON,
      disabledCfg,
      db,
    );
    expect(res.success).toBe(true);
    expect(resultsOf(res)[0].success).toBe(true);
  });

  // Regression: the read-policy bypass. A shared-scope model with `read`
  // stricter than `list` must gate multi-query sys_read against `read` (admin),
  // exactly like the standalone /rpc path — not against `list` (authenticated).
  it('gates sys_read against the READ policy, not list (shared-scope leak)', async () => {
    // Seed an admin-only row (shared scope → no owner filter to hide it).
    await sysCreate(SHARED_SECRETS, { data: { value: 'top-secret' } }, TEST_ADMIN, realDb);

    // A non-admin sys_read via multi-query is rejected by the per-method policy.
    await expect(
      sysMultiQuery(
        {
          queries: [{ alias: 'leak', model: 'shared_secrets', method: 'sys_read', params: { id: 1 } }],
        },
        TEST_USER, // authenticated, NOT admin
        CONFIG,
        realDb,
      ),
    ).rejects.toThrow(/Role 'admin' required/);

    // An admin can still read it via multi-query.
    const res = await sysMultiQuery(
      {
        queries: [{ alias: 'ok', model: 'shared_secrets', method: 'sys_read', params: { id: 1 } }],
      },
      TEST_ADMIN,
      CONFIG,
      realDb,
    );
    expect(res.success).toBe(true);
    expect(resultsOf(res)[0].success).toBe(true);
    expect((resultsOf(res)[0].data as { value: string }).value).toBe('top-secret');
  });

  // Shared-scope read-gate: on a shared model with read stricter than list,
  // sys_list (SELECT *) and sys_aggregate (min/max/...) ALSO require the read
  // policy — otherwise a stricter read is bypassable by listing/aggregating
  // (no owner filter to fall back on).
  it('gates shared-scope sys_LIST and sys_AGGREGATE against the read policy too', async () => {
    await sysCreate(SHARED_SECRETS, { data: { value: 'top-secret' } }, TEST_ADMIN, realDb);

    // non-admin sys_list on the admin-read shared model → rejected
    await expect(
      sysMultiQuery(
        { queries: [{ alias: 'l', model: 'shared_secrets', method: 'sys_list' }] },
        TEST_USER,
        CONFIG,
        realDb,
      ),
    ).rejects.toThrow(/Role 'admin' required/);

    // non-admin sys_aggregate likewise → rejected (min/max would leak the value)
    await expect(
      sysMultiQuery(
        {
          queries: [
            {
              alias: 'g',
              model: 'shared_secrets',
              method: 'sys_aggregate',
              params: { aggregations: [{ function: 'max', field: 'value', alias: 'm' }] },
            },
          ],
        },
        TEST_USER,
        CONFIG,
        realDb,
      ),
    ).rejects.toThrow(/Role 'admin' required/);

    // admin can still list + aggregate it
    const res = await sysMultiQuery(
      { queries: [{ alias: 'l', model: 'shared_secrets', method: 'sys_list' }] },
      TEST_ADMIN,
      CONFIG,
      realDb,
    );
    expect(res.success).toBe(true);
    expect(resultsOf(res)[0].success).toBe(true);
  });

  it('does NOT over-block a shared model whose read is not stricter than list', async () => {
    await sysCreate(SHARED_OPEN, { data: { value: 's' } }, TEST_ADMIN, realDb);
    const res = await sysMultiQuery(
      { queries: [{ alias: 'l', model: 'shared_open', method: 'sys_list' }] },
      TEST_USER, // non-admin, but read==list==authenticated → allowed
      CONFIG,
      realDb,
    );
    expect(res.success).toBe(true);
    expect(resultsOf(res)[0].success).toBe(true);
  });
});

// ===========================================================================
// API-key scope enforcement per query
// ===========================================================================

describe('sys_multi_query — API-key per-query scope', () => {
  const apiKeyUser = (scopes: string[]): UserContext => ({
    id: 'key-user',
    email: 'key@example.com',
    roles: ['admin'], // admin so SECRETS policy passes; scope is the gate under test
    isAuthenticated: true,
    authMethod: 'api_key',
    apiKeyScopes: scopes,
  });

  it('rejects a query whose model:op scope the key lacks', async () => {
    await expect(
      sysMultiQuery(
        {
          queries: [
            { alias: 'a', model: 'contacts', method: 'sys_list' },
            { alias: 'b', model: 'notes', method: 'sys_list' },
          ],
        },
        apiKeyUser(['model:contacts:list']), // missing notes
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow(/API key lacks scope: model:notes:list/);
  });

  it('enforces the per-METHOD scope: sys_read needs :read, not :list', async () => {
    // sys_read is gated by the model:<m>:read scope (matching the standalone
    // /rpc path), NOT model:<m>:list. A key scoped only to :list cannot smuggle
    // a sys_read through; a key with :read can.
    await expect(
      sysMultiQuery(
        { queries: [{ alias: 'a', model: 'contacts', method: 'sys_read', params: { id: 1 } }] },
        apiKeyUser(['model:contacts:list']), // has list but not read
        CONFIG,
        createMockD1(),
      ),
    ).rejects.toThrow(/API key lacks scope: model:contacts:read/);

    // With the correct :read scope, the same sys_read is allowed.
    const db = createMockD1({ defaultResult: [{ id: 1, name: 'A' }] });
    const res = await sysMultiQuery(
      { queries: [{ alias: 'a', model: 'contacts', method: 'sys_read', params: { id: 1 } }] },
      apiKeyUser(['model:contacts:read']),
      CONFIG,
      db,
    );
    expect(res.success).toBe(true);
    expect(resultsOf(res)[0].success).toBe(true);
  });

  it('allows queries fully covered by the key scopes', async () => {
    const db = createMockD1({ defaultResult: [] });
    const res = await sysMultiQuery(
      {
        queries: [
          { alias: 'a', model: 'contacts', method: 'sys_list' },
          { alias: 'b', model: 'notes', method: 'sys_list' },
        ],
      },
      apiKeyUser(['model:contacts:list', 'model:notes:list']),
      CONFIG,
      db,
    );
    expect(res.success).toBe(true);
    expect(resultsOf(res)).toHaveLength(2);
  });

  it('accepts a wildcard scope', async () => {
    const db = createMockD1({ defaultResult: [] });
    const res = await sysMultiQuery(
      { queries: [{ alias: 'a', model: 'secrets', method: 'sys_list' }] },
      apiKeyUser(['*']),
      CONFIG,
      db,
    );
    expect(res.success).toBe(true);
  });
});

// ===========================================================================
// Per-query error isolation (Promise.allSettled) — the headline behavior
// ===========================================================================

describe('sys_multi_query — per-query error isolation', () => {
  it('a failing read does NOT sink sibling reads (real DB)', async () => {
    // Seed one contact for the owner.
    await sysCreate(CONTACTS, { data: { name: 'Alice' } }, TEST_USER, realDb);

    const res = await sysMultiQuery(
      {
        queries: [
          { alias: 'list', model: 'contacts', method: 'sys_list' },
          // id 4242 does not exist → sysRead throws NotFoundError, caught + isolated.
          { alias: 'missing', model: 'contacts', method: 'sys_read', params: { id: 4242 } },
          {
            alias: 'count',
            model: 'contacts',
            method: 'sys_aggregate',
            params: { aggregations: [{ function: 'count', alias: 'total' }] },
          },
        ],
      },
      TEST_USER,
      CONFIG,
      realDb,
    );

    expect(res.success).toBe(true);
    const byAlias = Object.fromEntries(resultsOf(res).map((r) => [r.alias, r]));

    // Sibling reads still succeeded.
    expect(byAlias.list.success).toBe(true);
    expect((byAlias.list.data as unknown[]).length).toBe(1);
    expect(byAlias.count.success).toBe(true);

    // The one bad query is isolated as a failure, not thrown.
    expect(byAlias.missing.success).toBe(false);
    expect(byAlias.missing.error?.code).toBe('NOT_FOUND');
    expect(byAlias.missing.data).toBeUndefined();
  });

  it('isolates failures per alias and preserves order (mock DB)', async () => {
    // Make sys_aggregate fail (invalid function) while the lists succeed.
    const db = createMockD1({ defaultResult: [{ id: 1, name: 'A' }] });
    const res = await sysMultiQuery(
      {
        queries: [
          { alias: 'first', model: 'contacts', method: 'sys_list' },
          {
            alias: 'broken',
            model: 'contacts',
            method: 'sys_aggregate',
            params: { aggregations: [{ function: 'median', alias: 'm' }] },
          },
          { alias: 'third', model: 'notes', method: 'sys_list' },
        ],
      },
      TEST_USER,
      CONFIG,
      db,
    );

    const results = resultsOf(res);
    expect(results.map((r) => r.alias)).toEqual(['first', 'broken', 'third']);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].error?.message).toMatch(/median/);
    expect(results[2].success).toBe(true);
  });

  it('surfaces list pagination metadata only where present', async () => {
    const db = createMockD1({ defaultResult: [{ id: 1, name: 'A' }] });
    const res = await sysMultiQuery(
      {
        queries: [
          { alias: 'l', model: 'contacts', method: 'sys_list', params: { limit: 10 } },
          { alias: 'r', model: 'contacts', method: 'sys_read', params: { id: 1 } },
        ],
      },
      TEST_USER,
      CONFIG,
      db,
    );
    const results = resultsOf(res);
    const list = results.find((r) => r.alias === 'l')!;
    const read = results.find((r) => r.alias === 'r')!;
    expect(list.pagination).toBeDefined();
    // sys_read carries no pagination.
    expect(read.pagination).toBeUndefined();
  });
});

// ===========================================================================
// Per-query owner scope — proven against real data
// ===========================================================================

describe('sys_multi_query — per-query owner scope', () => {
  it('only returns the caller-owned rows across every query', async () => {
    // Owner has 2 contacts + 1 note; another user has 1 contact.
    await sysCreate(CONTACTS, { data: { name: 'Mine-1' } }, TEST_USER, realDb);
    await sysCreate(CONTACTS, { data: { name: 'Mine-2' } }, TEST_USER, realDb);
    await sysCreate(NOTES, { data: { body: 'note-1' } }, TEST_USER, realDb);
    await sysCreate(CONTACTS, { data: { name: 'Theirs' } }, OTHER_USER, realDb);

    const res = await sysMultiQuery(
      {
        queries: [
          { alias: 'contacts', model: 'contacts', method: 'sys_list' },
          { alias: 'notes', model: 'notes', method: 'sys_list' },
          {
            alias: 'count',
            model: 'contacts',
            method: 'sys_aggregate',
            params: { aggregations: [{ function: 'count', alias: 'total' }] },
          },
        ],
      },
      TEST_USER,
      CONFIG,
      realDb,
    );

    const byAlias = Object.fromEntries(resultsOf(res).map((r) => [r.alias, r]));

    const contacts = byAlias.contacts.data as Array<{ name: string }>;
    expect(contacts.map((c) => c.name).sort()).toEqual(['Mine-1', 'Mine-2']);
    // The other user's row never appears.
    expect(contacts.find((c) => c.name === 'Theirs')).toBeUndefined();

    expect((byAlias.notes.data as unknown[]).length).toBe(1);

    const countRow = (byAlias.count.data as Array<{ total: number }>)[0];
    expect(countRow.total).toBe(2);
  });

  it('a different caller sees only its own row in the same batch shape', async () => {
    await sysCreate(CONTACTS, { data: { name: 'Mine' } }, TEST_USER, realDb);
    await sysCreate(CONTACTS, { data: { name: 'Theirs' } }, OTHER_USER, realDb);

    const res = await sysMultiQuery(
      { queries: [{ alias: 'c', model: 'contacts', method: 'sys_list' }] },
      OTHER_USER,
      CONFIG,
      realDb,
    );

    const rows = resultsOf(res)[0].data as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(['Theirs']);
  });

  it('per-query sys_read is owner-scoped — cannot read another owner row by id', async () => {
    const created = await sysCreate(CONTACTS, { data: { name: 'Theirs' } }, OTHER_USER, realDb);
    const otherId = (created.data as { id: number }).id;

    const res = await sysMultiQuery(
      {
        queries: [
          { alias: 'steal', model: 'contacts', method: 'sys_read', params: { id: otherId } },
        ],
      },
      TEST_USER,
      CONFIG,
      realDb,
    );

    const r = resultsOf(res)[0];
    expect(r.success).toBe(false);
    expect(r.error?.code).toBe('NOT_FOUND');
  });
});
