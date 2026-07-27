/**
 * Tests for sysList CRUD operation
 */

import { describe, it, expect } from 'vitest';
import { sysList } from '../src/crud/list';
import { ValidationError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_MODEL_SOFT_DELETE, TEST_MODEL_SHARED, TEST_USER } from './helpers/mock-env';

function createListDb(rows: Record<string, unknown>[] = [], count = 0) {
  return createMockD1({
    results: new Map([
      ['SELECT *', rows],
      ['SELECT COUNT', [{ count }]],
    ]),
    defaultResult: rows,
  });
}

describe('sysList', () => {
  it('returns paginated results in offset mode', async () => {
    const rows = [
      { id: 1, name: 'Alice', owner_id: 'user-123' },
      { id: 2, name: 'Bob', owner_id: 'user-123' },
    ];
    const db = createListDb(rows, 2);

    const result = await sysList(TEST_MODEL, { limit: 10, offset: 0 }, TEST_USER, db);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.pagination?.total).toBe(2);
    expect(result.pagination?.hasMore).toBe(false);
  });

  it('detects hasMore correctly', async () => {
    const rows = [{ id: 1, name: 'Alice', owner_id: 'user-123' }];
    const db = createListDb(rows, 5);

    const result = await sysList(TEST_MODEL, { limit: 1, offset: 0 }, TEST_USER, db);

    expect(result.pagination?.hasMore).toBe(true);
    expect(result.pagination?.total).toBe(5);
  });

  it('skips the COUNT(*) query when the page is short (last page)', async () => {
    // 2 rows returned for a limit of 10 → this is provably the last page, so
    // total = offset + rows and no full-scan COUNT should be issued.
    const rows = [
      { id: 1, name: 'Alice', owner_id: 'user-123' },
      { id: 2, name: 'Bob', owner_id: 'user-123' },
    ];
    // Deliberately supply a WRONG count (99): if the COUNT ran, total would be 99.
    const db = createListDb(rows, 99);

    const result = await sysList(TEST_MODEL, { limit: 10, offset: 0 }, TEST_USER, db);

    expect(result.pagination?.total).toBe(2); // offset(0) + 2 rows, not the count
    expect(result.pagination?.hasMore).toBe(false);
    expect(db._queries.some((q) => q.sql.includes('COUNT'))).toBe(false);
  });

  it('computes total from offset + rows for a short page beyond page 1', async () => {
    const rows = [{ id: 21, name: 'Zed', owner_id: 'user-123' }];
    const db = createListDb(rows, 99);

    const result = await sysList(TEST_MODEL, { limit: 10, offset: 20 }, TEST_USER, db);

    expect(result.pagination?.total).toBe(21); // offset(20) + 1 row
    expect(result.pagination?.hasMore).toBe(false);
    expect(db._queries.some((q) => q.sql.includes('COUNT'))).toBe(false);
  });

  it('runs the COUNT(*) query when the page is full (more rows may exist)', async () => {
    const rows = [
      { id: 1, name: 'Alice', owner_id: 'user-123' },
      { id: 2, name: 'Bob', owner_id: 'user-123' },
    ];
    const db = createListDb(rows, 5);

    const result = await sysList(TEST_MODEL, { limit: 2, offset: 0 }, TEST_USER, db);

    expect(result.pagination?.total).toBe(5);
    expect(result.pagination?.hasMore).toBe(true);
    expect(db._queries.some((q) => q.sql.includes('COUNT'))).toBe(true);
  });

  it('defaults to limit=50 and offset=0', async () => {
    const db = createListDb([], 0);

    await sysList(TEST_MODEL, undefined, TEST_USER, db);

    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT *'));
    expect(selectQuery!.binds).toContain(50); // default limit
    expect(selectQuery!.binds).toContain(0);  // default offset
  });

  it('throws for limit out of range', async () => {
    const db = createListDb();

    await expect(
      sysList(TEST_MODEL, { limit: 0 }, TEST_USER, db)
    ).rejects.toThrow(ValidationError);

    await expect(
      sysList(TEST_MODEL, { limit: 501 }, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('throws for negative offset', async () => {
    const db = createListDb();

    await expect(
      sysList(TEST_MODEL, { offset: -1 }, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('throws for invalid select columns', async () => {
    const db = createListDb();

    await expect(
      sysList(TEST_MODEL, { select: ['nonexistent'] }, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('throws for invalid filter fields', async () => {
    const db = createListDb();

    await expect(
      sysList(TEST_MODEL, { filters: { bogus: 'value' } }, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('throws for invalid orderBy fields', async () => {
    const db = createListDb();

    await expect(
      sysList(TEST_MODEL, { orderBy: { bogus: 'asc' } }, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('uses cursor mode when paginationMode=cursor', async () => {
    const rows = [{ id: 1, name: 'Alice', owner_id: 'user-123' }];
    const db = createListDb(rows, 0);

    const result = await sysList(
      TEST_MODEL,
      { paginationMode: 'cursor', limit: 10 },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    // Cursor mode doesn't return total
    expect(result.pagination?.total).toBeUndefined();
  });

  it('scopes by owner_id for user-scoped models', async () => {
    const db = createListDb([], 0);

    await sysList(TEST_MODEL, {}, TEST_USER, db);

    const queries = db._queries;
    const selectQuery = queries.find((q) => q.sql.includes('SELECT *'));
    expect(selectQuery!.sql).toContain('owner_id = ?');
    expect(selectQuery!.binds).toContain('user-123');
  });

  it('does not scope by owner_id for shared models', async () => {
    const db = createListDb([], 0);

    await sysList(TEST_MODEL_SHARED, {}, TEST_USER, db);

    const queries = db._queries;
    const selectQuery = queries.find((q) => q.sql.includes('SELECT *'));
    expect(selectQuery!.sql).not.toContain('owner_id = ?');
  });

  it('excludes soft-deleted records', async () => {
    const db = createListDb([], 0);

    await sysList(TEST_MODEL_SOFT_DELETE, {}, TEST_USER, db);

    const queries = db._queries;
    const selectQuery = queries.find((q) => q.sql.includes('SELECT *'));
    expect(selectQuery!.sql).toContain('"deleted_at" IS NULL');
  });

  it('parses JSON columns in results', async () => {
    const rows = [{ id: 1, name: 'Alice', metadata: '{"k":"v"}', owner_id: 'user-123' }];
    const db = createListDb(rows, 1);

    const result = await sysList(TEST_MODEL, { limit: 10 }, TEST_USER, db);

    expect((result.data as any[])[0].metadata).toEqual({ k: 'v' });
  });

  it('handles empty result set', async () => {
    const db = createListDb([], 0);

    const result = await sysList(TEST_MODEL, {}, TEST_USER, db);

    expect(result.data).toEqual([]);
    expect(result.pagination?.total).toBe(0);
    expect(result.pagination?.hasMore).toBe(false);
  });
});
