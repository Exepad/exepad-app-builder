import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Mock functions (module-level) ────────────────────────────────
const mockAuthenticateAdmin = vi.fn();
const mockResolveSecret = vi.fn();
const mockRecordDeployment = vi.fn();
const mockDeployFetch = vi.fn();

// admin-auth: MUST keep the real isAdminAuthError shape (unauthorized === true)
// so the route's `if (isAdminAuthError(auth))` guard behaves like production.
vi.mock('../../../worker/src/lib/admin-auth', () => ({
  authenticateAdmin: (...args: unknown[]) => mockAuthenticateAdmin(...args),
  isAdminAuthError: (value: { unauthorized?: boolean } | null | undefined) =>
    value?.unauthorized === true,
}));

vi.mock('../../../worker/src/lib/secrets', () => ({
  resolveSecret: (...args: unknown[]) => mockResolveSecret(...args),
}));

vi.mock('../../../worker/src/lib/meta-db', () => ({
  recordDeployment: (...args: unknown[]) => mockRecordDeployment(...args),
}));

// The redeploy re-enters the deploy pipeline via `deploy.fetch(req, env)`.
// Mock the whole Hono app down to just a `.fetch` we can drive.
vi.mock('../../../worker/src/routes/deploy', () => ({
  deploy: { fetch: (...args: unknown[]) => mockDeployFetch(...args) },
}));

// ── Import the Hono router (AFTER mocks) ─────────────────────────
import { Hono } from 'hono';
import { settings } from '../../../worker/src/routes/admin/settings';

// Mount under /:appId/settings to match production routing
const app = new Hono();
app.route('/:appId/settings', settings);

const APP_ID = 'test-app';

// ── In-memory CONFIG_CACHE (R2-surface subset the route uses) ────
// Tracks get/put and exposes the raw stored bytes so we can assert
// byte-for-byte rollback and merge behavior.
function makeEnv(files: Record<string, string>) {
  const store: Record<string, string> = { ...files };
  const putCalls: Array<{ key: string; value: string }> = [];

  const CONFIG_CACHE = {
    async get(key: string) {
      if (!(key in store)) return null;
      const s = store[key];
      return {
        async text() {
          return s;
        },
      };
    },
    async put(key: string, value: string) {
      putCalls.push({ key, value });
      store[key] = value;
      return undefined;
    },
  };

  const env = { CONFIG_CACHE, DEPLOY_SECRET: 'deploy-secret-stub' } as unknown as Record<
    string,
    unknown
  >;
  // Attach the inspection handles so tests can read storage state.
  return { env, store, putCalls };
}

