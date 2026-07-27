/**
 * RPC Router - Routes incoming requests to appropriate handlers
 */

import type { Env, InjectedProps, ModelProps, HandlerProps } from '../types/env';
import { isValidIdentifier } from '@exepad/types';
import type {
  RpcRequest,
  RpcResponse,
  UserContext,
  CreateParams,
  ReadParams,
  ListParams,
  UpdateParams,
  DeleteParams,
} from './types';
import { isCrudMethod } from './types';
import {
  WorkerError,
  InvalidRequestError,
  MethodNotAllowedError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
} from '../utils/errors';
import { sysCreate } from '../crud/create';
import { sysRead } from '../crud/read';
import { sysList } from '../crud/list';
import { sysUpdate } from '../crud/update';
import { sysDelete } from '../crud/delete';
import { sysUpsert } from '../crud/upsert';
import { sysAggregate } from '../crud/aggregate';
import type { AggregateParams } from '../crud/aggregate';
import { sysBatch } from '../crud/batch';
import type { BatchParams } from '../crud/batch';
import { sysMultiQuery } from '../crud/multiQuery';
import type { MultiQueryParams } from '../crud/multiQuery';
import { executeHandler } from '../handlers/executor';
import { sysFileRead, sysFileList, sysFileDelete } from '../file';
import {
  authSignup,
  authSignin,
  authSignout,
  authMe,
  authRequestReset,
  authResetPassword,
  authVerifyEmail,
  authRequestVerification,
  authSocialLogin,
  authSocialComplete,
  validateSession,
  purgeExpiredSessions,
  authCreateApiKey,
  authListApiKeys,
  authRevokeApiKey,
  authRotateApiKey,
  validateApiKey,
  buildApiKeyUserContext,
  hasScope,
  buildCrudScope,
  buildHandlerScope,
  enforceApiKeyScope,
} from '../auth';
/**
 * Parse and validate RPC request from HTTP request
 */
export async function parseRpcRequest(request: Request): Promise<RpcRequest> {
  if (request.method !== 'POST') {
    throw new InvalidRequestError('Only POST method is allowed');
  }

  const contentType = request.headers.get('content-type');
  if (!contentType?.includes('application/json')) {
    throw new InvalidRequestError('Content-Type must be application/json');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new InvalidRequestError('Invalid JSON body');
  }

  if (!body || typeof body !== 'object') {
    throw new InvalidRequestError('Request body must be an object');
  }

  const { method, params, model } = body as Record<string, unknown>;

  if (typeof method !== 'string' || !method) {
    throw new InvalidRequestError('Missing or invalid "method" field');
  }

  return {
    method,
    params: params as Record<string, unknown> | undefined,
    model: model as string | undefined,
  };
}

/**
 * Extract user context from request headers or session token.
 *
 * Resolution priority (per auth plan §8):
 *   1. X-Session-Token → Mode B per-app auth (validate against D1)
 *   2. X-User-Id       → Mode A platform auth (trust headers from gateway)
 *   3. Unauthenticated → Mode 0 / public endpoints
 */
export async function extractUserContext(request: Request, db: D1Database): Promise<UserContext> {
  // Mode B: Per-app session token (set by gateway when exepad_app_session cookie is present)
  const sessionToken = request.headers.get('X-Session-Token');
  if (sessionToken) {
    const sessionUser = await validateSession(sessionToken, db);
    if (sessionUser) return sessionUser;
    // Invalid/expired session — fall through to unauthenticated
  }

  // Mode C: API key authentication (Bearer exepad_sk_*)
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer exepad_sk_')) {
    const rawKey = authHeader.slice(7); // Remove "Bearer " prefix
    const validated = await validateApiKey(rawKey, db);
    if (validated) {
      return buildApiKeyUserContext(validated);
    }
    // Invalid/expired/revoked key — fall through to unauthenticated
  }

  // Mode A: Platform auth headers (set by gateway from Django session)
  const userId = request.headers.get('X-User-Id')?.trim() || '';
  const userEmail = request.headers.get('X-User-Email')?.trim() || '';
  const userRoles = request.headers.get('X-User-Roles');
  const isPreview = request.headers.get('X-Preview-Access') === '1';

  if (!userId) {
    return {
      id: '',
      email: '',
      roles: [],
      isAuthenticated: false,
      authMethod: 'platform_header',
    };
  }

  return {
    id: userId,
    email: userEmail,
    roles: userRoles ? userRoles.split(',').map((r) => r.trim()).filter(Boolean) : [],
    isAuthenticated: true,
    authMethod: 'platform_header',
    isPreview,
  };
}

