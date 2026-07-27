---
name: component-sidebar
description: "Sidebar navigation rules — collapsible sections, route highlighting, Icons usage, active-state styling. Always load for components with role='sidebar'. Keywords: sidebar, side-nav, dashboard-nav, sidebar-menu."
metadata:
  kind: domain
---
# Skill: Sidebar Component

## Layout Contract

The runtime renders the sidebar component inside a flex row with a spacer.
The sidebar component must handle its own positioning and mobile behavior.

**Desktop (lg+):** The sidebar is visible. The shell reserves `w-64` (256px)
in the flex layout. Your sidebar should be `fixed inset-y-0 left-0 w-64`.

**Mobile (< lg):** The sidebar is hidden off-screen. The shell reserves `pt-14`
(56px) at the top of the content area for a mobile header bar. Your sidebar
must render a header bar at `fixed top-0 left-0 right-0 h-14` for the toggle.

## Required Structure

```tsx
import {
  React, LightDOMContainer, Icons, navigate, useNavigation, useCurrentUser, useHandler, useBodyScrollLock,
} from "@exepad/sdk";

function MainSidebar() {
  const { currentSlug } = useNavigation();
  const user = useCurrentUser();
  const [isMobileOpen, setIsMobileOpen] = React.useState(false);
  // Logout is a PLATFORM action, not a page. Use the built-in `auth_signout`
  // handler — NEVER `navigate("/logout")` (the runtime has no such page and
  // the validator blocks it with an error).
  const { execute: signOut } = useHandler("auth_signout", { autoFetch: false });

  // Router/icon config — NOT backend data. Derive `href` values from the
  // pages declared in the app plan. Never invent routes like `/my-tasks`
  // that don't exist in the plan; the validator flags those as dead links.
  const navItems = [
    { label: "Dashboard", icon: Icons.LayoutDashboard, href: "/" },
    { label: "Settings", icon: Icons.Settings, href: "/settings" },
  ];

  const handleNavigate = (href: string) => {
    setIsMobileOpen(false);
    navigate(href);
  };

  // Lock body scroll when the mobile menu is open. `useBodyScrollLock`
  // (from @exepad/sdk) toggles + restores automatically — never mutate
  // document.body.style directly.
  useBodyScrollLock(isMobileOpen);

  return (
    <LightDOMContainer>
      {/* ── Mobile Header Bar ── */}
      {/* MUST be h-14 to match the shell's pt-14 content padding */}
      <div className="fixed top-0 left-0 right-0 h-14 z-[65] flex items-center gap-3 px-4 lg:hidden"
           style={{ backgroundColor: 'var(--color-sidebar, var(--color-primary))' }}>
        <button onClick={() => setIsMobileOpen(!isMobileOpen)}
                className="p-1.5 rounded-md text-white/80 hover:text-white hover:bg-white/10">
          {isMobileOpen
            ? <Icons.X className="w-5 h-5" />
            : <Icons.Menu className="w-5 h-5" />}
        </button>
        <span className="font-headline font-bold text-sm text-white">App Name</span>
      </div>

      {/* ── Mobile Overlay ── */}
      {isMobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-[55] lg:hidden"
             onClick={() => setIsMobileOpen(false)} />
      )}

      {/* ── Sidebar Panel ── */}
      <aside className={`
        fixed inset-y-0 left-0 z-[60] w-64 flex flex-col
        transition-transform duration-300 ease-in-out
        lg:translate-x-0
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
      `} style={{
        backgroundColor: 'var(--color-sidebar, var(--color-primary))',
        color: 'var(--color-sidebar-foreground, var(--color-on-primary))',
      }}>
        {/* Header */}
        <div className="p-6 flex items-center gap-3 border-b border-white/10">
          <Icons.Box className="w-8 h-8" />
          <span className="font-headline font-bold">App Name</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {navItems.map((item) => {
            const isActive = currentSlug === item.href
              || (item.href !== "/" && currentSlug.startsWith(item.href));
            return (
              <a key={item.href} href={item.href}
                 onClick={(e) => { e.preventDefault(); handleNavigate(item.href); }}
                 className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                   ${isActive
                     ? "bg-white/15 text-white"
                     : "text-white/70 hover:bg-white/5 hover:text-white"}`}>
                <item.icon className="w-5 h-5" />
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        {/* Footer — User Menu */}
        <div className="p-3 border-t border-white/10">
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/5 transition-colors">
            <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center text-sm font-bold shrink-0">
              {user?.email?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {user?.name ?? user?.email?.split('@')[0] ?? "User"}
              </p>
              {user?.email && (
                <p className="text-[11px] text-white/60 truncate">{user.email}</p>
              )}
            </div>
            <button onClick={signOut}
                    className="p-1.5 rounded-md text-white/50 hover:text-white hover:bg-white/10 transition-colors shrink-0"
                    title="Sign Out" aria-label="Sign Out">
              <Icons.LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </LightDOMContainer>
  );
}
```

## Key Rules

### Sidebar Colors (CRITICAL)
- MUST use CSS variables for sidebar colors — NEVER hardcode hex values in inline styles
- Use `style={{ backgroundColor: 'var(--color-sidebar, var(--color-primary))' }}` for the sidebar background
- Use `style={{ color: 'var(--color-sidebar-foreground, var(--color-on-primary))' }}` for text
- The sidebar color is set by the theme — the component MUST read from CSS variables
- `var(--color-sidebar-foreground, var(--color-on-primary))` is authoritative and may resolve to a light OR dark color.
  Do not hardcode `text-white`/`text-black` as a shortcut.
- Adapt border/hover opacity based on the actual sidebar color (dark sidebars use `white/10`, light sidebars use `black/5`)

### Mobile Header Bar (CRITICAL)
- MUST render a header bar at `fixed top-0 left-0 right-0 h-14 z-[65] lg:hidden`
- Height MUST be `h-14` to match the shell's `pt-14` content padding
- Contains the hamburger toggle button and app name
- Use the sidebar's CSS variable for background color consistency

### Z-Index Layers (MUST follow)
| Layer | Z-Index | Purpose |
|-------|---------|---------|
| Mobile overlay | `z-[55]` | Dark backdrop behind sidebar |
| Sidebar panel | `z-[60]` | The nav panel itself |
| Mobile header bar | `z-[65]` | Top bar with hamburger toggle |
| Platform auth walls | `z-[100]` | Covers everything when unauthenticated |

### Mobile Toggle
- Use `React.useState(false)` for open/close state
- Lock body scroll when open: call `useBodyScrollLock(isMobileOpen)` from `@exepad/sdk` (handles toggle + restore automatically — do not mutate `document.body.style` directly)
- Close sidebar on navigation: call `setIsMobileOpen(false)` before `navigate()`
- Close on overlay click: attach `onClick` to the backdrop

### User Menu Footer (CRITICAL)
The sidebar footer MUST display a compact user row with:
- **Avatar**: `w-9 h-9 rounded-full` with first letter of email (fallback "U")
- **Name/email**: `flex-1 min-w-0` with `truncate` — show `user?.name` or email
  username. Only show email sub-line if `user?.email` is non-null.
- **Sign Out**: Icon-only button (`Icons.LogOut`) at the right edge, `shrink-0`,
  wired to the platform `auth_signout` handler (see below)
- All three in a single `flex items-center gap-3` row — no stacking, no separate
  button row. The sign-out icon is part of the user row, not a separate element.
- Use `useCurrentUser()` which returns `{ email, name, id, roles, isAuthenticated }`.
  All fields can be null for anonymous users — always use `?.` and `?? "fallback"`.

### Sign Out is NON-NEGOTIABLE when the app has auth (CRITICAL)
If the app requires login (it has a `security` config / auth providers), the
sidebar **MUST** include a working Sign-Out control. Two failure modes ship
broken apps — avoid BOTH:
- **Dropping the handler** — a Sign-Out button with no `onClick` is a dead
  button; the user clicks and stays logged in.
- **Omitting the button entirely** — leaving the footer with only an avatar +
  name strands the user with no way to log out.

Logout is a **platform action, NOT a page**. The runtime exposes a built-in
`auth_signout` handler you call via `useHandler`; it tears down the session and
redirects to login on its own. **NEVER `navigate("/logout")`** — there is no
such app page and the `component.routing.navigate_unknown_route` rule blocks it
with an **error**. Don't roll your own `fetch('/auth/logout')` or confirm dialog
either. The exact shape:

```tsx
// once, with the other hooks at the top of the component:
const { execute: signOut } = useHandler("auth_signout", { autoFetch: false });
// …
<button onClick={signOut} title="Sign Out" aria-label="Sign Out"
        className="... shrink-0">
  <Icons.LogOut className="w-4 h-4" />
