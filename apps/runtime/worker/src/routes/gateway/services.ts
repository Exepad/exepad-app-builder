/**
 * Gateway — Service endpoint dispatch (MCP, files), in-process.
 *
 * Like RPC dispatch, MCP and file routes now call the app-backend in-process
 * (`fetchAppBackendInProcess` for path-based/streaming routes,
 * `dispatchRpcInProcess` for the file CRUD JSON-RPC sub-methods) instead of
 * routing over WfP or a local HTTP worker.
 */

import type { Env } from '../../types/env';
import type { AppConfig } from './types';
import { jsonResponse, corsHeaders, wrapWithCors, workerErrorResponse } from './utils';
import { buildDispatchHeaders, type GatewayIdentity } from './auth';
import { dispatchRpcInProcess, fetchAppBackendInProcess } from './dispatch-local';

// ─── MCP ────────────────────────────────────────────────────────────────────

export async function dispatchMcp(
  request: Request,
  appId: string,
  env: Env,
  mode: 'preview' | 'published',
  config: AppConfig | null,
  identity?: GatewayIdentity,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  const headers = await buildDispatchHeaders(request, appId, mode, env, { config, identity });
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

  try {
    const workerResponse = await fetchAppBackendInProcess(request, 'mcp', headers, appId, mode, env);
    return wrapWithCors(workerResponse, origin);
  } catch (error) {
    console.error(`[API Gateway] MCP error for ${appId}:`, error);
    return jsonResponse({ error: 'MCP endpoint unavailable' }, 503);
  }
}

// ─── Files ──────────────────────────────────────────────────────────────────

export async function dispatchFiles(
  request: Request,
  appId: string,
  fileSubPath: string,
  env: Env,
  mode: 'preview' | 'published',
  config: AppConfig | null,
  identity?: GatewayIdentity,
): Promise<Response> {
  const origin = request.headers.get('Origin');
  const headers = await buildDispatchHeaders(request, appId, mode, env, { config, identity });

  try {
    // POST _files/upload → forward multipart (streamed) to /files/upload
    if (request.method === 'POST' && fileSubPath === 'upload') {
      const contentType = request.headers.get('Content-Type');
      if (contentType) headers.set('Content-Type', contentType);
      // Forward Content-Length too. buildDispatchHeaders builds a fresh Headers
      // from the identity and drops it otherwise, which kills the app-backend's
      // early-413 size precheck AND makes the byte-rate-limiter charge every
      // upload as the max allowed size (its absent-header fallback) instead of
      // the actual bytes.
      const contentLength = request.headers.get('Content-Length');
      if (contentLength) headers.set('Content-Length', contentLength);
      const resp = await fetchAppBackendInProcess(request, 'files/upload', headers, appId, mode, env);
      return wrapWithCors(resp, origin);
    }

    // GET _files/{id}/{name} → stream binary from /files/{...}
    if (request.method === 'GET' && fileSubPath) {
      const resp = await fetchAppBackendInProcess(request, `files/${fileSubPath}`, headers, appId, mode, env);
      const responseHeaders = new Headers(resp.headers);
      for (const [key, value] of Object.entries(corsHeaders(origin))) {
        responseHeaders.set(key, value);
      }
      responseHeaders.set('X-Content-Type-Options', 'nosniff');
      if (!responseHeaders.has('Content-Security-Policy')) {
        responseHeaders.set('Content-Security-Policy', "script-src 'none'");
      }
      return new Response(resp.body, { status: resp.status, headers: responseHeaders });
    }

    // POST _files/{read|list|delete} → JSON-RPC sys_file_* in-process
    if (request.method === 'POST' && fileSubPath) {
      headers.set('Content-Type', 'application/json');
      let body: Record<string, unknown>;
      try {
        body = await request.json();
      } catch {
        body = {};
      }
      const resp = await dispatchRpcInProcess(
        headers,
        { method: `sys_file_${fileSubPath}`, params: body },
        appId,
        mode,
        env,
      );
      return wrapWithCors(resp, origin);
    }

    return jsonResponse(
      { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } },
      405,
    );
  } catch (error) {
    console.error(`[API Gateway] Files dispatch error for ${appId}/_files/${fileSubPath}:`, error);
    return workerErrorResponse(error);
  }
}
