# API Reference

## Where requests go

The paths in this document (`/rpc`, `/mcp`, `/files/*`, `/health`) are the
app-backend's **own** surface. It is not listening on a port of its own — the
runtime worker dispatches to it in-process. From outside, address an app through
the runtime's API gateway:

| You want | URL |
|---|---|
| Published app | `POST http://localhost:8080/api/{appId}/rpc` |
| Preview build | `POST http://localhost:8080/api/preview-{appId}/rpc` |

Port `8080` is the container's published port; `./run.sh local` serves the same
gateway on `:8090`. A published app may also be addressed by its friendly slug
in place of `{appId}`. Preview requests require an authenticated operator; the
gateway stamps the identity headers and the service token before dispatching, so
callers never send `X-Service-Token` themselves.

## RPC Protocol

All operations go through a single endpoint:

```
POST /rpc
Content-Type: application/json

{
  "method": "<method_name>",
  "params": { ... },
  "model": "<model_name>"    // required for CRUD methods
}
```

### Response Format

**Success:**
```json
{
  "success": true,
  "data": { ... },
  "pagination": { ... }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Description of what went wrong",
    "details": { ... },
    "field": "email"
  }
}
```

### Health Check

```
GET /health
```

Returns: `{ "status": "ok", "appId": "...", "timestamp": "..." }`

### Response Headers

Every response includes:
- `X-Request-Id` — Unique request identifier for tracing
- `Access-Control-Allow-Origin` — CORS origin
- `X-RateLimit-Remaining` — Remaining requests in window (when rate limiting is active)
- `X-RateLimit-Reset` — Epoch seconds when window resets (when rate limiting is active)

---

## MCP Protocol

The backend also exposes a `POST /mcp` endpoint implementing the Model Context Protocol (Streamable HTTP transport, JSON-RPC 2.0, protocol version `2024-11-05`). This enables AI agents (Claude Desktop, Cursor, etc.) to discover and call the same CRUD and handler tools via a standardized protocol. The runtime gateway forwards `/api/{appId}/mcp` through unchanged — it adds no auth of its own.

### Config Gate

MCP must be explicitly enabled in the app config:

```json
{ "mcp": { "enabled": true } }
```

If `mcp.enabled` is false or absent, `POST /mcp` returns `404`. `GET /mcp` and `DELETE /mcp` always return `405`.

### Authentication

Two token types are accepted (no `X-Service-Token` required — `/mcp` is processed before service token verification):

| Type | Format | Source |
|------|--------|--------|
| API Key | `exepad_sk_*` | Per-app secret key issued by the app's own auth (`src/auth/api-keys.ts`) — the path used in self-host |
| Gateway JWT | HS256 JWT | Verified against `GATEWAY_JWT_SECRET` (iss: `exepad-gateway`, must carry a matching `app_id`). The self-hosted runtime binds no such secret and mints no such tokens, so this branch is dormant — it exists for an external issuer. |

See [Authentication — MCP Modes](authentication.md#mcp-authentication-modes) for details.

### Request Format (JSON-RPC 2.0)

```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": { "name": "contacts__list", "arguments": {} }
}
```

- Batch requests (JSON arrays) are rejected with `-32600 Invalid Request`
- Notifications (requests without an `id` field) return `202 Accepted` with an empty body

### Methods

| Method | Description |
|--------|-------------|
| `initialize` | Returns server info (`{appAlias} (Exepad)`), protocol version `2024-11-05`, capabilities |
| `notifications/initialized` | Acknowledges client initialization (no-op) |
| `tools/list` | Returns available CRUD + handler tools from `discoverTools()` |
| `tools/call` | Executes a named tool via `executeTool()` — same code path as RPC |
| `resources/list` | Always returns `{ resources: [] }` |
| `ping` | Returns `{}` |

### Tool Naming

| Pattern | Example | Description |
|---------|---------|-------------|
| `{model}__{operation}` | `contacts__create` | CRUD operation (create, read, list, update, delete) |
| `handler__{name}` | `handler__getStats` | Custom handler execution |

### Tool Call Example

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "id": 1,
  "params": {
    "name": "contacts__create",
    "arguments": { "name": "Alice", "email": "alice@example.com" }
  }
}
```

**Success response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "{\"success\":true,\"data\":{\"id\":1,...}}" }]
  }
}
```

