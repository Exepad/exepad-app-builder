/**
 * Extended tests for SQL utilities
 * Covers: buildFilterConditions, buildCountQuery, parseJsonColumns, stringifyJsonColumns
 */

import { describe, it, expect } from 'vitest';
import {
  buildFilterConditions,
  buildCountQuery,
  parseJsonColumns,
  stringifyJsonColumns,
} from '../src/utils/sql';
import type { ModelProps } from '../src/types/env';

const jsonModel: ModelProps = {
  uuid: 'json-model',
  name: 'items',
  columns: [
    { name: 'id', type: 'integer', isPrimary: true },
    { name: 'title', type: 'text' },
    { name: 'metadata', type: 'json', isNullable: true },
    { name: 'tags', type: 'json', isNullable: true },
  ],
};

describe('buildFilterConditions', () => {
  it('returns empty for no filters', () => {
    const { conditions, bindings } = buildFilterConditions({});
    expect(conditions).toHaveLength(0);
    expect(bindings).toHaveLength(0);
  });

  it('handles simple equality', () => {
    const { conditions, bindings } = buildFilterConditions({ name: 'John' });
    expect(conditions).toEqual(['"name" = ?']);
    expect(bindings).toEqual(['John']);
  });

  it('handles null value as IS NULL', () => {
    const { conditions, bindings } = buildFilterConditions({ deleted_at: null });
    expect(conditions).toEqual(['"deleted_at" IS NULL']);
    expect(bindings).toHaveLength(0);
  });

  it('handles array values as IN clause', () => {
    const { conditions, bindings } = buildFilterConditions({ status: ['active', 'pending'] });
    expect(conditions).toEqual(['"status" IN (?, ?)']);
    expect(bindings).toEqual(['active', 'pending']);
  });

  it('handles empty array as always-false', () => {
    const { conditions } = buildFilterConditions({ status: [] });
    expect(conditions).toEqual(['1 = 0']);
  });

  it('throws for oversized arrays', () => {
    const bigArray = Array.from({ length: 101 }, (_, i) => i);
    expect(() => buildFilterConditions({ ids: bigArray })).toThrow('exceeds maximum size');
  });

  it('handles gt operator', () => {
    const { conditions, bindings } = buildFilterConditions({ age: { gt: 18 } });
    expect(conditions).toEqual(['"age" > ?']);
    expect(bindings).toEqual([18]);
  });

  it('handles gte operator', () => {
    const { conditions, bindings } = buildFilterConditions({ age: { gte: 18 } });
    expect(conditions).toEqual(['"age" >= ?']);
    expect(bindings).toEqual([18]);
  });

  it('handles lt operator', () => {
    const { conditions, bindings } = buildFilterConditions({ age: { lt: 65 } });
    expect(conditions).toEqual(['"age" < ?']);
    expect(bindings).toEqual([65]);
  });

  it('handles lte operator', () => {
    const { conditions, bindings } = buildFilterConditions({ age: { lte: 65 } });
    expect(conditions).toEqual(['"age" <= ?']);
    expect(bindings).toEqual([65]);
  });

  it('handles ne operator', () => {
    const { conditions, bindings } = buildFilterConditions({ status: { ne: 'deleted' } });
    expect(conditions).toEqual(['"status" != ?']);
    expect(bindings).toEqual(['deleted']);
  });

  it('handles like operator', () => {
    const { conditions, bindings } = buildFilterConditions({ name: { like: '%John%' } });
    expect(conditions).toEqual(['"name" LIKE ?']);
    expect(bindings).toEqual(['%John%']);
  });

  it('handles ilike operator (case-insensitive)', () => {
    const { conditions, bindings } = buildFilterConditions({ name: { ilike: '%john%' } });
    expect(conditions).toEqual(['LOWER("name") LIKE LOWER(?)']);
    expect(bindings).toEqual(['%john%']);
  });

  it('throws for unknown operators', () => {
    expect(() => buildFilterConditions({ age: { regex: '.*' } })).toThrow('Unknown filter operator');
  });

  it('handles multiple operators on same field', () => {
    const { conditions, bindings } = buildFilterConditions({ age: { gt: 18, lt: 65 } });
    expect(conditions).toHaveLength(2);
    expect(conditions[0]).toBe('"age" > ?');
    expect(conditions[1]).toBe('"age" < ?');
    expect(bindings).toEqual([18, 65]);
  });

  it('handles multiple fields', () => {
    const { conditions, bindings } = buildFilterConditions({ name: 'John', age: 30 });
    expect(conditions).toHaveLength(2);
    expect(bindings).toEqual(['John', 30]);
  });
});

