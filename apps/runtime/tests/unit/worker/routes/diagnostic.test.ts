// @vitest-environment node
/**
 * Diagnostic probe routes — Surveyor Phase 2 Class B
 * (worker/src/routes/diagnostic.ts).
 *
 * Driven through the public Hono app (`diagnostic`) via `diagnostic.fetch()`,
 * mirroring the sibling route tests. The standalone
 * `diagnostic` app's routes are `/:appId/_diag/*` (the `/api` prefix is added
 * by `app.route('/api', diagnostic)` in index.ts, so it is NOT present here).
 *
 * The security boundary under test is two-fold:
 *   1. The `X-Diagnostic-Secret` middleware — a dedicated secret, DISTINCT
 *      from PLATFORM_BRIDGE_SECRET, that gates every probe. Empty/wrong/
 *      missing secret → 401, before any handler/DB work runs.
 *   2. query_db / sample_table are wired to the real sql-whitelist at the
 *      route boundary, so any write/DDL is 400 with a structured reason and
 *      never reaches executeD1Query. SQL_ROW_CAP (100) is enforced on
 *      results. execute_handler 404s an unknown handler before dispatch.
 *
 * The real sql-whitelist + crypto-utils + secrets are kept (they ARE the
 * boundary). The downstream collaborators are mocked so we control their
 * behaviour deterministically and can assert the route never calls them on
 * a denied path:
 *   • @exepad/deploy-utils  → getD1Database / executeD1Query
 *   • ./gateway/dispatch    → dispatchRpc
 *   • ./gateway/config      → loadAppConfig
 *   • ./gateway/auth        → resolveGatewayIdentity
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mock downstream collaborators (NOT the trust boundary) ──────────────────
const getD1Database = vi.fn();
const executeD1Query = vi.fn();
vi.mock('@exepad/deploy-utils', () => ({
  getD1Database: (...a: unknown[]) => getD1Database(...a),
  executeD1Query: (...a: unknown[]) => executeD1Query(...a),
}));

const dispatchRpc = vi.fn();
vi.mock('../../../../worker/src/routes/gateway/dispatch', () => ({
  dispatchRpc: (...a: unknown[]) => dispatchRpc(...a),
}));

const loadAppConfig = vi.fn();
vi.mock('../../../../worker/src/routes/gateway/config', () => ({
  loadAppConfig: (...a: unknown[]) => loadAppConfig(...a),
}));

const resolveGatewayIdentity = vi.fn();
vi.mock('../../../../worker/src/routes/gateway/auth', () => ({
  resolveGatewayIdentity: (...a: unknown[]) => resolveGatewayIdentity(...a),
}));

// Import AFTER the mocks are registered.
import { diagnostic } from '../../../../worker/src/routes/diagnostic';
import type { Env } from '../../../../worker/src/types/env';

const DIAG_SECRET = 'diag-secret-deadbeefdeadbeef';
const BRIDGE_SECRET = 'bridge-secret-cafebabecafebabe';

/** A SecretBinding shim (the worker reads secrets via `.get()`). */
const secret = (v: string | null | undefined) => ({ get: async () => v });

/**
 * Build an Env. By default the diagnostic secret is set and DISTINCT from the
 * platform bridge secret. `diagSecret: null` simulates an unconfigured secret.
 */
function env(
  opts: { diagSecret?: string | null; bridgeSecret?: string } = {},
): Env {
  const { diagSecret = DIAG_SECRET, bridgeSecret = BRIDGE_SECRET } = opts;
  return {
    PLATFORM_DIAGNOSTIC_SECRET: secret(diagSecret),
    PLATFORM_BRIDGE_SECRET: secret(bridgeSecret),
  } as unknown as Env;
}

/** Build a JSON Response the way the in-process app-backend would. */
function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A config whose dynamic backend exposes the given handler names. */
function configWithHandlers(...names: string[]) {
  return {
    backend: {
      mode: 'dynamic',
      handlers: names.map((name) => ({ name })),
    },
  };
}

