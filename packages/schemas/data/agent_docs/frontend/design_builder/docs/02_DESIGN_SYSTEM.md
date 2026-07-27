# Design System Implementation

<!-- Schema Version: 1.1.0 | Last Updated: 2026-04-06 -->

This guide covers how to extract a visual design system from input HTML, prompts, or screenshots and translate it into the `theme.css` file every app needs (Tailwind v4 CSS-first configuration). For app structure, navigation, component templates, and rendering modes, see `01_CODEFOCUS_SKELETON.md`.

> **Tailwind v4:** All design configuration (colors, fonts, border-radius) is defined in
> CSS using `@theme {}` blocks. There is no separate `tailwind.config.js`.

> **Validation timing:** Every theme.css write — initial DesignSystemBuilder
> output, DesignImporter adopt, edit-mode update, AND every
> `add_theme_tokens` mutation by ComponentBuilder — runs the 13 CSS AST
> rules immediately (~5 ms). A single Tailwind compile gate runs once
> at workflow end against the final theme + all components (~1 s, no
> LLM). There is no automatic regeneration pass for theme.css;
> deterministic CSS recovery handles malformed `@theme` blocks,
> lifted directives, and bare-comma syntax errors.

---

## 1. Color Extraction

Every app maps its palette to **Material Design 3 (M3) token names**. These tokens are declared in the `@theme {}` block of `theme.css` as `--color-primary`, `--color-on-surface`, etc. and used in components as `bg-primary`, `text-on-surface`, etc.

### Extraction Process

1. **Collect hex values** from the input HTML `<style>` blocks, inline styles, and CSS files.
2. **Identify the dominant brand color** — this becomes `primary`.
3. **Identify the secondary accent** (usually a contrasting hue) — this becomes `secondary`.
4. **Optionally identify a tertiary accent** (warm or complementary) — only if the design explicitly uses three distinct accent colors.
5. **Derive container, surface, and state tokens** from the remaining values. Use the M3 tonal palette logic: containers are lighter tints, `on-*` tokens provide contrast text.
6. **Map every collected hex to the closest M3 token** from the table below.

### Complete M3 Token Table

Define all tokens listed below. When `pre_computed_palette` is provided, use those exact hex values.
Those resolved values are authoritative, including the `on-*` tokens.
Do NOT assume `on-primary`, `on-secondary`, `on-error`, or `inverse-on-surface`
is always white. Some valid themes use light primaries with dark `on-primary`.

| Family | Token | Purpose |
|--------|-------|---------|
| **Primary** | `primary` | Brand color, filled buttons, active states |
| | `on-primary` | Text/icons on primary backgrounds |
| | `primary-container` | Tinted background for emphasis areas |
| | `on-primary-container` | Text on primary-container |
| | `inverse-primary` | Primary for inverse surfaces |
| **Secondary** | `secondary` | Secondary brand color |
| | `on-secondary` | Text on secondary |
| | `secondary-container` | Tinted secondary background |
| | `on-secondary-container` | Text on secondary-container |
| **Tertiary** | `tertiary` | Third accent color (derived; present in every computed palette) |
| | `on-tertiary` | Text on tertiary |
| | `tertiary-container` | Tinted tertiary background |
| | `on-tertiary-container` | Text on tertiary-container |
| **Fixed accents** | `primary-fixed` / `secondary-fixed` / `tertiary-fixed` | Container-shade accent that stays constant across light/dark |
| | `on-primary-fixed` / `on-secondary-fixed` / `on-tertiary-fixed` | Text on the matching `*-fixed` token |
| | `*-fixed-dim` / `on-*-fixed-variant` | Dimmed fixed shade / lower-emphasis fixed text (derived) |
| **Error** | `error` | Error/destructive actions |
| | `on-error` | Text on error |
| | `error-container` | Error background |
| | `on-error-container` | Text on error-container |
| **Surface** | `surface` | Page-level background |
| | `on-surface` | Primary text color |
| | `on-surface-variant` | Secondary/muted text |
| | `surface-variant` | Subtle alternate surface |
| | `surface-container` | Default container fill |
| | `surface-container-low` | Low-emphasis container |
| | `surface-container-high` | High-emphasis container |
| | `surface-container-lowest` | Lightest container |
| | `surface-container-highest` | Darkest container |
| | `surface-dim` | Dimmed surface |
| | `surface-bright` | Brightest surface |
| | `inverse-surface` | Dark surface for tooltips/snackbars |
| | `inverse-on-surface` | Text on inverse-surface |
| **Outline** | `outline` | Borders, dividers |
| | `outline-variant` | Subtle borders, ghost dividers |
| **Background** | `background` | App background (often same as surface) |
| | `on-background` | Text on background |

