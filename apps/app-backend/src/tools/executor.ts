/**
 * Tool Executor — routes ToolExecutionRequest to existing CRUD/handler code.
 *
 * This is the bridge between the tool abstraction layer and the existing
 * RPC infrastructure. Auth is always checked, errors are always wrapped.
 */

import type { ToolDefinition, ToolExecutionRequest, ToolExecutionResult, InjectedProps } from '@exepad/types';
import type { Env } from '../types/env';
import type { UserContext, CreateParams, ReadParams, ListParams, UpdateParams, DeleteParams } from '../rpc/types';
import { findModel, findHandler, checkAuth, enforceSharedScopeReadGate } from '../rpc/router';
import { enforceApiKeyScope, buildCrudScope, buildHandlerScope } from '../auth/api-keys';
import { sysCreate } from '../crud/create';
import { sysRead } from '../crud/read';
import { sysList } from '../crud/list';
import { sysUpdate } from '../crud/update';
import { sysDelete } from '../crud/delete';
import { executeHandler } from '../handlers/executor';
import { WorkerError, ValidationError } from '../utils/errors';
import { findToolById } from './discovery';

// ── Tool ID Parsing ─────────────────────────────────────────────

type ParsedToolId =
  | { type: 'crud'; model: string; operation: 'create' | 'read' | 'list' | 'update' | 'delete' }
  | { type: 'handler'; name: string };

const CRUD_OPERATIONS = new Set(['create', 'read', 'list', 'update', 'delete']);

function parseToolId(toolId: string): ParsedToolId | null {
  if (toolId.startsWith('handler__')) {
    const name = toolId.slice(9);
    return name ? { type: 'handler', name } : null;
  }

  const sepIdx = toolId.lastIndexOf('__');
  if (sepIdx === -1) return null;

  const model = toolId.slice(0, sepIdx);
  const operation = toolId.slice(sepIdx + 2);

  if (!model || !CRUD_OPERATIONS.has(operation)) return null;
  return { type: 'crud', model, operation: operation as 'create' | 'read' | 'list' | 'update' | 'delete' };
}

// ── Main Export ──────────────────────────────────────────────────

/**
 * Execute a tool by ID, delegating to existing CRUD functions or handler executor.
 *
 * Auth is checked via the existing `checkAuth()` from the RPC router.
 * All errors are caught and wrapped in ToolExecutionResult.error.
 */
export async function executeTool(
  request: ToolExecutionRequest,
  tools: ToolDefinition[],
  user: UserContext,
  config: InjectedProps,
  env: Env,
): Promise<ToolExecutionResult> {
  const tool = findToolById(tools, request.toolId);
  if (!tool) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Tool '${request.toolId}' not found` },
    };
  }

  const parsed = parseToolId(request.toolId);
  if (!parsed) {
    return {
      success: false,
      error: { code: 'INVALID_REQUEST', message: `Invalid tool ID format: '${request.toolId}'` },
    };
  }

  try {
    const roleExpansionMap = config.roleExpansionMap;

    if (parsed.type === 'crud') {
      return await executeCrudTool(parsed, request.params, user, config, env, roleExpansionMap);
    }

    return await executeHandlerTool(parsed, request.params, user, config, env, roleExpansionMap);
  } catch (error) {
    if (error instanceof WorkerError) {
      return {
        success: false,
        error: { code: error.code, message: error.message, details: error.details },
      };
    }
    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    };
  }
}

// ── CRUD Execution ──────────────────────────────────────────────

async function executeCrudTool(
  parsed: { model: string; operation: 'create' | 'read' | 'list' | 'update' | 'delete' },
  params: Record<string, unknown>,
  user: UserContext,
  config: InjectedProps,
  env: Env,
  roleExpansionMap?: Record<string, string[]>,
): Promise<ToolExecutionResult> {
  const model = findModel(config, parsed.model);
  if (!model) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Model '${parsed.model}' not found` },
    };
  }

  // Param validation — catch missing required fields before they cause confusing deep errors
  validateCrudParams(parsed.operation, params);

  // Auth check — list falls back to read policy when not explicitly set (matches RPC router)
  const authLevel = model.crudPolicy?.[parsed.operation]
    ?? (parsed.operation === 'list' ? model.crudPolicy?.read : undefined);
  // Security kill-switch — see router.ts for background.
  if (config.security?.enabled !== false) {
    checkAuth(authLevel, user, parsed.operation, roleExpansionMap);
  }
  // Shared-scope list also requires the read policy (no owner filter) — same
  // gate the /rpc + multi-query paths use. No-op for non-list operations.
  enforceSharedScopeReadGate(
    model,
    `sys_${parsed.operation}`,
    user,
    config.security?.enabled === false,
    roleExpansionMap,
  );

  enforceApiKeyScope(user, buildCrudScope(parsed.model, parsed.operation));

  const fkOpts = { authDisabled: config.security?.enabled === false };
  let result;
  switch (parsed.operation) {
    case 'create':
      result = await sysCreate(model, { data: params } as CreateParams, user, env.DB, config.models, fkOpts);
      break;
    case 'read':
      result = await sysRead(model, { id: params.id } as ReadParams, user, env.DB);
      break;
    case 'list':
      result = await sysList(model, params as ListParams, user, env.DB, config.models, {
        authDisabled: config.security?.enabled === false,
        roleExpansionMap,
      });
      return {
        success: true,
        data: { records: result?.data, pagination: result?.pagination },
      };
    case 'update':
      result = await sysUpdate(model, { id: params.id, data: params.data } as UpdateParams, user, env.DB, config.models, fkOpts);
      break;
    case 'delete':
      result = await sysDelete(model, { id: params.id } as DeleteParams, user, env.DB);
      break;
  }

  return { success: true, data: result?.data };
}

/** Validate that required params exist for each CRUD operation before delegation. */
function validateCrudParams(
  operation: 'create' | 'read' | 'list' | 'update' | 'delete',
  params: Record<string, unknown>,
): void {
  switch (operation) {
    case 'create':
      if (params == null || typeof params !== 'object' || Object.keys(params).length === 0) {
        throw new ValidationError('At least one field is required for create', 'data');
      }
      break;
    case 'read':
    case 'delete':
      if (params.id === undefined || params.id === null) {
        throw new ValidationError(`'id' is required for ${operation}`, 'id');
      }
      break;
    case 'update':
      if (params.id === undefined || params.id === null) {
        throw new ValidationError("'id' is required for update", 'id');
      }
      if (params.data === undefined || params.data === null || typeof params.data !== 'object') {
        throw new ValidationError("'data' object is required for update", 'data');
      }
      break;
  }
}

// ── Handler Execution ───────────────────────────────────────────

async function executeHandlerTool(
  parsed: { name: string },
  params: Record<string, unknown>,
  user: UserContext,
  config: InjectedProps,
  env: Env,
  roleExpansionMap?: Record<string, string[]>,
): Promise<ToolExecutionResult> {
  const handler = findHandler(config, parsed.name);
  if (!handler) {
    return {
      success: false,
      error: { code: 'NOT_FOUND', message: `Handler '${parsed.name}' not found` },
    };
  }

  const op = handler.handlerType === 'read' ? 'read' : 'create';
  // Security kill-switch — see router.ts for background.
  if (config.security?.enabled !== false) {
    checkAuth(handler.authLevel, user, op, roleExpansionMap);
  }

  enforceApiKeyScope(user, buildHandlerScope(parsed.name));

  const result = await executeHandler(
    handler,
    params,
    user,
    env,
    config.models || [],
  );

  return { success: true, data: result.data };
}