describe('buildCountQuery', () => {
  it('builds basic count', () => {
    const { sql, bindings } = buildCountQuery('contacts', {});
    expect(sql).toContain('SELECT COUNT(*) as count');
    expect(sql).toContain('FROM "contacts"');
    expect(bindings).toHaveLength(0);
  });

  it('includes owner_id filter when userId provided', () => {
    const { sql, bindings } = buildCountQuery('contacts', { userId: 'user-1' });
    expect(sql).toContain('owner_id = ?');
    expect(bindings).toContain('user-1');
  });

  it('excludes soft-deleted records when flag set', () => {
    const { sql } = buildCountQuery('tasks', { excludeSoftDeleted: true });
    expect(sql).toContain('"deleted_at" IS NULL');
  });

  it('does not add soft-delete filter when deleted_at is explicitly filtered', () => {
    const { sql } = buildCountQuery('tasks', {
      excludeSoftDeleted: true,
      filters: { deleted_at: null },
    });
    // Should only have IS NULL from the filter, not a double condition
    const nullCount = (sql.match(/IS NULL/g) || []).length;
    expect(nullCount).toBe(1);
  });

  it('combines filters with owner_id', () => {
    const { sql, bindings } = buildCountQuery('contacts', {
      userId: 'user-1',
      filters: { status: 'active' },
    });
    expect(sql).toContain('owner_id = ?');
    expect(sql).toContain('"status" = ?');
    expect(bindings).toEqual(['user-1', 'active']);
  });
});

describe('parseJsonColumns', () => {
  it('parses valid JSON strings', () => {
    const record = { id: 1, title: 'Item', metadata: '{"key":"value"}' };
    const result = parseJsonColumns(jsonModel, record);
    expect(result.metadata).toEqual({ key: 'value' });
  });

  it('does not touch non-JSON columns', () => {
    const record = { id: 1, title: 'Item', metadata: '{"a":1}' };
    const result = parseJsonColumns(jsonModel, record);
    expect(result.title).toBe('Item');
    expect(result.id).toBe(1);
  });

  it('keeps invalid JSON as string', () => {
    const record = { id: 1, title: 'Item', metadata: 'not json' };
    const result = parseJsonColumns(jsonModel, record);
    expect(result.metadata).toBe('not json');
  });

  it('handles null values in JSON columns', () => {
    const record = { id: 1, title: 'Item', metadata: null };
    const result = parseJsonColumns(jsonModel, record);
    expect(result.metadata).toBeNull();
  });

  it('handles already-parsed values (non-string)', () => {
    const record = { id: 1, title: 'Item', metadata: { already: 'parsed' } };
    const result = parseJsonColumns(jsonModel, record);
    expect(result.metadata).toEqual({ already: 'parsed' });
  });

  it('parses JSON arrays', () => {
    const record = { id: 1, title: 'Item', tags: '["a","b","c"]' };
    const result = parseJsonColumns(jsonModel, record);
    expect(result.tags).toEqual(['a', 'b', 'c']);
  });

  it('does not modify the original record', () => {
    const record = { id: 1, title: 'Item', metadata: '{"a":1}' };
    parseJsonColumns(jsonModel, record);
    expect(record.metadata).toBe('{"a":1}');
  });
});

describe('stringifyJsonColumns', () => {
  it('stringifies object values', () => {
    const data = { title: 'Item', metadata: { key: 'value' } };
    const result = stringifyJsonColumns(jsonModel, data);
    expect(result.metadata).toBe('{"key":"value"}');
  });

  it('stringifies array values', () => {
    const data = { title: 'Item', tags: ['a', 'b'] };
    const result = stringifyJsonColumns(jsonModel, data);
    expect(result.tags).toBe('["a","b"]');
  });

  it('does not touch string values in JSON columns', () => {
    const data = { title: 'Item', metadata: 'already a string' };
    const result = stringifyJsonColumns(jsonModel, data);
    expect(result.metadata).toBe('already a string');
  });

  it('does not touch null values', () => {
    const data = { title: 'Item', metadata: null };
    const result = stringifyJsonColumns(jsonModel, data);
    expect(result.metadata).toBeNull();
  });

  it('does not touch undefined values', () => {
    const data = { title: 'Item', metadata: undefined };
    const result = stringifyJsonColumns(jsonModel, data);
    expect(result.metadata).toBeUndefined();
  });

  it('does not touch non-JSON columns', () => {
    const data = { title: 'Item', metadata: { a: 1 } };
    const result = stringifyJsonColumns(jsonModel, data);
    expect(result.title).toBe('Item');
  });

  it('does not modify the original data', () => {
    const data = { title: 'Item', metadata: { a: 1 } };
    stringifyJsonColumns(jsonModel, data);
    expect(data.metadata).toEqual({ a: 1 });
  });
});