The Creator provides 4 seed colors: primary, secondary, surface, error. When a `pre_computed_palette` is supplied (the standard flow), tertiary and the `*-fixed` tokens are already derived and MUST be retained verbatim — do not strip them. Only in the rare manual-derivation path with no supplied palette is a third accent optional: derive tertiary by shifting the primary hue ~60° while maintaining similar lightness, and add it when the design calls for a third accent color.

Derive ALL token hex values from the seed colors provided by the Creator. Do NOT copy example values from documentation — every app's palette must be unique. When the input HTML contains a hex value that does not map cleanly to an M3 token, use Tailwind arbitrary values in components: `bg-[#hex]`.

### Contrast Expectations

- The resolved theme palette must keep semantic foreground/background pairs readable at WCAG AA.
- A valid theme may use:
  - dark primary + light `on-primary`
  - light primary + dark `on-primary`
- What matters is the resolved pair, not whether the seed color is "supposed to be dark."

Examples of valid pair shapes:
- `primary: #155eef` with `on-primary: #ffffff`
- `primary: #7dd3fc` with `on-primary: #1c1b1f`
- `inverse-surface: #1f2937` with `inverse-on-surface: #ffffff`
- `inverse-surface: #f8fafc` with `inverse-on-surface: #1c1b1f`

---

## 2. Typography Setup

### Font Pairing

Every app uses a **two-font system**: an expressive **headline font** for `h1`-`h4` and display text, and a neutral **body font** for paragraphs, labels, and inputs.

There is no fixed mapping between app type and font. A dashboard can use a serif heading font, a website can use a monospace heading font. What matters is:
- **Contrast** between heading and body fonts (different visual personality)
- **Readability** of the body font at small sizes
- **Character** of the heading font matching the app's mood

### Google Fonts URL Construction

Combine both fonts into a single URL with explicit weights. MUST include `&display=swap`.

```
https://fonts.googleapis.com/css2?family=<Headline+Font>:wght@400;600;700;800&family=<Body+Font>:wght@400;500;600&display=swap
```

Example (for illustration only — do NOT copy these specific fonts):
```
https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=Karla:wght@400;500;600&display=swap
```

Spaces in font names become `+` (`Plus+Jakarta+Sans`).

### Font Weight Conventions

| Weight | Usage |
|--------|-------|
| 400 | Default body text |
| 500 | Medium emphasis, labels |
| 600 | Semi-bold, sub-headings |
| 700 | Bold headings |
| 800 | Extra-bold display text, hero titles |

### theme.css Font Rules

Components render in **Light DOM** and set fonts explicitly via Tailwind
utilities (`font-sans`, `font-heading`). The theme.css does NOT set
global heading or body font overrides — those are handled per-component.

Font families are defined in the `@theme {}` block as `--font-heading`,
`--font-sans`, etc. and applied by components using `font-heading` for
headlines and `font-sans` for body text. `font-body` is an alias for
`font-sans` — both resolve to the body font. Components may use either.

### repo.frontend.fonts Array

One entry for the app fonts (headline + body combined):

```json
"fonts": [
  "https://fonts.googleapis.com/css2?family=<Headline+Font>:wght@400;600;700;800&family=<Body+Font>:wght@400;500;600&display=swap"
]
```

Do NOT include Material Symbols — the platform uses Lucide icons (`Icons.*`).

---

## 3. Icon System

### Lucide Icons (via SDK)

All apps use **Lucide icons** from the SDK. Import them as:

```tsx
import { Icons } from '@exepad/sdk';
```

Use `Icons.*` for all icons in components:

```tsx
<Icons.Home className="w-5 h-5" />
<Icons.Menu className="w-6 h-6" />
<Icons.ChevronDown className="w-4 h-4" />
```

### Icon Sizing

| Size | Tailwind class | Use case |
|------|----------------|----------|
| 16px | `w-4 h-4` | Inline with body text, buttons |
| 20px | `w-5 h-5` | Standard UI icons |
| 24px | `w-6 h-6` | Navigation, feature cards |
| 32px | `w-8 h-8` | Hero sections, KPIs |
| 48px | `w-12 h-12` | Empty states, large features |

Do NOT use Material Symbols (`<span class="material-symbols-outlined">`) — the
platform has migrated to Lucide icons. Do NOT add `.material-symbols-outlined`
to `theme.css`.

---

## 4. @theme Block — Color, Font, and Radius Tokens (Tailwind v4)

In Tailwind v4, all design tokens live in a `@theme {}` CSS block inside `theme.css`.
There is no separate `tailwind.config.js`.

```css
@theme {
  /* ── Primary ── derive from Creator's primary_color */
  --color-primary:                    <primary>;
  --color-on-primary:                 <contrast-text-for-primary>;
  --color-primary-container:          <lighter-tint-of-primary>;
  --color-on-primary-container:       <dark-text-for-container>;
  --color-inverse-primary:            <primary-for-dark-surfaces>;

  /* ── Secondary ── derive from Creator's secondary_color */
  --color-secondary:                  <secondary>;
  --color-on-secondary:               <contrast-text-for-secondary>;
  --color-secondary-container:        <lighter-tint-of-secondary>;
  --color-on-secondary-container:     <dark-text-for-container>;

  /* ── Error ── derive from Creator's error_color */
  --color-error:                      <error>;
  --color-on-error:                   <contrast-text-for-error>;
  --color-error-container:            <lighter-tint-of-error>;
  --color-on-error-container:         <dark-text-for-container>;

  /* ── Surface ── derive from Creator's surface_color */
  --color-surface:                    <surface>;
  --color-on-surface:                 <high-contrast-text>;
  --color-on-surface-variant:         <muted-text>;
  --color-surface-variant:            <subtle-alternate>;
  --color-surface-container:          <default-card-fill>;
  --color-surface-container-low:      <low-emphasis>;
  --color-surface-container-high:     <high-emphasis>;
  --color-surface-container-lowest:   <lightest>;
  --color-surface-container-highest:  <darkest>;
  --color-surface-dim:                <dimmed-surface>;
  --color-surface-bright:             <brightest-surface>;
  --color-inverse-surface:            <dark-surface>;
  --color-inverse-on-surface:         <light-text-on-dark>;

  /* ── Outline & Background ── */
  --color-outline:                    <border-color>;
  --color-outline-variant:            <subtle-border>;
  --color-background:                 <page-background>;
  --color-on-background:              <text-on-background>;

  /* ── Typography ── from Creator's fonts */
  --font-heading:  "<HEADLINE_FONT>", sans-serif;
  --font-headline: "<HEADLINE_FONT>", sans-serif;  /* alias */
  --font-sans:     "<BODY_FONT>", sans-serif;
  --font-body:     "<BODY_FONT>", sans-serif;       /* alias */
  --font-mono:     "JetBrains Mono", monospace;

  /* ── Border Radius ── adjust to match design_style */
  --radius-sm:  0.25rem;
  --radius-md:  0.5rem;
  --radius-lg:  0.75rem;
  --radius-xl:  1rem;
  --radius-2xl: 1.5rem;
}
```

**Important:** Derive ALL hex values from the Creator's seed colors using M3 tonal palette logic. Do NOT reuse example values from this documentation. Every app must have a visually distinct palette.

### Key Rules

1. Color tokens use `--color-<name>: #hex;` format. Components use them as `bg-primary`, `text-on-surface`.
2. Font tokens use `--font-<name>: "Font", fallback;`. Components use `font-heading`, `font-sans`. Aliases `--font-headline` and `--font-body` are defined for convenience.
3. Radius tokens use `--radius-<name>: value;`. Components use `rounded-lg`, `rounded-xl`.
4. All values are **hex colors** (not HSL) — Tailwind v4 handles opacity modifiers natively.
5. NEVER generate a `tailwind.config.js` — all config goes in `@theme {}` in CSS.
6. App theme.css uses `@theme {}` (not `@theme inline`). The `inline` variant is SDK-internal only.

