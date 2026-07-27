/**
 * API Gateway Route Handler (Hono / Cloudflare Workers)
 *
 * Routes API requests to appropriate handlers:
 * - /_files/* -> App Backend (R2-backed file storage)
 * - /_health -> Health check
 * - /mcp -> MCP endpoint (passthrough to app-backend)
 * - /rpc -> Low-level RPC tunnel
 * - Other routes -> App Backend (Auto-CRUD and handlers)
 *
 * The app-backend runs in-process (routes/gateway/dispatch-local.ts); there is
 * no Workers-for-Platforms hop in the self-hosted runtime.
 */

import { Hono } from 'hono';
import type { DeploymentStatus } from '@exepad/types';
import type { Env } from '../../types/env';
import { jsonResponse, corsHeaders } from './utils';
import { resolveGatewayIdentity, validateRouterSecret } from './auth';
import { loadAppConfig, loadFullAppConfigBody, loadExampleConfig } from './config';
import { parseRpcEnvelope, resolveBackendRoute, resolveRpcDispatchTarget, dispatchRpc } from './dispatch';
import { dispatchMcp, dispatchFiles } from './services';
import { userCanAccessApp, resolveAppIdForSegment } from '../../lib/meta-db';

/**
 * When the preview config could not be loaded, peek at the deploy-status
 * file in R2 to disambiguate "still building" from "explicitly failed".
 * Returns a 503 ``DEPLOY_FAILED`` response when the status file exists
 * AND reports ``status:"failed"``; otherwise returns ``null`` and the
 * caller falls back to the existing ``DEPLOY_IN_PROGRESS`` behavior.
 *
 * The status file is small (<1KB) and CONFIG_CACHE is the same R2 bucket
 * used by every other gateway read, so the extra fetch is cheap.
 */
export async function _maybeDeployFailedResponse(
  env: Env,
  appId: string,
): Promise<Response | null> {
  if (!env.CONFIG_CACHE) {
    return null;
  }
  const obj = await env.CONFIG_CACHE.get(`${appId}/deployment-status-preview.json`);
  if (!obj) {
    return null;
  }
  let status: DeploymentStatus;
  try {
    status = (await obj.json()) as DeploymentStatus;
  } catch {
    return null;
  }
  if (status.status !== 'failed') {
    return null;
  }
  return jsonResponse(
    {
      success: false,
      error: {
        code: 'DEPLOY_FAILED',
        message:
          `Preview build for '${appId}' failed` +
          (status.step ? ` at step '${status.step}'.` : '.'),
        retryable: false,
        underlyingError: status.error,
        step: status.step,
      },
    },
    503,
  );
}

export const gateway = new Hono<{ Bindings: Env }>();

