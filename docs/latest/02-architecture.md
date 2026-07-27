# Architecture

> **Shipped architecture.** Exepad runs as a **single self-hosted Node + Python
> container**: the runtime worker is Hono on `@hono/node-server`, the app-backend
> is dispatched **in-process** (one shared module, not a service per app),
> databases are SQLite files, and storage is the local filesystem under `/data`.
>
> `packages/local-adapters/` implements those local resources behind
> Cloudflare-binding-shaped interfaces (`D1Database`, `R2Bucket`, `KVNamespace`,
> `Fetcher`), and parts of `deploy-utils` keep matching names
> (`provisionD1Database`, `uploadWorkerScript`). Those are **local adapters** —
> reading or writing files on your disk — not calls to any external service.

## System Overview

Exepad is a monorepo-based platform with three applications and five shared packages, built with pnpm workspaces and Turborepo.

```
┌──────────────────────────────────────────────────────────────────────┐
│                         EXEPAD PLATFORM                              │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                 UNIFIED CONFIG (WebAppProps)                    │  │
│  │   { uuid, alias, frontend: { pages, theme, logic },           │  │
│  │     backend: { models, handlers } }                            │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│                             ▼                                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │             RUNTIME (Vite SPA + Hono on Node)                  │  │
│  │                                                                │  │
│  │  ┌────────────────────┐    ┌───────────────────────────────┐  │  │
│  │  │  Client SPA        │    │  API Gateway (Hono)           │  │  │
│  │  │  • React Router 7  │    │  • /api/{appId}/rpc           │  │  │
│  │  │  • DynamicRenderer │    │  • Auth + Validation          │  │  │
│  │  │  • Code Components │    │  • Request Forwarding         │  │  │
│  │  │  • Zustand State   │    │                               │  │  │
│  │  └────────────────────┘    └─────────────┬─────────────────┘  │  │
│  │                                          │ in-process fetch()  │  │
│  └──────────────────────────────────────────┼────────────────────┘  │
│                                             │                        │
│                                             ▼                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │        app-backend (dispatched in-process, per app+mode)       │  │
│  │                                                                │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐                    │  │
│  │  │  App A   │  │  App B   │  │  App C   │  ...               │  │
│  │  │ + SQLite │  │ + SQLite │  │ + SQLite │                    │  │
│  │  └──────────┘  └──────────┘  └──────────┘                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                             │                        │
│                                             ▼                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                       DATA LAYER (/data)                       │  │
│  │  • SQLite (per-app)  • filesystem storage  • in-memory shims  │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Monorepo Structure

```
exepad-app-builder/
├── apps/
│   ├── runtime/              # Vite SPA (dev :3001) + Hono on Node (:8080 container / :8090 from source)
│   │   ├── client/src/       # Vite + React SPA
│   │   │   ├── pages/        # React Router page components
│   │   │   ├── app_runtime/  # Core engine (interfaces + runtime)
│   │   │   ├── components/   # DynamicRenderer, theme, layout, editable
│   │   │   ├── stores/       # Zustand stores (appStore, appStateStore)
│   │   │   ├── services/     # ConfigService, PersistenceService, WebSocketManager, StudioStream, AdminApi
│   │   │   ├── hooks/        # Custom React hooks
│   │   │   ├── lib/          # Security, auth, utilities
│   │   │   ├── context/      # React contexts
│   │   │   └── registry/     # Component registry + lazy loading
│   │   ├── worker/src/       # Hono on @hono/node-server
│   │   │   ├── routes/       # gateway/, deploy, orchestrate, auth, admin/, settings, email
│   │   │   └── lib/          # Security headers, meta injector, auth
│   │   └── client/public/example/examples_for_agents/   # Example app configs
│   │
│   ├── app-backend/          # Auto-CRUD + handler backend (dispatched in-process)
│   │   └── src/
│   │       ├── index.ts      # Entry point + middleware
│   │       ├── rpc/          # RPC routing + request parsing
│   │       ├── crud/         # Auto-CRUD handlers
│   │       ├── handlers/     # Custom handler execution + per-app registry
│   │       ├── auth/         # Per-app auth (sessions, API keys)
│   │       ├── mcp/          # MCP Streamable HTTP endpoint
│   │       ├── tools/        # Tool discovery + execution
│   │       ├── file/         # Upload + serve
│   │       ├── context/      # Config loading, HandlerContext builder
│   │       ├── middleware/   # Rate limiting
│   │       ├── utils/        # SQL builders, validation, errors
│   │       └── types/        # Environment bindings
│   │
│   └── agent/                # Python AI builder agent (internal :8081)
│       └── main_agent/       # FastAPI + Google ADK orchestrator
│           ├── agents/       # Planning, building, editing agents
│           └── services/     # Config generation, validation
│
├── packages/
│   ├── types/                # Shared TypeScript types (WebAppProps, etc.)
│   ├── schemas/              # JSON schema validation (Ajv) + agent prompt docs
│   ├── ui-core/              # Shared Tailwind CSS styles
│   ├── exepad-sdk/           # Browser SDK (Vite-built)
│   ├── exepad-cli/           # Operator CLI (npm package `exepad`)
│   ├── local-adapters/       # SQLite / filesystem / in-memory shims
│   └── deploy-utils/         # Schema generation, bundling, deployment
│
├── docs/                     # Documentation
├── turbo.json                # Turborepo pipeline config
├── pnpm-workspace.yaml       # Workspace definition
└── package.json              # Root scripts
```

---

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Vite 6, React 18, React Router 7 | Client-side SPA rendering, routing, component rendering |
| **UI Components** | Radix UI + shadcn/ui pattern | ~53 primitives available via SDK for Code Focus components |
| **Styling** | Tailwind CSS v4 | Utility-first CSS, theme tokens |
| **State** | Zustand | Client-side state management with persistence |
| **Forms** | React Hook Form + Zod | Form handling + runtime validation |
| **Data Tables** | TanStack Table | Sorting, filtering, pagination |
| **Charts** | Recharts | Data visualization |
| **Backend** | In-process app-backend (Node) | Auto-CRUD + handler API, dispatched in-process |
| **Database** | SQLite (`better-sqlite3`) | Per-app relational storage (one file per app+mode) |
| **Object Storage** | Local filesystem (`/data`) | File uploads, static assets |
| **Secrets** | Generated + persisted to `/data/secrets` | Session/deploy secrets (in-memory KV/cache shims for app runtime) |
| **Build** | pnpm 9.15 + Turborepo 2.3 | Monorepo management, task orchestration |
| **Types** | TypeScript 5.9.3 (strict) | Type safety across all packages |
| **AI Agent** | Python 3.12 + FastAPI + Google ADK | AI builder agent for config generation (internal `:8081`) |
| **Testing** | Vitest + Playwright | Unit/integration tests + E2E browser tests |
| **Deployment** | Single self-hosted Docker container | Node runtime serves the SPA from disk + API gateway + in-process backend |

---

## Package Dependency Graph

```
                    ┌──────────────┐
                    │  packages/   │
                    │    types     │  ← Shared types (WebAppProps, etc.)
                    └──────┬───────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
    ┌─────────────┐ ┌───────────┐ ┌──────────────┐
    │  packages/  │ │ packages/ │ │  packages/   │
    │   schemas   │ │  ui-core  │ │ deploy-utils │
    └──────┬──────┘ └─────┬─────┘ └──────────────┘
           │              │
           ▼              ▼
    ┌─────────────────────────────┐    ┌──────────────────┐
    │      apps/runtime           │    │  apps/app-backend │
    │  (Vite SPA + Hono Worker)   │    │  (CF Worker)      │
    └─────────────────────────────┘    └──────────────────┘
                │
                ▼
    ┌─────────────────────────────┐
    │      packages/exepad-sdk    │  ← Built from runtime deps,
    │  (Browser SDK for remote    │     output to runtime/client/public/
    │   components)               │
    └─────────────────────────────┘