---

## 4.1 Dark Mode Contract (Code Focus)

Dark mode in Code Focus is opt-in — only emit a dark variant when the
request / editor_prompt mentions it. When dark mode is requested, theme.css
MUST redefine the **same `@theme` color tokens** that components consume,
inside a `html.dark` selector.

**DO NOT** emit a dark block that only redefines shadcn-style HSL tokens
(`--background`, `--foreground`, `--card`, `--primary` as HSL triplets).
Those tokens are legacy shadcn defaults and are NOT consumed by Code Focus
components. A `.dark` block that touches only HSL tokens will leave the UI
visually identical in both modes — the toggle becomes cosmetic.

### Required pattern

```css
@layer exepad-app {
  @import "tailwindcss";
  @source "./components";

  @theme {
    --color-primary:                   <light-primary>;
    --color-on-primary:                <light-on-primary>;
    --color-secondary:                 <light-secondary>;
    --color-on-secondary:              <light-on-secondary>;
    --color-surface:                   <light-surface>;
    --color-on-surface:                <light-on-surface>;
    --color-surface-container:         <light-surface-container>;
    --color-background:                <light-background>;
    --color-on-background:             <light-on-background>;
    /* ...all @theme color tokens in LIGHT values... */
  }

  html.dark {
    --color-primary:                   <dark-primary>;
    --color-on-primary:                <dark-on-primary>;
    --color-secondary:                 <dark-secondary>;
    --color-on-secondary:              <dark-on-secondary>;
    --color-surface:                   <dark-surface>;
    --color-on-surface:                <dark-on-surface>;
    --color-surface-container:         <dark-surface-container>;
    --color-background:                <dark-background>;
    --color-on-background:             <dark-on-background>;
    /* EVERY @theme color token redefined — not a subset */
  }
}
```

### Rules

- Use `html.dark` (not `.dark`) so the overrides win against the `@theme`
  default `:root` values emitted by Tailwind v4.
- Override **every** `--color-*` token declared in `@theme`. A partial
  override produces half-dark / half-light surfaces which read as broken.
- Maintain WCAG AA contrast between every `bg-X` / `text-on-X` pair in
  both modes (e.g. `--color-surface` vs `--color-on-surface`).
- Brand accents (primary, secondary) usually keep the same hue; only
  shift lightness enough to preserve contrast on dark surfaces.
- `html.dark` is toggled by the theme-toggle component in the sidebar /
  header. The component MUST use the `theme-toggle` skill pattern — do
  NOT invent your own `document.documentElement` management.
- Tailwind's `dark:` class prefix is NOT supported in Code Focus. Token
  redefinition under `html.dark` is the only supported mechanism.

---

## 5. theme.css Complete Template

Components render in **Light DOM**. The theme.css provides Tailwind v4 import,
theme configuration, CSS custom properties, and optional scoped utility classes.

