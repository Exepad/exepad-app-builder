/**
 * sys_upsert - Insert or update a record (INSERT ... ON CONFLICT DO UPDATE)
 *
 * Semantics: if a row with the given primary-key value already exists (and
 * belongs to the current user / is in shared scope), it is updated in-place.
 * Otherwise a new row is created.  The caller sends `{ data: { ... } }` —
 * the primary-key field **must** be present inside `data`.
 */

import type { ModelProps } from '../types/env';
import type { RpcResponse, UserContext, CreateParams } from '../rpc/types';
import { ValidationError, DatabaseError, ForbiddenError } from '../utils/errors';
import { escapeIdentifier, parseJsonColumns, stringifyJsonColumns } from '../utils/sql';
import { validateCreateInput, coerceInputTypes, applyAutoDateDefaults } from '../utils/validation';
import { assertForeignKeyOwnership, type FkOwnershipOptions } from './fk-ownership';

/**
 * Upsert a record: INSERT ... ON CONFLICT(pk) DO UPDATE SET ...
 */
export async function sysUpsert(
  model: ModelProps,
  params: CreateParams,
  user: UserContext,
  db: D1Database,
  models?: ModelProps[],
  opts: FkOwnershipOptions = {}
): Promise<RpcResponse> {
  // Prefer params.data; fall back to params itself for legacy callers
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

  // Coerce string types to proper types based on schema
  const coercedData = coerceInputTypes(model, rawData as Record<string, unknown>);

  // An upsert may insert a new row, so fill auto-managed creation-timestamp
  // columns the form omits (parity with sysCreate).
  applyAutoDateDefaults(model, coercedData);

  // Validate using create-level validation (all required fields must be present
  // because we might be inserting a new row)
  const validationErrors = validateCreateInput(model, coercedData);
  if (validationErrors.length > 0) {
    throw new ValidationError('Validation failed', undefined, { errors: validationErrors });
  }

  // Apply default values for missing optional fields
  for (const col of model.columns) {
    if (col.defaultValue !== undefined && !(col.name in coercedData)) {
      coercedData[col.name] = col.defaultValue;
    }
  }

  // Reject cross-tenant foreign-key references.
  await assertForeignKeyOwnership(model, coercedData, user, db, models, opts);

  // Determine the primary key column
  const primaryCol = model.columns.find((c) => c.isPrimary)?.name || 'id';

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

  // Build INSERT ... ON CONFLICT(pk) DO UPDATE SET ... RETURNING *
  const columns = Object.keys(processedData);
  const values = Object.values(processedData);

  const columnList = columns.map(escapeIdentifier).join(', ');
  const placeholders = columns.map(() => '?').join(', ');

  // On conflict, update all non-system columns + updated_at
  const updateCols = columns.filter(
    (c) => c !== primaryCol && c !== 'owner_id' && c !== 'created_at'
  );
  const updateSet = updateCols
    .map((c) => `${escapeIdentifier(c)} = excluded.${escapeIdentifier(c)}`)
    .join(', ');

  // SECURITY: gate the ON CONFLICT DO UPDATE on ownership so a caller can only
  // overwrite a row they are actually allowed to update. Without this, anyone
  // who knows/guesses an existing primary-key value clobbers another tenant's
  // row, because ON CONFLICT DO UPDATE ignores owner_id (it is excluded from the
  // SET list, so it stays put — but the *other* columns get overwritten anyway).
  // Mirror sysUpdate's authorization:
  //   - user scope:        only the owner may update (existing.owner_id == caller)
  //   - shared, non-admin: only the owner may update
  //   - shared, admin:     no restriction (admin may update any row)
  // `excluded.owner_id` is always the caller's id (we set recordData.owner_id =
  // user.id above), so the guard is parameter-free and race-free: when it fails
  // SQLite suppresses the conflict (DO NOTHING), RETURNING yields no row, and we
  // translate that into a ForbiddenError below.
  const tbl = escapeIdentifier(model.name);
  const isShared = model.ownerScope === 'shared';
  const isAdmin = user.roles.includes('admin');
  const ownershipGuard =
    isShared && isAdmin
      ? ''
      : ` WHERE ${tbl}.${escapeIdentifier('owner_id')} = excluded.${escapeIdentifier('owner_id')}`;

  const sql =
    `INSERT INTO ${tbl} (${columnList}) VALUES (${placeholders}) ` +
    `ON CONFLICT(${escapeIdentifier(primaryCol)}) DO UPDATE SET ${updateSet}${ownershipGuard} ` +
    `RETURNING *`;

  try {
    const row = await db.prepare(sql).bind(...values).first();

    if (!row) {
      // No row inserted or updated. Either the ownership guard blocked a
      // conflict-update (the PK belongs to another tenant) or a genuine write
      // failure. Disambiguate so the caller gets the right error instead of a
      // generic 500 that masks a cross-tenant write attempt.
      const pkValue = (processedData as Record<string, unknown>)[primaryCol];
      if (pkValue !== undefined && pkValue !== null) {
        const existsSql = `SELECT owner_id FROM ${tbl} WHERE ${escapeIdentifier(primaryCol)} = ?`;
        const existing = await db
          .prepare(existsSql)
          .bind(pkValue)
          .first<{ owner_id: string }>();
        if (existing && !(isShared && isAdmin) && existing.owner_id !== user.id) {
          throw new ForbiddenError(
            'Only the record owner or an admin can update this record'
          );
        }
      }
      throw new DatabaseError('Failed to upsert record');
    }

    const parsedRecord = parseJsonColumns(model, row as Record<string, unknown>);

    return {
      success: true,
      data: parsedRecord,
    };
  } catch (error) {
    if (
      error instanceof DatabaseError ||
      error instanceof ValidationError ||
      error instanceof ForbiddenError
    ) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown database error';
    console.error('[sysUpsert] Database error:', message);
    throw new DatabaseError('Database operation failed');
  }
}
