# Styling & Theming

Exepad uses Tailwind CSS v4 for styling, with a theme system that maps configuration values to CSS custom properties. The AI builder agent controls styling through two mechanisms: the `theme` configuration (global design tokens) and per-component `classes` props (Tailwind utility classes).

---

## Theme System

The theme is defined in `WebAppProps.frontend.theme` and controls the global visual appearance:

```json
{
  "theme": {
    "light": {
      "background": "0 0% 100%",
      "foreground": "222.2 47.4% 11.2%",
      "primary": "221.2 83.2% 53.3%",
      "primary-foreground": "210 40% 98%",
      "secondary": "210 40% 96%",
      "muted": "210 40% 96%",
      "destructive": "0 84.2% 60.2%",
      "border": "214.3 31.8% 91.4%"
    },
    "dark": {
      "background": "222.2 84% 4.9%",
      "foreground": "210 40% 98%",
      "primary": "217.2 91.2% 59.8%"
    },
    "charts": { "chart-1": "#3b82f6", "chart-2": "#10b981" },
    "fonts": {
      "body": { "family": "Inter", "variant": "regular" },
      "heading": { "family": "Inter", "variant": "700" }
    },
    "radius": "0.5",
    "spacing": { "y": "12", "x": "4" },
    "defaults": {
      "card": { "variant": "default", "hoverEffect": "lift" },
      "button": { "variant": "default", "radius": "md" }
    }
  }
}
```

The theme uses separate `light` and `dark` color palettes with HSL values. Both palettes support all shadcn/ui token pairs (e.g., `primary` / `primary-foreground`, `card` / `card-foreground`).

### How Theme Values Are Applied

Theme colors are mapped to CSS custom properties that Tailwind references:

| Config Key | CSS Variable | Tailwind Usage |
|------------|-------------|----------------|
| `light.primary` | `--color-primary` | `bg-primary`, `text-primary`, `border-primary` |
| `light.secondary` | `--color-secondary` | `bg-secondary`, `text-secondary` |
| `light.accent` | `--color-accent` | `bg-accent`, `text-accent` |
| `light.background` | `--color-background` | `bg-background` |
| `light.foreground` | `--color-foreground` | `text-foreground` |
| `light.muted` | `--color-muted` | `bg-muted`, `text-muted` |
| `light.destructive` | `--color-destructive` | `bg-destructive`, `text-destructive` |
| `light.card` | `--color-card` | `bg-card`, `text-card-foreground` |
| `light.border` | `--color-border` | `border-border` |

### Additional Theme Features

| Feature | Description |
|---------|-------------|
| **Component Defaults** | `defaults` sets global variant preferences (card style, button shape, input style, etc.) |
| **Font Config** | `fonts.body` and `fonts.heading` support Google Fonts via URL |
| **Chart Palette** | `charts` defines up to 5 series colors for data visualizations (HEX or HSL format) |
| **Metadata** | `metadata` sets site-wide SEO/Open Graph defaults |

---

## Component Styling via `classes`

Every component accepts a `classes` prop containing Tailwind CSS utility classes:

```json
{
  "componentType": "SectionProps",
  "classes": "bg-primary text-white py-20 px-8",
  "children": [
    {
      "componentType": "HeadingProps",
      "text": "Welcome",
      "level": 1,
      "classes": "text-5xl font-bold mb-4"
    },
    {
      "componentType": "TextProps",
      "content": "Build anything with Exepad",
      "classes": "text-xl opacity-80 max-w-2xl"
    }
  ]
}
```

The AI builder agent uses Tailwind classes extensively to control:
- Layout (padding, margin, flex, grid)
- Typography (font size, weight, line height, letter spacing)
- Colors (background, text, border)
- Effects (shadows, opacity, blur, gradients)
- Responsive design (sm:, md:, lg:, xl: breakpoints)
- Transitions and animations

---

## Code Focus CSS Pipeline

Code Focus components use pre-compiled Tailwind CSS rather than runtime style processing.

### How It Works

1. **Build time:** The AI agent generates TSX components with Tailwind utility classes.
2. **Validation:** The 4-stage validation pipeline compiles the component's Tailwind classes via Tailwind CLI (stage 3) and verifies all custom classes are covered (stage 4). A single deterministic Tailwind compile gate at the end of the workflow produces the deployed `compiled.css`; if it drops any class the workflow escalates (`StyleCoverageEscalated`).
3. **Deploy:** Compiled CSS is stored alongside the component TSX as deploy artifacts under a **content-versioned filename** (e.g. `compiled.<hash>.css`), so a theme or colour edit produces a new URL and browser/CDN caches invalidate cleanly. Prior to versioning, a recolor edit could leave the old palette cached for hours.
4. **Runtime:** `CodeFocusCssLoader` loads the pre-compiled stylesheet and injects it into the page, scoped under `@layer exepad-app`.

### CSS Scoping

All Code Focus component styles are scoped via `@layer exepad-app` to prevent conflicts with the platform's own styles. Components render in the light DOM (not Shadow DOM) for full theme token access.

### Auto-contrast (WCAG AA)

The runtime computes contrast for every Code Focus text node against its resolved background. If the contrast is below 4.5:1 (or 3:1 for large text) the boundary swaps `text-white` ↔ `text-black` on the offending element. This pass:

- Walks the parent chain so backgrounds set on outer containers still count.
- Handles linear-gradient backgrounds (samples both stops).
- Corrects hover-state classes when the hover background swaps brightness band.
- **Skips elements whose nearest non-transparent ancestor background is an image** (`CodeComponentContrastBoundary.isOverImageBackdrop`). The runtime cannot read average luminance from an opaque image — a previous "fix" that forced `text-white → text-black` on every hero with an image backdrop blanked the headline. The skip is the right call; the agent is responsible for picking a legible colour against its image at generation time.

### Theme Token Access

Code Focus components access theme colors via CSS custom properties:

```css
/* Generated theme.css applies to :root */
:root {
  --color-primary: 221.2 83.2% 53.3%;
  --color-background: 0 0% 100%;
  /* ... all shadcn/ui token pairs */
}
```

Components use standard Tailwind classes (`bg-primary`, `text-foreground`) which resolve to these CSS variables.

---

## Layout System

The page layout is controlled by `frontend.layout`:

| Layout | Description | Max Width |
|--------|-------------|-----------|
| `boxed` | Centered container with max width | ~1280px |
| `narrow` | Narrow centered container | ~768px |
| `wide` | Wider container | ~1536px |
| `full-width` | No max width, edge to edge | 100% |

### Menu Positions

| Position | Description |
|----------|-------------|
| `HeaderMenuTop` | Navigation in a horizontal top header |
| `SidebarMenuLeft` | Navigation in a vertical left sidebar |

---

## AI Builder Agent Styling Patterns

The AI builder agent generates styling using these common patterns:

**Hero sections:**
```json
{ "classes": "bg-primary text-white py-24 px-8 text-center" }
```

**Card grids:**
```json
{ "componentType": "GridProps", "classes": "gap-6", "columns": 3 }
```

**Responsive layouts:**
```json
{ "classes": "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" }
```

**Gradient backgrounds:**
```json
{ "classes": "bg-gradient-to-br from-blue-600 to-purple-700 text-white" }
```

**Hover effects:**
```json
{ "classes": "hover:shadow-lg hover:scale-105 transition-all duration-200" }
```

---

## Related Documents

- [Configuration Reference](07-configuration-reference.md) — ThemeProps schema
- [Component Catalog](04-component-catalog.md) — Code Focus component architecture
- [Runtime Engine](03-runtime-engine.md) — How DynamicRenderer renders components
