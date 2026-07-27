/**
 * Runtime config loader.
 *
 * The app-backend reads the full `app-config.json` from R2 at cold start,
 * runs the same `extractBackendProps` slice the deploy pipeline uses when
 * validating backend shape, and caches the result in module scope keyed by
 * the R2 object's ETag. Subsequent requests in the same isolate hit the
 * cache with zero I/O.
 *
 * This is the sole config path — there is no baked-in text binding and no
 * header-injection shortcut. Every deploy mode (WfP production, local dev,
 * tests) must provide a `CONFIG_CACHE` R2 binding and a `DEPLOY_MODE` var.
 */

import { extractBackendProps } from '@exepad/deploy-utils/bundle/config';
import type { Env, InjectedProps } from '../types/env';
import { validateConfig } from '../rpc/router';

// ─── Module-scoped cache, keyed per {appId}:{mode} ─────────────────────────
//
// Under Workers-for-Platforms each app ran in its own isolate, so a single
// module-scoped pair was safe. In the self-hosted single-container runtime the
// app-backend is imported ONCE and serves EVERY app in one process, so the
// cache MUST be keyed by app + mode or one app would serve another's config.
interface ConfigCacheEntry {
  config: InjectedProps;
  etag: string;
}
const configCache = new Map<string, ConfigCacheEntry>();

function cacheKey(env: Env): string {
  return `${env.APP_ID}:${env.DEPLOY_MODE}`;
}

const PUBLISHED_DEFAULT_PATH = 'published/app-config.json';

interface DeploymentStatusPointer {
  configPath?: string;
}

/**
 * Resolve the R2 key for the current deploy mode by reading
 * `{appId}/deployment-status-{mode}.json` and following its `configPath`.
 *
 * Includes a 3-attempt retry with short backoff to cover the narrow window
 * where the WfP script has been uploaded but `saveDeploymentStatus` hasn't
 * written the pointer yet (first request racing the deploy pipeline).
 *
 * Returns `null` if the status file can't be found after retries. For
 * `published` mode the caller falls back to the default published path;
 * for `preview` mode there is no sensible fallback — we return null and
 * let loadConfig serve an empty config, so that the next request retries
 * cleanly once the status file lands.
 */
async function resolveConfigKey(env: Env): Promise<string | null> {
  const statusKey = `${env.APP_ID}/deployment-status-${env.DEPLOY_MODE}.json`;

  for (let attempt = 0; attempt < 3; attempt++) {
    const obj = await env.CONFIG_CACHE.get(statusKey);
    if (obj) {
      try {
        const status = (await obj.json()) as DeploymentStatusPointer;
        const relativePath = status.configPath || PUBLISHED_DEFAULT_PATH;
        return `${env.APP_ID}/${relativePath}`;
      } catch (err) {
        console.error(
          `[${env.APP_ID}] Failed to parse ${statusKey}:`,
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    }
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }

  // Published mode has a sensible default path even without a status file
  // (R2 layout convention). Preview mode does not — a missing preview
  // status means the deploy hasn't completed and we must not silently
  // serve published data to a preview worker.
  if (env.DEPLOY_MODE === 'published') {
    console.warn(
      `[${env.APP_ID}] ${statusKey} missing after retries — using default ${PUBLISHED_DEFAULT_PATH}`,
    );
    return `${env.APP_ID}/${PUBLISHED_DEFAULT_PATH}`;
  }

  console.warn(
    `[${env.APP_ID}] ${statusKey} missing after retries — preview config unresolved`,
  );
  return null;
}

/**
 * Load the backend slice of the current app config.
 *
 * - First call per isolate: reads status file + `app-config.json` from R2,
 *   runs `extractBackendProps`, validates, caches.
 * - Subsequent calls: returns the cached slice if the R2 object's ETag
 *   hasn't changed.
 *
 * Never throws. On any failure, returns `{ models: [], handlers: [] }` so
 * the worker can continue serving a well-formed (empty) response.
 */
export async function loadConfig(env: Env): Promise<InjectedProps> {
  const configKey = await resolveConfigKey(env);
  if (!configKey) {
    // Never cache this — the next request should retry resolution once the
    // status file lands.
    return { models: [], handlers: [] };
  }

  let obj: R2ObjectBody | null;
  try {
    obj = await env.CONFIG_CACHE.get(configKey);
  } catch (err) {
    console.error(
      `[${env.APP_ID}] R2 get failed for ${configKey}:`,
      err instanceof Error ? err.message : err,
    );
    return { models: [], handlers: [] };
  }

  if (!obj) {
    console.error(`[${env.APP_ID}] App config not found at ${configKey}`);
    return { models: [], handlers: [] };
  }

  const key = cacheKey(env);
  const cached = configCache.get(key);
  if (cached && cached.etag === obj.etag) {
    // Shallow clone so callers can mutate (e.g. the auth kill-switch in
    // index.ts reassigns `config.security`) without poisoning the cache.
    return { ...cached.config };
  }

  let appConfig: Record<string, unknown>;
  try {
    const raw = await obj.text();
    appConfig = JSON.parse(raw) as Record<string, unknown>;
  } catch (err) {
    console.error(
      `[${env.APP_ID}] Failed to parse app config at ${configKey}:`,
      err instanceof Error ? err.message : err,
    );
    return { models: [], handlers: [] };
  }

  // `extractBackendProps` returns `InjectedAppConfig`, which is a deprecated
  // alias for `InjectedProps` — the two are the same type.
  const validated = validateConfig(extractBackendProps(appConfig), env.APP_ID);

  configCache.set(key, { config: validated, etag: obj.etag });
  console.log(
    `[${env.APP_ID}] Loaded config from R2: ${configKey} (etag=${obj.etag}, models=${validated.models?.length ?? 0}, handlers=${validated.handlers?.length ?? 0})`,
  );
  return { ...validated };
}

/**
 * Test-only: reset the module-scoped cache between tests.
 *
 * Production code never needs this — ETag-keyed invalidation handles live
 * updates, and WfP redeploys always spin up fresh isolates. Only tests that
 * construct multiple distinct `Env` objects in the same process need to
 * wipe state between runs.
 */
export function __resetConfigCacheForTests(): void {
  configCache.clear();
}
