# CLAUDE.md — Exepad Runtime (`apps/runtime`)

> See also: [root CLAUDE.md](../../CLAUDE.md) for monorepo overview, backend details, and shared conventions.

## What This App Does

The runtime is the **frontend rendering engine** of the Exepad platform. It takes JSON app configurations and dynamically renders fully interactive React applications — pages, components, state, theming, and backend integration — using code components rendered in the light DOM with CSS scoped via `@layer exepad-app`.

The runtime is split into two packages:
- **`client/`** — Vite + React SPA that renders apps in the browser (also hosts the builder UI)
- **`worker/`** — Hono on Node (`@hono/node-server`) that serves the SPA, the API gateway, deploy, auth, and build orchestration. The per-app app-backend is imported and dispatched **in-process** (no Workers-for-Platforms).

## Commands

```bash
# Development (from apps/runtime)
pnpm dev                     # SPA (Vite :3001) + runtime worker (tsx watch)
pnpm dev:client              # SPA dev server only (Vite, port 3001)
pnpm dev:worker              # Runtime worker only (tsx watch src/server/main.ts)

# Build
pnpm build:client            # Build the SPA (tsc -b && vite build)
pnpm build:worker            # Bundle the Node server → worker/dist/server.mjs
pnpm --filter @exepad/runtime-worker start   # Run the bundled server (node dist/server.mjs)

# Testing
pnpm test                    # Vitest — all unit + integration tests
pnpm check                   # TypeScript type checking (client + worker)

# Code Generation
pnpm compile:examples        # Compile the full-app example TSX (scripts/compile-full-apps.ts)
pnpm generate:catalog        # Regenerate the full schema catalog
```

Dev ports: the worker binds plain HTTP on `:8080` and, when it can mint a
self-signed cert, HTTPS on `:8443` (`worker/src/server/main.ts` +
`lib/net-config.ts`). When HTTPS is up the HTTP listener is loopback-only, so
the Vite dev server proxies `/api`, `/auth`, and `/published` to
`https://localhost:8443` with `secure: false` (`client/vite.config.ts`).
`pnpm validate:examples` lives in the **root** `package.json` (it delegates to
`@exepad/schemas`), not in this package.

> The worker is the self-hosted Node server (`@hono/node-server`); the
> app-backend is imported and dispatched **in-process** (no Workers-for-Platforms,
> no wrangler). The whole stack ships as one container — see the root
> [README.md](../../README.md).

## Tech Stack

- **SPA Framework:** Vite 6, React 18, React Router 7
- **State:** Zustand 5 — two stores: `appStore` (config), `appStateStore` (runtime state)
- **UI:** Radix UI primitives + Tailwind CSS v4 (shadcn/ui pattern)
- **API Gateway:** Hono 4 on Node (`@hono/node-server`)
- **Testing:** Vitest 4 (happy-dom) + Playwright 1.58
- **Deployment:** single self-hosted Docker container (SPA served from disk)

## Source Layout

### Client (`client/src/`)

```
pages/                 React Router page components
  AppLayout.tsx        Main /a/:appId/* layout (config loading, providers)
  AppPage.tsx          Published/preview page rendering
  DemoLayout.tsx       Demo mode layout
  ExampleLayout.tsx    Example mode layout
  HomePage.tsx         Landing page

app_runtime/           Core engine and type system
  interfaces/          Type definitions (15 files)
  runtime/             CodeComponent runtime + data hooks

components/            App-level React components
  DynamicRenderer.tsx  Core rendering engine (JSON config → React)
  AppRenderer.tsx      App orchestration
  ClientLayoutRenderer.tsx  App shell (header/footer/sidebar, toaster, globals)
  DynamicTheme.tsx     Theme management (CSS variables)
  CodeFocusCssLoader.tsx    Loads the per-app compiled Tailwind sheet
  admin/ settings/ studio/  Operator console, settings panels, builder UI
  editable/            In-app editing components

stores/                Zustand state management
  appStore.ts          Global app config, preview mode, WebSocket status
  appStateStore.ts     Shared runtime state with $persist support

services/              Core services
  ConfigService.ts     Multi-source config loading + caching
  PersistenceService.ts     Preview-mode config write-back
  WebSocketManager.ts  Real-time WebSocket management
  StudioStream.ts      SSE stream from the agent into the builder UI
  AdminApi.ts          Admin API client

hooks/                 Custom React hooks
  useRuntimeStore.ts   Store init: static datasets → initial state, $auth namespace, auth_me
context/               React Context providers
lib/                   Shared utilities (CSS sanitizer, colors, component registry, platform auth, …)
registry/              Component registry — a single entry: CodeComponentProps
```

