/**
 * sys_create - Create a new record
 */

import type { ModelProps } from '../types/env';
import type { RpcResponse, UserContext, CreateParams } from '../rpc/types';
import { ValidationError, DatabaseError } from '../utils/errors';
import { buildInsertQuery, parseJsonColumns, stringifyJsonColumns } from '../utils/sql';
import { validateCreateInput, coerceInputTypes, applyAutoDateDefaults } from '../utils/validation';
import { assertForeignKeyOwnership, type FkOwnershipOptions } from './fk-ownership';

/**
 * Create a new record in the model's table
 */
export async function sysCreate(
  model: ModelProps,
  params: CreateParams,
  user: UserContext,
  db: D1Database,
  models?: ModelProps[],
  opts: FkOwnershipOptions = {}
): Promise<RpcResponse> {
  // Validate input — prefer params.data; fall back to params itself for legacy callers
  let rawData: Record<string, unknown> | undefined;
  if (params?.data && typeof params.data === 'object') {
    rawData = params.data;
  } else if (params && typeof params === 'object') {
    console.warn('[Exepad] Deprecated: pass data inside params.data, not as top-level params');
    rawData = params as unknown as Record<string, unknown>;
  }

  if (!rawData || typeof rawData !== 'object') {
    throw new ValidationError('Missing or invalid "data" field');
  }

  // Coerce string types to proper types based on schema (e.g., "123" -> 123)
  const coercedData = coerceInputTypes(model, rawData as Record<string, unknown>);

  // Apply implicit defaults for required JSON columns missing from the payload.
  // Forms often exclude JSON fields that are edited separately (e.g. block editor
  // content), so default them to {} rather than rejecting the create.
  for (const col of model.columns) {
    if (col.type === 'json' && !col.isNullable && col.defaultValue === undefined && !(col.name in coercedData)) {
      coercedData[col.name] = {};
    }
  }

  // Auto-fill NOT NULL creation-timestamp columns the create form doesn't
  // collect (e.g. date_added: ["__TODAY__-14d", ...]) so they don't 400 as a
  // missing required field. See applyAutoDateDefaults / autoDateColumnDefault.
  applyAutoDateDefaults(model, coercedData);

  // Validate data against model schema
  const validationErrors = validateCreateInput(model, coercedData);
  if (validationErrors.length > 0) {
    throw new ValidationError('Validation failed', undefined, { errors: validationErrors });
  }

  // Reject cross-tenant foreign-key references (a row may only reference the
  // caller's own owner-scoped rows; shared/reference models are exempt).
  // Runs on the user-supplied payload BEFORE config defaultValues are applied —
  // an FK column's value here is end-user-controlled (the attack surface),
  // whereas a config default would be the same fixed value for every caller and
  // can never sensibly point at per-user data.
  await assertForeignKeyOwnership(model, coercedData, user, db, models, opts);

  // Apply default values for missing optional fields
  for (const col of model.columns) {
    if (col.defaultValue !== undefined && !(col.name in coercedData)) {
      coercedData[col.name] = col.defaultValue;
    }
  }

  // Prepare record data
  const now = new Date().toISOString();
  const recordData: Record<string, unknown> = {
    ...coercedData,
    owner_id: user.id,
    created_at: now,
    updated_at: now,
  };

  // Stringify JSON columns
  const processedData = stringifyJsonColumns(model, recordData);

  // Build INSERT query with RETURNING * to avoid a separate SELECT (M2)
  const { sql, bindings } = buildInsertQuery(model.name, processedData, { returning: true });

  try {
    // Execute query — RETURNING * gives us the full record in one round-trip
    const created = await db.prepare(sql).bind(...bindings).first();

    if (!created) {
      throw new DatabaseError('Failed to create record');
    }

    // Parse JSON columns in response
    const parsedRecord = parseJsonColumns(model, created as Record<string, unknown>);

    return {
      success: true,
      data: parsedRecord,
    };
  } catch (error) {
    if (error instanceof DatabaseError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown database error';

    // Check for unique constraint violations
    if (message.includes('UNIQUE constraint failed')) {
      const match = message.match(/UNIQUE constraint failed: (\w+)\.(\w+)/);
      const field = match?.[2];
      throw new ValidationError(`Duplicate value for unique field`, field);
    }

    console.error('[sysCreate] Database error:', message);
    throw new DatabaseError('Database operation failed');
  }
}
