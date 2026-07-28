# 07 — Theming and Styling

> Standalone reference for platform engineers.
> All file paths are relative to `apps/runtime/`.

---

## 1. ThemeProps & Related Types

**File:** `src/app_runtime/interfaces/apps/core.ts`

### 1.1 ThemeProps (line 216)

The root theme configuration for every WebApp. All fields are optional;
the runtime uses built-in defaults when omitted.

```ts
interface ThemeProps {
  light?: ColorPalette;           // Light-mode color tokens
  dark?: ColorPalette;            // Dark-mode color tokens
  charts?: ChartPalette;          // Data visualization colors
  fonts?: {
    body?: FontConfig;            // Body text font
    heading?: FontConfig;         // Heading font
  };
  fontSizes?: {                   // Typographic scale overrides
    xs?, sm?, base?, lg?, xl?,
    '2xl'?, '3xl'?, '4xl'?, '5xl'?,
    '6xl'?, '7xl'?, '8xl'?, '9xl'?
  };
  radius?: string;                // Global border-radius (rem), default '0.5'
  spacing?: {
    y?: string;                   // Vertical section padding (Tailwind value)
    x?: string;                   // Horizontal content padding (Tailwind value)
  };
  styles?: StyleVariables;        // Shadow & transition custom properties
  layout?: {
    containerWidth?: string;      // Max content width (e.g. '1280px')
    contentPadding?: string;      // Inner content padding (e.g. '2rem')
  };
  defaults?: ComponentDefaults;   // Global component variant defaults
  metadata?: MetadataProps;       // SEO & social sharing defaults
}
```

### 1.2 ColorPalette (line 63)

All values use **HSL format** (e.g. `'222.2 47.4% 11.2%'`), not hex.
Every token listed below is optional.

| Token | CSS Variable | Description |
|-------|-------------|-------------|
| `background` | `--background` | Main page background |
| `foreground` | `--foreground` | Default text color |
| `card` | `--card` | Card component background |
| `card-foreground` | `--card-foreground` | Text on card backgrounds |
| `popover` | `--popover` | Popover/dropdown/tooltip background |
| `popover-foreground` | `--popover-foreground` | Text on popover backgrounds |
| `primary` | `--primary` | Primary brand color (buttons, links, active) |
| `primary-foreground` | `--primary-foreground` | Text on primary backgrounds |
| `secondary` | `--secondary` | Secondary interactive color |
| `secondary-foreground` | `--secondary-foreground` | Text on secondary backgrounds |
| `muted` | `--muted` | Subtle UI background (disabled, badges) |
| `muted-foreground` | `--muted-foreground` | Text on muted backgrounds |
| `accent` | `--accent` | Hover/highlight/selection color |
| `accent-foreground` | `--accent-foreground` | Text on accent backgrounds |
| `destructive` | `--destructive` | Destructive action color (delete, error) |
| `destructive-foreground` | `--destructive-foreground` | Text on destructive backgrounds |
| `border` | `--border` | Card/divider/separator borders |
| `input` | `--input` | Form input field borders |
| `ring` | `--ring` | Focus ring color |

Total: **19 color tokens** per palette (light and dark).

### 1.3 ChartPalette (line 47)

Five data-visualization series colors in **HEX format**:

| Token | CSS Variable |
|-------|-------------|
| `chart-1` | `--chart-1` |
| `chart-2` | `--chart-2` |
| `chart-3` | `--chart-3` |
| `chart-4` | `--chart-4` |
| `chart-5` | `--chart-5` |

### 1.4 StyleVariables (line 107)

Global CSS custom properties for shadows and transitions:

| Property | CSS Variable |
|----------|-------------|
| `shadowSm` | `--shadowSm` |
| `shadow` | `--shadow` |
| `shadowMd` | `--shadowMd` |
| `shadowLg` | `--shadowLg` |
| `shadowXl` | `--shadowXl` |
| `shadow2xl` | `--shadow2xl` |
| `shadowInner` | `--shadowInner` |
| `transitionDuration` | `--transitionDuration` |
| `transitionTimingFunction` | `--transitionTimingFunction` |

