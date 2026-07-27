export interface SecretStoreSecret {
  get(): Promise<string>;
}

export type SecretBinding = string | SecretStoreSecret;

/**
 * Runtime worker bindings.
 *
 * The surfaces here are Cloudflare-binding-SHAPED (`R2Bucket`, `Fetcher`,
 * `KVNamespace`-style secret accessors) because that is the interface the
 * request code is written against. In the self-hosted build they are satisfied
 * by `@exepad/local-adapters` over local infrastructure — SQLite, the `/data`
 * filesystem, in-memory shims — assembled in `server/build-runtime-env.ts`.
 */
export interface Env {
  ASSETS: Fetcher;

  CONFIG_CACHE: R2Bucket;
  // Legacy Workers-for-Platforms dispatch handle. The self-hosted runtime never
  // binds it (the app-backend is dispatched in-process — see
  // routes/gateway/dispatch-local.ts); the gateway only reads it as an
  // "am I running under WfP?" flag when no deployed config is found.
  USER_WORKERS?: DispatchNamespace;

  DEPLOY_SECRET: SecretStoreSecret;

  ENVIRONMENT: string;
  PLATFORM_DOMAINS: string;
  EXEPAD_ROUTER_SECRET: SecretBinding;
  PLATFORM_BRIDGE_SECRET: SecretBinding;
  RESEND_API_KEY: SecretStoreSecret;
  PLATFORM_INTERNAL_SECRET: SecretBinding;
  USER_WORKER_SERVICE_TOKEN: SecretBinding;
  // Surveyor Phase 2 — runtime probes auth header (`X-Diagnostic-Secret`).
  PLATFORM_DIAGNOSTIC_SECRET: SecretBinding;
}

export interface DispatchNamespace {
  get(scriptName: string): Fetcher | null;
}
