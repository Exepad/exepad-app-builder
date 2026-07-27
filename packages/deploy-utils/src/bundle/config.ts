/**
 * Configuration Injection Utilities
 */

import type { InjectedAppConfig, ModelProps, HandlerProps } from './types';
import type { SecurityProps, StorageProps } from '@exepad/types';

/**
 * Resolve a role hierarchy into a flat expansion map.
 *
 * Each role maps to all roles it effectively holds, including itself and
 * all transitively inherited roles (BFS traversal).
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

  for (const role of roles) {
    map[role] = [role];
  }

  if (!hierarchy) return map;

  for (const role of roles) {
    const visited = new Set<string>([role]);
    const queue: string[] = [...(hierarchy[role] || [])];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;
      visited.add(current);
      map[role].push(current);

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
 * Extract backend config from full WebAppProps.
 */
export function extractBackendProps(appConfig: Record<string, unknown>): InjectedAppConfig {
  const backend = appConfig.backend as Record<string, unknown> | undefined;

  const security = (appConfig.security as SecurityProps) || undefined;
  const roleExpansionMap = security?.roles && security?.roleHierarchy
    ? resolveRoleHierarchy(security.roles, security.roleHierarchy)
    : undefined;

  if (!backend || backend.mode === 'none') {
    return {
      models: [],
      handlers: [],
      security,
      roleExpansionMap,
      // Storage is independent of backend_type — a `mode:"none"` form app (no
      // CRUD models) can still enable file uploads. Carry it through here too,
      // not just in the dynamic-backend return below, otherwise both consumers
      // (deploy R2/_files provisioning + app-backend /files gate) see it as
      // disabled and uploads fail with STORAGE_DISABLED.
      storage: (backend?.storage as StorageProps) || undefined,
    };
  }

  return {
    models: (backend.models as ModelProps[]) || [],
    handlers: (backend.handlers as HandlerProps[]) || [],
    security,
    roleExpansionMap,
    storage: (backend.storage as StorageProps) || undefined,
  };
}

/**
 * Validate injected config
 */
export function validateInjectedConfig(config: InjectedAppConfig): string[] {
  const errors: string[] = [];
  
  // Validate models
  if (config.models) {
    for (const model of config.models) {
      if (!model.name) {
        errors.push(`Model missing name: ${JSON.stringify(model)}`);
      }
      if (!model.columns || model.columns.length === 0) {
        errors.push(`Model '${model.name}' has no columns`);
      }
      
      // Note: primary key check removed — schema builder auto-adds
      // DEFAULT_PRIMARY_KEY (id INTEGER) when no column has isPrimary
    }
  }
  
  // Validate handlers
  if (config.handlers) {
    for (const handler of config.handlers) {
      if (!handler.name) {
        errors.push(`Handler missing name: ${JSON.stringify(handler)}`);
      }
      if (!handler.method) {
        errors.push(`Handler '${handler.name}' missing method reference`);
      }
    }
  }

  // Validate storage config
  if (config.storage?.enabled) {
    if (config.storage.maxFileSize !== undefined && config.storage.maxFileSize <= 0) {
      errors.push('storage.maxFileSize must be a positive number');
    }
    if (config.storage.maxFilesPerUser !== undefined && config.storage.maxFilesPerUser <= 0) {
      errors.push('storage.maxFilesPerUser must be a positive number');
    }
  }

  return errors;
}

