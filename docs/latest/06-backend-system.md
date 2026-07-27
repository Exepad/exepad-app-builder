# Backend System

The Exepad backend provides automatic CRUD endpoints for data models and executes custom handler functions. The AI builder agent defines models and handlers in the `WebAppProps` configuration, and the backend interprets them at runtime.

It is **not** a separate service: the runtime worker imports `@exepad/app-backend` and dispatches to it **in-process** for every `{appId, mode}` pair, backed by one SQLite file per app+mode under `/data`. See [Deployment](10-deployment.md).

**Source:** `apps/app-backend/src/`

---

## Architecture

```
HTTP Request (from Runtime API Gateway) — in-process fetch()
    │
    ▼
┌─────────────────────────────────────────────────┐
│         App Backend (per {appId, mode})          │
│                                                  │
│  1. Service Token Verification (X-Service-Token) │
│  2. Rate Limit Check                             │
│  3. Body Size Validation (max 1MB)               │
│  4. RPC Request Parsing                          │
│  5. User Context Extraction (from headers)       │
│  6. Config Load (app-config.json via CONFIG_CACHE)│
│  7. RPC Router                                   │
│     ├── CRUD? → Find Model → Auth → Execute     │
│     └── Handler? → Find Handler → Auth → Execute │
│  8. Response (+ CORS, rate-limit headers)        │
│                                                  │
│  Env (built per request by the runtime worker):  │
│  • DB: SQLite file for this app+mode             │
│  • CONFIG_CACHE: filesystem store under /data    │
│  • R2_FILES: filesystem bucket for uploads       │
│  • SERVICE_TOKEN: gateway↔backend shared secret  │
│  • RATE_LIMIT_KV: in-memory store per app+mode   │
└─────────────────────────────────────────────────┘
```

The `Env` interface the backend is typed against still uses Cloudflare binding
type names (`D1Database`, `R2Bucket`, `KVNamespace`). In the self-hosted
container those slots are filled by `@exepad/local-adapters` — `LocalD1` over
`better-sqlite3`, `FsStorageAdapter` over the filesystem, and an in-memory
`KvShim` — assembled in `apps/runtime/worker/src/server/build-user-env.ts`,
which is the single place those casts live.

---

## RPC Protocol

All backend operations use a single RPC endpoint. The request format:

```json
POST /rpc
Content-Type: application/json
X-Service-Token: <token>
X-User-Id: <user-id>
X-User-Email: <email>
X-User-Roles: <comma-separated-roles>

{
  "method": "sys_list",
  "model": "books",
  "params": {
    "filters": { "status": "available" },
    "orderBy": { "created_at": "desc" },
    "limit": 20
  }
}
```

### System Methods (CRUD)

| Method | Description |
|--------|-------------|
| `sys_create` | Create a new record |
| `sys_read` | Read a single record by ID |
| `sys_list` | List records with filtering, sorting, pagination |
| `sys_update` | Update an existing record |
| `sys_delete` | Delete a record (hard or soft) |
| `sys_upsert` | Insert or update (create if not exists, update if exists) |
| `sys_aggregate` | Aggregation queries (sum, count, min, max, group by) |
| `sys_batch` | Execute multiple operations atomically in a single request |
| `sys_multi_query` | Execute multiple read queries in parallel |

### Custom Methods

Any `method` value that doesn't start with `sys_` is routed to custom handlers:

```json
{ "method": "getDashboardStats", "params": { "dateRange": "last30days" } }
```

---

## CRUD Operations

### sys_create

Creates a new record in a model's table.

**Parameters:**
```json
{
  "data": {
    "title": "The Great Gatsby",
    "author_id": 1,
    "isbn": "978-0743273565",
    "price": 12.99
  }
}
```

