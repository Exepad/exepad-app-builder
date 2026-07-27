# Authentication

The app-backend supports two authentication modes that can be used independently or together.

## Mode A: Platform Headers

Used when the runtime's API gateway has already authenticated the caller and passes identity via trusted HTTP headers:

| Header | Description |
|--------|-------------|
| `X-User-Id` | User's unique identifier |
| `X-User-Email` | User's email address |
| `X-User-Roles` | Comma-separated role list (e.g., `admin,user`) |

No database validation is performed — the backend trusts these headers from the gateway (`apps/runtime/worker/src/routes/gateway/auth.ts` is the only thing that sets them; they are not accepted from the outside). If `X-User-Id` is empty or absent, the user is treated as unauthenticated.

## Mode B: Per-App Sessions

Email/password authentication with session tokens stored in the app's own database. Requires a `security` block in the app's config.

### Auth Methods

#### auth_signup

Register a new user account.

**Params:**
```json
{ "email": "user@example.com", "password": "secureP@ss1", "name": "Jane Doe" }
```

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
      "roles": ["user"],
      "email_verified": false
    }
  }
}
```

The response also sets a `Set-Cookie` header with the session token (see [Cookie Handling](#cookie-handling)).

**Behavior:**
- Emails are normalized to lowercase and trimmed
- Validates email format and password against the configured policy
- Checks email uniqueness in `_auth_users`
- Hashes password with PBKDF2-SHA256
- Creates user record + account record + session in a single batch
- Can be disabled via `security.allowSignup: false`

#### auth_signin

Log in with email and password.

**Params:**
```json
{ "email": "user@example.com", "password": "secureP@ss1" }
```

**Response:** Same structure as `auth_signup`.

**Behavior:**
- Returns a generic "Invalid email or password" message on failure (prevents user enumeration)
- Uses timing-safe password comparison (prevents timing attacks)
- Creates a new session on each successful login

#### auth_signout

Invalidate the current session and clear the cookie.

**Params:** None (reads `X-Session-Token` header).

**Response:**
```json
{ "success": true, "data": {} }
```

The response sets `Set-Cookie` with `Max-Age=0` to clear the cookie.

**Behavior:**
- Deletes the session record from `_auth_sessions`
- Returns 401 if no session token is present

#### auth_me

Get the current authenticated user's profile.

**Params:** None.

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
      "roles": ["user"],
      "email_verified": false
    }
  }
}
```

**Behavior:**
- Mode B sessions: looks up user from `_auth_users` table
- Mode A platform headers: returns user info directly from headers (no DB lookup)
- Returns 401 if not authenticated

---

## Session Lifecycle

```
1. Client calls auth_signup or auth_signin with email + password
2. Backend validates credentials
3. Backend generates a 32-byte random session token (hex-encoded, 64 chars)
4. Backend hashes the token with SHA-256 and stores the hash in _auth_sessions
5. Backend returns _sessionToken signal in the response data
6. Entry point (index.ts) converts _sessionToken to a Set-Cookie header
7. Browser stores the exepad_app_session cookie
8. Subsequent requests: gateway extracts the cookie and sets X-Session-Token header
9. Backend hashes the token and validates against _auth_sessions (with expiry check)
```

### User Context Resolution Priority

When both headers and session tokens are present, identity is resolved in this order:

1. **X-Session-Token** → Mode B (validate the session against the app database)
2. **X-User-Id** → Mode A (trust platform headers)
3. **Neither** → Unauthenticated (anonymous)

If a session token is present but invalid/expired, resolution falls through to platform headers, then to unauthenticated.

---

## Password Security

| Setting | Value |
|---------|-------|
| Algorithm | PBKDF2-HMAC-SHA256 (Web Crypto) |
| Iterations | 600,000 (OWASP 2023 guidance) |
| Salt | 16 random bytes per password |
| Key length | 32 bytes |
| Storage format | `pbkdf2:<iterations>:<salt_hex>:<hash_hex>` |
| Comparison | Timing-safe XOR comparison |

The iteration count is stored *in* the hash, so raising it stays
backward-compatible: `needsRehash()` flags hashes made with a lower count and
they are transparently re-hashed on the next successful login.

