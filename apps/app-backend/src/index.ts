/**
 * Exepad App Backend - Entry Point
 *
 * A `fetch(request, env)` module that handles, for ONE app:
 * - Auto-CRUD operations for models (sys_create, sys_read, sys_list, sys_update, sys_delete)
 * - Custom handler execution
 * - Per-app auth (auth_*), file upload/serve, and the MCP endpoint
 *
 * In the self-hosted runtime this module is imported by the runtime worker and
 * invoked IN-PROCESS, once per request, with an `Env` assembled per {appId,mode}
 * from the local adapters (SQLite + filesystem) — see
 * `apps/runtime/worker/src/server/build-user-env.ts`. There is no separate
 * service and no per-app deploy step.
 */

import type { Env } from './types/env';
import {
  parseRpcRequest,
  extractUserContext,
  routeRpcRequest,
} from './rpc/router';
import { loadConfig } from './context/config-loader';
import { errorResponse, WorkerError, ForbiddenError } from './utils/errors';
import { timingSafeStringEqual } from './auth/utils';
import { checkRateLimit, checkFileUploadRateLimit, deriveAuthRateLimit, checkAuthRateLimit, type RateLimitResult } from './middleware/rateLimit';
import { writeMetric } from './utils/analytics';
import { handleMcpPost, handleMcpGet, handleMcpDelete } from './mcp';
import { handleFileUpload, handleFileServe } from './file';

/** Maximum allowed request body size in bytes (1MB) — for RPC requests */
const MAX_BODY_SIZE = 1 * 1024 * 1024;

/** Default max file upload size in bytes (10MB) — overridable via StorageProps */
const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * Generate a unique request ID for tracing
 */
function generateRequestId(): string {
  return crypto.randomUUID();
}

/**
 * Build CORS headers based on environment config
 */
function getCorsHeaders(env: Env, requestOrigin?: string | null): Record<string, string> {
  const allowedOrigins = env.ALLOWED_ORIGINS;

  let origin = '*';
  let isAllowlisted = false;
  if (allowedOrigins && allowedOrigins !== '*') {
    const origins = allowedOrigins.split(',').map((o) => o.trim());
    if (requestOrigin && origins.includes(requestOrigin)) {
      origin = requestOrigin;
      isAllowlisted = true;
    } else {
      origin = origins[0];
      isAllowlisted = true;
    }
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Cookie, X-User-Id, X-User-Email, X-User-Roles, X-Service-Token, X-Session-Token, X-Request-Id',
    'Access-Control-Max-Age': '86400',
  };

  // credentials: 'include' requires Allow-Credentials and a specific (non-wildcard) origin.
  // Only set this when the origin matched a configured ALLOWED_ORIGINS entry —
  // never reflect an arbitrary origin with credentials (prevents cross-site cookie attacks).
  if (isAllowlisted && origin !== '*') {
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}


/**
 * Verify service-to-service authentication token.
 * When SERVICE_TOKEN is configured, requests must include a matching X-Service-Token header.
 * This prevents direct access to the worker by anyone who discovers its URL.
 *
 * In production/staging, SERVICE_TOKEN is REQUIRED — if it's missing from env config,
 * requests are rejected to prevent unauthenticated access via forged headers.
 */
function verifyServiceToken(request: Request, env: Env): void {
  const expectedToken = env.SERVICE_TOKEN;
  if (!expectedToken) {
    // In production/staging/selfhost, SERVICE_TOKEN must be configured — reject
    // if missing. The self-host runtime always populates an (ephemeral if
    // unset) token in-process (see build-runtime-env.ts), so an empty token
    // here means a genuine misconfiguration; fail CLOSED rather than trust
    // forged X-User-* headers.
    if (
      env.ENVIRONMENT === 'production' ||
      env.ENVIRONMENT === 'staging' ||
      env.ENVIRONMENT === 'selfhost'
    ) {
      console.error(
        `[${env.APP_ID}] CRITICAL: SERVICE_TOKEN not configured in ${env.ENVIRONMENT}. ` +
        `Rejecting request to prevent unauthenticated access.`
      );
      throw new ForbiddenError('Service misconfigured');
    }
    // Development: skip verification (backward compat)
    return;
  }

  const providedToken = request.headers.get('X-Service-Token');
  if (!providedToken || !timingSafeStringEqual(providedToken, expectedToken)) {
    throw new ForbiddenError('Invalid or missing service token');
  }
}

/**
 * Check request body size against the configured limit.
 * Uses Content-Length header when available; for chunked requests without the
 * header, reads the body into an ArrayBuffer and checks the actual size.
 * Returns the request unchanged if Content-Length is present, or a new
 * Request with the buffered body if it had to be read.
 */
async function checkBodySize(request: Request): Promise<Request> {
  const contentLength = request.headers.get('Content-Length');
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > MAX_BODY_SIZE) {
      throw new WorkerError(
        'INVALID_REQUEST',
        `Request body too large. Maximum size is ${MAX_BODY_SIZE} bytes.`,
        413
      );
    }
    return request;
  }

  // No Content-Length — read the body and check actual size
  if (request.body) {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_SIZE) {
      throw new WorkerError(
        'INVALID_REQUEST',
        `Request body too large. Maximum size is ${MAX_BODY_SIZE} bytes.`,
        413
      );
    }
    // Return a new request with the buffered body so downstream can read it
    return new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body,
    });
  }

  return request;
}

