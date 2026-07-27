import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { compress } from 'hono/compress';
import type { Env } from './types/env';
import { gateway } from './routes/gateway';
import { deploy } from './routes/deploy';
import { deprovision } from './routes/deprovision';
import { admin } from './routes/admin';
import { email } from './routes/email';
import { diagnostic } from './routes/diagnostic';
import { auth, requirePlatformUser } from './routes/auth';
import { orchestrate } from './routes/orchestrate';
import { settings } from './routes/settings';
import { domains } from './routes/domains';
import { network } from './routes/network';
import { publish } from './routes/publish';
import { quickAccess } from './routes/quick-access';
import { securityHeaders } from './lib/security-headers';
import { injectMeta, resolveCanonicalBase, buildPreviewAccessCookieHeaders } from './lib/meta-injector';
import { loadAppConfig, escapeHtml, isAuthRequired, invalidateConfig } from './lib/app-config';
import { invalidateGatewayConfig } from './routes/gateway/config';
import {
  mintPreviewAccessToken,
  resolveGatewayIdentity,
  validatePreviewAccessToken,
} from './routes/gateway/auth';
import { resolveSecret } from './lib/secrets';
import { getCookieValue } from './routes/gateway/utils';
import { constantTimeEqual } from './lib/crypto-utils';
import { initLogLevel } from './lib/logger';
import { rateLimiter } from './lib/rate-limit';
import { isRuntimeStaticAssetPath, cacheControlForRuntimeAsset } from './lib/runtime-assets';
import { resolveAllowedOrigin, buildCorsHeaders } from './lib/origin';
import { getExecutionContext, getDefaultCache, runDeferred } from './lib/runtime-context';
import { isSingleAppMode, isBlockedInSingleApp, singleAppId } from './lib/single-app';
import { appIdForActiveHost, isOnDemandTlsAuthorized } from './lib/custom-domains';
import { resolveAppIdForSegment } from './lib/meta-db';
import { SOURCE_OFFER_PATH, sourceOfferUrl } from './lib/source-offer';

const app = new Hono<{ Bindings: Env }>();

// On-demand-TLS authorization for the Caddy sidecar (self-serve custom domains).
// Caddy's `on_demand_tls { ask … }` calls GET /internal/tls/authorize?domain=<sni>
// on the first TLS handshake for an unknown host; we return 200 ONLY for an
// active, operator-verified registered domain. This is the abuse guard that
// keeps ACME issuance inside Let's Encrypt's rate limits — an attacker sending
// bogus SNIs is refused, so Caddy never attempts issuance for them. Mounted
// FIRST so it bypasses securityHeaders/compress/the HTTPS-redirect: Caddy speaks
// plain HTTP to the worker on the internal network and expects a bare 200/non-200.
// Optional shared key (EXEPAD_ONDEMAND_TLS_ASK_KEY) is matched against ?key= when
// set — defence-in-depth on top of the worker not being LAN-exposed.
app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname !== '/internal/tls/authorize') return next();
  // This is an INTERNAL control endpoint the local Caddy calls over loopback; its
  // 200/403 answer is a per-domain oracle ("is <domain> a registered active custom
  // domain here?"). Quick Access (routes/quick-access.ts) tunnels the whole studio,
  // which would otherwise let a tunnel visitor enumerate the operator's domains. A
  // request arriving THROUGH a Cloudflare tunnel carries edge markers the loopback
  // Caddy ask never does (a cf-ray header, or a *.trycloudflare.com Host) — refuse
  // those so the oracle stays internal-only, independent of the optional ask key.
  const host = (c.req.header('host') || '').toLowerCase();
  if (c.req.header('cf-ray') || host.endsWith('.trycloudflare.com')) {
    return c.text('not authorized', 403);
  }
  const askKey = process.env.EXEPAD_ONDEMAND_TLS_ASK_KEY;
  if (askKey && url.searchParams.get('key') !== askKey) {
    return c.text('forbidden', 403);
  }
  const domain = url.searchParams.get('domain') || '';
  return isOnDemandTlsAuthorized(domain) ? c.text('ok', 200) : c.text('not authorized', 403);
});

// Single-app serve gate. When EXEPAD_SINGLE_APP_ID is set the container serves
// exactly ONE published app (the deployable bundle) and the builder/operator/
// agent surface does not exist — refuse those paths with 404 before any route
// runs, so a shipped app exposes only itself. Mounted first so it short-circuits
// ahead of all other middleware. Inert no-op in normal studio mode.
app.use('*', async (c, next) => {
  if (isSingleAppMode() && isBlockedInSingleApp(new URL(c.req.url).pathname)) {
    return c.text('Not Found', 404);
  }
  return next();
});

