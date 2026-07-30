// @vitest-environment node
/**
 * Unit coverage for the gateway dispatch/config/utils seam:
 *   - dispatch.ts  → buildRpcBody (incl. prototype-pollution surface),
 *                    parseRpcEnvelope, resolveBackendRoute (authz),
 *                    resolveRpcDispatchTarget
 *   - config.ts    → loadAppConfig in-memory cache + invalidateGatewayConfig
 *   - utils.ts     → getCookieValue / getCookieValues (malformed/duplicate)
 *
 * These are pure functions exercised directly (no Hono app needed). The node
 * environment matches the in-process-dispatch sibling and keeps the global
 * Cache API undefined so config.ts falls through to the R2 stub deterministically.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildRpcBody,
  parseRpcEnvelope,
  resolveBackendRoute,
  resolveRpcDispatchTarget,
} from '../../../../worker/src/routes/gateway/dispatch';
import {
  loadAppConfig,
  invalidateGatewayConfig,
  configCache,
} from '../../../../worker/src/routes/gateway/config';
import {
  getCookieValue,
  getCookieValues,
} from '../../../../worker/src/routes/gateway/utils';
import {
  buildDispatchHeaders,
  mintSessionToken,
  PLATFORM_SESSION_COOKIE,
} from '../../../../worker/src/routes/gateway/auth';
import type { AppConfig } from '../../../../worker/src/routes/gateway/types';
import type { Env } from '../../../../worker/src/types/env';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function postRequest(body: unknown, url = 'http://gw.internal/rpc'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function rawPostRequest(raw: string, url = 'http://gw.internal/rpc'): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw,
  });
}

function getRequest(url: string): Request {
  return new Request(url, { method: 'GET' });
}

function cookieRequest(cookieHeader: string): Request {
  return new Request('http://gw.internal/rpc', {
    method: 'GET',
    headers: { Cookie: cookieHeader },
  });
}

// ─── buildRpcBody — POST model routes ──────────────────────────────────────────

describe('buildRpcBody — POST model route', () => {
  it('passes through an explicit method + params envelope unchanged', async () => {
    const req = postRequest({ method: 'sys_list', params: { limit: 10 } });
    const out = await buildRpcBody(req, 'contacts', 'model');
    expect(out).toEqual({ method: 'sys_list', model: 'contacts', params: { limit: 10 } });
  });

  it('defaults the method to sys_list when none is provided', async () => {
    const req = postRequest({ params: {} });
    const out = await buildRpcBody(req, 'contacts', 'model');
    expect(out.method).toBe('sys_list');
    expect(out.model).toBe('contacts');
  });

  it('wraps bare form fields as params.data for sys_create', async () => {
    const req = postRequest({ method: 'sys_create', name: 'Ada', email: 'ada@x.com' });
    const out = await buildRpcBody(req, 'contacts', 'model');
    expect(out).toEqual({
      method: 'sys_create',
      model: 'contacts',
      params: { data: { name: 'Ada', email: 'ada@x.com' } },
    });
  });

  it('wraps bare form fields as params.data for sys_update and strips the method key', async () => {
    const req = postRequest({ method: 'sys_update', id: 3, title: 'New' });
    const out = await buildRpcBody(req, 'tasks', 'model');
    expect(out.params).toEqual({ data: { id: 3, title: 'New' } });
    // The method field must not leak back into the data payload.
    expect((out.params as { data: Record<string, unknown> }).data).not.toHaveProperty('method');
  });

  it('treats a non-create/update bare body as the params object directly', async () => {
    // No params key, method is sys_delete → body (minus method) is NOT the path;
    // the else-branch uses the whole body as params.
    const req = postRequest({ method: 'sys_delete', id: 9 });
    const out = await buildRpcBody(req, 'tasks', 'model');
    expect(out.method).toBe('sys_delete');
    expect(out.params).toEqual({ method: 'sys_delete', id: 9 });
  });

  it('routes _bulk to sys_multi_query by default', async () => {
    const req = postRequest({ params: { queries: [] } });
    const out = await buildRpcBody(req, '_bulk', 'model');
    expect(out).toEqual({ method: 'sys_multi_query', params: { queries: [] } });
  });

  it('honors an explicit method on a _bulk request', async () => {
    const req = postRequest({ method: 'sys_multi_query', params: { queries: [1] } });
    const out = await buildRpcBody(req, '_bulk', 'model');
    expect(out.method).toBe('sys_multi_query');
  });
});

// ─── buildRpcBody — PROTOTYPE POLLUTION surface ───────────────────────────────

describe('buildRpcBody — prototype-pollution surface', () => {
  it('does NOT pollute Object.prototype when __proto__ appears in the body', async () => {
    const req = rawPostRequest('{"method":"sys_create","__proto__":{"polluted":"yes"},"name":"x"}');
    const out = await buildRpcBody(req, 'contacts', 'model');
    // The global prototype must remain clean regardless of how the body is shaped.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    // And the parsed envelope must be well-formed.
    expect(out.method).toBe('sys_create');
  });

  it('does NOT pollute via a nested params.__proto__ key', async () => {
    const req = rawPostRequest(
      '{"method":"sys_create","params":{"__proto__":{"isAdmin":true},"data":{"name":"x"}}}',
    );
    const out = await buildRpcBody(req, 'contacts', 'model');
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(out.params).toBeTruthy();
  });

  it('does not let a "constructor" key in form data corrupt the prototype', async () => {
    const req = rawPostRequest('{"method":"sys_update","constructor":{"x":1},"title":"t"}');
    const out = await buildRpcBody(req, 'tasks', 'model');
    expect(({} as { x?: number }).x).toBeUndefined();
    // The constructor field is treated as ordinary form data, copied into data.
    expect((out.params as { data: Record<string, unknown> }).data).toHaveProperty('title', 't');
  });

  it('falls back to a null-prototype object on malformed JSON (no pollution path)', async () => {
    const req = rawPostRequest('{not valid json');
    const out = await buildRpcBody(req, 'contacts', 'model');
    // Malformed body → method defaults to sys_list, params is the empty body.
    expect(out.method).toBe('sys_list');
    expect(out.model).toBe('contacts');
  });

  it('falls back cleanly when the body is empty', async () => {
    const req = rawPostRequest('');
    const out = await buildRpcBody(req, 'contacts', 'model');
    expect(out.method).toBe('sys_list');
  });
});

// ─── buildRpcBody — handler routes ────────────────────────────────────────────

describe('buildRpcBody — handler route', () => {
  it('uses the route name as the method and the whole body as params', async () => {
    const req = postRequest({ foo: 'bar', n: 2 });
    const out = await buildRpcBody(req, 'sendInvoice', 'handler');
    expect(out).toEqual({ method: 'sendInvoice', params: { foo: 'bar', n: 2 } });
  });

  it('handler with malformed JSON yields a null-proto empty params object', async () => {
    const req = rawPostRequest('::::');
    const out = await buildRpcBody(req, 'doThing', 'handler');
    expect(out.method).toBe('doThing');
    expect(out.params).toBeTruthy();
  });
});

// ─── buildRpcBody — GET requests ──────────────────────────────────────────────

describe('buildRpcBody — GET request', () => {
  it('maps a GET model request to sys_list with query params', async () => {
    const req = getRequest('http://gw.internal/contacts?status=active');
    const out = await buildRpcBody(req, 'contacts', 'model');
    expect(out.method).toBe('sys_list');
    expect(out.model).toBe('contacts');
    expect(out.params).toEqual({ status: 'active' });
  });

  it('coerces limit and offset query params to numbers', async () => {
    const req = getRequest('http://gw.internal/contacts?limit=25&offset=50&q=x');
    const out = await buildRpcBody(req, 'contacts', 'model');
    const params = out.params as Record<string, unknown>;
    expect(params.limit).toBe(25);
    expect(params.offset).toBe(50);
    expect(typeof params.limit).toBe('number');
    expect(params.q).toBe('x'); // non-numeric params left as strings
  });

  it('leaves a non-numeric limit untouched (NaN guard)', async () => {
    const req = getRequest('http://gw.internal/contacts?limit=abc');
    const out = await buildRpcBody(req, 'contacts', 'model');
    expect((out.params as Record<string, unknown>).limit).toBe('abc');
  });

  it('GET handler route uses the route name as method and omits model', async () => {
    const req = getRequest('http://gw.internal/ping?x=1');
    const out = await buildRpcBody(req, 'ping', 'handler');
    expect(out.method).toBe('ping');
    expect(out.model).toBeUndefined();
    expect(out.params).toEqual({ x: '1' });
  });
});

// ─── parseRpcEnvelope ─────────────────────────────────────────────────────────

describe('parseRpcEnvelope', () => {
  it('returns the parsed object for a valid POST body', async () => {
    const req = postRequest({ method: 'sys_list', model: 'contacts' });
    const out = await parseRpcEnvelope(req);
    expect(out).toEqual({ method: 'sys_list', model: 'contacts' });
  });

  it('returns {} for a non-POST request without reading the body', async () => {
    const req = getRequest('http://gw.internal/rpc?method=sys_list');
    expect(await parseRpcEnvelope(req)).toEqual({});
  });

  it('returns {} for malformed JSON', async () => {
    const req = rawPostRequest('}{');
    expect(await parseRpcEnvelope(req)).toEqual({});
  });

  it('returns {} when the JSON body is a primitive, not an object', async () => {
    const req = rawPostRequest('42');
    expect(await parseRpcEnvelope(req)).toEqual({});
  });

  it('returns {} when the JSON body is null', async () => {
    const req = rawPostRequest('null');
    expect(await parseRpcEnvelope(req)).toEqual({});
  });
});

// ─── resolveBackendRoute — route resolution + authz ──────────────────────────

const DYNAMIC_CONFIG: AppConfig = {
  backend: {
    mode: 'dynamic',
    models: [{ name: 'contacts' }, { name: 'tasks' }],
    handlers: [{ name: 'sendInvoice' }],
  } as never,
};

describe('resolveBackendRoute', () => {
  it('resolves a known model', () => {
    expect(resolveBackendRoute(DYNAMIC_CONFIG, 'contacts')).toEqual({ type: 'model', name: 'contacts' });
  });

  it('resolves a known handler', () => {
    expect(resolveBackendRoute(DYNAMIC_CONFIG, 'sendInvoice')).toEqual({ type: 'handler', name: 'sendInvoice' });
  });

  it('always resolves _bulk as a model regardless of config', () => {
    expect(resolveBackendRoute({} as AppConfig, '_bulk')).toEqual({ type: 'model', name: '_bulk' });
  });

  it('returns null for an unknown route (authz: undeclared name is not callable)', () => {
    expect(resolveBackendRoute(DYNAMIC_CONFIG, 'secret_admin_model')).toBeNull();
  });

  it('returns null when backend is missing entirely', () => {
    expect(resolveBackendRoute({} as AppConfig, 'contacts')).toBeNull();
  });

  it('returns null when backend mode is not "dynamic"', () => {
    const cfg = { backend: { mode: 'static', models: [{ name: 'contacts' }] } } as never as AppConfig;
    expect(resolveBackendRoute(cfg, 'contacts')).toBeNull();
  });

  it('resolves auth_* routes ONLY when security config is present', () => {
    const secured = { security: { provider: 'local' } } as never as AppConfig;
    expect(resolveBackendRoute(secured, 'auth_login')).toEqual({ type: 'handler', name: 'auth_login' });
    // Without a security block, auth_* is not a privileged path.
    expect(resolveBackendRoute({} as AppConfig, 'auth_login')).toBeNull();
  });

  it('resolves admin_* routes only when security config is present', () => {
    const secured = { security: { provider: 'local' } } as never as AppConfig;
    expect(resolveBackendRoute(secured, 'admin_users')).toEqual({ type: 'handler', name: 'admin_users' });
    expect(resolveBackendRoute({ backend: { mode: 'dynamic' } } as never as AppConfig, 'admin_users')).toBeNull();
  });

  it('does not let an auth_-prefixed model name bypass model resolution rules', () => {
    // A model literally named auth_foo would be matched by the security short-circuit
    // as a handler. This pins the precedence: security gate wins for auth_/admin_.
    const cfg = {
      security: { provider: 'local' },
      backend: { mode: 'dynamic', models: [{ name: 'auth_foo' }] },
    } as never as AppConfig;
    expect(resolveBackendRoute(cfg, 'auth_foo')).toEqual({ type: 'handler', name: 'auth_foo' });
  });
});

// ─── resolveRpcDispatchTarget ─────────────────────────────────────────────────

describe('resolveRpcDispatchTarget', () => {
  it('returns null when method is missing or not a string', () => {
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, {})).toBeNull();
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 123 })).toBeNull();
  });

  it('resolves sys_multi_query to the _bulk model', () => {
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 'sys_multi_query' })).toEqual({
      method: 'sys_multi_query',
      name: '_bulk',
      type: 'model',
    });
  });

  it('resolves a sys_ method against the named model', () => {
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 'sys_update', model: 'tasks' })).toEqual({
      method: 'sys_update',
      name: 'tasks',
      type: 'model',
    });
  });

  it('returns null when a sys_ method has no model name', () => {
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 'sys_update' })).toBeNull();
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 'sys_update', model: 42 })).toBeNull();
  });

  it('returns null when a sys_ method targets an unknown model (authz)', () => {
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 'sys_read', model: 'ghost' })).toBeNull();
  });

  it('returns null when a sys_ method targets a handler name (type mismatch)', () => {
    // sendInvoice is a handler — a sys_ method must not resolve to it.
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 'sys_read', model: 'sendInvoice' })).toBeNull();
  });

  it('resolves a non-sys method as a handler call', () => {
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 'sendInvoice' })).toEqual({
      method: 'sendInvoice',
      name: 'sendInvoice',
      type: 'handler',
    });
  });

  it('returns null for a non-sys method that matches no declared route', () => {
    expect(resolveRpcDispatchTarget(DYNAMIC_CONFIG, { method: 'arbitraryRpc' })).toBeNull();
  });
});

// ─── config.ts — in-memory cache + invalidation ──────────────────────────────

/**
 * Minimal R2-surface stub. config.ts only touches `CONFIG_CACHE.get(...)`,
 * and (for resolveConfigKey) reads the deployment-status pointer + the config
 * object. `getCount` lets us assert the in-memory cache short-circuits R2.
 */