### Worker (`worker/src/`)

```
index.ts               Hono app entry (route mounting, middleware)
server/
  main.ts              @hono/node-server entrypoint (the bundled server.mjs)
  build-runtime-env.ts Builds the runtime Env from process.env + local adapters
  build-user-env.ts    Builds the per-app app-backend Env (cast-at-boundary)
  materialize-build.ts Agent artifacts → compiled JS + storage (the deploy input)
routes/
  gateway/             API gateway (in-process dispatch, auth) — auth, config, dispatch, dispatch-local, index, services
  deploy.ts            Deploy pipeline (local SQLite + FS storage; see docs/latest/10-deployment.md)
  deprovision.ts       Tear down an app's database + storage
  orchestrate.ts       /api/orchestrate/* — prompt → build → deploy (replaces the Django backend)
  auth.ts              Local operator auth (/auth/*) + signed platform session cookie
  diagnostic.ts        Surveyor Phase 2 — /api/{appId}/_diag/{execute_handler,query_db,sample_table,inspect(503 self-host)}
  admin/               Admin API (users, database, files, settings, source, export)
  settings.ts          Operator settings (LLM provider/key/model, image keys)
  network.ts           Server & networking settings (ports, public address, CORS allowlist)
  domains.ts           Self-serve custom domains (register / verify / remove)
  publish.ts           One-click "share live URL" control plane
  quick-access.ts      Cloudflare quick tunnel over the login-gated studio (optional)
  email.ts             Auth-internal email transport (Resend proxy: verification + password-reset only)
lib/
  meta-injector.ts     SSR-style meta tag injection into SPA shell
  security-headers.ts  CSP (env-aware), nosniff, Referrer-Policy, Permissions-Policy, opt-in HSTS
  rate-limit.ts        In-memory sliding-window limiter keyed on the real client IP
  origin.ts            Credentialed-CORS / CSRF origin allowlist
  net-config.ts        Effective networking config (settings store overrides env)
  runtime-assets.ts    Static-asset path classification + cache headers for the SPA bundle
  meta-db.ts           Platform metadata store (meta.sqlite: users/apps/deployments/settings)
  password.ts          PBKDF2 password hashing for operator accounts
  r2-helpers.ts        Storage helpers over the R2-shaped local FS adapter
  admin-auth.ts        Admin route authentication
  sql-whitelist.ts     SELECT/PRAGMA whitelist parser for diagnostic.ts (node-sql-parser AST + identifier sanitization)
types/
  env.ts               Runtime bindings type definitions (CF-binding-shaped surfaces, satisfied by local adapters)
```

## Path Aliases (client)

```
@/*             → client/src/*
@/components/*  → client/src/components/*
@/app_runtime/* → client/src/app_runtime/*
@/interfaces/*  → client/src/app_runtime/interfaces/*
@/types/*       → client/src/app_runtime/interfaces/*
@/runtime/*     → client/src/app_runtime/runtime/*
@/services/*    → client/src/services/*
@/stores/*      → client/src/stores/*
@/hooks/*       → client/src/hooks/*
@/utils/*       → client/src/utils/*
@/lib/*         → client/src/lib/*
@/core/*        → client/src/core/*
@/context/*     → client/src/context/*
@/registry/*    → client/src/registry/*
@/schemas/*     → client/src/app_runtime/schemas/*   (declared, but the dir no longer exists)
```

## Key Architectural Patterns

### Rendering Pipeline
`JSON config` → `ConfigService` (load/cache) → `AppRenderer` → `DynamicRenderer` → Code Components (Light DOM)

All components are "Code Focus" TSX components loaded via dynamic `import()` and rendered in the light DOM with compiled Tailwind CSS scoped via `@layer exepad-app`.

### State Management
Zustand store for shared state across code components:
- `frontend.logic.state` defines initial state with optional `$persist` support
- `appStateStore.ts` handles state get/set, array helpers, and localStorage persistence
- Code components access state via SDK hooks: `useApp()`, `useAppState()`, `useArrayState()`
- No expression engine, no declarative actions — components handle logic directly in JS/TSX