// HTTP -> HTTPS redirect (self-host). Active ONLY when EXEPAD_HTTPS_REDIRECT_PORT
// is set — run.sh local sets it to the TLS port whenever it serves HTTPS. Bounces
// insecure LAN visitors to https. Loopback (127.0.0.1 / ::1) is EXEMPT so the
// in-process thumbnail cron and the container healthcheck — which call
// http://127.0.0.1:8080 over plain HTTP — keep working. Already-secure requests
// (the TLS listener, or behind a TLS proxy via X-Forwarded-Proto) pass through.
// Cloud/container leave the var unset, so this is an inert no-op there. Mounted
// first so it short-circuits before any other middleware.
app.use('*', async (c, next) => {
  const redirectPort = process.env.EXEPAD_HTTPS_REDIRECT_PORT;
  if (redirectPort) {
    const url = new URL(c.req.url);
    const alreadySecure =
      url.protocol === 'https:' ||
      c.req.header('x-forwarded-proto') === 'https' ||
      c.req.header('x-forwarded-scheme') === 'https';
    const isLoopback = url.hostname === '127.0.0.1' || url.hostname === '::1';
    if (!alreadySecure && !isLoopback) {
      url.protocol = 'https:';
      url.port = redirectPort === '443' ? '' : redirectPort;
      // 302 (not 301): a self-host operator may toggle HTTPS off later; a cached
      // permanent redirect would then strand http clients on a dead https port.
      return c.redirect(url.toString(), 302);
    }
  }
  return next();
});

// Canonical front-port redirect (managed two-port split). Our in-image Caddy stamps
// X-Exepad-Front-Port with the LISTENER port a request arrived on. When the operator
// runs the studio and apps fronts on DIFFERENT ports, bounce a host that landed on the
// wrong one to its canonical port: an app subdomain must live on the apps port (clean
// per-app URLs), the studio on the studio port. Guards, in order — any → inert no-op:
//   - not the managed container (external proxy / local): the header isn't trustworthy
//     and the split doesn't apply, so never act on it.
//   - no / unparseable header (loopback ask endpoint, healthcheck, internal re-entry):
//     nothing to canonicalize.
//   - unified front (studio port == apps port): the single listener serves everything.
// So the worst case is ever "both ports serve everything," never a redirect loop —
// `desired` is a pure function of the host's app/studio classification, which Caddy
// stamps consistently, so a bounced request re-arrives already-canonical. Mounted early
// (after the loopback ask bypass + HTTP→HTTPS) so it short-circuits ahead of serving.
app.use('*', async (c, next) => {
  if (!/^(1|true|yes|on)$/i.test((process.env.EXEPAD_MANAGED_TLS ?? '').trim())) return next();
  const frontRaw = c.req.header('x-exepad-front-port');
  if (!frontRaw) return next();
  const frontPort = Number(frontRaw);
  if (!Number.isInteger(frontPort)) return next();
  // Compare against the ports Caddy ACTUALLY BOUND at boot — the entrypoint exports them
  // as EXEPAD_APPS_PORT / EXEPAD_STUDIO_PORT and they match the X-Exepad-Front-Port Caddy
  // stamps. Do NOT use the configured/pending effective*() store values: saving a split in
  // the UI bumps those IMMEDIATELY (before the restart that actually re-binds Caddy), so a
  // pending studio port would 307 the studio page, /api/network, AND the restart call
  // itself onto a port nothing is listening on yet — locking the operator out until a
  // manual restart. The redirect must only ever reflect what is bound right now.
  const appsPort = Number(process.env.EXEPAD_APPS_PORT);
  const studioPort = Number(process.env.EXEPAD_STUDIO_PORT || process.env.EXEPAD_APPS_PORT);
  if (!Number.isInteger(appsPort) || !Number.isInteger(studioPort)) return next();
  if (appsPort === studioPort) return next(); // unified single front
  const host = c.req.header('host');
  const isApp = appIdForActiveHost(host) != null || appIdFromSubdomain(host) != null;
  const desired = isApp ? appsPort : studioPort;
  if (frontPort === desired) return next();
  const url = new URL(c.req.url);
  url.protocol = 'https:';
  url.port = desired === 443 ? '' : String(desired);
  // 307 (temporary, method-preserving): the operator may re-merge or move the ports
  // later, so never let a client cache this as permanent (301/308 would strand it).
  return c.redirect(url.toString(), 307);
});

// Initialize log level based on environment
app.use('*', async (c, next) => {
  initLogLevel(c.env.ENVIRONMENT || 'production');
  await next();
});

app.use('*', securityHeaders());