**Error response (tool failure):**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [{ "type": "text", "text": "Error: API key lacks scope: model:contacts:create" }],
    "isError": true
  }
}
```

Tool execution errors are returned as `result.isError = true`, **not** as JSON-RPC `error`. The `error` field is reserved for protocol-level errors only.

### Error Codes

Protocol-level errors use standard JSON-RPC error codes:

| Code | Constant | Meaning |
|------|----------|---------|
| `-32700` | `PARSE_ERROR` | Invalid JSON body |
| `-32600` | `INVALID_REQUEST` | Invalid JSON-RPC structure or batch request |
| `-32601` | `METHOD_NOT_FOUND` | Unknown MCP method |
| `-32602` | `INVALID_PARAMS` | Missing or invalid parameters (e.g., no `name` in tools/call) |
| `-32603` | `INTERNAL_ERROR` | Auth failure (returns HTTP 401) |

---

## CRUD Methods

All CRUD methods require a `model` field identifying the target table. System columns (`id`, `owner_id`, `created_at`, `updated_at`, `deleted_at`) are managed automatically.

### sys_create

Create a new record.

**Params:**
```json
{
  "data": {
    "name": "John Doe",
    "email": "john@example.com"
  }
}
```

**Response:** The full created record including `id`, `owner_id`, `created_at`, `updated_at`.

**Behavior:**
- Auto-assigns `owner_id` from the authenticated user
- Auto-sets `created_at` and `updated_at` timestamps
- Applies default values for missing optional columns
- Coerces string types (e.g., `"123"` → `123` for integer columns)
- Validates against model schema (required fields, types)
- Returns the created record via `RETURNING *` (single query)
- Detects UNIQUE constraint violations and returns a field-specific error

**Example:**
```bash
curl -X POST http://localhost:8080/api/my-app/rpc \
  -H "Content-Type: application/json" \
  -d '{
    "method": "sys_create",
    "model": "contacts",
    "params": {
      "data": { "name": "Jane Smith", "email": "jane@example.com", "company": "Acme Inc" }
    }
  }'
```

---

### sys_read

Read a single record by ID.

**Params:**
```json
{
  "id": 42
}
```

**Response:** The full record, or a 404 error if not found.

**Behavior:**
- Applies owner scoping (unless model has `ownerScope: "shared"`)
- Automatically parses JSON columns

---

### sys_list

List records with pagination, filtering, sorting, and search.

**Params:**
```json
{
  "filters": { "status": "active", "priority": { "gte": 3 } },
  "orderBy": { "created_at": "desc" },
  "limit": 25,
  "offset": 0,
  "select": ["id", "name", "status"],
  "paginationMode": "offset",
  "search": "john",
  "searchFields": ["name", "email"]
}
```

All params are optional.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `filters` | object | `{}` | Filter conditions (see [Filtering](#filtering)) |
| `orderBy` | object | `{}` | Sort order, e.g. `{ "created_at": "desc" }` |
| `limit` | number | `50` | Page size (1–500) |
| `offset` | number | `0` | Page offset (offset mode only) |
| `select` | string[] | all | Columns to return |
| `cursor` | string | — | Opaque cursor from previous page (cursor mode) |
| `paginationMode` | string | `"offset"` | `"offset"` or `"cursor"` |
| `search` | string | — | Full-text search term |
| `searchFields` | string[] | all text columns | Columns to search across |

**Response (offset mode):**
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "total": 142,
    "offset": 0,
    "limit": 25,
    "hasMore": true
  }
}
```

