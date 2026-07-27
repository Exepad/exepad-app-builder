---
name: component-footer
description: "Footer layout rules — multi-column responsive layout, design system colors, brand block, link groups. Always load for components with role='footer'. Keywords: footer, multi-column, site-footer."
metadata:
  kind: domain
---
# Skill: Footer Component

## Layout
- Build a multi-column footer layout
- Include columns for links, contact info, branding as described in the building plan
- Use the design system colors for background and text
- Keep it responsive — stack columns on mobile (`grid-cols-1 md:grid-cols-2 lg:grid-cols-4`)

## Footer Code Example

```tsx
<footer className="bg-inverse-surface text-inverse-on-surface">
  <div className="max-w-7xl mx-auto px-6 py-12">
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
      {/* Branding column */}
      <div className="space-y-4">
        <h3 className="text-lg font-bold text-white font-heading">BrandName</h3>
        <p className="text-sm text-inverse-on-surface/70">Brief company tagline or description.</p>
      </div>
      {/* Link columns */}
      <div className="space-y-3">
        <h4 className="text-sm font-bold text-white uppercase tracking-wider">Company</h4>
        <nav className="flex flex-col gap-2">
          <Link to="/about" className="text-sm text-inverse-on-surface/70 hover:text-white transition-colors">About</Link>
          <Link to="/contact" className="text-sm text-inverse-on-surface/70 hover:text-white transition-colors">Contact</Link>
        </nav>
      </div>
      {/* More link columns as needed */}
    </div>
    {/* Bottom bar */}
    <div className="mt-10 pt-6 border-t border-outline/20 flex flex-col md:flex-row justify-between items-center gap-4">
      <p className="text-xs text-inverse-on-surface/50">&copy; {new Date().getFullYear()} BrandName. All rights reserved.</p>
      {/* Only render Privacy / Terms when those pages exist in app_context.pages. */}
      {/* If the app doesn't have /privacy or /terms, OMIT this div entirely — */}
      {/* do NOT link them to "/" or any other fallback. */}
    </div>
  </div>
</footer>
```

## Color Rules
- Footer background should follow the app's design_style. Options include:
  - Dark footer: `bg-inverse-surface` with `text-inverse-on-surface` (classic)
  - Light footer: `bg-surface-container-low` with `text-on-surface` (minimal)
  - Colored footer: `bg-primary` with `text-on-primary` (bold)
  - Gradient footer: `bg-gradient-to-r from-primary to-secondary` (modern)
- `on-*` tokens are palette-derived. If the footer uses `bg-primary`, nav links and body text should use `text-on-primary`, even when that token is dark.
- On dark backgrounds: NEVER use `text-on-surface-variant` — use `text-inverse-on-surface` or `text-white`
- On light backgrounds: use standard `text-on-surface` and `text-on-surface-variant`
- Ensure WCAG AA contrast between footer background and text colors

## Positioning
- Build as a normal-flow block — it renders at the bottom of the content column
- No `fixed bottom-0` needed

## Anti-Patterns
- NEVER use fixed/absolute positioning — the footer flows naturally after content
- NEVER use `bg-transparent` — footers need a distinct background color
- NEVER use light-surface text tokens (`text-on-surface-variant`) on dark backgrounds — they will be unreadable
- NEVER hardcode the copyright year as a literal (`&copy; 2026`, `&copy; 2025`). Always use `{new Date().getFullYear()}` so the footer stays correct without redeploys.
- NEVER link to `/privacy`, `/terms`, or any route that is not in the app's page list (check `app_context.pages`). Omit those links entirely if no page exists — linking them to `/` is a dead click and hides the missing-page bug.
