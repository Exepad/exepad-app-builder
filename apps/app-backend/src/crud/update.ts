/**
 * sys_update - Update an existing record
 */

import type { ModelProps } from '../types/env';
import type { RpcResponse, UserContext, UpdateParams } from '../rpc/types';
import { ValidationError, NotFoundError, DatabaseError, ForbiddenError } from '../utils/errors';
import { buildUpdateQuery, parseJsonColumns, stringifyJsonColumns } from '../utils/sql';
import { validateUpdateInput, coerceInputTypes } from '../utils/validation';
import { PROTECTED_UPDATE_FIELDS } from '../utils/constants';
import { assertForeignKeyOwnership, type FkOwnershipOptions } from './fk-ownership';
import { assertRowOwnership } from './ownership';

/**
 * Update an existing record
 */
export async function sysUpdate(
  model: ModelProps,
  params: UpdateParams,
  user: UserContext,
  db: D1Database,
  models?: ModelProps[],
  opts: FkOwnershipOptions = {}
): Promise<RpcResponse> {
  // Validate input
  if (params?.id === undefined || params.id === null) {
    throw new ValidationError('Missing "id" parameter');
  }

  // Prefer params.data; fall back to params itself for legacy callers
  let rawData: Record<string, unknown> | undefined;
  if (params?.data && typeof params.data === 'object') {
    rawData = params.data as Record<string, unknown>;
  } else if (params && typeof params === 'object') {
    console.warn('[Exepad] Deprecated: pass data inside params.data, not as top-level params');
    const { id: _id, ...rest } = params as unknown as Record<string, unknown>;
    rawData = rest;
  }

  if (!rawData || typeof rawData !== 'object') {
    throw new ValidationError('Missing or invalid "data" field');
  }

  // Silently strip protected system fields from update payload
  for (const field of PROTECTED_UPDATE_FIELDS) {
    delete (rawData as Record<string, unknown>)[field];
  }

  // Coerce string types to proper types based on schema (e.g., "123" -> 123)
  const coercedData = coerceInputTypes(model, rawData as Record<string, unknown>);

  // Validate data against model schema
  const validationErrors = validateUpdateInput(model, coercedData);
  if (validationErrors.length > 0) {
    throw new ValidationError('Validation failed', undefined, { errors: validationErrors });
  }

  // Reject empty payloads — no point in hitting the DB with SET updated_at only
  if (Object.keys(coercedData).length === 0) {
    throw new ValidationError('No fields to update. Provide at least one non-system field.');
  }

  // Reject cross-tenant foreign-key references for any FK column being changed.
  await assertForeignKeyOwnership(model, coercedData, user, db, models, opts);

  // Enforce row-level write authorization (owner-or-admin for shared scope,
  // existence-scoped-to-owner for user scope). Shared with sysDelete/sysBatch.
  await assertRowOwnership(model, params.id, user, db, 'update');

  // Find primary key column
  const primaryCol = model.columns.find((c) => c.isPrimary)?.name || 'id';
  const isShared = model.ownerScope === 'shared';

  // Prepare update data
  const now = new Date().toISOString();
  const updateData: Record<string, unknown> = {
    ...coercedData,
    updated_at: now,
  };

  // Stringify JSON columns
  const processedData = stringifyJsonColumns(model, updateData);

  // Build UPDATE query with RETURNING * to avoid a separate SELECT
  // For shared scope, omit owner_id from WHERE (authorization was done above)
  const { sql, bindings } = buildUpdateQuery(
    model.name,
    primaryCol,
    params.id,
    isShared ? undefined : user.id,
    processedData,
    { returning: true }
  );

  try {
    // Execute UPDATE with RETURNING * — gives us the full record in one round-trip
    const updated = await db.prepare(sql).bind(...bindings).first();

    if (!updated) {
      // RETURNING * yields no row when the WHERE clause matches nothing
      throw new NotFoundError(model.name, params.id);
    }

    // Parse JSON columns in response
    const parsedRecord = parseJsonColumns(model, updated as Record<string, unknown>);

    return {
      success: true,
      data: parsedRecord,
    };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ValidationError || error instanceof ForbiddenError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown database error';

    // Check for unique constraint violations
    if (message.includes('UNIQUE constraint failed')) {
      const match = message.match(/UNIQUE constraint failed: (\w+)\.(\w+)/);
      const field = match?.[2];
      throw new ValidationError(`Duplicate value for unique field`, field);
    }

    console.error('[sysUpdate] Database error:', message);
    throw new DatabaseError('Database operation failed');
  }
}
