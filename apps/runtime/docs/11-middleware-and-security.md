# 11 -- Middleware and Security

This document covers the security architecture of the Exepad Runtime, including the Hono middleware pipeline, HTTP security headers, URL validation, code component isolation, per-app authentication, data isolation, and secrets management.

---

## 1. Hono Middleware Pipeline

**File:** `worker/src/index.ts`

The runtime worker is a Hono application served on bare Node by `@hono/node-server`. Middleware is registered in `worker/src/index.ts` and runs in the order below.

```ts
// worker/src/index.ts (order, abridged)
app.use('*', /* loopback-only GET /internal/tls/authorize bypass */);
app.use('*', /* single-app serve gate (EXEPAD_SINGLE_APP_ID) */);
app.use('*', /* HTTP -> HTTPS redirect (EXEPAD_HTTPS_REDIRECT_PORT) */);
app.use('*', /* canonical front-port redirect (managed two-port split) */);
app.use('*', /* initLogLevel from ENVIRONMENT */);
app.use('*', securityHeaders());
app.use('*', /* Vary: Accept-Encoding stamp */);
app.use('*', compress());

app.use('/api/*', cors({
  origin: (origin) => resolveAllowedOrigin(origin) || undefined,
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: [
    'Content-Type', 'Authorization', 'X-Request-Id',
    'X-Platform-Token', 'If-None-Match',
  ],
  credentials: true,
  maxAge: 86400,
}));

app.use('/api/*', /* bodyLimit: 10 MB, or EXEPAD_MAX_UPLOAD_BYTES on _files/upload */);
app.use('/api/deploy/*', rateLimiter({ maxRequests: 10, windowMs: 60_000 }));
// ...further per-prefix rate limiters
```

There is **no** `subdomainRewrite()` middleware — that was a Cloudflare-era
concern and has been removed. What exists instead is
`rewriteFriendlySlug(request)` (exported from `index.ts`, applied by
`server/main.ts` before `app.fetch`), a server-side URL rewrite that resolves
`/a/<slug>/…` to `/a/<appId>/…` via the platform registry. Host-based app
resolution for self-serve custom domains lives in `lib/custom-domains.ts`.

After middleware, route handlers are mounted (see
[09-api-routes.md](./09-api-routes.md) for the full list). Non-API `GET`
requests fall through to the SPA handler, which serves static assets through the
`ASSETS` fetcher or injects meta tags into `index.html` via `injectMeta()`.

### Security Headers

**File:** `worker/src/lib/security-headers.ts`

`securityHeaders()` runs on every request (`app.use('*', ...)`) and does two things:

1. **CSP nonce generation** -- generates a nonce via `crypto.randomUUID()` and stores it on the Hono context (`c.set('cspNonce', nonce)`). The meta injector uses it to add `nonce` attributes to `<script>` tags in the SPA shell.
2. **Header injection** -- after `await next()`, it appends the headers below to the response. They are applied **unconditionally**, in every environment.

| Header | Value |
|--------|-------|
| `X-Content-Type-Options` | `nosniff` |
| `X-XSS-Protection` | `1; mode=block` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` |
| `Content-Security-Policy` | See below |
| `Strict-Transport-Security` | Opt-in only — see the HSTS note |

Frame protection comes from the CSP `frame-ancestors` directive rather than a
separate `X-Frame-Options` header.

**HSTS is off by default and deliberately so.** A self-signed / mkcert LAN
certificate plus HSTS would hard-pin browsers to HTTPS and brick later
plain-HTTP access, and HSTS is ignored on a bare IP anyway. It is opt-in for
stable public domains only — globally via `EXEPAD_HSTS=1` (with
`includeSubDomains`, since the operator owns the whole zone) or per-domain from
the Custom Domains panel (without `includeSubDomains`) — and only ever sent over
a request that arrived securely (direct TLS or a proxy's
`X-Forwarded-Proto: https`).

#### CSP

`buildCsp(nonce, environment)` emits a different policy for cloud
(`ENVIRONMENT` of `production`/`cloud`) and self-host. The self-host policy is
the tighter one:

| Directive | Self-host sources |
|-----------|-------------------|
| `default-src` | `'self'` |
| `script-src` | `'self'`, `'nonce-{uuid}'` |
| `style-src` | `'self'`, `'unsafe-inline'`, `https://fonts.googleapis.com` |
| `font-src` | `'self'`, `https://fonts.gstatic.com` |
| `img-src` | `'self'`, `data:`, `blob:`, `https:` |
| `connect-src` | `'self'`, `https:`, `wss:` |
| `frame-src` | `'self'`, `https:` |
| `frame-ancestors` | `'self'` |
| `worker-src` | `'self'`, `blob:` |

