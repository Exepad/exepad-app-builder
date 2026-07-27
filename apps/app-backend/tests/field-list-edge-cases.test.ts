/**
 * Field List Edge Cases
 *
 * Tests for system column access, limit/offset type safety,
 * and cursor pagination edge cases — covers BUG-3, BUG-5 gaps.
 */

import { describe, it, expect } from 'vitest';
import { sysList } from '../src/crud/list';
import { ValidationError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import {
  TEST_MODEL,
  TEST_MODEL_SOFT_DELETE,
  TEST_USER,
} from './helpers/mock-env';

// ── Helpers ──────────────────────────────────────────────────────

/** Create a mock D1 for offset-mode list (needs both COUNT and list results) */
function createOffsetMockD1(
  rows: Record<string, unknown>[],
  total: number
) {
  return createMockD1({
    results: new Map([
      ['COUNT(*)', [{ count: total }]],
      ['LIMIT', rows],
    ]),
  });
}

/** Create a mock D1 for cursor-mode list (only needs list results) */
function createCursorMockD1(rows: Record<string, unknown>[]) {
  return createMockD1({
    results: new Map([['FROM', rows]]),
  });
}

// ── System columns in list ───────────────────────────────────────

describe('System columns in list', () => {
  const db = createOffsetMockD1(
    [
      {
        id: 1,
        name: 'test',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
        owner_id: 'user-123',
      },
    ],
    1
  );

  describe('select', () => {
    it('allows select with created_at', async () => {
      const result = await sysList(
        TEST_MODEL,
        { select: ['name', 'created_at'] },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('allows select with updated_at', async () => {
      const result = await sysList(
        TEST_MODEL,
        { select: ['name', 'updated_at'] },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('allows select with owner_id', async () => {
      const result = await sysList(
        TEST_MODEL,
        { select: ['name', 'owner_id'] },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('allows select with id', async () => {
      const result = await sysList(
        TEST_MODEL,
        { select: ['name', 'id'] },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('allows select with deleted_at on soft-delete model', async () => {
      const result = await sysList(
        TEST_MODEL_SOFT_DELETE,
        { select: ['title', 'deleted_at'] },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('rejects deleted_at on non-soft-delete model', async () => {
      await expect(
        sysList(
          TEST_MODEL,
          { select: ['name', 'deleted_at'] },
          TEST_USER,
          db
        )
      ).rejects.toThrow(ValidationError);
    });

    it('rejects nonexistent column', async () => {
      await expect(
        sysList(
          TEST_MODEL,
          { select: ['nonexistent'] },
          TEST_USER,
          db
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('orderBy', () => {
    it('allows orderBy created_at desc', async () => {
      const result = await sysList(
        TEST_MODEL,
        { orderBy: { created_at: 'desc' } },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('allows orderBy updated_at asc', async () => {
      const result = await sysList(
        TEST_MODEL,
        { orderBy: { updated_at: 'asc' } },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('rejects orderBy nonexistent field', async () => {
      await expect(
        sysList(
          TEST_MODEL,
          { orderBy: { nonexistent: 'asc' } as Record<string, 'asc' | 'desc'> },
          TEST_USER,
          db
        )
      ).rejects.toThrow(ValidationError);
    });
  });

  describe('filters', () => {
    it('allows filter on created_at', async () => {
      const result = await sysList(
        TEST_MODEL,
        { filters: { created_at: { gt: '2024-01-01' } } },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('allows filter on owner_id', async () => {
      const result = await sysList(
        TEST_MODEL,
        { filters: { owner_id: 'user-123' } },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('rejects filter on nonexistent field', async () => {
      await expect(
        sysList(
          TEST_MODEL,
          { filters: { nonexistent: 'value' } },
          TEST_USER,
          db
        )
      ).rejects.toThrow(ValidationError);
    });
  });
});

// ── Limit/offset validation ──────────────────────────────────────

describe('Limit and offset validation', () => {
  // Validation throws before hitting DB, so mock D1 doesn't need results
  const db = createMockD1();

  describe('limit', () => {
    it('rejects string limit', async () => {
      await expect(
        sysList(TEST_MODEL, { limit: 'abc' as unknown as number }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects NaN limit', async () => {
      await expect(
        sysList(TEST_MODEL, { limit: NaN }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects Infinity limit', async () => {
      await expect(
        sysList(TEST_MODEL, { limit: Infinity }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects -Infinity limit', async () => {
      await expect(
        sysList(TEST_MODEL, { limit: -Infinity }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects limit of 0', async () => {
      await expect(
        sysList(TEST_MODEL, { limit: 0 }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects limit above MAX_LIMIT (501)', async () => {
      await expect(
        sysList(TEST_MODEL, { limit: 501 }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects fractional limit 0.5 (below minimum 1)', async () => {
      await expect(
        sysList(TEST_MODEL, { limit: 0.5 }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('accepts limit at MAX_LIMIT boundary (500)', async () => {
      const dbOk = createOffsetMockD1([], 0);
      const result = await sysList(
        TEST_MODEL,
        { limit: 500 },
        TEST_USER,
        dbOk
      );
      expect(result.success).toBe(true);
    });

    it('accepts limit of 1 (minimum)', async () => {
      const dbOk = createOffsetMockD1([], 0);
      const result = await sysList(
        TEST_MODEL,
        { limit: 1 },
        TEST_USER,
        dbOk
      );
      expect(result.success).toBe(true);
    });

    it('passes validation for non-integer limit 1.5 (no integer check)', async () => {
      // 1.5 is finite and >= 1 and <= 500 — current validation passes it
      const dbOk = createOffsetMockD1([], 0);
      const result = await sysList(
        TEST_MODEL,
        { limit: 1.5 },
        TEST_USER,
        dbOk
      );
      expect(result.success).toBe(true);
    });
  });

  describe('offset', () => {
    it('rejects string offset', async () => {
      await expect(
        sysList(
          TEST_MODEL,
          { offset: 'abc' as unknown as number },
          TEST_USER,
          db
        )
      ).rejects.toThrow(ValidationError);
    });

    it('rejects NaN offset', async () => {
      await expect(
        sysList(TEST_MODEL, { offset: NaN }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('rejects negative offset', async () => {
      await expect(
        sysList(TEST_MODEL, { offset: -1 }, TEST_USER, db)
      ).rejects.toThrow(ValidationError);
    });

    it('accepts offset of 0 (boundary)', async () => {
      const dbOk = createOffsetMockD1([], 0);
      const result = await sysList(
        TEST_MODEL,
        { offset: 0 },
        TEST_USER,
        dbOk
      );
      expect(result.success).toBe(true);
    });

    it('does not validate offset in cursor mode', async () => {
      // In cursor mode, offset is ignored — no validation even for bad values
      const cursorDb = createCursorMockD1([]);
      const result = await sysList(
        TEST_MODEL,
        { offset: -999, paginationMode: 'cursor' } as Record<string, unknown>,
        TEST_USER,
        cursorDb
      );
      expect(result.success).toBe(true);
    });
  });
});

// ── Cursor pagination edge cases ─────────────────────────────────

describe('Cursor pagination edge cases', () => {
  it('returns results and nextCursor on first page when more data exists', async () => {
    // Simulate limit+1 rows returned (limit=2, 3 rows means hasMore=true)
    const rows = [
      { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123', created_at: '2024-01-01', updated_at: '2024-01-01' },
      { id: 2, name: 'Bob', email: 'b@b.com', owner_id: 'user-123', created_at: '2024-01-02', updated_at: '2024-01-02' },
      { id: 3, name: 'Charlie', email: 'c@b.com', owner_id: 'user-123', created_at: '2024-01-03', updated_at: '2024-01-03' },
    ];
    const db = createCursorMockD1(rows);

    const result = await sysList(
      TEST_MODEL,
      { paginationMode: 'cursor', limit: 2 },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.pagination?.hasMore).toBe(true);
    expect(result.pagination?.nextCursor).toBeDefined();
  });

  it('rejects invalid cursor string', async () => {
    const db = createMockD1();
    await expect(
      sysList(
        TEST_MODEL,
        { cursor: 'not-valid-base64-json' },
        TEST_USER,
        db
      )
    ).rejects.toThrow(ValidationError);
  });

  it('returns hasMore=false when results <= limit', async () => {
    const rows = [
      { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123', created_at: '2024-01-01', updated_at: '2024-01-01' },
    ];
    const db = createCursorMockD1(rows);

    const result = await sysList(
      TEST_MODEL,
      { paginationMode: 'cursor', limit: 5 },
      TEST_USER,
      db
    );

    expect(result.pagination?.hasMore).toBe(false);
    expect(result.pagination?.nextCursor).toBeUndefined();
  });

  it('returns empty results with hasMore=false', async () => {
    const db = createCursorMockD1([]);

    const result = await sysList(
      TEST_MODEL,
      { paginationMode: 'cursor', limit: 10 },
      TEST_USER,
      db
    );

    expect(result.data).toHaveLength(0);
    expect(result.pagination?.hasMore).toBe(false);
    expect(result.pagination?.nextCursor).toBeUndefined();
  });

  it('returns hasMore=false when exactly limit rows returned', async () => {
    // Mock query fetches limit+1 but only 2 rows exist — 2 is NOT > limit(2)
    const rows = [
      { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123', created_at: '2024-01-01', updated_at: '2024-01-01' },
      { id: 2, name: 'Bob', email: 'b@b.com', owner_id: 'user-123', created_at: '2024-01-02', updated_at: '2024-01-02' },
    ];
    const db = createCursorMockD1(rows);

    const result = await sysList(
      TEST_MODEL,
      { paginationMode: 'cursor', limit: 2 },
      TEST_USER,
      db
    );

    expect(result.data).toHaveLength(2);
    expect(result.pagination?.hasMore).toBe(false);
  });
});
