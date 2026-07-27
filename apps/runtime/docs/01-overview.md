# 01 -- Overview

## What the Runtime Is

The Exepad runtime is the **frontend rendering engine** of the Exepad platform. It is a JSON-to-React rendering engine that takes `WebAppProps` JSON configurations and dynamically renders fully interactive React applications -- complete with pages, components, state management, theming, forms, tables, charts, and backend integration -- without hand-written React code.

The core pipeline works as follows: a JSON config is loaded by `ConfigService`, handed to `AppRenderer`, which delegates to `DynamicRenderer`. The renderer walks the page content tree and resolves each component type from the registry. The runtime component registry has only **one entry** (`CodeComponentProps`) — every page/component is a `CodeComponentProps` carrying agent-generated TSX that the `CodeComponent` runtime loads at runtime, renders in the **light DOM**, and styles with a per-app compiled Tailwind sheet scoped via `@layer exepad-app`. The shared `@exepad/sdk` package provides ~53 shadcn/ui primitives plus motion, background, map, and game kits to that TSX. There is no scaffold expansion, expression engine, declarative action system, or computed-value engine — code components handle their own logic via SDK hooks (`useApp`, `useAppState`, `useModel`, `useHandler`, `useNavigation`, `useTheme`, `useCurrentUser`, `useFileUpload`, etc.).

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Build Tool | Vite | ^6.x |
| Routing | React Router | ^7.x |
| UI Library | React + React DOM | ^18.3.1 |
| Language | TypeScript | ~5.9.3 |
| API Gateway | Hono on Node (`@hono/node-server`) | ^4.x |
| State Management | Zustand | ^5.0.8 |
| UI Primitives | Radix UI (25+ primitives) | Various (^1.x -- ^2.x) |
| CSS | Tailwind CSS | ^4.1.18 |
| CSS Utilities | tailwind-merge, class-variance-authority, clsx | ^3.4.0, ^0.7.1, ^2.1.1 |
| Forms | React Hook Form + @hookform/resolvers | ^7.69.0, ^5.2.2 |
| Validation | Zod | ^3.24.3 |
| Tables | TanStack React Table | ^8.21.3 |
| Virtualization | TanStack React Virtual | ^3.13.12 |
| Charts | Recharts | ^2.15.4 |
| Rich Text | Tiptap (react, starter-kit, link, placeholder) | ^2.1.13 |
| Animation | Framer Motion | ^12.23.26 |
| Maps | Leaflet + React Leaflet | ^1.9.4, ^5.0.0 |
| Markdown | react-markdown + remark-gfm + rehype-raw | ^10.1.0 |
| Date Handling | date-fns + date-fns-tz | ^4.1.0, ^3.2.0 |
| Drag-and-Drop | @dnd-kit (core, sortable, utilities) | ^6.3.1, ^10.0.0, ^3.2.2 |
| Media | react-player, react-youtube, react-pdf | ^3.2.0, ^10.1.0, ^10.0.1 |
| Calendar | react-big-calendar | ^1.19.4 |
| Icons | Lucide React, Heroicons | ^0.562.0, ^2.2.0 |
| Monitoring | Sentry (@sentry/react) | ^10.22.0 |
| HTTP Client | Axios | ^1.9.0 |
| Unit Testing | Vitest + @vitest/ui | ^4.0.4 |
| Component Testing | @testing-library/react + @testing-library/jest-dom | ^16.3.0, ^6.9.1 |
| E2E Testing | Playwright | ^1.58.0 |
| Server bundling | esbuild (`worker/build-server.mjs`) | ^0.27.x |
| Database | SQLite via better-sqlite3 (one file per app+mode) | ^11.8.1 |
| Deployment | One self-hosted Docker container (SPA served from disk) | -- |

## Source Layout

The runtime is split into two packages: a Vite-built React SPA (`client/`) and a Hono server that runs on bare Node (`worker/`). The name "worker" is historical — it is a plain Node process (`@hono/node-server`), not a Cloudflare Worker. It also imports `apps/app-backend` and dispatches each app's requests **in-process**.

### Client (`client/src/`)

