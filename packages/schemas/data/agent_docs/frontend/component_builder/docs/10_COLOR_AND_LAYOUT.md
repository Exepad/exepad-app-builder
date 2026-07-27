# Color Contrast & Layout Rules

## TL;DR — Opacity (most repaired pattern)

```
✅ bg-primary/30   bg-surface-variant/30   text-on-primary
❌ bg-primary/10   bg-primary/20           text-on-primary/80
```

`bg-{token}/N` requires `N ≥ 30` (anything lower is invisible).
Never apply `/N` to `text-on-*` or `text-{semantic}` tokens — full opacity only.
The validator auto-clamps and strips these every build; emitting them just costs you a fix-up cycle.

## The Pairing Rule (NON-NEGOTIABLE)

Every semantic background token has a matching semantic text token. Use them together on the SAME element.

| Background | Matching text |
|------------|---------------|
| `bg-primary` | `text-on-primary` |
| `bg-secondary` | `text-on-secondary` |
| `bg-error` | `text-on-error` |
| `bg-surface` / `bg-background` | `text-on-surface` / `text-on-background` |
| `bg-surface-container*` | `text-on-surface` |
| `bg-primary-container` | `text-on-primary-container` |
| `bg-secondary-container` | `text-on-secondary-container` |
| `bg-error-container` | `text-on-error-container` |
| `bg-inverse-surface` | `text-inverse-on-surface` |

`on-*` tokens are palette-derived. They may be light or dark depending on the resolved theme palette.
Do NOT assume `text-on-primary`, `text-on-secondary`, `text-on-error`, or
`text-inverse-on-surface` is always white.

WRONG: `<div className="bg-primary"><p className="text-on-surface">...</p></div>`
WRONG: `<p className="text-on-primary">...</p>` on a default light page
WRONG: `<p className="text-white">...</p>` as generic text styling
RIGHT: `<div className="bg-primary text-on-primary">...</div>`
RIGHT: `<section className="bg-surface"><p className="text-on-surface">...</p></section>`

## Token Vocabulary — Use ONLY Tokens That Exist (NON-NEGOTIABLE)

Your `design_system_context` includes two authoritative arrays:

- `available_color_tokens` — every `--color-X` declared in `theme.css`. These are the only
  valid token names for `bg-*`, `text-*`, `border-*` classes.
- `available_font_tokens` — every `--font-X` declared in `theme.css`. These are the only
  valid token names for `font-*` classes.

A class like `font-headline`, `font-body`, `text-primary`, or `border-outline` is valid
ONLY when the bare token name (`headline`, `body`, `primary`, `outline`) appears in the
matching list.

If you need a token that is NOT in the list, you MUST call `add_theme_tokens` BEFORE
saving the component. Do NOT invent class names like `border-color`, `bg-base`, or
`font-display` if they aren't in the available list — the validator raises an
undeclared-token coverage warning that drives an `add_theme_tokens` retry, and in
Tailwind v4 an undeclared `--color-*` compiles to no CSS at all, so the class ships
silently unstyled if you don't reconcile it.

For canonical M3 alias pairs (`headline` ↔ `heading`, `body` ↔ `sans`), the runner
guarantees both members are present in the theme when one is — so you can use either
name. Custom or domain-specific tokens (e.g. `--font-display`, `--color-coordinate-text`)
flow through unchanged and appear in the available lists if the design declared them.

## COLOR CONTRAST RULES (MANDATORY)

Your design_system_context includes a full M3 color palette with semantic pairing rules.
You MUST follow these rules to maintain WCAG AA contrast (4.5:1 minimum).

### DEFAULT TEXT COLORS (most common case — read this FIRST)
Most sections use light backgrounds. For these, ALWAYS use:
- **Body text**: `text-on-surface`
- **Muted/subtitle text**: `text-on-surface-variant`
- **Headings**: `text-on-surface` or `text-primary`

`text-inverse-on-surface` is palette-derived and reserved for `bg-inverse-surface`.
Using it on regular light/default surfaces is semantically wrong and may be unreadable.

WRONG: `<p className="text-inverse-on-surface">subtitle on light bg</p>` — WHITE TEXT, INVISIBLE
RIGHT: `<p className="text-on-surface-variant">subtitle on light bg</p>` — dark muted text, readable

