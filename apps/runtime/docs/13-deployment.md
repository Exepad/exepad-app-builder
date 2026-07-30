# 13 -- Deployment

The runtime ships as **one self-hosted Docker container**: a **Vite SPA + a Hono API gateway running on bare Node** (`@hono/node-server`). The same Node process serves the SPA from disk, exposes `/api/*`, runs the deploy pipeline, and dispatches each app's backend (`apps/app-backend`) **in-process**. Persistence is a SQLite file per app+mode and a filesystem tree, both under the `/data` volume.

There are two distinct things called "deployment" in this repo, and they are covered separately below:

1. **Platform deployment** -- building and running the container (or running from source).
2. **Per-app deployment** -- `POST /api/deploy/{appId}`, which provisions an individual generated app's database, schema, and modules.

---

## 1. Runtime Topology

| Piece | What it is | Where |
|-------|-----------|-------|
| SPA | Vite build output, static files | `client/dist/`, served through the `ASSETS` fetcher |
| API gateway | Hono app, mounted routes + middleware | `worker/src/index.ts` |
| Node entrypoint | `@hono/node-server`, listeners, data dir, shutdown | `worker/src/server/main.ts` |
| App backend | `@exepad/app-backend`, imported and called directly | `worker/src/routes/gateway/dispatch-local.ts` |
| Database | one SQLite file per app+mode (better-sqlite3) | `<EXEPAD_DATA_DIR>/apps/{appId}/{mode}.sqlite` |
| Object storage | filesystem tree behind an R2-shaped adapter | `<EXEPAD_DATA_DIR>/storage`, `<EXEPAD_DATA_DIR>/buckets/` |
| Agent | Python ADK/FastAPI, reverse-proxied at `/agent/*` | internal `:8081` |

`worker/src/server/build-runtime-env.ts` is the seam: it builds the worker's
`Env` from `process.env` plus the local adapters —

```
CONFIG_CACHE → FsStorageAdapter over <EXEPAD_DATA_DIR>/storage
ASSETS       → a disk-backed Fetcher serving client/dist (SPA fallback to index.html)
secrets      → envSecret() wrappers over process.env
```

`worker/src/server/build-user-env.ts` does the same for each per-app dispatch
(`DB` → `LocalD1`, `CONFIG_CACHE` → `FsStorageAdapter`, `R2_FILES` →
`FsStorageAdapter` over the app's bucket dir, `RATE_LIMIT_KV` → an in-process
KV shim). These adapters implement the Cloudflare binding *interfaces* the
app-backend is typed against, so the type names in `worker/src/types/env.ts`
(`R2Bucket`, `D1Database`, `Fetcher`) describe **shapes**, not Cloudflare
services. `USER_WORKERS` is intentionally left unbound.

---

## 2. Vite Configuration

**File:** `client/vite.config.ts`

```ts
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [extImportMapPlugin(), react()],
  resolve: { alias: [/* 16 @/-prefixed aliases */] },
  server: {
    port: 3001,
    host: true,
    proxy: {
      '/api':       { target: 'https://localhost:8443', changeOrigin: true, secure: false },
      '/auth':      { target: 'https://localhost:8443', changeOrigin: true, secure: false },
      '/published': { target: 'https://localhost:8443', changeOrigin: true, secure: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: { external: [/^\/runtime_assets\//] },
  },
});
```

### Plugins

- **`@vitejs/plugin-react`** -- React Fast Refresh in development, JSX transform for production builds.
- **`extImportMapPlugin`** (`client/vite-plugin-ext-importmap.ts`) -- injects the import map that lets Code Focus components resolve `@exepad/sdk` and its peers at runtime.

### Path Aliases

Sixteen `@/`-prefixed aliases map to directories under `client/src/`
(e.g. `@/components` → `src/components`, `@/stores` → `src/stores`). They match
the TypeScript `paths` in `client/tsconfig.json`.

### Dev Server Proxy