/**
 * Validate and sanitize an `InjectedProps`. Called by `loadConfig` after
 * extracting the backend slice from the full app config in R2.
 */
export function validateConfig(config: InjectedProps, appId: string): InjectedProps {
  // Ensure models and handlers are arrays (defensive — prevents "t is not iterable" crashes)
  if (!Array.isArray(config.models)) {
    if (config.models) {
      console.error(`[${appId}] config.models is not an array (got ${typeof config.models}), resetting to []`);
    }
    config.models = [];
  }
  if (!Array.isArray(config.handlers)) {
    if (config.handlers) {
      console.error(`[${appId}] config.handlers is not an array (got ${typeof config.handlers}), resetting to []`);
    }
    config.handlers = [];
  }

  // Validate model names — reject invalid SQL identifiers at startup
  if (config.models) {
    config.models = config.models.filter((m) => {
      if (!isValidIdentifier(m.name)) {
        console.error(
          `[${appId}] Invalid model name '${m.name}' — must match /^[a-zA-Z_][a-zA-Z0-9_]*$/. Skipping.`
        );
        return false;
      }
      return true;
    });
  }

  // Validate handler names
  if (config.handlers) {
    config.handlers = config.handlers.filter((h) => {
      if (!isValidIdentifier(h.name)) {
        console.error(
          `[${appId}] Invalid handler name '${h.name}' — must match /^[a-zA-Z_][a-zA-Z0-9_]*$/. Skipping.`
        );
        return false;
      }
      return true;
    });
  }

  // Warn about config mismatches (public reads + user scope = empty results)
  if (config.models) {
    for (const m of config.models) {
      if (m.crudPolicy?.read === 'public' && (m.ownerScope || 'user') === 'user') {
        console.warn(
          `[${appId}] Model '${m.name}': crudPolicy.read is 'public' but ownerScope is 'user'. ` +
          `Public (unauthenticated) reads will return empty results because owner_id filtering still applies. ` +
          `Consider setting ownerScope: 'shared' if this data should be publicly readable.`
        );
      }
    }
  }

  return config;
}

/**
 * Find model by name
 */
export function findModel(config: InjectedProps, modelName: string): ModelProps | undefined {
  return config.models?.find((m) => m.name === modelName);
}

/**
 * Find handler by name
 */
export function findHandler(config: InjectedProps, handlerName: string): HandlerProps | undefined {
  return config.handlers?.find((h) => h.name === handlerName);
}

/**
 * Check authorization for operation.
 *
 * Supports all AccessLevel values:
 * - 'public': anyone can access
 * - 'authenticated': any logged-in user
 * - 'role:X': user must have role X (or a role that inherits X via roleExpansionMap)
 * - 'admin': legacy shorthand for 'role:admin'
 * - 'owner': deferred to ownerScope enforcement in CRUD layer
 * - 'none': always forbidden (operation permanently disabled)
 *
 * For write operations (create/update/delete), authentication is always required
 * even if the policy says 'public' — this prevents anonymous users from creating
 * records with an empty owner_id which would cause shared data leakage (H8).
 */
export function checkAuth(
  requiredLevel: string | undefined,
  user: UserContext,
  operation?: 'create' | 'read' | 'list' | 'update' | 'delete',
  roleExpansionMap?: Record<string, string[]>
): void {
  const level = requiredLevel || 'authenticated';

  // 'none' = permanently blocked, regardless of user
  if (level === 'none') {
    throw new ForbiddenError('This operation is disabled');
  }

  // Write operations always require authentication to prevent empty owner_id (H8)
  const isWriteOp = operation === 'create' || operation === 'update' || operation === 'delete';
  if (isWriteOp && !user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required for write operations');
  }

  if (level === 'public') {
    return; // Anyone can access (reads only at this point)
  }

  // 'owner' is enforced by the CRUD layer's ownerScope logic — just require authentication here
  if (level === 'owner') {
    if (!user.isAuthenticated) {
      throw new UnauthorizedError('Authentication required');
    }
    return;
  }

  if (!user.isAuthenticated) {
    throw new UnauthorizedError('Authentication required');
  }

  if (level === 'authenticated') {
    return; // Any authenticated user
  }

  // Legacy 'admin' shorthand
  if (level === 'admin') {
    if (!user.roles.includes('admin')) {
      throw new ForbiddenError('Admin access required');
    }
    return;
  }

  // Role-based: 'role:editor', 'role:admin', etc.
  if (level.startsWith('role:')) {
    const requiredRole = level.slice(5);

    // Check direct role membership first
    if (user.roles.includes(requiredRole)) return;

    // Check inherited roles via expansion map
    if (roleExpansionMap) {
      for (const userRole of user.roles) {
        const expandedRoles = roleExpansionMap[userRole];
        if (expandedRoles && expandedRoles.includes(requiredRole)) return;
      }
    }

    throw new ForbiddenError(`Role '${requiredRole}' required`);
  }
}

