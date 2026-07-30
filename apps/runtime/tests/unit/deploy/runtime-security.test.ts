import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import app from '../../../worker/src/index';
import { email as emailRouter } from '../../../worker/src/routes/email';
import {
  PREVIEW_ACCESS_TTL_SECONDS,
  mintPreviewAccessToken,
  resolveGatewayIdentity,
  validateRouterSecret,
} from '../../../worker/src/routes/gateway/auth';

const APP_ID = 'app-1';
const ROUTER_SECRET = 'router-secret';
const BRIDGE_SECRET = 'bridge-secret';

const previewConfig = {
  name: 'Preview App',
  security: {
    authProviders: [{ provider: 'email' }],
    defaultAccess: 'private',
  },
};

const indexHtml = `<!DOCTYPE html>
<html>
  <head></head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>`;

function createR2Object(body: string, jsonValue?: unknown) {
  return {
    body: new Response(body).body,
    etag: 'etag-1',
    text: vi.fn(async () => body),
    json: vi.fn(async () => jsonValue ?? JSON.parse(body)),
  };
}

function createMockEnv(overrides: Record<string, unknown> = {}) {
  const userState = new Map<string, string>();
  return {
    ASSETS: {
      fetch: vi.fn(async (input: RequestInfo | URL) => {
        const request = input instanceof Request ? input : new Request(input);
        const pathname = new URL(request.url).pathname;
        if (pathname === '/index.html') {
          return new Response(indexHtml, { headers: { 'Content-Type': 'text/html' } });
        }
        if (pathname === '/assets/index.js') {
          return new Response('console.log("runtime");', {
            headers: { 'Content-Type': 'application/javascript' },
          });
        }
        return new Response('missing', { status: 404 });
      }),
    },
    CONFIG_CACHE: {
      get: vi.fn(async (key: string) => {
        if (key === `${APP_ID}/deployment-status-preview.json`) {
          return createR2Object(JSON.stringify({ configPath: 'repo/config.json' }), { configPath: 'repo/config.json' });
        }
        if (key === `${APP_ID}/repo/config.json`) {
          return createR2Object(JSON.stringify(previewConfig), previewConfig);
        }
        if (key === `${APP_ID}/published/app-config.json`) {
          return createR2Object(JSON.stringify(previewConfig), previewConfig);
        }
        return null;
      }),
    },
    USER_STATE: {
      get: vi.fn(async (key: string) => {
        const value = userState.get(key);
        return value ? JSON.parse(value) : null;
      }),
      put: vi.fn(async (key: string, value: string) => {
        userState.set(key, value);
      }),
    },
    USER_WORKERS: undefined,
    PLATFORM_BRIDGE_SECRET: BRIDGE_SECRET,
    EXEPAD_ROUTER_SECRET: ROUTER_SECRET,
    USER_WORKER_SERVICE_TOKEN: 'runtime-worker-secret',
    PLATFORM_DOMAINS: 'p1.exepad.com',
    ENVIRONMENT: 'production',
    ...overrides,
  } as any;
}

function mockRequest(url: string, headers: Record<string, string> = {}): Request {
  return {
    url,
    headers: new Headers(headers),
  } as unknown as Request;
}

async function signHmacFullDigest(payloadB64: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function signPlatformBridgeToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${payloadB64}.${await signHmacFullDigest(payloadB64, secret)}`;
}

async function signLegacyPreviewToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const payloadB64 = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${payloadB64}.${await signHmacFullDigest(payloadB64, secret)}`;
}

