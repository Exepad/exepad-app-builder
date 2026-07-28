// @vitest-environment node
/**
 * SECURITY REGRESSION SUITE — the merge gate for the one-click "Share live URL"
 * feature. Drives buildPublishApp() directly with a SPY inner so we assert which
 * requests ever reach the real runtime app. The invariant: nothing outside app
 * X's published surface may reach an operator handler or another app.
 *
 * A red row here BLOCKS merge. This file is in the default `vitest run` set —
 * it must NOT be flag-gated.
 */
import { describe, it, expect } from 'vitest';
import { buildPublishApp } from '../../../worker/src/lib/publish-profile';
import type { Env } from '../../../worker/src/types/env';

const APP = 'appx123';
const OTHER = 'otherapp9';

function harness(accessToken: string | null = null) {
  const state: { lastReq: Request | null } = { lastReq: null };
  const inner = (req: Request): Response => {
    state.lastReq = req;
    return new Response('forwarded', { status: 200 });
  };
  const app = buildPublishApp(APP, {} as Env, { inner, accessToken });
  const call = (path: string, init?: RequestInit): Promise<Response> => {
    state.lastReq = null;
    return app.fetch(new Request('https://rand.trycloudflare.com' + path, init), {} as Env);
  };
  return { call, state };
}

function fwdPath(state: { lastReq: Request | null }): string | null {
  return state.lastReq ? new URL(state.lastReq.url).pathname : null;
}

describe('published-only profile: blocked surfaces never reach the operator/other apps', () => {
  // Each row must 403 AND never reach the inner app.
  const HARD_DENY: Array<[string, string]> = [
    ['POST', '/auth/login'],
    ['POST', '/auth/setup'],
    ['POST', '/auth/logout'],
    ['GET', `/api/admin/${APP}/users`],
    ['POST', `/api/admin/${APP}/database`],
    ['GET', '/api/settings'],
    ['GET', '/api/settings/models'],
    ['POST', '/api/orchestrate/run'],
    ['POST', `/api/deploy/${APP}`],
    ['POST', `/api/deprovision/${APP}`],
    ['GET', '/api/auth/oauth/start'],
    ['POST', '/api/platform/email/send'],
    ['POST', '/api/publish/start'],
    ['GET', `/api/${APP}/mcp`],
    ['POST', `/api/${APP}/_diag/execute_handler`],
    ['GET', `/a/preview-${APP}/repo/x.js`],
    ['GET', `/a/${APP}/__refresh?pt=x`],
    ['GET', `/a/${OTHER}/repo/x.js`],
    ['GET', `/a/${OTHER}/published/assets/y.png`],
    ['POST', `/api/${OTHER}/rpc`],
    ['GET', `/api/${OTHER}/app-config`],
    ['POST', '/agent/r'],
    ['POST', '/internal/invalidate-config'],
  ];

  for (const [method, path] of HARD_DENY) {
    it(`403s ${method} ${path} and never forwards`, async () => {
      const h = harness();
      const res = await h.call(path, { method });
      expect(res.status).toBe(403);
      expect(h.state.lastReq).toBeNull();
    });
  }

  // GET requests to operator paths fall through to the app-X shell — they are
  // path-rewritten under /a/{appX}, so they cannot reach the operator handler.
  const SHELL_CONTAINED: Array<[string, string]> = [
    ['GET', '/auth/me'],
    ['GET', '/auth/status'],
    ['GET', '/agent/r'],
    ['GET', '/verify-email?token=x'],
    ['GET', '/internal/invalidate-config'],
  ];

  for (const [method, path] of SHELL_CONTAINED) {
    it(`contains ${method} ${path} inside the app-X shell`, async () => {
      const h = harness();
      const res = await h.call(path, { method });
      expect(res.status).toBe(200);
      const p = fwdPath(h.state);
      expect(p, `${path} forwarded to ${p}`).toMatch(new RegExp(`^/a/${APP}/`));
    });
  }
});