/**
 * Build rate-limit response headers (M2).
 * Included on ALL responses when rate limiting is active.
 */
function rateLimitHeaders(rl: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Remaining': String(rl.remaining),
    'X-RateLimit-Reset': String(rl.resetAt),
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Use incoming request ID from Runtime if present, else generate one (H4)
    const requestId = request.headers.get('X-Request-Id') || generateRequestId();
    const requestOrigin = request.headers.get('Origin');
    const corsHeaders = getCorsHeaders(env, requestOrigin);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Health check endpoint
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(
        JSON.stringify({
          status: 'ok',
          appId: env.APP_ID,
          timestamp: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // MCP endpoint — Streamable HTTP transport for AI agent access.
    // Intercepts BEFORE SERVICE_TOKEN verification because MCP clients
    // authenticate via API key, not the runtime→worker service token.
    if (url.pathname === '/mcp') {
      const config = await loadConfig(env);

      // Config gate: MCP must be explicitly enabled
      if (!config.mcp?.enabled) {
        return new Response(
          JSON.stringify({ error: 'MCP is not enabled for this app' }),
          { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
        );
      }

      if (request.method === 'GET') return handleMcpGet(corsHeaders);
      if (request.method === 'DELETE') return handleMcpDelete(corsHeaders);

      if (request.method === 'POST') {
        // Rate limiting — same mechanism as RPC path
        if (env.RATE_LIMIT_KV) {
          const rlKey =
            request.headers.get('X-User-Id') ||
            request.headers.get('CF-Connecting-IP') ||
            'anonymous';
          const max = parseInt(env.RATE_LIMIT_MAX || '100', 10);
          const window = parseInt(env.RATE_LIMIT_WINDOW || '60', 10);
          const rlResult = await checkRateLimit(env.RATE_LIMIT_KV, rlKey, max, window);

          if (!rlResult.allowed) {
            return new Response(
              JSON.stringify({
                success: false,
                error: { code: 'RATE_LIMITED', message: 'Too many requests' },
              }),
              {
                status: 429,
                headers: {
                  'Content-Type': 'application/json',
                  'Retry-After': String(rlResult.resetAt - Math.floor(Date.now() / 1000)),
                  ...rateLimitHeaders(rlResult),
                  'X-Request-Id': requestId,
                  ...corsHeaders,
                },
              }
            );
          }
        }

        const checkedRequest = await checkBodySize(request);
        const user = await extractUserContext(checkedRequest, env.DB);
        await env.DB.prepare('PRAGMA foreign_keys = ON').run();
        return handleMcpPost(checkedRequest, user, config, env, corsHeaders);
      }

      return new Response(null, {
        status: 405,
        headers: { Allow: 'POST', ...corsHeaders },
      });
    }

    // File routes — intercepted before RPC parsing (like MCP).
    // These handle non-JSON content types (multipart upload, binary serve).
    if (url.pathname.startsWith('/files/')) {
      try {
        const config = await loadConfig(env);

        if (!config.storage?.enabled) {
          return new Response(
            JSON.stringify({ success: false, error: { code: 'STORAGE_DISABLED', message: 'File storage is not enabled for this app' } }),
            { status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
          );
        }

        // POST /files/upload → multipart file upload
        if (url.pathname === '/files/upload' && request.method === 'POST') {
          // Verify service token (file uploads come through the gateway)
          if (!request.headers.get('Authorization')?.startsWith('Bearer exepad_sk_')) {
            verifyServiceToken(request, env);
          }

          // File-specific size limit (default 10MB, overridable via config)
          const maxSize = config.storage.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
          const contentLength = request.headers.get('Content-Length');
          if (contentLength) {
            const size = parseInt(contentLength, 10);
            if (!isNaN(size) && size > maxSize) {
              const maxMB = (maxSize / 1024 / 1024).toFixed(1);
              return new Response(
                JSON.stringify({ success: false, error: { code: 'INVALID_REQUEST', message: `File too large. Maximum size is ${maxMB} MB.` } }),
                { status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders } },
              );
            }
          }

          // File-specific rate limiting
          if (env.RATE_LIMIT_KV) {
            const rlUserId = request.headers.get('X-User-Id') || null;
            const rlIp = request.headers.get('CF-Connecting-IP') || null;
            // Account against the DECLARED Content-Length, but when it is absent
            // or unparseable (e.g. a chunked-transfer upload) fall back to the
            // max allowed size rather than 0 — otherwise the bytes-per-hour
            // bandwidth throttle could be bypassed entirely by omitting the
            // header. The body is still hard-capped by the worker bodyLimit.
            const declared = parseInt(request.headers.get('Content-Length') || '', 10);
            const bytesForRl = Number.isFinite(declared) && declared > 0 ? declared : maxSize;
            const fileRl = await checkFileUploadRateLimit(
              env.RATE_LIMIT_KV,
              rlUserId,
              rlIp,
              bytesForRl,
            );
            if (!fileRl.allowed) {
              const msgs: Record<string, string> = {
                upload_count: 'Too many file uploads. Please try again later.',
                upload_bytes: 'Upload bandwidth limit exceeded. Please try again later.',
                ip_upload_count: 'Too many uploads from this IP. Please sign in or try later.',
              };
              return new Response(
                JSON.stringify({
                  success: false,
                  error: {
                    code: 'RATE_LIMITED',
                    message: msgs[fileRl.limitExceeded!] || 'Upload rate limit exceeded',
                  },
                }),
                {
                  status: 429,
                  headers: {
                    'Content-Type': 'application/json',
                    'Retry-After': String(Math.max(0, fileRl.resetAt - Math.floor(Date.now() / 1000))),
                    'X-RateLimit-Remaining': '0',
                    'X-RateLimit-Reset': String(fileRl.resetAt),
                    ...corsHeaders,
                  },
                },
              );
            }
          }

          const user = await extractUserContext(request, env.DB);
          await env.DB.prepare('PRAGMA foreign_keys = ON').run();
          const response = await handleFileUpload(request, user, config, env);
          // Add CORS headers to response
          const headers = new Headers(response.headers);
          for (const [key, value] of Object.entries(corsHeaders)) {
            headers.set(key, value);
          }
          headers.set('X-Request-Id', requestId);
          return new Response(response.body, { status: response.status, headers });
        }

        // GET /files/{id}/{filename} → binary file serve
        if (request.method === 'GET') {
          // Service token verification for file serve
          // Skip for API key auth (Bearer exepad_sk_*)
          if (!request.headers.get('Authorization')?.startsWith('Bearer exepad_sk_')) {
            verifyServiceToken(request, env);
          }

          const user = await extractUserContext(request, env.DB);
          await env.DB.prepare('PRAGMA foreign_keys = ON').run();
          const response = await handleFileServe(request, user, config, env);
          // Add CORS + security headers
          const headers = new Headers(response.headers);
          for (const [key, value] of Object.entries(corsHeaders)) {
            headers.set(key, value);
          }
          headers.set('X-Request-Id', requestId);
          return new Response(response.body, { status: response.status, headers });
        }

        return new Response(null, {
          status: 405,
          headers: { Allow: 'POST, GET', ...corsHeaders },
        });
      } catch (error) {
        console.error(`[AppBackend] [${requestId}] File route error:`, error);
        const response = errorResponse(error as Error);
        const headers = new Headers(response.headers);
        headers.set('X-Request-Id', requestId);
        for (const [key, value] of Object.entries(corsHeaders)) {
          headers.set(key, value);
        }
        return new Response(response.body, { status: response.status, headers });
      }
    }

    const startTime = Date.now();
    let rpcMethod = 'unknown';
    let rpcModel: string | undefined;
    let rlResult: RateLimitResult | undefined;

    try {
      // Rate limiting (H3) — opt-in via RATE_LIMIT_KV binding
      if (env.RATE_LIMIT_KV) {
        const rlKey =
          request.headers.get('X-User-Id') ||
          request.headers.get('CF-Connecting-IP') ||
          'anonymous';
        const max = parseInt(env.RATE_LIMIT_MAX || '100', 10);
        const window = parseInt(env.RATE_LIMIT_WINDOW || '60', 10);
        rlResult = await checkRateLimit(env.RATE_LIMIT_KV, rlKey, max, window);

        if (!rlResult.allowed) {
          return new Response(
            JSON.stringify({
              success: false,
              error: { code: 'RATE_LIMITED', message: 'Too many requests' },
            }),
            {
              status: 429,
              headers: {
                'Content-Type': 'application/json',
                'Retry-After': String(rlResult.resetAt - Math.floor(Date.now() / 1000)),
                ...rateLimitHeaders(rlResult),
                'X-Request-Id': requestId,
                ...corsHeaders,
              },
            }
          );
        }
      }

      // Check body size limit (may buffer the body for chunked requests)
      const checkedRequest = await checkBodySize(request);

      // Parse RPC request
      const rpcRequest = await parseRpcRequest(checkedRequest);
      rpcMethod = rpcRequest.method;
      // The parsed request carries `model` at the top level (parseRpcRequest
      // lifts it out of params); reading params.model here left the metric's
      // model undefined for every RPC. Prefer top-level, fall back to params.
      rpcModel =
        (rpcRequest.model as string | undefined) ??
        (rpcRequest.params?.model as string | undefined);

      // Auth brute-force / spam throttle — tighter than the generic cap above
      // and keyed on the targeted account (self-host has no client IP). Uses the
      // DURABLE SQLite-backed limiter (survives process restarts and FAILS CLOSED
      // for account-targeted auth) via env.DB, which self-host always binds; falls
      // back to the KV counter when only that is present. Runs unconditionally for
      // throttled auth methods rather than being gated on the opt-in RATE_LIMIT_KV.
      {
        const authLimit = deriveAuthRateLimit(rpcMethod, rpcRequest.params);
        if (authLimit) {
          const authRl = await checkAuthRateLimit(authLimit, {
            db: env.DB,
            kv: env.RATE_LIMIT_KV,
          });
          if (!authRl.allowed) {
            return new Response(
              JSON.stringify({
                success: false,
                error: {
                  code: 'RATE_LIMITED',
                  message: 'Too many attempts. Please wait and try again.',
                },
              }),
              {
                status: 429,
                headers: {
                  'Content-Type': 'application/json',
                  'Retry-After': String(authRl.resetAt - Math.floor(Date.now() / 1000)),
                  ...rateLimitHeaders(authRl),
                  'X-Request-Id': requestId,
                  ...corsHeaders,
                },
              },
            );
          }
        }
      }

      // SERVICE_TOKEN verification (D4 fix):
      // - admin_* methods: always require SERVICE_TOKEN
      // - auth_* methods: skip (called by browsers through the gateway)
      // - sys_dev_* methods: require SERVICE_TOKEN (defense-in-depth — also guarded
      //   by ENVIRONMENT check in routeRpcRequest, but double-gating prevents
      //   arbitrary SQL execution if ENVIRONMENT is misconfigured)
      // - all other methods: require SERVICE_TOKEN if configured (backward compat)
      if (!rpcMethod.startsWith('auth_')) {
        verifyServiceToken(request, env);
      }

      // Extract user context — async for Mode B session validation against D1
      const user = await extractUserContext(checkedRequest, env.DB);

      // Load app config from the CONFIG_CACHE store (cached in module scope by ETag).
      const config = await loadConfig(env);

      // Gateway security kill-switch: the runtime gateway reads fresh config
      // from the same store on every RPC request. If the admin toggled "Enable
      // Authentication" off, the gateway sets X-Exepad-Auth-Disabled: 1
      // (see apps/runtime/worker/src/routes/gateway/auth.ts). Honor it here
      // even if the cached config still has security.enabled true — this is
      // how the toggle takes effect without a per-app republish.
      if (checkedRequest.headers.get('X-Exepad-Auth-Disabled') === '1') {
        config.security = { ...(config.security || {}), enabled: false };
      }

      // Enable foreign key enforcement for this request
      await env.DB.prepare('PRAGMA foreign_keys = ON').run();

      // Route and execute request
      const result = await routeRpcRequest(rpcRequest, user, config, env, checkedRequest);

      // Emit success metric
      writeMetric(env.ANALYTICS, {
        operation: rpcMethod,
        model: rpcModel,
        duration: Date.now() - startTime,
        success: true,
        userId: user.id || request.headers.get('X-User-Id') || undefined,
        statusCode: 200,
      });

      // Build response headers
      const responseHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
        ...(rlResult ? rateLimitHeaders(rlResult) : {}),
        ...corsHeaders,
      };

      // Handle auth Set-Cookie signals from auth_* handlers
      const data = result.data as Record<string, unknown> | undefined;
      if (data && (data._sessionToken || data._clearSession)) {
        const host = request.headers.get('Origin')
          ? new URL(request.headers.get('Origin')!).hostname
          : request.headers.get('Host')?.split(':')[0] || 'localhost';
        const isLocalDev = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
        const isSecure = !isLocalDev;
        // No Domain attribute: the cookie is host-only, scoped exactly to the
        // serving host. Deriving Domain from the client-supplied Origin/Host
        // header (with no allowlist) let a crafted Origin broaden the cookie to
        // a parent domain / sibling subdomains. Host-only matches the operator
        // platform-session cookie (routes/auth.ts buildSessionCookie).

        if (data._sessionToken) {
          const maxAge = config.security?.sessionDuration ?? 604800;
          responseHeaders['Set-Cookie'] =
            `exepad_app_session=${data._sessionToken}; HttpOnly; ${isSecure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${maxAge}`;
          delete data._sessionToken;
        }
        if (data._clearSession) {
          responseHeaders['Set-Cookie'] =
            `exepad_app_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
          delete data._clearSession;
        }
      }

      // Return success response with rate-limit headers on all responses (M2)
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: responseHeaders,
      });
    } catch (error) {
      // Log error for debugging
      console.error(`[AppBackend] [${requestId}] Error:`, error);

      // Return error response
      const response = errorResponse(error as Error);

      // Emit error metric
      writeMetric(env.ANALYTICS, {
        operation: rpcMethod,
        model: rpcModel,
        duration: Date.now() - startTime,
        success: false,
        userId: request.headers.get('X-User-Id') || undefined,
        statusCode: response.status,
      });

      // Add CORS, tracing, and rate-limit headers to error response
      const headers = new Headers(response.headers);
      headers.set('X-Request-Id', requestId);
      if (rlResult) {
        headers.set('X-RateLimit-Remaining', String(rlResult.remaining));
        headers.set('X-RateLimit-Reset', String(rlResult.resetAt));
      }
      for (const [key, value] of Object.entries(corsHeaders)) {
        headers.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    }
  },
};

// Export types for external use
export type { Env } from './types/env';
export type { RpcRequest, RpcResponse, UserContext } from './rpc/types';