// Compress text responses (HTML shell, component/SPA JS, CSS, JSON config).
// The self-hosted Node server shipped uncompressed, leaving ~75% on the table
// for the large SDK/CSS/JS bundles (the dominant Lighthouse "Enable text
// compression" finding). The middleware auto-skips already-encoded bodies,
// binary types (woff2/images), `no-transform` responses, and sub-1KB payloads.
//
// Ordering: registered before compress() so this runs AFTER compression has set
// Content-Encoding, letting us advertise `Vary: Accept-Encoding` for correct
// caching by any intermediary.
app.use('*', async (c, next) => {
  await next();
  if (c.res.headers.has('Content-Encoding')) {
    c.res.headers.set('Vary', 'Accept-Encoding');
  }
});
app.use('*', compress());

app.use('/api/*', cors({
  origin: (origin) => resolveAllowedOrigin(origin) || undefined,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type',
    'Authorization',
    'X-Request-Id',
    'X-Platform-Token',
    'If-None-Match',
  ],
  credentials: true,
  maxAge: 86400,
}));

// Request body size limits. The generic API cap is 10 MB, but file uploads are
// governed by each app's configured `storage.maxFileSize` (enforced downstream
// by the app-backend's Content-Length precheck + handler). Applying the 10 MB
// cap to the upload path would 413-reject any upload an app legitimately
// configured above 10 MB — a limit that contradicts its own setting. So the
// upload path (`POST /api/{appId}/_files/upload`) gets a generous global ceiling
// (EXEPAD_MAX_UPLOAD_BYTES, default 100 MB) and the app-backend narrows it to
// the per-app value; other /api routes keep the 10 MB cap.
const API_BODY_LIMIT = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = (() => {
  const raw = Number(process.env.EXEPAD_MAX_UPLOAD_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : 100 * 1024 * 1024;
})();
app.use('/api/*', (c, next) => {
  const isUpload = c.req.method === 'POST' && /\/_files\/upload\/?$/.test(c.req.path);
  return bodyLimit({ maxSize: isUpload ? MAX_UPLOAD_BYTES : API_BODY_LIMIT })(c, next);
});

// Rate limiting for sensitive endpoints
app.use('/api/deploy/*', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));
app.use('/api/deprovision/*', rateLimiter({ maxRequests: 5, windowMs: 60_000 }));
app.use('/api/admin/*', rateLimiter({ maxRequests: 60, windowMs: 60_000 }));
app.use('/api/platform/email/*', rateLimiter({ maxRequests: 30, windowMs: 60_000 }));
app.use('/api/settings/*', rateLimiter({ maxRequests: 60, windowMs: 60_000 }));
app.use('/api/network/*', rateLimiter({ maxRequests: 60, windowMs: 60_000 }));
// Custom-domain management. /verify + /check trigger live DNS lookups; the
// add-domain wizard live-polls /check (~every 8s) while the operator sets up
// their records, so allow modest headroom without hammering resolvers.
app.use('/api/domains/*', rateLimiter({ maxRequests: 60, windowMs: 60_000 }));
// One-click "Share live URL" — start/stop spawn a child process + bind a
// listener, so throttle it tightly like the other expensive operator routes.
app.use('/api/publish/*', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));
// Quick Access studio tunnel — also spawns a cloudflared child; same tight cap.
app.use('/api/quick-access/*', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));
// Surveyor Phase 2 diagnostic probes — agent-only traffic, but rate-limit
// so a runaway agent can't burn the global Browser Rendering pool.
app.use('/api/:appId/_diag/*', rateLimiter({ maxRequests: 30, windowMs: 60_000 }));
// Operator login/setup mints the platform session cookie that authorizes ALL
// admin access — throttle it so a weak operator password can't be brute-forced
// online (matters for publicly self-hosted instances).
app.use('/auth/login', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));
app.use('/auth/setup', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));

app.route('/api/deploy', deploy);
app.route('/api/deprovision', deprovision);
app.route('/api/admin', admin);
app.route('/api/platform/email', email);
// Self-host platform: local operator auth + build orchestration (replaces the
// external Django backend). `/auth/*` is top-level (same-origin builder UI);
// `/api/orchestrate/*` rides the /api CORS middleware above.
app.route('/auth', auth);
app.route('/api/orchestrate', orchestrate);
// Operator settings (LLM key/model, image keys). MUST mount before the catch-all
// gateway so /api/settings doesn't get interpreted as an app id.
app.route('/api/settings', settings);
// Custom-domain management (register/verify/remove). MUST mount before the
// catch-all gateway so /api/domains isn't interpreted as an app id.
app.route('/api/domains', domains);
// Server & networking settings (public address override, CORS/CSRF allowlist,
// strict-local-CORS). MUST mount before the catch-all gateway so /api/network
// isn't interpreted as an app id.
app.route('/api/network', network);
// One-click publish control plane (start/status/stop). MUST mount before the
// catch-all gateway so /api/publish isn't interpreted as an app id.
app.route('/api/publish', publish);
// Quick Access — a Cloudflare quick tunnel to the WHOLE (login-gated) studio for
// a rig behind a router. MUST mount before the catch-all gateway.
app.route('/api/quick-access', quickAccess);
// Diagnostic routes MUST mount BEFORE the catch-all gateway so
// /api/:appId/_diag/* paths route to the dedicated handler instead of
// being interpreted as gateway dispatch targets.
app.route('/api', diagnostic);
app.route('/api', gateway);

