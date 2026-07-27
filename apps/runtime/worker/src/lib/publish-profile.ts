/**
 * Published-only profile for the one-click "Share live URL" (Cloudflare Quick
 * Tunnel) feature — the NON-NEGOTIABLE security core.
 *
 * Isolation is achieved BY CONSTRUCTION, not by filtering the :8080 app.
 * cloudflared is pointed at a SEPARATE 127.0.0.1 listener (see routes/publish.ts)
 * whose fetch handler is {@link buildPublishApp}. That handler:
 *
 *   1. (optional) enforces a publish-time access-token gate FIRST,
 *   2. classifies the request against a DEFAULT-DENY allow-list — anything not
 *      explicitly an app-X published surface returns 403 and never reaches the
 *      real app,
 *   3. strips every spoofable inbound trust header and the operator's platform
 *      session cookie (preserving app X's OWN end-user cookie),
 *   4. pins app X via BOTH a path rewrite to `/a/{appX}/...` (so injectMeta's
 *      `extractAppId` — which reads the PATH, not the header — resolves app X)
 *      AND the `x-exepad-app-id` header (for the header-driven `/repo/*` and
 *      `/published/assets/*` routes), then re-enters the SAME runtime app.
 *
 * Why a separate listener and not a deny middleware on :8080: in self-host
 * `validateRouterSecret` is a no-op (gateway/auth.ts — ENVIRONMENT !== 'production'),
 * so the gateway has ZERO router-secret defense. The allow-list here is the only
 * surface-isolation boundary, and tunneling :8080 would expose the admin panel,
 * the LLM key in /api/settings, /api/orchestrate, and every other app.
 *
 * The inner re-entry forces a `http://127.0.0.1` origin so route-mode resolution
 * (meta-injector.ts) is deterministically PATH mode (basePath=`/a/{appX}`),
 * regardless of which Host cloudflared forwards — hence the allow-list covers
 * both the path-style `/a/{appX}/repo/*` and the header-driven flat `/repo/*`.
 */
import { Hono } from 'hono';
import type { Env } from '../types/env';
import { constantTimeEqual } from './crypto-utils';
import { PLATFORM_SESSION_COOKIE } from '../routes/gateway/auth';

/** Re-entry into the real runtime app. Injected so tests can spy on it and so
 *  this module never imports `../index` (avoids the route↔index import cycle). */
export type InnerFetch = (req: Request, env: Env) => Response | Promise<Response>;

export interface BuildPublishAppOptions {
  /** REQUIRED in production: the real runtime `app.fetch` bound to the env. */
  inner: InnerFetch;
  /** When set, the published link additionally requires this token (cookie
   *  `exepad_pub_gate` or `?k=`). Omit for the default Gradio model (the random
   *  trycloudflare URL is the only secret). */
  accessToken?: string | null;
  /** Returns the app's live PUBLIC origin (e.g. `https://foo.trycloudflare.com`)
   *  or null if not yet known. Read per-request so the canonical/OG/schema URLs
   *  reflect the shared host instead of the internal loopback `INNER_ORIGIN`.
   *  Injected (not read from `active` directly) so this module stays I/O-free. */
  getPublicOrigin?: () => string | null;
}

/** Cookie the optional access-token gate sets once a correct `?k=` is presented. */
export const PUBLISH_GATE_COOKIE = 'exepad_pub_gate';

/**
 * Inbound trust headers a remote visitor must never be able to set. Stripped
 * before we re-stamp the trusted appId, so a visitor cannot spoof which app /
 * mode / identity the gateway dispatches as.
 */
const STRIPPED_REQUEST_HEADERS = [
  'x-exepad-app-id',
  'x-exepad-rewritten',
  'x-exepad-serve-mode',
  'x-deploy-mode',
  'x-deploy-secret',
  'x-diagnostic-secret',
  'x-platform-token',
  'x-platform-secret',
  'x-service-token',
  'x-user-id',
  'x-user-email',
  'x-user-roles',
  'x-exepad-auth-disabled',
  // Stripped inbound so a visitor cannot spoof the canonical/OG host; the proxy
  // re-stamps these from the known public tunnel URL (see buildPublishApp).
  'x-forwarded-host',
  'x-forwarded-proto',
  // The public share link is for anonymous viewing; it must not accept
  // `Authorization: Bearer exepad_sk_*` API-key auth. App end-user login flows
  // through the `exepad_app_session` cookie (preserved), not this header, so
  // stripping it never breaks in-app sign-in.
  'authorization',
] as const;

/**
 * Cookies stripped before re-entry: the operator's platform session (owner
 * identity — a logged-in operator opening the link must be treated as an
 * anonymous end-user) and the preview token. App X's OWN end-user cookie
 * (`exepad_app_session`) is PRESERVED so its login flows through unchanged.
 */
const STRIPPED_COOKIES = new Set<string>([PLATFORM_SESSION_COOKIE, '__exepad_pa']);

/** Fixed loopback origin used for the inner re-entry so meta-injector resolves
 *  deterministic PATH mode (basePath=`/a/{appX}`) regardless of the forwarded Host. */