The worker serves HTTPS by default and 302-redirects plain HTTP up to TLS, so
the dev proxy targets `https://localhost:8443` with `secure: false` (the local
cert is self-signed). Browsing the SPA at `http://localhost:3001` therefore
needs no certificate prompt.

### Build Output

- **Output directory:** `client/dist/` -- static SPA files (HTML, JS, CSS, assets).
- **Source maps:** disabled (`sourcemap: false`).
- **Externals:** anything under `/runtime_assets/` is left as a runtime URL — those are the SDK bundles emitted by `packages/exepad-sdk` into `client/public/runtime_assets/dist/`, not Vite inputs.

---

## 3. Node Server Bundle

**File:** `worker/build-server.mjs` (esbuild)

`pnpm build:worker` bundles three ESM entrypoints:

| Output | Entry | Purpose |
|--------|-------|---------|
| `dist/server.mjs` | `src/server/main.ts` | SPA + gateway + deploy + auth + orchestration + maintenance cron |
| `dist/screenshot-worker.mjs` | `src/server/screenshot-worker.ts` | isolated Chromium child that captures dashboard thumbnails |
| `dist/standalone-backend.mjs` | `src/server/standalone-backend.ts` | minimal `/rpc` + static server vendored into a downloaded standalone project |

Only native / binary-backed packages stay external and are installed in the
final image: `better-sqlite3` (native addon), `esbuild` (platform binary, used
by the build materializer), and `playwright-core` (drives the
system-installed Chromium; used by the screenshot child only).

---

## 4. Listeners, TLS, and Ports

**File:** `worker/src/server/main.ts`, with port resolution in `worker/src/lib/net-config.ts`

