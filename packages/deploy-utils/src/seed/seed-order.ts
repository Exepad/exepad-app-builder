/**
 * FK-dependency-aware ordering for seed entries.
 *
 * The reseed (`seedFromR2`) must clear CHILD tables before PARENT tables — an
 * owner-scoped `DELETE` of a parent trips `ON DELETE RESTRICT` while children
 * still reference it — and INSERT parents before children so a child's FK
 * columns are never NULLed into a `NOT NULL` violation by the FK-deferral path.
 *
 * This module is a pure topological sort (no I/O), so it is unit-testable
 * without a database. On a true FK cycle it falls back to config order and
 * signals `cyclic=true`; the seeder's deferred-FK UPDATE pass + NOT-NULL guard
 * are the cycle safety net.
 */

export interface SeedOrderPlan {
  /** Entry-name keys in parent→child order (safe INSERT order). */
  insertOrder: string[];
  /** Entry-name keys in child→parent order (safe DELETE order). */
  deleteOrder: string[];
  /** True when an FK cycle was detected; both orders fall back to config order. */
  cyclic: boolean;
}

/**
 * Compute a safe DELETE/INSERT order from the seed entries and the FK map.
 *
 * - Operates on entry-name keys. `Object.keys(seedEntries)` IS the canonical
 *   config order, and it is preserved as the tie-break so an already-correct
 *   config stays byte-for-byte identical (minimises churn for non-FK apps).
 * - Only edges between two models that BOTH have a seed entry constrain order;
 *   refs to non-seeded models and self-references are ignored.
 * - Kahn's algorithm; on leftover nodes (a cycle) → config order + `cyclic`.
 *
 * @param seedEntries the seed entries keyed by entry name (each carries `.model`)
 * @param fkRefs      `buildFkRefMap()` output: modelLower → FK refs (referencedModel lowercased)
 */
export function planSeedOrder(
  seedEntries: Record<string, { model: string }>,
  fkRefs: Map<string, Array<{ referencedModel: string }>>,
): SeedOrderPlan {
  const entryNames = Object.keys(seedEntries); // config order
  const configOrder = (cyclic: boolean): SeedOrderPlan => ({
    insertOrder: [...entryNames],
    deleteOrder: [...entryNames].reverse(),
    cyclic,
  });

  if (entryNames.length <= 1) return configOrder(false);

  // Map model(lowercased) → entry names targeting it (usually one).
  const entriesByModel = new Map<string, string[]>();
  const modelConfigOrder: string[] = [];
  for (const name of entryNames) {
    const m = seedEntries[name].model.toLowerCase();
    let arr = entriesByModel.get(m);
    if (!arr) {
      arr = [];
      entriesByModel.set(m, arr);
      modelConfigOrder.push(m); // first appearance defines model config order
    }
    arr.push(name);
  }
  const seedModelSet = new Set(entriesByModel.keys());

  // Build parent→child edges between seeded models only. In-degree is seeded
  // from the full model set so FK-less leaf parents (absent from `fkRefs`) are
  // still ordered.
  const children = new Map<string, Set<string>>();
  const inDegree = new Map<string, number>();
  for (const m of seedModelSet) inDegree.set(m, 0);

  for (const childModel of seedModelSet) {
    for (const ref of fkRefs.get(childModel) ?? []) {
      const parent = ref.referencedModel;
      if (parent === childModel) continue; // ignore self-reference
      if (!seedModelSet.has(parent)) continue; // parent not seeded → no ordering constraint
      let kids = children.get(parent);
      if (!kids) {
        kids = new Set();
        children.set(parent, kids);
      }
      if (!kids.has(childModel)) {
        kids.add(childModel);
        inDegree.set(childModel, (inDegree.get(childModel) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm with config-order tie-break.
  const orderIndex = (m: string) => modelConfigOrder.indexOf(m);
  const ready = modelConfigOrder.filter((m) => (inDegree.get(m) ?? 0) === 0);
  const sortedModels: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => orderIndex(a) - orderIndex(b));
    const m = ready.shift()!;
    sortedModels.push(m);
    for (const child of children.get(m) ?? []) {
      const d = (inDegree.get(child) ?? 0) - 1;
      inDegree.set(child, d);
      if (d === 0) ready.push(child);
    }
  }

  if (sortedModels.length !== seedModelSet.size) {
    return configOrder(true); // cycle → fall back to config order
  }

  // Expand model order back to entry names (config order among entries of one model).
  const insertOrder: string[] = [];
  for (const m of sortedModels) {
    for (const name of entriesByModel.get(m) ?? []) insertOrder.push(name);
  }
  return { insertOrder, deleteOrder: [...insertOrder].reverse(), cyclic: false };
}