```

All workspace dependencies use `workspace:*` protocol in `package.json`.

---

## End-to-End Request Flow

### Page Render Flow

```
1. Browser requests page
   │
   ▼
2. React Router resolves route
   │
   ▼
3. ConfigService loads WebAppProps (from file, API, or cache)
   │
   ▼
4. appStore receives config → initializes theme, metadata
   │
   ▼
5. appStateStore initializes state from config.frontend.logic
   │  (state defaults, $persist rehydration)
   │
   ▼
6. PageRenderer iterates page.components[]
   │
   ▼
7. DynamicRenderer for each component:
   ├─ Resolves componentType → React component via registry
   ├─ Scans props for $variable references (extractStateKeys)
   ├─ Creates granular Zustand selector for those keys
   ├─ Evaluates showWhen condition
   └─ Renders component with processed props
       │
       ▼
8. Code components render with SDK hooks
   (state changes → selective re-renders via granular Zustand selectors)
```

### Backend API Flow

```
1. Frontend calls backend (sys_list, sys_create, custom handler, etc.)
   │  POST /rpc { method, model, params }
   │
   ▼
2. Runtime API Gateway
   ├─ Validates request
   ├─ Attaches auth headers (X-User-Id, X-User-Email, X-User-Roles)
   └─ Dispatches in-process to the app-backend for this app
       │
       ▼
