/**
 * sys_batch - Execute multiple CRUD operations atomically via D1 batch
 *
 * All statements run in a single transaction. If any fails, all are rolled back.
 */

import type { ModelProps, InjectedProps } from '../types/env';
import type { RpcResponse, UserContext } from '../rpc/types';
import { ValidationError, DatabaseError, ForbiddenError } from '../utils/errors';
import { buildInsertQuery, buildUpdateQuery, escapeIdentifier, stringifyJsonColumns, parseJsonColumns } from '../utils/sql';
import {
  validateCreateInput,
  validateUpdateInput,
  coerceInputTypes,
  applyAutoDateDefaults,
} from '../utils/validation';
import { PROTECTED_UPDATE_FIELDS } from '../utils/constants';
import { findModel, checkAuth } from '../rpc/router';
import { hasScope, buildCrudScope } from '../auth/api-keys';
import { assertForeignKeyOwnership } from './fk-ownership';
import { assertRowOwnership } from './ownership';

/** Maximum operations per batch */
const MAX_BATCH_OPS = 50;

/** Allowed methods inside a batch (write operations only) */
const BATCH_ALLOWED_METHODS = ['sys_create', 'sys_update', 'sys_delete'] as const;
type BatchMethod = (typeof BATCH_ALLOWED_METHODS)[number];

interface BatchOperation {
  method: string;
  model: string;
  params: Record<string, unknown>;
}

export interface BatchParams {
  operations: BatchOperation[];
}

interface PreparedStatement {
  sql: string;
  bindings: unknown[];
  method: BatchMethod;
  model: ModelProps;
  modelName: string;
}

/**
 * Execute a batch of CRUD operations atomically
 */