```
expose-react.ts                Exposes React/ReactDOM on window (loaded from index.html before the app)

pages/                         React Router page components
  AppLayout.tsx                Main /a/:appId/* layout (config loading, providers)
  AppPage.tsx                  Published/preview page rendering
  DemoLayout.tsx               Demo mode layout
  ExampleLayout.tsx            Example mode layout
  HomePage.tsx                 Landing page

app_runtime/                   Core engine and type system
  interfaces/                  TypeScript type definitions
    apps/                      App config schemas (webapp.ts, core.ts, page.ts, transitions.ts)
    components/common/         Shared component types (core.ts, animation.ts)
    state/                     State types (initial-state schema)
    backend.ts                 Backend config union (StaticBackend | DynamicBackend | NoneBackend)
    data/                      Static dataset definitions
    code_components/           Code component type definitions
    repo.ts                    Custom code registry types
    offline.ts                 Offline configuration types (schema only — unimplemented)
    index.ts                   Barrel export
  runtime/                     Component implementations
    components/
      custom/code/             CodeComponent runtime — light-DOM mount, contrast boundary,
                               LinkInterceptor, dynamic-import URL allowlist (urlValidator.ts)
      ui/                      Toast primitives
    hooks/                     Runtime-specific data hooks
      useHandlerData.ts        Backend handler data
      useModelData.ts          Model-based CRUD data
      use-toast.ts             Toast notifications

components/                    App-level React components
  DynamicRenderer.tsx          Core rendering engine (JSON config -> React tree)
  AppRenderer.tsx              Top-level app orchestration
  ClientLayoutRenderer.tsx     App shell (header/footer/sidebar, toaster, window globals)
  ClientPageRenderer.tsx       Per-page render entry
  DynamicTheme.tsx             Theme management (CSS variable injection)
  DefaultThemeApplier.tsx      Fallback theme tokens
  DynamicFontLoader.tsx        Dynamic Google Fonts loading (CSS sanitized)
  FontVariables.tsx            Font CSS variable injection
  CodeFocusCssLoader.tsx       Loads the per-app compiled Tailwind sheet
  CodeFocusSidebarShell.tsx    Sidebar shell for generated app layouts
  ComponentErrorBoundary.tsx   Error boundary for individual components
  ExposeStateGlobal.tsx        Exposes state on window for the SDK bridge
  ExposePlatformGlobal.tsx     Exposes platform APIs on window for the SDK bridge
  HeadTagsRenderer.tsx         Renders config-declared head tags (CSS sanitized)
  HashScrollHandler.tsx        Hash-based scroll navigation
  HybridPageTransition.tsx     Page transition orchestration
  PageTransition.tsx           Page transition animations
  PageUuidTracker.tsx          Page UUID tracking for state
  PersistentHeader.tsx         Persistent header across pages
  PersistentFooter.tsx         Persistent footer across pages
  StaticHeaderLayout.tsx       Non-animated header layout
  DefaultLoginPage.tsx         Fallback login page when the app ships none
  ForbiddenPage.tsx            403 surface
  LogoutHandler.tsx            Logout route handling
  PlatformAuthControl.tsx      Operator auth control in the shell
  ToastEventListener.tsx       Toast event listener integration
  admin/                       In-app admin console
  settings/                    Settings panels (LLM, network, domains, …)
  studio/                      Builder/studio UI
  editable/                    In-app editing components
  ui/                          shadcn-style primitives for the shell

stores/                        Zustand state management
  appStore.ts                  Global app config, preview mode, WebSocket status
  appStateStore.ts             Runtime user state + persistence
  types/                       Store type definitions

services/                      Core services
  ConfigService.ts             Multi-source config loading + caching
  PersistenceService.ts        LocalStorage state persistence
  WebSocketManager.ts          Real-time WebSocket management
  StudioStream.ts              SSE stream from the agent into the builder UI
  AdminApi.ts                  Admin API client
  ErrorReportingService.ts     Error tracking via Sentry

hooks/                         Custom React hooks
  useAppStateHooks.ts          State access helpers
  useRuntimeStore.ts           Store init: datasets -> initial state, $auth, auth_me
  useCurrentPage.ts            Current page tracking
  useDocumentMeta.ts           Document title/meta updates
  useLifecycle.ts              Component lifecycle management
  useChromeTheme.ts            Browser theme-color sync
  useBrokenImageFallback.ts    Broken-image fallback handling
  useMobile.ts                 Mobile device detection
  index.ts                     Barrel export

utils/                         Utility functions
  LifecycleManager.ts          Component lifecycle orchestration
  componentComparison.ts       Component equality checks for memoization
  authAccess.ts                Client-side access-level evaluation
  fontUtils.ts                 Font loading and resolution utilities
  layoutPatterns.ts            Layout helpers and pattern matching

lib/                           Shared library code
  security/                    SecurityRuleSet + urlGuard (see 11-middleware-and-security.md
                               for their current wiring status)
  componentRegistry.ts         Component type resolution
  cssSanitizer.ts              Inline-CSS sanitization
  colors.ts / color-resolution.ts / tailwind-colors.ts   Palette resolution
  extensionRegistry.ts         External library URL mapping for code components
  extensionLoader.ts           Loads those external libraries
  platformAuth.ts              Platform (operator) auth client
  published-url.ts             Published/preview URL construction
  previewRetry.ts              Preview polling/retry logic
  imageDimensionGuard.ts       Image dimension guard
  fetchDedup.ts                Fetch request deduplication
  jwt-helper.ts                JWT token helpers
  editor-origin.ts             Editor postMessage origin checks
  logger.ts                    Logging utility
  utils.ts                     General utility functions (cn(), etc.)

context/                       React Context providers
  AppConfigContext.tsx          App configuration context
  AppContext.tsx                General app context
  ConfigUpdateContext.tsx       Configuration update context
  EditModeContext.tsx           Edit mode toggle context
  TransitionContext.tsx         Page transition context

registry/                      Component registry + lazy loading
  index.ts                     Single entry: CodeComponentProps

core/                          Core application infrastructure
  providers/PreviewProviders.tsx  Preview mode providers
  preview/PreviewPage.tsx         Preview page component
  RuntimeMode.ts                  Runtime mode detection (preview vs published)
```

