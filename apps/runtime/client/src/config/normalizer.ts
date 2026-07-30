/**
 * Config normalizer — migrates legacy auth values to the AccessLevel format.
 *
 * Converts bare 'admin' → 'role:admin' in crudPolicy fields and handler authLevel.
 * Accepts both old and new formats during transition.
 *
 * Pure function — does not mutate the input config.
 */

type AnyConfig = Record<string, any>;

/**
 * Normalize a single auth level value.
 * Converts legacy 'admin' to 'role:admin'. All other values pass through unchanged.
 */
function normalizeAuthLevel(value: string | undefined): string | undefined {
  if (value === 'admin') return 'role:admin';
  return value;
}

/**
 * Normalize crudPolicy fields on a model config.
 */
function normalizeCrudPolicy(crudPolicy: AnyConfig | undefined): AnyConfig | undefined {
  if (!crudPolicy) return crudPolicy;

  const ops = ['create', 'read', 'update', 'delete', 'list'] as const;
  let changed = false;
  const result = { ...crudPolicy };

  for (const op of ops) {
    const normalized = normalizeAuthLevel(result[op]);
    if (normalized !== result[op]) {
      result[op] = normalized;
      changed = true;
    }
  }

  return changed ? result : crudPolicy;
}

/**
 * Normalize all auth-related values in an app config.
 *
 * Migrates:
 * - backend.models[].crudPolicy.{op}: 'admin' → 'role:admin'
 * - backend.handlers[].authLevel: 'admin' → 'role:admin'
 * - security.defaultAccess: 'admin' → 'role:admin'
 * - frontend.pages[].access: 'admin' → 'role:admin'
 */
export function normalizeConfig(config: any): any {
  if (!config) return config;

  let result = config;

  // Normalize backend.models[].crudPolicy
  const models = config.backend?.models;
  if (Array.isArray(models)) {
    const normalizedModels = models.map((model: any) => {
      const normalizedPolicy = normalizeCrudPolicy(model.crudPolicy);
      if (normalizedPolicy !== model.crudPolicy) {
        return { ...model, crudPolicy: normalizedPolicy };
      }
      return model;
    });

    if (normalizedModels.some((m: any, i: number) => m !== models[i])) {
      result = {
        ...result,
        backend: { ...result.backend, models: normalizedModels },
      };
    }
  }

  // Normalize backend.handlers[].authLevel
  const handlers = config.backend?.handlers;
  if (Array.isArray(handlers)) {
    const normalizedHandlers = handlers.map((handler: any) => {
      const normalized = normalizeAuthLevel(handler.authLevel);
      if (normalized !== handler.authLevel) {
        return { ...handler, authLevel: normalized };
      }
      return handler;
    });

    if (normalizedHandlers.some((h: any, i: number) => h !== handlers[i])) {
      const backend = result.backend === config.backend
        ? { ...config.backend, handlers: normalizedHandlers }
        : { ...result.backend, handlers: normalizedHandlers };
      result = { ...result, backend };
    }
  }

  // Normalize security.defaultAccess
  if (config.security?.defaultAccess) {
    const normalized = normalizeAuthLevel(config.security.defaultAccess);
    if (normalized !== config.security.defaultAccess) {
      result = {
        ...result,
        security: { ...result.security, defaultAccess: normalized },
      };
    }
  }

  // Normalize frontend.pages[].access
  const pages = config.frontend?.pages;
  if (Array.isArray(pages)) {
    const normalizedPages = pages.map((page: any) => {
      const normalized = normalizeAuthLevel(page.access);
      if (normalized !== page.access) {
        return { ...page, access: normalized };
      }
      return page;
    });

    if (normalizedPages.some((p: any, i: number) => p !== pages[i])) {
      result = {
        ...result,
        frontend: { ...result.frontend, pages: normalizedPages },
      };
    }
  }

  return result;
}
