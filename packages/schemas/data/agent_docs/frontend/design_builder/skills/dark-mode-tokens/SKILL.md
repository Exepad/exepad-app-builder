---
name: dark-mode-tokens
description: "Dual light/dark @theme block authoring — paired HSL color tokens, runtime swap via .dark class, WCAG-AA contrast invariants, M3 token mappings. Load when authoring or editing theme.css with light/dark support, or when the design plan calls for dark mode. Keywords: dark-mode, theme, theme-tokens, hsl, light-dark, color-scheme, m3, material, contrast, wcag, css-variables."
metadata:
  kind: design-pattern
---
# Skill: Dark-Mode Tokens (`@theme` Authoring)

Tailwind v4 reads design tokens from `@theme` blocks in `theme.css`.
Light/dark mode means **two synchronized blocks** — one default
(light), one inside `.dark` — with paired tokens at the same names so
every utility class works in both modes without conditional code.

## Anatomy of `theme.css`

```css
@import "tailwindcss";

/* Light mode — default tokens */
@theme {
  /* M3 palette pairs */
  --color-primary: hsl(220 90% 56%);
  --color-on-primary: hsl(0 0% 100%);

  --color-secondary: hsl(280 70% 50%);
  --color-on-secondary: hsl(0 0% 100%);

  --color-surface: hsl(0 0% 100%);
  --color-on-surface: hsl(220 15% 15%);

  --color-background: hsl(220 20% 98%);
  --color-on-background: hsl(220 15% 15%);

  --color-error: hsl(0 75% 50%);
  --color-on-error: hsl(0 0% 100%);

  /* Semantic aliases (used by SDK components) */
  --color-foreground: var(--color-on-background);
  --color-muted: hsl(220 15% 92%);
  --color-muted-foreground: hsl(220 10% 40%);
  --color-border: hsl(220 15% 88%);
  --color-ring: var(--color-primary);
  --color-destructive: var(--color-error);
  --color-destructive-foreground: var(--color-on-error);

  /* Typography */
  --font-display: 'Geist', ui-sans-serif, system-ui, sans-serif;
  --font-body:    'Inter Tight', ui-sans-serif, system-ui, sans-serif;

  /* Spacing scale, radii — usually keep Tailwind defaults */
}

/* Dark mode — same names, dark-tuned values */
.dark {
  --color-primary: hsl(220 90% 65%);     /* lift +9% lightness for dark BG */
  --color-on-primary: hsl(220 50% 10%);  /* darken */

  --color-secondary: hsl(280 70% 65%);
  --color-on-secondary: hsl(280 50% 10%);

  --color-surface: hsl(220 15% 14%);
  --color-on-surface: hsl(220 10% 92%);

  --color-background: hsl(220 18% 10%);
  --color-on-background: hsl(220 10% 92%);

  --color-error: hsl(0 75% 60%);
  --color-on-error: hsl(0 30% 10%);

  --color-muted: hsl(220 15% 18%);
  --color-muted-foreground: hsl(220 10% 60%);
  --color-border: hsl(220 15% 22%);
}
```

## Hard rules

1. **Same token names in both blocks.** The light block defines them
   inside `@theme {}`; the dark block re-declares them inside `.dark
   {}`. Tailwind utilities like `bg-primary` resolve via
   `var(--color-primary)` — the variable points to whichever block is
   active.

2. **HSL format only:** `hsl(<hue> <saturation>% <lightness>%)`. The
   CSS-AST validator hard-rejects hex (`#1234ab`) and rgb (`rgb(...)`)
   in `@theme` values. HSL lets the runtime adjust lightness/saturation
   programmatically (e.g. `hsl(from var(--color-primary) h s calc(l +
   8%))`) and reads predictably.

3. **`@theme` outside `.dark`** — light tokens belong inside the
   `@theme {}` block (Tailwind picks them up to generate utilities).
   Dark overrides go inside `.dark {}` as plain CSS variables (no
   `@theme` wrapper inside `.dark`).

4. **Pair every token.** If `--color-primary` exists in light, it MUST
   exist in dark (or alias to another paired token). Missing pairs
   cause `bg-primary` to fall back to whatever inherited the variable —
   visually wrong.