The reverse is equally wrong on DARK backgrounds (`bg-inverse-surface`):
WRONG: `<p className="text-on-surface">text inside dark card</p>` — DARK TEXT ON DARK BG, INVISIBLE
RIGHT: `<p className="text-inverse-on-surface">text inside dark card</p>` — white text, readable
This applies to ALL children inside a `bg-inverse-surface` parent — every child element
must use `text-inverse-on-surface` or `text-white`, never `text-on-surface`.

### Use Semantic Color Pairings
Always pair backgrounds with their designated on-* text color from the palette:
- On `bg-primary` → use `text-on-primary` for text
- On `bg-secondary` → use `text-on-secondary` for text
- On `bg-surface` or `bg-surface-container*` → use `text-on-surface` for text
- On `bg-primary-container` → use `text-on-primary-container` for text
- On `bg-error` → use `text-on-error` for text
- On `bg-inverse-surface` → use `text-inverse-on-surface` for body text, `text-white` for headings
The full pairing map is in `design_system_context.pairing_rules`.
Also check `design_system_context.forbidden_pairings` for combinations that MUST be avoided.

**CRITICAL**: `text-on-surface-variant` is designed for LIGHT backgrounds only.
NEVER use `text-on-surface-variant` on dark/inverse backgrounds (`bg-inverse-surface`).
Footers and dark sections MUST use `text-inverse-on-surface` for all body text,
`text-white` for headings, and `border-outline/20` for dividers.

**CRITICAL**: `text-inverse-on-surface` is palette-derived and designed ONLY for `bg-inverse-surface`.
NEVER use `text-inverse-on-surface` on light surfaces (`bg-surface`, `bg-surface-container*`,
or default/no background). On light surfaces, use `text-on-surface` for body text
and `text-on-surface-variant` for muted text.

### Muted / Secondary Text
For muted or subdued text, use `text-on-surface-variant` — do NOT reduce opacity.
For outline/border elements, use `border-outline` or `border-outline-variant`.

### Opacity Restrictions
- **NEVER use any opacity modifier on text.** Full opacity only. `text-on-primary/90`,
  `text-on-primary/80`, `text-white/70` are all FORBIDDEN — they fail WCAG AA contrast
  even when they look "close enough" in the editor. For muted/secondary text on:
    - light backgrounds → use `text-on-surface-variant`
    - `bg-primary` → use `text-on-primary` at full opacity (the palette already picks a readable shade)
    - dark/inverse backgrounds → use `text-inverse-on-surface` at full opacity
  The design system gives you a semantic "muted" variant for every background; use it
  instead of dimming a primary text color.
- NEVER use generic `opacity-*` classes below `opacity-100` on text-containing elements
- Background opacity below /70 is only acceptable for purely decorative overlays with no text
- Background tints below `/30` are effectively invisible (e.g., `bg-primary/5`, `bg-primary/10`).
  Use `/30` minimum for tinted backgrounds, `/50` minimum for meaningful visual distinction

### Most-repaired patterns — replacement table
The auto-fixer rewrites these every time. Skip the cycle by using the
named alternative directly:

| Wrong (auto-fixed) | Right (use this) | Reason |
|---|---|---|
| `text-white/80`, `text-on-primary/90` | `text-on-primary` (full opacity) | Palette already picks a readable shade |
| `text-on-surface/60`, `text-on-surface-variant/20` | `text-on-surface-variant` | Palette-matched muted token, zero opacity |
| `bg-primary/10`, `bg-primary-container/10`, `bg-secondary/10` | `bg-surface-container` or `bg-surface-container-high` | Pre-paired light fill, not a dimmed tint |
| `bg-primary/5`, anything `bg-*/<30` | `bg-{color}/30` (clamped) | Below /30 is invisible at most viewports |
| Hand-picked dark text on `bg-primary` | `text-on-primary` | Use the paired `text-on-*` for the bg |

If you need a soft accent fill behind icon chips or KPI cards, prefer
`bg-surface-container` / `bg-surface-container-high` (semantic light
containers) over `bg-primary/10` (which the validator clamps to
`bg-primary/30` — usually the wrong visual intent).

### Color Usage
PREFER semantic token colors (bg-primary, text-on-surface, bg-surface-container, etc.)
for primary UI elements: buttons, backgrounds, text, navigation, and cards.
For decorative accents, chart colors, status indicators, illustrations, or
when the design_style calls for additional color variety, you MAY use:
- Tailwind arbitrary values: `bg-[#E8A0BF]`, `text-[#2D5F2D]`
- Tailwind palette colors sparingly: `bg-amber-50`, `text-emerald-700`
Non-token text/background pairs are measured by semantic validation. If a
statically recoverable pair is below 3.0:1, validation records a warning and
the deterministic auto-fix pass (Stage 2) adjusts the classes when it can.
Use semantic `on-*` tokens by default; only use arbitrary text colors when you
can prove the measured contrast is safe.