```css
/* ==========================================================================
   App Name — Exepad Theme (Light DOM, Tailwind v4)
   ========================================================================== */

/* ── 1. Tailwind v4 import + content source (REQUIRED FIRST) ── */
@import "tailwindcss";
@import "tw-animate-css";
@source "./components";

/* ── 2. Design tokens (replaces tailwind.config.js) ── */
@theme {
  /* All M3 color tokens — derived from Creator's seed colors */
  --color-primary: <primary-hex>;
  --color-on-primary: <contrast-hex>;
  /* ... all M3 color tokens (see token table above) ... */

  --font-heading: "<HEADLINE_FONT>", sans-serif;
  --font-headline: "<HEADLINE_FONT>", sans-serif;  /* alias */
  --font-sans: "<BODY_FONT>", sans-serif;
  --font-body: "<BODY_FONT>", sans-serif;           /* alias */
  --font-mono: "JetBrains Mono", monospace;

  --radius-sm: 0.25rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.75rem;
  --radius-xl: 1rem;
  --radius-2xl: 1.5rem;
}

/* ── 3. SDK component variables (shadcn/ui) ── */
:root {
  --background: <surface space-separated-HSL>;
  --foreground: <on-background space-separated-HSL>;
  --primary: <primary space-separated-HSL>;
  --primary-foreground: <on-primary space-separated-HSL>;
  --secondary: <secondary space-separated-HSL>;
  --secondary-foreground: <on-secondary space-separated-HSL>;
  --destructive: <error space-separated-HSL>;
  --destructive-foreground: <on-error space-separated-HSL>;
  --muted: <surface-variant space-separated-HSL>;
  --muted-foreground: <on-surface-variant space-separated-HSL>;
  --accent: <secondary-container space-separated-HSL>;
  --accent-foreground: <on-secondary-container space-separated-HSL>;
  --card: <surface-container-low space-separated-HSL>;
  --card-foreground: <on-surface space-separated-HSL>;
  --border: <outline-variant space-separated-HSL>;
  --input: <outline-variant space-separated-HSL>;
  --ring: <primary space-separated-HSL>;
  --radius: 0.5rem;
  --popover: <surface space-separated-HSL>;
  --popover-foreground: <on-surface space-separated-HSL>;

  /* Sidebar theming */
  --sidebar-background: <sidebar-bg space-separated-HSL>;
  --sidebar-foreground: <sidebar-text space-separated-HSL>;
  --sidebar-primary: <sidebar-primary space-separated-HSL>;
  --sidebar-primary-foreground: <sidebar-primary-text space-separated-HSL>;
  --sidebar-accent: <sidebar-accent space-separated-HSL>;
  --sidebar-accent-foreground: <sidebar-accent-text space-separated-HSL>;
  --sidebar-border: <sidebar-border space-separated-HSL>;
  --sidebar-ring: <sidebar-ring space-separated-HSL>;

  /* Animation tokens — derive from design_style personality */
  --animation-duration: <duration>;
  --animation-ease: <easing-function>;
  --animation-scale-enter: <scale-value>;
  --animation-slide-enter: <slide-distance>;
}

/* SDK foreground tokens MUST come from the matching accessible on-* palette
   entries. Do not hardcode white or dark foregrounds unless the palette entry
   itself resolves to that value. Generated-theme validation checks these pairs
   at 4.5:1 and blocks unresolved failures. */

/**
 * Sidebar variable derivation — match the app's visual personality:
 * - Dark sidebar:    use inverse-surface HSL for --sidebar-background, light text for --sidebar-foreground
 * - Colored sidebar: use primary HSL for --sidebar-background, on-primary HSL for --sidebar-foreground
 * - Light sidebar:   use surface-container-low HSL for --sidebar-background, on-surface HSL for --sidebar-foreground
 */

/**
 * Animation personality — derive from design_style:
 * - Minimal / clean / professional:  150ms, cubic-bezier(0.4, 0, 0.2, 1), scale 0.98, slide 4px
 * - Energetic / playful / dynamic:   300ms, cubic-bezier(0.34, 1.56, 0.64, 1), scale 0.9, slide 12px
 * - Elegant / luxury / refined:      400ms, cubic-bezier(0.16, 1, 0.3, 1), scale 0.96, slide 6px
 * - Tech / dashboard / data-dense:   150ms, cubic-bezier(0, 0, 0.2, 1), scale 0.97, slide 4px
 * - Default:                         200ms, cubic-bezier(0.4, 0, 0.2, 1), scale 0.95, slide 8px
 */

/* ── 4. Animation overrides + custom utility classes ── */
@layer exepad-app {
  /* Override SDK overlay animation timing with app tokens */
  [data-state=open] {
    animation-duration: var(--animation-duration, 200ms) !important;
    animation-timing-function: var(--animation-ease) !important;
  }
  [data-state=closed] {
    animation-duration: var(--animation-duration, 200ms) !important;
    animation-timing-function: var(--animation-ease) !important;
  }

  /* Design-specific utilities, custom @keyframes, decorative helpers */
}
```

### Optional Custom Utilities

Add design-specific patterns inside `@layer exepad-app`:

```css
@layer exepad-app {
  .glass-nav {
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    background: hsla(0, 0%, 100%, 0.8);
  }
}
```

### Rules