3. app-backend handles the request
   ├─ Verifies service token (X-Service-Token)
   ├─ Rate limit check (in-memory)
   ├─ Parses RPC request
   ├─ Extracts user context from headers
   ├─ Parses injected config (INJECTED_CONFIG)
   └─ Routes to CRUD or custom handler
       │
       ├─── CRUD Route ──────────────────────┐
       │    ├─ Find model in config           │
       │    ├─ Check auth (CrudPolicy)        │
       │    ├─ Validate input                 │
       │    ├─ Build SQL query                │
       │    ├─ Execute against SQLite         │
       │    └─ Return response                │
       │                                      │
       ├─── Custom Handler Route ─────────────┤
       │    ├─ Find handler in config         │
       │    ├─ Resolve from registry          │
       │    ├─ Build HandlerContext            │
       │    ├─ Validate inputs (Zod)          │
       │    ├─ Execute with 10s timeout       │
       │    ├─ Validate outputs               │
       │    └─ Return response                │
       │                                      │
       ▼                                      ▼
4. Response with CORS headers, rate-limit headers
   │
   ▼
5. Frontend receives data → updates state → re-renders
```

---

## Multi-Tenancy Model

Each application in Exepad runs in isolation:

| Resource | Isolation Level |
|----------|-----------------|
| **Backend** | Shared app-backend, dispatched in-process per app (isolation enforced in code) |
| **Database** | Per-app SQLite file (separate database per app+mode) |
| **Storage** | Prefix-isolated filesystem paths (`{app_id}/` under `/data`) |
| **Secrets** | Per-app config injected at dispatch |
| **Config** | Per-app `INJECTED_CONFIG` |
| **Data** | Row-level isolation via `owner_id` column |

Within each app, data is scoped per user. Every table automatically includes an `owner_id` column, and all CRUD operations filter by the authenticated user's ID (unless the model uses `ownerScope: 'shared'`).

---

## Merged Runtime Architecture

The Exepad runtime is a Vite-built React SPA served from disk by a Hono server on `@hono/node-server`. The SPA, the API gateway, and the app-backend all run in the **same Node process**, providing:

| Benefit | Detail |
|---------|--------|
| **Zero API latency** | Same-process calls — no network hop to the backend |
| **Atomic deploys** | Frontend and API always in sync |
| **No CORS** | Same origin — no cross-origin configuration needed |
| **Single cold start** | One process warmup |
| **Shared code** | Types, validation, and utilities imported directly |

The app-backend handles each app's business logic; per-app isolation (separate SQLite files, config injection, `owner_id` scoping) is enforced in code rather than by separate runtimes.

---

## Key Design Decisions

**Why JSON config + Code Focus?**
- The app definition (pages, state, backend, theme) is portable JSON — not a code repository
- UI components are AI-generated TSX rendered in the light DOM with compiled Tailwind CSS
- Configuration can be modified at runtime (edit mode); code components are validated via a 4-stage pipeline
- No build step for app developers — instant rendering

**Why a single self-hosted container (no cloud)?**
- Runs anywhere with zero cloud accounts — the only external call is the LLM API
- SQLite gives familiar, simple per-app isolation with no database server to run
- In-process dispatch means nothing to orchestrate — one process, one deploy
- The operator owns their data and infrastructure — no vendor lock-in

  *(Exepad was originally built for Cloudflare's edge. The `local-adapters` package preserves those binding interfaces over local infrastructure, which is why a few type names in the codebase still read as "Cloudflare-flavored".)*

**Why Zustand, not Redux or Context?**
- Minimal boilerplate — critical for a declarative platform
- Fine-grained selectors — components subscribe to specific state keys only
- Works with SSR out of the box
- Simple mental model: state + actions, no reducers or middleware

**Why shadcn/ui as the SDK base?**
- ~53 primitives available via the SDK for Code Focus components to import
- Radix primitives for accessibility
- Tailwind for styling — consistent with the platform's approach
- No version lock-in to an external library

---

## Related Documents

- [Runtime Engine](03-runtime-engine.md) — How DynamicRenderer works
- [Backend System](06-backend-system.md) — app-backend architecture in detail
- [Deployment](10-deployment.md) — self-hosted single-container deploy pipeline
- [Development Guide](12-development-guide.md) — Local setup and commands