describe('runtime security hardening', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async () => null),
        put: vi.fn(async () => undefined),
        delete: vi.fn(async () => true),
      },
    });
  });

  it('ignores spoofed X-User headers when resolving gateway identity', async () => {
    const request = mockRequest('https://runtime.exepad.com/api/app-1/things', {
      'X-User-Id': 'attacker',
      'X-User-Email': 'attacker@example.com',
      'X-User-Roles': 'admin',
    });

    const identity = await resolveGatewayIdentity(request, APP_ID, 'published', createMockEnv());

    expect(identity.isAuthenticated).toBe(false);
    expect(identity.headers.get('X-User-Id')).toBeNull();
    expect(identity.headers.get('X-Session-Token')).toBeNull();
  });

  it('accepts app session, API key, and bridge token identities', async () => {
    const env = createMockEnv();
    const sessionIdentity = await resolveGatewayIdentity(
      mockRequest('https://runtime.exepad.com/api/app-1/things', {
        Cookie: 'exepad_app_session=session-123',
      }),
      APP_ID,
      'published',
      env,
    );
    expect(sessionIdentity.kind).toBe('session');
    expect(sessionIdentity.isAuthenticated).toBe(true);

    const apiKeyIdentity = await resolveGatewayIdentity(
      mockRequest('https://runtime.exepad.com/api/app-1/things', {
        Authorization: 'Bearer exepad_sk_test',
      }),
      APP_ID,
      'published',
      env,
    );
    expect(apiKeyIdentity.kind).toBe('api_key');
    expect(apiKeyIdentity.isAuthenticated).toBe(true);

    const bridgeToken = await signPlatformBridgeToken({
      uid: 42,
      email: 'owner@example.com',
      type: 'platform_bridge',
      exp: Math.floor(Date.now() / 1000) + 300,
    }, BRIDGE_SECRET);
    const bridgeIdentity = await resolveGatewayIdentity(
      mockRequest('https://runtime.exepad.com/api/app-1/things', {
        'X-Platform-Token': bridgeToken,
      }),
      APP_ID,
      'preview',
      env,
    );
    expect(bridgeIdentity.kind).toBe('platform_bridge');
    expect(bridgeIdentity.headers.get('X-User-Id')).toBe('42');
    expect(bridgeIdentity.previewAccessToken).toBeTruthy();
    // Platform-bridge callers are not preview viewers — the header must be
    // absent so production writes never trigger the preview auto-provision
    // path in the app-backend.
    expect(bridgeIdentity.headers.get('X-Preview-Access')).toBeNull();
  });

  it('requires preview auth for HTML, bootstraps a cookie, and allows preview app-config with that cookie', async () => {
    const env = createMockEnv();
    const previewToken = await mintPreviewAccessToken(
      APP_ID,
      'preview-user',
      'preview@example.com',
      BRIDGE_SECRET,
    );

    const unauthorized = await app.request(
      `https://preview.example.com/a/preview-${APP_ID}/`,
      undefined,
      env,
    );
    expect(unauthorized.status).toBe(401);
    // The unauthorized HTML response must be the styled auth-gate page —
    // not bare text — so a user hitting a preview URL directly sees a
    // branded message instead of "Unauthorized" in a browser default font.
    expect(unauthorized.headers.get('content-type') || '').toMatch(/text\/html/);
    const unauthorizedHtml = await unauthorized.text();
    expect(unauthorizedHtml).toContain('Authentication Required');
    // The gate page must NOT link to the per-app compiled.css — that file
    // is built by scanning user components and purges any Tailwind class
    // not referenced there, which breaks the gate's specific class set.
    // It must rely on the runtime SPA's own bundle instead.
    expect(unauthorizedHtml).not.toContain(
      `/a/preview-${APP_ID}/repo/compiled/frontend/styles/compiled.css`,
    );
    // The gate page must NOT contain a "Go to Login" button or auto-redirect
    // script: when rendered inside the Agent editor iframe, any navigation
    // to app.exepad.com/signin loads the editor dashboard inside the preview
    // iframe (an "iframe-resident-dashboard" loop). Re-auth happens silently
    // via the parent keep-alive loop in app-preview-panel.tsx.
    expect(unauthorizedHtml).not.toContain('Go to Login');
    expect(unauthorizedHtml).not.toContain('window.location.replace');
    expect(unauthorizedHtml).not.toContain('app.exepad.com/signin');
    // The shell CSS files must be reachable without auth so the page above
    // can actually render in the app's design tokens.
    const cssResponse = await app.request(
      `https://preview.example.com/a/preview-${APP_ID}/repo/compiled/frontend/styles/compiled.css`,
      undefined,
      env,
    );
    expect(cssResponse.status).not.toBe(401);

    // Published deploys rewrite styles.compiled to a versioned snapshot
    // folder (`published/releases/{releaseSuffix}/styles/*.css`). These
    // must also be reachable without auth — otherwise the SPA login page
    // of any auth-gated published app renders unstyled. Guards against
    // the `PUBLIC_REPO_ASSET_PATHS` allowlist drifting from the deploy
    // pipeline's snapshot rewriter.
    const snapshotThemeResponse = await app.request(
      `https://preview.example.com/a/preview-${APP_ID}/repo/published/releases/1776168734254-deploy-abc/styles/theme.css`,
      undefined,
      env,
    );
    expect(snapshotThemeResponse.status).not.toBe(401);
    const snapshotCompiledResponse = await app.request(
      `https://preview.example.com/a/preview-${APP_ID}/repo/published/releases/1776168734254-deploy-abc/styles/compiled.css`,
      undefined,
      env,
    );
    expect(snapshotCompiledResponse.status).not.toBe(401);

    const htmlResponse = await app.request(
      `https://preview.example.com/a/preview-${APP_ID}/?pt=${encodeURIComponent(previewToken)}`,
      undefined,
      env,
    );
    expect(htmlResponse.status).toBe(200);
    const html = await htmlResponse.text();
    // A literal `/a/<appId>/…` request is path-based on any non-cloud host:
    // resolveRouteMode() short-circuits to 'path' so self-host (LAN IP / custom
    // domain) requests `/a/<appId>/repo/*` with the prefix intact instead of
    // misreading the host as domain-mode (basePath='') and 404-ing every asset.
    // `preview.example.com` is not an Exepad cloud host, so 'path' is correct.
    expect(html).toContain('data-route-mode="path"');

    const previewCookieIdentity = await resolveGatewayIdentity(
      mockRequest(`https://preview.example.com/api/preview-${APP_ID}/app-config`, {
        Cookie: `__exepad_pa=${encodeURIComponent(previewToken)}`,
      }),
      APP_ID,
      'preview',
      env,
    );
    expect(previewCookieIdentity.kind).toBe('preview_access');
    // Preview callers must be tagged with X-Preview-Access so the app-backend
    // can lazily provision an `_auth_users` row before writing settings. Any
    // regression here re-breaks the /settings page for auth-enabled apps.
    expect(previewCookieIdentity.headers.get('X-Preview-Access')).toBe('1');

    const appConfigUnauthorized = await app.request(
      `https://runtime.exepad.com/api/preview-${APP_ID}/app-config`,
      {
        headers: { 'x-exepad-secret': ROUTER_SECRET },
      },
      env,
    );
    expect(appConfigUnauthorized.status).toBe(401);

    const appConfigAuthorized = await app.request(
      `https://runtime.exepad.com/api/preview-${APP_ID}/app-config?pt=${encodeURIComponent(previewToken)}`,
      {
        headers: {
          'x-exepad-secret': ROUTER_SECRET,
        },
      },
      env,
    );
    expect(appConfigAuthorized.status).toBe(200);
  });

  it('accepts legacy preview tokens for production compatibility', async () => {
    const env = createMockEnv();
    const legacyPreviewToken = await signLegacyPreviewToken({
      uid: 6,
      app: APP_ID,
      exp: Math.floor(Date.now() / 1000) + 300,
    }, BRIDGE_SECRET);

    const htmlResponse = await app.request(
      `https://preview.example.com/a/preview-${APP_ID}/?pt=${encodeURIComponent(legacyPreviewToken)}`,
      undefined,
      env,
    );
    expect(htmlResponse.status).toBe(200);

    const previewCookieIdentity = await resolveGatewayIdentity(
      mockRequest(`https://preview.example.com/api/preview-${APP_ID}/app-config`, {
        Cookie: `__exepad_pa=${encodeURIComponent(legacyPreviewToken)}`,
      }),
      APP_ID,
      'preview',
      env,
    );
    expect(previewCookieIdentity.kind).toBe('preview_access');
    expect(previewCookieIdentity.userId).toBe('6');

    const appConfigAuthorized = await app.request(
      `https://runtime.exepad.com/api/preview-${APP_ID}/app-config?pt=${encodeURIComponent(legacyPreviewToken)}`,
      {
        headers: {
          'x-exepad-secret': ROUTER_SECRET,
        },
      },
      env,
    );
    expect(appConfigAuthorized.status).toBe(200);
  });

  it('slide-renews the preview token when the cookie-bound token is near expiry', async () => {
    // Regression for the "top-level preview tab silently expires" bug:
    // without iframe-driven keep-alive, a user who opens a preview in a new
    // tab and spends hours in client-side navigation never triggers an HTML
    // request that could renew the cookie, and their next dynamic `import()`
    // 401s. The auth layer must mint a fresh token (and flag the caller to
    // Set-Cookie it) whenever the incoming token's remaining lifetime drops
    // below the renewal threshold.
    const env = createMockEnv();
    const nearExpiryTtl = Math.floor(PREVIEW_ACCESS_TTL_SECONDS * 0.1);
    const nearExpiryToken = await mintPreviewAccessToken(
      APP_ID,
      'preview-user',
      'preview@example.com',
      BRIDGE_SECRET,
      nearExpiryTtl,
    );

    const identity = await resolveGatewayIdentity(
      mockRequest(`https://preview.example.com/a/preview-${APP_ID}/repo/compiled/frontend/components/Page_v1.js`, {
        Cookie: `__exepad_pa=${encodeURIComponent(nearExpiryToken)}`,
      }),
      APP_ID,
      'preview',
      env,
    );

    expect(identity.isAuthenticated).toBe(true);
    expect(identity.kind).toBe('preview_access');
    expect(identity.shouldRefreshPreviewCookie).toBe(true);
    // Must be a freshly-minted token, not the near-expiry one — otherwise
    // re-stamping the cookie with the same token keeps the original short exp.
    expect(identity.previewAccessToken).toBeTruthy();
    expect(identity.previewAccessToken).not.toBe(nearExpiryToken);
  });

  it('does NOT renew the cookie when the current token has plenty of TTL remaining', async () => {
    // Avoid HMAC-signing a new token on every request during steady-state
    // browsing — only renew once we're actually near expiry. Keeps both
    // per-request overhead and Set-Cookie header noise minimal.
    const env = createMockEnv();
    const freshToken = await mintPreviewAccessToken(
      APP_ID,
      'preview-user',
      'preview@example.com',
      BRIDGE_SECRET,
    );

    const identity = await resolveGatewayIdentity(
      mockRequest(`https://preview.example.com/a/preview-${APP_ID}/repo/compiled/frontend/components/Fresh_v1.js`, {
        Cookie: `__exepad_pa=${encodeURIComponent(freshToken)}`,
      }),
      APP_ID,
      'preview',
      env,
    );

    expect(identity.isAuthenticated).toBe(true);
    expect(identity.shouldRefreshPreviewCookie).toBe(false);
    // And the validated token passes through unchanged.
    expect(identity.previewAccessToken).toBe(freshToken);
  });

  it('flags shouldRefreshPreviewCookie when preview auth arrives via `?pt=` query param', async () => {
    // Bootstrap case: the caller has no cookie yet (or we want to overwrite a
    // stale one) and is auth'ing via `?pt=`. Always signal Set-Cookie so the
    // tab doesn't re-auth via query param for every subsequent subresource
    // request.
    const env = createMockEnv();
    const freshToken = await mintPreviewAccessToken(
      APP_ID,
      'preview-user',
      'preview@example.com',
      BRIDGE_SECRET,
    );

    const identity = await resolveGatewayIdentity(
      mockRequest(
        `https://preview.example.com/a/preview-${APP_ID}/repo/compiled/frontend/components/Bootstrap_v1.js?pt=${encodeURIComponent(freshToken)}`,
      ),
      APP_ID,
      'preview',
      env,
    );

    expect(identity.isAuthenticated).toBe(true);
    expect(identity.shouldRefreshPreviewCookie).toBe(true);
    expect(identity.previewAccessToken).toBeTruthy();
    // Note: outbound token may byte-match the incoming one when both are
    // minted within the same wall-clock second (identical payload → identical
    // HMAC). The renewal effect still happens — the browser sees Set-Cookie
    // and resets its Max-Age timer regardless of whether the value changed.
  });

  it('pins the preview access TTL at 12h so a top-level tab survives a typical session', async () => {
    // Regression guard for the "cookie silently expires mid-session" bug. The
    // iframe-only keep-alive (app-preview-panel.tsx::postFreshToken) doesn't
    // cover top-level tabs, so the base TTL must be long enough that an active
    // user naturally triggers a slide-renewal before expiry.
    expect(PREVIEW_ACCESS_TTL_SECONDS).toBeGreaterThanOrEqual(60 * 60 * 12);
  });

  it('routes /rpc through in-process dispatch (no external worker HTTP call)', async () => {
    // The app-backend now runs in-process; dispatch builds its Env from local
    // adapters rooted at EXEPAD_DATA_DIR. Point it at a temp dir so the
    // in-process loadConfig has a clean (empty) filesystem to read.
    const tmp = mkdtempSync(join(tmpdir(), 'exepad-sec-'));
    process.env.EXEPAD_DATA_DIR = tmp;
    const env = createMockEnv();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    try {
      const response = await app.request(
        `https://runtime.exepad.com/api/${APP_ID}/rpc`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-exepad-secret': ROUTER_SECRET,
          },
          body: JSON.stringify({
            method: 'auth_signin',
            params: { email: 'test@example.com', password: 'secret' },
          }),
        },
        env,
      );

      // Gateway accepted the request (router secret valid → not a 403 reject)
      // and dispatched it IN-PROCESS — the legacy local HTTP worker path
      // (fetch http://localhost:8787) must be gone.
      expect(response.status).not.toBe(403);
      expect(fetchSpy).not.toHaveBeenCalledWith(
        'http://localhost:8787',
        expect.anything(),
      );
    } finally {
      fetchSpy.mockRestore();
      rmSync(tmp, { recursive: true, force: true });
      delete process.env.EXEPAD_DATA_DIR;
    }
  });

  it('requires the router secret in production even for platform hosts', async () => {
    const env = createMockEnv();

    await expect(validateRouterSecret(
      new Request('https://runtime.exepad.com/api/app-1/things', {
        headers: { host: 'p1.exepad.com' },
      }),
      env,
    )).resolves.toBe(false);

    await expect(validateRouterSecret(
      new Request('https://runtime.exepad.com/api/app-1/things', {
        headers: { 'x-exepad-secret': ROUTER_SECRET },
      }),
      env,
    )).resolves.toBe(true);
  });

  it('fails closed for platform email when the internal secret is missing outside development', async () => {
    const response = await emailRouter.request('/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: 'test@example.com',
        from: { email: 'noreply@exepad.com' },
        subject: 'Hello',
        text: 'World',
      }),
    }, {
      ENVIRONMENT: 'production',
      PLATFORM_INTERNAL_SECRET: '',
    } as any);

    expect(response.status).toBe(503);
  });
});
