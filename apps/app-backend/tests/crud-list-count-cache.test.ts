/**
 * Offset-mode COUNT(*) caching for large tables (2026-07-04).
 *
 * A paginating dashboard on a large table would otherwise issue a full-scan
 * COUNT(*) on every page request. `sysList` now serves the count from a
 * short-lived per-(model,filters) cache — but ONLY once the count is confirmed
 * large (>= COUNT_CACHE_MIN_ROWS); small tables always get an exact, freshly
 * counted total. The cache is keyed by the live DB handle, so it's per-app.
 *
 * We assert behaviour by counting how many COUNT queries reach the (mock) DB.
 */

import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { LocalD1 } from '@exepad/local-adapters/db';
import { generateCreateTableSQL } from '@exepad/deploy-utils';
import { sysList } from '../src/crud/list';
import type { ModelProps } from '../src/types/env';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_USER } from './helpers/mock-env';

function listDb(rows: Record<string, unknown>[], count: number) {
  return createMockD1({
    results: new Map<string, Record<string, unknown>[]>([
      ['SELECT COUNT', [{ count }]], // check COUNT before SELECT * (substring order)
      ['SELECT *', rows],
    ]),
    defaultResult: rows,
  });
}

const countQueries = (db: { _queries: { sql: string }[] }) =>
  db._queries.filter((q) => q.sql.includes('COUNT')).length;

// A FULL page (rows.length === limit) forces the COUNT path.
const FULL_PAGE = [
  { id: 1, name: 'A', owner_id: TEST_USER.id },
  { id: 2, name: 'B', owner_id: TEST_USER.id },
];

describe('sysList offset-mode COUNT caching', () => {
  it('caches the COUNT for a confirmed-large table (second page is a cache hit)', async () => {
    const db = listDb(FULL_PAGE, 60_000); // >= COUNT_CACHE_MIN_ROWS
    const params = { limit: 2, offset: 0 };

    const r1 = await sysList(TEST_MODEL, params, TEST_USER, db);
    const r2 = await sysList(TEST_MODEL, params, TEST_USER, db);

    expect(r1.pagination?.total).toBe(60_000);
    expect(r2.pagination?.total).toBe(60_000);
    // Only the FIRST request scanned; the second reused the cached count.
    expect(countQueries(db)).toBe(1);
  });

  it('does NOT cache small tables — every request re-counts exactly', async () => {
    const db = listDb(FULL_PAGE, 3); // below the large-table threshold
    const params = { limit: 2, offset: 0 };

    const r1 = await sysList(TEST_MODEL, params, TEST_USER, db);
    const r2 = await sysList(TEST_MODEL, params, TEST_USER, db);

    expect(r1.pagination?.total).toBe(3);
    expect(r2.pagination?.total).toBe(3);
    // Small table: both requests issued a fresh, exact COUNT (no caching).
    expect(countQueries(db)).toBe(2);
  });

  it('keeps distinct filters on separate cache buckets', async () => {
    const db = listDb(FULL_PAGE, 60_000);
    await sysList(TEST_MODEL, { limit: 2, offset: 0, filters: { name: 'A' } }, TEST_USER, db);
    await sysList(TEST_MODEL, { limit: 2, offset: 0, filters: { name: 'B' } }, TEST_USER, db);
    // Different filters → different keys → each scanned once (no false cache hit).
    expect(countQueries(db)).toBe(2);
  });

  it('never counts at all when the page is short (last page)', async () => {
    const db = listDb([FULL_PAGE[0]], 60_000); // 1 row for a limit of 2 → last page
    const r = await sysList(TEST_MODEL, { limit: 2, offset: 0 }, TEST_USER, db);
    expect(r.pagination?.total).toBe(1); // offset(0) + 1 row, no COUNT
    expect(countQueries(db)).toBe(0);
  });
});

describe('sysList COUNT cache is shared across DB wrappers (real LocalD1)', () => {
  const MODEL: ModelProps = {
    uuid: 'count-cache-model',
    name: 'contacts',
    columns: [
      { name: 'id', type: 'integer', isPrimary: true },
      { name: 'name', type: 'text' },
    ],
  };

  it('reuses a warmed large-table count across a fresh wrapper over the same pooled handle', async () => {
    // Mirror production: env.DB is a NEW LocalD1 per request, but the underlying
    // better-sqlite3 handle is POOLED (stable). The cache must key on that handle
    // so a dashboard's separate requests share the count instead of re-scanning.
    const raw = new Database(':memory:');
    raw.exec(generateCreateTableSQL(MODEL));

    const now = new Date().toISOString();
    const insert = raw.prepare(
      'INSERT INTO contacts (name, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?)',
    );
    const seed = raw.transaction((n: number) => {
      for (let i = 0; i < n; i++) insert.run(`c${i}`, TEST_USER.id, now, now);
    });
    seed(10_001); // > COUNT_CACHE_MIN_ROWS → this count is cacheable

    // Request 1 over wrapper A warms the cache (full page → COUNT runs → 10001).
    const wrapperA = new LocalD1(raw) as unknown as D1Database;
    const a = await sysList(MODEL, { limit: 2, offset: 0 }, TEST_USER, wrapperA);
    expect(a.pagination?.total).toBe(10_001);

    // Rows change underneath, but within the TTL...
    raw.exec('DELETE FROM contacts WHERE id % 2 = 0'); // ~5000 rows remain (still a full page)

    // Request 2 over a DISTINCT wrapper B (same pooled raw handle) hits the cache
    // and returns the warmed count — proving the cache is keyed on the shared
    // handle, not the per-request wrapper object.
    const wrapperB = new LocalD1(raw) as unknown as D1Database;
    const b = await sysList(MODEL, { limit: 2, offset: 0 }, TEST_USER, wrapperB);
    expect(b.pagination?.total).toBe(10_001); // stale-but-cached, not the fresh ~5000

    raw.close();
  });
});
