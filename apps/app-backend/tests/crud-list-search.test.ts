/**
 * Tests for sys_list search functionality (0A-1)
 */

import { describe, it, expect } from 'vitest';
import { sysList } from '../src/crud/list';
import { createMockD1 } from './helpers/mock-d1';
import { TEST_MODEL, TEST_USER } from './helpers/mock-env';

describe('sys_list search', () => {
  it('search with searchFields returns matching rows', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'John', email: 'john@test.com' }],
      results: new Map([
        ['COUNT(*)', [{ count: 1 }]],
      ]),
    });

    const result = await sysList(
      TEST_MODEL,
      { search: 'john', searchFields: ['name', 'email'] },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);

    // Verify the SQL contains the search clause
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery!.sql).toContain('LOWER');
    expect(selectQuery!.sql).toContain('LIKE');
    expect(selectQuery!.sql).toContain('OR');
  });

  it('search without searchFields defaults to all text columns', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'John', email: 'john@test.com' }],
      results: new Map([
        ['COUNT(*)', [{ count: 1 }]],
      ]),
    });

    const result = await sysList(
      TEST_MODEL,
      { search: 'john' },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);

    // Should search name, email, phone (all text columns in TEST_MODEL)
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery!.sql).toContain('"name"');
    expect(selectQuery!.sql).toContain('"email"');
    expect(selectQuery!.sql).toContain('"phone"');
  });

  it('search combines with filters via AND', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'John', email: 'john@test.com', age: 30 }],
      results: new Map([
        ['COUNT(*)', [{ count: 1 }]],
      ]),
    });

    const result = await sysList(
      TEST_MODEL,
      {
        search: 'john',
        searchFields: ['name'],
        filters: { age: 30 },
      },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);

    // Verify both search and filter appear in WHERE clause
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery!.sql).toContain('LIKE');
    expect(selectQuery!.sql).toContain('"age" = ?');
  });

  it('search with empty string is ignored', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'John' }],
      results: new Map([
        ['COUNT(*)', [{ count: 1 }]],
      ]),
    });

    const result = await sysList(
      TEST_MODEL,
      { search: '', searchFields: ['name'] },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);

    // Should NOT contain LIKE clause
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery!.sql).not.toContain('LIKE');
  });

  it('search with invalid searchFields returns error', async () => {
    const db = createMockD1();

    await expect(
      sysList(
        TEST_MODEL,
        { search: 'test', searchFields: ['nonexistent_field'] },
        TEST_USER,
        db
      )
    ).rejects.toThrow('Invalid search fields: nonexistent_field');
  });

  it('search is case-insensitive', async () => {
    const db = createMockD1({
      defaultResult: [],
      results: new Map([
        ['COUNT(*)', [{ count: 0 }]],
      ]),
    });

    await sysList(
      TEST_MODEL,
      { search: 'JOHN', searchFields: ['name'] },
      TEST_USER,
      db
    );

    // Verify LOWER() is used for case-insensitive comparison
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery!.sql).toContain('LOWER(');
  });

  it('search terms are parameterized (no injection)', async () => {
    const db = createMockD1({
      defaultResult: [],
      results: new Map([
        ['COUNT(*)', [{ count: 0 }]],
      ]),
    });

    await sysList(
      TEST_MODEL,
      { search: "'; DROP TABLE contacts; --", searchFields: ['name'] },
      TEST_USER,
      db
    );

    // The SQL should use ? placeholders, not interpolated values
    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery).toBeDefined();
    expect(selectQuery!.sql).not.toContain('DROP TABLE');
    expect(selectQuery!.sql).toContain('LIKE LOWER(?)');
    // The bound value should contain the search term wrapped in %
    expect(selectQuery!.binds).toContain("%'; DROP TABLE contacts; --%");
  });

  it('sys_list with no search param works exactly as before', async () => {
    const db = createMockD1({
      defaultResult: [{ id: 1, name: 'Alice' }],
      results: new Map([
        ['COUNT(*)', [{ count: 1 }]],
      ]),
    });

    const result = await sysList(
      TEST_MODEL,
      { filters: { name: 'Alice' } },
      TEST_USER,
      db
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);

    const selectQuery = db._queries.find((q) => q.sql.includes('SELECT') && !q.sql.includes('COUNT'));
    expect(selectQuery!.sql).not.toContain('LIKE');
  });
});
