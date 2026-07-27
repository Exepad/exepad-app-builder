# Exepad Runtime Documentation

The runtime is a JSON-to-React rendering engine built on Vite 6 + React Router 7 (SPA) and Hono on Node via `@hono/node-server` (API gateway). It takes `WebAppProps` JSON configurations and renders fully interactive React applications -- pages, components, state management, theming, and backend integration -- without hand-written React code. Both halves ship inside one self-hosted Docker container; the per-app backend (`apps/app-backend`) is imported and dispatched **in-process** by the same Node server.

## Documentation Index

| # | Document | Description |
|---|----------|-------------|
| 01 | [Overview](./01-overview.md) | Tech stack, source layout, path aliases, commands, and key files |
| 02 | [Rendering Pipeline](./02-rendering-pipeline.md) | How `DynamicRenderer` recursively builds the React component tree from JSON |
| 03 | [State Management](./03-state-management.md) | Zustand stores, SDK hooks, state persistence |
| 06 | [Configuration Loading](./06-configuration-loading.md) | `ConfigService`, config caching, multi-source resolution, runtime services |
| 07 | [Theming and Styling](./07-theming-and-styling.md) | `DynamicTheme`, CSS variable injection, style pipeline, auto-contrast |
| 08 | [Backend Modes](./08-backend-modes.md) | Static vs Dynamic vs None backend, `BackendProps` union, data references, datasets |
| 09 | [API Routes](./09-api-routes.md) | API gateway, RPC proxy, deploy endpoint |
| 11 | [Middleware and Security](./11-middleware-and-security.md) | Worker middleware pipeline, security headers, CSP, CORS, rate limiting, URL guards, auth flow |
| 12 | [Testing](./12-testing.md) | Vitest unit/integration tests, Playwright E2E, test setup, and patterns |
| 13 | [Deployment](./13-deployment.md) | Vite/Node build pipeline, the single self-hosted container, `/data` layout, per-app deploy pipeline |

Additional references:

- [latest/auth-pipeline.md](./latest/auth-pipeline.md) — Frontend auth preprocessing pipeline
- [webapp-props-review.md](./webapp-props-review.md) — Field-by-field audit of `WebAppProps`

Numbers 04 (Component System) and 05 (Scaffold System) are intentionally absent — the component registry is now described inline in `01-overview.md` / `02-rendering-pipeline.md`, and the scaffold expansion pipeline has been removed from the runtime (components are generated directly by the agent as Code Focus TSX).

## Quick Links

### Getting Started Locally

```bash
# From the monorepo root
pnpm install
pnpm dev:runtime        # Starts the SPA + the runtime worker concurrently (Turbo)
```

Or from the runtime directory directly:

```bash
cd apps/runtime
pnpm dev                # SPA + worker concurrently
pnpm dev:client         # SPA dev server only (Vite, port 3001)
pnpm dev:worker         # Runtime worker only (tsx watch src/server/main.ts)
```

Ports: the Vite dev server is on **3001**. The worker binds plain HTTP on
**8080** and, when it can mint a self-signed certificate, HTTPS on **8443** —
in which case the HTTP listener is loopback-only and Vite proxies `/api`,
`/auth`, and `/published` to `https://localhost:8443`. In the shipped container
the Node server listens on **8080** behind the in-image Caddy (80/443). The
`./run.sh local` wrapper at the repo root runs the same stack from source with
the Node runtime on **8090** and the Python agent on **8081**.

### Key Source Files

| File | Purpose |
|------|---------|
| `client/src/app_runtime/interfaces/apps/webapp.ts` | Root `WebAppProps` schema definition |
| `client/src/components/DynamicRenderer.tsx` | Core rendering engine (JSON config to React) |
| `client/src/stores/appStateStore.ts` | Shared runtime state (get/set, array helpers, `$persist`) |
| `client/src/components/AppRenderer.tsx` | Top-level app orchestration |
| `client/src/services/ConfigService.ts` | Multi-source config loading and caching |
| `client/src/registry/` | Component type resolution + lazy loading (a single entry: `CodeComponentProps`) |
| `packages/exepad-sdk/src/platform/useApp.ts` | SDK state bridge for code components |
| `worker/src/index.ts` | Hono app entry (route mounting, middleware) |
| `worker/src/server/main.ts` | `@hono/node-server` entrypoint — listeners, data dir, graceful shutdown |
| `worker/src/routes/gateway/` | API gateway directory (in-process dispatch, auth, config) |
| `worker/src/routes/deploy.ts` | Per-app deploy pipeline (see [docs/latest/10-deployment.md](../../../docs/latest/10-deployment.md)) |
| `worker/src/lib/meta-injector.ts` | SSR-style meta tag injection into SPA shell |

### Running Tests

```bash
pnpm test               # All Vitest tests (unit + integration)
pnpm check              # TypeScript type checking (client + worker)
```
