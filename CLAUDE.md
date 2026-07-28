# CLAUDE.md — Exepad Platform v1

## Project Overview

Exepad is a **full-stack, low-code application platform** that renders dynamic web apps as fully interactive React applications, packaged as a **single self-hostable Docker container** (bare Node + local adapters; no Cloudflare or external services beyond the LLM API). The agent emits **Code Focus TSX components** (the primary build mode) that the runtime renders in the light DOM, while JSON config defines app structure (pages, routing), shared state, backend models, and theming.

**Core concept:** Code Focus TSX components + JSON config (structure/state/backend/theme) → Dynamic React rendering + Auto-CRUD backend

## Monorepo Structure

```
apps/
  runtime/
    client/       → Vite + React SPA (port 3001 dev) — SPA + builder UI; renders code components
    worker/       → Hono on Node (@hono/node-server, :8080) — SPA + API gateway, deploy, auth, orchestration
  app-backend/    → auto-CRUD + handler backend, dispatched IN-PROCESS by the runtime worker
  agent/          → Python ADK/FastAPI app builder (internal :8081)

packages/
  types/          → Shared TypeScript type definitions
  schemas/        → JSON schema validation (Ajv)
  ui-core/        → Shared Tailwind CSS styles
  exepad-sdk/     → Browser SDK (Vite-built, outputs to runtime/client/public/)
  exepad-cli/     → Operator CLI (npm name `exepad`): docker|podman-neutral
                    up/status/stop/start/restart/down/update/backup/restore/logs/doctor
  deploy-utils/   → Deploy pipeline + TSX→JS bundling (esbuild) + local SQLite execution
  local-adapters/ → Cloudflare-binding shims over local infra (SQLite, filesystem, in-memory)
```

## Tech Stack

| Layer          | Technology                                              |
|----------------|---------------------------------------------------------|
| Frontend       | Vite 6, React 18, React Router 7, Tailwind CSS v4, Zustand |
| UI Components  | Radix UI + shadcn/ui pattern                            |
| API Gateway    | Hono on Node (@hono/node-server)                        |
| Backend        | In-process app-backend, SQLite (better-sqlite3), RPC-based API |
| Build          | pnpm 9.15, Turborepo, TypeScript 5.9 (strict)          |
| Testing        | Vitest (unit/integration), Playwright (E2E)             |
| Deployment     | Single self-hosted Docker container (Node + Python)     |

## Key Commands

```bash
# Development
pnpm dev                    # Runtime SPA (Vite) + runtime worker (tsx watch) via Turbo
pnpm dev:runtime            # Same, scoped to the runtime packages

# Building
pnpm build                  # Build all packages (incl. the bundled Node server)
pnpm build:sdk              # SDK only → runtime/client/public/runtime_assets/dist/

# Testing
pnpm test                   # All tests (Vitest)
pnpm --filter @exepad/runtime test  # Runtime unit tests (suites live in apps/runtime/tests)

# Schemas
pnpm gen:schemas:full       # Regenerate full_schema.json from WebAppProps

# Self-hosted container (the shipped product)
docker compose up --build   # Build + run the single container on :8080
```

> Self-host note: the app-backend runs **in-process** inside the runtime Node
> server (no standalone `wrangler dev`); the Python agent runs on internal :8081.
> See [README.md](README.md) for the container quickstart.

## Path Aliases (runtime client)

```
@/*             → client/src/*
@/components/*  → client/src/components/*
@/app_runtime/* → client/src/app_runtime/*
@/interfaces/*  → client/src/app_runtime/interfaces/*
```

## Architecture — Key Directories

### Runtime Client (`apps/runtime/client/src/`)

- **`pages/`** — React Router page components (AppLayout, AppPage, DemoPage, ExamplePage)
- **`app_runtime/`** — Core engine
  - `interfaces/` — Type definitions (apps, components, state, backend, data)
  - `runtime/` — Code Component runtime (`components/custom/code/`), toast UI primitives, and the backend data hooks (`useModelData`, `useHandlerData`)
- **`components/`** — React components (renderers, theme, layout, UI primitives)
- **`hooks/`** — Custom hooks (state, styling, lifecycle)
- **`stores/`** — Zustand stores (appStore, appStateStore)
- **`services/`** — Core services (`ConfigService`, `PersistenceService`, `WebSocketManager`, `StudioStream`, `AdminApi`, `ErrorReportingService`)

### Runtime Worker (`apps/runtime/worker/src/`)

- **`routes/gateway/`** — API gateway (dispatches to the in-process app-backend)
- **`routes/deploy.ts`** — Deploy pipeline (local SQLite provision, migrations, module write)
- **`routes/orchestrate.ts`** — `/api/orchestrate/*` build orchestration (prompt → agent → materialize → deploy)
- **`routes/auth.ts`** — Local operator auth (`/auth/*`) + signed platform session cookie
- **`routes/admin/`** — Admin API (users, database, files)
- **`routes/email.ts`** — Auth-internal email transport (Resend proxy for email-verification + password-reset only; not a user-facing service)
- **`routes/settings.ts`, `routes/network.ts`, `routes/domains.ts`, `routes/publish.ts`, `routes/quick-access.ts`** — Operator settings (LLM provider/key), networking, self-serve custom domains, publish control plane, optional Cloudflare quick tunnel
- **`routes/diagnostic.ts`, `routes/deprovision.ts`** — Read-only `/api/{appId}/_diag/*` probes; app teardown
- **`lib/`** — Shared utils (meta injector, security headers, origin/CORS allowlist, rate limiting, `meta.sqlite` store, secrets, storage helpers)

