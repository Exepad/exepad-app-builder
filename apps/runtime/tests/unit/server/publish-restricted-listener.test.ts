// @vitest-environment node
/**
 * Unit tests for the published-only classifier (the default-deny allow-list) and
 * the cookie sanitizer — the pure security primitives, isolated from any socket.
 */
import { describe, it, expect } from 'vitest';
import { classifyAndRewrite, sanitizeCookieHeader } from '../../../worker/src/lib/publish-profile';

const APP = 'appx123';

describe('classifyAndRewrite — allow-list (forward)', () => {
  const FORWARD: Array<[string, string, string]> = [
    ['GET', '/', `/a/${APP}/`],
    ['GET', '/index.html', `/a/${APP}/`],
    ['GET', '/dashboard', `/a/${APP}/dashboard`],
    ['GET', '/settings/profile', `/a/${APP}/settings/profile`], // SPA client route, NOT /api/settings
    ['GET', '/assets/index-aB3dEf12.js', '/assets/index-aB3dEf12.js'],
    ['GET', '/runtime_assets/dist/exepad-sdk.js', '/runtime_assets/dist/exepad-sdk.js'],
    ['GET', '/favicon.ico', '/favicon.ico'],
    ['GET', '/repo/components/Card.js', '/repo/components/Card.js'],
    ['GET', '/published/assets/logo.png', '/published/assets/logo.png'],
    ['GET', `/a/${APP}/`, `/a/${APP}/`],
    ['GET', `/a/${APP}/repo/x.js`, `/a/${APP}/repo/x.js`],
    ['POST', `/api/${APP}/rpc`, `/api/${APP}/rpc`],
    ['GET', `/api/${APP}/app-config`, `/api/${APP}/app-config`],
    ['GET', '/robots.txt', `/a/${APP}/robots.txt`],
    ['GET', '/sitemap.xml', `/a/${APP}/sitemap.xml`],
    ['GET', '/agent/r', `/a/${APP}/agent/r`], // GET → shell-contained, not the proxy
  ];
  for (const [method, path, expected] of FORWARD) {
    it(`${method} ${path} → forward ${expected}`, () => {
      expect(classifyAndRewrite(APP, path, method)).toEqual({ action: 'forward', path: expected });
    });
  }
});

describe('classifyAndRewrite — deny', () => {
  const DENY: Array<[string, string]> = [
    ['POST', '/'],
    ['GET', '/api/settings'],
    ['GET', '/api/settings/models'],
    ['GET', `/api/admin/${APP}/users`],
    ['POST', '/api/orchestrate/run'],
    ['POST', '/api/publish/start'],
    ['GET', `/api/${APP}/mcp`],
    ['POST', `/api/${APP}/_diag/x`],
    ['POST', `/api/otherapp/rpc`],
    ['GET', `/a/otherapp/repo/x.js`],
    ['GET', `/a/preview-${APP}/repo/x.js`],
    ['GET', `/a/${APP}/__refresh`],
    ['POST', '/agent/r'],
    ['POST', '/internal/invalidate-config'],
    ['POST', '/some-unknown-future-route'],
    ['GET', '//api/admin'], // collapsed
    ['GET', '/api/%2e%2e/x'], // traversal
    ['GET', '/api/%61dmin/x'], // encoded → admin
    // Regression: an extension on another app's path must NOT be served verbatim.
    ['GET', '/api/otherapp/data.json'],
  ];
  for (const [method, path] of DENY) {
    it(`${method} ${path} → deny`, () => {
      expect(classifyAndRewrite(APP, path, method)).toEqual({ action: 'deny' });
    });
  }

  it('a future top-level route is denied by default (non-GET)', () => {
    expect(classifyAndRewrite(APP, '/brand-new-surface', 'POST')).toEqual({ action: 'deny' });
  });
});

describe('sanitizeCookieHeader', () => {
  it('strips the operator + preview cookies, preserves the app session', () => {
    expect(
      sanitizeCookieHeader('exepad_platform_session=op; exepad_app_session=u; __exepad_pa=p'),
    ).toBe('exepad_app_session=u');
  });
  it('preserves unrelated cookies', () => {
    expect(sanitizeCookieHeader('exepad_app_session=u; theme=dark')).toBe(
      'exepad_app_session=u; theme=dark',
    );
  });
  it('returns empty for null/empty', () => {
    expect(sanitizeCookieHeader(null)).toBe('');
    expect(sanitizeCookieHeader('')).toBe('');
  });
});
