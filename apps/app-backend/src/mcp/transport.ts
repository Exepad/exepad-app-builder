/**
 * MCP Streamable HTTP Transport for Cloudflare Workers.
 *
 * POST /mcp — Receives JSON-RPC request, returns JSON-RPC response.
 * GET  /mcp — Returns 405 (no SSE stream for stateless server).
 */

import type { InjectedProps } from '@exepad/types';
import type { UserContext } from '../rpc/types';
import type { Env } from '../types/env';
import type { JsonRpcRequest, JsonRpcResponse } from './types';
import { JSON_RPC_ERRORS } from './types';
import { handleMcpMethod } from './handler';
import { verifyGatewayToken } from './gateway-auth';

/**
 * Handle POST /mcp — JSON-RPC request/response.
 */
export async function handleMcpPost(
  request: Request,
  user: UserContext,
  config: InjectedProps,
  env: Env,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  // Auth gate: require API key or gateway JWT authentication
  let effectiveUser = user;

  if (!user.isAuthenticated || user.authMethod !== 'api_key') {
    // Try gateway JWT fallback (Bearer token that isn't an exepad_sk_* key)
    const authHeader = request.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const gatewayUser = token
      ? await verifyGatewayToken(token, env.GATEWAY_JWT_SECRET, env.APP_ID)
      : null;

    if (gatewayUser) {
      effectiveUser = gatewayUser;
    } else {
      return jsonRpcErrorResponse(
        null,
        JSON_RPC_ERRORS.INTERNAL_ERROR,
        'Authentication required',
        401,
        corsHeaders,
      );
    }
  }

  // Parse JSON body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonRpcErrorResponse(
      null,
      JSON_RPC_ERRORS.PARSE_ERROR,
      'Invalid JSON',
      400,
      corsHeaders,
    );
  }

  // Reject batch requests (arrays) — single request only
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return jsonRpcErrorResponse(
      null,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'Batch requests are not supported; send a single JSON-RPC request',
      400,
      corsHeaders,
    );
  }

  const rpcRequest = body as Record<string, unknown>;

  // Validate JSON-RPC structure
  if (rpcRequest.jsonrpc !== '2.0') {
    return jsonRpcErrorResponse(
      rpcRequest.id ?? null,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'jsonrpc must be "2.0"',
      400,
      corsHeaders,
    );
  }

  if (typeof rpcRequest.method !== 'string') {
    return jsonRpcErrorResponse(
      rpcRequest.id ?? null,
      JSON_RPC_ERRORS.INVALID_REQUEST,
      'method must be a string',
      400,
      corsHeaders,
    );
  }

  // Notifications have no id field — return 202 Accepted
  const isNotification = rpcRequest.id === undefined;

  // Build MCP context
  const ctx = {
    appId: env.APP_ID,
    appAlias: env.APP_ALIAS,
    config,
    user: effectiveUser,
    env,
  };

  // Dispatch to handler
  const { result, error } = await handleMcpMethod(
    rpcRequest as unknown as JsonRpcRequest,
    ctx,
  );

  if (isNotification) {
    return new Response(null, { status: 202, headers: corsHeaders });
  }

  // Build JSON-RPC response
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id: rpcRequest.id as string | number | null,
    ...(error ? { error } : { result }),
  };

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}

/**
 * Handle GET /mcp — returns 405 (no SSE stream for stateless server).
 */
export function handleMcpGet(corsHeaders: Record<string, string>): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'POST', ...corsHeaders },
  });
}

/**
 * Handle DELETE /mcp — returns 405 (no session management).
 */
export function handleMcpDelete(corsHeaders: Record<string, string>): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'POST', ...corsHeaders },
  });
}

// ── Helpers ─────────────────────────────────────────────────────

function jsonRpcErrorResponse(
  id: unknown,
  code: number,
  message: string,
  httpStatus: number,
  corsHeaders: Record<string, string>,
): Response {
  const response: JsonRpcResponse = {
    jsonrpc: '2.0',
    id: id == null ? null : (id as string | number),
    error: { code, message },
  };
  return new Response(JSON.stringify(response), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders,
    },
  });
}