**Behavior:**
- Validates input against model schema (required fields, type checking)
- Coerces string types (e.g., `"123"` → `123` for integer columns)
- Rejects system columns (`id`, `owner_id`, `created_at`, `updated_at`)
- Rejects unknown fields not in the model
- Applies defaults for missing optional fields
- Auto-sets: `owner_id` (from user), `created_at`, `updated_at`
- Uses `RETURNING *` for single round-trip
- Detects unique constraint violations (returns 409 Conflict)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": 42,
    "title": "The Great Gatsby",
    "author_id": 1,
    "isbn": "978-0743273565",
    "price": 12.99,
    "owner_id": "user-456",
    "created_at": "2026-02-10T15:00:00.000Z",
    "updated_at": "2026-02-10T15:00:00.000Z"
  }
}
```

### sys_read

Reads a single record by ID.

**Parameters:**
```json
{ "id": 42 }
```

**Behavior:**
- Applies `owner_id` filter unless model has `ownerScope: 'shared'`
- Returns 404 if not found (or not owned by user)

### sys_list

Lists records with filtering, sorting, and pagination.

**Parameters:**
```json
{
  "filters": {
    "status": "available",
    "price": { "lte": 20 },
    "category": ["fiction", "non-fiction"]
  },
  "orderBy": { "created_at": "desc", "title": "asc" },
  "limit": 20,
  "offset": 0,
  "select": ["id", "title", "price", "status"],
  "paginationMode": "offset"
}
```

**Filter Operators:**

| Syntax | SQL Equivalent | Example |
|--------|---------------|---------|
| `value` | `= ?` | `{ "status": "active" }` |
| `[v1, v2]` | `IN (?, ?)` | `{ "category": ["fiction", "sci-fi"] }` |
| `{ "gt": v }` | `> ?` | `{ "price": { "gt": 10 } }` |
| `{ "gte": v }` | `>= ?` | `{ "price": { "gte": 10 } }` |
| `{ "lt": v }` | `< ?` | `{ "price": { "lt": 50 } }` |
| `{ "lte": v }` | `<= ?` | `{ "price": { "lte": 50 } }` |
| `{ "ne": v }` | `!= ?` | `{ "status": { "ne": "deleted" } }` |
| `{ "like": v }` | `LIKE ?` | `{ "title": { "like": "%gatsby%" } }` |
| `{ "ilike": v }` | `LIKE ? (case-insensitive)` | `{ "name": { "ilike": "%john%" } }` |

**Pagination Modes:**

*Offset pagination* (default):
```json
{ "paginationMode": "offset", "limit": 20, "offset": 0 }
```
Response includes: `{ "total": 47, "offset": 0, "limit": 20, "hasMore": true }`

*Cursor pagination* (for large datasets):
```json
{ "paginationMode": "cursor", "limit": 20, "cursor": "<base64-encoded-cursor>" }
```
Response includes: `{ "nextCursor": "<base64>", "hasMore": true }`

Cursor pagination uses composite cursors (primary sort field + tie-breaker) for stable ordering.

**Behavior:**
- Applies `owner_id` filter unless `ownerScope: 'shared'`
- Auto-excludes soft-deleted records (`deleted_at IS NULL`) unless explicitly filtering on `deleted_at`
- Supports column projection via `select`
- Maximum limit: 500 (default: 50)

### sys_update

Updates an existing record.

**Parameters:**
```json
{
  "id": 42,
  "data": {
    "price": 14.99,
    "status": "reserved"
  }
}
```

**Behavior:**
- Checks record ownership (user-scoped) or admin permission (shared-scope)
- Prevents modification of protected fields: `id`, `owner_id`, `created_at`
- Rejects empty update payloads
- Auto-sets `updated_at`
- Detects unique constraint violations
- Uses `RETURNING *`

### sys_delete

Deletes a record.

**Parameters:**
```json
{ "id": 42 }
```

**Behavior:**
- Checks ownership before deletion
- If model has `softDelete: true`: sets `deleted_at` and `updated_at` timestamps
- If model has `softDelete: false`: hard deletes the row

**Response:**
```json
{ "success": true, "data": { "deleted": true, "id": 42, "soft": true } }
```

---

## Custom Handlers

For logic that goes beyond simple CRUD — aggregations, multi-table operations, external API calls — the AI builder agent defines custom handlers.

### Handler Execution Flow

```
1. Router identifies method as custom handler
2. Find handler config by name
3. Check authentication (authLevel + handlerType)
4. Validate inputs against handler.inputs schema (Zod)
5. Build HandlerContext
6. Resolve handler function from compiled registry
7. Execute with 10-second timeout
8. Validate outputs against handler.outputs schema
9. Return response
```

### HandlerContext

Every handler receives a `HandlerContext` object:

```typescript
{
  db: D1Database,                    // Direct database access (SQLite, D1-shaped API)
  batch: (stmts) => Promise<any[]>,  // Atomic batch execution
  user: {
    id: string,                      // Authenticated user ID
    email: string,                   // User email
    roles: string[]                  // User roles
  },
  params: Record<string, unknown>,   // Validated input parameters
  log: {
    debug, info, warn, error         // Structured logger
  },
  config: {
    appId: string,                   // App UUID
    appAlias: string                 // App alias
  },
  models: Record<string, ModelConfig>, // All model configs (keyed by name)
}
```

### Handler Compilation

Handlers are compiled from TypeScript source files:

1. Source `.tsx` files in the app's `repo/backend/handlers/`
2. Compiled via esbuild (`@exepad/deploy-utils`) to ES modules at deploy time
3. Written to `{appId}/{mode}/modules/handlers/{method}.js`, alongside a
   `{appId}/{mode}/worker-manifest.json` listing them
4. Loaded on first use by the per-app handler registry
   (`apps/app-backend/src/handlers/app-registry.ts`), cached per `{appId, mode}`
   and invalidated when the manifest's content hash changes (i.e. on redeploy)

Because one Node process serves every app, handlers are resolved **per app+mode**
rather than through a process-global map, and each module is instantiated in a
constrained `node:vm` context: standard JS intrinsics, a prefixed `console`, and
an allowlisted `fetch` (`EXEPAD_FETCH_ALLOWLIST`, default-deny). No `require`,
`process`, or `fs`. `ctx` — including `ctx.db`, this app's SQLite handle — is
passed as a call argument, not as a global.

> **Trust model:** `node:vm` is not a security boundary. This is safe under the
> single-author assumption (you trust the apps you generate in your own
> container); hosting apps from multiple untrusted authors in one container is
> not supported. See the module comment in `app-registry.ts` for the full
> rationale and upgrade path.

### Handler Function Signature

```typescript
async function getDashboardStats(ctx: HandlerContext): Promise<unknown> {
  const { db, user, params, log } = ctx;

  const result = await db.prepare(
    'SELECT COUNT(*) as total FROM books WHERE owner_id = ?'
  ).bind(user.id).first();

  return { totalBooks: result.total };
}
```

---

## Authentication & Authorization

### Request Authentication

Authentication supports two modes:

**Mode A (Gateway-forwarded):** The Runtime API Gateway reads from the platform session and forwards identity via headers:

| Header | Description |
|--------|-------------|
| `X-User-Id` | Authenticated user's ID |
| `X-User-Email` | User's email address |
| `X-User-Roles` | Comma-separated role list |
| `X-Service-Token` | Service-to-service auth token |
| `X-Request-Id` | Optional request tracing ID |

**Mode B (Per-app session):** When `security` is configured, the app-backend validates a per-app session token:

| Header | Description |
|--------|-------------|
| `X-Session-Token` | Per-app session cookie/token validated against the app's database |

Mode B takes priority when present. If neither mode provides identity, the request proceeds as unauthenticated.

### Authorization Levels

The `AccessLevel` type controls who can access CRUD operations and custom handlers:

| Level | Description |
|-------|-------------|
| `public` | No authentication required (reads only — writes still require auth) |
| `authenticated` | User must be logged in |
| `role:X` | User must have role X directly, or inherit it via `roleHierarchy` |
| `owner` | Only the record owner (valid in `crudPolicy` only, enforced by ownerScope) |
| `none` | Permanently blocked — always returns 403 (valid in `crudPolicy` only) |
| `admin` | **Deprecated** — legacy shorthand for `role:admin` |

**Role hierarchy:** When `security.roleHierarchy` is configured (e.g., `{ "admin": ["editor"] }`), the `checkAuth` function checks direct role membership first, then inherited roles via the pre-resolved expansion map. This allows `admin` users to access `role:editor` endpoints without explicit assignment.

### Security Guards

- **H1**: Service token verification — only the runtime gateway, which stamps the matching `X-Service-Token`, can reach the backend
- **H8**: Write operations (`create`, `update`, `delete`) always require authentication, even if the CRUD policy says `public`. This prevents empty `owner_id` on inserts.
- **Access level `'none'`**: Any operation on a model with `crudPolicy.X: "none"` is always rejected with 403, regardless of the user's role or authentication status.

---

## Error Handling

All errors follow a consistent response format:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Field 'title' is required",
    "details": { ... },
    "field": "title"
  }
}
```