function makeConfigEnv(appConfig: AppConfig | null): { env: Env; getCount: () => number } {
  let getCount = 0;
  const env = {
    CONFIG_CACHE: {
      get: async (key: string) => {
        getCount++;
        if (key.endsWith('deployment-status-published.json') || key.endsWith('deployment-status-preview.json')) {
          // Point at a stable config path.
          return { json: async () => ({ configPath: 'published/app-config.json' }) };
        }
        if (key.endsWith('app-config.json')) {
          if (appConfig === null) return null;
          return { json: async () => appConfig };
        }
        return null;
      },
    },
  } as unknown as Env;
  return { env, getCount: () => getCount };
}

describe('config.ts — loadAppConfig in-memory cache', () => {
  beforeEach(() => {
    configCache.clear();
  });

  it('loads a config from R2 and serves the second call from the in-memory cache', async () => {
    const cfg: AppConfig = { backend: { mode: 'dynamic', models: [{ name: 'm' }] } as never };
    const { env, getCount } = makeConfigEnv(cfg);

    const first = await loadAppConfig('app1', 'published', env);
    expect(first).toEqual(cfg);
    const countAfterFirst = getCount();
    expect(countAfterFirst).toBeGreaterThan(0);

    const second = await loadAppConfig('app1', 'published', env);
    expect(second).toEqual(cfg);
    // Cache hit → R2 must not be touched again.
    expect(getCount()).toBe(countAfterFirst);
  });

  it('caches a null (not-found) result for published mode', async () => {
    const { env, getCount } = makeConfigEnv(null);
    const first = await loadAppConfig('missing', 'published', env);
    expect(first).toBeNull();
    const countAfterFirst = getCount();

    const second = await loadAppConfig('missing', 'published', env);
    expect(second).toBeNull();
    // The negative result is cached too — no second R2 round-trip.
    expect(getCount()).toBe(countAfterFirst);
  });

  it('does NOT cache a null result for preview mode (deploy may be in flight)', async () => {
    const { env, getCount } = makeConfigEnv(null);
    await loadAppConfig('pending', 'preview', env);
    const countAfterFirst = getCount();

    await loadAppConfig('pending', 'preview', env);
    // Preview null is re-fetched, so the R2 get-count grows.
    expect(getCount()).toBeGreaterThan(countAfterFirst);
  });

  it('keys the cache per app+mode (no cross-mode leak)', async () => {
    const pub: AppConfig = { backend: { mode: 'dynamic', models: [{ name: 'pub' }] } as never };
    const { env } = makeConfigEnv(pub);
    await loadAppConfig('app2', 'published', env);
    expect(configCache.has('app2:published')).toBe(true);
    expect(configCache.has('app2:preview')).toBe(false);
  });
});

