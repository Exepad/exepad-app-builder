/**
 * Row-level write authorization — the single source of truth shared by
 * sysUpdate, sysDelete, and sysBatch.
 *
 * Shared-scope models are readable by everyone, but only the row's owner (or an
 * admin) may mutate a given row — so a mutation must fetch `owner_id` and check
 * it. User-scope models are isolated by an `owner_id = ?` filter on the write
 * itself, so an existence check scoped to the owner is sufficient.
 *
 * The single-record paths (update.ts / delete.ts) and the batch path
 * (batch.ts) ALL call this, so the batch path can never drift from the per-row
 * checks — a drift that previously let sys_batch bypass owner-or-admin
 * authorization on shared-scope models (cross-tenant write).
 */

import type { ModelProps } from '../types/env';
import type { UserContext } from '../rpc/types';
import { NotFoundError, ForbiddenError } from '../utils/errors';
import { escapeIdentifier } from '../utils/sql';

/**
 * Throw NotFoundError if the row does not exist (or, for user-scope models, is
 * not owned by the caller), or ForbiddenError if a shared-scope row is owned by
 * someone else and the caller is not an admin. Returns normally when the caller
 * is permitted to mutate the row.
 *
 * @param action  Verb used in the ForbiddenError message ("update" / "delete").
 */
export async function assertRowOwnership(
  model: ModelProps,
  id: string | number,
  user: UserContext,
  db: D1Database,
  action: 'update' | 'delete',
): Promise<void> {
  const primaryCol = model.columns.find((c) => c.isPrimary)?.name || 'id';
  const isShared = model.ownerScope === 'shared';

  if (isShared) {
    // Shared scope: fetch record, verify owner or admin.
    const checkSql = `SELECT ${escapeIdentifier(primaryCol)}, owner_id FROM ${escapeIdentifier(model.name)} WHERE ${escapeIdentifier(primaryCol)} = ?`;
    const existing = await db.prepare(checkSql).bind(id).first<{ owner_id: string }>();
    if (!existing) {
      throw new NotFoundError(model.name, id);
    }
    if (existing.owner_id !== user.id && !user.roles.includes('admin')) {
      throw new ForbiddenError(`Only the record owner or an admin can ${action} this record`);
    }
  } else {
    // User scope: check existence scoped to owner.
    const checkSql = `SELECT ${escapeIdentifier(primaryCol)} FROM ${escapeIdentifier(model.name)} WHERE ${escapeIdentifier(primaryCol)} = ? AND owner_id = ?`;
    const existing = await db.prepare(checkSql).bind(id, user.id).first();
    if (!existing) {
      throw new NotFoundError(model.name, id);
    }
  }
}
