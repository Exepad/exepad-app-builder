/**
 * sys_read - Read a single record by ID
 */

import type { ModelProps } from '../types/env';
import type { RpcResponse, UserContext, ReadParams } from '../rpc/types';
import { ValidationError, NotFoundError, DatabaseError } from '../utils/errors';
import { escapeIdentifier, parseJsonColumns } from '../utils/sql';

/**
 * Read a single record by ID
 */
export async function sysRead(
  model: ModelProps,
  params: ReadParams,
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

  // Build SELECT query — omit owner_id filter for shared-scope models
  const ownerFilter = isShared ? '' : 'AND owner_id = ?';
  const sql = `
    SELECT * FROM ${escapeIdentifier(model.name)}
    WHERE ${escapeIdentifier(primaryCol)} = ?
    ${ownerFilter}
  `;

  try {
    const bindings: unknown[] = isShared ? [params.id] : [params.id, user.id];
    const record = await db.prepare(sql).bind(...bindings).first();

    if (!record) {
      throw new NotFoundError(model.name, params.id);
    }

    // Parse JSON columns in response
    const parsedRecord = parseJsonColumns(model, record as Record<string, unknown>);

    return {
      success: true,
      data: parsedRecord,
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown database error';
    throw new DatabaseError(message);
  }
}