describe('config.ts — invalidateGatewayConfig', () => {
  beforeEach(() => {
    configCache.clear();
  });

  it('drops the in-memory entry so the next load re-reads R2', async () => {
    const cfg: AppConfig = { backend: { mode: 'dynamic', models: [{ name: 'm' }] } as never };
    const { env, getCount } = makeConfigEnv(cfg);

    await loadAppConfig('app3', 'published', env);
    const countBefore = getCount();
    expect(configCache.has('app3:published')).toBe(true);

    await invalidateGatewayConfig('app3', 'published');
    expect(configCache.has('app3:published')).toBe(false);

    await loadAppConfig('app3', 'published', env);
    // Re-read forced → R2 touched again after invalidation.
    expect(getCount()).toBeGreaterThan(countBefore);
  });

  it('only invalidates the targeted mode', async () => {
    const cfg: AppConfig = { backend: { mode: 'dynamic' } as never };
    const { env } = makeConfigEnv(cfg);
    await loadAppConfig('app4', 'published', env);
    await loadAppConfig('app4', 'preview', env);
    expect(configCache.has('app4:published')).toBe(true);
    expect(configCache.has('app4:preview')).toBe(true);

    await invalidateGatewayConfig('app4', 'published');
    expect(configCache.has('app4:published')).toBe(false);
    expect(configCache.has('app4:preview')).toBe(true);
  });

  it('is a no-op (does not throw) when the entry does not exist', async () => {
    await expect(invalidateGatewayConfig('never-cached', 'published')).resolves.toBeUndefined();
  });
});