### Prefer Tailwind tokens over arbitrary pixel values

When an arbitrary value exactly matches a built-in token, prefer the token.
The token form compiles smaller, scans cleaner, and stays consistent across
the app. Reach for `[Npx]` only when the value is non-standard.

| Token | Tailwind v4 default (px) |
|---|---|
| `rounded-sm` | 4 |
| `rounded-md` | 6 |
| `rounded-lg` | 8 |
| `rounded-xl` | 12 |
| `rounded-2xl` | 16 |
| `rounded-full` | 9999 |
| `gap-1` / `p-1` | 4 |
| `gap-2` / `p-2` | 8 |
| `gap-3` / `p-3` | 12 |
| `gap-4` / `p-4` | 16 |
| `gap-6` / `p-6` | 24 |
| `gap-8` / `p-8` | 32 |
| `text-xs` | 12 |
| `text-sm` | 14 |
| `text-base` | 16 |
| `text-lg` | 18 |
| `text-xl` | 20 |

```tsx
// ✅
<div className="rounded-sm p-4 gap-2 text-sm">

// ❌ — exact matches for tokens, use tokens instead
<div className="rounded-[4px] p-[16px] gap-[8px] text-[14px]">

// ✅ when truly off-token
<div className="rounded-[3px] mt-[7px]">
```

### Status badge recipe — theme tokens only

Status badges (Paid / Pending / Shipped / Refunded / Cancelled / Active /
Disabled / …) are the LLM's most common excuse for reaching for arbitrary
hex colors. Don't. The M3 palette already covers every reasonable status
semantic:

```tsx
// ✅ GOOD — theme-token status badges (palette swaps Just Work)
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, string> = {
    paid:       "bg-primary text-on-primary",
    active:     "bg-primary text-on-primary",
    shipped:    "bg-secondary text-on-secondary",
    delivered:  "bg-tertiary text-on-tertiary",
    completed:  "bg-secondary-container text-on-secondary-container",
    pending:    "bg-surface-container-high text-on-surface-variant",
    refunded:   "bg-error-container text-on-error-container",
    cancelled:  "bg-error text-on-error",
    default:    "bg-surface-container text-on-surface",
  };
  const cls = variants[status?.toLowerCase()] ?? variants.default;
  return (
    <Badge className={`${cls} rounded-[4px] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border-none`}>
      {status}
    </Badge>
  );
}

// ❌ BAD — arbitrary hex per status; theme swap leaves these stuck
<Badge className="bg-[#0d9488] text-white ...">Paid</Badge>
<Badge className="bg-[#2563eb] text-white ...">Shipped</Badge>
<Badge className="bg-[#dc2626] text-white ...">Refunded</Badge>
```

When you genuinely need a status semantic not covered by the accent
tokens themselves, prefer the **container** variants
(`bg-primary-container` / `bg-secondary-container` / `bg-tertiary-container` /
`bg-error-container`) which the design system pairs with the matching
`text-on-X-container` foreground tokens. There is no `warning`/`success`
token family in the M3 palette — map "warning" to a surface/tertiary
container and "success" to a primary/secondary/tertiary container instead.
Don't introduce ``bg-[#...]`` for design-system colors.

