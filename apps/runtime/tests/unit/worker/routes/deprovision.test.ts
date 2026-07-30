/**
 * Deprovision route — DELETE auth + appId traversal guard + /gc orphan diff.
 *
 * Pins the security-critical contract of `routes/deprovision.ts`:
 *  - DELETE /:appId requires a valid X-Deploy-Secret (constant-time) and a
 *    strict 8-16 lowercase-alphanumeric appId (no path traversal, no uppercase,
 *    no D1/WfP name injection).
 *  - POST /gc never deletes a *live* app, caps cleanups at MAX_PER_RUN=20, and
 *    deletes nothing on dryRun.
 *
 * The route delegates all real teardown to `@exepad/deploy-utils` and
 * `../lib/r2-helpers`; we mock both so the tests assert *which* resources the
 * route decided to touch, never real SQLite/FS side effects.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mock functions (module-level) ────────────────────────────────
const mockDeleteR2ObjectsByPrefix = vi.fn();
const mockGetD1Database = vi.fn();
const mockDeleteD1Database = vi.fn();
const mockDeleteWorkerScript = vi.fn();
const mockDeleteR2Bucket = vi.fn();
const mockListD1Databases = vi.fn();
const mockListWorkerScripts = vi.fn();

vi.mock('@exepad/deploy-utils', () => ({
  getD1Database: (...args: unknown[]) => mockGetD1Database(...args),
  deleteD1Database: (...args: unknown[]) => mockDeleteD1Database(...args),
  deleteWorkerScript: (...args: unknown[]) => mockDeleteWorkerScript(...args),
  deleteR2Bucket: (...args: unknown[]) => mockDeleteR2Bucket(...args),
  listD1Databases: (...args: unknown[]) => mockListD1Databases(...args),
  listWorkerScripts: (...args: unknown[]) => mockListWorkerScripts(...args),
}));

vi.mock('../../../../worker/src/lib/r2-helpers', () => ({
  deleteR2ObjectsByPrefix: (...args: unknown[]) => mockDeleteR2ObjectsByPrefix(...args),
}));

// Config-cache invalidation: deprovisionApp must bust BOTH the meta-injector's
// cache (lib/app-config) and the gateway's cache (routes/gateway/config) for
// both modes, or a deleted app keeps serving its cached <title>/route-mode.
const mockInvalidateConfig = vi.fn();
const mockInvalidateGatewayConfig = vi.fn();

vi.mock('../../../../worker/src/lib/app-config', () => ({
  invalidateConfig: (...args: unknown[]) => mockInvalidateConfig(...args),
}));

vi.mock('../../../../worker/src/routes/gateway/config', () => ({
  invalidateGatewayConfig: (...args: unknown[]) => mockInvalidateGatewayConfig(...args),
}));

// ── Import the Hono router (AFTER mocks) ─────────────────────────
import { Hono } from 'hono';
import { deprovision } from '../../../../worker/src/routes/deprovision';
import type { Env } from '../../../../worker/src/types/env';

// Mount under /:appId / /gc exactly as production mounts the sub-app.
const app = new Hono();
app.route('/', deprovision);

// ── Helpers ──────────────────────────────────────────────────────
const VALID_SECRET = 'super-secret-deploy-token-123';

async function parseResponse(response: Response): Promise<{ body: any; status: number }> {
  const body = await response.json();
  return { body, status: response.status };
}

/**
 * Env stub. CONFIG_CACHE.list backs the /gc R2-prefix scan; everything else is
 * routed through the mocked deploy-utils functions above. `secret` lets us
 * exercise the "secret not configured" branch by returning '' from .get().
 */
function makeEnv(
  opts: {
    secret?: string;
    delimitedPrefixes?: string[];
  } = {},
): Env {
  const { secret = VALID_SECRET, delimitedPrefixes = [] } = opts;
  return {
    DEPLOY_SECRET: {
      get: async () => secret,
    },
    CONFIG_CACHE: {
      list: async (_opts?: unknown) => ({
        delimitedPrefixes,
        objects: [],
        truncated: false,
      }),
    },
  } as unknown as Env;
}

function deleteReq(appId: string, secret: string | null, env: Env) {
  const headers: Record<string, string> = {};
  if (secret !== null) headers['X-Deploy-Secret'] = secret;
  return app.request(
    `/${appId}`,
    { method: 'DELETE', headers },
    env,
  );
}

