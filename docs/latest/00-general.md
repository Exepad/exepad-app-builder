# Exepad Platform — Architecture Summary

**Version:** May 2026
**Status:** Active Development

> **Shipped architecture.** Exepad ships as a **single self-hosted Node +
> Python container**: SQLite databases, filesystem storage, and an app-backend
> dispatched **in-process** by the runtime's Hono/Node server. There are no
> external service dependencies beyond the LLM API you point it at. The root
> [`README.md`](../../README.md#architecture) and [`CLAUDE.md`](../../CLAUDE.md)
> are the shortest description of what runs:
>
> - App dispatch → **in-process `fetch()`** into `@exepad/app-backend`
> - Per-app database → **SQLite** (`better-sqlite3`), one file per app+mode under `/data`
> - Object storage → **the local filesystem** under `/data`
> - KV / cache → **in-memory shims**
> - Builder agent → **a local Python process** in the same container on `:8081`
>
> `packages/local-adapters/` implements these behind Cloudflare-binding-shaped
> interfaces (`D1Database`, `R2Bucket`, `KVNamespace`), so those type names still
> appear in code and in some snippets below. They are local adapters, not calls
> to Cloudflare.

---

## 1. What is Exepad?

Exepad is a **full-stack application platform** that renders dynamic web applications from a single JSON configuration (`WebAppProps`). An AI builder agent takes a user's natural-language prompt, generates a complete configuration, and the Exepad runtime interprets it into a fully interactive React application with an auto-CRUD backend, all served from one self-hosted container.

**Core loop:** User prompt → AI Builder Agent → JSON config → Live full-stack web app

The platform is **AI-first by design** — the `WebAppProps` schema is the primary API surface, optimized for reliable LLM generation rather than human GUI interaction. This is a fundamental differentiator from traditional low-code platforms: there is no visual builder. The schema *is* the interface.

---

## 2. Core Principles

| Principle | Description |
|-----------|-------------|
| **Single Configuration** | One JSON document defines the entire app — UI, state, backend, theme. No code generation, no build step. |
| **Declarative First** | ~80% of apps work without writing any custom code. Models, CRUD, state, theming — all declarative. Code components handle logic via SDK hooks. |
| **Progressive Complexity** | Simple apps stay simple. Complex apps use JavaScript code components (frontend) and custom handlers (backend). |
| **Auto-Docking** | The frontend automatically discovers and wires backend APIs. Define a model → runtime knows how to call `sys_create`, `sys_list`, etc. |
| **LLM-Friendly** | Consistent patterns, predictable types, minimal ambiguity. Designed for reliable AI generation. |
| **Single Container, No Cloud** | Everything runs in one self-hosted container: frontend + API gateway (Hono on Node), backend (app-backend in-process), database (SQLite), storage (filesystem). |
| **Config as the Living Application** | The JSON configuration *is* the app — not an intermediate step to code generation. This creates competitive advantages code-generating tools cannot replicate. |

---

## 3. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         EXEPAD PLATFORM                              │
│                                                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                 UNIFIED CONFIG (WebAppProps)                    │  │
│  │   { uuid, alias, frontend: { pages, theme, logic },           │  │
│  │     backend: { models, handlers }, security }                  │  │
│  └──────────────────────────┬─────────────────────────────────────┘  │
│                             │                                        │
│                             ▼                                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │           RUNTIME (Vite SPA + Hono on Node)                    │  │
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
│                                             ▼                        │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │        app-backend (dispatched in-process, per app+mode)       │  │
│  │                                                                │  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                      │  │
│  │  │  App A   │ │  App B   │ │  App C   │  ...                  │  │
│  │  └──┬───────┘ └──┬───────┘ └──┬───────┘                      │  │
│  │     ▼            ▼            ▼        Per-app resources:      │  │
│  │  ┌──────────────────────────────────────────────────────────┐ │  │
│  │  │  SQLite DB (one file/app)  │  filesystem storage (/data) │ │  │
│  │  │  in-memory KV/cache shims  │  Rate Limiting              │ │  │
│  │  └──────────────────────────────────────────────────────────┘ │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

The Vite-built React SPA is served from disk by the Hono Node server. The API Gateway runs in the same process, providing atomic deploys and a single cold start. The app-backend is imported and dispatched **in-process** (no separate worker per app) with one SQLite file per app+mode; per-app data isolation is enforced in code rather than by separate runtimes.

---

## 4. Platform Modules

### 4.1 Frontend Runtime Engine

The runtime reads `WebAppProps` and dynamically renders pages, components, and state without hand-written React code.

**Key subsystems:**

- **DynamicRenderer** — Core rendering pipeline. The runtime registry is intentionally minimal (`CodeComponentProps`); virtually every page is rendered by the Code Component runtime, which loads agent-generated TSX modules from deploy artifacts.
- **State Management** — Zustand 5 with two stores: `appStore` (config metadata, theme) and `appStateStore` (shared runtime state with `$persist` support). Code components access state via SDK hooks (`useApp`, `useAppState`, `useArrayState`).
- **SDK Hooks** — Code components handle all logic directly via `useModel` (CRUD), `useHandler` (custom backend), `useCount`, `navigate`, `toast`, `useCurrentUser`, plus file upload (`useFileUpload`, `useFileUrl`, `buildFileUrl`). No declarative actions or expression engine — all logic is in JavaScript/TypeScript.
- **Style Pipeline** — Tailwind CSS v4, compiled per-app and scoped via `@layer exepad-app`. Auto-contrast (WCAG AA) skips text rendered over image backdrops to avoid blanking heroes. Compiled CSS filenames are content-versioned so theme/colour edits are not cached as stale.
- **Edit Mode** — Click-to-select component editing with a portaled fixed `SelectionOverlay` (escapes `HybridPageTransition` overflow/transform clipping).
- **Component Library** — In Code Focus the agent emits page-level TSX; the SDK ships ~53 shadcn/ui primitives (Radix-based) plus Charts/Icons/motion/Map/backgrounds/game primitives that those TSX modules import. UI pattern references and website-block exemplars live under `apps/runtime/client/public/example/examples_for_agents/` as prompt material, not as runtime registrations.

**Tech stack:** Vite 6, React 18, React Router 7, Tailwind CSS v4.1, Zustand 5, Radix UI, Hono 4 (API Gateway on `@hono/node-server`).

### 4.2 Backend System (in-process app-backend)

Each app is served by the shared **app-backend**, dispatched **in-process** by the runtime Node server (one SQLite file per app+mode; per-app isolation enforced in code, not by separate runtimes). The backend follows a **2-tier model**:

| Tier | Coverage | What It Does | Code Required |
|------|----------|--------------|---------------|
| **Tier 1: Models (Auto-CRUD)** | ~80% | Automatic CRUD endpoints for SQLite tables. Define columns, types, and policies in JSON — get create, read, list, update, delete for free. | None |
| **Tier 2: Handlers (JavaScript)** | ~20% | Custom JavaScript functions for aggregations, multi-table operations, external API calls, complex business logic. | Yes |

**System methods:** `sys_create`, `sys_read`, `sys_list` (with filtering, sorting, pagination, search), `sys_update`, `sys_delete`, `sys_upsert`, `sys_aggregate`, `sys_batch`, `sys_multi_query`.

**Backend data flow:**

1. Frontend sends RPC request → API Gateway validates and attaches auth headers
2. Gateway dispatches in-process to the app-backend for that app
3. The app-backend verifies the service token, checks rate limits, parses config
4. Routes to Auto-CRUD (model lookup → policy check → SQL → SQLite) or Custom Handler (registry lookup → context build → Zod validation → execute with 10s timeout)
5. Response returns with CORS and rate-limit headers

**MCP endpoint.** When `mcp.enabled` is set in the app's config, the app-backend also serves `POST /mcp` (Streamable HTTP, JSON-RPC 2.0, protocol version `2024-11-05`). It is intercepted *before* service-token verification and authenticated independently via either an `Authorization: Bearer exepad_sk_*` API key or an HS256 gateway JWT, then dispatches to `tools/list` / `tools/call` over the same CRUD + handler discovery layer. See [Backend System — MCP Endpoint](06-backend-system.md#mcp-endpoint).

### 4.3 Code Focus Build Mode

> **Removed (2026-04):** The legacy runtime scaffold system (`CrudScaffold` / `DashboardScaffold` / `SettingsScaffold` / `AuthScaffold` / `ChatScaffold` expanders that turned a single intent config into a component tree at runtime). The platform now ships every page as agent-generated TSX through the Code Focus pipeline.

Code Focus is the build mode for every Exepad app today. The AI builder agent emits one or more **TSX components per page**, the deploy pipeline compiles their Tailwind classes once into a per-app stylesheet, and the runtime loads each module from the deploy artifacts and renders it inside a `LightDOMContainer`.

Key invariants:

- **Light DOM** — components render in the page DOM (not Shadow DOM) so theme tokens, focus, portals, and form submission all work normally.
- **`@layer exepad-app`** — every generated class lives in this CSS layer so component styles cannot collide with the platform's own.
- **Content-versioned `compiled.css`** — recolor / theme edits change the filename so CDN/edge caches cannot serve a stale palette.
- **Validation pipeline (4 stages + a single final compile gate):**
  1. Syntax — esbuild parse
  2. Semantic — TypeScript + AST rules + regex (SDK imports, forbidden APIs, JSX undeclared refs, …)
  3. CSS compilation — Tailwind CLI builds the per-component classes
  4. Style coverage — every custom class the agent used must appear in the compiled CSS
  - Plus a single deterministic Tailwind compile gate at the end of the workflow that produces the deployed `compiled.css`.

Pattern exemplars (header / hero / pricing / footer / dashboard / CRUD / settings / chat / auth) live under `apps/runtime/client/public/example/examples_for_agents/` and `packages/schemas/data/agent_docs/`. They are consumed by the agent at generation time — they are **prompt material**, not a runtime registry, and there is no longer a deterministic <100 ms scaffold fast-path.

The agent-side validator and auto-fixer catalogue — the ground-truth list of what each stage checks and repairs — is [`apps/agent/docs/validation/rules.md`](../../apps/agent/docs/validation/rules.md).

### 4.4 AI Builder Agent

The agent is the sole producer of application configurations. In the OSS build it runs as a multi-agent pipeline **inside the same container** (FastAPI + Google ADK on a local Python process, internal `:8081`, reverse-proxied at `/agent/*`):

1. **User describes their app** in natural language; the request lands on the agent's `/r` endpoint with `app_id`, optional `design_bundle_id`, and the prompt.
2. **PreCreator** picks `app_secondary_type` (website / form / dataapp / custom) and short-summary metadata; it owns this field, the Creator never re-derives it.
3. **Creator → BackendModelBuilder → BackendHandlerBuilder → SkillSelector** plan the page tree, models, handlers, and per-component flow/domain skills, then route the build through:
4. **ComponentBuilder** (Code Focus TSX) for every page-level component — system instruction is held byte-stable across components for prompt-cache hits; per-component context rides on structured input fields (`skill_context`, `flow_skill_context`).
5. **Validators + auto-fixers** (esbuild → tsc → AST/regex → final Tailwind compile gate) repair common issues (icon chained-member crashes, JSX undeclared refs, missing image keywords, form file uploads, scope-blind `<img>`-in-map leaks, …) and *escalate* unrecoverable failures back to the builder.
6. **Cancellation is out-of-band** — the runtime can `POST /cancel` to the agent at any time; the agent drops an in-memory (process-local) marker and a watchdog aborts the in-flight LLM call in ≈1.5 s so the Stop button in the UI actually stops the run.
7. **Exepad runtime** receives the `WebAppProps` config + the per-app `compiled.css` and renders the live application.

### 4.5 Authentication System

Per-app end-user authentication, built into the runtime as core infrastructure. Three-mode architecture:

- **Platform auth** (default) — backward compatible with existing apps
- **Per-app auth** (when `security` is configured) — each app gets its own user pool in its SQLite database
- **Exepad SSO** — invitation-based single sign-on *(planned — type definitions present, no flow yet)*

Supports email/password (PBKDF2-SHA256), API keys (`exepad_sk_*`, scoped + rotatable), role-based access control with role hierarchy (BFS + cycle detection), and automatic `owner_id` scoping on all data.

**Not implemented:** Google OAuth for per-app auth does not exist. The `/api/auth/oauth/{start,callback,finalize}` route group depended on a per-app worker dispatch binding the single-container runtime does not provide, and has been removed from the runtime. Only leftover type definitions and the `auth_social_login` RPC stub remain — the stub returns a redirect URL to an endpoint nothing serves, and the login page never renders a Google button because nothing stamps the `data-google-configured` capability flag it gates on. Email/password is the supported per-app auth method. There is no MFA. Email verification and password reset need an outbound transport: the runtime ships a Resend proxy (`routes/email.ts`) used only by those two auth flows, and it is inert unless `RESEND_API_KEY` is set.

> **Re-publish asymmetry (important):** turning auth *off* on a published app takes effect immediately — the gateway injects `X-Exepad-Auth-Disabled: 1` on every request and the app-backend honours it without reloading config. Turning auth *on* requires a re-publish, because `security` lives in the app's config: the backend caches that config keyed by the stored object's ETag, so it only picks up the change once a publish writes a new `app-config.json`.

### 4.6 Data Collection via Backend Models

Apps own their data. Rather than depending on bundled SaaS-style services, an app declares its own SQLite tables as backend models and consumes the `sys_*` CRUD methods (`sys_create`, `sys_read`, `sys_list`, `sys_update`, `sys_delete`, `sys_upsert`, `sys_aggregate`, `sys_batch`, `sys_multi_query`) plus custom handlers for anything beyond plain CRUD.

This covers the patterns that used to be packaged as services. Contact, newsletter, survey, and other data-collection forms are built as a backend model that a code component writes to with `useModel().create()` — see the `crud-data-app` skill. Aggregations, multi-table writes, and external API calls go in custom handlers. The result is a single, inspectable per-app schema instead of opaque shared microservices.

### 4.7 File Upload & Storage

End-to-end file upload, storage, and serving via the local filesystem (under `/data`) with signed URLs. Enabled with a single `storage.enabled: true` flag. The platform handles signed URLs, filesystem storage, metadata tracking in SQLite, access control, rate limiting, and content security — transparent to the app developer.

### 4.8 Browser SDK

A Vite-built JavaScript SDK (`@exepad/sdk`) that ships to `runtime/client/public/` and provides hooks for state access (`useApp`, `useAppState`, `useArrayState`), CRUD (`useModel`), backend calls (`useHandler`), navigation, theming, and auth context. Used by code components.

---

## 5. Multi-Tenancy & Isolation

| Resource | Isolation Level |
|----------|-----------------|
| Backend | Shared app-backend, dispatched in-process per app (isolation enforced in code) |
| Database | Per-app SQLite file (separate database per app+mode) |
| Storage | Prefix-isolated filesystem paths (`{app_id}/` under `/data`) |
| Secrets | Per-app config, injected at dispatch |
| Config | Per-app `INJECTED_CONFIG` |
| Data | Row-level via `owner_id` column |

---

## 6. Deployment Pipeline

The runtime worker's `/deploy` endpoint is the source of truth — see [`apps/runtime/worker/src/routes/deploy.ts`](../../apps/runtime/worker/src/routes/deploy.ts). The pipeline is idempotent on `correlationId`, holds a per-app deploy lock, and runs roughly this sequence:

```
1.  Auth — verify deploy secret
2.  Idempotency check — return cached result for repeated correlationId
3.  Config — read app config from local storage (preview vs published key)
4.  Validate WebAppProps + backend props (empty-frontend guard)
5.  Resolve static seed entries
6.  Provision (parallel) — handlers bundle, module write, app SQLite, storage prefixes
7.  Acquire deploy lock
8.  Schema — snapshot + diff + apply migrations (safe / destructive / reset policy)
9.  System tables — files, auth, API keys (batched DDL)
10. Seed models
    • Preview:   all models (per app)
    • Published: shared-scope models only, with a non-destructive empty-guard so a
                 first publish into an empty published database still seeds the catalog
    • Two-phase FK-ordered seed: clear children before parents, insert parents
      before children, defer-FK update pass for cycles
11. Snapshot — write published artifact set
12. Write — compile handlers (esbuild) + write the app-backend module to disk
```

Two deploy modes: **preview** (`app-preview-{appId}`) and **published** (`app-{appId}`). Handlers are compiled with esbuild, artifacts written to the `/data` filesystem, and the compiled module is loaded by the in-process app-backend — no external upload step.

---

## 7. Monorepo Structure

```
exepad-app-builder/
├── apps/
│   ├── runtime/          # Vite SPA (dev :3001) + Hono on Node (:8080 container / :8090 from source)
│   │   ├── client/       # Vite + React SPA
│   │   └── worker/       # Hono on @hono/node-server (API gateway, deploy, admin)
│   └── app-backend/      # Auto-CRUD + handler backend, dispatched in-process
│
├── packages/
│   ├── types/            # @exepad/types — shared TypeScript definitions
│   ├── schemas/          # JSON Schema validation (Ajv) + examples
│   ├── ui-core/          # Shared Tailwind CSS styles
│   ├── exepad-sdk/       # Browser SDK (Vite-built)
│   └── deploy-utils/     # Deployment pipeline (esbuild + CF API + seeding)
```

**Tooling:** pnpm 9.15, Turborepo 2.3, TypeScript 5.9 (strict mode), Vitest 4 (unit/integration), Playwright 1.58 (E2E), esbuild 0.27 (handler compilation).

---

## 8. Tech Stack At a Glance

| Layer | Technology |
|-------|-----------|
| Frontend | Vite 6, React 18, React Router 7, Tailwind CSS v4.1, Zustand 5 |
| UI Components | Radix UI + shadcn/ui pattern (~53 primitives re-exported via `@exepad/sdk`) |
| Forms | React Hook Form + Zod validation |
| Backend | In-process app-backend (Node), SQLite (`better-sqlite3`), RPC-based API, MCP Streamable HTTP (`POST /mcp`) |
| Storage | Filesystem under `/data` (files + per-app artifacts); in-memory KV/cache shims |
| Agent | Google ADK, FastAPI, Uvicorn — local Python process inside the container (`:8081`) |
| Build | pnpm 9.15, Turborepo 2.3, esbuild 0.27, TypeScript 5.9 |
| Testing | Vitest 4, Playwright 1.58 |
| Deployment | Single self-hosted Docker container (Node runtime serves the SPA from disk + API gateway) |
| Email (auth transport) | Resend — internal delivery for email verification + password reset only |

---

## 9. What You Can Build

Exepad supports a wide range of application types:

- **Websites & Landing Pages** — Business sites, portfolios, SaaS landing pages, blogs, marketing sites
- **Data-Driven Applications** — Admin dashboards, CRM systems, e-commerce storefronts, project management tools, internal tools
- **Forms & Workflows** — Contact forms, booking forms, surveys, quizzes, multi-step registration flows
- **Interactive Applications** — Social feeds, chat interfaces, scheduling apps with calendar pickers
- **Authenticated Applications** — Per-app auth with role-based access control, user-scoped data with automatic owner isolation

---

## 10. On the Horizon

Key upcoming workstreams include:

- **Agentic Web** — Chat agent (SQLite-backed + SSE), markdown content layer, WebMCP, MCP servers, A2A agents
- **Excel-to-App** — Agent pipeline using Google ADK to scan, clean, and transform uploaded spreadsheets into live apps
- **Multi-Agent Orchestration** — Parallel, loop, race, consensus, and handoff workflow step types
- **Mobile** — React Native runtimes consuming the same `WebAppProps` config for iOS/Android deployment
- **Adjacent Products** — Exekite (educational platform for kids 8–18) and Exeplay (game creation with natural language)

---

## 11. Key Design Decisions

**Why JSON config, not code generation?** — Apps are portable data, not code repos. Config can be modified at runtime, AI agents generate/validate JSON more reliably than code, and there's no build step.

**Why a single self-hosted container?** — The OSS product is designed to run anywhere with zero cloud dependencies: SQLite for per-app isolation without a database server, filesystem storage without object-store setup, and the app-backend dispatched in-process so there's nothing to orchestrate. The only external call is to the LLM API the operator chooses. *(Historically Exepad targeted Cloudflare's edge — Workers/D1/R2/KV/Workers-for-Platforms — and the local-adapters layer still shims those bindings onto local infra; that lineage is why some passages above read as "Cloudflare-flavored.")*

**Why Zustand, not Redux?** — Minimal boilerplate (critical for declarative platforms), fine-grained selectors, SSR-compatible, simple mental model.

**Why SQLite + SSE for chat?** — Direct in-process SQLite access has no network hop, and SQLite + SSE matches how conversation history is handled elsewhere. It also keeps the whole product inside one container with no external state store.

**Why Code Focus TSX over a JSON scaffold/component DSL?** — The original component-tree-as-JSON path (CrudScaffold, DashboardScaffold, …) was retired in April 2026. Per-page TSX is the smallest schema the agent can emit that still expresses arbitrary UI without dragging in a parallel "config DSL" that lags every shadcn/Tailwind update. The deterministic deploy pipeline (validators, auto-fixers, Tailwind compile gate, FK-ordered seed) keeps emission reliable enough for LLM generation.