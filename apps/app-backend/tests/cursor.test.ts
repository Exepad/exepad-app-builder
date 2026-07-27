/**
 * Unit tests for cursor-based pagination utilities
 */

import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor } from '../src/utils/cursor';
import { buildCursorListQuery } from '../src/utils/sql';

// ---------------------------------------------------------------------------
// Cursor encode / decode
// ---------------------------------------------------------------------------

describe('Cursor Utilities', () => {
  describe('encodeCursor', () => {
    it('produces a valid base64 string', () => {
      const cursor = encodeCursor('created_at', '2025-01-01', 'asc', 'id', 42);
      // btoa output is always ASCII and does not contain whitespace
      expect(typeof cursor).toBe('string');
      expect(cursor.length).toBeGreaterThan(0);
      // Decoding should not throw
      expect(() => atob(cursor)).not.toThrow();
    });

    it('round-trips correctly with decodeCursor', () => {
      const cursor = encodeCursor('created_at', '2025-06-15T10:00:00Z', 'desc', 'id', 99);
      const payload = decodeCursor(cursor);

      expect(payload).not.toBeNull();
      expect(payload!.f).toBe('created_at');
      expect(payload!.v).toBe('2025-06-15T10:00:00Z');
      expect(payload!.d).toBe('desc');
      expect(payload!.tf).toBe('id');
      expect(payload!.tv).toBe(99);
    });

    it('handles string values', () => {
      const cursor = encodeCursor('name', 'Alice', 'asc', 'id', 'abc-123');
      const payload = decodeCursor(cursor);

      expect(payload).not.toBeNull();
      expect(payload!.v).toBe('Alice');
      expect(payload!.tv).toBe('abc-123');
    });

    it('handles numeric values', () => {
      const cursor = encodeCursor('score', 98.5, 'desc', 'id', 7);
      const payload = decodeCursor(cursor);

      expect(payload).not.toBeNull();
      expect(payload!.v).toBe(98.5);
      expect(payload!.tv).toBe(7);
    });

    it('handles null values in tie-breaker', () => {
      const cursor = encodeCursor('rank', null, 'asc', 'id', null);
      const payload = decodeCursor(cursor);

      expect(payload).not.toBeNull();
      expect(payload!.v).toBeNull();
      expect(payload!.tv).toBeNull();
    });
  });

  describe('decodeCursor', () => {
    it('returns null for empty string', () => {
      expect(decodeCursor('')).toBeNull();
    });

    it('returns null for non-base64 string', () => {
      // Characters outside the base64 alphabet
      expect(decodeCursor('%%%not-base64!!!')).toBeNull();
    });

    it('returns null for valid base64 but invalid JSON', () => {
      const encoded = btoa('this is not json');
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('returns null for missing "f" field', () => {
      const encoded = btoa(JSON.stringify({ v: 10, d: 'asc', tf: 'id', tv: 1 }));
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('returns null for missing "d" field', () => {
      const encoded = btoa(JSON.stringify({ f: 'created_at', v: 10, tf: 'id', tv: 1 }));
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('returns null for missing "tf" field', () => {
      const encoded = btoa(JSON.stringify({ f: 'created_at', v: 10, d: 'asc', tv: 1 }));
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('returns null for undefined "v" field', () => {
      // When "v" key is omitted, parsed object has v === undefined
      const encoded = btoa(JSON.stringify({ f: 'created_at', d: 'asc', tf: 'id', tv: 1 }));
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('returns null for undefined "tv" field', () => {
      const encoded = btoa(JSON.stringify({ f: 'created_at', v: 10, d: 'asc', tf: 'id' }));
      expect(decodeCursor(encoded)).toBeNull();
    });

    it('returns valid payload for correct input', () => {
      const encoded = btoa(JSON.stringify({ f: 'updated_at', v: '2025-12-31', d: 'desc', tf: 'id', tv: 500 }));
      const payload = decodeCursor(encoded);

      expect(payload).toEqual({
        f: 'updated_at',
        v: '2025-12-31',
        d: 'desc',
        tf: 'id',
        tv: 500,
      });
    });
  });
});

// ---------------------------------------------------------------------------
// buildCursorListQuery
// ---------------------------------------------------------------------------

describe('buildCursorListQuery', () => {
  const baseOptions = {
    userId: 'user-1',
    cursorField: 'created_at',
    cursorDirection: 'asc' as const,
    tieField: 'id',
  };

  it('first page (no cursor values): no cursor WHERE, correct ORDER BY', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      ...baseOptions,
      // cursorValue and tieValue are undefined — first page
    });

    // Should NOT contain any composite cursor condition
    expect(sql).not.toContain('created_at" >');
    expect(sql).not.toContain('created_at" <');

    // Should have ORDER BY with cursor field first, then tie-breaker
    expect(sql).toContain('ORDER BY');
    expect(sql).toContain('"created_at" ASC');
    expect(sql).toContain('"id" ASC');

    // Bindings: owner_id + limit+1
    expect(bindings[0]).toBe('user-1');
    // Last binding is limit+1 (default limit 50 → 51)
    expect(bindings[bindings.length - 1]).toBe(51);
  });

  it('subsequent page ASC: uses > operator in composite WHERE', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      ...baseOptions,
      cursorDirection: 'asc',
      cursorValue: '2025-06-01',
      tieValue: 42,
    });

    // Composite cursor: (created_at > ? OR (created_at = ? AND id > ?))
    expect(sql).toContain('"created_at" > ?');
    expect(sql).toContain('"created_at" = ?');
    expect(sql).toContain('"id" > ?');

    // Bindings should contain cursor values
    expect(bindings).toContain('2025-06-01');
    expect(bindings).toContain(42);
  });

  it('subsequent page DESC: uses < operator in composite WHERE', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      ...baseOptions,
      cursorDirection: 'desc',
      cursorValue: '2025-06-01',
      tieValue: 42,
    });

    // Composite cursor with < for DESC
    expect(sql).toContain('"created_at" < ?');
    expect(sql).toContain('"created_at" = ?');
    expect(sql).toContain('"id" < ?');

    // ORDER BY should be DESC
    expect(sql).toContain('"created_at" DESC');
    expect(sql).toContain('"id" DESC');

    expect(bindings).toContain('2025-06-01');
    expect(bindings).toContain(42);
  });

  it('when cursorField === tieField (PK): simple comparison, no tie-breaker OR', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      userId: 'user-1',
      cursorField: 'id',
      cursorDirection: 'asc',
      tieField: 'id',
      cursorValue: 100,
      tieValue: 100,
    });

    // Simple comparison — no composite OR clause
    expect(sql).toContain('"id" > ?');
    expect(sql).not.toContain(' OR ');

    // ORDER BY should only list "id" once
    const orderByMatch = sql.match(/"id" ASC/g);
    expect(orderByMatch).toHaveLength(1);

    expect(bindings).toContain(100);
  });

  it('when cursorField !== tieField: composite WHERE (field > ? OR (field = ? AND pk > ?))', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      userId: 'user-1',
      cursorField: 'name',
      cursorDirection: 'asc',
      tieField: 'id',
      cursorValue: 'Charlie',
      tieValue: 55,
    });

    // Full composite cursor clause
    expect(sql).toContain('("name" > ? OR ("name" = ? AND "id" > ?))');
    expect(bindings).toContain('Charlie');
    expect(bindings).toContain(55);
  });

  it('SELECT includes cursorField + tieField even with custom select[]', () => {
    const { sql } = buildCursorListQuery('contacts', {
      ...baseOptions,
      select: ['name', 'email'],
    });

    // Must include all of: name, email, created_at (cursor), id (tie)
    expect(sql).toContain('"name"');
    expect(sql).toContain('"email"');
    expect(sql).toContain('"created_at"');
    expect(sql).toContain('"id"');
    // Should NOT be SELECT *
    expect(sql).not.toContain('SELECT *');
  });

  it('soft-delete exclusion: adds deleted_at IS NULL', () => {
    const { sql } = buildCursorListQuery('contacts', {
      ...baseOptions,
      excludeSoftDeleted: true,
    });

    expect(sql).toContain('"deleted_at" IS NULL');
  });

  it('soft-delete exclusion is skipped when filters include deleted_at', () => {
    const { sql } = buildCursorListQuery('contacts', {
      ...baseOptions,
      excludeSoftDeleted: true,
      filters: { deleted_at: null },
    });

    // The explicit filter for deleted_at should be present (IS NULL from filter logic)
    expect(sql).toContain('"deleted_at" IS NULL');
    // But we should NOT have a duplicate from the soft-delete guard
    const matches = sql.match(/"deleted_at" IS NULL/g);
    expect(matches).toHaveLength(1);
  });

  it('filter operators work alongside cursor: equality', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      ...baseOptions,
      filters: { status: 'active' },
      cursorValue: '2025-01-01',
      tieValue: 10,
    });

    expect(sql).toContain('"status" = ?');
    expect(bindings).toContain('active');
    // Cursor condition should also be present
    expect(sql).toContain('"created_at" > ?');
  });

  it('filter operators work alongside cursor: gt', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      ...baseOptions,
      filters: { age: { gt: 18 } },
      cursorValue: '2025-03-15',
      tieValue: 20,
    });

    expect(sql).toContain('"age" > ?');
    expect(bindings).toContain(18);
    // Cursor condition
    expect(sql).toContain('"created_at" > ?');
  });

  it('filter operators work alongside cursor: like', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      ...baseOptions,
      filters: { name: { like: '%john%' } },
      cursorValue: '2025-05-01',
      tieValue: 30,
    });

    expect(sql).toContain('"name" LIKE ?');
    expect(bindings).toContain('%john%');
  });

  it('fetches limit+1 rows (for hasMore detection)', () => {
    const { bindings: b10 } = buildCursorListQuery('contacts', {
      ...baseOptions,
      limit: 10,
    });
    // Last binding is limit+1
    expect(b10[b10.length - 1]).toBe(11);

    const { bindings: b25 } = buildCursorListQuery('contacts', {
      ...baseOptions,
      limit: 25,
    });
    expect(b25[b25.length - 1]).toBe(26);

    // Default limit (50) → 51
    const { bindings: bDefault } = buildCursorListQuery('contacts', {
      ...baseOptions,
    });
    expect(bDefault[bDefault.length - 1]).toBe(51);
  });

  it('ordering: cursor field first, then tie-breaker, then additional orderBy', () => {
    const { sql } = buildCursorListQuery('contacts', {
      ...baseOptions,
      cursorField: 'created_at',
      cursorDirection: 'asc',
      tieField: 'id',
      orderBy: { name: 'desc', email: 'asc' },
    });

    // Extract the ORDER BY clause
    const orderByIndex = sql.indexOf('ORDER BY');
    expect(orderByIndex).toBeGreaterThan(-1);
    const orderByClause = sql.slice(orderByIndex);

    // "created_at" ASC should come first
    const createdAtPos = orderByClause.indexOf('"created_at" ASC');
    const idPos = orderByClause.indexOf('"id" ASC');
    const namePos = orderByClause.indexOf('"name" DESC');
    const emailPos = orderByClause.indexOf('"email" ASC');

    expect(createdAtPos).toBeGreaterThan(-1);
    expect(idPos).toBeGreaterThan(-1);
    expect(namePos).toBeGreaterThan(-1);
    expect(emailPos).toBeGreaterThan(-1);

    // Order: created_at < id < name < email
    expect(createdAtPos).toBeLessThan(idPos);
    expect(idPos).toBeLessThan(namePos);
    expect(namePos).toBeLessThan(emailPos);
  });

  it('additional orderBy does not duplicate cursor or tie-breaker fields', () => {
    const { sql } = buildCursorListQuery('contacts', {
      ...baseOptions,
      cursorField: 'created_at',
      cursorDirection: 'desc',
      tieField: 'id',
      orderBy: { created_at: 'desc', id: 'desc', name: 'asc' },
    });

    // "created_at" should appear exactly once in ORDER BY
    const orderByClause = sql.slice(sql.indexOf('ORDER BY'));
    const createdAtMatches = orderByClause.match(/"created_at"/g);
    const idMatches = orderByClause.match(/"id"/g);

    expect(createdAtMatches).toHaveLength(1);
    expect(idMatches).toHaveLength(1);

    // Additional field "name" should still appear
    expect(orderByClause).toContain('"name" ASC');
  });
});