**Response (cursor mode):**
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "limit": 25,
    "hasMore": true,
    "nextCursor": "eyJmIjoiY3Jl..."
  }
}
```

**Behavior:**
- Soft-deleted records (`deleted_at IS NOT NULL`) are automatically excluded
- Offset mode runs a parallel `COUNT(*)` query for the `total` field
- Cursor mode uses keyset pagination with a composite cursor (sort field + primary key tie-breaker)
- Search uses case-insensitive `LIKE %term%` across specified or all text columns

---

### sys_update

Update an existing record.

**Params:**
```json
{
  "id": 42,
  "data": {
    "name": "Updated Name",
    "status": "completed"
  }
}
```

**Response:** The full updated record.

**Behavior:**
- Protected fields (`id`, `owner_id`, `created_at`) are silently stripped from the payload
- Auto-updates `updated_at` timestamp
- Rejects empty payloads (no fields to update)
- Ownership check: user-scoped models require `owner_id` match; shared-scope models allow owner or admin
- Detects UNIQUE constraint violations

---

### sys_delete

Delete a record (soft or hard).

**Params:**
```json
{
  "id": 42,
  "soft": true
}
```

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string/number | required | Record ID |
| `soft` | boolean | `true` (if model has `softDelete`) | `true` = set `deleted_at`, `false` = permanent delete |

**Response:**
```json
{
  "success": true,
  "data": { "deleted": true, "id": 42, "soft": true }
}
```

**Behavior:**
- Soft delete: sets `deleted_at` and `updated_at` timestamps
- Hard delete: removes the row permanently
- Defaults to soft delete when the model has `softDelete: true`
- Ownership check: same as sys_update

---

### sys_upsert

Insert or update a record. Uses `INSERT ... ON CONFLICT(pk) DO UPDATE`.

**Params:** Same as `sys_create` — the primary key field must be present in `data`.

**Response:** The created or updated record.

**Behavior:**
- On conflict (existing primary key), updates all non-system columns
- Uses `create` CRUD policy for authorization
- Validates with create-level validation (all required fields must be present)

---

### sys_aggregate

Compute aggregations (COUNT, SUM, AVG, MIN, MAX) with optional GROUP BY.

**Params:**
```json
{
  "aggregations": [
    { "function": "count", "alias": "total" },
    { "function": "sum", "field": "amount", "alias": "total_amount" },
    { "function": "avg", "field": "rating", "alias": "avg_rating" }
  ],
  "filters": { "status": "completed" },
  "groupBy": ["category"],
  "orderBy": { "total_amount": "desc" }
}
```

| Param | Type | Description |
|-------|------|-------------|
| `aggregations` | array | Required. Each: `{ function, field?, alias }` |
| `aggregations[].function` | string | `count`, `sum`, `avg`, `min`, or `max` |
| `aggregations[].field` | string | Column name (required for non-count functions) |
| `aggregations[].alias` | string | Output column name (alphanumeric + underscores) |
| `filters` | object | Same filter syntax as sys_list |
| `groupBy` | string[] | Columns to group by |
| `orderBy` | object | Sort by aliases or groupBy fields |

**Response:**
```json
{
  "success": true,
  "data": [
    { "category": "electronics", "total": 45, "total_amount": 12500 },
    { "category": "clothing", "total": 23, "total_amount": 4800 }
  ]
}
```

**Authorization:** Uses the model's `list` CRUD policy.

---

### sys_batch

Execute multiple write operations atomically in a single database transaction. If any operation fails, all are rolled back.

**Params:**
```json
{
  "operations": [
    {
      "method": "sys_create",
      "model": "tasks",
      "params": { "data": { "title": "New task" } }
    },
    {
      "method": "sys_update",
      "model": "contacts",
      "params": { "id": 5, "data": { "status": "active" } }
    },
    {
      "method": "sys_delete",
      "model": "tags",
      "params": { "id": 3 }
    }
  ]
}
```

**Constraints:**
- Maximum **50 operations** per batch
- Only write methods allowed: `sys_create`, `sys_update`, `sys_delete`
- Read operations (`sys_read`, `sys_list`, `sys_aggregate`) are not allowed
- Nested `sys_batch` is not allowed
- Authorization is checked per operation
- Full validation pass runs before executing ANY SQL

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      { "success": true, "method": "sys_create", "model": "tasks", "data": { ... } },
      { "success": true, "method": "sys_update", "model": "contacts", "data": { ... } },
      { "success": true, "method": "sys_delete", "model": "tags", "data": { "deleted": true, "id": 3 } }
    ]
  }
}
```