// Reverse-proxy /agent/* to the local Python agent (uvicorn on :8081) so the
// builder UI can stream SSE builds same-origin. Mounted before the SPA
// catch-all. `/agent/r` → agent `/r`, etc.
//
// This is an operator-only surface (same trust level as
// /api/orchestrate), so it MUST be gated: without a check, an internet visitor
// reaching an exposed instance could drive the agent's /r|/cancel|/artifacts
// endpoints directly. We require a valid platform-user session (operator cookie),
// then stamp an internal shared secret so the agent can also reject any request
// that didn't traverse this authenticated proxy (defense-in-depth if :8081 is
// ever reachable on the network). See the followUp for the header/env contract.
app.all('/agent/*', async (c) => {
  const authed = await requirePlatformUser(c);
  if (!authed) {
    return c.json({ success: false, error: 'Authentication required' }, 401);
  }
  const agentBase = process.env.EXEPAD_AGENT_URL ?? 'http://127.0.0.1:8081';
  const url = new URL(c.req.url);
  const target = `${agentBase}${url.pathname.replace(/^\/agent/, '')}${url.search}`;
  // Copy the inbound headers, then stamp the internal secret (never let a
  // client-supplied value through). The agent verifies this header when
  // EXEPAD_AGENT_INTERNAL_SECRET is configured on both sides.
  const proxyHeaders = new Headers(c.req.raw.headers);
  const internalSecret = process.env.EXEPAD_AGENT_INTERNAL_SECRET;
  if (internalSecret) {
    proxyHeaders.set('X-Exepad-Internal-Secret', internalSecret);
  } else {
    proxyHeaders.delete('X-Exepad-Internal-Secret');
  }
  const init: RequestInit & { duplex?: 'half' } = {
    method: c.req.method,
    headers: proxyHeaders,
  };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = c.req.raw.body;
    init.duplex = 'half';
  }
  try {
    const resp = await fetch(target, init);
    return new Response(resp.body, { status: resp.status, headers: resp.headers });
  } catch {
    return c.json({ success: false, error: 'Agent service unavailable' }, 502);
  }
});

// Email verification link target. The user clicks the link in their
// verification email, which lands here. We re-enter the Hono app's own
// /api/{appId}/rpc gateway to run the auth_verify_email handler (this
// reuses all the existing config loading, route resolution, and in-process
// app-backend dispatch), then 302 to /login with a banner query param.
app.get('/verify-email', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.redirect('/login?verify_error=invalid', 302);

  const appId =
    c.req.header('x-exepad-app-id') ||
    resolveAppIdFromHost(c.req.header('host')) ||
    (isSingleAppMode() ? singleAppId() : null);
  if (!appId) return c.redirect('/login?verify_error=invalid', 302);

  // Re-enter the app's own gateway via fetch(). We stamp x-exepad-rewritten
  // and x-exepad-app-id so the subdomain middleware's fallback path
  // behaves consistently with whatever the external router would have done.
  const origin = new URL(c.req.url).origin;
  const rpcUrl = `${origin}/api/${appId}/rpc`;
  const rpcResponse = await app.fetch(
    new Request(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-exepad-app-id': appId,
        'x-exepad-rewritten': '1',
      },
      body: JSON.stringify({ method: 'auth_verify_email', params: { token } }),
    }),
    c.env,
    c.executionCtx,
  );

  let verified = false;
  try {
    const data = (await rpcResponse.json()) as { success?: boolean; data?: { verified?: boolean } };
    verified = data?.success === true && data?.data?.verified === true;
  } catch {
    verified = false;
  }

  const location = verified ? '/login?verified=1' : '/login?verify_error=invalid';
  return c.redirect(location, 302);
});