// ── P5: Cursor pagination edge cases ───────────────────────────────

describe('Cursor edge cases', () => {
  it('encodeCursor handles very long string values', () => {
    const longStr = 'x'.repeat(10000);
    const cursor = encodeCursor('name', longStr, 'asc', 'id', 1);
    const payload = decodeCursor(cursor);

    expect(payload).not.toBeNull();
    expect(payload!.v).toBe(longStr);
  });

  it('encodeCursor handles zero as cursor value', () => {
    const cursor = encodeCursor('score', 0, 'asc', 'id', 0);
    const payload = decodeCursor(cursor);

    expect(payload).not.toBeNull();
    expect(payload!.v).toBe(0);
    expect(payload!.tv).toBe(0);
  });

  it('decodeCursor rejects tampered cursor (valid base64, wrong structure)', () => {
    // Valid base64, valid JSON, but missing required cursor fields
    const encoded = btoa(JSON.stringify({ foo: 'bar', baz: 123 }));
    expect(decodeCursor(encoded)).toBeNull();
  });

  it('decodeCursor rejects cursor with extra fields (still valid)', () => {
    // Has all required fields plus extra — should still work
    const encoded = btoa(JSON.stringify({
      f: 'created_at', v: '2025-01-01', d: 'asc', tf: 'id', tv: 1, extra: 'data',
    }));
    const payload = decodeCursor(encoded);
    expect(payload).not.toBeNull();
    expect(payload!.f).toBe('created_at');
  });

  it('buildCursorListQuery with no userId (shared scope)', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      cursorField: 'created_at',
      cursorDirection: 'asc',
      tieField: 'id',
      // No userId — shared scope
    });

    // Should NOT contain owner_id filter
    expect(sql).not.toContain('owner_id');
    // Bindings should only have limit+1
    expect(bindings[bindings.length - 1]).toBe(51);
  });

  it('buildCursorListQuery with null cursor values on subsequent page', () => {
    const { sql, bindings } = buildCursorListQuery('contacts', {
      userId: 'user-1',
      cursorField: 'name',
      cursorDirection: 'asc',
      tieField: 'id',
      cursorValue: null,
      tieValue: 42,
    });

    // Should still include cursor clause since values are provided (even null)
    expect(sql).toContain('ORDER BY');
    expect(bindings).toContain(42);
  });

  it('encodeCursor handles boolean cursor value', () => {
    const cursor = encodeCursor('active', true, 'asc', 'id', 5);
    const payload = decodeCursor(cursor);

    expect(payload).not.toBeNull();
    expect(payload!.v).toBe(true);
  });
});
