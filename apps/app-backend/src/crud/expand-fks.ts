/**
 * Auto-expand foreign-key columns on `sys_list` results.
 *
 * After parent rows are fetched and JSON-decoded, every FK column whose
 * name ends in `_id` is resolved to a joined row from the target model.
 * The joined row is attached under the alias formed by stripping the
 * `_id` suffix (`guest_id` → `guest`).
 *
 * Goals:
 *
 * - Zero LLM-side decisions. Generated components write
 *   `row.guest?.full_name` and it just works — there's no `with: {...}`
 *   option to forget.
 * - Owner-scope correctness. Each joined query runs through the joined
 *   model's own owner rule, so user A never sees user B's joined rows.
 * - Bounded cost. One batched `WHERE id IN (...)` per joined model,
 *   ALL of them dispatched in parallel — at most 2 sequential round
 *   trips total regardless of FK count.
 *
 * The expansion is suppressed when:
 * - The column doesn't end in `_id` (skip silently — convention).
 * - The alias collides with an existing parent column.
 * - The target model isn't declared in the registry.
 * - The target model has `autoExpandFKs: false`.
 */

import type { ModelProps } from '../types/env';
import type { UserContext } from '../rpc/types';
import { MAX_FILTER_ARRAY_SIZE } from '../utils/constants';
import { buildListQuery, parseJsonColumns } from '../utils/sql';
import { DatabaseError } from '../utils/errors';
import { enforceSharedScopeReadGate } from '../rpc/router';

/** Auth context needed to gate FK expansion against the joined model's read policy. */
export interface ExpandAuth {
  authDisabled?: boolean;
  roleExpansionMap?: Record<string, string[]>;
}

interface ExpandableFK {
  /** Source FK column on the parent model (e.g., `guest_id`). */
  fkColumn: string;
  /** Alias key on the row where the joined object lands (e.g., `guest`). */
  alias: string;
  /** The model definition for the target table. */
  joinedModel: ModelProps;
}


/**
 * Walk the parent model's columns and return every FK that's eligible
 * for auto-expansion. Silent on every guard miss — this is a best-effort
 * convenience layer, not a validator.
 */
export function collectExpandableFKs(
  parentModel: ModelProps,
  allModels: readonly ModelProps[],
): ExpandableFK[] {
  if (parentModel.autoExpandFKs === false) return [];

  const parentColumnNames = new Set(parentModel.columns.map((c) => c.name));
  const modelByName = new Map(allModels.map((m) => [m.name, m]));
  const out: ExpandableFK[] = [];

  for (const col of parentModel.columns) {
    if (!col.references) continue;
    if (!col.name.endsWith('_id')) continue;
    const alias = col.name.slice(0, -3);
    if (alias === '') continue;
    if (parentColumnNames.has(alias)) continue; // collision with existing column

    const joinedModel = modelByName.get(col.references.model);
    if (!joinedModel) continue;
    if (joinedModel.autoExpandFKs === false) continue;

    out.push({ fkColumn: col.name, alias, joinedModel });
  }
  return out;
}


/**
 * Auto-expand all eligible FKs on the supplied parent rows. Mutates
 * each row in place by attaching a joined sub-object (or `null` for
 * unresolvable references) under the de-suffixed alias.
 *
 * `parentRows` should already have JSON columns decoded — the joined
 * rows are decoded internally before attachment.
 */
export async function expandForeignKeys(
  parentModel: ModelProps,
  parentRows: Record<string, unknown>[],
  allModels: readonly ModelProps[],
  user: UserContext,
  db: D1Database,
  gate?: ExpandAuth,
): Promise<void> {
  if (parentRows.length === 0) return;
  const fks = collectExpandableFKs(parentModel, allModels);
  if (fks.length === 0) return;

  // Read-policy gate. A shared-scope joined model is fetched WITHOUT an owner
  // filter (runSingleJoinQuery), so auto-expansion would hand the caller the
  // columns of a model whose `read` policy they can't satisfy — the same leak
  // enforceSharedScopeReadGate closes on the direct list/aggregate paths. Gate
  // each joined model identically; on denial, attach null instead of expanding
  // (the join query never runs). Owner-scoped joined models are unaffected: the
  // gate no-ops and their owner filter already limits the rows.
  const authDisabled = gate?.authDisabled ?? false;
  const roleExpansionMap = gate?.roleExpansionMap;
  const allowed: ExpandableFK[] = [];
  for (const fk of fks) {
    let denied = false;
    try {
      enforceSharedScopeReadGate(fk.joinedModel, 'sys_list', user, authDisabled, roleExpansionMap);
    } catch {
      denied = true;
    }
    if (denied) {
      for (const row of parentRows) row[fk.alias] = null;
    } else {
      allowed.push(fk);
    }
  }
  if (allowed.length === 0) return;

  await Promise.all(allowed.map((fk) => loadAndAttach(fk, parentRows, user, db)));
}