// Internal cache-invalidation hook, for the case where an app's stored config
// is edited OUT OF BAND (i.e. written straight to the config store rather than
// through /api/deploy, which invalidates on its own). Purges the runtime's
// cached copies immediately instead of waiting out the 60s/5min TTLs.
// DEPLOY_SECRET-gated — same trust level as the deploy pipeline itself. Kept
// under /internal/* so the security-headers middleware doesn't interfere.
app.post('/internal/invalidate-config', async (c) => {
  const deploySecret = await c.env.DEPLOY_SECRET.get();
  const headerSecret = c.req.header('X-Deploy-Secret') || '';
  if (!deploySecret || !constantTimeEqual(headerSecret, deploySecret)) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  let body: { appId?: string; mode?: 'published' | 'preview' };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  if (!body?.appId) {
    return c.json({ success: false, error: 'appId required' }, 400);
  }
  const mode = body.mode ?? 'published';
  // Must purge BOTH caches to match deploy.ts:483-486. The asset gate reads
  // from lib/app-config.ts cache; the RPC dispatch layer reads from the
  // separate gateway cache. Invalidating only one leaves the other serving
  // stale config for up to 60s/5min, which made the previous security
  // hot-patch invisible to handler calls.
  await Promise.all([
    invalidateConfig(body.appId, mode),
    invalidateGatewayConfig(body.appId, mode),
  ]);
  return c.json({ success: true, appId: body.appId, mode });
});

// Serve repo assets on subdomain access — the SPA uses basePath='' on subdomains,
// so /repo/* requests arrive without /a/{appId}/ prefix. The external router provides
// the appId via x-exepad-app-id header.
app.get('/repo/*', async (c) => {
  // basePath='' serving (subdomain on cloud; single-app or a single-app custom
  // domain on self-host) sends /repo/* with no /a/{appId}/ prefix. Cloud's
  // external router supplies the appId via header; single-app mode resolves it
  // from EXEPAD_SINGLE_APP_ID; a self-serve custom domain resolves it from the
  // active registered_domains mapping for the Host header.
  const appId =
    c.req.header('x-exepad-app-id') ||
    resolveAppIdFromHost(c.req.header('host')) ||
    (isSingleAppMode() ? singleAppId() : null);
  if (!appId) return c.text('Not Found', 404);
  // Serve as if the path were /a/{appId}/repo/... — reuse the shared handler below
  return serveRepoAsset(c, appId, false);
});

app.get('/published/assets/*', async (c) => {
  const appId =
    c.req.header('x-exepad-app-id') ||
    resolveAppIdFromHost(c.req.header('host')) ||
    (isSingleAppMode() ? singleAppId() : null);
  if (!appId) return c.text('Not Found', 404);
  return servePublishedAsset(c, appId, false);
});

// Serve code component files (JS, CSS) from R2 for app preview/published routes
// URL pattern: /a/[preview-]{appId}/repo/{filePath}
// Protected: preview assets always require auth; published assets require auth
// when the app has security.authProviders and defaultAccess !== 'public'.
app.get('/a/:appIdSegment/repo/*', async (c) => {
  const appIdSegment = c.req.param('appIdSegment');
  if (!appIdSegment) return c.text('Not Found', 404);
  const isPreview = appIdSegment.startsWith('preview-');
  const appId = appIdSegment.replace(/^preview-/, '');
  const filePath = c.req.path.split('/repo/').slice(1).join('/repo/');
  return serveAppR2Asset(c, appId, isPreview, filePath);
});

// Silent preview session refresh. The parent Agent page mints a fresh
// preview token every ~50 minutes and posts it to the iframe via
// postMessage; the iframe does a same-origin fetch to this endpoint so
// the Set-Cookie header rolls __exepad_pa forward without reloading the
// iframe. Cross-origin credentialed fetches would be blocked by
// SameSite=Lax, which is exactly why the parent uses postMessage instead.
app.get('/a/:appIdSegment/__refresh', async (c) => {
  const appIdSegment = c.req.param('appIdSegment');
  if (!appIdSegment || !appIdSegment.startsWith('preview-')) {
    return c.text('Not Found', 404);
  }
  const appId = appIdSegment.replace(/^preview-/, '');
  const token = c.req.query('pt');
  if (!token) {
    return new Response(null, { status: 401 });
  }
  const bridgeSecret = await resolveSecret(c.env.PLATFORM_BRIDGE_SECRET);
  if (!bridgeSecret) {
    return new Response(null, { status: 401 });
  }
  const payload = await validatePreviewAccessToken(token, bridgeSecret, appId);
  if (!payload) {
    return new Response(null, { status: 401 });
  }
  // Stamp the cookie with a freshly-minted full-TTL token, NOT the incoming
  // one. The iframe keep-alive posts 5-minute backend-minted tokens every
  // 50 minutes (app-preview-panel.tsx::postFreshToken), so restamping the
  // cookie with that 5-minute token plus a 12-hour Max-Age would leave the
  // browser sending a cookie whose signed token expired 4h55m earlier —
  // subsequent subresource fetches would 401 until the next keep-alive tick.
  // Minting locally keeps the cookie Max-Age and token exp aligned.
  const freshToken = await mintPreviewAccessToken(
    appId,
    String(payload.uid),
    payload.email,
    bridgeSecret,
  );
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
  });
  for (const cookie of buildPreviewAccessCookieHeaders(freshToken, appId, c.req.raw)) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(null, { status: 204, headers });
});