### Worker (`worker/src/`)

```
index.ts                       Hono app entry (route mounting, middleware)

server/
  main.ts                      @hono/node-server entrypoint — listeners, TLS, data dir, shutdown
  build-runtime-env.ts         Builds the runtime Env from process.env + local adapters
  build-user-env.ts            Builds the per-app app-backend Env (the cast-at-boundary seam)
  materialize-build.ts         Agent artifacts -> compiled JS + storage (the deploy input)
  maintenance.ts               Background cron (dashboard thumbnails, stuck-app cleanup)
  screenshot-worker.ts         Isolated Chromium child used by the cron
  self-signed-cert.ts          Idempotent self-signed TLS pair minting
  standalone-backend.ts        Minimal /rpc + static server for exported standalone projects

routes/
  gateway/                     API gateway — auth, config, dispatch, dispatch-local, index, services, types, utils
  deploy.ts                    Per-app deploy pipeline (see ../../../docs/latest/10-deployment.md)
  deprovision.ts               App teardown + orphan GC
  orchestrate.ts               /api/orchestrate/* — prompt -> agent -> materialize -> deploy
  auth.ts                      Local operator auth (/auth/*) + signed platform session cookie
  diagnostic.ts                Read-only Surveyor probes (handler / SQL / sample_table; inspect returns 503)
  admin/                       Admin API (users, database, files, settings, source, export)
  settings.ts                  Operator settings (LLM provider/key/model, image keys)
  network.ts                   Server & networking settings
  domains.ts                   Self-serve custom domains
  publish.ts                   One-click "share live URL" control plane
  quick-access.ts              Optional Cloudflare quick tunnel over the login-gated studio
  email.ts                     Auth email transport (Resend proxy; verification + password-reset only)

lib/
  meta-injector.ts             SSR-style meta tag injection into SPA shell
  security-headers.ts          CSP (env-aware) + nonce, nosniff, Referrer-Policy, opt-in HSTS
  origin.ts                    Credentialed-CORS / CSRF origin allowlist
  net-config.ts                Effective networking config (settings store over env)
  rate-limit.ts                In-memory sliding-window limiter (real-client-IP keyed)
  meta-db.ts                   Platform registry (meta.sqlite: users, apps, deployments, settings)
  custom-domains.ts            Host -> app resolution, on-demand-TLS authorization, HSTS opt-in
  runtime-assets.ts            Static-asset classification + cache headers
  sql-whitelist.ts             SELECT/PRAGMA AST allow-list for the diagnostic probes
  r2-helpers.ts                Helpers over the R2-shaped local filesystem adapter
  admin-auth.ts                Admin route authentication
  secrets.ts                   SecretBinding resolution (env-backed)
  export/                      Standalone / deployable / handover export builders

types/
  env.ts                       Runtime Env — Cloudflare-binding-shaped surfaces satisfied by local adapters
```

