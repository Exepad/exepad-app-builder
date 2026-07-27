/**
 * App-backend environment bindings.
 *
 * The surfaces below are Cloudflare-binding-SHAPED (`D1Database`, `R2Bucket`,
 * `KVNamespace`) because that is the interface this code is written against. In
 * the self-hosted build they are satisfied by `@exepad/local-adapters` — SQLite
 * for `DB`, the `/data` filesystem for `CONFIG_CACHE`/`R2_FILES`, an in-memory
 * shim for `RATE_LIMIT_KV` — assembled per {appId, mode} by the runtime worker
 * (`apps/runtime/worker/src/server/build-user-env.ts`).
 */

import type {
  InjectedProps,
  ModelProps,
  ColumnProps,
  IndexProps,
  CrudPolicyProps,
  AccessLevel,
  AuthLevel,
  HandlerProps,
  InputProps,
  OutputProps,
} from '@exepad/types';

// Re-export backend types so existing `import from '../types/env'` continues to work
export type {
  InjectedProps,
  ModelProps,
  ColumnProps,
  IndexProps,
  CrudPolicyProps,
  AccessLevel,
  AuthLevel,
  HandlerProps,
  InputProps,
  OutputProps,
};

export interface Env {
  /** D1 Database binding (per-app) */
  DB: D1Database;

  /**
   * Object store holding `app-config.json`. Read on first use by `loadConfig`
   * and cached by ETag in module scope. Always required (self-host binds the
   * filesystem-backed adapter; tests bind an in-memory double).
   */
  CONFIG_CACHE: R2Bucket;

  /** Deploy mode — selects which `deployment-status-{mode}.json` to read. */
  DEPLOY_MODE: 'preview' | 'published';

  // Compiled handler modules are loaded from the same object store by
  // `handlers/app-registry.ts` (or pre-registered through its injection seam),
  // not through env bindings.

  /** App identifier */
  APP_ID: string;

  /** App alias (human-readable) */
  APP_ALIAS: string;

  /** Environment name */
  ENVIRONMENT?: string;

  /** Shared secret for service-to-service auth between Runtime and Worker */
  SERVICE_TOKEN?: string;

  /** Shared secret used for Runtime platform RPCs such as email dispatch. */
  PLATFORM_INTERNAL_SECRET?: string;

  /**
   * From-address for auth email (verification / password reset). Self-host MUST
   * set this: the built-in default is an @exepad.com address that a self-hoster
   * cannot verify in their own email provider, so the provider rejects the send.
   * Seeded from EXEPAD_EMAIL_FROM / EXEPAD_EMAIL_FROM_NAME.
   */
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_FROM_NAME?: string;

  /** Allowed origins for CORS (comma-separated). Defaults to '*' if not set. */
  ALLOWED_ORIGINS?: string;

  /** KV namespace for rate limiting (opt-in: no binding = no rate limiting) */
  RATE_LIMIT_KV?: KVNamespace;

  /** Max requests per window (default: 100). Parsed as number. */
  RATE_LIMIT_MAX?: string;

  /** Rate limit window in seconds (default: 60). Parsed as number. */
  RATE_LIMIT_WINDOW?: string;

  /** Analytics Engine dataset binding (opt-in: no binding = no metrics) */
  ANALYTICS?: AnalyticsEngineDataset;

  /** Shared secret for gateway JWT verification (dev service → worker) */
  GATEWAY_JWT_SECRET?: string;

  /** R2 bucket for user file uploads (opt-in: no binding = storage disabled) */
  R2_FILES?: R2Bucket;

  // ── Platform Binding ──
  /** Service binding to the Runtime worker (for email RPC, API key isolation) */
  PLATFORM?: Fetcher;

  /** Fallback URL for Runtime when PLATFORM service binding is unavailable (local dev) */
  PLATFORM_URL?: string;
}
