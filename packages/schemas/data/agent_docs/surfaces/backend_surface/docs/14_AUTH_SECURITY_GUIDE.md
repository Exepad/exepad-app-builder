# Auth & Security Guide — Component Usage

> How to build auth-aware components using `useCurrentUser` from `@exepad/sdk`.

## useCurrentUser Hook

```tsx
import { useCurrentUser } from "@exepad/sdk";

const user = useCurrentUser();
// { id, email, name, roles, isAuthenticated }
```

### Return Values

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string \| null` | User ID (null when anonymous) |
| `email` | `string \| null` | User email (null when anonymous) |
| `name` | `string \| null` | Display name (null when anonymous) |
| `roles` | `string[]` | User's assigned roles (empty array when anonymous) |
| `isAuthenticated` | `boolean` | True when the user is logged in |

## Null Safety (CRITICAL)

`id`, `email`, and `name` are **null** for unauthenticated users.
ALWAYS use optional chaining:

```tsx
// WRONG — crashes when anonymous:
user.email.toUpperCase()

// CORRECT:
user?.email ?? "anonymous"
user?.name ?? "Guest"

// Guard with isAuthenticated:
if (user.isAuthenticated) {
  // id, email guaranteed non-null here
}
```

## Role-Gated UI

Use `roles` to show/hide elements based on the user's role:

```tsx
const user = useCurrentUser();

// Show admin-only controls
{user.roles.includes("admin") && (
  <Button onClick={handleDelete}>Delete</Button>
)}

// Show different content by role
{user.roles.includes("editor") ? (
  <EditableContent />
) : (
  <ReadOnlyContent />
)}
```

## Auth-Conditional Rendering

```tsx
const user = useCurrentUser();

// Show login prompt for anonymous users
if (!user.isAuthenticated) {
  return <Card><CardContent>Please log in to continue.</CardContent></Card>;
}

// Show personalized content for authenticated users
return <div>Welcome back, {user.name ?? user.email}</div>;
```

## Rules

1. **Do NOT build login/signup forms** — the platform provides auth pages automatically
2. **Do NOT store auth state** in `useApp()` — use `useCurrentUser()` exclusively
3. **Always guard nullable fields** with optional chaining or `isAuthenticated` checks
4. **`roles`** is always an array — use `.includes()` for role checks
5. **`page_access`** in `backend_surface.security` maps page slugs to access levels — components on restricted pages can assume the user has the required role
