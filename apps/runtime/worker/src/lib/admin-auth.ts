/**
 * Admin API authentication and D1 resolution.
 *
 * Accepts EITHER credential and resolves the D1 database for the given app:
 *   1. `X-Deploy-Secret` header — service-to-service (deploy pipeline, internal).
 *   2. The operator's `exepad_platform_session` cookie, when that operator OWNS
 *      the app in `meta.sqlite`. This is what lets the builder SPA call the admin
 *      routes with just `credentials: 'include'` — no deploy secret ever reaches
 *      the browser, and an operator can only touch apps they created.
 *
 * Hono-compatible: accepts a raw Request and the worker Env directly.
 */

import type { Env } from '../types/env';
import { constantTimeEqual } from './crypto-utils';
import { resolveSecret } from './secrets';
import { getApp } from './meta-db';
import { verifyPlatformSession } from '../routes/gateway/auth';
import { getD1Database, createD1Database } from '@exepad/deploy-utils';

export interface AdminContext {
  appId: string;
  config: {
    accountId: string;
    apiToken: string;
    wfpNamespace: string;
    appId: string;
    appAlias: string;
  };
  dbId: string;
  /**
   * True when the caller passed `createIfMissing: false` and the app has no
   * database file yet. Read-only routes check this to return an empty/404
   * result instead of provisioning an empty SQLite file as a write-on-read side
   * effect. `dbId` is an empty string in this case and must not be used.
   */
  dbMissing?: boolean;
}

export interface AuthenticateAdminOptions {
  /**
   * Provision (create) the app's SQLite database when it does not exist yet.
   * Defaults to `true` for backward compatibility with mutating routes. Read-only
   * GET handlers should pass `false` so a nominally read-only request never
   * creates a database file on disk (see source.ts for the same invariant).
   */
  createIfMissing?: boolean;
}

/**
 * Failure result from {@link authenticateAdmin}. We return a tagged object
 * rather than a `Response` on purpose: the bundled server pulls in a dependency
 * that declares its own `Response` class, so esbuild renames the global in some
 * modules — a `Response` created here would NOT satisfy `instanceof Response` in
 * the route module (different realm), and the route would mistake the error for
 * a context. Routes discriminate with {@link isAdminAuthError} and build a
 * Hono-native `c.json` from this.
 */
export interface AdminAuthError {
  unauthorized: true;
  status: 400 | 401 | 500;
  message: string;
}

/**
 * App ids double as on-disk identifiers (SQLite filename, storage prefix) and
 * flow unsanitized into `path.join(base, appId, …)`, so an id containing `/` or
 * `..` would resolve outside the app's data directory. Enforce the same
 * allow-list app creation uses (deploy.ts VALID_ALIAS_RE) as a hard backstop —
 * this closes traversal on BOTH auth branches, including the deploy-secret path
 * which performs no ownership lookup. Rejects anything with `/`, `..`, NUL, etc.
 */
const VALID_APP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,253}[a-z0-9]$/i;
export function isSafeAppId(appId: string): boolean {
  return VALID_APP_ID_RE.test(appId);
}

export function isAdminAuthError(value: AdminContext | AdminAuthError): value is AdminAuthError {
  return (value as AdminAuthError).unauthorized === true;
}

/**
 * True when the request carries a valid `X-Deploy-Secret` matching the env.
 */
async function hasValidDeploySecret(request: Request, env: Env): Promise<boolean> {
  const deploySecret = await env.DEPLOY_SECRET.get();
  const headerSecret = request.headers.get('X-Deploy-Secret') || '';
  return !!deploySecret && constantTimeEqual(headerSecret, deploySecret);
}

/**
 * True when the request carries a valid operator platform-session cookie AND
 * that operator owns the target app in `meta.sqlite`. Ownership is the precise
 * gate — an operator can only administer apps they created, even if multiple
 * operators share one container.
 */
export async function operatorOwnsApp(request: Request, env: Env, appId: string): Promise<boolean> {
  const secret = await resolveSecret(env.PLATFORM_BRIDGE_SECRET);
  if (!secret) return false;
  const payload = await verifyPlatformSession(request, secret);
  if (!payload) return false;
  const app = getApp(appId);
  return !!app && app.owner_id === payload.uid;
}

/**
 * Authenticate an admin request and resolve the app's D1 database.
 * Returns AdminContext on success, or AdminAuthError (401/500) on failure.
 */
export async function authenticateAdmin(
  request: Request,
  env: Env,
  appId: string,
  mode: string = 'published',
  options: AuthenticateAdminOptions = {}
): Promise<AdminContext | AdminAuthError> {
  const createIfMissing = options.createIfMissing ?? true;
  // Validate the identifier BEFORE it is used to build any on-disk path. The
  // deploy-secret auth branch is not app-bound (no ownership lookup constrains
  // appId to a registered id), so without this a caller holding DEPLOY_SECRET
  // could pass `appId='../../…'` to target arbitrary SQLite files.
  if (!isSafeAppId(appId)) {
    return { unauthorized: true, status: 400, message: 'Invalid app id' };
  }

  const authorized =
    (await hasValidDeploySecret(request, env)) ||
    (await operatorOwnsApp(request, env, appId));
  if (!authorized) {
    return { unauthorized: true, status: 401, message: 'Unauthorized' };
  }

  const dbName = mode === 'preview'
    ? `exepad-preview-${appId}`
    : `exepad-${appId}`;

  // Self-host: local SQLite-backed deploy-utils key the database off the file
  // path derived from appId + the `exepad-[preview-]` db name; the CF-shaped
  // accountId/apiToken/wfpNamespace fields are carried for signature parity but
  // ignored by the local implementation.
  const config = {
    accountId: 'local',
    apiToken: 'local',
    wfpNamespace: 'local',
    appId,
    appAlias: appId,
  };

  let dbInfo = await getD1Database(config, dbName);

  if (!dbInfo) {
    // Read-only callers opt out of provisioning: signal "no database yet"
    // instead of creating an empty SQLite file as a write-on-read side effect.
    if (!createIfMissing) {
      return { appId, config, dbId: '', dbMissing: true };
    }
    try {
      dbInfo = await createD1Database(config, dbName);
    } catch {
      return {
        unauthorized: true,
        status: 500,
        message: `Failed to provision database for app ${appId} (mode: ${mode})`,
      };
    }
  }

  return { appId, config, dbId: dbInfo.uuid };
}
