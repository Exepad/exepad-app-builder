/**
 * sys_delete - Delete a record
 */

import type { ModelProps } from '../types/env';
import type { RpcResponse, UserContext, DeleteParams } from '../rpc/types';
import { ValidationError, NotFoundError, DatabaseError, ForbiddenError } from '../utils/errors';
import { escapeIdentifier } from '../utils/sql';
import { assertRowOwnership } from './ownership';

/**
 * Delete a record (soft or hard delete)
 */
export async function sysDelete(
  model: ModelProps,
  params: DeleteParams,
  user: UserContext,
  db: D1Database
): Promise<RpcResponse> {
  // Validate input
  if (params?.id === undefined || params.id === null) {
    throw new ValidationError('Missing "id" parameter');
  }

  // Find primary key column
  const primaryCol = model.columns.find((c) => c.isPrimary)?.name || 'id';
  const isShared = model.ownerScope === 'shared';

  // Enforce row-level write authorization (owner-or-admin for shared scope,
  // existence-scoped-to-owner for user scope). Shared with sysUpdate/sysBatch.
  await assertRowOwnership(model, params.id, user, db, 'delete');

  const hasDeletedAt = model.softDelete === true;
  const softDelete = params.soft !== false && hasDeletedAt;

  try {
    let result: D1Result;

    if (softDelete) {
      // Soft delete: set deleted_at timestamp
      const now = new Date().toISOString();
      const ownerFilter = isShared ? '' : 'AND owner_id = ?';
      const sql = `
        UPDATE ${escapeIdentifier(model.name)}
        SET deleted_at = ?, updated_at = ?
        WHERE ${escapeIdentifier(primaryCol)} = ? ${ownerFilter}
      `;
      const bindings: unknown[] = isShared
        ? [now, now, params.id]
        : [now, now, params.id, user.id];
      result = await db.prepare(sql).bind(...bindings).run();
    } else {
      // Hard delete: remove the record
      const ownerFilter = isShared ? '' : 'AND owner_id = ?';
      const sql = `DELETE FROM ${escapeIdentifier(model.name)} WHERE ${escapeIdentifier(primaryCol)} = ? ${ownerFilter}`;
      const bindings: unknown[] = isShared ? [params.id] : [params.id, user.id];
      result = await db.prepare(sql).bind(...bindings).run();
    }

    if (!result.success) {
      throw new DatabaseError('Failed to delete record');
    }

    if (result.meta.changes === 0) {
      throw new NotFoundError(model.name, params.id);
    }

    return {
      success: true,
      data: {
        deleted: true,
        id: params.id,
        soft: softDelete,
      },
    };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown database error';

    // Foreign key constraint: another table references this record
    if (message.includes('FOREIGN KEY constraint failed') || message.includes('SQLITE_CONSTRAINT_FOREIGNKEY')) {
      throw new ValidationError(
        `Cannot delete this ${model.name} record because it is referenced by other records. Delete the related records first, or update them to remove the reference.`,
        'id',
      );
    }

    throw new DatabaseError(message);
  }
}