/** POST a diag endpoint with an explicit X-Diagnostic-Secret header. */
function post(
  path: string,
  body: unknown,
  opts: { diagHeader?: string | undefined; envOpts?: Parameters<typeof env>[0] } = {},
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.diagHeader !== undefined) headers['X-Diagnostic-Secret'] = opts.diagHeader;
  return diagnostic.fetch(
    new Request(`https://host.example.com${path}`, {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    env(opts.envOpts ?? {}),
  );
}

/** GET a diag endpoint with an explicit X-Diagnostic-Secret header. */
function get(
  path: string,
  opts: { diagHeader?: string | undefined; envOpts?: Parameters<typeof env>[0] } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.diagHeader !== undefined) headers['X-Diagnostic-Secret'] = opts.diagHeader;
  return diagnostic.fetch(
    new Request(`https://host.example.com${path}`, { method: 'GET', headers }),
    env(opts.envOpts ?? {}),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible defaults: a valid D1 + identity so the auth/whitelist layers are
  // what gets exercised, not a D1-resolution failure.
  getD1Database.mockResolvedValue({ uuid: 'db-uuid-1' });
  executeD1Query.mockResolvedValue({ results: [] });
  resolveGatewayIdentity.mockResolvedValue({
    headers: new Headers(),
    isAuthenticated: true,
    kind: 'platform_session',
    stateKey: 'k',
    userRoles: [],
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// X-Diagnostic-Secret middleware
// ═══════════════════════════════════════════════════════════════════════════
describe('X-Diagnostic-Secret middleware', () => {
  it('rejects a missing header with 401 and never touches downstream', async () => {
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: undefined,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    // The middleware short-circuits before any DB / whitelist work.
    expect(executeD1Query).not.toHaveBeenCalled();
    expect(getD1Database).not.toHaveBeenCalled();
  });

  it('rejects an empty-string secret header with 401', async () => {
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: '',
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects a wrong secret with 401', async () => {
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: 'not-the-secret',
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
    expect(executeD1Query).not.toHaveBeenCalled();
  });

  it('rejects when the configured secret is unset (empty server-side secret)', async () => {
    // An unconfigured PLATFORM_DIAGNOSTIC_SECRET must fail CLOSED — even an
    // empty provided header must NOT match an empty expected secret.
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: '',
      envOpts: { diagSecret: null },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('rejects even a correct PROVIDED value when the server secret is unset', async () => {
    // Defence in depth: with no server secret, nothing should authenticate.
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: DIAG_SECRET,
      envOpts: { diagSecret: null },
    });
    expect(res.status).toBe(401);
  });

  it('is DISTINCT from PLATFORM_BRIDGE_SECRET — the bridge secret does not authenticate', async () => {
    // A leak of the bridge secret must NOT grant diagnostic access.
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: BRIDGE_SECRET,
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthorized' });
  });

  it('accepts the correct diagnostic secret and proceeds past auth', async () => {
    executeD1Query.mockResolvedValue({ results: [{ id: 1 }] });
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(200);
    // Auth passed → the whitelist + D1 path actually ran.
    expect(executeD1Query).toHaveBeenCalledTimes(1);
  });

  it('gates execute_handler too — wrong secret never loads config or dispatches', async () => {
    const res = await post(
      '/app1/_diag/execute_handler',
      { handler_name: 'doThing' },
      { diagHeader: 'wrong' },
    );
    expect(res.status).toBe(401);
    expect(loadAppConfig).not.toHaveBeenCalled();
    expect(dispatchRpc).not.toHaveBeenCalled();
  });

  it('gates sample_table (GET) too — wrong secret is 401', async () => {
    const res = await get('/app1/_diag/sample_table?name=users', { diagHeader: 'wrong' });
    expect(res.status).toBe(401);
    expect(executeD1Query).not.toHaveBeenCalled();
  });

  it('gates inspect too — wrong secret is 401 (not 503)', async () => {
    const res = await post('/app1/_diag/inspect', {}, { diagHeader: 'wrong' });
    expect(res.status).toBe(401);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// query_db — SQL whitelist wiring at the route boundary
// ═══════════════════════════════════════════════════════════════════════════
describe('query_db — whitelist boundary', () => {
  it('rejects empty json body with 400', async () => {
    const res = await post('/app1/_diag/query_db', 'not json at all', {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('rejects a missing sql field with 400', async () => {
    const res = await post('/app1/_diag/query_db', {}, { diagHeader: DIAG_SECRET });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'sql required' });
    expect(executeD1Query).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only sql with 400', async () => {
    const res = await post('/app1/_diag/query_db', { sql: '   ' }, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'sql required' });
  });

  it('allows a plain SELECT and returns the rows', async () => {
    executeD1Query.mockResolvedValue({ results: [{ id: 1 }, { id: 2 }] });
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT * FROM users' }, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(body.row_count).toBe(2);
    expect(body._truncated).toBeUndefined();
  });

  // Each of these is a write/DDL/injection vector. The whitelist must reject
  // it with a 400 sql_rejected at the boundary, BEFORE executeD1Query runs.
  it.each([
    ['INSERT', "INSERT INTO users (id) VALUES ('x')"],
    ['UPDATE', "UPDATE users SET name = 'pwned'"],
    ['DELETE', 'DELETE FROM users'],
    ['DROP TABLE (DDL)', 'DROP TABLE users'],
    ['CREATE TABLE (DDL)', 'CREATE TABLE evil (id TEXT)'],
    ['ALTER TABLE (DDL)', 'ALTER TABLE users ADD COLUMN x TEXT'],
    ['ATTACH DATABASE', "ATTACH DATABASE 'other.db' AS other"],
    ['multi-statement SELECT;DELETE', 'SELECT 1; DELETE FROM users'],
    ['comment-hidden trailing stmt', 'SELECT 1; -- DROP TABLE users\nDROP TABLE users'],
  ])('rejects %s at the route boundary (400, never reaches D1)', async (_name, sql) => {
    const res = await post('/app1/_diag/query_db', { sql }, { diagHeader: DIAG_SECRET });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('sql_rejected');
    expect(typeof body.reason).toBe('string');
    // Critically: the dangerous SQL never reached the database.
    expect(executeD1Query).not.toHaveBeenCalled();
  });

  it('caps results at SQL_ROW_CAP (100) and flags truncation', async () => {
    const many = Array.from({ length: 150 }, (_, i) => ({ id: i }));
    executeD1Query.mockResolvedValue({ results: many });
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT * FROM users' }, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rows).toHaveLength(100);
    expect(body.row_count).toBe(100);
    expect(body._truncated).toBe(true);
  });

  it('does NOT flag truncation at exactly the cap (100 rows)', async () => {
    const exactly = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    executeD1Query.mockResolvedValue({ results: exactly });
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT * FROM users' }, {
      diagHeader: DIAG_SECRET,
    });
    const body = await res.json();
    expect(body.rows).toHaveLength(100);
    expect(body._truncated).toBeUndefined();
  });

  it('surfaces a D1 lookup failure as 502', async () => {
    getD1Database.mockRejectedValue(new Error('connection refused'));
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('d1_lookup_failed');
  });

  it('surfaces a missing preview D1 as 404', async () => {
    getD1Database.mockResolvedValue(null);
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT 1' }, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('preview_d1_not_found');
  });

  it('surfaces an executeD1Query error as 502 d1_error', async () => {
    executeD1Query.mockRejectedValue(new Error('no such table: users'));
    const res = await post('/app1/_diag/query_db', { sql: 'SELECT * FROM users' }, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'd1_error' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// sample_table — identifier sanitization + whitelist
// ═══════════════════════════════════════════════════════════════════════════
describe('sample_table', () => {
  it('rejects a missing table name with 400 invalid_table_name', async () => {
    const res = await get('/app1/_diag/sample_table', { diagHeader: DIAG_SECRET });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_table_name' });
    expect(executeD1Query).not.toHaveBeenCalled();
  });

  it.each([
    'users; DROP TABLE x',
    'users-dash',
    'users.col',
    '1users',
    'users space',
  ])('rejects unsafe identifier %j before touching D1', async (name) => {
    const res = await get(`/app1/_diag/sample_table?name=${encodeURIComponent(name)}`, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_table_name' });
    expect(executeD1Query).not.toHaveBeenCalled();
  });

  it('compiles a safe SELECT for a valid table and clamps an over-cap limit to 100', async () => {
    executeD1Query.mockResolvedValue({ results: [{ id: 1 }] });
    const res = await get('/app1/_diag/sample_table?name=users&limit=9999', {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.table).toBe('users');
    // The compiled SQL must clamp LIMIT to the row cap (100), never 9999.
    const sqlArg = executeD1Query.mock.calls[0][2] as string;
    expect(sqlArg).toBe('SELECT * FROM "users" LIMIT 100');
  });

  it('defaults a non-numeric / non-positive limit to 10', async () => {
    executeD1Query.mockResolvedValue({ results: [] });
    await get('/app1/_diag/sample_table?name=users&limit=-5', { diagHeader: DIAG_SECRET });
    const sqlArg = executeD1Query.mock.calls[0][2] as string;
    expect(sqlArg).toBe('SELECT * FROM "users" LIMIT 10');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// execute_handler — config gate + dispatch wiring
// ═══════════════════════════════════════════════════════════════════════════
describe('execute_handler', () => {
  it('rejects invalid json with 400', async () => {
    loadAppConfig.mockResolvedValue(configWithHandlers('doThing'));
    const res = await post('/app1/_diag/execute_handler', 'broken{', {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_json' });
  });

  it('rejects a missing handler_name with 400', async () => {
    loadAppConfig.mockResolvedValue(configWithHandlers('doThing'));
    const res = await post('/app1/_diag/execute_handler', { params: {} }, {
      diagHeader: DIAG_SECRET,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'handler_name required' });
    expect(dispatchRpc).not.toHaveBeenCalled();
  });

  it('404s an unknown handler before dispatch', async () => {
    loadAppConfig.mockResolvedValue(configWithHandlers('knownHandler'));
    const res = await post(
      '/app1/_diag/execute_handler',
      { handler_name: 'ghostHandler' },
      { diagHeader: DIAG_SECRET },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: 'handler_not_found',
      handler_name: 'ghostHandler',
    });
    // Fail-fast: no worker dispatch for a name that doesn't exist.
    expect(dispatchRpc).not.toHaveBeenCalled();
  });

  it('404s when the backend is not dynamic (no handlers exposed)', async () => {
    loadAppConfig.mockResolvedValue({ backend: { mode: 'static' } });
    const res = await post(
      '/app1/_diag/execute_handler',
      { handler_name: 'anything' },
      { diagHeader: DIAG_SECRET },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'handler_not_found' });
    expect(dispatchRpc).not.toHaveBeenCalled();
  });

  it('404s when config is null', async () => {
    loadAppConfig.mockResolvedValue(null);
    const res = await post(
      '/app1/_diag/execute_handler',
      { handler_name: 'anything' },
      { diagHeader: DIAG_SECRET },
    );
    expect(res.status).toBe(404);
    expect(dispatchRpc).not.toHaveBeenCalled();
  });

  it('dispatches a known handler and returns the wrapped response', async () => {
    loadAppConfig.mockResolvedValue(configWithHandlers('doThing'));
    dispatchRpc.mockResolvedValue(jsonResp({ success: true, data: { ok: 1 } }, 200));
    const res = await post(
      '/app1/_diag/execute_handler',
      { handler_name: 'doThing', params: { a: 1 } },
      { diagHeader: DIAG_SECRET },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe(200);
    expect(body.response).toEqual({ success: true, data: { ok: 1 } });
    expect(typeof body.duration_ms).toBe('number');
    expect(dispatchRpc).toHaveBeenCalledTimes(1);
  });

  it('defaults X-User-Id to the diagnostic principal when as_user is absent', async () => {
    loadAppConfig.mockResolvedValue(configWithHandlers('doThing'));
    const identityHeaders = new Headers();
    resolveGatewayIdentity.mockResolvedValue({
      headers: identityHeaders,
      isAuthenticated: true,
      kind: 'platform_session',
      stateKey: 'k',
      userRoles: [],
    });
    dispatchRpc.mockResolvedValue(jsonResp({ ok: true }, 200));
    await post(
      '/app1/_diag/execute_handler',
      { handler_name: 'doThing' },
      { diagHeader: DIAG_SECRET },
    );
    expect(identityHeaders.get('X-User-Id')).toBe('_exepad_diagnostic_');
  });

  it('honours an explicit as_user override for X-User-Id', async () => {
    loadAppConfig.mockResolvedValue(configWithHandlers('doThing'));
    const identityHeaders = new Headers();
    resolveGatewayIdentity.mockResolvedValue({
      headers: identityHeaders,
      isAuthenticated: true,
      kind: 'platform_session',
      stateKey: 'k',
      userRoles: [],
    });
    dispatchRpc.mockResolvedValue(jsonResp({ ok: true }, 200));
    await post(
      '/app1/_diag/execute_handler',
      { handler_name: 'doThing', as_user: 'real-owner-42' },
      { diagHeader: DIAG_SECRET },
    );
    expect(identityHeaders.get('X-User-Id')).toBe('real-owner-42');
  });

  it('maps a dispatch throw to 502 dispatch_error', async () => {
    loadAppConfig.mockResolvedValue(configWithHandlers('doThing'));
    dispatchRpc.mockRejectedValue(new Error('boom'));
    const res = await post(
      '/app1/_diag/execute_handler',
      { handler_name: 'doThing' },
      { diagHeader: DIAG_SECRET },
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: 'dispatch_error', message: 'boom' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// inspect — self-host capability gate
// ═══════════════════════════════════════════════════════════════════════════
describe('inspect', () => {
  it('reports browser_unavailable (503) on self-host when authenticated', async () => {
    const res = await post('/app1/_diag/inspect', {}, { diagHeader: DIAG_SECRET });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'browser_unavailable' });
  });
});