### Password Policy

Configurable via `security.passwordPolicy` in the app config:

| Option | Default | Description |
|--------|---------|-------------|
| `minLength` | 8 | Minimum password length |
| `requireUppercase` | false | Require at least one uppercase letter |
| `requireNumber` | false | Require at least one digit |
| `requireSpecial` | false | Require at least one special character |

---

## Cookie Handling

Session tokens are delivered via HTTP cookies set by the backend's entry point (`src/index.ts`).

| Attribute | Value |
|-----------|-------|
| Name | `exepad_app_session` |
| HttpOnly | Yes (not accessible via JavaScript) |
| Secure | Yes in production, No on localhost |
| SameSite | Lax |
| Path | `/` |
| Max-Age | `security.sessionDuration` (default: 604800 = 7 days) |
| Domain | Derived from the request `Origin` header |

On sign-out, the cookie is cleared by setting `Max-Age=0`.

---

## Token Security

- **Raw token** (64-char hex string) is sent to the browser and never stored server-side
- **SHA-256 hash** of the token is stored in `_auth_sessions.id`
- Even if the database is compromised, tokens cannot be reconstructed from hashes

---

## Auth Tables

These tables are automatically created when auth is enabled.

### _auth_users

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID v4 |
| email | TEXT UNIQUE | Normalized to lowercase |
| password_hash | TEXT | PBKDF2 hash string |
| name | TEXT | Display name (optional) |
| avatar_url | TEXT | Profile image URL (optional) |
| roles | TEXT | JSON array (e.g., `'["admin","editor"]'`) or legacy comma-separated. Parsed by `parseRoles()`. |
| email_verified | INTEGER | 0 or 1 |
| created_at | TEXT | ISO timestamp |
| updated_at | TEXT | ISO timestamp |

### _auth_sessions

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | SHA-256 hash of the raw token |
| user_id | TEXT FK | References `_auth_users.id` |
| expires_at | TEXT | ISO timestamp (checked via `datetime('now')`) |
| created_at | TEXT | ISO timestamp |

### _auth_accounts

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | UUID v4 |
| user_id | TEXT FK | References `_auth_users.id` |
| provider | TEXT | Auth provider (currently `"email"`) |
| provider_account_id | TEXT | Provider-specific ID (email address for email provider) |

### _auth_verification_tokens

| Column | Type | Description |
|--------|------|-------------|
| identifier | TEXT | Email or other identifier |
| token | TEXT | Verification token hash |
| expires_at | TEXT | ISO timestamp |

---

## Role Parsing

The `parseRoles()` function handles two storage formats for the `roles` column:

| Input | Output | Format |
|-------|--------|--------|
| `'["admin","editor"]'` | `["admin", "editor"]` | JSON array (preferred) |
| `'["user"]'` | `["user"]` | JSON array (single role) |
| `'admin,editor'` | `["admin", "editor"]` | Legacy comma-separated |
| `'user'` | `["user"]` | Legacy plain string |
| `''` or `null` | `[]` | Empty / missing |

JSON array format is tried first (when the string starts with `[`). If parsing fails, it falls back to comma-separated splitting. Both formats are fully supported.

---

## Role Hierarchy

Roles can inherit from other roles via `security.roleHierarchy`:

```json
{
  "roles": ["admin", "editor", "viewer"],
  "roleHierarchy": {
    "admin": ["editor"],
    "editor": ["viewer"]
  }
}
```

The hierarchy is resolved into a flat expansion map at deploy time by the `resolveRoleHierarchy()` function:

| Role | Expands To |
|------|------------|
| `admin` | `admin`, `editor`, `viewer` |
| `editor` | `editor`, `viewer` |
| `viewer` | `viewer` |

This expansion map is used by `checkAuth()` in the RPC router to determine if a user has inherited access to a `role:X` endpoint. Circular hierarchies are detected and rejected by the security validator at deploy time.

---

## Configuration

Auth is activated when the app's config includes a `security` block with at least one `authProviders` entry:

```json
{
  "security": {
    "authProviders": [{ "provider": "email" }],
    "allowSignup": true,
    "sessionDuration": 604800,
    "roles": ["admin", "editor", "viewer"],
    "roleHierarchy": {
      "admin": ["editor"],
      "editor": ["viewer"]
    },
    "defaultRole": "viewer",
    "defaultAccess": "authenticated",
    "passwordPolicy": {
      "minLength": 10,
      "requireUppercase": true,
      "requireNumber": true,
      "requireSpecial": false
    },
    "redirectAfterLogin": "/dashboard",
    "redirectAfterLogout": "/login"
  }
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `authProviders` | `[]` | Login methods: `email`, `google`, `exepad`. At least one required. |
| `allowSignup` | `true` | Allow new user self-registration. |
| `sessionDuration` | `604800` | Session TTL in seconds (7 days). |
| `roles` | `[]` | Custom role names for this app. |
| `roleHierarchy` | `{}` | Role inheritance map (see [Role Hierarchy](#role-hierarchy)). |
| `defaultRole` | `'user'` | Role assigned to new users on signup. |
| `defaultAccess` | `'public'` | Default access level for pages/handlers without explicit `access`. |
| `passwordPolicy` | `{ minLength: 8 }` | Password strength requirements (email provider). |
| `loginPage` | `'/login'` | Login page route. |
| `redirectAfterLogin` | `'/'` | Post-login redirect. |
| `redirectAfterLogout` | `'/login'` | Post-logout redirect. |

Without a `security` block (or without `authProviders`), `auth_*` methods return 405 (method not allowed).

### Toggle Asymmetry (Enable vs Disable)

- **Disabling auth** is **instant**: the gateway reads fresh config per request and sets `X-Exepad-Auth-Disabled: 1`, which `src/index.ts` and `src/rpc/router.ts` read on every call to override `config.security.enabled`. No republish needed, and no wait on any cache.
- **Enabling auth** takes effect on **republish**: the backend's own `loadConfig` cache is keyed by the stored config object's ETag, so it picks up the new `security` block as soon as a deploy writes one.

---

## MCP Authentication Modes

The `/mcp` endpoint does not use `X-Service-Token` or platform headers. It has two dedicated auth modes, checked in order:

### Mode C: API Key (Direct Access)

A platform-issued API key for this app, passed as a Bearer token:

```
Authorization: Bearer exepad_sk_u7x9q_a1B2c3D4...
```

The key is resolved to a `UserContext` by the existing `extractUserContext()` function. Scope enforcement in `executeTool()` is identical to RPC-path API key calls — `hasScope()` checks `apiKeyScopes` against the required `model:{name}:{operation}` or `handler:{name}` scope.

### Mode D: Gateway JWT (external issuer)

A short-lived HS256 JWT, verified against `GATEWAY_JWT_SECRET`:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIs...
```

| JWT Claim | Value |
|-----------|-------|
| `iss` | `exepad-gateway` |
| `alg` | HS256 |
| `exp` | 5 minutes from mint time |
| `scopes` | Forwarded caller scopes (gateway currently uses `["*"]`) |
| `sub` | User ID |
| `email` | User email |
| `app_id` | Target app ID |

Verification uses the Web Crypto API in `mcp/gateway-auth.ts` against the `GATEWAY_JWT_SECRET` env var, and fails closed on a missing or mismatched `app_id` claim (the secret is shared across apps in one container, so a token without that claim would otherwise be replayable against any app). After verification, the JWT is converted to a `UserContext` with `authMethod: 'api_key'` — meaning it's treated identically to an API key for scope enforcement.

> **Not active in the shipped build.** The self-hosted runtime neither binds `GATEWAY_JWT_SECRET` nor mints these tokens, so `verifyGatewayToken()` returns `null` and `/mcp` accepts API keys only. Mode D is an integration point for an external issuer, not a path you can use out of the box.

### Resolution Priority (MCP only)

1. **Mode C** — tried first (API key extracted by `extractUserContext()`)
2. **Mode D** — fallback (gateway JWT verified by `verifyGatewayToken()`)
3. **Neither** → JSON-RPC error `-32603` with HTTP 401
