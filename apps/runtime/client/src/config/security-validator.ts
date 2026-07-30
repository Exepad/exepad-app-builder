/**
 * Security config validator — validates auth-related config at load time.
 *
 * Checks:
 * - role:X references must exist in security.roles
 * - Circular roleHierarchy detection
 * - 'owner' only valid in crudPolicy
 * - 'none' only valid in crudPolicy
 * - Model without crudPolicy in app with authProviders → warning
 *
 * Pure function — does not mutate the input config.
 */

export interface ValidationResult {
  warnings: string[];
  errors: string[];
}

/**
 * Extract the role name from an AccessLevel string.
 * Returns the role name for 'role:X', or null for other levels.
 */
function extractRole(level: string | undefined): string | null {
  if (!level || !level.startsWith('role:')) return null;
  return level.slice(5);
}

/**
 * Detect cycles in the role hierarchy using DFS.
 */
function detectCycles(hierarchy: Record<string, string[]>): string[] {
  const cycles: string[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(role: string, path: string[]): void {
    if (inStack.has(role)) {
      const cycleStart = path.indexOf(role);
      cycles.push(`Circular role hierarchy: ${path.slice(cycleStart).join(' → ')} → ${role}`);
      return;
    }
    if (visited.has(role)) return;

    visited.add(role);
    inStack.add(role);

    const children = hierarchy[role] || [];
    for (const child of children) {
      dfs(child, [...path, role]);
    }

    inStack.delete(role);
  }

  for (const role of Object.keys(hierarchy)) {
    dfs(role, []);
  }

  return cycles;
}

/**
 * Collect all role references from an AccessLevel value.
 */
function collectRoleRef(level: string | undefined): string | null {
  return extractRole(level);
}

/**
 * Validate the security configuration of an app config.
 */
export function validateSecurityConfig(config: any): ValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const security = config?.security;
  if (!security) return { warnings, errors };

  const definedRoles = new Set(security.roles || []);
  const hasProviders = Array.isArray(security.authProviders) && security.authProviders.length > 0;

  // Validate roleHierarchy
  if (security.roleHierarchy) {
    // Check for cycles
    const cycles = detectCycles(security.roleHierarchy);
    errors.push(...cycles);

    // Check that hierarchy references defined roles
    for (const [parent, children] of Object.entries(security.roleHierarchy)) {
      if (definedRoles.size > 0 && !definedRoles.has(parent)) {
        warnings.push(`roleHierarchy references undefined role '${parent}'`);
      }
      if (Array.isArray(children)) {
        for (const child of children) {
          if (definedRoles.size > 0 && !definedRoles.has(child as string)) {
            warnings.push(`roleHierarchy: '${parent}' inherits undefined role '${child}'`);
          }
        }
      }
    }
  }

  // Validate defaultRole references a defined role
  if (security.defaultRole && definedRoles.size > 0 && !definedRoles.has(security.defaultRole)) {
    warnings.push(`defaultRole '${security.defaultRole}' is not in security.roles`);
  }

  // Validate defaultAccess
  if (security.defaultAccess === 'owner') {
    errors.push(`defaultAccess cannot be 'owner' — 'owner' is only valid in crudPolicy`);
  }
  if (security.defaultAccess === 'none') {
    errors.push(`defaultAccess cannot be 'none' — 'none' is only valid in crudPolicy`);
  }
  const defaultAccessRole = collectRoleRef(security.defaultAccess);
  if (defaultAccessRole && definedRoles.size > 0 && !definedRoles.has(defaultAccessRole)) {
    warnings.push(`defaultAccess references undefined role '${defaultAccessRole}'`);
  }

  // Validate page access levels
  const pages = config.frontend?.pages;
  if (Array.isArray(pages)) {
    for (const page of pages) {
      if (page.access === 'owner') {
        errors.push(`Page '${page.slug}': access cannot be 'owner' — 'owner' is only valid in crudPolicy`);
      }
      if (page.access === 'none') {
        errors.push(`Page '${page.slug}': access cannot be 'none' — 'none' is only valid in crudPolicy`);
      }
      const roleRef = collectRoleRef(page.access);
      if (roleRef && definedRoles.size > 0 && !definedRoles.has(roleRef)) {
        warnings.push(`Page '${page.slug}': access references undefined role '${roleRef}'`);
      }
    }
  }

  // Validate model crudPolicy
  const models = config.backend?.models;
  if (Array.isArray(models)) {
    for (const model of models) {
      // Warn if model has no crudPolicy in an authenticated app
      if (!model.crudPolicy && hasProviders) {
        warnings.push(`Model '${model.name}': no crudPolicy defined in an app with authProviders`);
      }

      if (model.crudPolicy) {
        const ops = ['create', 'read', 'update', 'delete', 'list'] as const;
        for (const op of ops) {
          const level = model.crudPolicy[op];
          const roleRef = collectRoleRef(level);
          if (roleRef && definedRoles.size > 0 && !definedRoles.has(roleRef)) {
            warnings.push(`Model '${model.name}': crudPolicy.${op} references undefined role '${roleRef}'`);
          }
        }
      }
    }
  }

  // Validate handler authLevel
  const handlers = config.backend?.handlers;
  if (Array.isArray(handlers)) {
    for (const handler of handlers) {
      if (handler.authLevel === 'owner') {
        errors.push(`Handler '${handler.name}': authLevel cannot be 'owner' — 'owner' is only valid in crudPolicy`);
      }
      if (handler.authLevel === 'none') {
        errors.push(`Handler '${handler.name}': authLevel cannot be 'none' — 'none' is only valid in crudPolicy`);
      }
      const roleRef = collectRoleRef(handler.authLevel);
      if (roleRef && definedRoles.size > 0 && !definedRoles.has(roleRef)) {
        warnings.push(`Handler '${handler.name}': authLevel references undefined role '${roleRef}'`);
      }
    }
  }

  // SECURITY: public self-signup must not grant a privileged role. The ERROR
  // mirrors the request-time downgrade TRIGGER in app-backend's
  // resolveSelfSignupRole — narrow: a reserved admin role OR a role that gates a
  // restricted PAGE (security.pageAccess / defaultAccess). A defaultRole that
  // only gates model CRUD or a handler is the legitimate "every member can
  // create their own rows" pattern and is NOT downgraded at request time, so it
  // is a WARNING here (operator visibility), not an error — otherwise every such
  // app would log a spurious error on each config load.
  const allowSignup = security.allowSignup !== false;
  if (allowSignup && hasProviders && security.defaultRole) {
    const RESERVED_PRIVILEGED = new Set(['admin', 'owner', 'superadmin', 'root']);
    const dr = String(security.defaultRole);

    // Narrow page-gate set — matches the runtime downgrade trigger exactly
    // (security.pageAccess + defaultAccess; the request-time guard does not see
    // frontend.pages[].access, so it stays out of the ERROR to avoid divergence).
    const pageGateRoles = new Set<string>();
    const addPageGate = (level: unknown): void => {
      const r = extractRole(typeof level === 'string' ? level : undefined);
      if (r) pageGateRoles.add(r);
    };
    const pageAccess = (security as { pageAccess?: Record<string, unknown> }).pageAccess;
    if (pageAccess) for (const level of Object.values(pageAccess)) addPageGate(level);
    addPageGate(security.defaultAccess);

    if (RESERVED_PRIVILEGED.has(dr.toLowerCase()) || pageGateRoles.has(dr)) {
      errors.push(
        `security.defaultRole '${dr}' is privileged but allowSignup is enabled — any visitor could self-register as '${dr}'. Set defaultRole to a non-privileged role (e.g. 'user') or set allowSignup:false.`,
      );
    } else {
      // Broad capability-gate set — CRUD ops, handlers, and per-page access. Not
      // an escalation the runtime downgrades, but worth surfacing so the operator
      // knows public signups get this role's backend capabilities.
      const capGateRoles = new Set<string>();
      const addCapGate = (level: unknown): void => {
        const r = extractRole(typeof level === 'string' ? level : undefined);
        if (r) capGateRoles.add(r);
      };
      if (Array.isArray(pages)) for (const page of pages) addCapGate(page.access);
      if (Array.isArray(models)) {
        for (const model of models) {
          if (model.crudPolicy) {
            for (const op of ['create', 'read', 'update', 'delete', 'list'] as const) {
              addCapGate(model.crudPolicy[op]);
            }
          }
        }
      }
      if (Array.isArray(handlers)) for (const handler of handlers) addCapGate(handler.authLevel);
      if (capGateRoles.has(dr)) {
        warnings.push(
          `security.defaultRole '${dr}' gates backend CRUD/handlers and allowSignup is enabled — every self-registered user gets '${dr}' capabilities. Confirm this is intended.`,
        );
      }
    }
  }

  return { warnings, errors };
}