function gcReq(body: unknown, secret: string | null, env: Env) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret !== null) headers['X-Deploy-Secret'] = secret;
  return app.request(
    '/gc',
    { method: 'POST', headers, body: JSON.stringify(body) },
    env,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sensible no-op defaults: nothing exists, nothing deleted.
  mockDeleteR2ObjectsByPrefix.mockResolvedValue(0);
  mockGetD1Database.mockResolvedValue(null);
  mockDeleteD1Database.mockResolvedValue(undefined);
  mockDeleteWorkerScript.mockResolvedValue(false);
  mockDeleteR2Bucket.mockResolvedValue(false);
  mockListD1Databases.mockResolvedValue([]);
  mockListWorkerScripts.mockResolvedValue([]);
  mockInvalidateConfig.mockResolvedValue(undefined);
  mockInvalidateGatewayConfig.mockResolvedValue(undefined);
});

// ── DELETE /:appId — auth ─────────────────────────────────────────
describe('DELETE /:appId — authentication', () => {
  it('rejects with 401 when no X-Deploy-Secret header is sent', async () => {
    const env = makeEnv();
    const res = await deleteReq('abcd1234', null, env);
    const { body, status } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.success).toBe(false);
    expect(body.error).toBe('Unauthorized');
    // No teardown should have been attempted.
    expect(mockDeleteR2ObjectsByPrefix).not.toHaveBeenCalled();
  });

  it('rejects with 401 when the header secret is wrong', async () => {
    const env = makeEnv();
    const res = await deleteReq('abcd1234', 'not-the-secret', env);
    const { body, status } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockGetD1Database).not.toHaveBeenCalled();
  });

  it('rejects with 401 when an empty header is sent against a valid configured secret', async () => {
    const env = makeEnv({ secret: VALID_SECRET });
    const res = await deleteReq('abcd1234', '', env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
  });

  it('rejects with 401 when the deploy secret is not configured (empty), even with a matching empty header', async () => {
    // Defense-in-depth: an unconfigured secret must never authorize a destructive
    // delete, even if the attacker sends an empty header that "equals" it.
    const env = makeEnv({ secret: '' });
    const res = await deleteReq('abcd1234', '', env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockDeleteR2ObjectsByPrefix).not.toHaveBeenCalled();
  });

  it('proceeds past auth with the correct secret', async () => {
    const env = makeEnv();
    const res = await deleteReq('abcd1234', VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    // Auth passed → it ran the teardown (no resources existed → fully clean 200).
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.appId).toBe('abcd1234');
    expect(mockDeleteR2ObjectsByPrefix).toHaveBeenCalledWith(env.CONFIG_CACHE, 'abcd1234/');
  });
});

