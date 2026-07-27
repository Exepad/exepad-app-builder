/**
 * Tests for sysCreate CRUD operation
 */

import { describe, it, expect } from 'vitest';
import { sysCreate } from '../src/crud/create';
import { ValidationError, DatabaseError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_USER } from './helpers/mock-env';
import type { ModelProps } from '../src/types/env';

function createDb(firstResult: Record<string, unknown> | null = null) {
  return createMockD1({
    results: firstResult
      ? new Map([['INSERT INTO', [firstResult]]])
      : undefined,
    firstReturnsNull: firstResult === null,
  });
}

describe('sysCreate', () => {
  it('creates a record with correct data', async () => {
    const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
    const db = createDb(row);

    const result = await sysCreate(
      TEST_MODEL,
      { data: { name: 'Alice', email: 'a@b.com' } },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual(row);
  });

  it('sets owner_id from user context', async () => {
    const db = createDb({ id: 1, name: 'A', email: 'a@b.com', owner_id: 'user-123' });

    await sysCreate(TEST_MODEL, { data: { name: 'A', email: 'a@b.com' } }, TEST_USER, db);

    const queries = db._queries;
    const insertQuery = queries.find((q) => q.sql.includes('INSERT INTO'));
    expect(insertQuery).toBeDefined();
    expect(insertQuery!.binds).toContain('user-123');
  });

  it('includes created_at and updated_at timestamps', async () => {
    const db = createDb({ id: 1, name: 'A', email: 'a@b.com', owner_id: 'user-123' });

    await sysCreate(TEST_MODEL, { data: { name: 'A', email: 'a@b.com' } }, TEST_USER, db);

    const queries = db._queries;
    const insertQuery = queries.find((q) => q.sql.includes('INSERT INTO'));
    // Should have ISO timestamps in binds
    const isoTimestamps = insertQuery!.binds.filter(
      (b) => typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(b)
    );
    expect(isoTimestamps.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts legacy flat payload format', async () => {
    const db = createDb({ id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' });

    // Legacy: params itself is the data, not wrapped in {data: ...}
    const result = await sysCreate(
      TEST_MODEL,
      { name: 'Alice', email: 'a@b.com' } as any,
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
  });

  it('throws ValidationError for missing required fields', async () => {
    const db = createDb();

    await expect(
      sysCreate(TEST_MODEL, { data: { email: 'a@b.com' } }, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for missing data field', async () => {
    const db = createDb();

    await expect(
      sysCreate(TEST_MODEL, undefined as any, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('coerces string inputs to proper types', async () => {
    const db = createDb({ id: 1, name: 'A', email: 'a@b.com', age: 25, owner_id: 'user-123' });

    await sysCreate(
      TEST_MODEL,
      { data: { name: 'A', email: 'a@b.com', age: '25' } },
      TEST_USER,
      db
    );

    // The coerced value 25 (number) should be in the binds
    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT INTO'));
    expect(insertQuery!.binds).toContain(25);
  });

  it('stringifies JSON columns', async () => {
    const db = createDb({ id: 1, name: 'A', email: 'a@b.com', metadata: '{"k":"v"}', owner_id: 'user-123' });

    await sysCreate(
      TEST_MODEL,
      { data: { name: 'A', email: 'a@b.com', metadata: { k: 'v' } } },
      TEST_USER,
      db
    );

    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT INTO'));
    expect(insertQuery!.binds).toContain('{"k":"v"}');
  });

  it('uses RETURNING * in the INSERT query', async () => {
    const db = createDb({ id: 1, name: 'A', email: 'a@b.com', owner_id: 'user-123' });

    await sysCreate(TEST_MODEL, { data: { name: 'A', email: 'a@b.com' } }, TEST_USER, db);

    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT INTO'));
    expect(insertQuery!.sql).toContain('RETURNING *');
  });

  it('throws DatabaseError when INSERT returns null', async () => {
    const db = createDb(null);

    await expect(
      sysCreate(TEST_MODEL, { data: { name: 'A', email: 'a@b.com' } }, TEST_USER, db)
    ).rejects.toThrow(DatabaseError);
  });

  it('applies default values for missing optional fields', async () => {
    const modelWithDefault = {
      ...TEST_MODEL,
      columns: [
        ...TEST_MODEL.columns,
        { name: 'status', type: 'text' as const, defaultValue: 'active', isNullable: true },
      ],
    };
    const db = createDb({ id: 1, name: 'A', email: 'a@b.com', status: 'active', owner_id: 'user-123' });

    await sysCreate(
      modelWithDefault,
      { data: { name: 'A', email: 'a@b.com' } },
      TEST_USER,
      db
    );

    const insertQuery = db._queries.find((q) => q.sql.includes('INSERT INTO'));
    expect(insertQuery!.binds).toContain('active');
  });
});

// ── P2: Error boundary tests ───────────────────────────────────────

describe('sysCreate — error boundaries', () => {
  it('handles UNIQUE constraint violation and extracts field name', async () => {
    const db = createMockD1();
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes('INSERT INTO')) {
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
      await sysCreate(TEST_MODEL, { data: { name: 'A', email: 'dup@test.com' } }, TEST_USER, db);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ValidationError);
      expect((err as ValidationError).message).toContain('Duplicate value');
    }
  });

  it('wraps unknown DB errors in DatabaseError with generic message', async () => {
    const db = createMockD1();
    const originalPrepare = db.prepare.bind(db);
    db.prepare = (sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes('INSERT INTO')) {
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
      await sysCreate(TEST_MODEL, { data: { name: 'A', email: 'a@b.com' } }, TEST_USER, db);
      expect.unreachable('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseError);
      // Generic message — should NOT leak internal DB error
      expect((err as Error).message).toBe('Database operation failed');
    }
  });

  it('rejects when params is a primitive', async () => {
    const db = createDb();

    await expect(
      sysCreate(TEST_MODEL, 'not an object' as any, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  // Regression: a NOT NULL "date_added" column seeded with relative-date tokens
  // but never surfaced as a create-form field must NOT 400; it defaults to today.
  it('auto-fills a NOT NULL relative-date-token column omitted by the form', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // snake_case enum_values mirrors the real generated-app schema drift.
    const model = {
      uuid: 'livestock',
      name: 'livestock',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'common_name', type: 'text' },
        {
          name: 'date_added',
          type: 'text',
          enum_values: ['__TODAY__-14d', '__TODAY__-30d', '__TODAY__-45d'],
        },
      ],
    } as unknown as ModelProps;
    const db = createDb({
      id: 1,
      common_name: 'Clownfish',
      date_added: today,
      owner_id: 'user-123',
    });

    const result = await sysCreate(model, { data: { common_name: 'Clownfish' } }, TEST_USER, db);

    expect(result.success).toBe(true);
    const insert = db._queries.find((q) => q.sql.includes('INSERT INTO'));
    expect(insert).toBeDefined();
    expect(insert!.binds).toContain(today); // date_added auto-filled with today
  });

  it('uses a full ISO timestamp for a __NOW__-based auto column', async () => {
    const model = {
      uuid: 'events',
      name: 'events',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'label', type: 'text' },
        { name: 'logged_at', type: 'text', enumValues: ['__NOW__-2h', '__NOW__'] },
      ],
    } as unknown as ModelProps;
    const db = createDb({ id: 1, label: 'x', logged_at: '2026-07-12T00:00:00.000Z', owner_id: 'user-123' });

    await sysCreate(model, { data: { label: 'x' } }, TEST_USER, db);

    const insert = db._queries.find((q) => q.sql.includes('INSERT INTO'));
    const hasIsoTs = insert!.binds.some(
      (b) => typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(b) && b !== undefined
    );
    expect(hasIsoTs).toBe(true);
  });

  it('still rejects a genuinely-missing required field (no auto-date signal)', async () => {
    const model = {
      uuid: 'strict2',
      name: 'strict2',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'title', type: 'text' }, // NOT NULL, no default, no token vocabulary
      ],
    } as unknown as ModelProps;
    const db = createDb(null);

    await expect(sysCreate(model, { data: {} }, TEST_USER, db)).rejects.toThrow(ValidationError);
  });

  it('does NOT auto-fill a FUTURE-dated (user-scheduled) column — still rejects', async () => {
    // A reservation_date the form failed to collect must surface as a 400, not be
    // silently stamped "today" (which would book the wrong day).
    const model = {
      uuid: 'reservations',
      name: 'reservations',
      columns: [
        { name: 'id', type: 'integer', isPrimary: true },
        { name: 'guest', type: 'text' },
        {
          name: 'reservation_date',
          type: 'text',
          enumValues: ['__TODAY__+3d', '__TODAY__+7d', '__TODAY__+14d'],
        },
      ],
    } as unknown as ModelProps;
    const db = createDb(null);

    await expect(
      sysCreate(model, { data: { guest: 'Ada' } }, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });
});