---

### sys_multi_query

Execute multiple read operations concurrently in a single request. Each query is isolated — one failure doesn't affect others.

**Params:**
```json
{
  "queries": [
    {
      "alias": "recent_tasks",
      "model": "tasks",
      "method": "sys_list",
      "params": { "orderBy": { "created_at": "desc" }, "limit": 5 }
    },
    {
      "alias": "task_count",
      "model": "tasks",
      "method": "sys_aggregate",
      "params": { "aggregations": [{ "function": "count", "alias": "total" }] }
    },
    {
      "alias": "contact_detail",
      "model": "contacts",
      "method": "sys_read",
      "params": { "id": 1 }
    }
  ]
}
```

**Constraints:**
- Maximum **50 queries** per request
- Only read methods: `sys_list`, `sys_read`, `sys_aggregate`
- All queries run concurrently via `Promise.allSettled`
- Authorization uses `list` policy on all models

**Response:**
```json
{
  "success": true,
  "data": {
    "results": [
      { "alias": "recent_tasks", "success": true, "data": [...], "pagination": { ... } },
      { "alias": "task_count", "success": true, "data": [{ "total": 42 }] },
      { "alias": "contact_detail", "success": true, "data": { ... } }
    ]
  }
}
```

---

## Filtering

Filters are passed in the `filters` parameter of `sys_list` and `sys_aggregate`.

### Basic Equality

```json
{ "filters": { "status": "active" } }
```

### Operators

Use an object value with an operator key:

```json
{
  "filters": {
    "priority": { "gte": 3 },
    "created_at": { "gt": "2024-01-01" },
    "name": { "like": "%john%" },
    "email": { "ilike": "%@example.com" }
  }
}
```

| Operator | SQL | Description |
|----------|-----|-------------|
| `gt` | `>` | Greater than |
| `gte` | `>=` | Greater than or equal |
| `lt` | `<` | Less than |
| `lte` | `<=` | Less than or equal |
| `ne` | `!=` | Not equal |
| `like` | `LIKE` | Pattern match (case-sensitive) |
| `ilike` | `LIKE` (lower) | Pattern match (case-insensitive) |

### Array Filters (IN clause)

Pass an array value for equality-in-set matching:

```json
{ "filters": { "status": ["active", "pending"] } }
```

Maximum **100 items** per array filter.

### Null Filters

```json
{ "filters": { "deleted_at": null } }
```

---

## Pagination

### Offset Mode (default)

Traditional LIMIT/OFFSET pagination. Best for small-to-medium datasets where you need a total count.

```json
{ "paginationMode": "offset", "limit": 25, "offset": 50 }
```

Response includes `total`, `offset`, `limit`, `hasMore`.

### Cursor Mode

Keyset pagination for efficient large-dataset traversal. No total count is computed.

```json
{ "paginationMode": "cursor", "limit": 25 }
```

For subsequent pages, pass the `nextCursor` from the previous response:

```json
{ "paginationMode": "cursor", "limit": 25, "cursor": "eyJmIjoiY3Jl..." }
```

Response includes `limit`, `hasMore`, `nextCursor`.

The cursor is an opaque Base64-encoded token containing the sort field value and a primary key tie-breaker to handle duplicate values correctly.

---

## Development Methods

### sys_dev_setup

Execute DDL statements to set up schemas for example apps. Only available when `ENVIRONMENT=development`.