// ─── utils.ts — cookie parsing ────────────────────────────────────────────────

describe('utils.ts — getCookieValue / getCookieValues', () => {
  it('returns the value of a single named cookie', () => {
    const req = cookieRequest('session=abc123');
    expect(getCookieValue(req, 'session')).toBe('abc123');
    expect(getCookieValues(req, 'session')).toEqual(['abc123']);
  });

  it('parses one cookie out of several', () => {
    const req = cookieRequest('a=1; session=xyz; b=2');
    expect(getCookieValue(req, 'session')).toBe('xyz');
  });

  it('returns undefined / [] when the cookie is absent', () => {
    const req = cookieRequest('a=1; b=2');
    expect(getCookieValue(req, 'session')).toBeUndefined();
    expect(getCookieValues(req, 'session')).toEqual([]);
  });

  it('returns undefined / [] when there is no Cookie header', () => {
    const req = getRequest('http://gw.internal/');
    expect(getCookieValue(req, 'session')).toBeUndefined();
    expect(getCookieValues(req, 'session')).toEqual([]);
  });

  it('returns ALL values for a duplicated cookie name (path-scoped duplicates)', () => {
    // RFC 6265 puts the more-specific path first; getCookieValues preserves order.
    const req = cookieRequest('session=narrow; other=z; session=broad');
    expect(getCookieValues(req, 'session')).toEqual(['narrow', 'broad']);
    // getCookieValue returns the first (more-specific) one.
    expect(getCookieValue(req, 'session')).toBe('narrow');
  });

  it('preserves "=" characters inside the cookie value (e.g. base64/JWT)', () => {
    const req = cookieRequest('token=aGVsbG8=world==');
    expect(getCookieValue(req, 'token')).toBe('aGVsbG8=world==');
  });

  it('tolerates extra whitespace and a trailing semicolon', () => {
    const req = cookieRequest('  session = sp ;  ');
    // The key is trimmed but not the inner space before "=", so " session" won't
    // match "session"; the part is "session " after trim of the segment only at edges.
    // Validate the documented behavior: segment is trimmed, then split on "=".
    // "session = sp" → trim → "session = sp" → split "=" → key="session " (with space).
    expect(getCookieValues(req, 'session')).toEqual([]);
    // Whereas a tightly-formatted duplicate-free cookie still parses.
    const tight = cookieRequest('session=ok;');
    expect(getCookieValue(tight, 'session')).toBe('ok');
  });

  it('handles a malformed cookie segment with no "=" without throwing', () => {
    const req = cookieRequest('flagonly; session=v');
    expect(getCookieValue(req, 'session')).toBe('v');
    // The valueless segment maps to key="flagonly", value="" — distinct name.
    expect(getCookieValues(req, 'flagonly')).toEqual(['']);
  });

  it('returns an empty-string value for a cookie present with no value', () => {
    const req = cookieRequest('session=; other=1');
    expect(getCookieValue(req, 'session')).toBe('');
  });

  it('does not match a cookie name as a substring of another', () => {
    const req = cookieRequest('mysession=x; sessionid=y');
    expect(getCookieValue(req, 'session')).toBeUndefined();
  });
});