// Default deploy result = success (200, success:true).
function deploySuccess() {
  mockDeployFetch.mockResolvedValue(
    new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

// Deploy result = failure (route should roll back + record failed + 500).
function deployFailure(status: number, body: Record<string, unknown>) {
  mockDeployFetch.mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

async function parse(res: Response): Promise<{ body: any; status: number }> {
  return { body: await res.json(), status: res.status };
}

const AUTH_OK = { appId: APP_ID, config: { appId: APP_ID } };

// A realistic published config: top-level security holds form-surfaced fields
// PLUS un-surfaced ones (roleHierarchy, loginPage), and there's a STALE
// backend.security the route should strip.
function fullConfig() {
  return {
    name: 'My App',
    backend: {
      models: [{ name: 'todos' }, { name: 'notes' }],
      security: { enabled: true, legacy: 'stale' }, // stale, must be stripped
    },
    security: {
      enabled: true,
      allowSignup: true,
      defaultAccess: 'owner',
      // Un-surfaced fields the panel never sends — must survive a patch.
      roleHierarchy: { admin: ['user'] },
      loginPage: '/custom-login',
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticateAdmin.mockResolvedValue(AUTH_OK);
  mockResolveSecret.mockResolvedValue('deploy-secret-stub');
  deploySuccess();
});

// ── GET /:appId/settings ─────────────────────────────────────────
describe('GET /:appId/settings', () => {
  it('returns TOP-LEVEL config.security (not backend.security) + model names', async () => {
    const { env } = makeEnv({
      [`${APP_ID}/published/app-config.json`]: JSON.stringify({
        backend: {
          models: [{ name: 'todos' }, { name: 'notes' }],
          security: { enabled: false }, // backend.security must NOT be returned
        },
        security: { enabled: true, defaultAccess: 'authenticated' },
      }),
    });

    const res = await app.request(`/${APP_ID}/settings?mode=published`, undefined, env);
    const { body, status } = await parse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.mode).toBe('published');
    // GET reads top-level security — enabled:true, NOT the backend.security false.
    expect(body.data.security).toEqual({ enabled: true, defaultAccess: 'authenticated' });
    expect(body.data.models).toEqual(['todos', 'notes']);
  });

  it('returns null security when auth was never configured', async () => {
    const { env } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ backend: { models: [] } }),
    });

    const res = await app.request(`/${APP_ID}/settings`, undefined, env);
    const { body } = await parse(res);

    expect(body.success).toBe(true);
    expect(body.data.security).toBeNull();
    expect(body.data.models).toEqual([]);
  });

  it('404s when no build exists for the mode', async () => {
    const { env } = makeEnv({});
    const res = await app.request(`/${APP_ID}/settings?mode=published`, undefined, env);
    const { body, status } = await parse(res);
    expect(status).toBe(404);
    expect(body.success).toBe(false);
    expect(body.error).toContain('publish');
  });

  it('500s on corrupt (non-JSON) config', async () => {
    const { env } = makeEnv({ [`${APP_ID}/preview/app-config.json`]: '{not json' });
    const res = await app.request(`/${APP_ID}/settings`, undefined, env);
    const { body, status } = await parse(res);
    expect(status).toBe(500);
    expect(body.error).toContain('valid JSON');
  });

  it('returns 401 when authentication fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 401,
      message: 'Unauthorized',
    });
    const { env } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify(fullConfig()),
    });
    const res = await app.request(`/${APP_ID}/settings`, undefined, env);
    const { body, status } = await parse(res);
    expect(status).toBe(401);
    expect(body.error).toBe('Unauthorized');
    // Auth failures must short-circuit before any storage read.
    expect(mockDeployFetch).not.toHaveBeenCalled();
  });
});