- **HTTP** binds `PORT` (default **8080**).
- **HTTPS** binds `EXEPAD_HTTPS_PORT` (default **8443**) using a per-instance self-signed certificate auto-minted into `<data>/certs/` (`server/self-signed-cert.ts`). Set `EXEPAD_TLS_CERT_FILE` / `EXEPAD_TLS_KEY_FILE` to supply your own.
- When the runtime terminates TLS itself, the HTTP listener is bound to **127.0.0.1 only** (loopback callers: the thumbnail cron and the container healthcheck), so no LAN client can bypass TLS.
- `EXEPAD_HTTPS_DISABLE=1` serves plain HTTP only. `EXEPAD_TLS_FRONTED=1` tells the runtime a proxy already terminates TLS (the shipped container's in-image Caddy sets this), so it serves plain HTTP for that proxy.
- Bad ports auto-heal: an occupied or privileged port falls back to the default (8080 / 8443) rather than locking the operator out. Browser-blocked ports are rejected outright (`BROWSER_UNSAFE_PORTS`).
- A saved value in the settings store (`net.http_port`, `net.https_port`, …) wins over the environment seed; socket knobs bind at boot, so changing them needs a restart.

`SIGTERM`/`SIGINT` trigger a graceful shutdown: stop accepting connections,
TRUNCATE-checkpoint every SQLite WAL, close pooled handles, exit.

---

## 5. Container

**Files:** `Dockerfile`, `docker-compose.yml` (repo root)

```bash
docker compose up --build
```

- `EXPOSE 80 443 8080`, `VOLUME ["/data"]`.
- The image runs Caddy in-process as the TLS terminator (80/443) in front of the Node runtime on 8080. On a publicly reachable box it also obtains a browser-trusted certificate at `https://<public-ip-dashed>.sslip.io` automatically.
- `HEALTHCHECK` curls `http://127.0.0.1:${PORT:-8080}/auth/status`.
- Secrets (session/deploy/bridge/service tokens) are generated on first run and persisted under `/data/secrets`.
- The Python agent runs inside the same container on internal `:8081`; the worker reverse-proxies `/agent/*` to it, gated on a valid operator session and stamped with `X-Exepad-Internal-Secret`.

For installer packages, one-line installers, and the `exepad` CLI, see the root
[README.md](../../../README.md).

### `/data` Layout

| Path | Contents |
|------|----------|
| `/data/apps/{appId}/{mode}.sqlite` | per-app database (`preview` and `published` are separate files) |
| `/data/storage/` | `CONFIG_CACHE` — app configs, deploy status, compiled modules, worker manifests, published snapshots, captured images (keyed `{appId}/…`) |
| `/data/buckets/exepad-files-{appId}/` | per-app file storage (`R2_FILES`) |
| `/data/uploads/` | staged uploads |
| `/data/certs/` | auto-minted self-signed TLS pair |
| `/data/secrets/` | generated platform secrets |
| `/data/meta.sqlite` | platform registry — operators, apps, deployments, settings |

`EXEPAD_DATA_DIR` overrides the root. When unset (a bare `pnpm dev`), the
server walks up to the workspace root and uses a gitignored `.exepad-data/`.

---

## 6. Running From Source

The repo-root `./run.sh` wrapper runs the same stack without Docker:

```bash
./run.sh local          # Node runtime on :8090 (plus HTTPS) + Python agent on :8081
```

It exports `EXEPAD_DATA_DIR=<repo>/.exepad-data`, generates the platform
secrets if absent, and picks 8090 for HTTP so it can coexist with other local
services. For frontend work, `pnpm dev` (Vite :3001 + `tsx watch` worker) gives
hot reload.

---

## 7. Build Pipeline

**From `apps/runtime/package.json`:**

| Command | Script | Description |
|---------|--------|-------------|
| `pnpm dev` | `concurrently "pnpm dev:client" "pnpm dev:worker"` | SPA + worker together |
| `pnpm dev:client` | `pnpm --filter @exepad/runtime-client dev` | Vite dev server only |
| `pnpm dev:worker` | `pnpm --filter @exepad/runtime-worker dev` | `tsx watch src/server/main.ts` |
| `pnpm build:client` | `pnpm --filter @exepad/runtime-client build` | TypeScript build + Vite bundle |
| `pnpm build:worker` | `pnpm --filter @exepad/runtime-worker build` | esbuild the Node server bundles |
| `pnpm test` | `vitest run` | All unit/integration tests |
| `pnpm check` | `tsc --noEmit` on client and worker | Type checking |
| `pnpm clean` | `rm -rf client/dist worker/dist .wrangler` | Remove build artifacts |

**From `apps/runtime/client/package.json`:**

| Command | Script | Description |
|---------|--------|-------------|
| `pnpm build` | `tsc -b && vite build` | TypeScript project build + Vite bundling |
| `pnpm preview` | `vite preview` | Preview the production build locally |

**From `apps/runtime/worker/package.json`:**

| Command | Script | Description |
|---------|--------|-------------|
| `pnpm dev` | `tsx watch src/server/main.ts` | Watch-mode Node server |
| `pnpm build` | `node build-server.mjs` | esbuild the three server bundles |
| `pnpm start` | `node dist/server.mjs` | Run the bundled server |

### Build Flow

1. **`pnpm build:client`** -- `tsc -b`, then `vite build` → `client/dist/`.
2. **`pnpm build:worker`** -- esbuild → `worker/dist/*.mjs`.
3. The image copies both into `/app` and starts `node dist/server.mjs`; the server serves `client/dist` through the `ASSETS` fetcher (path is `EXEPAD_CLIENT_DIST`, default `/app/apps/runtime/client/dist`).

---

## 8. Per-App Deployment Pipeline

**File:** `worker/src/routes/deploy.ts`

`POST /api/deploy/{appId}` runs a synchronous pipeline that provisions and
deploys **one generated app**. It is unrelated to deploying the platform. The
canonical step-by-step reference (with current step names, the parallel
provision phase, and the two-phase FK-ordered reseed in
`packages/deploy-utils/src/seed/seed-order.ts`) lives in
[docs/latest/10-deployment.md](../../../docs/latest/10-deployment.md). The
high-level order is:

| Step | Name | What happens |
|------|------|--------------|
| 1 | **Auth** | Constant-time compare `X-Deploy-Secret` against `DEPLOY_SECRET` |
| 2 | **Idempotency** | If `correlationId` matches a previous successful deploy, return the cached result |
| 3 | **Config** | Read the app config from `CONFIG_CACHE` — preview vs published key |
| 4 | **Validate** | Backend-props validation + empty-frontend guard (`repo.frontend.components` empty while `frontend.pages` isn't) |
| 5 | **Static seed** | Resolve inline CSV/static records into `backend.data.datasets` for the browser runtime |
| 6 | **Provision (parallel)** | Read compiled handler modules, read the backend template, get-or-create the app's SQLite file, create the per-app file-storage bucket dir when storage is enabled |
| 7 | **Lock** | Acquire the per-app deploy lock |
| 8 | **Schema** | Snapshot the existing schema, diff against target, apply migrations (safe / destructive / reset per model policy), taking a byte-level DB backup first |
| 9 | **System tables** | Batched DDL for files (when storage enabled) and auth + API keys (when security is configured) |
| 10 | **Seed** | Preview: all models. Published: `ownerScope: 'shared'` only, with a non-destructive empty-guard so a first publish into an empty database still seeds the catalog. Two-phase FK-ordered: clear children before parents, insert parents before children, deferred-FK UPDATE pass for cycles |
| 11 | **Snapshot** (published) | Write the published artifact set under `published/releases/{suffix}/`, write the SEO snapshots, validate the manifest, prune older releases |
| 12 | **Modules** | `uploadWorkerScript` writes `_entry.js`, `template.js`, and `handlers/*.js` plus a manifest to `{appId}/{mode}/modules/` (write-then-prune, so the module tree is never empty mid-deploy) |
| 13 | **Release + status** | Release the lock, write the success status, invalidate both config caches |

`provisionD1Database`, `provisionR2Bucket`, and `uploadWorkerScript` come from
`@exepad/deploy-utils` and are **local implementations**: get-or-create a
SQLite file, `mkdir` a bucket directory, and write module files to disk
respectively. Their Cloudflare-flavoured names are historical.

### Error Handling

- **Rollback**: if a rollback-eligible step (`schema`, `upload`, `seed`, `snapshot`) fails after migrations were applied, the pipeline restores the byte-level pre-migration backup — recovering rows a destructive rebuild dropped — falling back to reverse-DDL `rollbackSchema` only if there is no backup or the restore fails.
- **Lock cleanup**: the `finally` block always releases the deploy lock.
- **Failure status**: the failing step and error message are written to storage so the status endpoint can report what went wrong.

### Status Check Endpoint

```
GET /api/deploy/{appId}?mode=preview
```

Returns the last deployment status. Protected by the same `X-Deploy-Secret`
header.

---

## 9. Environment Variables

### Build-Time (Vite Client Bundle)

Vite inlines `VITE_`-prefixed variables into the client bundle at build time via
`import.meta.env`; they are baked into the JavaScript and cannot change at
runtime. `__APP_VERSION__` is likewise defined at build/dev start from
`client/package.json`, so the About page always reflects the shipped version.

### Runtime (read by the Node server from `process.env`)

| Variable | Description |
|----------|-------------|
| `EXEPAD_DATA_DIR` | Data root (the container sets `/data`; `run.sh local` sets `<repo>/.exepad-data`) |
| `PORT` | HTTP listen port (default 8080) |
| `EXEPAD_HTTPS_PORT` / `EXEPAD_HTTPS_DISABLE` | In-process TLS port / opt out of in-process TLS |
| `EXEPAD_TLS_FRONTED` / `EXEPAD_TRUST_PROXY` | A trusted proxy terminates TLS in front of the runtime; makes `X-Forwarded-For` believable |
| `EXEPAD_TRUST_CF` | Additionally believe `cf-connecting-ip` for rate-limit bucketing (off by default, and only read when one of the two above is set). Set it **only** when a real Cloudflare edge fronts the runtime — without it every visitor arriving through Cloudflare shares the edge IP's bucket; with it, if anything else (or nothing) is in front, a client can forge the header and dodge the `/auth/login` throttle |
| `EXEPAD_TLS_CERT_FILE` / `EXEPAD_TLS_KEY_FILE` | Operator-supplied certificate pair |
| `ENVIRONMENT` | `development` \| `selfhost` (default) \| `staging` \| `production` — gates dev-only bypasses and the CSP profile |
| `EXEPAD_CLIENT_DIST` | Path to the built SPA (default `/app/apps/runtime/client/dist`) |
| `EXEPAD_AGENT_URL` | Agent base URL for the `/agent/*` proxy (default `http://127.0.0.1:8081`) |
| `EXEPAD_AGENT_INTERNAL_SECRET` | Shared secret stamped on proxied agent requests |
| `EXEPAD_ALLOWED_ORIGINS` | Credentialed-CORS allowlist (origins, `host:port`, or `*.suffix`; comma/pipe separated) |
| `EXEPAD_STRICT_LOCAL_CORS` | Drop the wildcard-port loopback CORS reflection |
| `EXEPAD_MAX_UPLOAD_BYTES` | Ceiling for `POST /api/{appId}/_files/upload` (default 100 MB) |
| `EXEPAD_HSTS` | Opt in to HSTS globally (off by default) |
| `EXEPAD_ALLOW_ESM_CDN`, `EXEPAD_STRICT_CONNECT_SRC`, `EXEPAD_CONNECT_SRC_ALLOW` | CSP relaxations / tightenings (see [11-middleware-and-security.md](./11-middleware-and-security.md)) |
| `EXEPAD_SINGLE_APP_ID` | Serve exactly one published app; the builder/operator surface 404s |
| `EXEPAD_SESSION_SECRET`, `DEPLOY_SECRET`, `USER_WORKER_SERVICE_TOKEN`, `PLATFORM_INTERNAL_SECRET`, `EXEPAD_AGENT_INTERNAL_SECRET` | Platform secrets generated on first run and persisted to `/data/secrets/env.sh` (`PLATFORM_BRIDGE_SECRET` defaults to the session secret) |
| `PLATFORM_DIAGNOSTIC_SECRET` | `X-Diagnostic-Secret` for the Surveyor probes — **not** auto-generated; unset means the probes stay closed |
| `RESEND_API_KEY` | Auth email transport (verification + password reset only) |

LLM provider configuration (`EXEPAD_LLM_PROVIDER`, `EXEPAD_LLM_API_KEY`,
`EXEPAD_LLM_BASE_URL`, …) and first-run admin seeding
(`EXEPAD_ADMIN_EMAIL`/`EXEPAD_ADMIN_PASSWORD`/`EXEPAD_SETUP_TOKEN`) are
documented in `docker-compose.yml` at the repo root.

---

## 10. Known Limitations

1. **SPA SEO** -- the runtime is a client-side SPA, so crawlers that do not execute JavaScript see only the shell. `worker/src/lib/meta-injector.ts` mitigates this by injecting `<title>`, `<meta description>`, and Open Graph tags into the HTML before it reaches the browser, and the deploy pipeline writes SEO snapshots for published apps; full page content is still rendered client-side.
2. **Single process** -- the rate limiter, config caches, and Cache API shim are per-process in-memory maps. This is a single-container burst limiter; front it with your proxy's own rate limiting for multi-instance deployments.
3. **No browser rendering** -- `POST /api/{appId}/_diag/inspect` (screenshot/DOM inspection) has no self-host equivalent and returns `503 browser_unavailable`. Dashboard thumbnails use a locally-spawned Chromium instead.
4. **Build-time inlining** -- `VITE_*` values are baked into the client bundle, so changing them requires a client rebuild.