**Build-time guard.** Rule `component.colors.arbitrary_hex` warns on
every ``bg-[#hex]`` / ``text-[#hex]`` / ``border-[#hex]`` occurrence in
component classNames. The rendered output is fine; the design-system
discipline is the issue.

## LAYOUT POSITIONING RULES

Components are responsible for their own layout and positioning. The runtime
provides only a minimal flex container for sidebar layouts.

- Headers: Use `sticky top-0 z-50` (or `fixed top-0`) on your root element.
  Handle scroll-based effects (shadow, backdrop-blur) yourself.
  Include a mobile hamburger menu.
  Inner content should be centered with horizontal padding.
- Sidebars: Use `fixed inset-y-0 left-0 w-64` for the sidebar panel.
  On mobile, render a header bar at `fixed top-0 left-0 right-0 h-14 z-[65]
  lg:hidden` with the hamburger toggle — the shell reserves `pt-14` for this.
  Z-index layers: `z-[55]` overlay, `z-[60]` panel, `z-[65]` mobile header.
  NEVER use `lg:relative` or floating toggle buttons.
  CRITICAL: Sidebar colors MUST use CSS variables, NEVER hardcoded hex values:
    `style={{ backgroundColor: 'var(--color-sidebar, var(--color-primary))', color: 'var(--color-sidebar-foreground, var(--color-on-primary))' }}`
  See the component-sidebar skill for the full pattern and code example.
- Footers: Build as a normal-flow block. Use appropriate background.
  Inner content should be centered with horizontal padding.
- Content: Do NOT hardcode sidebar offsets (`ml-64`, `left-64`) — use
  `SidebarInset` which adjusts automatically.

### Content Width Consistency (MANDATORY)
The app may use `full-width` layout, meaning the runtime provides NO container,
padding, or max-width — components are fully responsible for their own widths.
Content components MUST use a consistent container pattern for their text sections.
Choose a max-width that fits the design_style:
- `max-w-7xl mx-auto` — standard (1280px, good for dashboards)
- `max-w-6xl mx-auto` — narrower (1152px, good for content-focused)
- `max-w-5xl mx-auto` — compact (1024px, good for reading)
- `max-w-screen-2xl mx-auto` — wide (1536px, good for data-dense)
All text sections MUST include horizontal padding (e.g., `px-4 md:px-6 lg:px-10`).
Full-bleed sections (hero images, colored backgrounds) can stretch to full width,
but their inner text/content MUST still be wrapped in a centered container.
NEVER render text content without horizontal padding — it will touch viewport edges.

### Overflow Rules
NEVER use `overflow-hidden` on the component's root wrapper div — it clips page
scrolling and makes content below the fold unreachable.
If you need to contain horizontal overflow from decorative elements or animations,
use `overflow-x-clip` on the SPECIFIC SECTION that needs it, not the root.

### Reading color tokens in inline `style={}` (CSS variables)

When a third-party API insists on a raw color string (Recharts strokes,
inline backgrounds, etc.), use the `--color-*` prefix:

```tsx
// RIGHT — uses the canonical CSS variable name
<Charts.Area stroke="var(--color-primary)" />
<Charts.CartesianGrid stroke="var(--color-outline-variant)" />
<Charts.XAxis tick={{ fill: 'var(--color-on-surface-variant)' }} />

// WRONG — bare names; may resolve to bare `:root` values that don't
// match the M3 token semantics, or hallucinated tokens that don't
// exist in theme.css at all.
<Charts.Area stroke="var(--primary)" />
<Charts.XAxis tick={{ fill: 'var(--on-surface-variant)' }} />
```

**Hallucinated tokens to avoid:** `var(--surface)`, `var(--surface-variant)`,
`var(--accent)`, `var(--muted)`, `var(--accent-foreground)`. These are
NOT in the canonical Exepad M3 theme. If you need a surface tone in an
inline style, use `var(--color-surface)`, `var(--color-surface-container-low)`,
`var(--color-surface-container)`, or a class like `bg-surface` on a parent.

**Rule of thumb:** if you'd write `bg-X` as a Tailwind class, the raw CSS
variable is `var(--color-X)` — always with the `color-` prefix.

### Animation & Transitions

The theme defines animation tokens that match the app's design personality.
Use them for consistent motion across all components:

```tsx
// Hover/interaction transitions — use animation tokens
className="transition-all"
style={{ transitionDuration: 'var(--animation-duration)', transitionTimingFunction: 'var(--animation-ease)' }}

// Entrance animations on page content
className="animate-in fade-in-0"
style={{ animationDuration: 'var(--animation-duration)' }}
```

**Rules:**
- Prefer `var(--animation-duration)` over hardcoded `duration-200` or `duration-300`
- Prefer `var(--animation-ease)` over hardcoded `ease-in-out`
- For hover effects: `transition-colors` or `transition-all` with the duration token
- For page entrance: use `animate-in fade-in-0` with the duration token as inline style
- Dialog, Sheet, and overlay animations are handled automatically by the design system

**FORBIDDEN — `animate-in fade-in-0 duration-N` on entrance wrappers:**

```tsx
// ❌ BAD — causes a visible layout shift on first paint
<div className="flex flex-col p-6 lg:p-10 animate-in fade-in-0 duration-500">

// ✅ GOOD — uses inline animationDuration; no implicit transition
<div className="flex flex-col p-6 lg:p-10 animate-in fade-in-0"
     style={{ animationDuration: 'var(--animation-duration)' }}>
```

**Why:** Tailwind v4's `duration-N` class emits a bare `transition-duration: Ns`
declaration. Without an accompanying `transition-property` (e.g. `transition-all`),
CSS spec defaults `transition-property` to `all` — so EVERY computed style change on
the element interpolates over N ms. When a component renders a different className
in its loading state (`<div className="flex items-center justify-center min-h-[400px]">`)
and then mutates to the loaded-state className (with `p-6 lg:p-10 ... duration-500`),
React re-uses the same DOM node and the browser smoothly transitions padding/margin/width
from 0 → final, producing a visible left-shift on first paint. The inline
`animationDuration` style sets only `animation-duration`, never `transition-duration`,
so the keyframe runs at the intended speed and other properties don't interpolate.

If you NEED both an entrance animation and an explicit transition on the same wrapper,
opt in explicitly: `className="... animate-in fade-in-0 transition-all duration-500"`.
The validator allows `duration-N` when paired with a `transition-*` class.

### Hero pattern: image background + light text

**Apply this pattern ONLY when ALL preconditions are met:**

1. The section already uses an image as a fixed background (`<img>` or
   `<ExepadImage>` with `absolute inset-0` or `object-cover` filling the
   section).
2. The section's heading/body text is light (`text-white`, `text-on-primary`,
   `text-inverse-*`). If the source uses **dark text** on this hero
   (`text-on-surface`, `text-foreground`, `text-on-background`), the
   designer chose contrast intentionally — **preserve the source's overlay
   choice and text color byte-for-byte.** Do NOT darken the image and do
   NOT switch the text to white.