### API Gateway (Worker)
The Hono worker at `worker/src/routes/gateway/` handles API requests:
- Loads app config from storage (`CONFIG_CACHE`, an `FsStorageAdapter`)
- Resolves routes to backend models/handlers
- Dispatches to the app-backend **in-process** (`routes/gateway/dispatch-local.ts`)
- Forwards auth headers

### Diagnostic Route — Surveyor Phase 2
`worker/src/routes/diagnostic.ts` exposes 4 read-only probe endpoints under `/api/{appId}/_diag/*` (mounted **before** the catch-all gateway in `index.ts`). Auth is a dedicated `X-Diagnostic-Secret` header (classic worker secret, distinct from `PLATFORM_BRIDGE_SECRET`) so it can be rotated quarterly. Per-app rate-limited at 30 req/min. Every request writes a `diagnostic_audit` log line via the structured logger:

- **`POST /_diag/execute_handler`** — proxies a single handler call via the in-process `dispatchRpc()`. Validates the handler exists in the deployed config; defaults `X-User-Id` to `_exepad_diagnostic_` so handler row-level filters return [] for the real owner unless the caller passes `as_user`. 5s wall-clock cap, 10KB response cap.
- **`POST /_diag/query_db`** — read-only SQL on the preview database (via `executeD1Query` from `@exepad/deploy-utils`, backed by local SQLite). The trust boundary is `lib/sql-whitelist.ts` — `node-sql-parser` AST validation + multi-statement detector + `SELECT`/`PRAGMA(table_info|foreign_key_list)` allow-list. Anything else (INSERT/UPDATE/DELETE/DDL/ATTACH, comment-hidden trailing statements) returns 400 with a structured `reason`. 100-row hard cap.
- **`GET /_diag/sample_table?name=X&limit=N`** — convenience wrapper compiling to `SELECT * FROM <X> LIMIT N` after `safeIdentifier()` sanitization (rejects anything outside `[A-Za-z_][A-Za-z0-9_]*`).
- **`POST /_diag/inspect`** — screenshot/DOM inspection relied on Cloudflare Browser Rendering, which has no self-host equivalent; the probe is registered but returns 503 `browser_unavailable`.

The agent side lives at `apps/agent/main_agent/services/runtime_probe_client.py` and is gated by the `SURVEYOR_RUNTIME_PROBES_ENABLED` flag in the agent's `config.py`.

### Meta Tag Injection
Since the SPA is a single `index.html`, the worker intercepts non-asset requests and injects `<meta>` tags (title, description, OG image) by reading app config from storage before serving the HTML. This provides SEO equivalence to the old Next.js SSR.

### MCP Passthrough
The API gateway handles `POST /mcp` by forwarding the raw request to the app-backend's `/mcp` endpoint in-process (`fetchAppBackendInProcess`). No auth is added by the gateway; MCP auth tokens pass through unchanged.

## Workspace Dependencies

- `@exepad/types` — shared backend/config type definitions (`ModelProps`, `HandlerProps`, `SecurityProps`, `InjectedProps`, …). The root `WebAppProps` schema itself lives in `client/src/app_runtime/interfaces/apps/webapp.ts`.
- `@exepad/ui-core` — shared Tailwind CSS config (client)
- `@exepad/deploy-utils` — deploy pipeline: TSX→JS bundling (esbuild), schema diff/migrations, seeding, local SQLite execution (worker)
- `@exepad/local-adapters` — SQLite / filesystem / in-memory shims behind Cloudflare-binding-shaped interfaces (worker)
- `@exepad/app-backend` — imported directly and dispatched in-process by the gateway (worker)

## Example Apps

Example configs live under `client/public/example/examples_for_agents/`:

- `backend/` — eight backend-only config fixtures (booking, CRM, e-commerce, …)
- `frontend/blocks_codecomponent/` — Code Focus block examples
- `full_apps/` — full app examples (compiled with `pnpm compile:examples`)
- `html_imported/`, `index/` — imported-design and catalog fixtures

They serve as feature showcases, agent-facing documentation by example, and
validation targets (`pnpm validate:examples` from the repo root).
