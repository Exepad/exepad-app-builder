# Authorization & Data Scoping

## CRUD Policies

Each model defines per-operation authorization levels via `crudPolicy`:

```json
{
  "name": "contacts",
  "crudPolicy": {
    "create": "authenticated",
    "read": "public",
    "list": "public",
    "update": "authenticated",
    "delete": "admin"
  }
}
```

### Authorization Levels

| Level | Requirement |
|-------|-------------|
| `public` | No authentication needed (read operations only — see below) |
| `authenticated` | User must be logged in (any auth mode) |
| `role:X` | User must have role X directly or via role hierarchy |
| `owner` | Only the record owner — valid only in `crudPolicy` |
| `none` | Permanently blocked (always 403) — valid only in `crudPolicy` |
| `admin` | **Deprecated** — legacy shorthand for `role:admin`, normalized at deploy time |

These levels form the `AccessLevel` type: `'public' | 'authenticated' | 'role:${string}' | 'owner' | 'none'`.

If a model doesn't define a `crudPolicy` for an operation, it defaults to `authenticated`.

### Write Operations Always Require Auth

Even if a model's create/update/delete policy is set to `public`, the backend **always requires authentication for write operations**. This prevents anonymous users from creating records with an empty `owner_id`, which would cause data leakage in shared-scope models.

```
crudPolicy.create = "public"  →  still requires authentication
crudPolicy.read   = "public"  →  truly public (no auth needed)
```

### Role Hierarchy

Roles can inherit permissions from other roles via `security.roleHierarchy`:

```json
{
  "security": {
    "roles": ["admin", "editor", "viewer"],
    "roleHierarchy": {
      "admin": ["editor"],
      "editor": ["viewer"]
    }
  }
}
```

With this config, an `admin` user can access endpoints that require `role:editor` or `role:viewer`. The hierarchy is resolved into a flat expansion map at deploy time:

| User Role | Expanded To |
|-----------|-------------|
| `admin` | `admin`, `editor`, `viewer` |
| `editor` | `editor`, `viewer` |
| `viewer` | `viewer` |

The `checkAuth` function checks direct role membership first, then falls back to the expansion map. Circular hierarchies are rejected by the security validator at deploy time.

### Method-to-Policy Mapping

| Method | Policy field checked |
|--------|---------------------|
| sys_create | `crudPolicy.create` |
| sys_read | `crudPolicy.read` |
| sys_list | `crudPolicy.list` |
| sys_update | `crudPolicy.update` |
| sys_delete | `crudPolicy.delete` |
| sys_upsert | `crudPolicy.create` (may insert new rows) |
| sys_aggregate | `crudPolicy.list` |
| sys_batch | Each operation checked individually |
| sys_multi_query | `crudPolicy.list` on all referenced models |
| sys_file_read / list / delete | `storage.filePolicy` (FilePolicyProps) + `owner_id` scope + visibility (`private` / `shared` / `public`) |
| POST /files (upload) | `storage.filePolicy.upload` + per-user/per-IP quotas |

---

## Owner Scoping

Every record has an `owner_id` column set to the authenticated user's ID at creation time. Owner scoping determines who can see and modify records.

### User Scope (default)

Records are filtered by `WHERE owner_id = <current_user_id>`. Each user only sees their own data.

```json
{ "ownerScope": "user" }
```

### Shared Scope

All authenticated users see all records. No `owner_id` filtering on reads.

```json
{ "ownerScope": "shared" }
```

**Update/delete in shared scope:** ownership is still checked — only the record's owner or a user with the `admin` role can modify or delete a shared record.

### Public Read + User Scope Warning

If a model has `crudPolicy.read: "public"` but `ownerScope: "user"` (default), public (unauthenticated) reads will return **empty results** because the `owner_id` filter still applies with an empty user ID. `validateConfig()` logs a warning when the app's config is loaded (`src/rpc/router.ts`):

```
Model 'contacts': crudPolicy.read is 'public' but ownerScope is 'user'.
Public (unauthenticated) reads will return empty results because owner_id
filtering still applies. Consider setting ownerScope: 'shared'.
```

---

## Protected Fields

The following system fields cannot be set or modified by users:

| Field | Create | Update | Notes |
|-------|--------|--------|-------|
| `id` | Auto-generated | Cannot update | Primary key |
| `owner_id` | Auto-set from authenticated user | Cannot update | Prevents ownership transfer |
| `created_at` | Auto-set (ISO timestamp) | Cannot update | Immutable creation time |
| `updated_at` | Auto-set | Auto-updated | Always reflects last modification |
| `deleted_at` | — | Set by sys_delete (soft) | Soft delete timestamp |

