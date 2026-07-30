/**
 * SQL Query Builders for D1
 */

import type { ModelProps } from '../types/env';
import { VALID_FILTER_OPERATORS, MAX_FILTER_ARRAY_SIZE } from './constants';

/**
 * Escape SQL identifier (table/column name)
 */
export function escapeIdentifier(identifier: string): string {
  // Basic validation - only allow alphanumeric and underscore
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(identifier)) {
    throw new Error(`Invalid identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

/**
 * Build INSERT query with optional RETURNING clause (M2).
 * Using RETURNING * avoids a separate SELECT after INSERT.
 */
export function buildInsertQuery(
  tableName: string,
  data: Record<string, unknown>,
  options?: { returning?: boolean }
): { sql: string; bindings: unknown[] } {
  const columns = Object.keys(data);
  const values = Object.values(data);

  const columnList = columns.map(escapeIdentifier).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  let sql = `INSERT INTO ${escapeIdentifier(tableName)} (${columnList}) VALUES (${placeholders})`;

  if (options?.returning) {
    sql += ' RETURNING *';
  }

  return { sql, bindings: values };
}

/**
 * Build UPDATE query
 */
export function buildUpdateQuery(
  tableName: string,
  primaryKey: string,
  id: string | number,
  userId: string | undefined,
  data: Record<string, unknown>,
  options?: { returning?: boolean }
): { sql: string; bindings: unknown[] } {
  const columns = Object.keys(data);
  const values = Object.values(data);

  const setClause = columns.map((col) => `${escapeIdentifier(col)} = ?`).join(', ');

  const whereClause = userId !== undefined
    ? `WHERE ${escapeIdentifier(primaryKey)} = ? AND owner_id = ?`
    : `WHERE ${escapeIdentifier(primaryKey)} = ?`;

  let sql = `
    UPDATE ${escapeIdentifier(tableName)}
    SET ${setClause}
    ${whereClause}
  `;

  if (options?.returning) {
    sql = sql.trimEnd() + ' RETURNING *';
  }

  const bindings = userId !== undefined
    ? [...values, id, userId]
    : [...values, id];

  return {
    sql: sql.trim(),
    bindings,
  };
}

/**
 * Build WHERE conditions from a filters object.
 * Shared by buildListQuery, buildCountQuery, and buildCursorListQuery.
 *
 * Throws on unknown operators (was silently skipped) and oversized arrays.
 */
export function buildFilterConditions(
  filters: Record<string, unknown>
): { conditions: string[]; bindings: unknown[] } {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  for (const [field, value] of Object.entries(filters)) {
    if (value === null) {
      conditions.push(`${escapeIdentifier(field)} IS NULL`);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        // Empty IN clause → always false
        conditions.push('1 = 0');
      } else if (value.length > MAX_FILTER_ARRAY_SIZE) {
        throw new Error(
          `Filter array for '${field}' exceeds maximum size of ${MAX_FILTER_ARRAY_SIZE} (got ${value.length})`
        );
      } else {
        const placeholders = value.map(() => '?').join(', ');
        conditions.push(`${escapeIdentifier(field)} IN (${placeholders})`);
        bindings.push(...value);
      }
    } else if (typeof value === 'object' && value !== null) {
      const ops = value as Record<string, unknown>;
      for (const [op, opValue] of Object.entries(ops)) {
        switch (op) {
          case 'gt':
            conditions.push(`${escapeIdentifier(field)} > ?`);
            bindings.push(opValue);
            break;
          case 'gte':
            conditions.push(`${escapeIdentifier(field)} >= ?`);
            bindings.push(opValue);
            break;
          case 'lt':
            conditions.push(`${escapeIdentifier(field)} < ?`);
            bindings.push(opValue);
            break;
          case 'lte':
            conditions.push(`${escapeIdentifier(field)} <= ?`);
            bindings.push(opValue);
            break;
          case 'ne':
            conditions.push(`${escapeIdentifier(field)} != ?`);
            bindings.push(opValue);
            break;
          case 'like':
            conditions.push(`${escapeIdentifier(field)} LIKE ?`);
            bindings.push(opValue);
            break;
          case 'ilike':
            conditions.push(`LOWER(${escapeIdentifier(field)}) LIKE LOWER(?)`);
            bindings.push(opValue);
            break;
          default:
            throw new Error(
              `Unknown filter operator '${op}' for field '${field}'. Valid operators: ${VALID_FILTER_OPERATORS.join(', ')}`
            );
        }
      }
    } else {
      conditions.push(`${escapeIdentifier(field)} = ?`);
      bindings.push(value);
    }
  }

  return { conditions, bindings };
}

/**
 * Build search conditions for multi-field LIKE-based text search.
 * Produces an OR group: (LOWER(f1) LIKE LOWER(?) OR LOWER(f2) LIKE LOWER(?))
 */
export function buildSearchConditions(
  search: string,
  searchFields: string[]
): { condition: string; bindings: unknown[] } {
  const term = `%${search}%`;
  const parts = searchFields.map(
    (field) => `LOWER(${escapeIdentifier(field)}) LIKE LOWER(?)`
  );
  const condition = `(${parts.join(' OR ')})`;
  const bindings = searchFields.map(() => term);
  return { condition, bindings };
}

/**
 * List query options
 */
interface ListQueryOptions {
  filters?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
  select?: string[];
  /** When undefined, omits owner_id filter (for shared-scope models) */
  userId?: string;
  /** Auto-exclude soft-deleted records (WHERE deleted_at IS NULL) (M4) */
  excludeSoftDeleted?: boolean;
  /** Pre-built search condition (OR group) to AND with other conditions */
  searchCondition?: { condition: string; bindings: unknown[] };
}

/**
 * Build SELECT query for list operation
 */
export function buildListQuery(
  tableName: string,
  options: ListQueryOptions
): { sql: string; bindings: unknown[] } {
  const { filters = {}, orderBy = {}, limit = 50, offset = 0, select, userId, excludeSoftDeleted, searchCondition } = options;
  const bindings: unknown[] = [];

  // SELECT clause
  const columns = select && select.length > 0
    ? select.map(escapeIdentifier).join(', ')
    : '*';

  // WHERE clause — filter by owner_id only when scoped to user
  const whereConditions: string[] = [];
  if (userId !== undefined) {
    whereConditions.push('owner_id = ?');
    bindings.push(userId);
  }

  // Auto-exclude soft-deleted records unless explicitly filtering by deleted_at (M4)
  if (excludeSoftDeleted && !('deleted_at' in filters)) {
    whereConditions.push('"deleted_at" IS NULL');
  }

  // Add search condition (OR group ANDed with other conditions)
  if (searchCondition) {
    whereConditions.push(searchCondition.condition);
    bindings.push(...searchCondition.bindings);
  }

  // Add filter conditions
  const filterResult = buildFilterConditions(filters);
  whereConditions.push(...filterResult.conditions);
  bindings.push(...filterResult.bindings);

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // ORDER BY clause
  let orderClause = '';
  const orderParts: string[] = [];
  for (const [field, direction] of Object.entries(orderBy)) {
    const dir = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    orderParts.push(`${escapeIdentifier(field)} ${dir}`);
  }
  if (orderParts.length > 0) {
    orderClause = `ORDER BY ${orderParts.join(', ')}`;
  }

  // Build final query
  const sql = `
    SELECT ${columns}
    FROM ${escapeIdentifier(tableName)}
    ${whereClause}
    ${orderClause}
    LIMIT ? OFFSET ?
  `.trim();
  
  bindings.push(limit, offset);
  
  return { sql, bindings };
}

/**
 * Build COUNT query for pagination
 */
export function buildCountQuery(
  tableName: string,
  options: { filters?: Record<string, unknown>; userId?: string; excludeSoftDeleted?: boolean; searchCondition?: { condition: string; bindings: unknown[] } }
): { sql: string; bindings: unknown[] } {
  const { filters = {}, userId, excludeSoftDeleted, searchCondition } = options;
  const bindings: unknown[] = [];

  // WHERE clause — filter by owner_id only when scoped to user
  const whereConditions: string[] = [];
  if (userId !== undefined) {
    whereConditions.push('owner_id = ?');
    bindings.push(userId);
  }

  // Auto-exclude soft-deleted records (M4)
  if (excludeSoftDeleted && !('deleted_at' in filters)) {
    whereConditions.push('"deleted_at" IS NULL');
  }

  // Add search condition (OR group ANDed with other conditions)
  if (searchCondition) {
    whereConditions.push(searchCondition.condition);
    bindings.push(...searchCondition.bindings);
  }

  // Add filter conditions
  const filterResult = buildFilterConditions(filters);
  whereConditions.push(...filterResult.conditions);
  bindings.push(...filterResult.bindings);

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  const sql = `
    SELECT COUNT(*) as count
    FROM ${escapeIdentifier(tableName)}
    ${whereClause}
  `.trim();
  
  return { sql, bindings };
}

/**
 * Cursor-based list query options
 */
interface CursorListQueryOptions {
  filters?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  select?: string[];
  /** When undefined, omits owner_id filter (for shared-scope models) */
  userId?: string;
  excludeSoftDeleted?: boolean;
  /** Pre-built search condition (OR group) to AND with other conditions */
  searchCondition?: { condition: string; bindings: unknown[] };
  /** The cursor field name */
  cursorField: string;
  /** Sort direction */
  cursorDirection: 'asc' | 'desc';
  /** Tie-breaker field (primary key) for composite cursor */
  tieField: string;
  /** Cursor value — undefined on first page (no WHERE cursor filter applied) */
  cursorValue?: unknown;
  /** Tie-breaker value — undefined on first page */
  tieValue?: unknown;
}

/**
 * Build SELECT query for cursor-based (keyset) pagination.
 *
 * Uses a composite cursor: (cursorField, tieField) to handle duplicate values
 * in the cursor field without skipping rows. On the first page (no cursor),
 * the cursor WHERE clause is omitted entirely — no sentinel values needed.
 *
 * Fetches limit+1 rows to detect hasMore.
 */
export function buildCursorListQuery(
  tableName: string,
  options: CursorListQueryOptions
): { sql: string; bindings: unknown[] } {
  const {
    filters = {},
    orderBy = {},
    limit = 50,
    select,
    userId,
    excludeSoftDeleted,
    searchCondition,
    cursorField,
    cursorDirection,
    tieField,
    cursorValue,
    tieValue,
  } = options;
  const bindings: unknown[] = [];

  // SELECT clause — ensure cursor field and tie-breaker are always included
  let columns: string;
  if (select && select.length > 0) {
    const selectSet = new Set(select);
    selectSet.add(cursorField);
    selectSet.add(tieField);
    columns = Array.from(selectSet).map(escapeIdentifier).join(', ');
  } else {
    columns = '*';
  }

  // WHERE clause — filter by owner_id only when scoped to user
  const whereConditions: string[] = [];
  if (userId !== undefined) {
    whereConditions.push('owner_id = ?');
    bindings.push(userId);
  }

  // Soft-delete filter
  if (excludeSoftDeleted && !('deleted_at' in filters)) {
    whereConditions.push('"deleted_at" IS NULL');
  }

  // Add search condition (OR group ANDed with other conditions)
  if (searchCondition) {
    whereConditions.push(searchCondition.condition);
    bindings.push(...searchCondition.bindings);
  }

  // User filters
  const filterResult = buildFilterConditions(filters);
  whereConditions.push(...filterResult.conditions);
  bindings.push(...filterResult.bindings);

  // Composite cursor condition — only applied when we have a cursor (not first page)
  // Uses: (cursorField > ? OR (cursorField = ? AND tieField > ?))  for ASC
  //       (cursorField < ? OR (cursorField = ? AND tieField < ?))  for DESC
  if (cursorValue !== undefined && tieValue !== undefined) {
    const op = cursorDirection === 'asc' ? '>' : '<';
    const cf = escapeIdentifier(cursorField);
    const tf = escapeIdentifier(tieField);

    if (cursorField === tieField) {
      // Cursor field IS the primary key — simple comparison, no tie-breaker needed
      whereConditions.push(`${cf} ${op} ?`);
      bindings.push(cursorValue);
    } else {
      whereConditions.push(
        `(${cf} ${op} ? OR (${cf} = ? AND ${tf} ${op} ?))`
      );
      bindings.push(cursorValue, cursorValue, tieValue);
    }
  }

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // ORDER BY — cursor field first, tie-breaker second, then additional fields
  const orderParts: string[] = [];
  const dir = cursorDirection === 'desc' ? 'DESC' : 'ASC';
  orderParts.push(`${escapeIdentifier(cursorField)} ${dir}`);
  if (cursorField !== tieField) {
    orderParts.push(`${escapeIdentifier(tieField)} ${dir}`);
  }
  for (const [field, direction] of Object.entries(orderBy)) {
    if (field !== cursorField && field !== tieField) {
      const d = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
      orderParts.push(`${escapeIdentifier(field)} ${d}`);
    }
  }
  const orderClause = `ORDER BY ${orderParts.join(', ')}`;

  // Fetch one extra to detect hasMore
  const sql = `
    SELECT ${columns}
    FROM ${escapeIdentifier(tableName)}
    ${whereClause}
    ${orderClause}
    LIMIT ?
  `.trim();

  bindings.push(limit + 1);

  return { sql, bindings };
}

/**
 * Parse JSON columns from database result
 */
export function parseJsonColumns(
  model: ModelProps,
  record: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...record };
  
  for (const column of model.columns) {
    if (column.type === 'json' && column.name in result) {
      const value = result[column.name];
      if (typeof value === 'string') {
        try {
          result[column.name] = JSON.parse(value);
        } catch {
          // Keep as string if parsing fails
        }
      }
    }
  }
  
  return result;
}

/**
 * Stringify JSON columns for database insert/update
 */
export function stringifyJsonColumns(
  model: ModelProps,
  data: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...data };
  
  for (const column of model.columns) {
    if (column.type === 'json' && column.name in result) {
      const value = result[column.name];
      if (value !== null && value !== undefined && typeof value !== 'string') {
        result[column.name] = JSON.stringify(value);
      }
    }
  }
  
  return result;
}