export async function sysBatch(
  params: BatchParams | undefined,
  user: UserContext,
  config: InjectedProps,
  db: D1Database
): Promise<RpcResponse> {
  if (!params?.operations || !Array.isArray(params.operations) || params.operations.length === 0) {
    throw new ValidationError('Missing or empty "operations" array');
  }

  const { operations } = params;
  // Security kill-switch — see router.ts for background.
  const authDisabled = config.security?.enabled === false;

  // Check max operations limit
  if (operations.length > MAX_BATCH_OPS) {
    throw new ValidationError(
      `Batch exceeds maximum of ${MAX_BATCH_OPS} operations (got ${operations.length})`
    );
  }

  // ── Pre-validation pass ──────────────────────────────────────
  // Validate ALL operations before executing ANY SQL

  const prepared: PreparedStatement[] = [];

  for (let i = 0; i < operations.length; i++) {
    const op = operations[i];

    // Validate method
    if (!BATCH_ALLOWED_METHODS.includes(op.method as BatchMethod)) {
      if (op.method === 'sys_batch') {
        throw new ValidationError(`Operation ${i}: nested sys_batch is not allowed`);
      }
      if (['sys_read', 'sys_list', 'sys_aggregate'].includes(op.method)) {
        throw new ValidationError(
          `Operation ${i}: read operations (${op.method}) are not allowed in batch. Only sys_create, sys_update, sys_delete.`
        );
      }
      throw new ValidationError(`Operation ${i}: unknown method '${op.method}'`);
    }

    // Validate model exists
    if (!op.model) {
      throw new ValidationError(`Operation ${i}: missing "model" field`);
    }
    const model = findModel(config, op.model);
    if (!model) {
      throw new ValidationError(`Operation ${i}: model '${op.model}' not found`);
    }

    // Auth check per operation
    const rawOp = op.method.replace('sys_', '') as 'create' | 'update' | 'delete';
    const authLevel = model.crudPolicy?.[rawOp];
    if (!authDisabled) {
      checkAuth(authLevel, user, rawOp);
    }

    // API key scope enforcement per operation
    if (user.authMethod === 'api_key' && user.apiKeyScopes) {
      if (!hasScope(user.apiKeyScopes, buildCrudScope(op.model, rawOp))) {
        throw new ForbiddenError(`API key lacks scope: model:${op.model}:${rawOp}`);
      }
    }

    const opParams = op.params || {};

    // Build SQL for each operation
    switch (op.method as BatchMethod) {
      case 'sys_create': {
        const rawData =
          opParams.data && typeof opParams.data === 'object'
            ? opParams.data as Record<string, unknown>
            : typeof opParams === 'object' ? opParams : undefined;

        if (!rawData || typeof rawData !== 'object') {
          throw new ValidationError(`Operation ${i}: missing or invalid "data" field`);
        }

        const coercedData = coerceInputTypes(model, rawData);
        // Parity with sysCreate: fill auto-managed creation-timestamp columns
        // the form omits so a batched create doesn't 400 on a missing date.
        applyAutoDateDefaults(model, coercedData);
        const validationErrors = validateCreateInput(model, coercedData);
        if (validationErrors.length > 0) {
          throw new ValidationError(
            `Operation ${i}: validation failed`,
            undefined,
            { errors: validationErrors }
          );
        }

        // Apply defaults
        for (const col of model.columns) {
          if (col.defaultValue !== undefined && !(col.name in coercedData)) {
            coercedData[col.name] = col.defaultValue;
          }
        }

        // Reject cross-tenant foreign-key references.
        await assertForeignKeyOwnership(model, coercedData, user, db, config.models, { authDisabled });

        const now = new Date().toISOString();
        const recordData: Record<string, unknown> = {
          ...coercedData,
          owner_id: user.id,
          created_at: now,
          updated_at: now,
        };

        const processedData = stringifyJsonColumns(model, recordData);
        const { sql, bindings } = buildInsertQuery(model.name, processedData, { returning: true });

        prepared.push({ sql, bindings, method: 'sys_create', model, modelName: op.model });
        break;
      }

      case 'sys_update': {
        if (opParams.id === undefined || opParams.id === null) {
          throw new ValidationError(`Operation ${i}: missing "id" parameter`);
        }

        let rawData: Record<string, unknown> | undefined;
        if (opParams.data && typeof opParams.data === 'object') {
          rawData = opParams.data as Record<string, unknown>;
        } else {
          const { id: _id, ...rest } = opParams;
          rawData = rest;
        }

        if (!rawData || typeof rawData !== 'object' || Object.keys(rawData).length === 0) {
          throw new ValidationError(`Operation ${i}: missing or empty "data" field`);
        }

        // Check protected fields
        const updateFields = Object.keys(rawData);
        const invalidFields = updateFields.filter((f) =>
          (PROTECTED_UPDATE_FIELDS as readonly string[]).includes(f)
        );
        if (invalidFields.length > 0) {
          throw new ValidationError(
            `Operation ${i}: cannot update protected fields: ${invalidFields.join(', ')}`
          );
        }

        const coercedData = coerceInputTypes(model, rawData);
        const validationErrors = validateUpdateInput(model, coercedData);
        if (validationErrors.length > 0) {
          throw new ValidationError(
            `Operation ${i}: validation failed`,
            undefined,
            { errors: validationErrors }
          );
        }

        // Reject cross-tenant foreign-key references for any FK column being changed.
        await assertForeignKeyOwnership(model, coercedData, user, db, config.models, { authDisabled });

        // Enforce row-level write authorization BEFORE the atomic batch runs —
        // the same owner-or-admin check the single-record sys_update path does.
        // Without this, a batch sys_update on a shared-scope model would update
        // any user's row by id (cross-tenant write).
        await assertRowOwnership(model, opParams.id as string | number, user, db, 'update');

        const now = new Date().toISOString();
        const updateData: Record<string, unknown> = {
          ...coercedData,
          updated_at: now,
        };

        const processedData = stringifyJsonColumns(model, updateData);
        const primaryCol = model.columns.find((c) => c.isPrimary)?.name || 'id';
        const isShared = model.ownerScope === 'shared';

        const { sql, bindings } = buildUpdateQuery(
          model.name,
          primaryCol,
          opParams.id as string | number,
          isShared ? undefined : user.id,
          processedData,
          { returning: true }
        );

        prepared.push({ sql, bindings, method: 'sys_update', model, modelName: op.model });
        break;
      }

      case 'sys_delete': {
        if (opParams.id === undefined || opParams.id === null) {
          throw new ValidationError(`Operation ${i}: missing "id" parameter`);
        }

        // Enforce row-level write authorization BEFORE the atomic batch runs —
        // the same owner-or-admin check the single-record sys_delete path does.
        // Without this, a batch sys_delete on a shared-scope model would delete
        // any user's row by id (cross-tenant delete).
        await assertRowOwnership(model, opParams.id as string | number, user, db, 'delete');

        const primaryCol = model.columns.find((c) => c.isPrimary)?.name || 'id';
        const isShared = model.ownerScope === 'shared';
        const hasDeletedAt = model.softDelete === true;
        const softDelete = opParams.soft !== false && hasDeletedAt;

        let sql: string;
        let bindings: unknown[];

        if (softDelete) {
          const now = new Date().toISOString();
          const ownerFilter = isShared ? '' : 'AND owner_id = ?';
          sql = `UPDATE ${escapeIdentifier(model.name)} SET deleted_at = ?, updated_at = ? WHERE ${escapeIdentifier(primaryCol)} = ? ${ownerFilter}`;
          bindings = isShared
            ? [now, now, opParams.id]
            : [now, now, opParams.id, user.id];
        } else {
          const ownerFilter = isShared ? '' : 'AND owner_id = ?';
          sql = `DELETE FROM ${escapeIdentifier(model.name)} WHERE ${escapeIdentifier(primaryCol)} = ? ${ownerFilter}`;
          bindings = isShared ? [opParams.id] : [opParams.id, user.id];
        }

        prepared.push({ sql, bindings, method: 'sys_delete', model, modelName: op.model });
        break;
      }
    }
  }

  // ── Execute batch ────────────────────────────────────────────
  try {
    const statements = prepared.map((p) => db.prepare(p.sql).bind(...p.bindings));
    const batchResults = await db.batch(statements);

    // Map results back to operations
    const results = prepared.map((p, i) => {
      const batchResult = batchResults[i];

      switch (p.method) {
        case 'sys_create': {
          // RETURNING * — first result row is the created record
          const row = batchResult.results?.[0] as Record<string, unknown> | undefined;
          const parsedRow = row ? parseJsonColumns(p.model, row) : {};
          return {
            success: true,
            method: p.method,
            model: p.modelName,
            data: parsedRow,
          };
        }

        case 'sys_update': {
          // RETURNING * — first result row is the updated record
          const row = batchResult.results?.[0] as Record<string, unknown> | undefined;
          const parsedRow = row ? parseJsonColumns(p.model, row) : {};
          return {
            success: true,
            method: p.method,
            model: p.modelName,
            data: parsedRow,
          };
        }

        case 'sys_delete': {
          const opParams = operations[i].params || {};
          const hasDeletedAt = p.model.softDelete === true;
          const softDelete = opParams.soft !== false && hasDeletedAt;
          return {
            success: true,
            method: p.method,
            model: p.modelName,
            data: {
              deleted: true,
              id: opParams.id,
              soft: softDelete,
            },
          };
        }
      }
    });

    return {
      success: true,
      data: { results },
    };
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown database error';
    throw new DatabaseError(`Batch operation failed: ${message}`);
  }
}