On `sys_update`, protected fields (`id`, `owner_id`, `created_at`) are **silently stripped** from the payload — no error is returned.

---

## Service Token

The `X-Service-Token` header proves a request came from the runtime's API gateway rather than from arbitrary code that reached the backend some other way. The gateway stamps it (`routes/gateway/auth.ts`); callers never supply it themselves.

### Verification Rules

| Method prefix | Service token required? |
|--------------|------------------------|
| `auth_*` | Never — browsers call these through the gateway before they have an identity |
| Everything else (`sys_*`, `admin_*`, `sys_dev_*`, custom handlers) | Yes |

When `SERVICE_TOKEN` is unset, behavior depends on `ENVIRONMENT`: in
`production` / `staging` / `selfhost` the request is **rejected** (fail closed —
an unset token there is a misconfiguration, and trusting forged `X-User-*`
headers would be worse); in development, verification is skipped. The
self-hosted runtime always populates a token, generating an ephemeral one if
none is configured.

If `SERVICE_TOKEN` is not set (e.g., local development), verification is skipped entirely.

---

## MCP Scope Enforcement

When a request arrives via `POST /mcp`, the `executeTool()` function applies API key scope checks identical to the RPC router. The `UserContext.apiKeyScopes` field (populated by either Mode C API key or Mode D gateway JWT) is checked via `hasScope()` before executing any tool.

### CRUD Tool Scopes

Each CRUD tool requires a scope matching `model:{modelName}:{operation}`:

| Tool | Required Scope |
|------|---------------|
| `contacts__create` | `model:contacts:create` |
| `contacts__read` | `model:contacts:read` |
| `contacts__list` | `model:contacts:list` |
| `contacts__update` | `model:contacts:update` |
| `contacts__delete` | `model:contacts:delete` |

The wildcard scope `*` grants access to all tools.

### Handler Tool Scopes

Handler tools require `handler:{handlerName}` (e.g., `handler:getStats`).

### Gateway JWT Scopes

The dev service gateway currently mints JWTs with `scopes: ["*"]`, granting full access. If stricter per-tool scoping is needed, the gateway can embed narrower scopes in the JWT payload.

---

## Role-Based Access

User roles are stored in the `_auth_users.roles` column. Two formats are supported:

- **JSON array** (preferred): `'["admin","editor"]'`
- **Legacy comma-separated**: `'admin,editor'`

The `parseRoles()` function handles both formats transparently. Null or empty values return an empty array.

### How Roles Are Set

- **Mode A:** `X-User-Roles` header (e.g., `admin,editor`)
- **Mode B:** `roles` column in `_auth_users` table (assigned on signup via `security.defaultRole`)

### Admin Role Privileges

Users with the `admin` role can:
- Access endpoints with `crudPolicy: "admin"` or `crudPolicy: "role:admin"`
- Update/delete any record in shared-scope models (bypasses owner check)
- Send notifications via `notification_send`

**Note:** The legacy `"admin"` level is automatically normalized to `"role:admin"` at deploy time. Both forms work identically.

---

## Page Access Control

Pages can restrict access via the `access` field:

```json
{
  "pages": [
    { "slug": "/", "title": "Home", "access": "public" },
    { "slug": "/dashboard", "title": "Dashboard", "access": "authenticated" },
    { "slug": "/admin", "title": "Admin", "access": "role:admin" }
  ]
}
```

Pages without an explicit `access` field inherit `security.defaultAccess` (default: `'public'`).

**Frontend enforcement:**
- **Unauthenticated user** on a protected page → redirected to login with `?returnUrl=` parameter
- **Wrong role** → shown a 403 Forbidden page
- **Loading** → access check deferred (prevents navigation flash)

Navigation items for inaccessible pages are automatically hidden. The `useHiddenSlugs` hook computes which slugs the current user cannot access, and the Sidebar and Navbar components filter them out.

---

## Custom Handler Authorization

Custom handlers use their own `authLevel` setting:

```json
{
  "name": "generateReport",
  "authLevel": "authenticated",
  "handlerType": "read"
}
```

- **Write handlers** (default `handlerType`): Always require authentication (same as CRUD writes)
- **Read handlers** (`handlerType: "read"`): Respect `authLevel` as-is (can be `public`)
- Handlers bypass CRUD authorization entirely — they have direct database access