// ── PUT /:appId/settings — sanitizeSecurity whitelist ────────────
describe('PUT /:appId/settings — sanitizeSecurity', () => {
  // Read back the security object that the route ultimately staged into
  // CONFIG_CACHE (the put just before the successful deploy).
  function stagedSecurity(putCalls: Array<{ key: string; value: string }>) {
    const stage = putCalls[0]; // first put is the staged config
    return (JSON.parse(stage.value) as { security: Record<string, unknown> }).security;
  }

  it('drops unknown keys entirely', async () => {
    const { env, putCalls } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });

    const res = await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        security: {
          enabled: true,
          evil: 'drop me',
          __proto__hack: 1,
          arbitrary: { nested: true },
        },
      }),
    }, env);

    expect(res.status).toBe(200);
    const sec = stagedSecurity(putCalls);
    expect(sec.enabled).toBe(true);
    expect(sec).not.toHaveProperty('evil');
    expect(sec).not.toHaveProperty('__proto__hack');
    expect(sec).not.toHaveProperty('arbitrary');
  });

  it('coerces/rejects wrong-typed values (booleans, sessionDuration, minLength)', async () => {
    const { env, putCalls } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });

    await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        security: {
          enabled: 'yes', // not a boolean → dropped
          allowSignup: 1, // not a boolean → dropped
          requireVerification: false, // valid boolean → kept
          sessionDuration: 86400.7, // floored
          passwordPolicy: { minLength: 8.9, requireUppercase: 'nope', requireNumber: true },
        },
      }),
    }, env);

    const sec = stagedSecurity(putCalls) as any;
    expect(sec).not.toHaveProperty('enabled'); // non-boolean dropped
    expect(sec).not.toHaveProperty('allowSignup');
    expect(sec.requireVerification).toBe(false);
    expect(sec.sessionDuration).toBe(86400); // Math.floor
    expect(sec.passwordPolicy).toEqual({ minLength: 8, requireNumber: true });
    expect(sec.passwordPolicy).not.toHaveProperty('requireUppercase'); // non-boolean dropped
  });

  it('rejects non-positive / non-finite sessionDuration', async () => {
    const { env, putCalls } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });

    await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { sessionDuration: 0 } }),
    }, env);
    expect(stagedSecurity(putCalls)).not.toHaveProperty('sessionDuration');
  });

  it('filters authProviders to the known allow-list, de-dupes, normalizes shape', async () => {
    const { env, putCalls } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });

    await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        security: {
          authProviders: [
            'email', // string form
            { provider: 'google' }, // object form
            'email', // dup → collapsed
            'github', // unknown → dropped
            { provider: 'evil' }, // unknown object → dropped
            42, // junk → dropped
            { notProvider: 'x' }, // malformed object → dropped
          ],
        },
      }),
    }, env);

    const sec = stagedSecurity(putCalls) as any;
    expect(sec.authProviders).toEqual([{ provider: 'email' }, { provider: 'google' }]);
  });

  it('defaultAccess only accepts its enum; junk is dropped', async () => {
    const { env, putCalls } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });

    // Valid enum value kept.
    await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { defaultAccess: 'owner' } }),
    }, env);
    expect((stagedSecurity(putCalls) as any).defaultAccess).toBe('owner');

    // Junk value dropped (not in {public,authenticated,owner,none}).
    const { env: env2, putCalls: pc2 } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });
    await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { defaultAccess: 'role:admin' } }),
    }, env2);
    expect(stagedSecurity(pc2)).not.toHaveProperty('defaultAccess');
  });

  it('trims + de-dupes roles, drops empties; ignores empty roles array', async () => {
    const { env, putCalls } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });
    await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        security: {
          roles: ['  admin ', 'admin', '', '   ', 'user', 5, null],
          defaultRole: '  user  ',
        },
      }),
    }, env);
    const sec = stagedSecurity(putCalls) as any;
    expect(sec.roles).toEqual(['admin', 'user']);
    expect(sec.defaultRole).toBe('user');
  });
});

// ── PUT /:appId/settings — merge / strip / redeploy ──────────────
describe('PUT /:appId/settings — merge + redeploy', () => {
  it('merges patch over existing, preserving un-surfaced fields + stripping backend.security', async () => {
    const { env, putCalls } = makeEnv({
      [`${APP_ID}/published/app-config.json`]: JSON.stringify(fullConfig()),
    });

    const res = await app.request(`/${APP_ID}/settings?mode=published`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { allowSignup: false, defaultAccess: 'authenticated' } }),
    }, env);
    const { body, status } = await parse(res);

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.redeployed).toBe(true);

    // The staged config (first put).
    const staged = JSON.parse(putCalls[0].value) as any;
    // Patch applied.
    expect(staged.security.allowSignup).toBe(false);
    expect(staged.security.defaultAccess).toBe('authenticated');
    // Pre-existing surfaced field preserved (not in patch).
    expect(staged.security.enabled).toBe(true);
    // Un-surfaced fields preserved through the merge.
    expect(staged.security.roleHierarchy).toEqual({ admin: ['user'] });
    expect(staged.security.loginPage).toBe('/custom-login');
    // Stale backend.security stripped; backend.models untouched.
    expect(staged.backend).not.toHaveProperty('security');
    expect(staged.backend.models).toEqual([{ name: 'todos' }, { name: 'notes' }]);

    // Success path records a 'success' deployment, never 'failed'.
    const recorded = mockRecordDeployment.mock.calls.map((c) => c[0]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].status).toBe('success');
    expect(recorded[0].mode).toBe('published');
  });

  it('preview redeploy names the config object explicitly', async () => {
    const { env } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });
    await app.request(`/${APP_ID}/settings?mode=preview`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { enabled: true } }),
    }, env);

    expect(mockDeployFetch).toHaveBeenCalledTimes(1);
    const req = mockDeployFetch.mock.calls[0][0] as Request;
    const sent = JSON.parse(await req.clone().text());
    expect(sent.mode).toBe('preview');
    expect(sent.configPath).toBe('preview/app-config.json');
    expect(req.headers.get('X-Deploy-Secret')).toBe('deploy-secret-stub');
  });

  it('rolls config back BYTE-FOR-BYTE + records failed + 500 when redeploy fails', async () => {
    const original = JSON.stringify(fullConfig());
    const { env, store, putCalls } = makeEnv({
      [`${APP_ID}/published/app-config.json`]: original,
    });
    deployFailure(500, { success: false, error: 'migration blew up' });

    const res = await app.request(`/${APP_ID}/settings?mode=published`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { allowSignup: false } }),
    }, env);
    const { body, status } = await parse(res);

    expect(status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.error).toBe('migration blew up');

    // Two puts: stage the mutated config, then roll back to the original.
    expect(putCalls).toHaveLength(2);
    expect(putCalls[1].value).toBe(original); // exact original bytes restored
    // Final storage state equals the untouched original byte-for-byte.
    expect(store[`${APP_ID}/published/app-config.json`]).toBe(original);

    // A 'failed' deployment is recorded with the error; no 'success'.
    const recorded = mockRecordDeployment.mock.calls.map((c) => c[0]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].status).toBe('failed');
    expect(recorded[0].error).toBe('migration blew up');
  });

  it('treats success:false on a 200 deploy response as a failure (rollback)', async () => {
    const original = JSON.stringify({ security: { enabled: true } });
    const { env, store } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: original,
    });
    deployFailure(200, { success: false, error: 'soft fail' });

    const res = await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { enabled: false } }),
    }, env);

    expect(res.status).toBe(500);
    expect(store[`${APP_ID}/preview/app-config.json`]).toBe(original);
    expect(mockRecordDeployment.mock.calls[0][0].status).toBe('failed');
  });
});