5. **WCAG-AA contrast pairs are validated.** The CSS-AST validator
   enforces:
   - `--color-primary` × `--color-on-primary` ≥ 4.5 : 1
   - `--color-background` × `--color-foreground` ≥ 4.5 : 1
   - `--color-surface` × `--color-on-surface` ≥ 4.5 : 1
   - `--color-error` × `--color-on-error` ≥ 4.5 : 1
   In **both** modes. Authoring rule of thumb:
   - Light pair: dark text (`hsl(220 15% 15%)`) on light bg
     (`hsl(0 0% 100%)`). Contrast ≈ 14 : 1.
   - Dark pair: light text (`hsl(220 10% 92%)`) on dark bg
     (`hsl(220 18% 10%)`). Contrast ≈ 13 : 1.

## Lightness shifts: light → dark

Most palettes follow these rules when porting tokens:

| Token | Light value | Dark value (typical) |
|-------|-------------|---------------------|
| `--color-primary` (saturated) | L = 50–55 % | L = 60–65 % (lift) |
| `--color-on-primary` | white / near-white | dark version of primary hue |
| `--color-background` | L = 95–100 % | L = 8–14 % |
| `--color-surface` (cards) | L = 100 % | L = 14–18 % (slightly lighter than bg) |
| `--color-foreground` | L = 10–18 % | L = 88–95 % |
| `--color-border` | L = 85–92 % | L = 18–25 % |
| `--color-muted` | L = 92–96 % | L = 16–22 % |
| `--color-muted-foreground` | L = 35–45 % | L = 55–65 % |

For accent/error/success: keep hue and saturation similar; lift
lightness ~10 % in dark mode so they read against the dark background.

## Surface vs background

`--color-background` is the page-level fill. `--color-surface` is for
elevated cards/dialogs. In dark mode, **surface is lighter than
background** (the inverse of light mode):

```
LIGHT:   bg = white,    surface = white (or extremely subtle gray)
DARK:    bg = #0E121A,  surface = #1A1F28  ← lifted up
```

This mimics elevation-by-light. Cards stand out against a darker page.

## SDK semantic aliases

The SDK components (`<Button>`, `<Input>`, `<Card>`) read the alias
tokens, not the M3 names directly:

| Alias used by SDK | Aliases to |
|------------------|-----------|
| `--color-foreground` | `--color-on-background` |
| `--color-muted` / `--color-muted-foreground` | independent tokens |
| `--color-ring` | `--color-primary` (typical) |
| `--color-destructive` | `--color-error` |
| `--color-destructive-foreground` | `--color-on-error` |

Always declare the aliases (with `var(...)` references or independent
values) so SDK components work without per-component overrides.

## Runtime swap

The platform's `theme-toggle` skill (frontend) flips `html.classList`
between (no class) and `dark`. The CSS variables resolve dynamically —
no React re-render needed for the colour change.

```html
<html class="dark">  <!-- dark mode active -->
<html>                <!-- light mode active -->
```

Don't write `data-theme="dark"` patterns; the platform standardizes on
the `.dark` class.

## Brand palette example — going from M3 to your tokens

Given a brand `primary = #2C5282` (a navy blue):

1. Convert to HSL: `hsl(214 49% 34%)`.
2. Light pair: `--color-on-primary: hsl(0 0% 100%)` (white).
   Contrast check: 8.4 : 1 — passes.
3. Dark variant: lift L by ~10–15 %.
   `--color-primary: hsl(214 49% 50%)`.
4. Dark on-primary: lower L significantly.
   `--color-on-primary: hsl(214 30% 8%)`.
   Contrast: 8.1 : 1 — passes.

For accent/secondary, repeat. For surface/background, pick neutral
grays in the same hue family (`hsl(214 15% ...)`) so the whole palette
feels coherent.

## Anti-patterns

- ✗ Defining only the light block. Dark mode falls back to light
  variables, which look wrong on the dark `<html.dark>` body.
- ✗ Hex colours in `@theme`. Validator rejects.
- ✗ `--color-primary-dark` / `--color-primary-light` token pairs.
  That's old-school theming. The platform uses one name + media-query/`.dark` swap.
- ✗ Forgetting the SDK aliases (`--color-foreground`,
  `--color-destructive`). SDK components break.
- ✗ Inverted surface/background lightness in dark mode (surface darker
  than bg). Cards disappear.
- ✗ Random hue shifts between light and dark (light primary is blue,
  dark primary is purple). Brand inconsistency.

## Compatibility

`theme.css` is loaded by the runtime SPA via the `@import
"tailwindcss";` line. The deterministic CSS-AST validator runs on
every save and enforces the WCAG-AA pairs + the HSL-only rule. The
frontend `theme-toggle` skill explains the `html.dark` toggling
mechanism.
