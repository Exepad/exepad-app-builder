/**
 * sys_aggregate - Compute aggregations (count, sum, avg, min, max) with optional groupBy
 */

import type { ModelProps } from '../types/env';
import type { RpcResponse, UserContext } from '../rpc/types';
import { ValidationError, DatabaseError } from '../utils/errors';
import { escapeIdentifier, buildFilterConditions } from '../utils/sql';

/** Allowed aggregation functions */
const ALLOWED_FUNCTIONS = ['count', 'sum', 'avg', 'min', 'max'] as const;
type AggFunction = (typeof ALLOWED_FUNCTIONS)[number];

/** Safe alias pattern: alphanumeric + underscores */
const SAFE_ALIAS_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

interface AggregationDef {
  function: string;
  field?: string;
  alias: string;
}

export interface AggregateParams {
  aggregations: AggregationDef[];
  filters?: Record<string, unknown>;
  groupBy?: string[];
  orderBy?: Record<string, 'asc' | 'desc'>;
}

/**
 * Execute aggregation query against a model
 */
export async function sysAggregate(
  model: ModelProps,
  params: AggregateParams | undefined,
  user: UserContext,
  db: D1Database
): Promise<RpcResponse> {
  if (!params?.aggregations || !Array.isArray(params.aggregations) || params.aggregations.length === 0) {
    throw new ValidationError('Missing or empty "aggregations" array');
  }

  const { aggregations, filters = {}, groupBy = [], orderBy = {} } = params;

  // Build valid column set
  const hasSoftDelete = model.softDelete === true;
  const systemCols = ['id', 'owner_id', 'created_at', 'updated_at'];
  if (hasSoftDelete) systemCols.push('deleted_at');
  const validColumns = [
    ...model.columns.map((c) => c.name),
    ...systemCols.filter((sc) => !model.columns.some((c) => c.name === sc)),
  ];

  // Collect aliases for orderBy validation
  const aliases: string[] = [];

  // Validate aggregations
  for (const agg of aggregations) {
    // Validate function
    if (!ALLOWED_FUNCTIONS.includes(agg.function as AggFunction)) {
      throw new ValidationError(
        `Invalid aggregation function '${agg.function}'. Allowed: ${ALLOWED_FUNCTIONS.join(', ')}`
      );
    }

    // Validate alias
    if (!agg.alias || !SAFE_ALIAS_RE.test(agg.alias)) {
      throw new ValidationError(
        `Invalid alias '${agg.alias}'. Must be alphanumeric with underscores only.`
      );
    }
    aliases.push(agg.alias);

    // Validate field (required for non-count functions)
    if (agg.function !== 'count') {
      if (!agg.field) {
        throw new ValidationError(
          `Aggregation function '${agg.function}' requires a "field" parameter`
        );
      }
      if (!validColumns.includes(agg.field)) {
        throw new ValidationError(
          `Invalid field '${agg.field}'. Available columns: ${validColumns.join(', ')}`
        );
      }
    }
  }

  // Validate groupBy fields
  for (const field of groupBy) {
    if (!validColumns.includes(field)) {
      throw new ValidationError(
        `Invalid groupBy field '${field}'. Available columns: ${validColumns.join(', ')}`
      );
    }
  }

  // Validate filter fields
  const filterFields = Object.keys(filters);
  const invalidFilters = filterFields.filter((f) => !validColumns.includes(f));
  if (invalidFilters.length > 0) {
    throw new ValidationError(`Invalid filter fields: ${invalidFilters.join(', ')}`);
  }

  // Validate orderBy — can reference aliases or groupBy fields
  const validOrderByFields = [...aliases, ...groupBy];
  const orderFields = Object.keys(orderBy);
  const invalidOrderFields = orderFields.filter((f) => !validOrderByFields.includes(f));
  if (invalidOrderFields.length > 0) {
    throw new ValidationError(
      `Invalid orderBy fields: ${invalidOrderFields.join(', ')}. Must reference an alias or groupBy field.`
    );
  }

  // Build SQL
  const selectParts: string[] = [];
  const bindings: unknown[] = [];

  // Add groupBy fields to SELECT
  for (const field of groupBy) {
    selectParts.push(escapeIdentifier(field));
  }

  // Add aggregation expressions
  for (const agg of aggregations) {
    const fn = agg.function.toUpperCase();
    if (agg.function === 'count') {
      selectParts.push(`${fn}(*) AS ${escapeIdentifier(agg.alias)}`);
    } else {
      selectParts.push(`${fn}(${escapeIdentifier(agg.field!)}) AS ${escapeIdentifier(agg.alias)}`);
    }
  }

  // WHERE clause
  const whereConditions: string[] = [];

  // Owner scoping
  const scopedUserId = model.ownerScope === 'shared' ? undefined : user.id;
  if (scopedUserId !== undefined) {
    whereConditions.push('owner_id = ?');
    bindings.push(scopedUserId);
  }

  // Soft delete exclusion
  if (hasSoftDelete && !('deleted_at' in filters)) {
    whereConditions.push('"deleted_at" IS NULL');
  }

  // User filters
  const filterResult = buildFilterConditions(filters);
  whereConditions.push(...filterResult.conditions);
  bindings.push(...filterResult.bindings);

  const whereClause = whereConditions.length > 0
    ? `WHERE ${whereConditions.join(' AND ')}`
    : '';

  // GROUP BY clause
  const groupByClause = groupBy.length > 0
    ? `GROUP BY ${groupBy.map(escapeIdentifier).join(', ')}`
    : '';

  // ORDER BY clause
  let orderClause = '';
  const orderParts: string[] = [];
  for (const [field, direction] of Object.entries(orderBy)) {
    const dir = direction.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    // orderBy can reference aliases (which are already escaped identifiers in SELECT)
    // or groupBy fields — both are validated above
    orderParts.push(`${escapeIdentifier(field)} ${dir}`);
  }
  if (orderParts.length > 0) {
    orderClause = `ORDER BY ${orderParts.join(', ')}`;
  }

  const sql = `
    SELECT ${selectParts.join(', ')}
    FROM ${escapeIdentifier(model.name)}
    ${whereClause}
    ${groupByClause}
    ${orderClause}
  `.trim();

  try {
    const result = await db.prepare(sql).bind(...bindings).all();

    if (!result.success) {
      throw new DatabaseError('Failed to execute aggregation query');
    }

    return {
      success: true,
      data: result.results,
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown database error';
    throw new DatabaseError(message);
  }
}