### Error Types

| Error | HTTP Status | Code | Description |
|-------|-------------|------|-------------|
| InvalidRequest | 400 | `INVALID_REQUEST` | Malformed request |
| Validation | 400 | `VALIDATION_ERROR` | Input validation failed |
| NotFound | 404 | `NOT_FOUND` | Record not found |
| Unauthorized | 401 | `UNAUTHORIZED` | Not authenticated |
| Forbidden | 403 | `FORBIDDEN` | Insufficient permissions |
| MethodNotAllowed | 405 | `METHOD_NOT_ALLOWED` | Invalid RPC method |
| Conflict | 409 | `CONFLICT` | Unique constraint violation |
| Database | 500 | `DATABASE_ERROR` | SQL query failure |
| Handler | 500 | `HANDLER_ERROR` | Custom handler failure |
| RateLimited | 429 | `RATE_LIMITED` | Rate limit exceeded |

---

## Rate Limiting

Fixed-window rate limiting over the `RATE_LIMIT_KV` store. In the self-hosted
container that store is an in-memory shim held per `{appId, mode}` for the life
of the process, so one app's traffic can never throttle another's and preview
never shares counters with published.

- **Window**: `EXEPAD_RATE_LIMIT_WINDOW` seconds (default: 60)
- **Max requests**: `EXEPAD_RATE_LIMIT_MAX` per window (default: 1200)
- **Fail-open**: If the store is unavailable, requests are allowed through
- **Headers**: `X-RateLimit-Remaining`, `X-RateLimit-Reset`