## Path Aliases

All path aliases are defined in `client/tsconfig.json` (or `client/vite.config.ts`):

| Alias | Maps To | Purpose |
|-------|---------|---------|
| `@/*` | `client/src/*` | General source root |
| `@/components/*` | `client/src/components/*` | App-level React components |
| `@/app_runtime/*` | `client/src/app_runtime/*` | Core engine and type system |
| `@/interfaces/*` | `client/src/app_runtime/interfaces/*` | Type definitions (alias 1) |
| `@/types/*` | `client/src/app_runtime/interfaces/*` | Type definitions (alias 2) |
| `@/runtime/*` | `client/src/app_runtime/runtime/*` | Component implementations and hooks |
| `@/services/*` | `client/src/services/*` | Core services (config loading, WebSocket, admin API, …) |
| `@/stores/*` | `client/src/stores/*` | Zustand stores |
| `@/hooks/*` | `client/src/hooks/*` | Custom React hooks |
| `@/utils/*` | `client/src/utils/*` | Utility functions |
| `@/lib/*` | `client/src/lib/*` | Shared library (security, colors, platform auth, utilities) |
| `@/core/*` | `client/src/core/*` | Runtime-mode detection, preview providers |
| `@/context/*` | `client/src/context/*` | React Context providers |
| `@/registry/*` | `client/src/registry/*` | Component registry |
| `@/schemas/*` | `client/src/app_runtime/schemas/*` | Declared, but the target directory no longer exists |

Notes: `@/types/*` and `@/interfaces/*` both resolve to the same directory
(`client/src/app_runtime/interfaces/*`). `@/schemas/*` is a leftover from the
JSON-schema era — the alias is still declared in both `tsconfig.json` and
`vite.config.ts`, but `client/src/app_runtime/schemas/` was removed, so nothing
imports through it.

## Workspace Dependencies

Declared as `workspace:*` across `client/package.json` and `worker/package.json`:

| Package | Used by | Purpose |
|---------|---------|---------|
| `@exepad/types` | client + worker | Shared backend/config type definitions (`ModelProps`, `HandlerProps`, `SecurityProps`, `InjectedProps`, `StorageProps`, …). Exports `.` and `./config`. The root `WebAppProps` schema itself lives in `client/src/app_runtime/interfaces/apps/webapp.ts`. |
| `@exepad/ui-core` | client | Shared Tailwind configuration and global styles. Exports `tailwind.css` and `globals.css`. |
| `@exepad/deploy-utils` | worker | Deploy pipeline: TSX→JS bundling (esbuild), schema snapshot/diff/migrations, FK-ordered seeding, and local SQLite execution. |
| `@exepad/local-adapters` | worker | SQLite / filesystem / in-memory-cache shims behind Cloudflare-binding-shaped interfaces. |
| `@exepad/app-backend` | worker | Imported directly and dispatched in-process by the gateway. |

Two further workspace packages are not direct dependencies of the runtime:

| Package | Purpose |
|---------|---------|
| `@exepad/sdk` | Browser SDK (Vite-built) that outputs to `client/public/runtime_assets/dist/`. Loaded via an import map for code component support. |
| `@exepad/schemas` | JSON Schema validation package using Ajv. Generates schemas from the `WebAppProps` definition and validates example configs. Used via the root `pnpm validate:examples`. |

## Commands

All commands are run from the `apps/runtime` directory using `pnpm`.

### Development

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start the SPA + the runtime worker concurrently |
| `pnpm dev:client` | SPA dev server only (Vite, port 3001) |
| `pnpm dev:worker` | Runtime worker only (`tsx watch src/server/main.ts`) |
| `pnpm clean` | Remove `client/dist`, `worker/dist`, `.wrangler` |

The worker binds plain HTTP on **8080** and, when it can mint a self-signed
certificate, HTTPS on **8443** — in which case the HTTP listener is
loopback-only and Vite proxies `/api`, `/auth`, and `/published` to
`https://localhost:8443`.

