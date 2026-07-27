/**
 * Tests for sysUpdate CRUD operation
 */

import { describe, it, expect } from 'vitest';
import { sysUpdate } from '../src/crud/update';
import { ValidationError, NotFoundError, ForbiddenError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_MODEL_SHARED, TEST_USER, TEST_ADMIN } from './helpers/mock-env';

function createUpdateDb(
  existingRow: Record<string, unknown> | null,
  updatedRow: Record<string, unknown> | null = existingRow
) {
  const results = new Map<string, Record<string, unknown>[]>();
  // SELECT for existence check
  if (existingRow) {
    results.set('SELECT', [existingRow]);
  }
  // UPDATE with RETURNING *
  if (updatedRow) {
    results.set('UPDATE', [updatedRow]);
  }

  return createMockD1({
    results,
    firstReturnsNull: !existingRow,
  });
}

describe('sysUpdate', () => {
  it('updates a record and returns updated data', async () => {
    const existing = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
    const updated = { ...existing, name: 'Alice Updated' };
    const db = createUpdateDb(existing, updated);

    const result = await sysUpdate(
      TEST_MODEL,
      { id: 1, data: { name: 'Alice Updated' } },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
  });

  it('throws ValidationError for missing id', async () => {
    const db = createUpdateDb(null);

    await expect(
      sysUpdate(TEST_MODEL, { id: undefined, data: { name: 'X' } } as any, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('silently strips protected fields and rejects if nothing remains', async () => {
    const db = createUpdateDb({ id: 1, owner_id: 'user-123' });

    // owner_id is a protected field — stripped silently, leaving no fields to update
    await expect(
      sysUpdate(TEST_MODEL, { id: 1, data: { owner_id: 'hacked' } }, TEST_USER, db)
    ).rejects.toThrow('No fields to update');
  });

  it('silently strips id from update data', async () => {
    const db = createUpdateDb({ id: 1, owner_id: 'user-123' });

    await expect(
      sysUpdate(TEST_MODEL, { id: 1, data: { id: 999 } }, TEST_USER, db)
    ).rejects.toThrow('No fields to update');
  });

  it('silently strips created_at from update data', async () => {
    const db = createUpdateDb({ id: 1, owner_id: 'user-123' });

    await expect(
      sysUpdate(TEST_MODEL, { id: 1, data: { created_at: '2024-01-01' } }, TEST_USER, db)
    ).rejects.toThrow('No fields to update');
  });

  it('throws NotFoundError when record does not exist', async () => {
    const db = createUpdateDb(null);

    await expect(
      sysUpdate(TEST_MODEL, { id: 999, data: { name: 'X' } }, TEST_USER, db)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError for empty update data', async () => {
    const db = createUpdateDb({ id: 1, owner_id: 'user-123' });

    await expect(
      sysUpdate(TEST_MODEL, { id: 1, data: {} }, TEST_USER, db)
    ).rejects.toThrow('No fields to update');
  });

  it('accepts legacy flat payload', async () => {
    const existing = { id: 1, name: 'Alice', owner_id: 'user-123' };
    const db = createUpdateDb(existing, { ...existing, name: 'Bob' });

    const result = await sysUpdate(
      TEST_MODEL,
      { id: 1, name: 'Bob' } as any,
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
  });

  it('coerces string inputs', async () => {
    const existing = { id: 1, name: 'Alice', age: 25, owner_id: 'user-123' };
    const db = createUpdateDb(existing, { ...existing, age: 30 });

    await sysUpdate(
      TEST_MODEL,
      { id: 1, data: { age: '30' } },
      TEST_USER,
      db
    );

    // Verify age was coerced to number
    const updateQuery = db._queries.find((q) => q.sql.includes('UPDATE'));
    expect(updateQuery!.binds).toContain(30);
  });

  it('blocks non-owner updates on shared models', async () => {
    const existing = { id: 1, name: 'Public', owner_id: 'other-user' };
    const db = createUpdateDb(existing);

    await expect(
      sysUpdate(TEST_MODEL_SHARED, { id: 1, data: { name: 'Hacked' } }, TEST_USER, db)
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows admin updates on shared models', async () => {
    const existing = { id: 1, name: 'Public', owner_id: 'other-user' };
    const updated = { ...existing, name: 'Admin Updated' };
    const db = createUpdateDb(existing, updated);

    const result = await sysUpdate(
      TEST_MODEL_SHARED,
      { id: 1, data: { name: 'Admin Updated' } },
      TEST_ADMIN,
      db
    );

    expect(result.success).toBe(true);
  });
});

// ── P2: Error boundary tests ───────────────────────────────────────

import { DatabaseError } from '../src/utils/errors';

describe('sysUpdate — error boundaries', () => {
  it('handles UNIQUE constraint violation and extracts field name', async () => {
    const existing = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('SELECT', [existing]);

    const db = createMockD1({ results });
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes('UPDATE')) {
        return {
          ...stmt,
          bind(...args: unknown[]) {
            return {
              ...stmt.bind(...args),
              async first() {
                throw new Error('UNIQUE constraint failed: contacts.email');
              },
            } as D1PreparedStatement;
          },
        } as D1PreparedStatement;
      }
      return stmt;
    };

    try {
      await sysUpdate(TEST_MODEL, { id: 1, data: { email: 'dup@test.com' } }, TEST_USER, db);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toContain('Duplicate value');
    }
  });

  it('wraps unknown DB errors in DatabaseError with generic message', async () => {
    const existing = { id: 1, name: 'Alice', owner_id: 'user-123' };
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('SELECT', [existing]);

    const db = createMockD1({ results });
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes('UPDATE')) {
        return {
          ...stmt,
          bind(...args: unknown[]) {
            return {
              ...stmt.bind(...args),
              async first() {
                throw new Error('SQLITE_INTERNAL: disk I/O error');
              },
            } as D1PreparedStatement;
          },
        } as D1PreparedStatement;
      }
      return stmt;
    };

    try {
      await sysUpdate(TEST_MODEL, { id: 1, data: { name: 'New' } }, TEST_USER, db);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
      expect((err as Error).message).toBe('Database operation failed');
    }
  });

  it('throws NotFoundError when UPDATE RETURNING yields no row (race: deleted between check and update)', async () => {
    const existing = { id: 1, name: 'Alice', owner_id: 'user-123' };
    const results = new Map<string, Record<string, unknown>[]>();
    results.set('SELECT', [existing]);
    // UPDATE returns empty — simulates row deleted between check and update
    results.set('UPDATE', []);

    const db = createMockD1({ results });

    await expect(
      sysUpdate(TEST_MODEL, { id: 1, data: { name: 'New' } }, TEST_USER, db)
    ).rejects.toThrow(NotFoundError);
  });
});