The generic per-identity cap is deliberately generous — it is a DoS backstop,
not the auth gate. Login/signup attempts go through a separate, tighter,
account-keyed throttle inside the app-backend.

---

## Metrics

The backend emits per-request metrics (operation type, model name, user ID,
success/error status, duration, HTTP status) to an optional `ANALYTICS` binding.
Emission is fire-and-forget and never blocks or fails a request; with no binding
configured — the default in the self-hosted container — every call is a no-op.

---

## MCP Endpoint

The app-backend also exposes a `POST /mcp` endpoint implementing the Model Context Protocol (Streamable HTTP transport, JSON-RPC 2.0, protocol version `2024-11-05`). This enables AI agents to discover and call app tools via a standardized protocol.

**Source:** `src/mcp/`

### Enabling MCP

MCP is gated by the `mcp` field in `InjectedConfig`:

```json
{ "mcp": { "enabled": true } }
```

If `mcp.enabled` is false or absent, `POST /mcp` returns 404.

### Auth

MCP accepts two auth modes (checked before service token verification):

| Mode | Mechanism |
|------|-----------|
| API Key | `Authorization: Bearer exepad_sk_*` — scopes enforced identically to RPC |
| Gateway JWT | HS256 verified against `GATEWAY_JWT_SECRET` (iss: `exepad-gateway`); the `app_id` claim must match the app being served, so a token minted for one app cannot be replayed against another |

`GATEWAY_JWT_SECRET` is unset by default in the self-hosted container, which
means the JWT mode is inert and API keys are the practical path.

### Supported Methods

| Method | Description |
|--------|-------------|
| `initialize` | Returns server info (`{appAlias} (Exepad)`), protocol version, capabilities |
| `tools/list` | Lists CRUD + handler tools from `discoverTools()` |
| `tools/call` | Executes a named tool via `executeTool()` — same code path as RPC |
| `resources/list` | Returns empty list (no resources) |
| `ping` | Returns `{}` |

Tool names follow `{model}__{operation}` (CRUD) and `handler__{name}` (custom handler) conventions from the tool discovery layer.

### Request Lifecycle

```
POST /mcp
  │
  ├── Intercepted in index.ts before SERVICE_TOKEN check
  ├── Config gate: mcp.enabled must be true
  ├── Auth: API key (via extractUserContext) OR gateway JWT (verifyGatewayToken)
  ├── Parse JSON-RPC body (reject arrays — no batch support)
  ├── Dispatch to handleMcpMethod() → tools/list, tools/call, etc.
  └── Return JSON-RPC response (200) or notification acknowledgement (202)
```

---

## Related Documents

- [Configuration Reference](07-configuration-reference.md) — ModelConfig and HandlerConfig schemas
- [Architecture](02-architecture.md) — End-to-end request flow
- [Deployment](10-deployment.md) — deploy pipeline, SQLite provisioning, and local adapters