</button>
```

Do NOT gate the Sign-Out button behind `user?.email` or
`isAuthenticated` — when a sidebar renders, the app shell is already past the
auth wall, so always render it.

## Navigation
- Use `navigate()` from `@exepad/sdk` for SPA link navigation
- Use `useNavigation().currentSlug` for active route detection
- Use `Icons.*` from `@exepad/sdk` (lucide-react) for menu item icons
- `navItems` is router/icon config, not data — keep it as a hardcoded
  array. Every `href` MUST match a page slug declared in the plan —
  `navigate('/missing')` to a non-existent route is a bug.

## Theming
Use CSS variables with fallbacks for sidebar colors:
- `var(--color-sidebar, var(--color-primary))` — panel background
- `var(--color-sidebar-foreground, var(--color-on-primary))` — text color
- Adapt border/hover opacity (`white/10`, `black/5`, etc.) based on whether the sidebar background is dark or light
- The sidebar does not have to be dark — light sidebars with `bg-surface-container-low` and `text-on-surface` work for minimal designs. Follow the design_style.

## Anti-Patterns
- NEVER render a floating toggle button without a header bar
- NEVER hardcode content offsets (`ml-64`, `left-64`)
- NEVER use `lg:relative` — it scrolls away with content
- NEVER invent navigation targets — every `href` MUST match a page slug from the plan
- NEVER use z-indexes outside the documented layer system