gateway.all('/:appId/*', async (c) => {
  const request = c.req.raw;
  const env = c.env;

  const rawAppId = c.req.param('appId')!;
  const url = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  const path = segments.slice(2); // skip 'api' and appId
  const fullPath = path.join('/');

  const PREVIEW_PREFIX = 'preview-';
  const urlIsPreview = rawAppId.startsWith(PREVIEW_PREFIX) && rawAppId.length > PREVIEW_PREFIX.length;
  const segment = urlIsPreview ? rawAppId.substring(PREVIEW_PREFIX.length) : rawAppId;
  // A published app's API is reached at `/api/<slug>/…` (the friendly alias the
  // client reads from the address bar); resolve it to the canonical app id that
  // config loading + dispatch are keyed on. Safe here because the gateway is the
  // catch-all — reserved `/api/*` routes matched their handlers before this runs.
  const appId = resolveAppIdForSegment(segment);
  const mode = (urlIsPreview || request.headers.get('X-Deploy-Mode') === 'preview')
    ? 'preview' as const
    : 'published' as const;

  console.log(`[API Gateway] ${request.method} /api/${appId}/${fullPath}`);

  if (!(await validateRouterSecret(request, env))) {
    const dbgHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '(empty)';
    console.warn(`[API Gateway] Rejected ${appId}/${fullPath} | host="${dbgHost}"`);
    return jsonResponse({
      success: false,
      error: { code: 'FORBIDDEN', message: 'Unauthorized access' },
    }, 403);
  }

  let resolvedIdentityPromise: ReturnType<typeof resolveGatewayIdentity> | null = null;
  const getIdentity = () => {
    if (!resolvedIdentityPromise) {
      resolvedIdentityPromise = resolveGatewayIdentity(request, appId, mode, env);
    }
    return resolvedIdentityPromise;
  };

  const rpcEnvelope = path[0] === 'rpc'
    ? await parseRpcEnvelope(request)
    : null;
  const routeName = path[0] || '';
  const requestedRouteName = routeName === 'rpc'
    ? (typeof rpcEnvelope?.method === 'string' ? rpcEnvelope.method : 'rpc')
    : routeName;

  if (mode === 'preview') {
    const identity = await getIdentity();
    if (!identity.isAuthenticated) {
      return jsonResponse({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Preview access is required' },
      }, 401);
    }
    // Per-operator ownership isolation for the preview DATA plane. A
    // preview-access token (`kind: 'preview_access'`) is already bound to this
    // appId by validatePreviewAccessToken, but a raw platform-session /
    // platform-bridge operator identity authenticates the operator for ANY
    // appId — so we must additionally confirm they own (or collaborate on) THIS
    // app before granting access to its preview data/handlers. Mirrors the
    // ownership gate the admin plane enforces (lib/admin-auth.ts operatorOwnsApp).
    if (identity.kind === 'session' || identity.kind === 'platform_bridge') {
      if (!identity.userId || !userCanAccessApp(identity.userId, appId)) {
        return jsonResponse({
          success: false,
          error: { code: 'FORBIDDEN', message: 'You do not have access to this app preview' },
        }, 403);
      }
    }
  }

  if (fullPath === '_health') {
    return jsonResponse({
      status: 'ok',
      appId,
      bindings: {
        configCache: !!env.CONFIG_CACHE,
        deploySecret: !!env.DEPLOY_SECRET,
      },
    });
  }

  if (fullPath === 'app-config') {
    if (!env.CONFIG_CACHE) {
      return jsonResponse({ error: 'Config cache not available' }, 503);
    }
    const result = await loadFullAppConfigBody(appId, mode, env);
    if (!result) {
      // Explicit no-store so Cloudflare edge does not negative-cache a transient
      // 404 during deploy propagation; subsequent retries must hit the origin.
      //
      // When asked for the PUBLISHED config and only a preview deploy exists,
      // surface that fact via `preview_available: true` + reason
      // ``not_published`` so the SPA can stop retrying immediately and render
      // a "not published yet" state instead of looping on a transient-looking
      // 404. Detection: probe the preview deployment-status object — its mere
      // presence is enough; we don't read the body.
      let previewAvailable = false;
      if (mode === 'published') {
        try {
          const statusKey = `${appId}/deployment-status-preview.json`;
          const statusObj = await env.CONFIG_CACHE.head(statusKey);
          previewAvailable = statusObj !== null;
        } catch {
          // best-effort — if R2 HEAD fails, fall through to plain 404
        }
      }
      const errorBody = previewAvailable
        ? { error: 'not_published', preview_available: true }
        : { error: 'Config not found' };
      return jsonResponse(errorBody, 404, {
        'Cache-Control': 'no-store',
        ...corsHeaders(request.headers.get('Origin')),
      });
    }
    const { body, etag } = result;

    const ifNoneMatch = request.headers.get('If-None-Match');
    const normalizedEtag = ifNoneMatch?.replace(/^W\//, '').replace(/^"|"$/g, '');
    if (normalizedEtag && normalizedEtag === etag) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, ...corsHeaders(request.headers.get('Origin')) },
      });
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'ETag': etag,
      ...corsHeaders(request.headers.get('Origin')),
    };
    // `no-cache` (not `no-store`) — clients keep the response but always
    // revalidate via If-None-Match on next use. The 304 path above makes
    // that cheap while guaranteeing post-deploy freshness without relying
    // on TTL expiry or an out-of-band purge.
    headers['Cache-Control'] = 'no-cache, must-revalidate';
    return new Response(body, { status: 200, headers });
  }

  if (fullPath === 'mcp') {
    let mcpConfig = null;
    if (env.CONFIG_CACHE) {
      mcpConfig = await loadAppConfig(appId, mode, env);
    }
    return dispatchMcp(
      request,
      appId,
      env,
      mode,
      mcpConfig,
      mode === 'preview' ? await getIdentity() : undefined,
    );
  }

  if (routeName === '_files') {
    let config = null;
    if (env.CONFIG_CACHE) config = await loadAppConfig(appId, mode, env);
    if (!config && (!env.USER_WORKERS || env.ENVIRONMENT === 'development')) {
      config = await loadExampleConfig(appId, env);
    }
    return dispatchFiles(
      request,
      appId,
      path.slice(1).join('/'),
      env,
      mode,
      config,
      mode === 'preview' ? await getIdentity() : undefined,
    );
  }

  let config = null;
  if (env.CONFIG_CACHE) {
    config = await loadAppConfig(appId, mode, env);
  }

  if (!config) {
    // auth_me is the SPA's "am I logged in?" probe — it must always return a
    // JSON envelope so the login page can render. Falling through to 404 here
    // would leave the SPA in a retry loop.
    if (requestedRouteName === 'auth_me') {
      return jsonResponse({
        success: true,
        data: { id: null, email: null, name: null, roles: [], isAuthenticated: false },
      });
    }
    if (mode === 'preview') {
      // Disambiguate "deploy hasn't completed yet" from "deploy explicitly
      // failed" by reading the deploy-status file in R2 directly. Without
      // this branch, every failed deploy is reported as DEPLOY_IN_PROGRESS
      // (retryable:true), so the SPA's previewRetry loop polls forever —
      // user sees "Loading app…" indefinitely. 1ybz1p4n (2026-05-19)
      // surfaced this: deployment-status-preview.json had status:"failed"
      // with error="Handler not found in R2: …updateLibrarySettings.js"
      // while the gateway kept returning DEPLOY_IN_PROGRESS.
      const failureResponse = await _maybeDeployFailedResponse(env, appId);
      if (failureResponse) {
        return failureResponse;
      }
      return jsonResponse({
        success: false,
        error: {
          code: 'DEPLOY_IN_PROGRESS',
          message: `Preview for '${appId}' is not ready yet.`,
          retryable: true,
        },
      }, 503);
    }
    return jsonResponse({
      success: false,
      error: {
        code: 'APP_NOT_FOUND',
        message: `App '${appId}' not found.`,
        hint: 'The app may not be deployed.',
      },
    }, 404);
  }

  if (config) {
    if (requestedRouteName === 'auth_me' && !config.security) {
      return jsonResponse({
        success: true,
        data: { id: null, email: null, name: null, roles: [], isAuthenticated: false },
      });
    }

    const resolved = routeName === 'rpc'
      ? resolveRpcDispatchTarget(config, rpcEnvelope || {})
      : resolveBackendRoute(config, routeName);

    if (!resolved) {
      return jsonResponse({
        success: false,
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: `No model or handler named '${requestedRouteName}' found for app '${appId}'.`,
          availableModels: (config.backend?.mode === 'dynamic'
            ? config.backend.models?.map((m: { name: string }) => m.name)
            : []) || [],
          availableHandlers: (config.backend?.mode === 'dynamic'
            ? config.backend.handlers?.map((h: { name: string }) => h.name)
            : []) || [],
        },
      }, 404);
    }

    const rpcResponse = await dispatchRpc(
      request,
      appId,
      resolved.name,
      resolved.type,
      env,
      mode,
      config,
      routeName === 'rpc' ? (rpcEnvelope || {}) : undefined,
      mode === 'preview' ? await getIdentity() : undefined,
    );

    if (requestedRouteName === 'auth_me' && !rpcResponse.ok) {
      // auth_me must never propagate dispatch failures (worker missing, RPC
      // 5xx, etc.) — the SPA needs a JSON envelope to render the login page.
      return jsonResponse({
        success: true,
        data: { id: null, email: null, name: null, roles: [], isAuthenticated: false },
      });
    }

    return rpcResponse;
  }

  // Unreachable: `!config` returns above and `config` returns within its block.
  return jsonResponse({
    success: false,
    error: { code: 'APP_NOT_FOUND', message: `App '${appId}' not found.` },
  }, 404);
});
