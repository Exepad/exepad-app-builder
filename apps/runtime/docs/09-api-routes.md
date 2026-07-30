# 09 — API Routes

> The runtime API is a **Hono app running on bare Node** via `@hono/node-server`
> (`apps/runtime/worker/src/`). The same process serves the SPA (disk-backed
> `ASSETS` fetcher + meta injection) and exposes the API under `/api/*`. Routes
> are mounted in `worker/src/index.ts`; the Node entrypoint is
> `worker/src/server/main.ts`. Per-app backends are **not** separate services —
> `apps/app-backend` is imported and called in-process.
> See [01-overview.md](./01-overview.md) for the overall worker layout.

> Canonical sources:
> - `apps/runtime/worker/src/index.ts` — Hono app entry; mounts every route group, middleware, SPA/asset serving
> - `apps/runtime/worker/src/server/main.ts` — `@hono/node-server` entrypoint (listeners, data dir, shutdown)
> - `apps/runtime/worker/src/routes/gateway/` — per-app API gateway (directory: `index`, `auth`, `config`, `dispatch`, `dispatch-local`, `services`, `utils`, `types`)
> - `apps/runtime/worker/src/routes/deploy.ts` — deploy pipeline
> - `apps/runtime/worker/src/routes/deprovision.ts` — app teardown + orphan GC
> - `apps/runtime/worker/src/routes/admin/` — admin API (users, database, files, settings, source, export)
> - `apps/runtime/worker/src/routes/email.ts` — auth email transport (Resend proxy; verification + password-reset only)
> - `apps/runtime/worker/src/routes/diagnostic.ts` — Surveyor read-only probes
> - `apps/runtime/worker/src/types/env.ts` — the runtime `Env` interface (Cloudflare-binding-*shaped* surfaces, satisfied by `@exepad/local-adapters`)

---

## 0. Route Mounting Order

All routes are mounted in `index.ts`. The order matters because the gateway is a
catch-all under `/api`:

```ts
// index.ts
app.route('/api/deploy', deploy);
app.route('/api/deprovision', deprovision);
app.route('/api/admin', admin);
app.route('/api/platform/email', email);
app.route('/auth', auth);                 // local operator auth (top-level)
app.route('/api/orchestrate', orchestrate);
app.route('/api/settings', settings);     // these five MUST precede the gateway
app.route('/api/domains', domains);       // or their first segment is read as an appId
app.route('/api/network', network);
app.route('/api/publish', publish);
app.route('/api/quick-access', quickAccess);
app.route('/api', diagnostic);   // /api/:appId/_diag/* — MUST precede gateway
app.route('/api', gateway);      // catch-all /api/:appId/*
```

Cross-cutting middleware applied in `index.ts`, in order:

- Loopback-only `GET /internal/tls/authorize` bypass (the in-image Caddy's
  on-demand-TLS "ask" endpoint), the single-app serve gate
  (`EXEPAD_SINGLE_APP_ID`), the HTTP→HTTPS redirect, and the canonical
  front-port redirect — all `*`, all inert no-ops outside their mode
- `securityHeaders()` on `*` (see [11-middleware-and-security.md](./11-middleware-and-security.md))
- `compress()` on `*`, plus a `Vary: Accept-Encoding` stamp
- Hono `cors()` on `/api/*`, with the origin callback backed by
  `lib/origin.ts`'s allowlist
- `bodyLimit()` on `/api/*` — 10 MB generally, `EXEPAD_MAX_UPLOAD_BYTES`
  (default 100 MB) for `POST /api/{appId}/_files/upload`
- `rateLimiter()` on `/api/deploy/*` (10/min), `/api/deprovision/*` (5/min),
  `/api/admin/*`, `/api/settings/*`, `/api/network/*`, `/api/domains/*` (60/min),
  `/api/platform/email/*` (30/min), `/api/publish/*` and `/api/quick-access/*`
  (10/min), `/api/:appId/_diag/*` (30/min), and `/auth/login` + `/auth/setup`
  (10/min)