// Captured app images are stored under {appId}/published/assets/* in R2.
app.get('/a/:appIdSegment/published/assets/*', async (c) => {
  const appIdSegment = c.req.param('appIdSegment');
  if (!appIdSegment) return c.text('Not Found', 404);
  const isPreview = appIdSegment.startsWith('preview-');
  const appId = appIdSegment.replace(/^preview-/, '');
  return servePublishedAsset(c, appId, isPreview);
});

async function serveRepoAsset(c: Context<{ Bindings: Env }>, appId: string, isPreview: boolean): Promise<Response> {
  const filePath = c.req.path.split('/repo/').slice(1).join('/repo/');
  return serveAppR2Asset(c, appId, isPreview, filePath);
}

function appIdFromSubdomain(host: string | undefined): string | null {
  const match = (host || '').match(/^([a-z0-9][a-z0-9-]*[a-z0-9])\.exepad\.app(?::\d+)?$/i);
  return match?.[1] || null;
}

/**
 * Resolve the appId a request's Host header serves at the origin root. Tries the
 * cloud `{appId}.exepad.app` subdomain first, then a self-serve custom domain
 * mapped to a single app (an active `registered_domains` row with app_id set, or
 * a `{label}.wildcard` match). Returns null for whole-studio hosts / unknown
 * hosts, so prefix-less `/repo` + `/published/assets` requests resolve correctly
 * on a custom domain exactly as they do on a cloud subdomain.
 */
function resolveAppIdFromHost(host: string | undefined): string | null {
  return appIdFromSubdomain(host) || appIdForActiveHost(host);
}

