/**
 * Write-time foreign-key ownership guard.
 *
 * SQLite's FK constraint (PRAGMA foreign_keys = ON) only checks that the
 * referenced row EXISTS — never who owns it. For owner-scoped models that
 * leaves a cross-tenant hole: user B can create/update one of their own rows
 * with a foreign key pointing at user A's owner-scoped row (FK ids are small
 * and enumerable). Nothing leaks through the auto-CRUD read path — FK
 * auto-expansion is owner-scoped and resolves the sibling object to `null` —
 * but it silently breaks the invariant that *reasonable* server code relies on:
 * "an owner-scoped row's FK to another owner-scoped model points at one of MY
 * rows." A custom handler that scopes the parent by `owner_id` and then JOINs
 * the child (the natural, correct-looking pattern) will surface the victim's
 * columns (e.g. a client name) for whatever id the attacker linked. An export
 * or any future JOIN-based feature has the same exposure.
 *
 * We close it at the single write chokepoint: when a write sets an FK column
 * whose referenced model is owner-scoped, the referenced row must be owned by
 * the caller. References to `ownerScope: 'shared'` models are allowed across
 * tenants by design (that is what "shared" means — reference/catalog data).
 *
 * The check is skipped when auth is disabled (owner gating is relaxed
 * platform-wide in that mode, mirroring `enforceSharedScopeReadGate`).
 */
import type { ModelProps } from '../types/env';
import type { UserContext } from '../rpc/types';
import { ForbiddenError } from '../utils/errors';
import { escapeIdentifier } from '../utils/sql';

export interface FkOwnershipOptions {
  /** When auth is disabled the owner gate is relaxed everywhere; skip the check. */
  authDisabled?: boolean;
}

/**
 * Reject cross-tenant foreign-key references on a create/update payload.
 *
 * @param model    The model being written.
 * @param data     The (coerced) column data for this write — only columns
 *                  present here are checked, so an update that doesn't touch an
 *                  FK column is unaffected.
 * @param user     The verified caller.
 * @param db       The per-app database.
 * @param models   The full model list (to resolve the referenced model's scope).
 * @throws ForbiddenError when an FK points at a row the caller does not own.
 */
export async function assertForeignKeyOwnership(
  model: ModelProps,
  data: Record<string, unknown>,
  user: UserContext,
  db: D1Database,
  models: ModelProps[] | undefined,
  opts: FkOwnershipOptions = {},
): Promise<void> {
  if (opts.authDisabled) return;
  if (!user?.id) return; // anon writes are rejected upstream; nothing to scope against
  if (!models || models.length === 0) return;

  for (const col of model.columns) {
    const ref = col.references;
    if (!ref) continue;
    if (!(col.name in data)) continue;
    const value = data[col.name];
    // Nullable FK left empty — nothing to reference.
    if (value === null || value === undefined || value === '') continue;

    const refModel = models.find((m) => m.name === ref.model);
    if (!refModel) continue; // unknown/external target — cannot scope it
    const refScope = refModel.ownerScope || 'user';
    if (refScope !== 'user') continue; // shared/reference data is cross-tenant by design

    const table = escapeIdentifier(refModel.name);
    const column = escapeIdentifier(ref.column || 'id');
    const row = await db
      .prepare(`SELECT 1 FROM ${table} WHERE ${column} = ? AND owner_id = ? LIMIT 1`)
      .bind(value, user.id)
      .first();
    if (!row) {
      throw new ForbiddenError(
        `Referenced ${ref.model} '${value}' does not exist or you do not have access to it.`,
      );
    }
  }
}
