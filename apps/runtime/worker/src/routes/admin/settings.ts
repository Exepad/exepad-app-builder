/**
 * Admin App-Settings Routes
 *
 * GET  /:appId/settings   — read the app's security config (backend.security)
 * PUT  /:appId/settings   — patch backend.security in the deployed config JSON,
 *                           then re-run the deploy pipeline so the change takes
 *                           effect (auth tables created, gateway enforcement on).
 *
 * Unlike database/users/files, security lives in the app CONFIG (an R2/FS object
 * at `{appId}/{mode}/app-config.json`), not in the app's SQLite. So editing it is
 * a config patch + redeploy — the same primitive the publish flow uses. Seeding
 * on redeploy is non-destructive for `published` and resets demo data for
 * `preview` (which is throwaway), matching every other build.
 */

import { Hono } from 'hono';
import type { Env } from '../../types/env';
import type { SecurityProps, AccessLevel } from '@exepad/types';
import { authenticateAdmin, isAdminAuthError } from '../../lib/admin-auth';
import { resolveSecret } from '../../lib/secrets';
import { recordDeployment } from '../../lib/meta-db';
import { deploy } from '../deploy';

export const settings = new Hono<{ Bindings: Env }>();

type Mode = 'preview' | 'published';

function normalizeMode(raw: string | undefined): Mode {
  return raw === 'published' ? 'published' : 'preview';
}

function configKey(appId: string, mode: Mode): string {
  return `${appId}/${mode}/app-config.json`;
}

const VALID_ACCESS = new Set(['public', 'authenticated', 'owner', 'none']);
const VALID_PROVIDERS = new Set(['email', 'google', 'exepad']);

/**
 * Whitelist + coerce an untrusted security payload from the admin UI into a
 * well-typed `SecurityProps`. Unknown keys are dropped; every value is type-
 * checked so a malformed body can never corrupt the deployed config.
 */
function sanitizeSecurity(input: Record<string, unknown>): SecurityProps {
  const out: SecurityProps = {};

  if (typeof input.enabled === 'boolean') out.enabled = input.enabled;
  if (typeof input.allowSignup === 'boolean') out.allowSignup = input.allowSignup;
  if (typeof input.requireVerification === 'boolean') out.requireVerification = input.requireVerification;

  if (Array.isArray(input.authProviders)) {
    const providers = input.authProviders
      .map((p) => {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object' && typeof (p as { provider?: unknown }).provider === 'string') {
          return (p as { provider: string }).provider;
        }
        return null;
      })
      .filter((p): p is string => !!p && VALID_PROVIDERS.has(p));
    // De-dupe, preserve order.
    out.authProviders = [...new Set(providers)].map((provider) => ({ provider })) as SecurityProps['authProviders'];
  }

  if (typeof input.sessionDuration === 'number' && Number.isFinite(input.sessionDuration) && input.sessionDuration > 0) {
    out.sessionDuration = Math.floor(input.sessionDuration);
  }

  if (typeof input.defaultAccess === 'string' && VALID_ACCESS.has(input.defaultAccess)) {
    out.defaultAccess = input.defaultAccess as AccessLevel;
  }

  if (Array.isArray(input.roles)) {
    const roles = input.roles
      .filter((r): r is string => typeof r === 'string')
      .map((r) => r.trim())
      .filter(Boolean);
    if (roles.length > 0) out.roles = [...new Set(roles)];
  }

  if (typeof input.defaultRole === 'string' && input.defaultRole.trim()) {
    out.defaultRole = input.defaultRole.trim();
  }

  if (input.passwordPolicy && typeof input.passwordPolicy === 'object') {
    const pp = input.passwordPolicy as Record<string, unknown>;
    const policy: NonNullable<SecurityProps['passwordPolicy']> = {};
    if (typeof pp.minLength === 'number' && pp.minLength >= 1) policy.minLength = Math.floor(pp.minLength);
    if (typeof pp.requireUppercase === 'boolean') policy.requireUppercase = pp.requireUppercase;
    if (typeof pp.requireNumber === 'boolean') policy.requireNumber = pp.requireNumber;
    if (Object.keys(policy).length > 0) out.passwordPolicy = policy;
  }

  return out;
}