Three deliberate self-host hardenings versus cloud, all reversible by the
operator:

- **`https://esm.sh` is dropped from `script-src`.** It serves arbitrary npm
  packages — effectively arbitrary JavaScript — so allow-listing it would let
  any agent-emitted or prompt-injected component pull executable code from a
  third party. Re-enable with `EXEPAD_ALLOW_ESM_CDN=1`.
- **`http:` is dropped from `img-src`**, so a malicious component cannot beacon
  stolen data out over cleartext. HTTPS images still render.
- **`connect-src` can be narrowed.** The default `'self' https: wss:` lets a
  component fetch to any HTTPS host (apps legitimately call third-party APIs
  from the browser), but `EXEPAD_STRICT_CONNECT_SRC=1` narrows it to same-origin
  plus an optional space-separated `EXEPAD_CONNECT_SRC_ALLOW` allowlist.

`EXEPAD_CDN_DOMAIN` and `EXEPAD_APP_DOMAIN` let an operator point at their own
CDN / builder domain without code changes.

### CORS and the Origin Allowlist

**File:** `worker/src/lib/origin.ts`

CORS middleware is scoped to `/api/*`. Its `origin` option is a callback into
`resolveAllowedOrigin`, so an origin is reflected only if it matches the
allowlist — the middleware does **not** reflect arbitrary origins. An origin is
allowed when it is:

- a loopback `http://localhost` / `http://127.0.0.1` origin on any port (this is
  what makes Vite on :3001 → worker on :8080 work out of the box; drop it with
  `EXEPAD_STRICT_LOCAL_CORS=1` or the "Strict local CORS" toggle),
- listed in `EXEPAD_ALLOWED_ORIGINS` / the `net.allowed_origins` setting — each
  entry a full origin (`https://app.company.com`), a bare `host:port`
  (`192.168.1.10:8080`), or a `*.suffix` wildcard, comma- or pipe-separated, and
  matched over both `http` and `https` for LAN deployments,
- an active operator-registered custom domain, or
- an Exepad cloud host (`exepad.com`, `*.exepad.com`, `*.exepad.app`).

Allowed methods are `GET, POST, PUT, PATCH, DELETE, OPTIONS`; allowed headers
are `Content-Type`, `Authorization`, `X-Request-Id`, `X-Platform-Token`, and
`If-None-Match`. Credentials are enabled and preflights are cached for 24 hours.
Settings-store values override the environment seed and are read live, so an
operator's edit applies on the very next request with no restart.

### Body Limits

`/api/*` is capped at **10 MB**. The single exception is
`POST /api/{appId}/_files/upload`, which gets a generous global ceiling
(`EXEPAD_MAX_UPLOAD_BYTES`, default **100 MB**) because the real limit is each
app's configured `storage.maxFileSize`, enforced downstream by the app-backend's
`Content-Length` precheck. Applying the 10 MB cap there would 413-reject uploads
an app legitimately configured above 10 MB.

### Rate Limiting

**File:** `worker/src/lib/rate-limit.ts`

An in-memory sliding-window limiter, keyed on `clientIp:route`, applied to the
sensitive prefixes:

| Prefix | Limit (per minute) |
|--------|--------------------|
| `/api/deploy/*`, `/api/publish/*`, `/api/quick-access/*` | 10 |
| `/api/deprovision/*` | 5 |
| `/api/platform/email/*`, `/api/:appId/_diag/*` | 30 |
| `/api/admin/*`, `/api/settings/*`, `/api/network/*`, `/api/domains/*` | 60 |
| `/auth/login`, `/auth/setup` | 10 |

The `/auth/login` and `/auth/setup` caps matter most: those routes mint the
platform session cookie that authorizes all admin access, so throttling them is
what stops a weak operator password from being brute-forced online.

