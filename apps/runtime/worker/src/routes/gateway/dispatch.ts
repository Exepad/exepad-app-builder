/**
 * Gateway — RPC dispatch and route resolution
 */

import type { Env } from '../../types/env';
import type { AppConfig } from './types';
import { wrapWithCors, workerErrorResponse } from './utils';
import { buildDispatchHeaders, type GatewayIdentity } from './auth';
import { dispatchRpcInProcess } from './dispatch-local';

export interface RpcDispatchTarget {
  method: string;
  name: string;
  type: 'model' | 'handler';
}

// ─── RPC body building ─────────────────────────────────────────────────────

export async function buildRpcBody(
  request: Request,
  routeName: string,
  routeType: 'model' | 'handler',
): Promise<Record<string, unknown>> {
  if (request.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      body = Object.create(null) as Record<string, unknown>;
    }

    if (routeType === 'model' && routeName === '_bulk') {
      return { method: body.method || 'sys_multi_query', params: body.params };
    }

    if (routeType === 'handler') {
      return { method: routeName, params: body };
    }

    const method = body.method || 'sys_list';
    let params: Record<string, unknown>;
    if (body.params) {
      params = body.params as Record<string, unknown>;
    } else if (method === 'sys_create' || method === 'sys_update') {
      const { method: _method, ...formData } = body;
      params = { data: formData };
    } else {
      params = body;
    }
    return { method, model: routeName, params };
  }

  const rawParams = Object.fromEntries(new URL(request.url).searchParams);
  const parsedParams: Record<string, unknown> = { ...rawParams };
  for (const key of ['limit', 'offset'] as const) {
    if (key in parsedParams && typeof parsedParams[key] === 'string') {
      const num = Number(parsedParams[key]);
      if (!isNaN(num)) parsedParams[key] = num;
    }
  }
  return {
    method: routeType === 'model' ? 'sys_list' : routeName,
    model: routeType === 'model' ? routeName : undefined,
    params: parsedParams,
  };
}

export async function parseRpcEnvelope(
  request: Request,
): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') {
    return {};
  }

  try {
    const body = await request.json();
    return body && typeof body === 'object'
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

// ─── Route resolution ───────────────────────────────────────────────────────

export function resolveBackendRoute(
  config: AppConfig,
  routeName: string,
): { type: 'model' | 'handler'; name: string } | null {
  if (routeName === '_bulk') {
    return { type: 'model', name: '_bulk' };
  }

  // Auth routes only require security config — they work regardless of backend mode
  // because the app-backend handles auth via D1 system tables (_auth_users, _auth_sessions).
  if (config.security && (routeName.startsWith('auth_') || routeName.startsWith('admin_'))) {
    return { type: 'handler', name: routeName };
  }

  const backend = config.backend;
  if (!backend || backend.mode !== 'dynamic') return null;

  if (backend.models) {
    const model = backend.models.find((m: { name: string }) => m.name === routeName);
    if (model) return { type: 'model', name: routeName };
  }

  if (backend.handlers) {
    const handler = backend.handlers.find((h: { name: string }) => h.name === routeName);
    if (handler) return { type: 'handler', name: routeName };
  }

  return null;
}

export function resolveRpcDispatchTarget(
  config: AppConfig,
  rpcBody: Record<string, unknown>,
): RpcDispatchTarget | null {
  const method = typeof rpcBody.method === 'string' ? rpcBody.method : '';
  if (!method) return null;

  if (method === 'sys_multi_query') {
    return { method, name: '_bulk', type: 'model' };
  }

  if (method.startsWith('sys_')) {
    const modelName = typeof rpcBody.model === 'string' ? rpcBody.model : '';
    if (!modelName) return null;
    const resolved = resolveBackendRoute(config, modelName);
    if (!resolved || resolved.type !== 'model') return null;
    return { method, name: modelName, type: 'model' };
  }

  const resolved = resolveBackendRoute(config, method);
  if (!resolved) return null;
  return { method, name: resolved.name, type: resolved.type };
}

// ─── Unified dispatch — in-process call to the app-backend ─────────────────

export async function dispatchRpc(
  request: Request,
  appId: string,
  routeName: string,
  routeType: 'model' | 'handler',
  env: Env,
  mode: 'preview' | 'published',
  config: AppConfig | null,
  rpcBodyOverride?: Record<string, unknown>,
  identity?: GatewayIdentity,
): Promise<Response> {
  const origin = request.headers.get('Origin');

  try {
    const headers = await buildDispatchHeaders(request, appId, mode, env, { identity, config });
    headers.set('Content-Type', 'application/json');

    const rpcBody = rpcBodyOverride || await buildRpcBody(request, routeName, routeType);

    const workerResponse = await dispatchRpcInProcess(headers, rpcBody, appId, mode, env);

    return wrapWithCors(workerResponse, origin);
  } catch (error) {
    console.error(`[API Gateway] Worker error for ${appId}/${routeName}:`, error);
    return workerErrorResponse(error);
  }
}
