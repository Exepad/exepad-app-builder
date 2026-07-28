/**
 * sys_multi_query - Execute multiple read operations in a single request
 *
 * All queries run concurrently via Promise.all. Each query is isolated:
 * failed queries return error objects while others succeed normally.
 */

import type { ModelProps, InjectedProps } from '../types/env';
import type { RpcResponse, UserContext, ListParams, ReadParams } from '../rpc/types';
import type { AggregateParams } from './aggregate';
import { ValidationError, ForbiddenError } from '../utils/errors';
import { findModel, checkAuth, enforceSharedScopeReadGate } from '../rpc/router';
import { hasScope, buildCrudScope } from '../auth/api-keys';
import { sysList } from './list';
import { sysRead } from './read';
import { sysAggregate } from './aggregate';

/** Maximum queries per multi-query request */
const MAX_QUERIES = 50;

/** Allowed methods in a multi-query (read operations only) */
const ALLOWED_METHODS = ['sys_list', 'sys_aggregate', 'sys_read'] as const;
type QueryMethod = (typeof ALLOWED_METHODS)[number];

interface QueryOperation {
  alias: string;
  model: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface MultiQueryParams {
  queries: QueryOperation[];
}

interface QueryResult {
  alias: string;
  success: boolean;
  data?: unknown;
  pagination?: unknown;
  error?: { code: string; message: string };
}

/**
 * Execute multiple read queries concurrently
 */
export async function sysMultiQuery(
  params: MultiQueryParams | undefined,
  user: UserContext,
  config: InjectedProps,
  db: D1Database
): Promise<RpcResponse> {
  if (!params?.queries || !Array.isArray(params.queries) || params.queries.length === 0) {
    throw new ValidationError('Missing or empty "queries" array');
  }

  if (params.queries.length > MAX_QUERIES) {
    throw new ValidationError(
      `Multi-query exceeds maximum of ${MAX_QUERIES} queries (got ${params.queries.length})`
    );
  }

  // Security kill-switch — see router.ts for background.
  const authDisabled = config.security?.enabled === false;

  // Pre-validation: resolve all models and check auth before executing any queries
  const resolved: Array<{ op: QueryOperation; model: ModelProps }> = [];

  for (let i = 0; i < params.queries.length; i++) {
    const op = params.queries[i];

    if (!op.alias || typeof op.alias !== 'string') {
      throw new ValidationError(`Query ${i}: missing or invalid "alias"`);
    }

    if (!op.model || typeof op.model !== 'string') {
      throw new ValidationError(`Query ${i} (${op.alias}): missing or invalid "model"`);
    }

    if (!op.method || !ALLOWED_METHODS.includes(op.method as QueryMethod)) {
      throw new ValidationError(
        `Query ${i} (${op.alias}): invalid method "${op.method}". Allowed: ${ALLOWED_METHODS.join(', ')}`
      );
    }

    const model = findModel(config, op.model);
    if (!model) {
      throw new ValidationError(`Query ${i} (${op.alias}): model "${op.model}" not found`);
    }

    // Authorize against the SAME per-method policy the standalone /rpc path
    // uses (router.ts): sys_read → crudPolicy.read; sys_list / sys_aggregate →
    // crudPolicy.list (falling back to read). Gating EVERY method against `list`
    // let a caller read a row through multi-query that a standalone sys_read
    // correctly 403s whenever a shared-scope model's `read` policy is stricter
    // than its `list` policy.
    const policyOp: 'read' | 'list' = op.method === 'sys_read' ? 'read' : 'list';
    const authLevel =
      policyOp === 'read'
        ? model.crudPolicy?.read
        : model.crudPolicy?.list ?? model.crudPolicy?.read;
    if (!authDisabled) {
      checkAuth(authLevel, user, policyOp, config.roleExpansionMap);
    }
    // Shared-scope sys_list / sys_aggregate also require the read policy — a
    // stricter read is otherwise bypassable by listing/aggregating (no owner
    // filter). Same chokepoint the standalone /rpc path uses.
    enforceSharedScopeReadGate(model, op.method, user, authDisabled, config.roleExpansionMap);

    // API key scope enforcement per query — also per-method (model:read vs model:list)
    if (user.authMethod === 'api_key' && user.apiKeyScopes) {
      if (!hasScope(user.apiKeyScopes, buildCrudScope(op.model, policyOp))) {
        throw new ForbiddenError(`API key lacks scope: model:${op.model}:${policyOp}`);
      }
    }

    resolved.push({ op, model });
  }

  // Execute all queries concurrently with per-query error isolation
  const results = await Promise.allSettled(
    resolved.map(async ({ op, model }): Promise<QueryResult> => {
      try {
        let response: RpcResponse;

        switch (op.method) {
          case 'sys_list':
            response = await sysList(model, (op.params as ListParams) || undefined, user, db, config.models, {
              authDisabled,
              roleExpansionMap: config.roleExpansionMap,
            });
            return {
              alias: op.alias,
              success: true,
              data: response.data,
              ...(response.pagination ? { pagination: response.pagination } : {}),
            };

          case 'sys_aggregate':
            response = await sysAggregate(model, (op.params as unknown as AggregateParams) || undefined, user, db);
            return {
              alias: op.alias,
              success: true,
              data: response.data,
            };

          case 'sys_read':
            response = await sysRead(model, (op.params as unknown as ReadParams) || { id: '' }, user, db);
            return {
              alias: op.alias,
              success: true,
              data: response.data,
            };

          default:
            return {
              alias: op.alias,
              success: false,
              error: { code: 'INVALID_METHOD', message: `Unknown method: ${op.method}` },
            };
        }
      } catch (err) {
        return {
          alias: op.alias,
          success: false,
          error: {
            code: (err as any)?.code || 'QUERY_ERROR',
            message: (err as Error).message || 'Unknown error',
          },
        };
      }
    })
  );

  // Map settled results back to QueryResult objects
  const queryResults: QueryResult[] = results.map((r, i) => {
    if (r.status === 'fulfilled') {
      return r.value;
    }
    return {
      alias: resolved[i].op.alias,
      success: false,
      error: {
        code: 'EXECUTION_ERROR',
        message: (r.reason as Error)?.message || 'Query execution failed',
      },
    };
  });

  return {
    success: true,
    data: { results: queryResults },
  };
}