/**
 * Close the shared-scope read-policy bypass for bulk reads.
 *
 * `sys_list` returns every row's full columns and `sys_aggregate` returns
 * min/max/sum/group_concat over them — both gated by the LIST policy. On a
 * `shared`-scope model there is no owner filter, so if `crudPolicy.read` is
 * stricter than `crudPolicy.list`, a caller who clears the list gate can
 * exfiltrate the read-protected column that a standalone `sys_read` would 403.
 * (Owner-scoped models are safe: the owner filter limits list/aggregate to the
 * caller's own rows.)
 *
 * Fix: for `sys_list` / `sys_aggregate` on a shared-scope model, ALSO enforce
 * the read policy. Requiring both list AND read is exactly "the stricter of the
 * two" with no need for a policy-comparison function (which can't totally-order
 * `role:` levels anyway). No-op when read is unset or already ≤ list strictness.
 * NOTE: this also gates count-only aggregates on such models — intentional; a
 * model whose details are admin-only shouldn't expose aggregates to non-admins,
 * and per-aggregation column analysis isn't worth the complexity here.
 */
export function enforceSharedScopeReadGate(
  model: ModelProps,
  method: string,
  user: UserContext,
  authDisabled: boolean,
  roleExpansionMap?: Record<string, string[]>
): void {
  if (authDisabled) return;
  if (method !== 'sys_list' && method !== 'sys_aggregate') return;
  if (model.ownerScope !== 'shared') return;
  const read = model.crudPolicy?.read;
  if (!read) return;
  checkAuth(read, user, 'read', roleExpansionMap);
}

/**
 * Route and execute RPC request
 */
