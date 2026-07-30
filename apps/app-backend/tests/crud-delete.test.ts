/**
 * Tests for sysDelete CRUD operation
 */

import { describe, it, expect } from 'vitest';
import { sysDelete } from '../src/crud/delete';
import { ValidationError, NotFoundError, ForbiddenError } from '../src/utils/errors';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_MODEL_SOFT_DELETE, TEST_MODEL_SHARED, TEST_USER, TEST_ADMIN } from './helpers/mock-env';

function createDeleteDb(existingRow: Record<string, unknown> | null) {
  const results = new Map<string, Record<string, unknown>[]>();
  if (existingRow) {
    results.set('SELECT', [existingRow]);
  }

  return createMockD1({
    results,
    firstReturnsNull: !existingRow,
  });
}

describe('sysDelete', () => {
  it('hard deletes a record', async () => {
    const db = createDeleteDb({ id: 1, name: 'Alice', owner_id: 'user-123' });

    const result = await sysDelete(
      TEST_MODEL,
      { id: 1 },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect((result.data as any).deleted).toBe(true);
    expect((result.data as any).id).toBe(1);
    expect((result.data as any).soft).toBe(false);
  });

  it('soft deletes when model has softDelete', async () => {
    const db = createDeleteDb({ id: 1, title: 'Task', owner_id: 'user-123' });

    const result = await sysDelete(
      TEST_MODEL_SOFT_DELETE,
      { id: 1 },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect((result.data as any).soft).toBe(true);

    // Should UPDATE set deleted_at, not DELETE FROM
    const updateQuery = db._queries.find((q) => q.sql.includes('UPDATE'));
    expect(updateQuery).toBeDefined();
    expect(updateQuery!.sql).toContain('deleted_at');
  });

  it('forces hard delete when soft=false even with softDelete model', async () => {
    const db = createDeleteDb({ id: 1, title: 'Task', owner_id: 'user-123' });

    const result = await sysDelete(
      TEST_MODEL_SOFT_DELETE,
      { id: 1, soft: false },
      TEST_USER,
      db
    );

    expect((result.data as any).soft).toBe(false);

    const deleteQuery = db._queries.find((q) => q.sql.includes('DELETE FROM'));
    expect(deleteQuery).toBeDefined();
  });

  it('throws ValidationError for missing id', async () => {
    const db = createDeleteDb(null);

    await expect(
      sysDelete(TEST_MODEL, { id: undefined } as any, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for null id', async () => {
    const db = createDeleteDb(null);

    await expect(
      sysDelete(TEST_MODEL, { id: null } as any, TEST_USER, db)
    ).rejects.toThrow(ValidationError);
  });

  it('throws NotFoundError when record does not exist', async () => {
    const db = createDeleteDb(null);

    await expect(
      sysDelete(TEST_MODEL, { id: 999 }, TEST_USER, db)
    ).rejects.toThrow(NotFoundError);
  });

  it('scopes hard delete by owner_id', async () => {
    const db = createDeleteDb({ id: 1, owner_id: 'user-123' });

    await sysDelete(TEST_MODEL, { id: 1 }, TEST_USER, db);

    const deleteQuery = db._queries.find((q) => q.sql.includes('DELETE FROM'));
    expect(deleteQuery!.sql).toContain('owner_id = ?');
  });

  it('blocks non-owner deletes on shared models', async () => {
    const db = createDeleteDb({ id: 1, owner_id: 'other-user' });

    await expect(
      sysDelete(TEST_MODEL_SHARED, { id: 1 }, TEST_USER, db)
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows admin deletes on shared models', async () => {
    const db = createDeleteDb({ id: 1, owner_id: 'other-user' });

    const result = await sysDelete(
      TEST_MODEL_SHARED,
      { id: 1 },
      TEST_ADMIN,
      db
    );

    expect(result.success).toBe(true);
  });
});