async function loadAndAttach(
  fk: ExpandableFK,
  parentRows: Record<string, unknown>[],
  user: UserContext,
  db: D1Database,
): Promise<void> {
  // Collect unique non-null FK values referenced by this batch.
  const ids = collectUniqueIds(parentRows, fk.fkColumn);
  if (ids.length === 0) {
    for (const row of parentRows) row[fk.alias] = null;
    return;
  }

  const joined = await fetchJoinedRows(fk.joinedModel, ids, user, db);
  const byId = new Map(joined.map((r) => [r.id, r]));

  for (const row of parentRows) {
    const fkValue = row[fk.fkColumn];
    row[fk.alias] = fkValue == null ? null : byId.get(fkValue) ?? null;
  }
}


function collectUniqueIds(
  parentRows: Record<string, unknown>[],
  fkColumn: string,
): unknown[] {
  const seen = new Set<unknown>();
  const out: unknown[] = [];
  for (const row of parentRows) {
    const v = row[fkColumn];
    if (v == null) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}


/**
 * Fetch joined rows for the given FK ids, honoring the joined model's
 * own ownership and soft-delete rules. Returns parsed (JSON-decoded)
 * rows narrowed to the model's `expandSelect` allowlist (plus `id`).
 *
 * Chunks the id list at ``MAX_FILTER_ARRAY_SIZE`` so callers with large
 * parent batches (up to the 500-row sysList cap) don't trip the
 * filter-array guard in ``buildFilterConditions``. Chunks dispatch in
 * parallel — same round-trip count as one query for typical sizes.
 */
async function fetchJoinedRows(
  joinedModel: ModelProps,
  ids: readonly unknown[],
  user: UserContext,
  db: D1Database,
): Promise<Record<string, unknown>[]> {
  if (ids.length <= MAX_FILTER_ARRAY_SIZE) {
    return runSingleJoinQuery(joinedModel, ids, user, db);
  }
  const chunks: unknown[][] = [];
  for (let i = 0; i < ids.length; i += MAX_FILTER_ARRAY_SIZE) {
    chunks.push(ids.slice(i, i + MAX_FILTER_ARRAY_SIZE));
  }
  const chunkResults = await Promise.all(
    chunks.map((chunk) => runSingleJoinQuery(joinedModel, chunk, user, db)),
  );
  return chunkResults.flat();
}


async function runSingleJoinQuery(
  joinedModel: ModelProps,
  ids: readonly unknown[],
  user: UserContext,
  db: D1Database,
): Promise<Record<string, unknown>[]> {
  const scopedUserId = joinedModel.ownerScope === 'shared' ? undefined : user.id;
  const select = buildExpandSelect(joinedModel);
  // ``limit`` matches the chunk size — exact match avoids spurious
  // pagination on the joined query.
  const limit = Math.max(ids.length, 1);

  const query = buildListQuery(joinedModel.name, {
    filters: { id: ids as unknown[] },
    limit,
    select,
    userId: scopedUserId,
    excludeSoftDeleted: joinedModel.softDelete === true,
  });

  const result = await db.prepare(query.sql).bind(...query.bindings).all();
  if (!result.success) {
    throw new DatabaseError(
      `Failed to auto-expand FK against '${joinedModel.name}'`,
    );
  }

  return result.results.map((r) =>
    parseJsonColumns(joinedModel, r as Record<string, unknown>),
  );
}


function buildExpandSelect(joinedModel: ModelProps): string[] | undefined {
  const allow = joinedModel.expandSelect;
  if (!allow || allow.length === 0) return undefined;
  // Always include `id` so the lookup map keys correctly. ``buildListQuery``
  // throws if the column isn't valid; the platform always exposes ``id``.
  return allow.includes('id') ? allow : ['id', ...allow];
}
