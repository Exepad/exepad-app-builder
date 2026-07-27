# Exepad App Backend

> **How it runs.** The app-backend is **not** a separately-deployed service. It
> is imported as a library and dispatched **in-process** inside the runtime Node
> server (`apps/runtime/worker/src/routes/gateway/dispatch-local.ts`), backed by
> local SQLite + filesystem storage. Its `Env` is typed against the Cloudflare
> `D1Database` / `R2Bucket` / `KVNamespace` surfaces, but in the shipped build
> those bindings are satisfied by the local shims in `packages/local-adapters`
> (SQLite file, filesystem directory, in-memory map) — assembled in one place,
> `apps/runtime/worker/src/server/build-user-env.ts`. See the root
> [README.md](../../../../README.md).

The **app-backend** is a per-app RPC backend for the Exepad platform, providing auto-CRUD operations on data models, authentication, authorization, file storage, and custom handler execution. Every app is served from the single runtime process, each against its own SQLite file (`<data dir>/apps/{appId}/{preview|published}.sqlite`) and its own storage directory — so apps stay isolated without a per-app deployment.

## Key Capabilities

- **Auto-CRUD** — Create, read, list, update, delete, upsert, aggregate, batch, and multi-query operations on any configured model
- **Authentication** — Dual-mode: platform headers (Mode A) or per-app email/password sessions (Mode B)
- **Authorization** — Per-model CRUD policies (`public` / `authenticated` / `admin`), owner-scoped data isolation
- **File Storage** — `sys_file_*` RPC + `POST /files` / `GET /files/{id}/{name}`, with per-user quotas, SVG sanitization, and owner scoping
- **Auth Email** — A minimal transport used *only* by signup verification and password reset (`src/services/email.ts`), which POSTs to the runtime's `/api/platform/email/send`. It needs a `PLATFORM` service binding or `PLATFORM_URL`; `build-user-env.ts` sets neither today, so treat auth email as unwired in the shipped build. There is no general-purpose email, forms, blog, payments, or notifications service in this backend.
- **Custom Handlers** — User-defined JavaScript methods with a typed context (`db`, `batch`, `user`, `params`, `models`, `config`, `log`) — no service clients
- **MCP Endpoint** — `POST /mcp` exposes app tools via Model Context Protocol (Streamable HTTP, JSON-RPC 2.0) for AI agent access; requires `mcp.enabled` in config
- **Middleware** — CORS, rate limiting, body size limits, service token verification
- **Analytics** — `src/utils/analytics.ts` writes one fire-and-forget metric per request *when* an `ANALYTICS` dataset binding is present. The self-hosted runtime never binds one (see `build-user-env.ts`), so in the shipped build this path is a **no-op** — the code is a hook, not a feature.

## Tech Stack

| Component | Technology |
|-----------|------------|
| Host process | Runtime Node server (Hono on `@hono/node-server`); the backend is imported, not deployed |
| Database | SQLite via `better-sqlite3`, one file per app + mode, behind a D1-shaped adapter |
| Object storage | Local filesystem under the data dir, behind an R2-shaped adapter |
| Language | TypeScript 5.9 |
| Validation | Zod |
| Auth crypto | Web Crypto PBKDF2-SHA256 (`src/auth/utils.ts`) |
| Testing | Vitest 4 (node environment) — `apps/app-backend/tests/` |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](architecture.md) | Request flow, middleware chain, module map, environment bindings |
| [API Reference](api-reference.md) | RPC protocol, MCP protocol, all CRUD methods, filtering, pagination, error codes |
| [Authentication](authentication.md) | Dual-mode auth, session lifecycle, password security, cookie handling |
| [Authorization](authorization.md) | CRUD policies, owner scoping, protected fields, role-based access |
| [Custom Handlers](custom-handlers.md) | Handler execution, context API, registry, type definitions |
| [Local Development](local-development.md) | Running the backend, inspecting the SQLite files, testing |
| [Deployment](deployment.md) | How an app's schema + config reach the backend at deploy time |

## Quick Start

The backend has no standalone dev server — you run the platform and it is
dispatched in-process:

```bash
# Install dependencies (from monorepo root)
pnpm install

# Run the platform from source (Vite SPA + runtime worker with tsx watch)
pnpm dev

# Backend unit + integration tests
pnpm --filter @exepad/app-backend test
```

See [Local Development](local-development.md) for the full guide.
