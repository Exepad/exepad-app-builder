# Frontend Auth Pipeline

The auth pipeline transforms raw app config into a fully resolved, security-aware configuration. It runs during config preprocessing, before the first render.

**Pipeline order:**

```
normalizeConfig() → validateSecurityConfig() → resolveAccess() → injectAuthPagesIfNeeded()
```

> **Note:** The historical `preprocessAuthScaffolds()` step is removed. The runtime no longer has any scaffold expander, including `AuthScaffold`. When `security.authProviders` is set and the app has no auth pages, the agent generates `/login`, `/signup`, `/forgot-password`, `/reset-password`, and `/profile` as ordinary Code Focus TSX pages at build time — they call `auth_signup`/`auth_signin`/`auth_signout` RPC methods directly via SDK hooks (`useCurrentUser`, `useHandler`). The injection step below now ensures those pages exist before the agent runs; it does not expand a scaffold component.

---

## 1. Config Normalization

**File:** `src/config/normalizer.ts`

Migrates legacy `'admin'` values to `'role:admin'` in all access-level fields:

- `backend.models[].crudPolicy.{create, read, update, delete, list}`
- `backend.handlers[].authLevel`
- `security.defaultAccess`
- `frontend.pages[].access`

Pure function -- does not mutate input. All other values pass through unchanged.

---

## 2. Security Validation

**File:** `src/config/security-validator.ts`

Returns `{ warnings: string[], errors: string[] }`.

**Error checks:**

- Circular `roleHierarchy` detection via DFS
- `'owner'` used outside `crudPolicy` (pages or handlers)
- `'none'` used outside `crudPolicy` (pages or handlers)
- `defaultAccess` set to `'owner'` or `'none'`

**Warning checks:**

- `role:X` references a role not listed in `security.roles`
- `defaultRole` not in `security.roles`
- Model without `crudPolicy` in an app that has `authProviders`

---

## 3. Access Resolution

**File:** `src/config/access-resolver.ts`

Two responsibilities:

1. **Default access** -- applies `security.defaultAccess` to every page that lacks an explicit `access` field.
2. **Role hierarchy** -- resolves `roleHierarchy` into a flat `roleExpansionMap` via BFS.

### Role Expansion

`resolveRoleHierarchy(roles, hierarchy)` produces a map where each role key maps to all roles it effectively holds (itself plus transitively inherited roles).

```
Input:
  hierarchy: { admin: ['editor'], editor: ['viewer'] }

Output:
  { admin: ['admin', 'editor', 'viewer'],
    editor: ['editor', 'viewer'],
    viewer: ['viewer'] }
```

Returns `{ config, roleExpansionMap }`.

---

## 4. Auth Page Injection

Decision tree (applied during config preprocessing, before the agent emits page TSX):

1. Does `security.authProviders` have at least one provider? If not, skip.
2. Are there already pages at `/login` (or the configured `loginPage`)? If so, skip.
3. Otherwise, mark the auth pages as **required** so the agent generates them as ordinary Code Focus TSX with the default route set: `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/profile`.

The agent-emitted pages call `auth_*` RPC methods directly via SDK hooks. Layout, theming, and branding follow normal Code Focus conventions — there is no special `AuthScaffoldProps` shape to honor.

**Re-publish asymmetry:** Disabling auth on a deployed app is instant (the gateway injects `X-Exepad-Auth-Disabled: 1` and warm app-backend isolates honor it). Enabling auth requires a re-publish — warm isolates serve the pre-security config until they restart.

---

## 5. Page Access Enforcement

**File:** `src/utils/authAccess.ts`

### `checkPageAccess(access, auth, roleExpansionMap)`

Returns an `AccessCheckResult` discriminated union:

```typescript
{ allowed: true }
{ allowed: false, reason: 'loading' }
{ allowed: false, reason: 'unauthenticated' }
{ allowed: false, reason: 'forbidden', requiredRole?: string }
```

**Behavior by access level:**

| Access | Behavior |
|--------|----------|
| `'public'` | Always allowed |
| `'none'` | Always forbidden |
| `'authenticated'` | Must be authenticated |
| `'owner'` | Treated as `'authenticated'` on pages (per-record enforcement is in CRUD) |
| `'role:X'` | Direct role check, then hierarchy expansion, then forbidden |
| `'admin'` (legacy) | Direct admin role check |

### `canAccessPage()`

Wraps `checkPageAccess()` and returns `true` while auth is loading to prevent navigation flash.

---

## 6. Nav Filtering

**Helper:** `canAccessPage()` in `src/utils/authAccess.ts`

Nav visibility is computed per page from `canAccessPage(access, auth, roleExpansionMap)`, which wraps `checkPageAccess()` and returns a boolean. A nav item is shown when the helper returns `true`.

- Pages with `'public'` access (or no `access` field, once `defaultAccess` is applied) are always visible.
- Returns `true` while auth is loading, so navigation does not flash empty before the user resolves.
- `roleExpansionMap` is passed through so role hierarchy is honored.

Page-level access is also enforced at render time: `ClientPageRenderer` (and `PreviewPage` in preview mode) call `checkPageAccess()` for the current page and block rendering when the result is not `allowed`.

---

## Related Documents

- [Configuration Reference](../../../../docs/latest/07-configuration-reference.md) -- SecurityConfig, AccessLevel, CrudPolicy
- [Authorization](../../../../apps/app-backend/docs/latest/authorization.md) -- Backend authorization
- [State & Actions](../../../../docs/latest/05-state-and-actions.md) -- Auth state namespace