const INNER_ORIGIN = 'http://127.0.0.1';

/**
 * The SPA's OWN bundle assets, allow-listed by PREFIX/exact-file only. We must
 * NOT use lib/runtime-assets.isRuntimeStaticAssetPath here: that matches any path
 * ending in a static extension (`.json`, `.js`, …) ANYWHERE, which would forward
 * e.g. `/api/otherApp/data.json` verbatim and leak another app. These prefixes
 * are app-agnostic SPA build output, safe to serve to a tunnel visitor.
 */
const SPA_BUNDLE_PREFIXES = ['/assets/', '/runtime_assets/', '/cdn-cgi/'] as const;
const SPA_BUNDLE_FILES = new Set<string>(['/favicon.svg', '/favicon.ico']);
function isSpaBundleAsset(path: string): boolean {
  return SPA_BUNDLE_FILES.has(path) || SPA_BUNDLE_PREFIXES.some((p) => path.startsWith(p));
}

export type ClassifyResult = { action: 'forward'; path: string } | { action: 'deny' };

/**
 * Normalize a raw pathname for a security decision: percent-decode once (so
 * `%2f`/`%2e` become visible), reject traversal / backslashes, and collapse
 * duplicate slashes. Returns null when the path is suspicious (→ deny).
 */
function normalizePath(raw: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('..') || decoded.includes('\\') || decoded.includes('\0')) {
    return null;
  }
  decoded = decoded.replace(/\/{2,}/g, '/');
  if (!decoded.startsWith('/')) decoded = `/${decoded}`;
  return decoded;
}

/**
 * DEFAULT-DENY classifier. Returns the rewritten path to forward, or `deny`.
 * Pure (no I/O) so it is exhaustively unit-tested. Any path not explicitly an
 * app-X published surface is denied — so a future route added to index.ts is
 * unreachable through the tunnel by absence, not by a deny rule that can rot.
 */
export function classifyAndRewrite(appId: string, rawPath: string, method: string): ClassifyResult {
  const path = normalizePath(rawPath);
  if (path === null) return { action: 'deny' };

  const isGet = method === 'GET' || method === 'HEAD';

  // 1) SPA shell root → app X shell (path rewrite so extractAppId resolves appX).
  if (path === '/' || path === '/index.html') {
    return isGet ? { action: 'forward', path: `/a/${appId}/` } : { action: 'deny' };
  }

  // 2) The SPA's own bundle (its JS/CSS/fonts) — verbatim, by prefix only.
  if (isSpaBundleAsset(path)) {
    return { action: 'forward', path };
  }

  // 3) Header-driven repo + published assets — verbatim (appId comes from the
  //    injected x-exepad-app-id header on these routes).
  if (path === '/repo' || path.startsWith('/repo/') ||
      path === '/published/assets' || path.startsWith('/published/assets/')) {
    return { action: 'forward', path };
  }

  // 4) Path-style app-X surface: /a/{appX}/...  Reject any OTHER appId,
  //    the `preview-` prefix, and the preview-only `__refresh`.
  const aMatch = path.match(/^\/a\/([^/]+)(\/.*)?$/);
  if (aMatch) {
    const seg = aMatch[1];
    const tail = aMatch[2] ?? '';
    if (seg !== appId) return { action: 'deny' };           // other app or preview-{appX}
    if (tail === '/__refresh' || tail.startsWith('/__refresh')) return { action: 'deny' };
    return { action: 'forward', path };
  }

  // 5) Gateway dispatch for app X only. Because appIds are random ids, the named
  //    operator surfaces (/api/settings, /api/admin, /api/orchestrate, /api/deploy,
  //    /api/deprovision, /api/publish, /api/platform/email) have a first segment
  //    != appId and are denied here — as is any other non-appId first segment.
  //    Also block app X's own /mcp and /_diag tails (agent/diagnostic surfaces,
  //    not end-user features).
  const apiMatch = path.match(/^\/api\/([^/]+)(\/.*)?$/);
  if (apiMatch) {
    const seg = apiMatch[1];
    const tail = apiMatch[2] ?? '';
    if (seg !== appId) return { action: 'deny' };
    if (tail === '/mcp' || tail.startsWith('/mcp/')) return { action: 'deny' };
    if (tail === '/_diag' || tail.startsWith('/_diag/')) return { action: 'deny' };
    return { action: 'forward', path };
  }

  // 6) Per-app SEO files → rewrite under app X.
  if (isGet && path === '/robots.txt') return { action: 'forward', path: `/a/${appId}/robots.txt` };
  if (isGet && path === '/sitemap.xml') return { action: 'forward', path: `/a/${appId}/sitemap.xml` };

  // 7) Any other GET/HEAD is an SPA client route → app X shell. Path-rewrite so
  //    extractAppId resolves appX (a bare /dashboard would otherwise boot the
  //    builder shell). This cannot reach an operator handler because every such
  //    handler is either non-GET (denied below) or already allow-listed only for
  //    app X above; prefixing `/a/{appX}` routes everything else to injectMeta.
  if (isGet) {
    return { action: 'forward', path: `/a/${appId}${path}` };
  }

  // Everything else (non-GET to an unknown path) is denied.
  return { action: 'deny' };
}