// ── PUT /:appId/settings — validation / guards ───────────────────
describe('PUT /:appId/settings — guards', () => {
  it('400s on invalid JSON body', async () => {
    const { env } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });
    const res = await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    }, env);
    const { body, status } = await parse(res);
    expect(status).toBe(400);
    expect(body.error).toContain('Invalid JSON');
    expect(mockDeployFetch).not.toHaveBeenCalled();
  });

  it('400s when "security" is missing or not an object', async () => {
    const { env } = makeEnv({
      [`${APP_ID}/preview/app-config.json`]: JSON.stringify({ security: {} }),
    });
    for (const bad of [{}, { security: null }, { security: 'string' }, { security: 42 }]) {
      const res = await app.request(`/${APP_ID}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bad),
      }, env);
      expect(res.status).toBe(400);
    }
    expect(mockDeployFetch).not.toHaveBeenCalled();
  });

  it('404s when no build exists (never touches the deploy pipeline)', async () => {
    const { env } = makeEnv({});
    const res = await app.request(`/${APP_ID}/settings?mode=published`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { enabled: true } }),
    }, env);
    expect(res.status).toBe(404);
    expect(mockDeployFetch).not.toHaveBeenCalled();
  });

  it('500s on corrupt stored config (never deploys)', async () => {
    const { env } = makeEnv({ [`${APP_ID}/preview/app-config.json`]: 'totally not json' });
    const res = await app.request(`/${APP_ID}/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { enabled: true } }),
    }, env);
    expect(res.status).toBe(500);
    expect(mockDeployFetch).not.toHaveBeenCalled();
  });

  it('returns 401 and does not mutate storage when auth fails', async () => {
    mockAuthenticateAdmin.mockResolvedValue({
      unauthorized: true,
      status: 403,
      message: 'Forbidden',
    });
    const original = JSON.stringify(fullConfig());
    const { env, store, putCalls } = makeEnv({
      [`${APP_ID}/published/app-config.json`]: original,
    });
    const res = await app.request(`/${APP_ID}/settings?mode=published`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ security: { enabled: false } }),
    }, env);
    expect(res.status).toBe(403);
    expect(putCalls).toHaveLength(0);
    expect(store[`${APP_ID}/published/app-config.json`]).toBe(original);
    expect(mockDeployFetch).not.toHaveBeenCalled();
  });
});