function getPublishedAssetPath(c: Context<{ Bindings: Env }>): string {
  const pathname = new URL(c.req.url).pathname;
  const appScopedMatch = pathname.match(/^\/a\/[^/]+\/(published\/assets\/.*)$/);
  if (appScopedMatch) {
    return appScopedMatch[1];
  }
  return pathname.replace(/^\//, '');
}

function servePublishedAsset(
  c: Context<{ Bindings: Env }>,
  appId: string,
  isPreview: boolean,
): Promise<Response> {
  return serveAppR2Asset(c, appId, isPreview, getPublishedAssetPath(c));
}

// SPA shell styling needed to render the *unauthenticated* login page itself.
// These files are the build pipeline's Tailwind output, not user data — they
// must remain reachable without a session, otherwise the login form renders
// unstyled on the very first visit. Match by suffix because the deploy
// snapshot pipeline rewrites the prefix to a versioned release folder
// (e.g. `published/releases/{releaseSuffix}/styles/theme.css`), while the
// preview/legacy path remains `compiled/frontend/styles/theme.css`.
const PUBLIC_REPO_ASSET_SUFFIXES = [
  'styles/theme.css',
  'styles/compiled.css',
] as const;

function isPublicRepoAsset(filePath: string): boolean {
  return PUBLIC_REPO_ASSET_SUFFIXES.some(
    (suffix) => filePath === suffix || filePath.endsWith(`/${suffix}`),
  );
}

async function serveAppR2Asset(
  c: Context<{ Bindings: Env }>,
  appId: string,
  isPreview: boolean,
  filePath: string,
): Promise<Response> {
  if (!filePath) {
    return c.text('Not Found', 404);
  }

  // Determine if this asset requires authentication.
  //
  // The shell CSS files matched by isPublicRepoAsset are always public, even
  // for preview, so the worker's "Authentication Required" fallback page
  // (meta-injector.ts::buildUnauthorizedPreviewHtml) can render in the
  // app's own design tokens instead of falling back to bare text. These
  // files contain Tailwind output, not user data — the privacy tradeoff
  // is the app's color palette, which also leaks from any loaded page.
  let needsAuth = false;
  if (isPublicRepoAsset(filePath)) {
    needsAuth = false;
  } else if (isPreview) {
    needsAuth = true;
  } else {
    const config = await loadAppConfig(appId, c.env);
    needsAuth = isAuthRequired(config);
  }

  // Validate credentials for protected assets.
  //
  // Hoist the identity so we can propagate a slide-renewed preview cookie on
  // the response below. Without this, a user who loads the preview in a
  // top-level tab (no iframe-driven `__refresh` keep-alive) and then spends
  // hours in client-side React Router navigation never issues an HTML request
  // that could slide the cookie — their __exepad_pa silently expires mid
  // session and the next dynamic `import()` 401s with no recovery path
  // (CodeComponent just shows a Retry button that refetches the same 401).
  let previewRenewalToken: string | null = null;
  if (needsAuth) {
    const identity = await resolveGatewayIdentity(
      c.req.raw,
      appId,
      isPreview ? 'preview' : 'published',
      c.env,
    );
    if (!identity.isAuthenticated) {
      return c.text('Unauthorized', 401);
    }
    if (
      isPreview &&
      identity.shouldRefreshPreviewCookie &&
      identity.previewAccessToken
    ) {
      previewRenewalToken = identity.previewAccessToken;
    }
  }

  const r2Key = `${appId}/${filePath}`;

  const ext = filePath.split('.').pop()?.toLowerCase();
  const CONTENT_TYPES: Record<string, string> = {
    js: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    gif: 'image/gif',
    avif: 'image/avif',
  };
  const contentType = (ext && CONTENT_TYPES[ext]) || 'application/octet-stream';

  // Preview assets use STABLE compiled filenames (e.g.
  // `compiled/frontend/components/Foo.js`), so an edit re-deploy overwrites them
  // in place — the URL never changes. They must therefore revalidate, NOT be
  // pinned `immutable`, or the Studio preview keeps serving the pre-edit code
  // (the browser caches it for a year and the PoP cache below returns the stale
  // body even on a forced reload). Published assets live under per-deploy
  // versioned release folders (`published/releases/{suffix}/…`) whose path
  // changes every deploy, so they stay safely immutable + PoP-cacheable.
  const immutableAsset = !isPreview;
  const headers = new Headers({
    'Content-Type': contentType,
    'Cache-Control': immutableAsset
      ? needsAuth
        ? 'private, max-age=31536000, immutable'
        : 'public, max-age=31536000, immutable'
      : needsAuth
        ? 'private, no-cache, must-revalidate'
        : 'public, no-cache, must-revalidate',
  });
  const cors = buildCorsHeaders(c.req.header('Origin'), {
    allowCredentials: needsAuth,
    allowWildcard: !needsAuth,
  });
  for (const [key, value] of Object.entries(cors)) {
    headers.set(key, value);
  }

  // CF Cache API: only safe for immutable (published, release-versioned) assets,
  // whose R2 key rotates per deploy → automatic invalidation. Preview assets keep
  // a STABLE key across edits, so the PoP cache would pin the pre-edit body — skip
  // it for preview and read straight from CONFIG_CACHE (disk) every time.
  const cacheKey = new Request(`https://exepad-asset-cache.internal/${r2Key}`);
  const cache = immutableAsset ? getDefaultCache() : null;
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      // Return cached body with fresh per-request headers (CORS origin may vary
      // per request). Set-Cookie is applied AFTER constructing the response so
      // the cache entry (which was stored without Set-Cookie — see below)
      // stays user-agnostic even though this per-request response carries a
      // user-specific renewal cookie.
      const resp = new Response(cached.body, { headers });
      appendPreviewRenewalCookies(resp, appId, previewRenewalToken, c.req.raw);
      return resp;
    }
  }

  const object = await c.env.CONFIG_CACHE.get(r2Key);
  if (!object) {
    return c.text('Not Found', 404);
  }

  const response = new Response(object.body, { headers });
  if (cache) {
    // Clone BEFORE appending Set-Cookie so the cached entry never carries a
    // user-specific preview token. Subsequent PoP-cache hits above layer
    // Set-Cookie on top of the cached clean body.
    await runDeferred(cache.put(cacheKey, response.clone()), getExecutionContext(c));
  }
  appendPreviewRenewalCookies(response, appId, previewRenewalToken, c.req.raw);
  return response;
}

function appendPreviewRenewalCookies(
  response: Response,
  appId: string,
  renewalToken: string | null,
  req?: Request,
): void {
  if (!renewalToken) return;
  for (const header of buildPreviewAccessCookieHeaders(renewalToken, appId, req)) {
    response.headers.append('Set-Cookie', header);
  }
}

// AGPL-3.0 section 13 source offer, reachable by EVERY user of this server —
// not just the logged-in operator. The studio's About page carries the same
// offer but sits inside StudioShell, which redirects anonymous visitors to
// /login; the users of an app served at /a/{appId}/… (or on a published tunnel,
// a custom domain, or a single-app bundle) would never see it. This route needs
// no session, so it answers on every one of those surfaces, and it is the target
// of the <link rel="license"> the meta injector emits into served pages.
//
// A reserved top-level path, like /robots.txt and /verify-email above; the URL
// it redirects to comes from lib/source-offer.ts so a fork rebrands in one
// place. 302 (not 301): the configured URL is operator-settable at runtime, so
// it must never be cached permanently.
app.get(SOURCE_OFFER_PATH, (c) => c.redirect(sourceOfferUrl(), 302));