**Params:**
```json
{ "statements": ["CREATE TABLE IF NOT EXISTS ...", "CREATE INDEX IF NOT EXISTS ..."] }
```

**Response:** `{ "executed": 5, "total": 5 }`

---

## File Methods

File metadata operations are available as RPC methods when `storage` is configured in the app config:

| Method | Description |
|--------|-------------|
| `sys_file_read` | Read a single file record by ID |
| `sys_file_list` | List file records (supports `ownerScope`) |
| `sys_file_delete` | Delete a file (removes the stored object + its database row, with rollback if the row delete fails) |

Upload and serve are HTTP path-routed, **not** RPC:

| Endpoint | Description |
|----------|-------------|
| `POST /files` | Upload (multipart). Enforces per-user uploads/hour, bytes/hour, per-IP limits, SVG sanitization, executable blocklist. |
| `GET /files/{id}/{filename}` | Serve a file by ID (auth enforced per `FilePolicyProps`, including `visibility: private \| shared \| public`). |

---

## Auth Methods

Auth methods are available when the app's config includes a `security` block with `authProviders`. They do **not** require an `X-Service-Token` header and do **not** use the `model` field.

See [Authentication](authentication.md) for full implementation details.

### auth_signup

Register a new user account.

**Params:**
```json
{ "method": "auth_signup", "params": { "email": "user@example.com", "password": "secureP@ss1", "name": "Jane Doe" } }
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | User email (normalized to lowercase) |
| `password` | string | Yes | Must pass `security.passwordPolicy` validation |
| `name` | string | No | Display name |

**Response:** User object + `Set-Cookie` header with session token.

**Errors:** `VALIDATION_ERROR` (400) for missing/invalid fields, `CONFLICT` (409) for duplicate email, `METHOD_NOT_ALLOWED` (405) if signup disabled.

---

### auth_signin

Log in with email and password.

**Params:**
```json
{ "method": "auth_signin", "params": { "email": "user@example.com", "password": "secureP@ss1" } }
```

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `email` | string | Yes | User email |
| `password` | string | Yes | User password |

**Response:** User object + `Set-Cookie` header with session token.

**Errors:** `UNAUTHORIZED` (401) — always returns generic "Invalid email or password" to prevent user enumeration.

---

### auth_signout

Invalidate the current session and clear the cookie.

**Params:**
```json
{ "method": "auth_signout" }
```

No params required. Reads `X-Session-Token` header from the request.

**Response:** `{ "success": true, "data": {} }` + `Set-Cookie` with `Max-Age=0`.

**Errors:** `UNAUTHORIZED` (401) if no session token present.

---

### auth_me

Get the current authenticated user's profile.

**Params:**
```json
{ "method": "auth_me" }
```

No params required.

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-v4",
      "email": "user@example.com",
      "name": "Jane Doe",
      "avatar_url": null,
      "roles": ["editor", "viewer"],
      "email_verified": false
    }
  }
}
```

**Behavior:** Mode B sessions look up the user in the app database. Mode A (platform headers) returns user info directly from headers.

**Errors:** `UNAUTHORIZED` (401) if not authenticated.

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_REQUEST` | 400 | Bad request format (wrong method, missing Content-Type, invalid JSON) |
| `VALIDATION_ERROR` | 400 | Field-level validation failure (type mismatch, missing required field, constraint) |
| `UNAUTHORIZED` | 401 | Authentication required or invalid session |
| `FORBIDDEN` | 403 | Insufficient permissions (wrong role, missing service token) |
| `NOT_FOUND` | 404 | Resource not found (record or model) |
| `METHOD_NOT_ALLOWED` | 405 | Unknown RPC method |
| `CONFLICT` | 409 | Conflict (e.g., unique constraint) |
| `RATE_LIMITED` | 429 | Too many requests (includes `Retry-After` header) |
| `DATABASE_ERROR` | 500 | Database operation failure |
| `HANDLER_ERROR` | 500 | Custom handler execution failure |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

Body size exceeded returns HTTP 413 with code `INVALID_REQUEST`.