// ── DELETE /:appId — appId format / traversal guard ───────────────
describe('DELETE /:appId — appId validation (VALID_APP_ID_RE)', () => {
  // Each of these must be rejected with 400 BEFORE any teardown runs.
  const malformedIds: Array<[string, string]> = [
    ['..%2f..%2fetc', 'path traversal (encoded)'],
    ['short', 'too short (< 8)'],
    ['ABCD1234', 'uppercase letters'],
    ['abcd-1234', 'hyphen'],
    ['abcd_1234', 'underscore'],
    ['abcd.1234', 'dot'],
    ['abcd123456789012345', 'too long (> 16)'],
    ['abcd123%20', 'space (encoded)'],
  ];

  for (const [rawId, label] of malformedIds) {
    it(`rejects ${label} with 400 and no teardown`, async () => {
      const env = makeEnv();
      const res = await deleteReq(rawId, VALID_SECRET, env);
      const { status, body } = await parseResponse(res);

      expect(status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid appId format');
      // Critically: no destructive call ever fires for a malformed id.
      expect(mockDeleteR2ObjectsByPrefix).not.toHaveBeenCalled();
      expect(mockGetD1Database).not.toHaveBeenCalled();
      expect(mockDeleteWorkerScript).not.toHaveBeenCalled();
      expect(mockDeleteR2Bucket).not.toHaveBeenCalled();
    });
  }

  it('rejects an empty appId segment (resolves to /gc-less root) without teardown', async () => {
    // A bare "/" with trailing nothing should not match the :appId delete and
    // must never trigger a wildcard teardown. Guard the negative explicitly.
    const env = makeEnv();
    const res = await app.request('/%20', { method: 'DELETE', headers: { 'X-Deploy-Secret': VALID_SECRET } }, env);
    expect(res.status).toBe(400);
    expect(mockDeleteR2ObjectsByPrefix).not.toHaveBeenCalled();
  });

  it('accepts the minimum (8) and maximum (16) valid lengths', async () => {
    const env = makeEnv();

    const min = await deleteReq('abcd1234', VALID_SECRET, env); // 8
    expect(min.status).toBe(200);

    vi.clearAllMocks();
    mockDeleteR2ObjectsByPrefix.mockResolvedValue(0);
    mockGetD1Database.mockResolvedValue(null);
    mockDeleteWorkerScript.mockResolvedValue(false);
    mockDeleteR2Bucket.mockResolvedValue(false);

    const max = await deleteReq('abcd123456789012', VALID_SECRET, env); // 16
    expect(max.status).toBe(200);
  });

  it('checks auth BEFORE format — a single-segment malformed id with a bad secret is 401, not 400', async () => {
    // Order matters: an unauthenticated caller must not be able to probe the
    // appId-format oracle. Auth is the outermost gate. (Use a single-segment
    // id so the request actually reaches the handler; a slash-bearing id would
    // 404 at routing before auth even runs.)
    const env = makeEnv();
    const res = await deleteReq('BADCASE99', 'wrong-secret', env);
    expect(res.status).toBe(401);
  });
});

// ── DELETE /:appId — scoped teardown + partial-failure status ─────
describe('DELETE /:appId — scoped teardown', () => {
  it('deletes exactly this app\'s resources (R2 prefix, both D1s, both WfP scripts, file bucket)', async () => {
    const env = makeEnv();
    mockDeleteR2ObjectsByPrefix.mockResolvedValue(3);
    mockGetD1Database.mockResolvedValue({ uuid: 'db-uuid', name: 'whatever' });
    mockDeleteWorkerScript.mockResolvedValue(true);
    mockDeleteR2Bucket.mockResolvedValue(true);

    const res = await deleteReq('myapp1234', VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.cleaned.r2Objects).toBe(3);
    expect(body.cleaned.d1Databases).toEqual(['exepad-myapp1234', 'exepad-preview-myapp1234']);
    expect(body.cleaned.workerScripts).toEqual(['app-myapp1234', 'app-preview-myapp1234']);
    expect(body.cleaned.r2Buckets).toEqual(['exepad-files-myapp1234']);

    // Resource names are strictly scoped to this appId — no other app touched.
    expect(mockDeleteR2ObjectsByPrefix).toHaveBeenCalledWith(env.CONFIG_CACHE, 'myapp1234/');
    expect(mockDeleteR2Bucket).toHaveBeenCalledWith(expect.anything(), 'exepad-files-myapp1234');
  });

  it('returns 207 Multi-Status when a teardown step fails (errors collected, never thrown)', async () => {
    const env = makeEnv();
    mockDeleteR2ObjectsByPrefix.mockRejectedValue(new Error('R2 down'));

    const res = await deleteReq('myapp1234', VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(207);
    expect(body.success).toBe(false);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(body.errors[0]).toContain('R2 object cleanup failed');
  });
});

// ── DELETE /:appId — config-cache invalidation (stale meta-injection guard) ──
describe('DELETE /:appId — busts the config caches so a deleted app stops resolving', () => {
  it('invalidates BOTH cache modules for BOTH modes after a clean teardown', async () => {
    const env = makeEnv();
    const res = await deleteReq('myapp1234', VALID_SECRET, env);
    expect(res.status).toBe(200);

    // meta-injector cache (lib/app-config) — published AND preview.
    expect(mockInvalidateConfig).toHaveBeenCalledWith('myapp1234', 'published');
    expect(mockInvalidateConfig).toHaveBeenCalledWith('myapp1234', 'preview');
    // gateway cache (routes/gateway/config) — published AND preview.
    expect(mockInvalidateGatewayConfig).toHaveBeenCalledWith('myapp1234', 'published');
    expect(mockInvalidateGatewayConfig).toHaveBeenCalledWith('myapp1234', 'preview');
    // Exactly the app being deleted — never a wildcard or sibling.
    expect(mockInvalidateConfig).toHaveBeenCalledTimes(2);
    expect(mockInvalidateGatewayConfig).toHaveBeenCalledTimes(2);
  });

  it('still invalidates the caches even when a storage teardown step failed', async () => {
    // The whole point: a deleted app must stop being served from cache even on a
    // partial teardown, so the invalidation must not be skipped by an earlier error.
    const env = makeEnv();
    mockDeleteR2Bucket.mockRejectedValue(new Error('bucket boom'));

    const res = await deleteReq('myapp1234', VALID_SECRET, env);
    expect(res.status).toBe(207); // partial failure surfaced...

    // ...but the cache was still busted for both modes.
    expect(mockInvalidateConfig).toHaveBeenCalledWith('myapp1234', 'published');
    expect(mockInvalidateConfig).toHaveBeenCalledWith('myapp1234', 'preview');
    expect(mockInvalidateGatewayConfig).toHaveBeenCalledWith('myapp1234', 'published');
    expect(mockInvalidateGatewayConfig).toHaveBeenCalledWith('myapp1234', 'preview');
  });

  it('a config-cache invalidation failure is collected as an error, never thrown', async () => {
    const env = makeEnv();
    mockInvalidateConfig.mockRejectedValue(new Error('cache api down'));

    const res = await deleteReq('myapp1234', VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    // Never throws → the route still returns; the failure surfaces in errors.
    expect(status).toBe(207);
    expect(body.errors.some((e: string) => e.includes('Config cache invalidation failed'))).toBe(true);
  });
});

// ── POST /gc — auth ───────────────────────────────────────────────
describe('POST /gc — authentication', () => {
  it('rejects with 401 with no secret', async () => {
    const env = makeEnv();
    const res = await gcReq({ liveAppIds: [] }, null, env);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    expect(mockListD1Databases).not.toHaveBeenCalled();
  });

  it('rejects with 401 with a wrong secret', async () => {
    const env = makeEnv();
    const res = await gcReq({ liveAppIds: [] }, 'nope', env);
    expect(res.status).toBe(401);
    expect(mockListWorkerScripts).not.toHaveBeenCalled();
  });

  it('rejects with 400 when liveAppIds is not an array', async () => {
    const env = makeEnv();
    const res = await gcReq({ liveAppIds: 'not-an-array' }, VALID_SECRET, env);
    const { status, body } = await parseResponse(res);
    expect(status).toBe(400);
    expect(body.error).toContain('liveAppIds must be an array');
    // No scan/cleanup should run on a malformed request.
    expect(mockListD1Databases).not.toHaveBeenCalled();
  });
});

// ── POST /gc — orphan diff: a live app is NEVER deleted ───────────
describe('POST /gc — orphan diff', () => {
  it('NEVER deletes a live app even when its resources are discovered', async () => {
    const env = makeEnv({ delimitedPrefixes: ['liveapp01/'] });
    mockListD1Databases.mockResolvedValue([
      { name: 'exepad-liveapp01' },
      { name: 'exepad-preview-liveapp01' },
    ]);
    mockListWorkerScripts.mockResolvedValue([
      { id: 'app-liveapp01' },
      { id: 'app-preview-liveapp01' },
    ]);

    const res = await gcReq({ liveAppIds: ['liveapp01'] }, VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.orphans).toEqual([]);
    expect(body.cleaned).toEqual([]);
    // The live app's resources must never be torn down.
    expect(mockDeleteD1Database).not.toHaveBeenCalled();
    expect(mockDeleteWorkerScript).not.toHaveBeenCalled();
    expect(mockDeleteR2Bucket).not.toHaveBeenCalled();
    expect(mockDeleteR2ObjectsByPrefix).not.toHaveBeenCalled();
  });

  it('identifies and cleans an orphan (not in liveAppIds) while sparing a live sibling', async () => {
    const env = makeEnv({ delimitedPrefixes: ['liveapp01/', 'orphan002/', '_system/'] });
    mockListD1Databases.mockResolvedValue([
      { name: 'exepad-liveapp01' },
      { name: 'exepad-orphan002' },
      { name: 'exepad-preview-orphan002' },
    ]);
    mockListWorkerScripts.mockResolvedValue([{ id: 'app-orphan002' }]);

    const res = await gcReq({ liveAppIds: ['liveapp01'] }, VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.orphans).toEqual(['orphan002']);
    expect(body.cleaned).toEqual(['orphan002']);

    // Only the orphan's scoped resources were targeted.
    expect(mockDeleteR2ObjectsByPrefix).toHaveBeenCalledTimes(1);
    expect(mockDeleteR2ObjectsByPrefix).toHaveBeenCalledWith(env.CONFIG_CACHE, 'orphan002/');
    expect(mockDeleteR2Bucket).toHaveBeenCalledWith(expect.anything(), 'exepad-files-orphan002');
    // Never the live sibling.
    expect(mockDeleteR2ObjectsByPrefix).not.toHaveBeenCalledWith(env.CONFIG_CACHE, 'liveapp01/');
  });

  it('skips system prefixes (leading underscore) and malformed names — they are never orphans', async () => {
    const env = makeEnv({ delimitedPrefixes: ['_system/', 'BADCASE99/', 'short/'] });
    // D1/WfP names that do not encode a valid appId must not become orphans.
    mockListD1Databases.mockResolvedValue([
      { name: 'exepad-_internal' },
      { name: 'unrelated-db' },
    ]);

    const res = await gcReq({ liveAppIds: [] }, VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.orphans).toEqual([]);
    expect(body.cleaned).toEqual([]);
    expect(mockDeleteR2ObjectsByPrefix).not.toHaveBeenCalled();
  });

  it('dryRun discovers orphans but deletes nothing', async () => {
    const env = makeEnv({ delimitedPrefixes: ['orphan002/'] });
    mockListD1Databases.mockResolvedValue([{ name: 'exepad-orphan002' }]);
    mockListWorkerScripts.mockResolvedValue([{ id: 'app-orphan002' }]);

    const res = await gcReq({ liveAppIds: [], dryRun: true }, VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.orphans).toContain('orphan002');
    // Discovered but NOT cleaned.
    expect(body.cleaned).toEqual([]);
    expect(mockDeleteR2ObjectsByPrefix).not.toHaveBeenCalled();
    expect(mockDeleteD1Database).not.toHaveBeenCalled();
    expect(mockDeleteWorkerScript).not.toHaveBeenCalled();
    expect(mockDeleteR2Bucket).not.toHaveBeenCalled();
  });

  it('caps actual cleanups at MAX_PER_RUN (20) even when more orphans are found', async () => {
    // 25 distinct orphan D1 names, none live.
    const orphanIds = Array.from({ length: 25 }, (_, i) =>
      `orphan${String(i).padStart(3, '0')}`, // e.g. orphan000 (9 chars, valid)
    );
    const env = makeEnv();
    mockListD1Databases.mockResolvedValue(orphanIds.map((id) => ({ name: `exepad-${id}` })));

    const res = await gcReq({ liveAppIds: [] }, VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    // All 25 are reported as orphans...
    expect(body.orphans).toHaveLength(25);
    // ...but only the first 20 are actually cleaned this run.
    expect(body.cleaned).toHaveLength(20);
    // R2 prefix delete is called once per cleaned orphan → exactly 20.
    expect(mockDeleteR2ObjectsByPrefix).toHaveBeenCalledTimes(20);
  });

  it('reports scan errors and still succeeds=false without throwing', async () => {
    const env = makeEnv();
    mockListD1Databases.mockRejectedValue(new Error('d1 list boom'));

    const res = await gcReq({ liveAppIds: [] }, VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200); // /gc always 200; failures surface in body.
    expect(body.success).toBe(false);
    expect(body.errors.some((e: string) => e.includes('D1 scan failed'))).toBe(true);
  });

  it('treats an empty liveAppIds with no discovered resources as a clean no-op', async () => {
    const env = makeEnv();
    const res = await gcReq({ liveAppIds: [] }, VALID_SECRET, env);
    const { status, body } = await parseResponse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.orphans).toEqual([]);
    expect(body.cleaned).toEqual([]);
    expect(body.discovered).toEqual({ d1Databases: 0, workerScripts: 0, r2Prefixes: 0 });
  });
});
