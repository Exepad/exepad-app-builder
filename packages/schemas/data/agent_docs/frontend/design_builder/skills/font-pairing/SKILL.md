---
name: font-pairing
description: "Font pairing for theme.css — display + body font selection, Google Fonts loader, weight/scale ratios, FOIT mitigation via font-display=swap. Load when authoring or revising theme typography (--font-display, --font-body), or when the design plan calls for a specific aesthetic (editorial, brutalist, retro, refined). Keywords: font, fonts, font-pairing, typography, google-fonts, display-font, body-font, font-display, foit, fout, swap, typeface."
metadata:
  kind: design-pattern
---
# Skill: Font Pairing

Two font choices anchor the entire visual system: a **display** font
for headlines and brand voice, and a **body** font for paragraphs and
UI text. Picking these well is the single biggest move away from the
generic "AI-built SaaS" aesthetic.

## Anti-default — never use these alone

The default model output gravitates toward:

```
display: 'Space Grotesk', sans-serif
body: 'Inter', sans-serif
```

Both are excellent fonts; they're also the most-overused pair in
2024–2026 LLM-generated frontends. Pick something else **unless** the
design plan explicitly asks for them.

## Authoritative pairings by aesthetic

| Aesthetic | Display | Body | Vibe |
|-----------|---------|------|------|
| Editorial / luxury | `Fraunces`, `Playfair Display`, `EB Garamond` | `Inter Tight`, `Geist`, `Manrope` | Magazine, fashion, refined |
| Modern minimal | `Geist`, `Manrope`, `Plus Jakarta Sans` | same family | Clean SaaS without being Inter |
| Brutalist / raw | `Space Mono`, `IBM Plex Mono`, `JetBrains Mono` | `Inter Tight` or matching mono | Tech, dev tools, raw-edged |
| Retro-futuristic | `Major Mono Display`, `Press Start 2P`, `VT323` | `Space Grotesk`, `Inter` | Game, arcade, 80s revival |
| Soft / playful | `Quicksand`, `Nunito`, `Comfortaa`, `Outfit` | `Nunito`, `Outfit`, `Inter` | Kids, lifestyle, wellness |
| Heavy/Display contrast | `Bricolage Grotesque`, `Archivo Black`, `Anton` | `Inter Tight`, `Manrope` | Strong hero, marketing |
| Geometric / techy | `Sora`, `Familjen Grotesk`, `Onest` | `Sora`, `Inter Tight` | Modern startup, fintech |
| Hand-drawn / friendly | `Caveat`, `Patrick Hand` (display) | `Karla`, `Lora` | Personal blog, creative |

Pick from the table by matching the design plan's `design_style`
bullets and `app_secondary_type`. When in doubt, default to **modern
minimal** with `Geist` + `Inter Tight` (still distinctive against the
Inter-heavy default).

## How to declare in `theme.css`

```css
@theme {
  --font-display: 'Fraunces', ui-serif, Georgia, serif;
  --font-body:    'Inter Tight', ui-sans-serif, system-ui, sans-serif;
}
```

Tailwind utilities `font-display` and `font-body` resolve to these
variables. The fallback chain matters — pick generic family stacks
that match the chosen fonts (serif vs sans-serif).

## Google Fonts loader

Inject the loader once in the runtime's HTML head — the platform
already does this for any font referenced in `theme.css`. To declare
which weights you need, list them in the comment:

```css
@theme {
  /* @font: Fraunces 300,400,500,600,700,900 italic */
  --font-display: 'Fraunces', ui-serif, Georgia, serif;

  /* @font: Inter Tight 400,500,600,700 */
  --font-body: 'Inter Tight', ui-sans-serif, system-ui, sans-serif;
}
```

The post-processor reads `@font:` comments and emits a single
`<link>` to Google Fonts with `display=swap`. Don't write the `<link>`
tag manually.

Rules:
- **Cap weights to 3–4 per font.** 8 weights × 2 fonts = 8× the load
  payload.
- **Italic only when used.** Most UI body fonts don't need italic.
  Display fonts often do (for emphasis in headlines).
- **`display=swap` is automatic** — no FOIT (flash of invisible text);
  the fallback paints first, swaps in once the web font loads.

## Scale & weight contrast

The display/body pair works when **the contrast is dramatic**:

| Pair | Display weight | Body weight | Notes |
|------|---------------|-------------|-------|
| Serif + sans | 600–900 | 400–500 | Magazine — strong serifs against light sans |
| Mono + sans | 400–700 | 400 | Brutalist — hard letterforms |
| Geometric + grotesque | 700–800 | 400–500 | Modern startup — bold display, neutral body |
| Hand-drawn + serif | 400 | 400–500 | Personal — friendly + readable |

If you pick two sans-serif fonts, ensure they have different
characteristics (stroke contrast, x-height, character width) so they
don't look like the same font in two sizes.

## Type scale

Tailwind's defaults (`text-xs` → `text-9xl`) work in most apps. For
brand-forward marketing, override the display scale:

```css
@theme {
  --font-display: 'Fraunces', serif;
  /* Bigger heading scale for marketing — use sparingly */
  --text-display-lg: 4.5rem;     /* hero headlines */
  --text-display-md: 3.5rem;     /* section H2 */
}
```

Keep body text at standard sizes (`text-base` = 1 rem). Don't bump
body to `text-lg` — readability targets stay around 16 px.

## Performance budget

| Setup | Total payload | Verdict |
|-------|---------------|---------|
| 1 display + 1 body, 3 weights each, swap | ~80 KB | Good |
| 2 display + 1 body, 5 weights each | ~200 KB | Heavy |
| Variable font (Fraunces VF) | ~120 KB single file | Excellent for editorial |
| All Google Fonts via `<link>` no subset | Runtime |
| System fonts only | 0 KB | Smallest, but generic |

For typography-forward designs, prefer **variable fonts** when
available (`Fraunces`, `Bricolage Grotesque`, `Recursive`,
`Inter Tight`, `Geist`). One file ships every weight + axis.

## Anti-patterns

- ✗ `'Inter', sans-serif` for both display AND body. Same font in two
  sizes is bland. Always pick contrasting display.
- ✗ Loading 7 weights of one font when only 2 are referenced in
  components.
- ✗ Quoting font names without spaces (`'InterTight'`). Google Fonts
  uses the space (`'Inter Tight'`).
- ✗ Forgetting the fallback chain. `'Fraunces';` alone causes a flash
  to the browser default before load. Always include the generic
  family fallback.
- ✗ `font-family: var(--font-display); font-weight: 100` for headlines.
  Most display fonts don't have 100. The browser fakes it badly. Stick
  to the weights you declared in the loader.
- ✗ Declaring `--font-display` and `--font-body` with the **same**
  font (`'Geist'`/`'Geist'`). Use one variable; the platform validator
  warns on duplicates.

## Compatibility

The runtime worker injects the Google Fonts `<link>` based on `@font:`
comments in `theme.css`. SDK components read `--font-body` by default;
opting into `--font-display` requires the `font-display` Tailwind
utility (`<h1 className="font-display">`). The deterministic CSS-AST
validator checks that both `--font-display` and `--font-body` are
declared in `@theme`.