export async function routeRpcRequest(
  rpcRequest: RpcRequest,
  user: UserContext,
  config: InjectedProps,
  env: Env,
  request: Request
): Promise<RpcResponse> {
  const { method, params, model: modelName } = rpcRequest;
  const roleExpansionMap = config.roleExpansionMap;
  // Security kill-switch: admin explicitly disabled authentication for this
  // app. Bypass checkAuth at every enforcement point and treat all CRUD /
  // handler calls as public. The flag is set by the runtime gateway
  // injecting `X-Exepad-Auth-Disabled` into `config.security.enabled` at
  // the entry point in `index.ts`.
  const authDisabled = config.security?.enabled === false;

  // Dev-only: execute DDL statements to set up schema for example apps
  if (method === 'sys_dev_setup') {
    if (env.ENVIRONMENT !== 'development') {
      throw new MethodNotAllowedError('sys_dev_setup is only available in development');
    }
    const statements = (params?.statements as string[]) || [];
    let executed = 0;
    for (const sql of statements) {
      try {
        await env.DB.prepare(sql).run();
        executed++;
      } catch (error) {
        console.warn(`[sys_dev_setup] Statement failed: ${sql.slice(0, 80)}...`, error);
      }
    }
    console.log(`[sys_dev_setup] Executed ${executed}/${statements.length} DDL statements`);
    return { success: true, data: { executed, total: statements.length } };
  }

  // Handle CRUD operations
  if (isCrudMethod(method)) {
    if (!modelName) {
      throw new InvalidRequestError('CRUD operations require "model" field');
    }

    const model = findModel(config, modelName);
    if (!model) {
      throw new NotFoundError('Model', modelName);
    }

    // Get auth level for this operation
    // Upsert uses 'create' policy since it may insert new rows
    const rawOp = method.replace('sys_', '') as 'create' | 'read' | 'list' | 'update' | 'delete' | 'upsert';
    const policyOp = rawOp === 'upsert' ? 'create' : rawOp;
    // Fall back list→read: listing is a bulk read, so inherit read policy when list is not explicitly set
    const authLevel = model.crudPolicy?.[policyOp] ?? (policyOp === 'list' ? model.crudPolicy?.read : undefined);
    if (!authDisabled) {
      checkAuth(authLevel, user, policyOp, roleExpansionMap);
    }
    // Shared-scope sys_list also requires the read policy (no owner filter).
    enforceSharedScopeReadGate(model, method, user, authDisabled, roleExpansionMap);

    enforceApiKeyScope(user, buildCrudScope(modelName!, policyOp));
    // sys_upsert runs INSERT ... ON CONFLICT DO UPDATE, so it can OVERWRITE an
    // existing row. A key granted only `model:X:create` must not be able to
    // rewrite prior records through upsert, so require the `update` scope in
    // addition to `create` (least-privilege: append-only keys stay append-only).
    if (rawOp === 'upsert') {
      enforceApiKeyScope(user, buildCrudScope(modelName!, 'update'));
    }

    // Route to CRUD handler.
    // Params arrive as Record<string, unknown> from JSON parsing; each CRUD
    // function validates required fields internally and throws ValidationError
    // if they're missing — so the cast through `unknown` is safe here.
    const p = (params ?? {}) as unknown;
    switch (method) {
      case 'sys_create':
        return await sysCreate(model, p as CreateParams, user, env.DB, config.models, { authDisabled });
      case 'sys_read':
        return await sysRead(model, p as ReadParams, user, env.DB);
      case 'sys_list':
        return await sysList(model, p as ListParams, user, env.DB, config.models, {
          authDisabled,
          roleExpansionMap,
        });
      case 'sys_update':
        return await sysUpdate(model, p as UpdateParams, user, env.DB, config.models, { authDisabled });
      case 'sys_delete':
        return await sysDelete(model, p as DeleteParams, user, env.DB);
      case 'sys_upsert':
        return await sysUpsert(model, p as CreateParams, user, env.DB, config.models, { authDisabled });
    }
  }

  // Handle sys_aggregate (requires model, uses list policy)
  if (method === 'sys_aggregate') {
    if (!modelName) {
      throw new InvalidRequestError('sys_aggregate requires "model" field');
    }
    const model = findModel(config, modelName);
    if (!model) {
      throw new NotFoundError('Model', modelName);
    }
    const authLevel = model.crudPolicy?.list ?? model.crudPolicy?.read;
    if (!authDisabled) {
      checkAuth(authLevel, user, 'list', roleExpansionMap);
    }
    // Shared-scope aggregate also requires the read policy (no owner filter).
    enforceSharedScopeReadGate(model, 'sys_aggregate', user, authDisabled, roleExpansionMap);

    enforceApiKeyScope(user, buildCrudScope(modelName, 'list'));

    return await sysAggregate(model, params as unknown as AggregateParams, user, env.DB);
  }

  // Handle sys_batch (no top-level model — auth checked per operation inside)
  if (method === 'sys_batch') {
    return await sysBatch(params as unknown as BatchParams, user, config, env.DB);
  }

  // Handle sys_multi_query (bulk read — auth checked per query inside)
  if (method === 'sys_multi_query') {
    return await sysMultiQuery(params as unknown as MultiQueryParams, user, config, env.DB);
  }

  // Handle sys_file_* methods (metadata operations via normal RPC).
  // Upload and serve are handled at the URL path level in index.ts —
  // only read/list/delete go through the RPC router.
  if (method.startsWith('sys_file_')) {
    if (!config.storage?.enabled) {
      throw new MethodNotAllowedError('File storage is not enabled for this app');
    }
    const p = params || {};
    switch (method) {
      case 'sys_file_read':
        return await sysFileRead(p, user, env.DB, config, env.APP_ID);
      case 'sys_file_list':
        return await sysFileList(p, user, env.DB, config, env.APP_ID);
      case 'sys_file_delete':
        return await sysFileDelete(p, user, env, config, env.APP_ID);
      default:
        throw new MethodNotAllowedError(method);
    }
  }

  // Handle auth_* methods (per-app auth, Mode B)
  // Auth endpoints return 200 with { success: false } for expected failures
  // (invalid credentials, validation) — never 401/400 HTTP errors, so the
  // browser console stays clean for end users.
  if (method.startsWith('auth_') && config.security) {
    const security = config.security;
    const p = params || {};
    try {
      let result;
      switch (method) {
        case 'auth_signup':
          result = await authSignup(p, env.DB, security, request, {
            env,
            appName: env.APP_ALIAS,
            emailConfig: { fromAddress: env.EMAIL_FROM_ADDRESS, fromName: env.EMAIL_FROM_NAME },
            models: config.models,
            handlers: config.handlers,
          });
          break;
        case 'auth_signin':
          result = await authSignin(p, env.DB, security);
          break;
        case 'auth_signout':
          result = await authSignout(p, env.DB, security, request);
          break;
        case 'auth_me':
          result = await authMe(p, env.DB, security, request, user);
          break;
        case 'auth_request_reset':
          result = await authRequestReset(p, env.DB, security, request, {
            env,
            appName: env.APP_ALIAS,
            emailConfig: { fromAddress: env.EMAIL_FROM_ADDRESS, fromName: env.EMAIL_FROM_NAME },
          });
          break;
        case 'auth_reset_password':
          result = await authResetPassword(p, env.DB, security);
          break;
        case 'auth_verify_email':
          result = await authVerifyEmail(p, env.DB, security);
          break;
        case 'auth_request_verification':
          result = await authRequestVerification(p, env.DB, security, request, {
            env,
            appName: env.APP_ALIAS,
            emailConfig: { fromAddress: env.EMAIL_FROM_ADDRESS, fromName: env.EMAIL_FROM_NAME },
          });
          break;
        // OAuth social login (init + complete)
        case 'auth_social_login':
          result = await authSocialLogin(p, env.DB, security, env);
          break;
        case 'auth_social_complete':
          result = await authSocialComplete(p, env.DB, security, {
            models: config.models,
            handlers: config.handlers,
          });
          break;
        // API key management (requires authenticated user via session or platform headers)
        case 'auth_create_api_key':
          result = await authCreateApiKey(p, env.DB, user);
          break;
        case 'auth_list_api_keys':
          result = await authListApiKeys(p, env.DB, user);
          break;
        case 'auth_revoke_api_key':
          result = await authRevokeApiKey(p, env.DB, user);
          break;
        case 'auth_rotate_api_key':
          result = await authRotateApiKey(p, env.DB, user);
          break;
        default:
          throw new MethodNotAllowedError(method);
      }
      return { success: true, data: result };
    } catch (error) {
      // Convert auth errors to structured 200 responses
      if (error instanceof WorkerError) {
        return { success: false, error: error.toJSON() };
      }
      // D1/crypto/native errors — return structured error instead of letting
      // them bubble to a generic HTTP 500
      console.error(`[auth] ${method} unhandled error:`, error);
      return {
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred. Please try again.',
        },
      };
    }
  }

  // Handle admin_* methods (platform admin, requires SERVICE_TOKEN)
  // SERVICE_TOKEN is verified at the entry point before reaching here.
  if (method.startsWith('admin_')) {
    if (method === 'admin_cleanup_sessions') {
      const purged = await purgeExpiredSessions(env.DB);
      return { success: true, data: { purged } };
    }
    // TODO: Phase 4 — admin handlers.
    // When admin_update_role is added, it MUST invalidate all sessions for the
    // target user (DELETE FROM _auth_sessions WHERE user_id = ?) to ensure
    // role changes take effect immediately.
    throw new MethodNotAllowedError(method);
  }

  // Handle custom handlers
  // Write handlers (default) always require authentication to prevent empty
  // owner_id on INSERTs (H8 guard). Read handlers respect authLevel as-is.
  const handler = findHandler(config, method);
  if (handler) {
    const op = handler.handlerType === 'read' ? 'read' : 'create';
    if (!authDisabled) {
      checkAuth(handler.authLevel, user, op, roleExpansionMap);
    }

    enforceApiKeyScope(user, buildHandlerScope(method));

    return await executeHandler(handler, params || {}, user, env, config.models || []);
  }

  // Method not found
  throw new MethodNotAllowedError(method);
}

/**
 * Create success response
 */
export function successResponse<T>(data: T, pagination?: RpcResponse['pagination']): Response {
  const response: RpcResponse<T> = {
    success: true,
    data,
    ...(pagination && { pagination }),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
