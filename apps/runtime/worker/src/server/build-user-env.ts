/**
 * Build the per-app app-backend `Env` for in-process dispatch.
 *
 * Under Workers-for-Platforms each app was a separate worker with its own
 * bindings. In the single-container runtime the app-backend is imported once and
 * invoked in-process; this module constructs the `Env` it expects for a given
 * `{appId, mode}` from the local adapters:
 *
 *   DB           → LocalD1 over `<EXEPAD_DATA_DIR>/apps/{appId}/{mode}.sqlite`
 *   CONFIG_CACHE → FsStorageAdapter over `<EXEPAD_DATA_DIR>/storage`
 *   R2_FILES     → FsStorageAdapter over `<EXEPAD_DATA_DIR>/buckets/exepad-files-{appId}`
 *
 * The adapters implement the D1/R2 surfaces, so they're cast to the Cloudflare
 * binding types the app-backend is typed against (the documented seam — see
 * LocalD1's class comment). This is the ONE place those casts live.
 */
import { getAppD1, FsStorageAdapter, KvShim, type AppMode } from '@exepad/local-adapters';
import { bucketDir } from '@exepad/deploy-utils';
import type { Env as AppBackendEnv } from '@exepad/app-backend';

/**
 * Per-(app, mode) rate-limit store. The app-backend's limiter is opt-in via the
 * `RATE_LIMIT_KV` binding (a Cloudflare KV surface); under Workers-for-Platforms
 * each app had its own KV, but in the single-container runtime nothing was bound,
 * so brute-force / signup-spam protection silently never ran. `buildUserEnv` runs
 * PER REQUEST, so the store MUST be a process-lived singleton or counters would
 * reset every call — keyed per app+mode so one app's traffic can't throttle
 * another's, and so preview and published never share buckets.
 */
const rateLimitStores = new Map<string, KvShim>();
function getRateLimitKv(appId: string, mode: AppMode): KvShim {
  const key = `${appId}:${mode}`;
  let store = rateLimitStores.get(key);
  if (!store) {
    store = new KvShim();
    rateLimitStores.set(key, store);
  }
  return store;
}

// Each `new FsStorageAdapter(root)` mkdirSyncs its root — a blocking syscall.
// `buildUserEnv` runs PER dispatch, so constructing fresh adapters every call
// meant two synchronous mkdirs on the request hot path for directories that
// already exist after the first touch. The adapters are stateless beyond their
// root path, so memoize them (mirroring getRateLimitKv).
//
// The memo is keyed by the adapter's RESOLVED root — not a plain singleton —
// because an adapter captures its root (derived from EXEPAD_DATA_DIR) at
// construction. EXEPAD_DATA_DIR is constant in the shipped container, so this is
// a single entry in practice; but test harnesses repoint it at a fresh temp dir
// between cases, and a bare singleton would then keep reading the first (now
// deleted) root, serving an empty config ("model not found") for every later app.
const configCacheAdapters = new Map<string, FsStorageAdapter>();
function getConfigCacheAdapter(): FsStorageAdapter {
  const rootKey = process.env.EXEPAD_DATA_DIR ?? '/data';
  let adapter = configCacheAdapters.get(rootKey);
  if (!adapter) {
    adapter = new FsStorageAdapter();
    configCacheAdapters.set(rootKey, adapter);
  }
  return adapter;
}

const filesAdapters = new Map<string, FsStorageAdapter>();
function getFilesAdapter(bucketName: string): FsStorageAdapter {
  // Key on the fully-resolved bucket dir (which already encodes EXEPAD_DATA_DIR)
  // so a changed data root yields a fresh adapter instead of a stale one.
  const dir = bucketDir(bucketName);
  let adapter = filesAdapters.get(dir);
  if (!adapter) {
    adapter = new FsStorageAdapter(dir);
    filesAdapters.set(dir, adapter);
  }
  return adapter;
}

export interface BuildUserEnvOptions {
  /** Service token the gateway stamps on X-Service-Token; must match so the
   *  app-backend's verifyServiceToken passes for non-auth methods. */
  serviceToken?: string;
  environment?: string;
  appAlias?: string;
  /** Override the per-app files bucket name (defaults to `exepad-files-{appId}`). */
  filesBucketName?: string;
}

/** Construct the app-backend Env for an app+mode backed by local adapters. */
export function buildUserEnv(
  appId: string,
  mode: AppMode,
  opts: BuildUserEnvOptions = {},
): AppBackendEnv {
  const db = getAppD1(appId, mode);
  const configCache = getConfigCacheAdapter();
  const files = getFilesAdapter(opts.filesBucketName ?? `exepad-files-${appId}`);

  const env: AppBackendEnv = {
    DB: db as unknown as D1Database,
    CONFIG_CACHE: configCache as unknown as R2Bucket,
    R2_FILES: files as unknown as R2Bucket,
    DEPLOY_MODE: mode,
    APP_ID: appId,
    APP_ALIAS: opts.appAlias ?? appId,
    ENVIRONMENT: opts.environment,
    SERVICE_TOKEN: opts.serviceToken,
    // Activate the app-backend rate limiter in self-host. The generic per-identity
    // cap is set generously (a DoS backstop, NOT the auth gate) so normal CRUD and
    // the dashboard's burst of reads are never throttled; the tight, account-keyed
    // auth throttle lives in the app-backend itself. Both share this per-app store.
    RATE_LIMIT_KV: getRateLimitKv(appId, mode) as unknown as KVNamespace,
    RATE_LIMIT_MAX: process.env.EXEPAD_RATE_LIMIT_MAX ?? '1200',
    RATE_LIMIT_WINDOW: process.env.EXEPAD_RATE_LIMIT_WINDOW ?? '60',
    // Reach the runtime's own auth-email proxy (`/api/platform/email/send`, the
    // only place RESEND_API_KEY lives). There is no Workers service binding in
    // self-host, so the app-backend falls back to PLATFORM_URL over HTTP — point
    // it at our own loopback listener. EXEPAD_HTTP_ACTIVE_PORT is stamped by
    // server/main.ts once the HTTP listener is actually bound, so it survives the
    // port-fallback path; PORT is the pre-listen seed. The plain-HTTP listener is
    // always up (it is what the healthcheck and thumbnail cron use) even when the
    // runtime terminates TLS itself, so loopback is reachable in every mode.
    // Without this the fetcher defaulted to http://localhost:3000 — nothing
    // listens there, so verification and password-reset mail silently failed.
    PLATFORM_URL: platformBaseUrl(),
    // The proxy authenticates callers with X-Platform-Secret; hand the app-backend
    // the same generated secret the route verifies against (docker/entrypoint.sh
    // generates it on first run and persists it under /data/secrets).
    PLATFORM_INTERNAL_SECRET: process.env.PLATFORM_INTERNAL_SECRET || undefined,
    // From-address for auth mail. The transport's built-in default is an
    // @exepad.com address, which a self-hoster cannot verify with their own
    // email provider — the provider then rejects every verification/reset
    // message. Operators set EXEPAD_EMAIL_FROM to a domain they control.
    EMAIL_FROM_ADDRESS: process.env.EXEPAD_EMAIL_FROM || undefined,
    EMAIL_FROM_NAME: process.env.EXEPAD_EMAIL_FROM_NAME || undefined,
  };
  return env;
}

/** Loopback origin of this process's own plain-HTTP listener. */
function platformBaseUrl(): string {
  const port = process.env.EXEPAD_HTTP_ACTIVE_PORT || process.env.PORT || '8080';
  return `http://127.0.0.1:${port}`;
}
