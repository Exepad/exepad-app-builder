---
name: component-header
description: "Header navigation rules — mobile hamburger menu, glassmorphism, scroll-aware behavior, sticky-on-scroll patterns. Always load for components with role='header'. Keywords: header, navigation, nav, mobile-menu, hamburger, sticky-header, menu."
metadata:
  kind: domain
---
# Skill: Header Component

## Navigation
- Use `navigate()` from `@exepad/sdk` for SPA navigation (no full page reloads)
- Highlight the active route with visual indication (bold, underline, color)
- Intercept clicks on `<a>` tags for SPA behavior
- Use `app_context` page list for navigation items

### `navigate()` + route-literal-union types

`navigate()` accepts only the union of declared page slugs (e.g.
`'/' | '/about' | '/pricing'`). When iterating an array of links and
calling `navigate(link.href)`, the array declaration must preserve the
literal types — otherwise `link.href` widens to `string` and `tsc`
rejects the call.

```tsx
// ✅ tsc-safe — `as const` preserves the literal union
const navLinks = [
  { label: "Home",     href: "/" },
  { label: "About",    href: "/about" },
  { label: "Pricing",  href: "/pricing" },
] as const;
// link.href is now '/' | '/about' | '/pricing'
{navLinks.map((link) => (
  <a key={link.href} onClick={() => navigate(link.href)}>{link.label}</a>
))}

// ❌ tsc rejects — `href` widens to `string`, fails the AppRoutes union
const navLinks = [
  { label: "Home", href: "/" },
];
{navLinks.map((link) => navigate(link.href))} // TS2345
```

For single-call sites, prefer literal arguments directly:
`navigate('/contact')` (no `as const` needed).

## Background Rules
- Header MUST have a visible background at all times — NEVER use `bg-transparent` alone
- Background style should follow the app's design_style. Options include:
  - Glassmorphism: `bg-surface/80 backdrop-blur-md` (frosted glass effect)
  - Solid: `bg-surface` or `bg-primary` (clean, no transparency)
  - Scroll-aware: transparent initially → solid on scroll (for hero-based pages)
- Minimum acceptable header background opacity is /70 for readability over content
- When the header uses `bg-primary`, `bg-secondary`, or another semantic surface, pair it with the matching `text-on-*` token on the same element.
  `on-*` tokens are palette-derived and may be light or dark — do NOT assume they are white.

## Positioning (CRITICAL)
Use `sticky top-0 z-50` on the root element. The component owns its positioning — the runtime shell is a transparent wrapper. Use `w-full` for width.

## Mobile Menu (CRITICAL)
- MUST include a hamburger menu for mobile (hidden on `lg:` and above)
- Mobile menu overlay MUST use `z-[60]` or higher (header uses z-50)
- Use conditional rendering (`{isMobileMenuOpen && (...)}`) — NOT translate animations (causes z-index stacking issues)
- Lock body scroll when open: call `useBodyScrollLock(isMobileMenuOpen)` from `@exepad/sdk` — it toggles and restores automatically. Do NOT mutate `document.body.style.overflow` directly (the validator steers you off it).
- Include a close button (`Icons.X`) at the top-right of the overlay
- Nav links in mobile menu: use `text-xl` or `text-2xl` — NOT `text-3xl` or larger
- SDK `Button` works with standard Tailwind classes — use it or a plain `<button>` as needed

## Mobile Header Menu Overlay

Full-screen mobile menu that properly covers the entire viewport including the sticky header shell.

**Key rules:**
- Use `z-[60]` or higher — the platform header shell uses z-50, so the overlay must be above it
- Lock body scroll when open: call `useBodyScrollLock(isMobileMenuOpen)` from `@exepad/sdk` (handles toggle + restore automatically)
- Include a close button (X icon) at the top-right of the overlay
- Use reasonable font sizes for links: `text-xl` or `text-2xl` (NOT `text-3xl`)
- Do NOT use the SDK `Button` component inside the overlay — use a plain `<button>` with Tailwind utility classes instead (the SDK Button uses unprefixed host Tailwind classes that may not render correctly in the app context)

```tsx
const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

// Lock body scroll when the menu is open. `useBodyScrollLock` is from
// @exepad/sdk — it toggles and restores document.body scroll (and
// scrollbar-gutter padding) automatically, ref-counted so nested locks
// don't clobber each other. NEVER mutate `document.body.style` directly.
useBodyScrollLock(isMobileMenuOpen);

// Hamburger toggle (inside header bar, hidden on desktop)
<button
  className="p-2 text-on-surface lg:hidden"
  onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
  aria-label="Toggle Menu"
>
  {isMobileMenuOpen
    ? <Icons.X className="w-6 h-6" />
    : <Icons.Menu className="w-6 h-6" />}
</button>

// Full-screen overlay (OUTSIDE the header flow, z-[60] to cover sticky header)
{isMobileMenuOpen && (
  <div className="fixed inset-0 z-[60] bg-surface flex flex-col lg:hidden">
    {/* Close button at top-right */}
    <div className="flex justify-end p-4">
      <button
        className="p-2 text-on-surface"
        onClick={() => setIsMobileMenuOpen(false)}
        aria-label="Close Menu"
      >
        <Icons.X className="w-6 h-6" />
      </button>
    </div>

    {/* Centered nav links */}
    <nav className="flex flex-col items-center justify-center flex-1 gap-6">
      {navLinks.map((link) => (
        <Link
          key={link.href}
          to={link.href}
          onClick={() => setIsMobileMenuOpen(false)}
          className="text-2xl font-bold text-on-surface hover:text-primary transition-colors"
        >
          {link.label}
        </Link>
      ))}
      {/* CTA button — plain <button>, NOT SDK Button */}
      <button
        onClick={() => { setIsMobileMenuOpen(false); navigate('/pricing'); }}
        className="mt-4 w-full max-w-xs px-8 py-4 rounded-lg bg-primary text-on-primary text-lg font-semibold transition-colors hover:opacity-90"
      >
        Book Now
      </button>
    </nav>
  </div>
)}
```

**FORBIDDEN pattern (will fail validation):**
```tsx
// BAD — translate animation keeps overlay in DOM behind header, wrong z-index, oversized text
<div className={`fixed inset-0 z-40 ${open ? "translate-y-0" : "translate-y-full"}`}>
  <a className="text-3xl">Link</a>
  <Button onClick={close}>Close</Button>
</div>
```

**Why conditional render (`{isMobileMenuOpen && ...}`) instead of translate animation:**
The translate approach (`translate-y-full` → `translate-y-0`) keeps the overlay in the DOM behind the header, causing z-index stacking issues. Conditional render ensures the overlay mounts fresh and above everything.

## Anti-Patterns
- NEVER use `bg-transparent` as the only background — content becomes unreadable over hero images
- NEVER use translate-based mobile menu animations — they render behind the header due to z-index stacking
- NEVER omit the hamburger menu on mobile — desktop-only navs are inaccessible on small screens
