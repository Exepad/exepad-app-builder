# Architecture

## Overview

The app-backend is a per-app RPC backend implemented as a plain TypeScript
module with a `fetch(request, env)` default export. The runtime worker imports
it and calls that export **in-process**
(`apps/runtime/worker/src/routes/gateway/dispatch-local.ts`) — no network hop,
no separate deployment. Per-app isolation comes from the `Env` the runtime
builds for each `{appId, mode}` pair, not from separate processes: a distinct
SQLite file and a distinct storage directory per app.

It exposes a single RPC endpoint (`POST /rpc`) that accepts JSON requests with a `method`, `params`, and optional `model` field. It handles auto-CRUD on user-defined data models, authentication, and custom handler execution. It also exposes the HTTP path-routed `/files/*` route (file upload/serve, backed by a filesystem-backed object store).

When MCP is enabled (`mcp.enabled` in config), it also exposes `POST /mcp` — a Model Context Protocol endpoint (Streamable HTTP, JSON-RPC 2.0) that lets AI agents discover and call the same CRUD and handler tools via a standardized protocol.

## Request Lifecycle

```
Client Request
  │
  ├── CORS preflight? ──→ 204 (OPTIONS)
  ├── Health check?    ──→ 200 (GET /health)
  ├── MCP request?     ──→ POST /mcp (intercepted before service token)
  │     ├── mcp.enabled? → 404 if disabled
  │     ├── Auth: API key (exepad_sk_*) OR gateway JWT
  │     └── handleMcpPost → JSON-RPC dispatch → 200/202
  │
  ▼ POST /rpc
┌─────────────────────────────────┐
│  Rate Limiting (KV surface)     │ → 429 if exceeded
├─────────────────────────────────┤
│  Body Size Check (1 MB limit)   │ → 413 if exceeded
├─────────────────────────────────┤
│  Parse RPC Request              │ → 400 if invalid JSON/method
├─────────────────────────────────┤
│  Service Token Verification     │ → 403 if missing/invalid
│  (skipped for auth_* methods)   │
├─────────────────────────────────┤
│  Extract User Context           │
│  (Mode B session → Mode A       │
│   headers → unauthenticated)    │
├─────────────────────────────────┤
│  Load app config from storage   │
│  (ETag-cached per app+mode)     │
├─────────────────────────────────┤
│  X-Exepad-Auth-Disabled: 1?     │ → force security.enabled = false
├─────────────────────────────────┤
│  PRAGMA foreign_keys = ON       │
├─────────────────────────────────┤
│  Route to Handler               │
│  ┌────────────────────────────┐ │
│  │ sys_*       → CRUD handlers│ │
│  │ sys_file_*  → File metadata│ │
│  │ auth_*      → Auth handlers│ │
│  │ <custom>    → Handler exec │ │
│  └────────────────────────────┘ │
├─────────────────────────────────┤
│  Metric hook (no-op unbound)    │
├─────────────────────────────────┤
│  Set-Cookie (auth responses)    │
└─────────────────────────────────┘
  │
  ▼
JSON Response + CORS + X-Request-Id + X-RateLimit-* headers
```

## Module Map