/** Drop the operator/preview cookies from a Cookie header, preserving the rest
 *  (notably app X's own `exepad_app_session`). Returns '' when nothing remains. */
export function sanitizeCookieHeader(raw: string | null): string {
  if (!raw) return '';
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter((pair) => {
      const name = pair.split('=')[0]?.trim();
      return name.length > 0 && !STRIPPED_COOKIES.has(name);
    })
    .join('; ');
}

/** Read the access-gate token from the `exepad_pub_gate` cookie or `?k=`. */
function readGateToken(req: Request, url: URL): string | null {
  const fromQuery = url.searchParams.get('k');
  if (fromQuery) return fromQuery;
  const cookie = req.headers.get('cookie') ?? '';
  for (const pair of cookie.split(';')) {
    const [name, ...rest] = pair.trim().split('=');
    if (name === PUBLISH_GATE_COOKIE) return rest.join('=');
  }
  return null;
}

/**
 * Build the fresh, minimal Hono app cloudflared's listener serves. It NEVER
 * mounts the :8080 route table — its single handler is the allow-list + pin +
 * re-entry described in the file header.
 */
export function buildPublishApp(appId: string, env: Env, opts: BuildPublishAppOptions): Hono<{ Bindings: Env }> {
  const { inner, accessToken } = opts;
  const pub = new Hono<{ Bindings: Env }>();

  pub.all('*', async (c) => {
    const url = new URL(c.req.url);

    // (1) Optional access-token gate — BEFORE any rewrite or forwarding.
    if (accessToken) {
      const provided = readGateToken(c.req.raw, url);
      const ok = provided != null && constantTimeEqual(provided, accessToken);
      if (!ok) {
        return new Response(
          '<!doctype html><meta charset=utf-8><title>Access key required</title>' +
            '<body style="font:16px system-ui;max-width:28rem;margin:20vh auto;padding:0 1rem">' +
            '<h1>This shared app is protected</h1><p>Append <code>?k=YOUR-KEY</code> to the URL to open it.</p>',
          { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
        );
      }
      // A correct `?k=` sets the gate cookie and redirects to the clean URL so
      // the key isn't kept in the address bar / referer on subsequent requests.
      if (url.searchParams.has('k')) {
        url.searchParams.delete('k');
        return new Response(null, {
          status: 302,
          headers: {
            Location: url.pathname + url.search,
            'Set-Cookie': `${PUBLISH_GATE_COOKIE}=${accessToken}; Path=/; HttpOnly; Secure; SameSite=Lax`,
          },
        });
      }
    }

    // (2) Classify + rewrite (DEFAULT-DENY).
    const result = classifyAndRewrite(appId, url.pathname, c.req.method);
    if (result.action === 'deny') {
      return new Response('Not Found', { status: 403 });
    }

    // (3) Sanitize inbound headers and pin app X.
    const headers = new Headers(c.req.raw.headers);
    for (const h of STRIPPED_REQUEST_HEADERS) headers.delete(h);
    const cookie = sanitizeCookieHeader(headers.get('cookie'));
    if (cookie) headers.set('cookie', cookie);
    else headers.delete('cookie');
    headers.set('x-exepad-app-id', appId);
    headers.set('x-exepad-rewritten', '1');
    // Serve the pinned app at the origin root (basePath='') like a single-app
    // host, so the shared link's in-app URLs are bare (`/wishlist`) instead of
    // `/a/{appId}/wishlist`. injectMeta reads this to force 'domain' route-mode.
    // It is in STRIPPED_REQUEST_HEADERS above, so an inbound visitor cannot set it.
    headers.set('x-exepad-serve-mode', 'domain');
    // Advertise the PUBLIC tunnel host so injectMeta renders canonical/OG/schema
    // URLs against it instead of the loopback INNER_ORIGIN (`http://127.0.0.1`).
    // Both forwarded headers are stripped inbound (above), so only this trusted
    // value survives. The proto is always https (the trycloudflare edge is TLS).
    const publicOrigin = opts.getPublicOrigin?.() ?? null;
    if (publicOrigin) {
      try {
        headers.set('x-forwarded-host', new URL(publicOrigin).host);
      } catch {
        /* malformed origin — fall back to leaving the header unset */
      }
    }
    headers.set('x-forwarded-proto', 'https');

    // (4) Re-enter the real app on the rewritten path, forcing a loopback origin
    //     so route-mode resolution is deterministic PATH mode.
    const target = new URL(result.path + url.search, INNER_ORIGIN);
    const init: RequestInit & { duplex?: 'half' } = { method: c.req.method, headers };
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      init.body = c.req.raw.body;
      init.duplex = 'half';
    }
    return inner(new Request(target, init), env);
  });

  return pub;
}
