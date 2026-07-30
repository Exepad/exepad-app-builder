/**
 * Handler Context Builder
 *
 * Builds the execution context provided to custom handlers.
 * The canonical HandlerContext type is defined in @exepad/types.
 */

import type { Env, ModelProps } from '../types/env';
import type { HandlerContext, HandlerLogger } from '@exepad/types';
import type { UserContext } from '../rpc/types';
import { wrapHandlerDb } from './handler-db';

// Re-export canonical types for downstream consumers
export type { HandlerContext, HandlerLogger as Logger };

/**
 * Create a logger instance
 */
function createLogger(appId: string, handlerName: string): HandlerLogger {
  const prefix = `[${appId}/${handlerName}]`;

  return {
    debug(message: string, data?: Record<string, unknown>) {
      console.debug(prefix, message, data ? JSON.stringify(data) : '');
    },
    info(message: string, data?: Record<string, unknown>) {
      console.info(prefix, message, data ? JSON.stringify(data) : '');
    },
    warn(message: string, data?: Record<string, unknown>) {
      console.warn(prefix, message, data ? JSON.stringify(data) : '');
    },
    error(message: string, data?: Record<string, unknown>) {
      console.error(prefix, message, data ? JSON.stringify(data) : '');
    },
  };
}

/**
 * Build handler execution context.
 *
 * **Security note:** Handlers receive unrestricted access to `ctx.db` and
 * `ctx.batch`, bypassing all CRUD-layer authorization (owner_id read-scoping,
 * crudPolicy checks, soft-delete filtering). Handler code should be treated
 * as trusted server-side code written by the app developer.
 *
 * `ctx.db` is wrapped so raw INSERTs into a model table auto-fill the
 * `NOT NULL` system columns (`owner_id`, `created_at`, `updated_at`) the same
 * way auto-CRUD's `sys_create` does — a handler that writes `INSERT INTO
 * orders (...)` without them would otherwise fail with a NOT NULL constraint.
 * A handler that sets those columns explicitly is respected (see
 * `handler-db.ts`).
 */
export function buildHandlerContext(
  handlerName: string,
  user: UserContext,
  env: Env,
  params: Record<string, unknown> = {},
  models: ModelProps[] = [],
): HandlerContext {
  // Convert models array to a record keyed by name for easy lookup
  const modelsMap: Record<string, ModelProps> = {};
  for (const m of models) {
    modelsMap[m.name] = m;
  }

  const db = wrapHandlerDb(env.DB, models, user.id);

  return {
    db,
    batch: (statements: D1PreparedStatement[]) => env.DB.batch(statements),
    user: Object.freeze({
      id: user.id,
      email: user.email,
      roles: [...user.roles],
    }),
    params: Object.freeze({ ...params }),
    log: createLogger(env.APP_ID, handlerName),
    config: Object.freeze({
      appId: env.APP_ID,
      appAlias: env.APP_ALIAS,
    }),
    models: modelsMap,
  };
}