**Client IP resolution is the security-critical part.** `X-Forwarded-For` and
`cf-connecting-ip` are ordinary client-settable request headers, so on a
directly-exposed instance an attacker could rotate them to mint a fresh bucket
per request. `resolveClientIp()` therefore picks the bucket IP in this order:

1. **No trusted proxy** — when neither `EXEPAD_TLS_FRONTED=1` (set by the
   shipped container's in-image Caddy, in `docker/entrypoint.sh`) nor
   `EXEPAD_TRUST_PROXY=1` is set, *every* forwarded header is ignored outright
   and the key is the unspoofable TCP peer address from the Node socket
   (`getConnInfo`). If conninfo is unavailable the limiter degrades to a single
   shared `'unknown'` bucket — closed, rather than per-request spoofable.
2. **Trusted proxy, `EXEPAD_TRUST_CF=1` also set** — a non-empty
   `cf-connecting-ip` wins, taken whole.
3. **Trusted proxy, otherwise** — the *rightmost* `X-Forwarded-For` entry,
   because with one trusted hop that is the entry the proxy itself appended;
   anything to its left was supplied by the client. Operators chaining several
   proxies should terminate `X-Forwarded-For` trust at their own edge.
4. **Trusted proxy, but the chosen header is absent** — falls through to the
   TCP peer address as in (1).

All three flags are parsed the same way and accept `1`, `true`, `yes`, or `on`
(case-insensitive).

**Why `cf-connecting-ip` needs its own opt-in.** The shipped container sets
`EXEPAD_TLS_FRONTED=1`, but the Caddy front that justifies it does **not** strip
a client-supplied `cf-connecting-ip` — an inbound one is passed through to the
runtime untouched. Believing that header whenever *any* proxy is trusted
therefore reopened exactly the bypass the rightmost-`X-Forwarded-For` rule
closes: an attacker sends a different `cf-connecting-ip` on every request, gets a
fresh bucket each time, and the 10/min `/auth/login` throttle stops existing. So
it is believed only under the separate, default-off `EXEPAD_TRUST_CF=1`, which an
operator sets when a real Cloudflare edge is the thing in front. Everyone else
falls through to the rightmost-`X-Forwarded-For` path and needs no opt-in — the
optional `cloudflared` quick tunnel included, since it sends a single-entry
`X-Forwarded-For` carrying the same client IP.

Rate limiting is skipped entirely when `ENVIRONMENT === 'development'`.

State is a per-process `Map`, so this is a single-container burst limiter; front
it with your proxy's own rate limiting for multi-instance deployments.

### Meta Tag Injection

**File:** `worker/src/lib/meta-injector.ts`

The `injectMeta()` function handles all non-asset GET requests. Since the runtime is a Vite SPA (single `index.html`), meta tags for SEO must be injected server-side:

1. Fetches `index.html` through the `ASSETS` fetcher.
2. Extracts the app ID from the URL path (e.g., `/a/myapp/...`).
3. Loads the app's published config from `CONFIG_CACHE` (the filesystem storage adapter) with a 60-second in-memory cache.
4. Builds `<title>`, `<meta name="description">`, and Open Graph tags from the config.
5. Injects the tags before `</head>`.
6. Adds `nonce` attributes to all `<script>` tags (both module scripts with `src` and inline scripts) using the CSP nonce generated by the security headers middleware.

---

## 2. The Client-Side `SecurityRuleSet` Module

**Files:**
- `client/src/lib/security/types.ts` -- Type definitions
- `client/src/lib/security/defaults.ts` -- Default rule set
- `client/src/lib/security/applyHeaders.ts` -- Header builder
- `client/src/lib/security/mergeRules.ts` -- Per-app override merging

> **Status: not wired into the running product.** Every HTTP security header
> that reaches a browser is set by the worker middleware in
> `worker/src/lib/security-headers.ts` (section 1). Nothing outside
> `client/src/lib/security/` imports `DEFAULT_SECURITY_RULES`,
> `buildSecurityHeaders`, or `resolveSecurityRules` — the module is a
> self-contained design for per-app security overrides that has unit tests but
> no call sites. It is documented here because the types are still shipped and
> the design is the intended shape of per-app overrides; do not read it as a
> description of what currently protects a request. The `expression` section in
> particular is vestigial: the expression engine was removed with the JSON
> component system.

### SecurityRuleSet Structure

The `SecurityRuleSet` (defined at `client/src/lib/security/types.ts`) is a typed configuration object with four sections:

| Section | Purpose | Intended enforcement layer |
|---------|---------|----------------------------|
| `headers` | HTTP security headers (CSP, frame protection, nosniff, Referrer-Policy, Permissions-Policy) | Worker middleware |
| `content` | Sanitization and dangerous scheme blocking | Component layer |
| `navigation` | Allowed redirect domains | Component layer |
| `expression` | Expression parser limits | Removed — no expression engine exists |

### Default Security Rules

The default rule set (`client/src/lib/security/defaults.ts`) describes the
baseline. The headers a browser actually receives come from the worker
middleware; these defaults feed the module's own `applyHeaders.ts` nonce
substitution and `mergeRules.ts` override merging, neither of which is called
from the running app.

### CSP Nonce Substitution

When a nonce is provided, `buildSecurityHeaders()` replaces `'unsafe-inline'` with the nonce value in the `script-src` directive:

```
client/src/lib/security/applyHeaders.ts
const resolved = nonce
  ? values.map(v => (v === "'unsafe-inline'" && key === 'script-src' ? `'nonce-${nonce}'` : v))
  : values;
```

### Per-App Security Overrides

Apps can provide overrides via `resolveSecurityRules()` (`client/src/lib/security/mergeRules.ts`). The merge is **additive and restrictive**:

- **CSP directives**: Apps can ADD sources but cannot remove defaults. Sources like `*` and `'unsafe-eval'` are blocked for sensitive directives (`script-src`, `default-src`, `object-src`, `base-uri`).
- **Frame protection**: Apps can add allowed origins (but not `*`).
- **Navigation**: Apps can add redirect domains.
- **Expression limits**: Apps can tighten (lower) limits but cannot loosen (raise) them above defaults.

### Locked Rules

Three rules cannot be disabled by per-app overrides (`client/src/lib/security/types.ts`):

```typescript
export const LOCKED_RULES = [
  'content.forceSanitize',          // Force sanitize=true on all markdown
  'content.blockDangerousSchemes',  // Block javascript:, data:, vbscript:
  'headers.contentTypeOptions',     // X-Content-Type-Options: nosniff
] as const;
```

---

## 3. URL Guard

**File:** `client/src/lib/security/urlGuard.ts`

The URL guard module provides validation functions that prevent dangerous URL schemes from being used in navigation, iframes, and redirects. The functions have no dev bypass — but, like the rule-set module above, **they currently have no call sites outside their own unit tests** (`apps/runtime/tests/unit/lib/security/urlGuard.test.ts`). They were consumed by the JSON component library that has since been removed; they are kept as the vetted implementation for Code Focus components and future runtime call sites.

### Dangerous Schemes

Three URL schemes are blocked unconditionally:

```typescript
const DANGEROUS_SCHEMES = ['javascript:', 'data:', 'vbscript:'];
```

### Normalization

Before scheme comparison, URLs are normalized:

1. ASCII control characters (0x00-0x1F) and DEL (0x7F) are stripped to prevent parser-confusion attacks.
2. URL decoding is applied up to 3 times to catch double- and triple-encoding.
3. The result is lowercased and trimmed.

### Exported Functions

| Function | Purpose | Blocks |
|----------|---------|--------|
| `isDangerousScheme(url)` | Check if URL uses a code-execution scheme | `javascript:`, `data:`, `vbscript:` |
| `isSafeNavigationUrl(url)` | Validate URLs for `window.location` / `router.push` | Dangerous schemes |
| `isSafeIframeSrc(url)` | Validate iframe `src` attributes | Dangerous schemes, `blob:`, `http://` in production |
| `isSafeRedirectUrl(url, allowedDomains?)` | Validate redirect targets | Dangerous schemes, cross-origin (unless in allowlist) |

### What Actually Blocks Dangerous URLs Today

With the JSON component library gone, the enforced controls are:

- The **CSP** emitted by the worker (`script-src 'self' 'nonce-…'`,
  `frame-src 'self' https:`, `img-src` without `http:` on self-host), which is
  what stops a `javascript:`-style injection or a cleartext beacon from an
  agent-emitted component.
- **`urlValidator.ts`**
  (`client/src/app_runtime/runtime/components/custom/code/`): an allow-list on
  the URLs `CodeComponent` will `import()` from. Only `cdn.exepad.com` is
  allowed by default (plus localhost origins in development);
  `storage.googleapis.com` was deliberately removed because a suffix match
  would trust any bucket on that shared multi-tenant host. Anything else raises
  `RemoteUrlValidationError`.
- **`LinkInterceptor.tsx`**: only rewrites genuinely internal paths with the
  app's `basePath`, explicitly passing through absolute URLs, other protocols,
  hashes, `blob:`, and `data:` rather than treating them as app routes.
- **`sanitizeCss`** (`client/src/lib/cssSanitizer.ts`), applied to every inline
  `<style>` in `HeadTagsRenderer.tsx` and to fetched font CSS in
  `DynamicFontLoader.tsx`.
- `Content-Security-Policy: script-src 'none'` plus `X-Content-Type-Options: nosniff`
  on every file streamed back through `GET /api/{appId}/_files/{id}/{name}`,
  so a user-uploaded file can never execute in the app's origin.

---

## 4. Code Component Isolation

Code components render in the **light DOM** (not Shadow DOM, despite older descriptions in this codebase). Style isolation is achieved via a per-app compiled Tailwind sheet scoped under `@layer exepad-app` and loaded by `CodeFocusCssLoader` — see [07-theming-and-styling.md](./07-theming-and-styling.md) for the compiled-CSS pipeline and content-versioned filenames that defeat edge cache on theme edits. All logic is handled directly in JavaScript/TypeScript via SDK hooks — there is no expression parser, declarative action system, or scaffold expansion. Code components access state and platform APIs through the `@exepad/sdk` package, which bridges to `window.ExepadState` and `window.ExepadPlatform` globals set by the runtime.

---

## 5. Authentication Flow

### SecurityProps Type

**File:** `packages/types/src/backend.ts`

The `SecurityProps` interface configures per-app authentication:

```typescript
export interface SecurityProps {
  enabled?: boolean;                     // Master kill-switch (default: true)
  authProviders?: AuthProviderProps[];   // Which login methods to enable
  sessionDuration?: number;              // Seconds (default: 604800 = 7 days)
  requireVerification?: boolean;         // Email verification required
  allowSignup?: boolean;                 // Self-registration (default: true)
  passwordPolicy?: {
    minLength?: number;                  // Default: 8
    requireUppercase?: boolean;
    requireNumber?: boolean;
  };
  roles?: string[];                      // Custom role names
  roleHierarchy?: Record<string, string[]>;  // Role inheritance map
  defaultRole?: string;                  // Role assigned on signup
  defaultAccess?: AccessLevel;           // Default for pages/handlers (default: 'public')
  loginPage?: string;                    // Default: '/login'
  redirectAfterLogin?: string;           // Default: '/'
  redirectAfterLogout?: string;          // Default: '/login'
}
```

### Auth Providers

**File:** `packages/types/src/backend.ts`

Three provider types are declared:

```typescript
export type AuthProviderProps =
  | { provider: 'email' }    // Email/password authentication — the supported path
  | { provider: 'google' }   // Google OAuth — no runtime flow (see below)
  | { provider: 'exepad' }   // Exepad platform SSO
```

Only `email` works end to end. The runtime's per-app Google OAuth route group
(`/api/auth/oauth/{start,callback,finalize}`) has been **removed** — it
dispatched through the `USER_WORKERS` binding, which the self-hosted runtime
never binds, so it dead-ended. Nothing in the worker serves an OAuth redirect
now, and nothing stamps the `data-google-configured` attribute the default login
page gates its Google button on (`client/src/components/DefaultLoginPage.tsx`),
so the button never renders. An app that lists `google` in `authProviders` still
type-checks and still gets an `auth_social_login` handler in the app-backend, but
there is no runtime endpoint to complete the flow.

### Auth State Flow

There is no declarative `AuthAction` type — the action system was removed with
the JSON component library. Auth is driven directly from Code Focus components
via SDK hooks (`useCurrentUser`, `useHandler`). The resulting flow is:

1. The component POSTs to `/api/{appId}/rpc` with an `auth_*` method:
   `auth_signup`, `auth_signin`, `auth_signout`, `auth_me`.
2. The gateway resolves `auth_*` as a handler whenever the config has a
   `security` block — regardless of backend mode — and dispatches it in-process.
3. The app-backend validates credentials against `_auth_users` and returns a
   session token via `_sessionToken`, which is converted into a `Set-Cookie`
   (`exepad_app_session`).
4. `auth_me` is the SPA's "am I logged in?" probe. It never propagates dispatch
   failures: when the app/config is missing, has no `security` block, or the
   backend errors, the gateway still returns a
   `{ isAuthenticated: false }` envelope so the login page can render instead of
   the SPA looping on a retry.

### Backend Auth Handlers

**File:** `apps/app-backend/src/auth/handlers/signin.ts`

The app-backend implements authentication handlers that:

- Store user credentials in a `_auth_users` table inside the app's own SQLite database (`<EXEPAD_DATA_DIR>/apps/{appId}/{mode}.sqlite`).
- Use timing-safe password verification to prevent timing attacks.
- Return generic "Invalid email or password" errors to prevent user enumeration.
- Generate session tokens and return them via `_sessionToken` in the response, which the worker entry point converts to `Set-Cookie` headers.

### Auth Pages (Code Focus)

The runtime no longer ships an `AuthScaffold` expander. When `security.authProviders` is set and no auth pages already exist, the agent generates `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/profile` as ordinary Code Focus TSX pages that call the `auth_*` RPC methods through SDK hooks (`useCurrentUser`, `useHandler`). Auth-page injection is handled by the frontend auth pipeline at config preprocess time — see [latest/auth-pipeline.md](./latest/auth-pipeline.md).

**Auth re-publish asymmetry.** Turning auth **off** on a deployed app takes effect immediately — the gateway injects `X-Exepad-Auth-Disabled: 1` and warm app-backend isolates honor it. Turning auth **on** does *not* go live until the next republish, because warm isolates keep serving the pre-security config until they restart.

---

## 6. Data Isolation

### owner_id Scoping

Every record created through auto-CRUD includes an `owner_id` column set to the authenticated user's ID:

```
apps/app-backend/src/crud/create.ts
const recordData: Record<string, unknown> = {
  ...coercedData,
  owner_id: user.id,
  created_at: now,
  updated_at: now,
};
```

### OwnerScope Modes

**File:** `packages/types/src/backend.ts`

Each model declares an `ownerScope` that controls data visibility:

```typescript
export type OwnerScope = 'user' | 'shared';
```

| Mode | Reads/Lists | Writes |
|------|------------|--------|
| `user` (default) | Filtered by `owner_id = ?` -- each user sees only their own data | `owner_id` set to current user |
| `shared` | No `owner_id` filter -- all users see all records | `owner_id` still set for audit trail |

This scoping is applied in the SQL query builder:

```
apps/app-backend/src/crud/list.ts
// For shared-scope models, omit owner_id filter so all users see all data
const scopedUserId = model.ownerScope === 'shared' ? undefined : user.id;
```

The `userId` parameter flows into `buildListQuery()`, `buildCountQuery()`, and `buildCursorListQuery()` in `apps/app-backend/src/utils/sql.ts`, where it is added as a `WHERE owner_id = ?` clause only when non-undefined.

### CrudPolicyProps

**File:** `packages/types/src/backend.ts`

Each model can specify per-operation authentication requirements:

```typescript
export type AccessLevel =
  | 'public' | 'authenticated' | `role:${string}` | 'owner' | 'none';

export interface CrudPolicyProps {
  create?: AccessLevel;
  read?: AccessLevel;
  update?: AccessLevel;
  delete?: AccessLevel;
  list?: AccessLevel;
}
```

The default for all operations is `'authenticated'`. `'public'` allows
unauthenticated access, `role:admin` (or any other declared role) restricts to
that role, `'owner'` restricts to the record's owner, and `'none'` blocks the
operation permanently.

### Handler Auth Levels

Custom handlers (`packages/types/src/backend.ts`) declare both an `authLevel` and a `handlerType`:

- **Read handlers** (`handlerType: 'read'`): Respect the declared `authLevel` (e.g., `'public'` allows unauthenticated reads).
- **Write handlers** (`handlerType: 'write'`, default): Always require authentication regardless of `authLevel`, to prevent empty `owner_id` on inserts (H8 guard).

---

## 7. Secrets

Two unrelated things are called "secrets" in this codebase; keeping them apart
matters.

### Platform secrets (real, enforced)

The tokens the runtime itself authenticates with —
`EXEPAD_SESSION_SECRET`, `DEPLOY_SECRET`, `USER_WORKER_SERVICE_TOKEN`,
`PLATFORM_INTERNAL_SECRET`, `EXEPAD_AGENT_INTERNAL_SECRET`, and
`PLATFORM_BRIDGE_SECRET` (which defaults to the session secret) — are generated
on first boot by `docker/entrypoint.sh` (or `run.sh` for a from-source run) and
persisted to `<data>/secrets/env.sh` with `umask 077`. They are never rotated
automatically, because rotating the session secret would invalidate every live
session and preview token.

The worker reads them through `SecretBinding` / `SecretStoreSecret` shapes
(`worker/src/types/env.ts`) that `build-runtime-env.ts` satisfies with
`envSecret()` wrappers over `process.env` — there is no external secret store.
`lib/secrets.ts::resolveSecret` degrades a read failure to `''` **and logs it**,
specifically so a failed read is distinguishable from a deliberately-unset
secret in a gate that treats empty as open.

### App-declared secrets (`SecretProps`) — declaration only

**File:** `packages/types/src/config.ts`

```typescript
export interface SecretProps {
  name: string;        // e.g., 'STRIPE_API_KEY'
  summary?: string;    // Description of purpose
  required?: boolean;
}
```

`WebAppProps.secrets?: SecretProps[]` lets a generated app *declare* the API
keys it would need. **Nothing consumes this field today** — no provisioning
step, no deploy-time validation of `required`, and no injection into handler
`ctx`. It is a schema-level placeholder for LLM context, not a working secret
store. An app that genuinely needs a third-party key must get it into the
container's environment by other means.

---

## Summary of Security Layers

| Layer | Mechanism | Enforcement Point |
|-------|-----------|-------------------|
| **HTTP middleware** | CSP (env-aware) + nonce, nosniff, Referrer-Policy, Permissions-Policy, opt-in HSTS | `worker/src/lib/security-headers.ts` |
| **Origin boundary** | Credentialed-CORS allowlist (loopback, env/settings allowlist, registered custom domains) | `worker/src/lib/origin.ts`, `lib/net-config.ts` |
| **Abuse limits** | Per-IP sliding-window rate limits on auth/deploy/admin/probe routes; body-size caps | `worker/src/lib/rate-limit.ts`, `worker/src/index.ts` |
| **Transport** | HTTPS in-process by default (self-signed cert auto-minted), HTTP→HTTPS redirect, loopback-only HTTP when TLS is in-process | `worker/src/server/main.ts`, `server/self-signed-cert.ts` |
| **Gateway identity** | API key / app session / platform-bridge token / preview-access token, plus per-app ownership check on preview | `worker/src/routes/gateway/auth.ts`, `lib/meta-db.ts` |
| **Service boundary** | `X-Service-Token` on every in-process dispatch; fails closed in `selfhost`/`staging`/`production` | `worker/src/routes/gateway/auth.ts`, `server/build-runtime-env.ts` |
| **Code Component Isolation** | Light DOM + per-app compiled Tailwind scoped via `@layer exepad-app`, SDK bridge to window globals | `packages/exepad-sdk/`, `client/src/components/ExposeStateGlobal.tsx`, `client/src/components/CodeFocusCssLoader.tsx` |
| **Authentication** | Per-app email/password auth, session tokens, agent-generated Code Focus auth pages | `packages/types/src/backend.ts`, `latest/auth-pipeline.md` |
| **Data Isolation** | `owner_id` scoping, CRUD policies, handler auth levels | `apps/app-backend/src/crud/` |
| **SQL boundary** | AST-validated SELECT/PRAGMA allow-list for the diagnostic probes | `worker/src/lib/sql-whitelist.ts` |
