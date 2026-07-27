/**
 * Tests for sysRead CRUD operation
 */

import { describe, it, expect } from 'vitest';
import { sysRead } from '../src/crud/read';
import { ValidationError, NotFoundError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_MODEL_SHARED, TEST_USER } from './helpers/mock-env';

function createDb(firstResult: Record<string, unknown> | null = null) {
  return createMockD1({
    results: firstResult
      ? new Map([['SELECT', [firstResult]]])
      : undefined,
    firstReturnsNull: firstResult === null,
  });
}

describe('sysRead', () => {
  it('reads a record by id', async () => {
    const row = { id: 1, name: 'Alice', email: 'a@b.com', owner_id: 'user-123' };
    const db = createDb(row);

    const result = await sysRead(TEST_MODEL, { id: 1 }, TEST_USER, db);

    expect(result.success).toBe(true);
    expect(result.data).toEqual(row);
  });

  it('scopes query by owner_id for user-scoped models', async () => {
    const db = createDb({ id: 1, name: 'Alice', owner_id: 'user-123' });

    await sysRead(TEST_MODEL, { id: 1 }, TEST_USER, db);

    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT'));
    expect(selectQuery!.sql).toContain('owner_id = ?');
    expect(selectQuery!.binds).toContain('user-123');
  });

  it('does not scope by owner_id for shared models', async () => {
    const db = createDb({ id: 1, name: 'Public', owner_id: 'other-user' });

    await sysRead(TEST_MODEL_SHARED, { id: 1 }, TEST_USER, db);

    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT'));
    expect(selectQuery!.sql).not.toContain('owner_id = ?');
    expect(selectQuery!.binds).not.toContain('user-123');
  });

  it('throws NotFoundError when record is not found', async () => {
    const db = createDb(null);

    await expect(
      sysRead(TEST_MODEL, { id: 999 }, TEST_USER, db)
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError for missing id', async () => {
    const db = createDb();

    await expect(
      sysRead(TEST_MODEL, { id: undefined } as any, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for null id', async () => {
    const db = createDb();

    await expect(
      sysRead(TEST_MODEL, { id: null } as any, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('parses JSON columns in result', async () => {
    const row = { id: 1, name: 'Alice', email: 'a@b.com', metadata: '{"key":"value"}', owner_id: 'user-123' };
    const db = createDb(row);

    const result = await sysRead(TEST_MODEL, { id: 1 }, TEST_USER, db);

    expect((result.data as any).metadata).toEqual({ key: 'value' });
  });

  it('handles string id', async () => {
    const db = createDb({ id: 'abc', name: 'Alice', owner_id: 'user-123' });

    await sysRead(TEST_MODEL, { id: 'abc' }, TEST_USER, db);

    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT'));
    expect(selectQuery!.binds).toContain('abc');
  });
});