describe('buildDispatchHeaders — preview demo-sandbox identity', () => {
  const SECRET = 'gw-dispatch-test-secret-0123456789';
  const APP_ID = 'aprev123';
  const UID = 'real-operator-uid-42';

  function hdrEnv(): Env {
    // A service token is always populated in real self-host (build-runtime-env
    // generates one if unset); buildDispatchHeaders now fails closed without it.
    return {
      PLATFORM_BRIDGE_SECRET: SECRET,
      ENVIRONMENT: 'selfhost',
      USER_WORKER_SERVICE_TOKEN: SECRET,
    } as unknown as Env;
  }
  async function sessionRequest(): Promise<Request> {
    const token = await mintSessionToken(UID, 'op@x.com', ['admin'], SECRET);
    return new Request('https://gw.internal/api/x', {
      headers: { Cookie: `${PLATFORM_SESSION_COOKIE}=${token}` },
    });
  }

  it('routes the data identity to preview-owner-{appId} for an authed operator in PREVIEW', async () => {
    const headers = await buildDispatchHeaders(await sessionRequest(), APP_ID, 'preview', hdrEnv());
    // Seed rows are written under preview-owner-{appId}; the operator's data
    // identity is remapped to it so the seeded demo app isn't empty on first view.
    expect(headers.get('X-User-Id')).toBe(`preview-owner-${APP_ID}`);
    // Display identity (email) is preserved — only the row-scoping id changes.
    expect(headers.get('X-User-Email')).toBe('op@x.com');
  });

  it('does NOT inject the operator identity on the PUBLISHED surface (public view)', async () => {
    // Published is the public view of the app: the operator's platform session
    // must not bleed in, so the owner sees exactly what an anonymous visitor
    // sees. Admin on published requires an app-level login or API key; the
    // operator administers via the preview/studio surface (test above).
    const headers = await buildDispatchHeaders(await sessionRequest(), APP_ID, 'published', hdrEnv());
    expect(headers.get('X-User-Id')).toBeNull();
    expect(headers.get('X-User-Roles')).toBeNull();
  });

  it('does not invent an identity for an unauthenticated preview request', async () => {
    const anon = new Request('https://gw.internal/api/x');
    const headers = await buildDispatchHeaders(anon, APP_ID, 'preview', hdrEnv());
    // No auth → no X-User-Id at all (the remap only fires for authed callers
    // that already carry an identity header).
    expect(headers.get('X-User-Id')).toBeNull();
  });
});
