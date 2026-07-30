/**
 * Unit tests for Auto-CRUD operations
 */

import { describe, it, expect } from 'vitest';
import {
  buildInsertQuery,
  buildUpdateQuery,
  buildListQuery,
  buildCountQuery,
  buildFilterConditions,
  parseJsonColumns,
  stringifyJsonColumns,
  escapeIdentifier,
} from '../src/utils/sql';
import {
  validateCreateInput,
  validateUpdateInput,
} from '../src/utils/validation';
import type { ModelProps } from '../src/types/env';

// Test model
const testModel: ModelProps = {
  uuid: 'test-model',
  name: 'contacts',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'name', type: 'text' },
    { name: 'email', type: 'text', isUnique: true },
    { name: 'phone', type: 'text', isNullable: true },
    { name: 'age', type: 'integer', isNullable: true },
    { name: 'metadata', type: 'json', isNullable: true },
  ],
};

describe('SQL Utilities', () => {
  describe('escapeIdentifier', () => {
    it('escapes valid identifiers', () => {
      expect(escapeIdentifier('name')).toBe('"name"');
      expect(escapeIdentifier('user_id')).toBe('"user_id"');
      expect(escapeIdentifier('Column1')).toBe('"Column1"');
    });

    it('throws for invalid identifiers', () => {
      expect(() => escapeIdentifier('has space')).toThrow();
      expect(() => escapeIdentifier('has-dash')).toThrow();
      expect(() => escapeIdentifier('123starts')).toThrow();
    });
  });

  describe('buildInsertQuery', () => {
    it('builds correct INSERT statement', () => {
      const data = { name: 'John', email: 'john@example.com' };
      const { sql, bindings } = buildInsertQuery('contacts', data);

      expect(sql).toContain('INSERT INTO "contacts"');
      expect(sql).toContain('"name"');
      expect(sql).toContain('"email"');
      expect(sql).toContain('?, ?');
      expect(bindings).toEqual(['John', 'john@example.com']);
    });

    it('handles multiple columns', () => {
      const data = { name: 'John', email: 'john@example.com', phone: '123', age: 30 };
      const { sql, bindings } = buildInsertQuery('contacts', data);

      expect(bindings.length).toBe(4);
    });
  });

  describe('buildUpdateQuery', () => {
    it('builds correct UPDATE statement', () => {
      const data = { name: 'Jane', email: 'jane@example.com' };
      const { sql, bindings } = buildUpdateQuery('contacts', 'id', 1, 'user-1', data);

      expect(sql).toContain('UPDATE "contacts"');
      expect(sql).toContain('SET "name" = ?');
      expect(sql).toContain('WHERE "id" = ? AND owner_id = ?');
      expect(bindings).toContain('Jane');
      expect(bindings).toContain(1);
      expect(bindings).toContain('user-1');
    });
  });

  describe('buildListQuery', () => {
    it('builds SELECT with pagination', () => {
      const { sql, bindings } = buildListQuery('contacts', {
        userId: 'user-1',
        limit: 10,
        offset: 20,
      });

      expect(sql).toContain('SELECT *');
      expect(sql).toContain('FROM "contacts"');
      expect(sql).toContain('owner_id = ?');
      expect(sql).toContain('LIMIT ? OFFSET ?');
      expect(bindings).toContain('user-1');
      expect(bindings).toContain(10);
      expect(bindings).toContain(20);
    });

    it('builds SELECT with filters', () => {
      const { sql, bindings } = buildListQuery('contacts', {
        userId: 'user-1',
        filters: { name: 'John', age: 30 },
        limit: 50,
        offset: 0,
      });

      expect(sql).toContain('"name" = ?');
      expect(sql).toContain('"age" = ?');
      expect(bindings).toContain('John');
      expect(bindings).toContain(30);
    });

    it('builds SELECT with orderBy', () => {
      const { sql } = buildListQuery('contacts', {
        userId: 'user-1',
        orderBy: { name: 'asc', created_at: 'desc' },
        limit: 50,
        offset: 0,
      });

      expect(sql).toContain('ORDER BY');
      expect(sql).toContain('"name" ASC');
      expect(sql).toContain('"created_at" DESC');
    });

    it('handles operator filters', () => {
      const { sql, bindings } = buildListQuery('contacts', {
        userId: 'user-1',
        filters: { age: { gt: 18, lt: 65 } },
        limit: 50,
        offset: 0,
      });

      expect(sql).toContain('"age" > ?');
      expect(sql).toContain('"age" < ?');
      expect(bindings).toContain(18);
      expect(bindings).toContain(65);
    });

    it('handles array filters (IN clause)', () => {
      const { sql, bindings } = buildListQuery('contacts', {
        userId: 'user-1',
        filters: { name: ['John', 'Jane', 'Bob'] },
        limit: 50,
        offset: 0,
      });

      expect(sql).toContain('"name" IN (?, ?, ?)');
      expect(bindings).toContain('John');
      expect(bindings).toContain('Jane');
      expect(bindings).toContain('Bob');
    });
  });

  describe('buildCountQuery', () => {
    it('builds correct COUNT query', () => {
      const { sql, bindings } = buildCountQuery('contacts', {
        userId: 'user-1',
        filters: { name: 'John' },
      });

      expect(sql).toContain('SELECT COUNT(*) as count');
      expect(sql).toContain('FROM "contacts"');
      expect(sql).toContain('owner_id = ?');
      expect(sql).toContain('"name" = ?');
      expect(bindings).toContain('user-1');
      expect(bindings).toContain('John');
    });
  });

  describe('JSON column handling', () => {
    it('parses JSON columns from database', () => {
      const record = {
        id: 1,
        name: 'John',
        metadata: '{"key":"value","nested":{"a":1}}',
      };

      const parsed = parseJsonColumns(testModel, record);

      expect(parsed.metadata).toEqual({ key: 'value', nested: { a: 1 } });
      expect(parsed.name).toBe('John');
    });

    it('stringifies JSON columns for insert', () => {
      const data = {
        name: 'John',
        metadata: { key: 'value', nested: { a: 1 } },
      };

      const stringified = stringifyJsonColumns(testModel, data);

      expect(typeof stringified.metadata).toBe('string');
      expect(stringified.metadata).toBe('{"key":"value","nested":{"a":1}}');
      expect(stringified.name).toBe('John');
    });
  });

  describe('buildFilterConditions', () => {
    it('handles equality filter', () => {
      const { conditions, bindings } = buildFilterConditions({ name: 'John' });
      expect(conditions).toEqual(['"name" = ?']);
      expect(bindings).toEqual(['John']);
    });

    it('handles null filter', () => {
      const { conditions, bindings } = buildFilterConditions({ deleted_at: null });
      expect(conditions).toEqual(['"deleted_at" IS NULL']);
      expect(bindings).toEqual([]);
    });

    it('handles all 7 operators', () => {
      const { conditions, bindings } = buildFilterConditions({
        a: { gt: 1 },
        b: { gte: 2 },
        c: { lt: 3 },
        d: { lte: 4 },
        e: { ne: 5 },
        f: { like: '%x%' },
        g: { ilike: '%Y%' },
      });
      expect(conditions).toEqual([
        '"a" > ?',
        '"b" >= ?',
        '"c" < ?',
        '"d" <= ?',
        '"e" != ?',
        '"f" LIKE ?',
        'LOWER("g") LIKE LOWER(?)',
      ]);
      expect(bindings).toEqual([1, 2, 3, 4, 5, '%x%', '%Y%']);
    });

    it('throws on unknown operator', () => {
      expect(() => buildFilterConditions({ age: { unknown: 18 } }))
        .toThrow('Unknown filter operator');
    });

    it('handles array filter (IN clause)', () => {
      const { conditions, bindings } = buildFilterConditions({ status: ['a', 'b'] });
      expect(conditions).toEqual(['"status" IN (?, ?)']);
      expect(bindings).toEqual(['a', 'b']);
    });

    it('handles empty array filter as always-false', () => {
      const { conditions, bindings } = buildFilterConditions({ status: [] });
      expect(conditions).toEqual(['1 = 0']);
      expect(bindings).toEqual([]);
    });

    it('throws when array exceeds MAX_FILTER_ARRAY_SIZE', () => {
      const huge = new Array(101).fill('x');
      expect(() => buildFilterConditions({ tags: huge }))
        .toThrow('exceeds maximum size');
    });
  });

  describe('buildInsertQuery — RETURNING', () => {
    it('appends RETURNING * when option is set', () => {
      const { sql } = buildInsertQuery('contacts', { name: 'John' }, { returning: true });
      expect(sql).toContain('RETURNING *');
    });

    it('omits RETURNING by default', () => {
      const { sql } = buildInsertQuery('contacts', { name: 'John' });
      expect(sql).not.toContain('RETURNING');
    });
  });

  describe('buildUpdateQuery — extended', () => {
    it('appends RETURNING * when option is set', () => {
      const { sql } = buildUpdateQuery('contacts', 'id', 1, 'user-1', { name: 'Jane' }, { returning: true });
      expect(sql).toContain('RETURNING *');
    });

    it('omits owner_id filter when userId is undefined (shared scope)', () => {
      const { sql, bindings } = buildUpdateQuery('contacts', 'id', 1, undefined, { name: 'Jane' });
      expect(sql).not.toContain('owner_id');
      expect(sql).toContain('WHERE "id" = ?');
      expect(bindings).toEqual(['Jane', 1]);
    });
  });

  describe('buildListQuery — extended', () => {
    it('excludes soft-deleted records when excludeSoftDeleted is true', () => {
      const { sql } = buildListQuery('contacts', {
        userId: 'user-1',
        excludeSoftDeleted: true,
        limit: 50,
        offset: 0,
      });
      expect(sql).toContain('"deleted_at" IS NULL');
    });

    it('skips soft-delete filter when deleted_at is explicitly in filters', () => {
      const { sql } = buildListQuery('contacts', {
        userId: 'user-1',
        filters: { deleted_at: null },
        excludeSoftDeleted: true,
        limit: 50,
        offset: 0,
      });
      // Should only have one IS NULL from the explicit filter, not a duplicate
      const matches = sql.match(/"deleted_at" IS NULL/g);
      expect(matches).toHaveLength(1);
    });

    it('omits owner_id filter when userId is undefined (shared scope)', () => {
      const { sql, bindings } = buildListQuery('contacts', {
        userId: undefined,
        limit: 10,
        offset: 0,
      });
      expect(sql).not.toContain('owner_id');
      // bindings should only have limit and offset
      expect(bindings).toEqual([10, 0]);
    });
  });

  describe('buildCountQuery — extended', () => {
    it('excludes soft-deleted records when excludeSoftDeleted is true', () => {
      const { sql } = buildCountQuery('contacts', {
        userId: 'user-1',
        excludeSoftDeleted: true,
      });
      expect(sql).toContain('"deleted_at" IS NULL');
    });

    it('omits owner_id filter when userId is undefined (shared scope)', () => {
      const { sql, bindings } = buildCountQuery('contacts', { userId: undefined });
      expect(sql).not.toContain('owner_id');
      expect(bindings).toEqual([]);
    });
  });
});