```
src/
├── index.ts              Entry point — fetch handler, CORS, rate limiting, body check
├── rpc/
│   ├── router.ts         RPC routing, user context extraction, config parsing, auth check
│   └── types.ts          RpcRequest, RpcResponse, UserContext, param types
├── crud/
│   ├── create.ts         sys_create
│   ├── read.ts           sys_read
│   ├── list.ts           sys_list (filtering, pagination, search)
│   ├── update.ts         sys_update
│   ├── delete.ts         sys_delete
│   ├── upsert.ts         sys_upsert
│   ├── aggregate.ts      sys_aggregate
│   ├── batch.ts          sys_batch (transactional)
│   └── multiQuery.ts     sys_multi_query (concurrent)
├── auth/
│   ├── handlers/         signup, signin, signout, me, email verification, password reset, social
│   ├── session.ts        Session token validation against the app database
│   ├── api-keys.ts       `exepad_sk_*` API key issuance + verification
│   ├── verification.ts   Email-verification + password-reset token lifecycle
│   ├── utils.ts          PBKDF2 hashing, token generation, email validation
│   └── types.ts          AuthUser, AuthResult, SignupParams, etc.
├── services/
│   └── email.ts + email.templates.ts  Auth email transport (verification + password reset) — POSTs to the runtime's email route via PLATFORM/PLATFORM_URL, neither of which is bound today; not a user-facing service
├── file/
│   ├── upload.ts                       sys_file_upload / POST /files
│   ├── serve.ts                        GET /files/{id}/{name}
│   ├── read.ts                         sys_file_read / list / delete
│   ├── access.ts                       FilePolicyProps + owner_id scoping
│   ├── quota.ts                        per-user uploads/hour, bytes/hour, per-IP
│   ├── validation.ts                   SVG sanitization, executable blocklist
│   └── keys.ts                         Object key builder + path-traversal guard
├── handlers/
│   ├── executor.ts       Custom handler execution engine
│   └── app-registry.ts   Per-app compiled-handler registry lookup
├── tools/
│   ├── discovery.ts      Discover available tools from config (CRUD + handler)
│   ├── executor.ts       Execute tools by ID — routes to CRUD/handler with auth + scope checks
│   ├── model-mapper.ts   Model config → tool definitions
│   └── handler-mapper.ts Handler config → tool definitions
├── mcp/
│   ├── index.ts          Barrel exports
│   ├── types.ts          JSON-RPC 2.0 types, McpContext, error constants
│   ├── transport.ts      HTTP transport — auth gate, parse, dispatch, JSON-RPC response
│   ├── handler.ts        Method router (initialize, tools/list, tools/call, resources/list, ping)
│   └── gateway-auth.ts   verifyGatewayToken() — HS256 JWT verification (Web Crypto API)
├── context/
│   ├── builder.ts        Build handler execution context
│   ├── config-loader.ts  Read + ETag-cache the app config from storage
│   └── handler-db.ts     Owner-scoped database facade handed to handlers
├── middleware/
│   └── rateLimit.ts      Fixed-window rate limiting over the KV surface
├── utils/
│   ├── errors.ts         Error classes and response formatting
│   ├── validation.ts     Zod schemas, type coercion, field validation
│   ├── sql.ts            SQL query builders (INSERT, SELECT, UPDATE, etc.)
│   ├── cursor.ts         Cursor encoding/decoding for keyset pagination
│   ├── constants.ts      System columns, operators, limits
│   └── analytics.ts      Metric hook — no-op unless an ANALYTICS dataset is bound
└── types/
    └── env.ts            Env interface (database, storage, KV, env vars)
```

## Middleware Chain

| Order | Middleware | File | Behavior |
|-------|-----------|------|----------|
| 1 | CORS | `src/index.ts` | Handles OPTIONS preflight, sets Allow-Origin/Credentials |
| 2 | Rate Limiting | `src/middleware/rateLimit.ts` | Fixed-window counter over the `RATE_LIMIT_KV` surface. Fails open. |
| 3 | Body Size | `src/index.ts` | Rejects payloads >1 MB (413) |
| 4 | Service Token | `src/index.ts` | Verifies `X-Service-Token` header. Skipped for `auth_*` methods (browsers call those through the gateway). |
| 5 | User Context | `src/rpc/router.ts` | Resolves user: session token → platform headers → unauthenticated |
| 6 | Config Load | `src/context/config-loader.ts` | Reads the app config from storage, ETag-cached per app + mode |
| 7 | Auth Check | `src/rpc/router.ts` | Enforces CRUD policy per model/operation |

## Environment & Bindings

The `Env` interface (`src/types/env.ts`) is typed against Cloudflare binding
shapes — `D1Database`, `R2Bucket`, `KVNamespace`. That is a *type surface*, not a
dependency: in the shipped self-hosted build every one of these is supplied by a
local shim from `packages/local-adapters`, assembled in
`apps/runtime/worker/src/server/build-user-env.ts`.