describe('published-only profile: path-normalization bypasses are denied', () => {
  // These survive WHATWG URL parsing as-is and must be caught by our normalizer.
  const BYPASS: Array<[string, string]> = [
    ['GET', `//api/admin/${APP}/users`], // collapsed → /api/admin
    ['GET', '/api/%61dmin/x'], // decoded → /api/admin
    ['POST', `/api/%2f${OTHER}/rpc`], // decoded slash → /api/{other}
  ];
  for (const [method, path] of BYPASS) {
    it(`403s ${method} ${path}`, async () => {
      const h = harness();
      const res = await h.call(path, { method });
      expect(res.status).toBe(403);
      expect(h.state.lastReq).toBeNull();
    });
  }

  // `%2e%2e` traversal is collapsed by the WHATWG URL parser BEFORE our handler
  // runs (e.g. /api/%2e%2e/settings → /settings), so it can never reach the
  // target. It then falls through to the app-X shell — neutralized, not a leak.
  const COLLAPSED: Array<[string, string]> = [
    ['GET', '/api/%2e%2e/settings'],
    ['GET', `/a/%2e%2e/${OTHER}/repo/x.js`],
  ];
  for (const [method, path] of COLLAPSED) {
    it(`neutralizes ${method} ${path} into the app-X shell`, async () => {
      const h = harness();
      const res = await h.call(path, { method });
      const p = fwdPath(h.state);
      // Either denied, or forwarded only under app X's own shell — never to the
      // operator/other-app surface the traversal targeted.
      if (p !== null) {
        expect(p, `${path} forwarded to ${p}`).toMatch(new RegExp(`^/a/${APP}/`));
        expect(p).not.toMatch(/^\/api\//);
      } else {
        expect(res.status).toBe(403);
      }
    });
  }
});

describe('published-only profile: inbound trust headers + operator cookie are stripped', () => {
  it('re-stamps app X, drops spoofed identity/mode/secret headers, keeps app session cookie', async () => {
    const h = harness();
    const res = await h.call(`/api/${APP}/rpc`, {
      method: 'POST',
      headers: {
        'x-exepad-app-id': OTHER,
        'x-exepad-rewritten': '1',
        'x-exepad-serve-mode': 'path',
        authorization: 'Bearer exepad_sk_attacker',
        'x-user-id': 'attacker',
        'x-user-email': 'a@b.c',
        'x-user-roles': 'admin',
        'x-deploy-mode': 'preview',
        'x-deploy-secret': 'leak',
        'x-diagnostic-secret': 'leak',
        'x-service-token': 'leak',
        'x-platform-token': 'leak',
        cookie: 'exepad_platform_session=operator; exepad_app_session=enduser; __exepad_pa=preview',
        'content-type': 'application/json',
      },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const req = h.state.lastReq!;
    expect(req).not.toBeNull();
    expect(req.headers.get('x-exepad-app-id')).toBe(APP);
    expect(req.headers.get('x-exepad-rewritten')).toBe('1');
    // The serve-mode pin is stripped-then-re-stamped: a spoofed inbound value
    // ('path') must not survive — the proxy always re-stamps 'domain'.
    expect(req.headers.get('x-exepad-serve-mode')).toBe('domain');
    for (const spoofed of [
      'authorization',
      'x-user-id',
      'x-user-email',
      'x-user-roles',
      'x-deploy-mode',
      'x-deploy-secret',
      'x-diagnostic-secret',
      'x-service-token',
      'x-platform-token',
    ]) {
      expect(req.headers.get(spoofed), `${spoofed} must be stripped`).toBeNull();
    }
    // Operator + preview cookies stripped; app X's own end-user cookie preserved.
    expect(req.headers.get('cookie')).toBe('exepad_app_session=enduser');
  });

  it('re-stamps the domain-mode serve pin on the app-X shell (bare in-app URLs)', async () => {
    const h = harness();
    const res = await h.call('/', { headers: { cookie: 'exepad_app_session=enduser' } });
    expect(res.status).toBe(200);
    // The shell is still path-pinned to /a/{appX}/ (security unchanged) ...
    expect(fwdPath(h.state)).toBe(`/a/${APP}/`);
    // ... but carries the domain-serve pin so injectMeta forces basePath=''.
    expect(h.state.lastReq!.headers.get('x-exepad-serve-mode')).toBe('domain');
    // No getPublicOrigin here → a spoofed inbound X-Forwarded-Host is dropped and
    // not re-stamped (canonical falls back to same-origin, never the forgery).
    expect(h.state.lastReq!.headers.get('x-forwarded-host')).toBeNull();
  });

  it('advertises the real public tunnel host via X-Forwarded-Host and drops inbound forgery', async () => {
    const state: { lastReq: Request | null } = { lastReq: null };
    const inner = (req: Request): Response => {
      state.lastReq = req;
      return new Response('ok', { status: 200 });
    };
    const app = buildPublishApp(APP, {} as Env, {
      inner,
      getPublicOrigin: () => 'https://foo-bar.trycloudflare.com',
    });
    const res = await app.fetch(
      new Request('https://foo-bar.trycloudflare.com/wishlist', {
        // attacker tries to poison the canonical host/proto
        headers: { 'x-forwarded-host': 'evil.example.com', 'x-forwarded-proto': 'http' },
      }),
      {} as Env,
    );
    expect(res.status).toBe(200);
    const req = state.lastReq!;
    // Spoofed inbound values dropped; proxy re-stamps the trusted public origin.
    expect(req.headers.get('x-forwarded-host')).toBe('foo-bar.trycloudflare.com');
    expect(req.headers.get('x-forwarded-proto')).toBe('https');
  });

  it('treats a logged-in operator opening the link as anonymous (no platform session forwarded)', async () => {
    const h = harness();
    await h.call('/', {
      headers: { cookie: 'exepad_platform_session=operator' },
    });
    const cookie = h.state.lastReq?.headers.get('cookie') ?? '';
    expect(cookie).not.toContain('exepad_platform_session');
  });
});

describe('published-only profile: positive paths reach app X with the right rewrite', () => {
  const cases: Array<[string, string, string]> = [
    ['GET', '/', `/a/${APP}/`],
    ['GET', '/index.html', `/a/${APP}/`],
    ['GET', '/dashboard', `/a/${APP}/dashboard`],
    ['GET', '/repo/components/Card.js', '/repo/components/Card.js'],
    ['GET', '/published/assets/logo.png', '/published/assets/logo.png'],
    ['GET', `/a/${APP}/repo/x.js`, `/a/${APP}/repo/x.js`],
    ['POST', `/api/${APP}/rpc`, `/api/${APP}/rpc`],
    ['GET', `/api/${APP}/app-config`, `/api/${APP}/app-config`],
    ['GET', '/assets/index-aB3dEf12.js', '/assets/index-aB3dEf12.js'],
    ['GET', '/favicon.ico', '/favicon.ico'],
    ['GET', '/robots.txt', `/a/${APP}/robots.txt`],
  ];
  for (const [method, path, expected] of cases) {
    it(`forwards ${method} ${path} → ${expected}`, async () => {
      const h = harness();
      const res = await h.call(path, { method });
      expect(res.status).toBe(200);
      expect(fwdPath(h.state)).toBe(expected);
      // Re-entry uses the fixed loopback origin (→ deterministic path mode).
      expect(new URL(h.state.lastReq!.url).hostname).toBe('127.0.0.1');
      expect(h.state.lastReq!.headers.get('x-exepad-app-id')).toBe(APP);
    });
  }
});

describe('published-only profile: optional access-token gate', () => {
  it('401s without a key', async () => {
    const h = harness('s3cr3t');
    const res = await h.call('/');
    expect(res.status).toBe(401);
    expect(h.state.lastReq).toBeNull();
  });
  it('401s with the wrong key', async () => {
    const h = harness('s3cr3t');
    const res = await h.call('/?k=wrong');
    expect(res.status).toBe(401);
    expect(h.state.lastReq).toBeNull();
  });
  it('sets the gate cookie and redirects on a correct ?k=', async () => {
    const h = harness('s3cr3t');
    const res = await h.call('/?k=s3cr3t');
    expect(res.status).toBe(302);
    expect(res.headers.get('set-cookie')).toContain('exepad_pub_gate=s3cr3t');
    expect(h.state.lastReq).toBeNull();
  });
  it('forwards once the gate cookie is present', async () => {
    const h = harness('s3cr3t');
    const res = await h.call('/', { headers: { cookie: 'exepad_pub_gate=s3cr3t' } });
    expect(res.status).toBe(200);
    expect(fwdPath(h.state)).toBe(`/a/${APP}/`);
  });
});