1. `@import "tailwindcss"` and `@source "./components"` MUST appear first.
2. `@theme { }` defines all color/font/radius tokens — NO `tailwind.config.js`.
3. `:root` variables use **space-separated HSL** without `hsl()` wrapper (SDK needs this format).
4. All non-`:root` custom rules MUST be wrapped in `@layer exepad-app`.
5. NEVER use `@tailwind base`, `@tailwind components`, `@tailwind utilities` — those are v3 syntax.
6. NEVER add `@font-face` rules — font loading is handled by `DynamicFontLoader`.
7. NEVER use `:host` — components render in Light DOM.
8. NEVER add global resets — Tailwind handles this.
9. NEVER add `.material-symbols-outlined` — the platform uses Lucide icons.

---

## 6. Design Principles

The Creator's `design_style` bullets define the visual direction for each app. The techniques below are **options to choose from** based on the design_style — not mandatory rules for every app.

### Visual Separation Techniques (choose based on design_style)

- **Tonal layering** — Use surface hierarchy (surface → surface-container-low → surface-container) to create depth without borders. Good for clean, minimal designs.
- **Border-based separation** — Use `border-outline-variant` for clear section boundaries. Good for dense, data-heavy UIs.
- **Shadow-based depth** — Use `shadow-sm`, `shadow-md`, or custom shadows for card elevation. Good for card-heavy layouts.
- **Flat design** — Minimal shadows, bold color blocks, clean lines. Good for marketing and editorial.
- **Glassmorphism** — `bg-surface/80 backdrop-blur-md` for floating elements. Good for modern, immersive UIs.

### Surface Hierarchy Reference

```
surface               → widest layout area (page background)
surface-container-low → grouped sections, sidebar backgrounds
surface-container     → default card fill
surface-container-high → emphasized areas, active states
surface-container-lowest → innermost elements (cards on cards)
```

### Text Color Rules (MANDATORY for accessibility)

Use M3 text tokens to ensure WCAG AA contrast:

| Purpose | Token |
|---------|-------|
| Primary text | `on-surface` |
| Secondary/muted text | `on-surface-variant` |
| Disabled text | `outline` |
| Text on colored backgrounds | `on-primary`, `on-secondary`, etc. |

NEVER use pure black (`#000000`) for text — use `on-surface` instead.

---

## 7. Visual Fidelity Rules

When converting an HTML mockup or screenshot into an Exepad app:

1. **Preserve exact hex colors.** Do NOT approximate the input hex as `amber-700`. Map to M3 tokens in the `@theme {}` block, use arbitrary values (`bg-[#hex]`) when no token exists.

2. **Match font weights precisely.** If the input uses `font-weight: 800`, include weight 800 in the Google Fonts URL and apply `font-extrabold`. Do NOT default to `font-bold`.

3. **Maintain spacing proportions.** 2rem padding = `p-8`. 1.25rem gaps = `gap-5`. Measure and match.

4. **Use arbitrary Tailwind values for one-off colors.** Decorative colors that do not belong in the M3 system (chart accents, etc.) go directly in components as `bg-[#e8a0bf]`. NEVER add non-systematic colors to `@theme {}`.

5. **Keep border radius consistent.** Set the dominant radius via `--radius-md` in `@theme {}`. Cards, buttons, and inputs MUST share a radius family.

6. **Preserve opacity and blur values.** `opacity: 0.7` + `blur(12px)` = `opacity-70 backdrop-blur-[12px]`. Do NOT round.

7. **Match typographic scale.** `3.5rem` hero text = `text-[3.5rem]`, not `text-6xl` (3.75rem). Precision matters.

8. **Preserve letter-spacing and line-height.** Use `tracking-[0.05em]` and `leading-[1.1]` for editorial designs with expanded tracking or tight leading.

9. **Never invent colors.** If the input lacks a tertiary color, derive one from the primary (shift hue ~60 degrees, maintain lightness). Do NOT pick arbitrary unrelated colors.

10. **Test contrast ratios.** Every `on-*` token MUST meet 4.5:1 against its background token. Generated-app validation uses a uniform 4.5:1 threshold and does not rely on large-text exceptions. Adjust `on-*` tokens if needed — not backgrounds.
