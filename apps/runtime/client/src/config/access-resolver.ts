/**
 * Access resolver — applies defaultAccess and resolves role hierarchy.
 *
 * - Applies security.defaultAccess to pages without explicit access
 * - Resolves roleHierarchy into a flat expansion map (each role → all effective roles)
 * - Attaches the roleExpansionMap to the config for runtime use
 *
 * Pure function — does not mutate the input config.
 */

export interface ResolvedAccessResult {
  config: any;
  roleExpansionMap: Record<string, string[]>;
}

/**
 * Resolve a role hierarchy into a flat expansion map.
 *
 * Each role maps to all roles it effectively holds, including itself and
 * all transitively inherited roles.
 *
 * Example:
 *   hierarchy: { admin: ['editor'], editor: ['viewer'] }
 *   result:    { admin: ['admin', 'editor', 'viewer'], editor: ['editor', 'viewer'], viewer: ['viewer'] }
 */
export function resolveRoleHierarchy(
  roles: string[] | undefined,
  hierarchy: Record<string, string[]> | undefined
): Record<string, string[]> {
  const map: Record<string, string[]> = {};

  if (!roles || roles.length === 0) return map;

  // Initialize each role with itself
  for (const role of roles) {
    map[role] = [role];
  }

  if (!hierarchy) return map;

  // Expand each role's inherited roles using BFS
  for (const role of roles) {
    const visited = new Set<string>([role]);
    const queue: string[] = [...(hierarchy[role] || [])];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      map[role].push(current);

      // Continue traversing inherited roles
      const children = hierarchy[current];
      if (children) {
        for (const child of children) {
          if (!visited.has(child)) {
            queue.push(child);
          }
        }
      }
    }
  }

  return map;
}

/**
 * Resolve access levels and role hierarchy for an app config.
 *
 * 1. Applies security.defaultAccess to pages without explicit access field
 * 2. Resolves roleHierarchy into flat roleExpansionMap
 * 3. Returns modified config + roleExpansionMap
 */
export function resolveAccess(config: any): ResolvedAccessResult {
  const security = config?.security;
  const emptyResult: ResolvedAccessResult = { config, roleExpansionMap: {} };

  if (!security) return emptyResult;

  // Resolve role hierarchy
  const roleExpansionMap = resolveRoleHierarchy(security.roles, security.roleHierarchy);

  // Apply defaultAccess to pages without explicit access
  const defaultAccess = security.defaultAccess;
  const pages = config.frontend?.pages;
  let pagesChanged = false;

  if (defaultAccess && Array.isArray(pages)) {
    const resolvedPages = pages.map((page: any) => {
      if (page.access === undefined) {
        pagesChanged = true;
        return { ...page, access: defaultAccess };
      }
      return page;
    });

    if (pagesChanged) {
      return {
        config: {
          ...config,
          frontend: { ...config.frontend, pages: resolvedPages },
        },
        roleExpansionMap,
      };
    }
  }

  return { config, roleExpansionMap };
}