### Build

| Command | Description |
|---------|-------------|
| `pnpm build:client` | Build SPA (`tsc -b && vite build`) |
| `pnpm build:worker` | Bundle the Node server with esbuild (`worker/dist/*.mjs`) |
| `pnpm check` | TypeScript type checking (client + worker) |

### Testing

| Command | Description |
|---------|-------------|
| `pnpm test` | Run all Vitest tests (`vitest run`) |
| `pnpm test:publish` | Run only the publish server tests |

### Code Generation

| Command | Description |
|---------|-------------|
| `pnpm compile:examples` | Compile the full-app example TSX (`scripts/compile-full-apps.ts`) |
| `pnpm generate:catalog` | Regenerate the full schema catalog |

`pnpm validate:examples` (config validation via `@exepad/schemas`) is a **root**
script, not a runtime one.

### Running the Platform

There is no per-package deploy command — the runtime ships inside the
single self-hosted container. See [13-deployment.md](./13-deployment.md) for
`docker compose up --build`, the `./run.sh local` from-source wrapper, and the
`/data` layout.

## Key Files

### Client

| File | Purpose |
|------|---------|
| `client/src/app_runtime/interfaces/apps/webapp.ts` | Root `WebAppProps` schema -- the top-level type definition for all app configurations |
| `client/src/components/DynamicRenderer.tsx` | Core rendering engine that resolves each page's component type from the registry and mounts the Code Focus component |
| `client/src/stores/appStateStore.ts` | Runtime state store -- shared state get/set, array helpers, `$persist` localStorage persistence |
| `client/src/stores/appStore.ts` | Global app config store -- holds app configuration, preview mode flag, and WebSocket status |
| `client/src/components/AppRenderer.tsx` | Top-level app orchestration -- bridges config loading with rendering |
| `client/src/services/ConfigService.ts` | Multi-source config loading -- resolves configs from the API, public directory, static files, demo mode, and example catalog |
| `client/src/registry/index.ts` | Component type resolution and lazy loading -- a single entry, `CodeComponentProps` |
| `client/src/lib/extensionRegistry.ts` | External library CDN URL mapping for code components |
| `client/src/components/DynamicTheme.tsx` | Theme management -- injects CSS variables for colors, fonts, spacing from JSON config |
| `client/src/core/providers/PreviewProviders.tsx` | Preview-mode provider composition |
| `client/src/app_runtime/interfaces/backend.ts` | `BackendProps` discriminated union (`StaticBackend \| DynamicBackend \| NoneBackend`) with type guards |
| `client/src/pages/AppLayout.tsx` | Main `/a/:appId/*` layout -- loads config, sets up providers, renders pages |

### Worker

| File | Purpose |
|------|---------|
| `worker/src/index.ts` | Hono app entry -- mounts all routes and middleware; also exports `rewriteFriendlySlug` |
| `worker/src/server/main.ts` | `@hono/node-server` entrypoint -- HTTP/HTTPS listeners, data dir, admin seed, maintenance cron, graceful shutdown |
| `worker/src/server/build-runtime-env.ts` | Builds the runtime `Env` from `process.env` + the local adapters |
| `worker/src/server/build-user-env.ts` | Builds the per-app app-backend `Env` (SQLite + FS adapters); the one cast-at-boundary seam |
| `worker/src/routes/gateway/` | API gateway -- loads app config from storage, dispatches to the in-process app-backend, forwards auth headers (`auth`, `config`, `dispatch`, `dispatch-local`, `index`, `services`, `types`, `utils`) |
| `worker/src/routes/deploy.ts` | Per-app deploy pipeline -- SQLite provisioning, migrations, seeding, module write. Canonical reference: [docs/latest/10-deployment.md](../../../docs/latest/10-deployment.md) |
| `worker/src/lib/meta-injector.ts` | SSR-style meta tag injection -- reads app config from storage and injects OG/title/description tags into the SPA shell |
| `worker/src/lib/security-headers.ts` | Security header middleware -- CSP + nonce, nosniff, Referrer-Policy, Permissions-Policy, opt-in HSTS |
| `worker/src/lib/origin.ts` | Credentialed-CORS / CSRF origin allowlist |
| `worker/src/lib/rate-limit.ts` | Sliding-window rate limiter keyed on the real client IP |