3. The source does NOT already have a working overlay (any of:
   `bg-gradient-to-*`, `backdrop-blur-*`, `bg-black/N`, `brightness-[N]`).
   If the source already has an overlay, leave it alone — the designer
   already solved contrast for that specific image.

**Past regression:** chick_farm (RC#3, app `w4hov6ht`, 2026-05-16) — the
source hero used `text-on-surface` (dark) with a soft side-gradient
overlay. The agent applied this pattern unconditionally, producing a
darkened hero with white text — visually very different from the design.
Preconditions above prevent the regression.

When ALL preconditions are met, apply BOTH techniques below — either alone
is unreliable on a busy image:

1. **Darken the image directly.** Add `brightness-[0.4]` (or `grayscale-[0.5]`)
   to the `ExepadImage` className. This forces the image to render at 40%
   brightness regardless of what underlying highlights the photo contains.
2. **Add a sibling overlay div.** `<div className="absolute inset-0 bg-black/50" />`
   placed next to the image inside the section establishes a uniformly dark
   layer over the entire image, so white text reads consistently across the
   whole hero — including over light-bottle reflections, glassware, sunlit
   patches.

```tsx
<section className="relative min-h-[80vh] overflow-hidden">
  <ExepadImage
    keywords="atmospheric italian dining table fine dining rome"
    importance={10}
    width={1200}
    height={800}
    className="w-full h-full object-cover brightness-[0.4]"
  />
  <div className="absolute inset-0 bg-black/50" />
  <div className="relative z-10 text-center text-white">
    <h1 className="font-headline text-5xl md:text-7xl text-white">
      The Soul of Italian Gastronomy
    </h1>
  </div>
</section>
```

**Why:** A single technique is not enough. A 40% overlay on a busy bar/lounge
image still leaves bottle highlights bleeding through and washes white text
into mid-tone areas. A `brightness-[0.4]` filter alone leaves the image visually
flat but does not provide the high contrast white text needs. Both layered
make the title reliably readable. The `component.layout.hero_image_contrast`
validator flags hero sections that fail this check.

### Responsive breakpoint rules (MANDATORY)
All components MUST use progressive responsive breakpoints. Never skip from mobile
directly to a large layout:

- **Grids:** Max 2-3 columns at `md:`, expand to 4+ only at `lg:` or `xl:`
  GOOD: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4`
  BAD: `grid-cols-1 md:grid-cols-7`
- **Typography:** Hero headings MUST have a mobile-friendly base size
  GOOD: `text-3xl md:text-5xl lg:text-7xl`
  BAD: `text-5xl md:text-7xl` (48px is too large for 320px phones)
- **Padding/spacing:** Start small and scale progressively
  GOOD: `px-4 md:px-6 lg:px-10`
  BAD: `px-6 lg:px-24` (too large a jump)