describe('Validation Utilities', () => {
  describe('validateCreateInput', () => {
    it('returns no errors for valid input', () => {
      const errors = validateCreateInput(testModel, {
        name: 'John',
        email: 'john@example.com',
      });

      expect(errors).toHaveLength(0);
    });

    it('returns error for missing required field', () => {
      const errors = validateCreateInput(testModel, {
        email: 'john@example.com',
        // missing 'name' which is required (not nullable, no default)
      });

      const nameError = errors.find((e) => e.field === 'name');
      expect(nameError).toBeDefined();
      expect(nameError?.message).toContain('missing');
    });

    it('returns error for unknown fields', () => {
      const errors = validateCreateInput(testModel, {
        name: 'John',
        email: 'john@example.com',
        unknown_field: 'value',
      });

      const unknownError = errors.find((e) => e.field === 'unknown_field');
      expect(unknownError).toBeDefined();
      expect(unknownError?.message).toContain('Unknown');
    });

    it('returns error for system-managed fields', () => {
      const errors = validateCreateInput(testModel, {
        name: 'John',
        email: 'john@example.com',
        id: 999,
      });

      const idError = errors.find((e) => e.field === 'id');
      expect(idError).toBeDefined();
      expect(idError?.message).toContain('system-managed');
    });

    it('returns error for wrong type', () => {
      const errors = validateCreateInput(testModel, {
        name: 123, // should be string
        email: 'john@example.com',
      });

      const nameError = errors.find((e) => e.field === 'name');
      expect(nameError).toBeDefined();
      expect(nameError?.message).toContain('string');
    });

    it('allows null for nullable fields', () => {
      const errors = validateCreateInput(testModel, {
        name: 'John',
        email: 'john@example.com',
        phone: null,
      });

      expect(errors).toHaveLength(0);
    });
  });

  describe('validateUpdateInput', () => {
    it('returns no errors for valid partial update', () => {
      const errors = validateUpdateInput(testModel, {
        name: 'Jane',
      });

      expect(errors).toHaveLength(0);
    });

    it('returns error for system-managed fields', () => {
      const errors = validateUpdateInput(testModel, {
        name: 'Jane',
        owner_id: 'hacker',
      });

      const ownerError = errors.find((e) => e.field === 'owner_id');
      expect(ownerError).toBeDefined();
    });

    it('allows empty update (no fields)', () => {
      const errors = validateUpdateInput(testModel, {});
      expect(errors).toHaveLength(0);
    });
  });
});