### App Backend (`apps/app-backend/src/`)

- **`crud/`** — Auto-CRUD handlers (create, read, list, update, delete)
- **`rpc/`** — RPC request routing and parsing
- **`handlers/`** — Custom handler execution
- **`tools/`** — Tool discovery and execution layer (maps config to tool definitions)
- **`mcp/`** — MCP Streamable HTTP endpoint (types, transport, handler, gateway-auth)
- **`context/`** — User context and config parsing
- **`types/`** — Env, RpcRequest, UserContext types

## State Management

Zustand stores:
- **appStore** — Global app config and metadata
- **appStateStore** — Shared runtime state with `$persist` support

Code components manage their own logic via SDK hooks (`useModel`, `useHandler`, `useApp`, `navigate`, `toast`, `useCurrentUser`). The `frontend.logic` config only defines initial `state` — no actions, computed, or expression engine.

## Backend API Pattern

RPC-based CRUD over HTTP POST. `model` is a **top-level** field alongside
`method` — not nested inside `params` (see `apps/app-backend/src/rpc/router.ts`;
a CRUD call without a top-level `model` is rejected with `InvalidRequestError`):
```json
POST /rpc
{
  "method": "sys_create|sys_read|sys_list|sys_update|sys_delete",
  "model": "table_name",
  "params": { "data": {...} }
}
```

Authentication flows through headers: `X-User-Id`, `X-User-Email`, `X-User-Roles`. Data is scoped per user via `owner_id`.

The worker also exposes `POST /mcp` (Streamable HTTP, JSON-RPC 2.0) when `mcp.enabled` is true in `InjectedConfig`. This lets AI agents discover and call CRUD/handler tools via the Model Context Protocol. Auth: `Bearer exepad_sk_*` (API key) or gateway JWT. The `/mcp` route is intercepted before service token verification — see `src/index.ts`.

## Component System

Components are rendered dynamically via `DynamicRenderer.tsx`. The agent-emitted **Code Focus TSX** components are loaded via dynamic `import()` and rendered in the light DOM. The legacy JSON-component registry was removed; `client/src/registry/index.ts` now holds a single entry: `CodeComponentProps`.

### Code Focus Build Mode

Code Focus is the **primary build mode**: the agent generates TSX code components that render in the light DOM with compiled Tailwind CSS scoped via `@layer exepad-app`. Validation runs inline at component save (esbuild + tsc + AST rules + deterministic auto-fixers) plus a single end-of-workflow Tailwind compile gate. See the validator/auto-fixer catalogue in `apps/agent/docs/validation/rules.md`.

## Configuration Schema

Example app configs live in `apps/runtime/client/public/example/examples_for_agents/` as JSON files. The root type is `WebAppProps` (defined in `apps/runtime/client/src/app_runtime/interfaces/apps/webapp.ts`; `packages/schemas`'s `generate` script reads it from that path). Configs define:
- Pages and routing
- Shared state definitions (`frontend.logic.state`)
- Backend models and CRUD config
- Theme and styling

Page content is rendered from Code Focus TSX components (see Component System); JSON config handles structure, state, backend, and theme rather than authoring full component trees.

## Deployment

Single self-hostable Docker image (see [README.md](README.md) and [Dockerfile](Dockerfile)):

- **Runtime:** Hono on `@hono/node-server` (:8080) — serves the SPA from disk + the API gateway
- **Backend:** app-backend imported and dispatched in-process; one SQLite file per app+mode
- **Agent:** Python ADK/FastAPI on internal :8081, reverse-proxied at `/agent/*`
- **Storage:** filesystem under the `/data` volume (configs, compiled output, snapshots, uploads)
- **Secrets:** generated + persisted under `/data/secrets` on first run

## Code Conventions

- TypeScript strict mode everywhere
- PascalCase for React components, camelCase for functions/variables
- Component props suffixed with "Props"
- Radix UI as unstyled base + Tailwind for styling (shadcn/ui pattern)
- Zod for runtime validation, TypeScript for compile-time safety
- Workspace dependencies use `workspace:*` protocol

## Documentation

- Platform-wide docs: `docs/README.md` (index) → `docs/latest/` (current architecture).
- Install/operate: `INSTALL.md` → `docs/install/`. Release process: `RELEASING.md`.
- Per-app: `apps/agent/CLAUDE.md`, `apps/runtime/CLAUDE.md`, `apps/app-backend/docs/latest/`.
- Agent-facing prompt docs (consumed by the agent at runtime): `packages/schemas/data/agent_docs/`.
- Validator/auto-fixer catalogue: `apps/agent/docs/validation/rules.md`.

## Current Status

- Active development (2026); backend CRUD is production-ready.
- Example/fixture app configs live under `apps/runtime/client/public/example/examples_for_agents/` (`backend/`, `frontend/`, `full_apps/`, `html_imported/`, `index/`).