Beyond `/api/*`, `index.ts` also serves SPA assets and per-app stored assets,
plus a handful of standalone routes: the `/agent/*` reverse proxy to the local
Python agent (operator-session gated), `GET /verify-email`,
`POST /internal/invalidate-config` (DEPLOY_SECRET-gated cache purge),
`GET /repo/*`, `GET /published/assets/*`, `GET /a/:appIdSegment/repo/*`,
`GET /a/:appIdSegment/__refresh` (silent preview-cookie renewal),
`GET /a/:appIdSegment/published/assets/*`, `GET /robots.txt`,
`GET /a/:appId/robots.txt`, `GET /a/:appId/sitemap.xml`, and the `*` SPA shell
fallback (`injectMeta`). This document focuses on the `/api/*` surface.

---

## 1. Main API Gateway

> Source: `worker/src/routes/gateway/index.ts` (plus `auth`, `config`,
> `dispatch`, `services`, `utils`, `types` in the same directory)

The gateway is a single Hono handler bound to `GET|POST|PUT|PATCH|DELETE|OPTIONS`
via `gateway.all('/:appId/*', ...)`. It owns every `/api/{appId}/...` request
that isn't claimed by an earlier route group.

### 1.1 appId / Mode Resolution

The first path segment after `/api` is the app id. An `appId` that begins with
`preview-` (e.g. `/api/preview-abc123/...`) selects **preview** mode and the bare
id is recovered by stripping the prefix. Preview mode is also selected when the
request carries `X-Deploy-Mode: preview`. Otherwise mode is **published**.

```ts
// gateway/index.ts
const urlIsPreview = rawAppId.startsWith('preview-') && rawAppId.length > 'preview-'.length;
const segment = urlIsPreview ? rawAppId.substring('preview-'.length) : rawAppId;
const appId = resolveAppIdForSegment(segment);   // friendly slug → canonical id
const mode = (urlIsPreview || request.headers.get('X-Deploy-Mode') === 'preview')
  ? 'preview' : 'published';
```

Published apps are shared at `/a/<slug>/…`, so the gateway resolves the
name-derived alias to the immutable `app.id` via `lib/meta-db.ts`'s
`resolveAppIdForSegment`. Doing it here is safe precisely because the gateway is
the catch-all: reserved `/api/*` routes matched their own handlers first.

### 1.2 Routing Table

The gateway inspects the path after `/api/{appId}/`. The first segment (and,
for `/rpc`, the JSON body `method`) decides the destination.

| Path                         | Destination                              | Handler (gateway module)                |
|------------------------------|------------------------------------------|-----------------------------------------|
| `_health`                    | Health check (inline JSON)               | inline in `gateway/index.ts`            |
| `app-config`                 | Full app config from storage (ETag/304)  | `loadFullAppConfigBody` (`config.ts`)   |
| `mcp`                        | App-backend `/mcp` (passthrough)         | `dispatchMcp` (`services.ts`)           |
| `_files/*`                   | App-backend file storage                 | `dispatchFiles` (`services.ts`)         |
| `rpc`                        | App-backend RPC (method from body)       | `dispatchRpc` (`dispatch.ts`)           |
| `{model}` / `{handler}` / `auth_*` / `admin_*` / `_bulk` | App-backend auto-CRUD / handler | `dispatchRpc` (`dispatch.ts`) |

### 1.3 RPC Body Building

For routes that hit the app-backend, requests are converted into a JSON-RPC
envelope by `buildRpcBody` (`dispatch.ts`):

- **Model (POST):** `{ method, model: routeName, params }`. `method` comes from
  the body and defaults to `sys_list`; for `sys_create`/`sys_update` with no
  explicit `params`, the remaining body fields are wrapped as `{ data: ... }`.
- **Handler (POST):** `{ method: routeName, params: body }` — the route name is
  always the method; the body's `method` field is ignored.
- **`_bulk` (POST):** `{ method: body.method || 'sys_multi_query', params: body.params }`.
- **GET:** `{ method: 'sys_list' (model) | routeName (handler), model?, params }`
  where `params` is the parsed query string (`limit`/`offset` coerced to numbers).

The dedicated `rpc` route takes the JSON-RPC envelope directly from the request
body (`parseRpcEnvelope`) and resolves the dispatch target with
`resolveRpcDispatchTarget` (`dispatch.ts`): `sys_multi_query` → `_bulk`; other
`sys_*` methods resolve against `params.model`; anything else is resolved as a
model or handler name.

### 1.4 Route Resolution

`resolveBackendRoute(config, routeName)` (`dispatch.ts`) decides whether a path
segment is a model or a handler:

1. `_bulk` → model.
2. When `security` is configured, `auth_*` and `admin_*` → handler (works
   regardless of backend mode; the app-backend handles auth via the system
   tables `_auth_users` / `_auth_sessions` in the app's own SQLite database).
3. For `backend.mode === 'dynamic'`: match against `backend.models[].name`,
   then `backend.handlers[].name`.

If nothing matches, the gateway returns a 404 with `availableModels` and
`availableHandlers` lists.

### 1.5 In-Process Dispatch to the App Backend

`dispatchRpc` (`dispatch.ts`) delegates to `dispatchRpcInProcess`
(`dispatch-local.ts`). There is **one** transport: the app-backend module is
imported into the same Node process and its `fetch(request, env)` export is
called directly — no network hop, no dispatch namespace, no separate service.

```ts
// gateway/dispatch-local.ts
const userEnv = await userEnvFor(appId, mode, env, appAlias);
const request = new Request('http://app-backend/rpc', {
  method: 'POST', headers, body: JSON.stringify(rpcBody),
});
return appBackend.fetch(request, userEnv as never);
```

`userEnvFor` calls `server/build-user-env.ts`, which builds the per-`{appId, mode}`
backend `Env` from the local adapters: `DB` → a SQLite handle for
`<EXEPAD_DATA_DIR>/apps/{appId}/{mode}.sqlite`, `CONFIG_CACHE` → the filesystem
storage adapter, `R2_FILES` → the app's bucket directory, `RATE_LIMIT_KV` → a
process-lived in-memory KV shim (kept per app+mode so one app can't throttle
another). This is the single place the adapter→binding-type casts live.

`dispatchMcp` and `dispatchFiles` (`services.ts`) use the sibling
`fetchAppBackendInProcess`, which forwards the raw request (method + streaming
body preserved) to `/mcp` or `/files/...` on the same in-process backend.

### 1.6 Identity & Dispatch Headers

`resolveGatewayIdentity` (`auth.ts`) inspects the request and produces a
`GatewayIdentity`. Recognized credentials, in priority order:

1. `Authorization: Bearer exepad_sk_*` — API key (forwarded unchanged).
2. `exepad_app_session` cookie — app session (forwarded as `X-Session-Token`).
3. `X-Platform-Token` — HMAC-SHA256 platform bridge token; on success the
   gateway sets `X-User-Id` / `X-User-Email` / `X-User-Roles` and, in preview
   mode, mints a `__exepad_pa` preview-access token.
4. Preview mode only: a `?pt=` query token or `__exepad_pa` cookie validated
   against `PLATFORM_BRIDGE_SECRET`, with sliding renewal.

`buildDispatchHeaders` (`auth.ts`) merges the identity headers with dispatch
metadata before calling the app-backend:

- Sets `X-Service-Token` from `USER_WORKER_SERVICE_TOKEN` — it throws when the
  token is missing in `production`, `staging`, or `selfhost`. The self-hosted
  runtime always populates one (`build-runtime-env.ts` mints an ephemeral token
  if the environment supplies none), so the backend's service-token check always
  runs and gateway-injected `X-User-*` headers are never trusted unverified.
- Always sets `X-Request-Id` (echoing the inbound value, else a fresh UUID).
- In **preview** mode, rewrites `X-User-Id` to `preview-owner-{appId}` for
  authenticated callers so the deploy seeder's demo rows are visible. Preview
  *access* gating still uses the real uid from the signed preview-access token.
- When the loaded config has `security.enabled === false`, sets
  `X-Exepad-Auth-Disabled: 1` and, for unauthenticated callers, the public
  identity (`_exepad_public_`).

The app-backend loads its own config from `CONFIG_CACHE`, so the gateway does
**not** inject config via headers.

### 1.7 Config Loading & Caching

`loadAppConfig(appId, mode, env)` (`config.ts`) resolves the backend slice of the
config through a three-layer cache:

1. **In-memory map** — mode-aware TTL: 60s published, 10s preview, 10s for null
   results.
2. **Cache API** — 5min published, 30s preview (`getDefaultCache`). In the
   self-hosted runtime this is the in-memory Cache shim installed at boot by
   `installCacheShim()` from `@exepad/local-adapters`, not an edge cache.
3. **Storage** — `CONFIG_CACHE.get(resolveConfigKey(...))` against the
   filesystem adapter; for preview the config path is read from
   `deployment-status-preview.json`.

`invalidateGatewayConfig(appId, mode)` clears both the in-memory entry and the
Cache-shim entry; it is called by the deploy pipeline and by
`POST /internal/invalidate-config`. `loadFullAppConfigBody` streams the complete
config (full `WebAppProps`, not just the backend slice) straight from storage
for the `app-config` route, preserving the ETag for conditional 304 responses.

For the `_files` route only, when no deployed config exists (no `USER_WORKERS`
binding — which is always the case in self-host — or
`ENVIRONMENT === 'development'`) the gateway falls back to `loadExampleConfig`
(`config.ts`), which reads example app JSON through the `ASSETS` fetcher under
`/example/...`.

### 1.8 Special Routes Handled Inline

- **`_health`** — returns `{ status: 'ok', appId, bindings: { configCache, deploySecret } }`,
  a presence check on the storage adapter and the deploy secret.
- **`app-config`** — streams the full config from storage with `ETag` +
  `Cache-Control: no-cache, must-revalidate`; honors `If-None-Match` (304). On a
  missing **published** config it probes the preview deploy-status object and, if
  present, returns `404 { error: 'not_published', preview_available: true }` so
  the SPA can stop retrying.
- **`auth_me`** — never propagates dispatch failures; returns a JSON
  `isAuthenticated: false` envelope when the app/config is missing, has no
  security, or the worker errors, so the login page can always render.

### 1.9 Preview Authentication Gate

When `mode === 'preview'`, the gateway resolves identity up front and returns
`401 UNAUTHORIZED` unless the request is authenticated. A raw platform-session
or platform-bridge operator identity additionally has to pass
`userCanAccessApp(userId, appId)` (`lib/meta-db.ts`) or the gateway answers
`403` — an operator is authenticated for *any* app, so ownership of *this* app
is checked separately. A `preview_access` token is already bound to its appId by
`validatePreviewAccessToken`, so it skips that second check. Published apps are
gated downstream by the app-backend according to their own `security` config.

### 1.10 Deploy-State Disambiguation

For a missing **preview** config the gateway distinguishes "still building" from
"failed" by reading `deployment-status-preview.json`
(`_maybeDeployFailedResponse`): a `status: "failed"` object yields
`503 DEPLOY_FAILED` (`retryable: false`); otherwise it returns
`503 DEPLOY_IN_PROGRESS` (`retryable: true`). A missing **published** config
returns `404 APP_NOT_FOUND`.

### 1.11 Router Secret Validation

`validateRouterSecret` (`auth.ts`) is a **cloud-only** gate: it returns `true`
immediately unless `ENVIRONMENT === 'production'`. The self-hosted runtime
(`ENVIRONMENT=selfhost`) is reached same-origin with no fronting router, so the
check is a no-op there. When it does apply, a request passes if either:

1. the `x-exepad-secret` header matches `EXEPAD_ROUTER_SECRET`, **or**
2. the request `Host` (`x-forwarded-host`/`host`) is in the comma-separated
   `PLATFORM_DOMAINS` list.

Failures return `403 FORBIDDEN`. Note this is *not* the self-host security
boundary — that is the operator session, the preview-access token, the
per-request CORS/origin allowlist, and the app's own `security` config.

### 1.12 MCP Passthrough

For the exact path `mcp`, `dispatchMcp` (`services.ts`) forwards the raw request
to the app-backend's `/mcp` endpoint in-process. The original method,
`Content-Type`, and body are preserved; the `Authorization` header passes
through unchanged. The gateway adds platform dispatch headers (incl.
`X-Service-Token`) and CORS, but the app-backend performs MCP auth itself
(Bearer `exepad_sk_*` API key or gateway identity).

### 1.13 File Storage Passthrough

`_files/*` is handled by `dispatchFiles` (`services.ts`):

- `POST _files/upload` — forwards the multipart body (streamed, with
  `Content-Type` and `Content-Length` preserved so the backend's early-413
  size precheck and byte-rate limiter work) to the backend's `files/upload`.
- `GET _files/{id}/{name}` — streams the binary back with `nosniff` and a
  restrictive `Content-Security-Policy: script-src 'none'`.
- `POST _files/{read|list|delete}` — converts to a `sys_file_{op}` JSON-RPC call.

### 1.14 CORS

CORS is configured globally on `/api/*` via Hono's `cors()` middleware in
`index.ts` (`allowMethods: GET, POST, PUT, PATCH, DELETE, OPTIONS`;
`allowHeaders: Content-Type, Authorization, X-Request-Id, X-Platform-Token,
If-None-Match`; `credentials: true`; `maxAge: 86400`). The `origin` option is a
callback into `resolveAllowedOrigin` (`lib/origin.ts`), so only allow-listed
origins are reflected. Individual gateway responses additionally layer
per-origin headers via `corsHeaders` / `wrapWithCors` (`utils.ts`), which derive
from the same allowlist.

---

## 2. Deployment Endpoint

> Source: `worker/src/routes/deploy.ts`

### 2.1 `POST /api/deploy/:appId` — Deploy Pipeline

Runs a synchronous deployment pipeline for **one generated app**: it provisions
the app's SQLite file, applies schema migrations, seeds data, and writes the
compiled backend modules to storage. `currentStep` is tracked throughout so
failures record which step broke. The canonical operational reference is
[docs/latest/10-deployment.md](../../../docs/latest/10-deployment.md); the table
below maps those phases to the step annotations numbered inline in `deploy.ts`
(which include fractional sub-steps such as 3.5, 4.5, and 10.5–10.8).

**Request body** (`DeployRequest`):

| Field           | Required | Description                                        |
|-----------------|----------|----------------------------------------------------|
| `mode`          | Yes      | `"preview"` or `"published"`                        |
| `appAlias`      | No       | Human-readable alias (validated); defaults to `appId` |
| `correlationId` | No       | Idempotency key                                    |
| `configPath`    | Yes*     | Storage path to the config (*required for preview mode) |

**Pipeline steps** (numbered in `deploy.ts`):

| Step | Name             | Description                                                                                   |
|------|------------------|-----------------------------------------------------------------------------------------------|
| 1    | Auth             | `X-Deploy-Secret` constant-time compared to `DEPLOY_SECRET`                                   |
| 2    | Idempotency      | If `correlationId` matches a prior successful deploy, return cached result (`idempotent:true`) |
| 3    | Read config      | Load config from `CONFIG_CACHE` (`{appId}/{configPath}` preview, `{appId}/published/app-config.json` published) |
| 3.5  | Empty-frontend guard | Reject deploys where `repo.frontend.components` is empty but `frontend.pages` is not       |
| 4    | Validate         | `extractBackendProps` + `validateInjectedConfig`; storage requires `backend.mode = "dynamic"` |
| 4.5  | Static seeds     | `resolveStaticSeeds` — inline CSV/static records for datasets without a backing model (non-fatal) |
| 5–8c | Provision (parallel) | `readRepoModules` (compiled handler `.js`), `readWorkerTemplate`, `provisionD1Database` (get-or-create the app's SQLite file), `provisionR2Bucket` (mkdir the per-app files bucket, when storage enabled) |
| 7    | Generate entry   | `generateEntryModule` builds `_entry.js` from the handler method names                        |
| 9    | Acquire lock     | `acquireDeployLock` (prevents concurrent deploys of the same app)                             |
| 10   | Schema           | `saveDeploymentSnapshot` (best-effort) + a byte-level DB backup, then `applyMigrations`        |
| 10.5–10.6 | System tables | Batched DDL for files (when storage enabled) and auth + api-keys (when security is configured) |
| 11   | Seed             | `seedFromR2` — preview seeds all models; published seeds only `ownerScope: "shared"` models non-destructively |
| 12   | Snapshot (published) | `writePublishedSnapshot` + `writeSeoSnapshots` under `published/releases/{suffix}/`, then `validatePublishedManifest` and a prune of older releases |
| 13   | Write modules    | `uploadWorkerScript` writes `_entry.js`, `template.js`, `handlers/*.js` and a manifest to `{appId}/{mode}/modules/` (write-then-prune, never an empty tree) |
| 14   | Release lock     | `releaseDeployLock`                                                                           |
| 15   | Save status + invalidate | Write success status to storage; `invalidateConfig` + `invalidateGatewayConfig` |

**Error handling & rollback** (`catch` block): if a rollback-eligible step
(`schema`, `upload`, `seed`, `snapshot`) fails after migrations were applied, the
pipeline restores the byte-level pre-migration backup (recovering rows a
destructive rebuild dropped), falling back to `getPreviousSchema` +
`rollbackSchema` only when there is no backup or the restore fails. A failure
status (with `step` and `error`) is written to storage, and the deploy lock is
released in `finally`.

**Success response** (`DeployResponse`): `{ success, workerName, d1Id, duration,
templateSha, migrations, seeded, configPath, seedErrors?, migrationWarnings?,
schemaDestructive?, backupPath? }`. `workerName` and `d1Id` are historical field
names: they carry the module-set name (`app-{appId}` / `app-preview-{appId}`)
and the absolute SQLite file path.

### 2.2 `GET /api/deploy/:appId` — Status

Same `X-Deploy-Secret` gate. Reads the `DeploymentStatus` for the requested
`mode` (query param, defaults to `published`) from storage via
`loadDeploymentStatus`, returning `{ success: true, data: status }` or `404`
when none exists.

---

## 3. Deprovision Endpoint

> Source: `worker/src/routes/deprovision.ts`

### 3.1 `DELETE /api/deprovision/:appId`

Tears down every local resource an app owns. Auth is the same `X-Deploy-Secret`
as deploy; `appId` must match `^[a-z0-9]{8,16}$`. It deletes, recording
counts/names and per-resource errors:

- stored objects under `{appId}/` in `CONFIG_CACHE` (`deleteR2ObjectsByPrefix`)
- the app's SQLite files (`exepad-{appId}` and `exepad-preview-{appId}`)
- the written module sets `app-{appId}` and `app-preview-{appId}`
- the file-storage bucket directory `exepad-files-{appId}`

Returns `200` when fully clean or `207` (Multi-Status) on partial failure.

### 3.2 `POST /api/deprovision/gc`

Garbage-collects orphaned resources. The caller supplies
`{ liveAppIds: string[], dryRun?: boolean }`; the worker enumerates databases,
module sets, and storage prefixes, derives appIds, and treats any not in
`liveAppIds` as orphans. Unless `dryRun`, it cleans up to 20 orphans per run,
returning a `GCResult` with discovered counts, `orphans`, and `cleaned`.

---

## 4. Admin API

> Source: `worker/src/routes/admin/` (`index.ts` mounts the sub-routers)

Mounted at `/api/admin`. Every sub-route is keyed by `:appId` and authenticated
by `authenticateAdmin` (`lib/admin-auth.ts`), which validates the caller (deploy
secret or an operator session that owns the app) and resolves the app's database
into an `AdminContext`.

| Mount                              | Routes                                                                                                   |
|------------------------------------|---------------------------------------------------------------------------------------------------------|
| `/api/admin/:appId/users`          | `GET /`, `POST /`, `GET /:userId`, `PUT /:userId`, `DELETE /:userId`, `GET /:userId/sessions`, `DELETE /:userId/sessions`, `POST /:userId/reset-password` |
| `/api/admin/:appId/database`       | `GET /tables`, `GET /tables/:tableName/schema`, `GET /tables/:tableName/rows`, `POST /tables/:tableName/rows`, `PUT /tables/:tableName/rows/:rowId`, `DELETE /tables/:tableName/rows/:rowId` |
| `/api/admin/:appId/files`          | `GET /`, `GET /:fileId/download`, `DELETE /:fileId`                                                       |
| `/api/admin/:appId/settings`       | per-app operator settings                                                                                 |
| `/api/admin/:appId/source`         | read the app's generated source                                                                           |
| `/api/admin/:appId/export`         | export bundles (standalone / deployable / handover)                                                       |

---

## 5. Auth Email Transport

> Source: `worker/src/routes/email.ts`

`POST /api/platform/email/send` proxies transactional email to Resend. It is the
security boundary that keeps `RESEND_API_KEY` out of app-backend isolates. This
is **not** a user-facing email service — it is the internal transport that auth
uses for email verification and password-reset messages only. App authors cannot
send arbitrary email through it.

- Auth: `X-Platform-Secret` constant-time compared to `PLATFORM_INTERNAL_SECRET`
  (skipped only in `ENVIRONMENT === 'development'`).
- Validates required fields (`to`, `subject`, and one of `html`/`text`,
  `from.email`) and enforces a `from` address ending in `@exepad.com` /
  `@exepad.app`.
- Forwards to `https://api.resend.com/emails` and returns
  `{ success, messageId? }` or an error with the upstream status code.

Without `RESEND_API_KEY` the transport is simply unavailable, and the auth flows
that use it (email verification, password reset) degrade accordingly.

---

## 6. Diagnostic Probes (Surveyor)

> Source: `worker/src/routes/diagnostic.ts`

Mounted on `/api` **before** the gateway so `/api/:appId/_diag/*` is not consumed
by gateway dispatch. Every route requires the dedicated `X-Diagnostic-Secret`
header (`PLATFORM_DIAGNOSTIC_SECRET`) and is rate-limited to 30 req/min.

| Endpoint                                       | Purpose                                                                 |
|------------------------------------------------|-------------------------------------------------------------------------|
| `POST /api/:appId/_diag/execute_handler`       | Proxy a single handler call to the preview backend via the in-process `dispatchRpc` (5s cap, 10 KB response cap) |
| `POST /api/:appId/_diag/query_db`              | Read-only SQL on the preview database, validated by `lib/sql-whitelist` (SELECT/PRAGMA only, 100-row cap) |
| `GET /api/:appId/_diag/sample_table?name=X&limit=N` | `SELECT * FROM <X> LIMIT N` after `safeIdentifier` sanitization     |
| `POST /api/:appId/_diag/inspect`               | Registered but **always `503 browser_unavailable`** — it relied on Cloudflare Browser Rendering, which has no self-host equivalent |

`PLATFORM_DIAGNOSTIC_SECRET` is not auto-generated on first run, so an operator
who never sets it has the whole probe surface closed (every request 401s).

See the runtime `CLAUDE.md` "Diagnostic Route — Surveyor Phase 2" section for the
full behavior and agent-side client.

---

## 7. Runtime Env

> Source: `worker/src/types/env.ts`, built by `worker/src/server/build-runtime-env.ts`

The worker's `Env` interface is typed against Cloudflare binding *shapes*
(`Fetcher`, `R2Bucket`, `SecretStoreSecret`). In the self-hosted runtime those
shapes are satisfied by `@exepad/local-adapters` and plain `process.env`
wrappers — there are no Cloudflare services involved. Key entries used across
the routes above:

| Entry                         | Shape                 | Backed by / purpose                                                     |
|-------------------------------|-----------------------|-------------------------------------------------------------------------|
| `ASSETS`                      | `Fetcher`             | Disk-backed fetcher over `client/dist` (SPA fallback to `index.html`); also reads example app JSON |
| `CONFIG_CACHE`                | `R2Bucket`            | `FsStorageAdapter` over `<EXEPAD_DATA_DIR>/storage` — app configs, deploy status, compiled modules, backend templates, published snapshots, captured images; keyed `{appId}/...` |
| `USER_WORKERS`                | `DispatchNamespace?`  | **Unbound in self-host.** Dispatch is in-process; the gateway only reads it as an "am I running under Workers-for-Platforms?" flag when no deployed config is found (`gateway/index.ts`) |
| `DEPLOY_SECRET`               | `SecretStoreSecret`   | Auth for deploy / deprovision / admin / cache-invalidation             |
| `USER_WORKER_SERVICE_TOKEN`   | `SecretBinding`       | `X-Service-Token` stamped on every dispatch to the app-backend; auto-generated in-process if unset |
| `PLATFORM_BRIDGE_SECRET`      | `SecretBinding`       | HMAC validation of bridge / preview-access tokens (defaults to `EXEPAD_SESSION_SECRET`) |
| `EXEPAD_ROUTER_SECRET`        | `SecretBinding`       | `x-exepad-secret` validation — production-only, inert in self-host      |
| `PLATFORM_DOMAINS`            | `string`              | Comma-separated hosts allowed to bypass the router-secret check         |
| `RESEND_API_KEY`, `PLATFORM_INTERNAL_SECRET` | secrets | Auth email transport (verification + password-reset sends)             |
| `PLATFORM_DIAGNOSTIC_SECRET`  | `SecretBinding`       | `X-Diagnostic-Secret` for Surveyor probes                              |
| `ENVIRONMENT`                 | `string`              | `selfhost` by default; `development` disables the rate limiter and a few auth checks |

The per-app backend `Env` is a separate object built per dispatch by
`worker/src/server/build-user-env.ts` (`DB`, `CONFIG_CACHE`, `R2_FILES`,
`RATE_LIMIT_KV`, `DEPLOY_MODE`, `APP_ID`, `APP_ALIAS`, `SERVICE_TOKEN`).