### 1.5 FontConfig (line 33)

```ts
interface FontConfig {
  family: string;                 // CSS font-family name
  variant: 'regular' | 'italic' | '100'...'900' | '100italic'...'900italic';
  url?: string;                   // Google Fonts CSS URL (optional)
}
```

### 1.6 ComponentDefaults (line 194)

Global variant preferences set via `theme.defaults`. Resolution order:
**component prop > form-scoped override > theme.defaults > built-in default**
(documented at line 264).

```ts
interface ComponentDefaults {
  section?: SectionDefaults;      // variant, radius, elevation (line 132)
  card?: CardDefaults;            // variant, radius, hoverEffect (line 138)
  button?: ButtonDefaults;        // variant, radius (line 148)
  input?: InputDefaults;          // variant, radius, size (line 153)
  tab?: TabDefaults;              // variant, size (line 159)
  stepper?: StepperDefaults;      // variant, size (line 164)
  heading?: HeadingDefaults;      // decoration, weight (line 169)
  text?: TextDefaults;            // weight (line 174)
  accordion?: AccordionDefaults;  // style (line 178)
  dataTable?: DataTableDefaults;  // striped, hoverable, compact (line 182)
  form?: FormLayoutDefaults;      // labelPosition, fieldSpacing, fieldSetVariant (line 188)
  animated?: boolean;             // Global animation toggle (line 206)
}
```

Available variant values per component:

| Component | Variants |
|-----------|----------|
| Section | `default`, `card`, `glass`, `gradient` |
| Card | `default`, `outlined`, `filled`, `elevated`, `glass` |
| Button | `default`, `outline`, `ghost`, `secondary` |
| Input | `default`, `underlined`, `filled`, `bordered` |
| Tab | `default`, `underline`, `pill`, `boxed`, `minimal` |
| Stepper | `circles`, `dots`, `line`, `numbered` |
| Heading | decoration: `none`, `underline-accent`, `gradient` |
| Accordion | `default`, `flush` |

---

## 2. DynamicTheme

**File:** `src/components/DynamicTheme.tsx`

A React component that converts the `ThemeProps` object into a `<style>` tag
containing CSS custom properties, injected into the document via
`dangerouslySetInnerHTML` (line 120).

### 2.1 Hex-to-HSL Conversion

Color values from the config may arrive in either hex format (`#1a202c`) or
pre-formatted HSL (`222.2 47.4% 11.2%`). The component detects HSL by checking
for a space and `%` character (line 50-51). Hex values are converted via the
`hexToHsl()` utility from `src/lib/utils.ts` (line 2, imported at line 2).

### 2.2 CSS Injection Security

Two sanitization functions prevent CSS injection from untrusted LLM-generated configs:

**`sanitizeCssName(name)`** (line 9): Strips everything except `[a-zA-Z0-9\-_]`
from variable names.

**`sanitizeCssValue(value)`** (line 23): Multi-layer defense:
- Strips `< > { } \ ; @` characters (lines 25-27)
- Blocks `expression()`, `-moz-binding:`, `behavior:` (lines 29-31)
- Blocks `url(javascript:...)` and `url(data:...)` (lines 33-34)

### 2.3 Generated CSS Structure

The output `<style>` tag has this structure (lines 106-118):

```css
:root {
  /* Light-mode color tokens (19 variables) */
  --background: 0 0% 100%;
  --foreground: 222.2 47.4% 11.2%;
  /* ... all ColorPalette tokens */

  /* Chart palette (5 variables) */
  --chart-1: 220 70% 50%;
  /* ... */

  /* Radius & spacing */
  --radius: 0.5;
  --spacing-section-y: 8;
  --spacing-section-x: 4;

  /* Style variables (shadows, transitions) */
  --shadowSm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  /* ... */

  /* Layout variables */
  --containerWidth: 1280px;
  --contentPadding: 2rem;

  /* Font size variables */
  --font-size-xs: 0.75rem;
  --font-size-sm: 0.875rem;
  /* ... */
}

.dark {
  /* Dark-mode color tokens (19 variables) */
  --background: 224 71% 4%;
  /* ... */
}
```

