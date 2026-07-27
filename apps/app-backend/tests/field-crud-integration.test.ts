/**
 * Field CRUD Integration Tests
 *
 * Cross-cutting tests that verify the full CRUD pipeline: validation,
 * coercion, default values, system field injection, JSON handling,
 * ownership checks, and soft-delete interactions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sysCreate } from '../src/crud/create';
import { sysUpdate } from '../src/crud/update';
import { sysRead } from '../src/crud/read';
import { sysDelete } from '../src/crud/delete';
import { ValidationError, NotFoundError, ForbiddenError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import {
  TEST_MODEL,
  TEST_MODEL_SOFT_DELETE,
  TEST_MODEL_SHARED,
  TEST_USER,
  TEST_ADMIN,
} from './helpers/mock-env';
import type { ModelProps } from '../src/types/env';

// ── Constants ────────────────────────────────────────────────────

const FIXED_TIME = '2024-06-15T12:00:00.000Z';

// ── Test Models ──────────────────────────────────────────────────

const MODEL_WITH_DEFAULTS: ModelProps = {
  uuid: 'defaults',
  name: 'settings',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'key', type: 'text' },
    { name: 'value', type: 'text', defaultValue: 'default_value' },
    { name: 'priority', type: 'integer', defaultValue: 0 },
  ],
};

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_TIME));
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Create pipeline ──────────────────────────────────────────────

describe('Create pipeline', () => {
  it('applies default values for missing optional fields', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'INSERT',
          [{ id: 1, key: 'test', value: 'default_value', priority: 0, owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }],
        ],
      ]),
    });

    await sysCreate(MODEL_WITH_DEFAULTS, { data: { key: 'test' } }, TEST_USER, db);

    // Verify INSERT bindings include the default values
    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.binds).toContain('default_value');
    expect(insertQuery!.binds).toContain(0);
  });

  it('provided value overrides default', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'INSERT',
          [{ id: 1, key: 'test', value: 'custom', priority: 99, owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }],
        ],
      ]),
    });

    await sysCreate(
      MODEL_WITH_DEFAULTS,
      { data: { key: 'test', value: 'custom', priority: 99 } },
      TEST_USER,
      db
    );

    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT'));
    expect(insertQuery!.binds).toContain('custom');
    expect(insertQuery!.binds).toContain(99);
    expect(insertQuery!.binds).not.toContain('default_value');
  });

  it('sets owner_id from user context, not from data', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'INSERT',
          [{ id: 1, name: 'test', email: 'test@example.com', owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }],
        ],
      ]),
    });

    await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com' } },
      TEST_USER,
      db
    );

    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT'));
    expect(insertQuery!.binds).toContain('user-123');
  });

  it('sets created_at and updated_at to ISO string', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'INSERT',
          [{ id: 1, name: 'test', email: 'test@example.com', owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }],
        ],
      ]),
    });

    await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com' } },
      TEST_USER,
      db
    );

    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT'));
    // Both timestamps should be the fixed time
    const timeCount = insertQuery!.binds.filter((b) => b === FIXED_TIME).length;
    expect(timeCount).toBe(2); // created_at + updated_at
  });

  it('stringifies JSON column objects in INSERT bindings', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'INSERT',
          [{ id: 1, name: 'test', email: 'test@example.com', metadata: '{"nested":{"deep":true}}', owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }],
        ],
      ]),
    });

    const result = await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com', metadata: { nested: { deep: true } } } },
      TEST_USER,
      db
    );

    // Verify bindings contain stringified JSON
    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT'));
    expect(insertQuery!.binds).toContain('{"nested":{"deep":true}}');

    // Verify response has parsed JSON
    expect(result.data).toHaveProperty('metadata');
    expect((result.data as Record<string, unknown>).metadata).toEqual({
      nested: { deep: true },
    });
  });

  it('stores already-string JSON as-is in INSERT bindings', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'INSERT',
          [{ id: 1, name: 'test', email: 'test@example.com', metadata: '{"key":"val"}', owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }],
        ],
      ]),
    });

    await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com', metadata: '{"key":"val"}' } },
      TEST_USER,
      db
    );

    // stringifyJsonColumns skips strings, so it should be stored as-is
    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT'));
    expect(insertQuery!.binds).toContain('{"key":"val"}');
  });

  it('creates record with all nullable fields omitted', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'INSERT',
          [{ id: 1, name: 'test', email: 'test@example.com', owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }],
        ],
      ]),
    });

    // TEST_MODEL: name + email are required, rest are nullable
    const result = await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com' } },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
  });
});

// ── Update pipeline ──────────────────────────────────────────────

describe('Update pipeline', () => {
  it('auto-sets updated_at but NOT created_at', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 1, owner_id: 'user-123' }]],
        ['UPDATE', [{ id: 1, name: 'updated', email: 'test@example.com', owner_id: 'user-123', created_at: '2024-01-01', updated_at: FIXED_TIME }]],
      ]),
    });

    await sysUpdate(
      TEST_MODEL,
      { id: 1, data: { name: 'updated' } },
      TEST_USER,
      db
    );

    const updateQuery = db._queries.find((q) => q.sql.includes('UPDATE'));
    expect(updateQuery!.sql).toContain('updated_at');
    expect(updateQuery!.sql).not.toContain('created_at');
  });

  it('coerces string to number in update pipeline', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 1, owner_id: 'user-123' }]],
        ['UPDATE', [{ id: 1, name: 'test', email: 'test@example.com', age: 25, owner_id: 'user-123', created_at: '2024-01-01', updated_at: FIXED_TIME }]],
      ]),
    });

    await sysUpdate(
      TEST_MODEL,
      { id: 1, data: { age: '25' } },
      TEST_USER,
      db
    );

    const updateQuery = db._queries.find((q) => q.sql.includes('UPDATE'));
    // Age should be coerced to number 25, not string "25"
    expect(updateQuery!.binds).toContain(25);
    expect(updateQuery!.binds).not.toContain('25');
  });

  it('rejects empty payload after filtering system fields', async () => {
    await expect(
      sysUpdate(
        TEST_MODEL,
        { id: 1, data: {} },
        TEST_USER,
        createMockD1()
      )
    ).rejects.toThrow(ValidationError);
  });

  it('rejects protected fields (id, owner_id, created_at)', async () => {
    await expect(
      sysUpdate(
        TEST_MODEL,
        { id: 1, data: { owner_id: 'hacker' } },
        TEST_USER,
        createMockD1()
      )
    ).rejects.toThrow(ValidationError);
  });

  describe('shared model ownership', () => {
    it('allows owner to update their own record', async () => {
      const db = createMockD1({
        results: new Map([
          ['SELECT', [{ id: 1, owner_id: 'user-123' }]],
          ['UPDATE', [{ id: 1, name: 'updated', owner_id: 'user-123', updated_at: FIXED_TIME }]],
        ]),
      });

      const result = await sysUpdate(
        TEST_MODEL_SHARED,
        { id: 1, data: { name: 'updated' } },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('rejects non-owner non-admin update on shared model', async () => {
      const db = createMockD1({
        results: new Map([
          ['SELECT', [{ id: 1, owner_id: 'other-user' }]],
        ]),
      });

      await expect(
        sysUpdate(
          TEST_MODEL_SHARED,
          { id: 1, data: { name: 'hacked' } },
          TEST_USER,
          db
        )
      ).rejects.toThrow(ForbiddenError);
    });

    it('allows admin to update anyone record on shared model', async () => {
      const db = createMockD1({
        results: new Map([
          ['SELECT', [{ id: 1, owner_id: 'other-user' }]],
          ['UPDATE', [{ id: 1, name: 'admin-updated', owner_id: 'other-user', updated_at: FIXED_TIME }]],
        ]),
      });

      const result = await sysUpdate(
        TEST_MODEL_SHARED,
        { id: 1, data: { name: 'admin-updated' } },
        TEST_ADMIN,
        db
      );
      expect(result.success).toBe(true);
    });
  });
});

// ── Read interactions ────────────────────────────────────────────

describe('Read interactions', () => {
  it('returns parsed JSON columns', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'SELECT',
          [{ id: 1, name: 'test', email: 'test@example.com', metadata: '{"key":"val"}', owner_id: 'user-123', created_at: '2024-01-01', updated_at: '2024-01-01' }],
        ],
      ]),
    });

    const result = await sysRead(
      TEST_MODEL,
      { id: 1 },
      TEST_USER,
      db
    );

    expect((result.data as Record<string, unknown>).metadata).toEqual({
      key: 'val',
    });
  });

  it('does NOT filter by deleted_at (reads soft-deleted records)', async () => {
    const db = createMockD1({
      results: new Map([
        [
          'SELECT',
          [{ id: 1, title: 'deleted task', done: 0, deleted_at: '2024-01-01', owner_id: 'user-123', created_at: '2024-01-01', updated_at: '2024-01-01' }],
        ],
      ]),
    });

    const result = await sysRead(
      TEST_MODEL_SOFT_DELETE,
      { id: 1 },
      TEST_USER,
      db
    );

    // The read succeeds even though deleted_at is set
    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).deleted_at).toBe('2024-01-01');
  });

  it('any user can read any record on shared scope model', async () => {
    const otherUser = {
      id: 'other-user',
      email: 'other@example.com',
      roles: [] as string[],
      isAuthenticated: true,
    };
    const db = createMockD1({
      results: new Map([
        [
          'SELECT',
          [{ id: 1, name: 'shared data', email: 'test@example.com', owner_id: 'user-123', created_at: '2024-01-01', updated_at: '2024-01-01' }],
        ],
      ]),
    });

    // otherUser reads a record owned by user-123 on shared model
    const result = await sysRead(
      TEST_MODEL_SHARED,
      { id: 1 },
      otherUser,
      db
    );

    expect(result.success).toBe(true);

    // Verify no owner_id filter in the SQL
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT'));
    expect(selectQuery!.sql).not.toContain('owner_id = ?');
  });
});

// ── Delete interactions ──────────────────────────────────────────

describe('Delete interactions', () => {
  it('soft delete sets both deleted_at and updated_at', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 1, owner_id: 'user-123' }]],
      ]),
    });

    await sysDelete(
      TEST_MODEL_SOFT_DELETE,
      { id: 1 },
      TEST_USER,
      db
    );

    const deleteQuery = db._queries.find((q) =>
      q.sql.includes('deleted_at')
    );
    expect(deleteQuery).toBeDefined();
    expect(deleteQuery!.sql).toContain('deleted_at');
    expect(deleteQuery!.sql).toContain('updated_at');
    // Both timestamps should be in the bindings
    expect(deleteQuery!.binds.filter((b) => b === FIXED_TIME)).toHaveLength(2);
  });

  it('hard delete removes the record (DELETE FROM)', async () => {
    const db = createMockD1({
      results: new Map([
        ['SELECT', [{ id: 1, owner_id: 'user-123' }]],
      ]),
    });

    const result = await sysDelete(
      TEST_MODEL_SOFT_DELETE,
      { id: 1, soft: false },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).soft).toBe(false);

    const deleteQuery = db._queries.find((q) =>
      q.sql.includes('DELETE FROM')
    );
    expect(deleteQuery).toBeDefined();
  });

  it('cannot delete other user record on user-scoped model', async () => {
    // firstReturnsNull simulates no matching row for owner_id check
    const db = createMockD1({ firstReturnsNull: true });

    await expect(
      sysDelete(TEST_MODEL, { id: 1 }, TEST_USER, db)
    ).rejects.toThrow(NotFoundError);
  });

  describe('shared model delete ownership', () => {
    it('owner can delete their own record', async () => {
      const db = createMockD1({
        results: new Map([
          ['SELECT', [{ id: 1, owner_id: 'user-123' }]],
        ]),
      });

      const result = await sysDelete(
        TEST_MODEL_SHARED,
        { id: 1 },
        TEST_USER,
        db
      );
      expect(result.success).toBe(true);
    });

    it('non-owner non-admin cannot delete on shared model', async () => {
      const db = createMockD1({
        results: new Map([
          ['SELECT', [{ id: 1, owner_id: 'other-user' }]],
        ]),
      });

      await expect(
        sysDelete(TEST_MODEL_SHARED, { id: 1 }, TEST_USER, db)
      ).rejects.toThrow(ForbiddenError);
    });

    it('admin can delete anyone record on shared model', async () => {
      const db = createMockD1({
        results: new Map([
          ['SELECT', [{ id: 1, owner_id: 'other-user' }]],
        ]),
      });

      const result = await sysDelete(
        TEST_MODEL_SHARED,
        { id: 1 },
        TEST_ADMIN,
        db
      );
      expect(result.success).toBe(true);
    });
  });
});

// ── JSON round-trip ──────────────────────────────────────────────

describe('JSON column round-trip', () => {
  it('nested object: create → read returns same structure', async () => {
    const nested = { nested: { deep: true } };
    const createDb = createMockD1({
      results: new Map([
        ['INSERT', [{ id: 1, name: 'test', email: 'test@example.com', metadata: JSON.stringify(nested), owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }]],
      ]),
    });

    const result = await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com', metadata: nested } },
      TEST_USER,
      createDb
    );

    expect((result.data as Record<string, unknown>).metadata).toEqual(nested);
  });

  it('array: create → read returns array', async () => {
    const arr = [1, 2, 3];
    const db = createMockD1({
      results: new Map([
        ['INSERT', [{ id: 1, name: 'test', email: 'test@example.com', metadata: JSON.stringify(arr), owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }]],
      ]),
    });

    const result = await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com', metadata: arr } },
      TEST_USER,
      db
    );

    expect((result.data as Record<string, unknown>).metadata).toEqual([1, 2, 3]);
  });

  it('null: create → read returns null', async () => {
    const db = createMockD1({
      results: new Map([
        ['INSERT', [{ id: 1, name: 'test', email: 'test@example.com', metadata: null, owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }]],
      ]),
    });

    const result = await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com', metadata: null } },
      TEST_USER,
      db
    );

    expect((result.data as Record<string, unknown>).metadata).toBeNull();
  });

  it('already-string JSON: stored as-is, returned as parsed object', async () => {
    const db = createMockD1({
      results: new Map([
        ['INSERT', [{ id: 1, name: 'test', email: 'test@example.com', metadata: '{"key":"val"}', owner_id: 'user-123', created_at: FIXED_TIME, updated_at: FIXED_TIME }]],
      ]),
    });

    const result = await sysCreate(
      TEST_MODEL,
      { data: { name: 'test', email: 'test@example.com', metadata: '{"key":"val"}' } },
      TEST_USER,
      db
    );

    // parseJsonColumns parses the string from DB back into an object
    expect((result.data as Record<string, unknown>).metadata).toEqual({
      key: 'val',
    });
  });
});