| Binding / Variable | Type surface | Satisfied in self-host by | Description |
|--------------------|--------------|---------------------------|-------------|
| `DB` | D1Database | `LocalD1` over `<data dir>/apps/{appId}/{mode}.sqlite` | Per-app + per-mode SQLite database |
| `CONFIG_CACHE` | R2Bucket | `FsStorageAdapter` over `<data dir>/storage` | Holds `app-config.json` + the deploy status pointer |
| `R2_FILES` | R2Bucket | `FsStorageAdapter` over `<data dir>/buckets/exepad-files-{appId}` | User file uploads (absent ⇒ storage disabled) |
| `DEPLOY_MODE` | string | `'preview'` or `'published'` | Selects which deployment status pointer to follow |
| `APP_ID` | string | app id | App identifier |
| `APP_ALIAS` | string | app alias, falls back to app id | Human-readable app name |
| `ENVIRONMENT` | string | runtime `ENVIRONMENT` | e.g. `"development"` / `"production"` |
| `SERVICE_TOKEN` | string | generated + persisted platform secret | Shared secret for gateway → backend calls |
| `RATE_LIMIT_KV` | KVNamespace | in-memory `KvShim`, one per app + mode | Backing store for the fixed-window limiter |
| `RATE_LIMIT_MAX` | string | `EXEPAD_RATE_LIMIT_MAX`, default `1200` | Max requests per window (the code's own fallback is `100`) |
| `RATE_LIMIT_WINDOW` | string | `EXEPAD_RATE_LIMIT_WINDOW`, default `60` | Window duration in seconds |
| `ALLOWED_ORIGINS` | string | *unbound* | Comma-separated CORS origins (defaults to `*`) |
| `ANALYTICS` | AnalyticsEngineDataset | *unbound* | Metric sink. Never bound in self-host ⇒ `writeMetric` is a no-op. |
| `GATEWAY_JWT_SECRET` | string | *unbound* | HMAC secret for gateway JWTs. Unbound ⇒ `/mcp` accepts API keys only. |
| `PLATFORM` / `PLATFORM_URL` | Fetcher / string | *unbound* | Service binding used by the auth email transport |

## Config Loading

The backend does **not** receive its config through an environment variable.
`src/context/config-loader.ts` is the sole path:

1. Read `{appId}/deployment-status-{mode}.json` from `CONFIG_CACHE` (3 attempts
   with short backoff, to cover a request racing the deploy pipeline).
2. Follow its `configPath` to the app's `app-config.json` (published mode falls
   back to `published/app-config.json`; preview mode has no fallback).
3. Run `extractBackendProps` — the same slice the deploy pipeline validates —
   then `validateConfig`.
4. Cache the result in module scope keyed by `{appId}:{mode}` **and** the stored
   object's ETag. Because one process serves every app, the app+mode key is
   what keeps configs from bleeding across apps.

Failures never throw: any missing or unparseable config yields
`{ models: [], handlers: [] }` so the next request can retry cleanly.

The backend slice looks like:

```typescript
interface InjectedProps {
  models?: ModelProps[];       // Data models with columns, indexes, CRUD policies
  handlers?: HandlerProps[];   // Custom handler definitions
  security?: SecurityProps;    // Per-app auth (Mode B) settings
  roleExpansionMap?: Record<string, string[]>;  // Pre-resolved role hierarchy
  mcp?: McpProps;              // { enabled } — gates POST /mcp
  storage?: StorageProps;      // File storage policy (FilePolicyProps + quotas)
}
```

### Auth Toggle Asymmetry

**Enabling** authentication takes effect when a republish writes a new config
object — the ETag changes and the cached slice is replaced. **Disabling** is
instant and does not wait on a republish: the gateway reads fresh config on
every RPC request and injects `X-Exepad-Auth-Disabled: 1`
(`apps/runtime/worker/src/routes/gateway/auth.ts`), which `src/index.ts` and
`src/rpc/router.ts` honor by forcing `config.security.enabled = false` for that
request.

## Request Tracing

Every response includes an `X-Request-Id` header. The backend uses the incoming `X-Request-Id` from the gateway if present, otherwise generates a UUID. This ID is included in console logs for tracing:

```
[AppBackend] [<request-id>] Error: ...
```

## Analytics

`src/utils/analytics.ts` emits one fire-and-forget metric per request —
operation, model, duration, success, user id, status code — but **only when an
`ANALYTICS` dataset is bound**. The self-hosted runtime never binds one, so this
is inert in the shipped product: an extension point for anyone wiring their own
metric sink, not a working analytics feature.