// SEO: platform-level robots.txt for the runtime host itself (e.g.,
// p1.exepad.com/robots.txt). Without this, the request falls through to the
// SPA catch-all and returns index.html — Lighthouse flags 76+ parse errors
// and search engines choke. Apps served via subdomain or domain rewrite hit
// the per-app handler below; this is only for the bare runtime origin.
app.get('/robots.txt', (c) => {
  const origin = new URL(c.req.url).origin;
  const body = [
    'User-agent: *',
    // All preview apps are non-indexable by design
    'Disallow: /a/preview-',
    'Allow: /',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n');
  return c.text(body, 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

// SEO: robots.txt (subdomain rewrite turns /robots.txt → /a/{appId}/robots.txt)
app.get('/a/:appId/robots.txt', async (c) => {
  const appId = c.req.param('appId');
  const config = await loadAppConfig(appId, c.env);
  const baseUrl = resolveCanonicalBase(config, appId, new URL(c.req.url));

  const requiresAuth = config?.security?.authProviders?.length
    && config.security.defaultAccess
    && config.security.defaultAccess !== 'public';

  const lines = ['User-agent: *'];
  if (requiresAuth) {
    lines.push('Disallow: /');
  } else {
    lines.push('Allow: /');
    lines.push(`Sitemap: ${baseUrl}/sitemap.xml`);
  }

  return c.text(lines.join('\n'), 200, { 'Content-Type': 'text/plain; charset=utf-8' });
});

// SEO: sitemap.xml
app.get('/a/:appId/sitemap.xml', async (c) => {
  const appId = c.req.param('appId');
  const config = await loadAppConfig(appId, c.env);
  const baseUrl = resolveCanonicalBase(config, appId, new URL(c.req.url));
  const pages = config?.frontend?.pages || [];

  const urls = pages
    .map(p => {
      const loc = p.slug === '/' ? baseUrl : `${baseUrl}${p.slug}`;
      return `  <url>\n    <loc>${escapeHtml(loc)}</loc>\n  </url>`;
    })
    .join('\n');

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
  ].join('\n');

  return c.text(xml, 200, { 'Content-Type': 'application/xml; charset=utf-8' });
});

app.get('*', async (c) => {
  const url = new URL(c.req.url);

  if (isRuntimeStaticAssetPath(url.pathname)) {
    const assetRes = await c.env.ASSETS.fetch(c.req.raw);
    // Override the Assets binding's default `max-age=0, must-revalidate` so
    // content-hashed bundles can be cached immutably (the rest keep a short
    // revalidating TTL). Only on success — error responses keep their headers.
    const cacheControl = cacheControlForRuntimeAsset(url.pathname);
    if (cacheControl && assetRes.ok) {
      const res = new Response(assetRes.body, assetRes);
      res.headers.set('Cache-Control', cacheControl);
      return res;
    }
    return assetRes;
  }

  return injectMeta(c);
});

// ─── Friendly-slug URL rewrite (edge) ────────────────────────────────────────
//
// Published apps are shared at `/a/<slug>/…` — the human-readable, name-derived
// alias (e.g. `tidelist`) — but every downstream `/a/<id>/…` route, the SQLite
// filename, and the storage prefixes are keyed on the immutable `app.id` (e.g.
// `avfhfwzn8`). Resolve `<slug>` → `<id>` ONCE here by rewriting the incoming
// request URL before Hono routes it, so all id-keyed code runs unchanged. This
// is a server-side rewrite only: the browser address bar keeps the slug.
//
// Scoped to the `/a/` surface, which has no reserved siblings; the `/api/<slug>/`
// gateway path resolves inline in routes/gateway (safe only after the catch-all
// match, so reserved `/api/*` routes are never shadowed). A `preview-` segment is
// an internal draft id and its inner segment can't be a slug (reserved prefix),
// so resolution there is a no-op. Unknown segments pass through untouched → 404
// exactly as before.
const A_PATH_RE = /^\/a\/(preview-)?([^/]+)(\/.*)?$/;
export function rewriteFriendlySlug(request: Request): Request {
  const url = new URL(request.url);
  const match = url.pathname.match(A_PATH_RE);
  if (!match) return request;
  const previewPrefix = match[1] ?? '';
  const segment = match[2];
  const rest = match[3] ?? '';
  const canonicalId = resolveAppIdForSegment(segment);
  if (canonicalId === segment) return request; // already an id, or unknown
  url.pathname = `/a/${previewPrefix}${canonicalId}${rest}`;
  return new Request(url, request);
}

export default app;