### 2.4 Complete List of Generated CSS Variable Names

**From ColorPalette (light in `:root`, dark in `.dark`):**
`--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`,
`--popover-foreground`, `--primary`, `--primary-foreground`, `--secondary`,
`--secondary-foreground`, `--muted`, `--muted-foreground`, `--accent`,
`--accent-foreground`, `--destructive`, `--destructive-foreground`, `--border`,
`--input`, `--ring`

**From ChartPalette (`:root` only):**
`--chart-1`, `--chart-2`, `--chart-3`, `--chart-4`, `--chart-5`

**From radius/spacing (`:root` only):**
`--radius`, `--spacing-section-y`, `--spacing-section-x`

**From StyleVariables (`:root` only):**
`--shadowSm`, `--shadow`, `--shadowMd`, `--shadowLg`, `--shadowXl`,
`--shadow2xl`, `--shadowInner`, `--transitionDuration`, `--transitionTimingFunction`

**From layout (`:root` only):**
`--containerWidth`, `--contentPadding`

**From fontSizes (`:root` only):**
`--font-size-xs`, `--font-size-sm`, `--font-size-base`, `--font-size-lg`,
`--font-size-xl`, `--font-size-2xl`, `--font-size-3xl`, `--font-size-4xl`,
`--font-size-5xl`, `--font-size-6xl`, `--font-size-7xl`, `--font-size-8xl`,
`--font-size-9xl`

---

## 3. DynamicFontLoader

**File:** `src/components/DynamicFontLoader.tsx`

An **async React Server Component** that handles Google Fonts loading with an
optimized strategy to eliminate Flash of Unstyled Text (FOUT).

### 3.1 Loading Pipeline

1. **Extract URLs**: `extractFontUrls(fonts)` from `src/utils/fontUtils.ts` (line 22) reads `fonts.body.url` and `fonts.heading.url` (deduplicating if they match).
2. **Fetch CSS**: `fetchFontCss(url)` (fontUtils.ts line 60) fetches each Google Fonts stylesheet server-side with a browser-like `User-Agent` header to receive woff2 format. Has a 5-second `AbortController` timeout. Silently returns `''` on failure.
3. **Optimize font-display**: `optimizeFontDisplay(css)` (fontUtils.ts line 103) replaces `font-display: swap` with `font-display: block` to prevent FOUT. With preloaded fonts, the invisible-text period is negligible (<200ms).
4. **Extract preload URLs**: `extractFontFileUrls(css)` (fontUtils.ts line 112) parses `@font-face` blocks and extracts `.woff2` URLs from the **latin subset only** (`U+0000` range).
5. **Render output** (lines 48-63):
   - `<link rel="preload" as="font" type="font/woff2" crossOrigin="anonymous">` tags for each critical font file
   - A `<style>` tag with the inlined `@font-face` CSS

### 3.2 Font CSS Variables

From `generateFontVariables()` in `src/utils/fontUtils.ts` (line 17):

| Variable | Source |
|----------|--------|
| `--font-sans` | `fonts.body.family` |
| `--font-heading` | `fonts.heading.family` |

These are sanitized with the same `sanitizeCssValue()` function that strips
`< > { } \ ; @` characters (fontUtils.ts line 9).

### 3.3 Fallback

If font fetching fails at any stage, the component returns `null` (lines 37-38, 66-68),
and the app falls back to system fonts silently.

---

## 4. Generated App CSS Loading

**Files:** `src/components/CodeFocusCssLoader.tsx`,
`src/app_runtime/runtime/components/custom/code/CodeComponent.tsx`

Generated Code Focus apps are `theme.css`-driven. The app config stores
compiled style artifact paths under `repo.frontend.styles`; `CodeFocusCssLoader`
fetches those files and injects the compiled CSS into the document `<head>`.
It also republishes the first `:root { ... }` block in a separate style tag so
SDK components can resolve shadcn-style CSS variables even when generated CSS is
scoped via `@layer exepad-app`.