/** Re-enter the deploy pipeline in-process with the platform deploy secret. */
async function runDeploy(
  env: Env,
  appId: string,
  mode: Mode,
  correlationId: string,
): Promise<{ ok: boolean; error?: string }> {
  const deploySecret = await resolveSecret(env.DEPLOY_SECRET);
  const body: Record<string, unknown> = { mode, appAlias: appId, correlationId };
  // Preview deploys must name the config object explicitly; published defaults
  // to `{appId}/published/app-config.json` inside the pipeline.
  if (mode === 'preview') body.configPath = 'preview/app-config.json';

  const req = new Request(`http://internal/${appId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Deploy-Secret': deploySecret },
    body: JSON.stringify(body),
  });
  const res = await deploy.fetch(req, env);
  const resBody = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };
  if (!res.ok || resBody.success === false) {
    return { ok: false, error: resBody.error ?? `Redeploy failed (HTTP ${res.status})` };
  }
  return { ok: true };
}

// ── GET /:appId/settings — read security config ───────────────

settings.get('/', async (c) => {
  const appId = c.req.param('appId')!;
  const mode = normalizeMode(c.req.query('mode'));
  // Read-only: this handler reads the security config from CONFIG_CACHE and never
  // touches the app SQLite, so never provision a DB just to satisfy the auth
  // gate. A missing DB (dbMissing) needs no special handling here — the config
  // read below returns its own 404 when no build exists.
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode, { createIfMissing: false });
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  const obj = await c.env.CONFIG_CACHE.get(configKey(appId, mode));
  if (!obj) {
    return c.json(
      { success: false, error: `No ${mode} build found. Build${mode === 'published' ? '/publish' : ''} the app first.` },
      404,
    );
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(await obj.text());
  } catch {
    return c.json({ success: false, error: 'App config is not valid JSON.' }, 500);
  }

  const backend = (config.backend ?? {}) as Record<string, unknown>;
  // Auth config is canonical at TOP-LEVEL `config.security` — that is what
  // extractBackendProps (deploy-utils), the gateway AppConfig type, and
  // isAuthRequired all read. `backend.security` is NOT consulted by anything.
  const security = (config.security ?? null) as SecurityProps | null;

  return c.json({
    success: true,
    data: {
      mode,
      // null security ⇒ auth was never configured; the UI treats this as "off".
      security,
      // Helps the UI render model-level context without a second request.
      models: Array.isArray((backend.models as unknown[]))
        ? (backend.models as Array<{ name?: string }>).map((m) => m?.name).filter(Boolean)
        : [],
    },
  });
});

// ── PUT /:appId/settings — patch security + redeploy ──────────

settings.put('/', async (c) => {
  const appId = c.req.param('appId')!;
  const mode = normalizeMode(c.req.query('mode'));
  const auth = await authenticateAdmin(c.req.raw, c.env, appId, mode);
  if (isAdminAuthError(auth)) return c.json({ success: false, error: auth.message }, auth.status);

  let body: { security?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  if (!body || typeof body.security !== 'object' || body.security === null) {
    return c.json({ success: false, error: 'A "security" object is required' }, 400);
  }

  const key = configKey(appId, mode);
  const obj = await c.env.CONFIG_CACHE.get(key);
  if (!obj) {
    return c.json(
      { success: false, error: `No ${mode} build found. Build${mode === 'published' ? '/publish' : ''} the app first.` },
      404,
    );
  }

  let originalText: string;
  let config: Record<string, unknown>;
  try {
    originalText = await obj.text();
    config = JSON.parse(originalText);
  } catch {
    return c.json({ success: false, error: 'App config is not valid JSON.' }, 500);
  }

  // Write to TOP-LEVEL `config.security` (the path the platform actually reads),
  // MERGING the form-managed fields onto any existing security so we never drop
  // config the panel doesn't surface (roleHierarchy, loginPage, redirects, …).
  const existing = (config.security ?? {}) as Record<string, unknown>;
  const patch = sanitizeSecurity(body.security as Record<string, unknown>);
  config.security = { ...existing, ...patch };

  // Strip any stale `backend.security` so there's a single source of truth at the
  // top level (nothing reads backend.security; leaving it is just confusing).
  if (config.backend && typeof config.backend === 'object') {
    delete (config.backend as Record<string, unknown>).security;
  }

  await c.env.CONFIG_CACHE.put(key, JSON.stringify(config), {
    httpMetadata: { contentType: 'application/json' },
  });

  const correlationId = crypto.randomUUID();
  const result = await runDeploy(c.env, appId, mode, correlationId);
  if (!result.ok) {
    // Roll the staged config back so a failed redeploy never leaves the app's
    // config mutated-but-not-deployed (out of sync with what's actually live).
    await c.env.CONFIG_CACHE.put(key, originalText, {
      httpMetadata: { contentType: 'application/json' },
    }).catch(() => {});
    recordDeployment({ appId, mode, status: 'failed', correlationId, error: result.error });
    return c.json({ success: false, error: result.error }, 500);
  }
  recordDeployment({ appId, mode, status: 'success', correlationId });

  return c.json({ success: true, data: { security: config.security, mode }, redeployed: true });
});