For generated apps, `frontend.theme` is not the authoritative color palette.
It may still carry runtime-native metadata such as `defaultTheme`, fonts, or
non-Code Focus settings, but generated colors come from `theme.css`.

### 4.1 Content-Versioned CSS Filenames

The per-app `compiled.css` (and other agent-emitted assets) is stored under a
**content-hashed filename** during deploy so a theme/colour edit invalidates
cleanly through every cache in front of it — the browser's, the runtime's
in-process cache shim, and any proxy an operator puts in front of the container.
Reusing the same filename caused a recurring class of bugs where a recoloured
app would keep rendering the previous palette until cache TTL expired; the agent
now recompiles
`compiled.css` whenever theme tokens change and the deploy pipeline writes the
new versioned filename into `repo.frontend.styles`.

---

## 5. Generated App Contrast Enforcement

Contrast is enforced in two layers:

1. **Agent/build validation** validates generated `theme.css` before artifact
   save/deploy. It checks Material Design 3 `--color-*` pairs and SDK `:root`
   pairs used by Button, Card, Popover, Sidebar, and related SDK components.
   Deterministic fixes are applied when possible. Remaining failures are
   blocking validation errors.
2. **Runtime safety net** wraps loaded generated code components in
   `CodeComponentContrastBoundary`. This boundary scans the rendered subtree
   after mount and on DOM mutations, resolves computed foreground/background
   colors, and applies an inline text-color correction when contrast is below
   4.5:1.

The runtime boundary is intentionally scoped to generated code-component
subtrees. It does not rewrite platform chrome or unrelated runtime UI.

### 5.1 Runtime Boundary Behavior

The boundary:

- Scans text-bearing elements such as headings, paragraphs, links, buttons,
  labels, list items, and table cells.
- Skips decorative/invisible text: `text-transparent`, `bg-clip-text`,
  `aria-hidden="true"`, hidden elements, and elements with unresolved colors.
- **Skips correction over image backdrops** via `isOverImageBackdrop()` —
  the previous unconditional behavior forced `text-white → text-black` over
  photographic backgrounds and blanked hero headlines on every Code Focus app.
  The image-luminance check is now an explicit early-exit before contrast
  is measured.
- Computes foreground from `getComputedStyle(element).color`.
- Computes effective background by walking the element/parent chain and
  compositing semi-transparent layers.
- Uses a fixed WCAG AA threshold of `4.5:1`.
- Adds development-only markers: `data-contrast-corrected="true"` and
  `data-contrast-ratio`.
- Adds hover text correction rules only when the hover background is derivable
  from explicit `hover:bg-*` classes.

### 5.2 Supporting Color Utilities

**Files:** `src/lib/colors.ts`, `src/lib/color-resolution.ts`

The boundary reuses shared utilities for color parsing, alpha compositing,
contrast ratio calculation, and selecting a corrected text color. These helpers
are unit-tested independently and should remain framework-agnostic.

---

## 6. Validation Ownership

Runtime-native JSON themes and generated Code Focus themes are validated by
different systems:

- `DynamicTheme` consumes `frontend.theme` for runtime-native apps and metadata
  defaults. Python schema validation for this object should be understood as
  JSON-theme validation only.
- Generated apps use compiled `theme.css` as the authoritative color source.
  Agent-side generated-theme validation owns the M3 `@theme --color-*` pairs,
  SDK `:root` token completeness, and SDK text/background contrast pairs.
- Component semantic validation owns generated TSX class usage. It blocks known
  semantic mispairings, low text opacity, and statically measurable
  text/background pairs below 4.5:1.

---

## 7. Current Generated-App Flow

```text
Agent design-system builder
  -> writes theme.css with M3 @theme tokens and SDK :root variables
  -> generated-theme validator auto-fixes deterministic contrast issues
  -> unresolved contrast failures block artifact save/deploy
  -> CodeFocusCssLoader injects compiled theme.css in the runtime
  -> CodeComponent loads generated React code
  -> CodeComponentContrastBoundary performs last-resort DOM correction
```

The runtime boundary is a safety net, not the primary theming system. New
generated-app contrast fixes should first be added to agent validation whenever
the unsafe pairing can be detected before deploy.
