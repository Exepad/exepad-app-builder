# Anti-Patterns (FORBIDDEN)

## VALIDATION CONTRACT — single attempt, ship-with-warnings

The validation pipeline runs ONCE per component save. There is no
automatic regeneration. Two outcomes:

- **Warnings only.** Component ships; warnings attach to the artifact;
  user sees them in chat and can iterate via the editor. Examples:
  unknown model/handler/state/icon names, undeclared JSX references,
  raw `<img>` tags, `<button>` without `onClick`, hardcoded handler
  return literals, `useModel`-data unsafe access. The runtime degrades
  these gracefully (`useModel('unknown')` → empty array,
  `Icons.Foo` → renders nothing, ComponentErrorBoundary catches
  ReferenceError) so visible-but-broken UI reaches the user instead of
  an aborted workflow.
- **Any error → component shipped as a stub.** ERROR-severity rules:
  syntax (esbuild), forbidden security APIs (`eval`, `new Function`, raw
  `fetch`, `XMLHttpRequest`, `localStorage`, `sessionStorage`,
  `window.location` mutation, `innerHTML` outside `useEffect`),
  SQL injection, hooks-of-rules,
  conditional hooks, inline-object `useApp` selector, missing SDK
  imports, design-import parity drift.

**Implication:** emit clean code on the first try. There is no
automatic regeneration pass that rewrites your output. If you're
uncertain about a model or handler name, define the missing token via
`add_theme_tokens` (theme tokens) or make an explicit assumption —
don't expect a retry round.

## Preserve existing safety patterns when editing (`build_mode: "edit"`)

When you receive an `existing_source` and a building plan that asks
you to translate ONLY specific patterns (e.g. "convert innerHTML
mutations to React state"), the rest of the file must remain
**byte-identical** to the input. Production traces show recurring
regressions where edits drop:

- **Null guards** — e.g. `if (!ctx) return;` after
  `canvas.getContext('2d')`. Without this, `ctx.fillStyle = ...`
  raises TS18047 (`'ctx' is possibly 'null'`) and the component fails
  validation.
- **Variable initializers** — e.g. `let raf = 0, t = 0, running = true;`.
  Dropping the `= 0` makes `cancelAnimationFrame(raf)` raise TS2454
  (`'raf' is used before being assigned`).
- **`if (!element) return;` early-exits** at the top of `useEffect`
  bodies, after `document.getElementById(...)` or
  `document.querySelector(...)` lookups.

**Rule:** the input you receive is already correct under strict
TypeScript. If your translation pass changes a region, re-emit any
nearby guards and initializers verbatim. Treat lines you weren't asked
to translate as immutable.

## Preserve every link, image, and structural tag during edits

When translating imported HTML to TSX, do NOT drop or alter:

- **`<a href="...">` attributes** — every link in the source must appear
  in the output as either `<a href="...">` or `<Link to="...">`. The
  parity check normalizes leading-`/` and trailing-`.html` differences,
  so `shop.html` ↔ `/shop.html` ↔ `/shop` are all considered the same
  link — but a missing href entirely is flagged. Common failure:
  collapsing `<a class="foo" href="/bar">…</a>` into `<button>…</button>`
  or stripping the href when the LLM "thinks" the click is dead.
- **`<img src="...">` and `<ExepadImage src=...>` attributes** — never
  drop the `src` (or, for design-import images, the `keywords` Pexels
  fallback annotation). A missing `src` makes the image render blank.
- **`id="..."` attributes** — JS in `useEffect` often reaches for
  elements by id (`document.getElementById('magnetCta')`). Dropping the
  id silently breaks the interaction.
- **Structural tag counts** — `<section>`, `<form>`, and `<h1>`–`<h6>`
  counts MUST match the input. Restructuring (e.g. flattening a
  `<section>` into a `<div>` because "the wrapper is redundant") changes
  page semantics, screen-reader landmarks, and CSS targeting. The parity
  check counts each tag type before vs. after; any drift is flagged as
  `structural_tag_drift`.
- **Visible text content** — every word from the input that's wrapped
  in JSX text nodes must survive byte-identical (allowing for
  whitespace collapse). Don't paraphrase, summarize, or "improve" copy
  during a translation pass. The parity check flags this as `text_drift`.

These are not stylistic preferences — each preserved attribute and tag
is a behavioral contract with the rest of the system (routing, image
materialization, JS event wiring, accessibility, validator). When the
plan says "convert X", convert ONLY X.

## Never emit escaped quotes inside JSX attributes

Always emit JSX attribute values with literal double quotes. NEVER
emit backslash-escaped quotes inside JSX:

BAD: `<section className=\"hero\" id=\"top\">`
GOOD: `<section className="hero" id="top">`

The escaped form is a syntax error — esbuild rejects it. (A
deterministic save-tool healer repairs the most obvious cases, but
relying on it costs a tool round-trip.)


## Never write backslash-u / backslash-x escapes in JSX text

A unicode escape sequence — a backslash, the letter `u`, then four hex
digits (the curly-quote and em-dash escapes, plus backslash-x forms) —
ONLY decodes inside a JS string or template literal. Written as JSX
*text* (between `>` and `<`) it does NOT decode: the user literally sees
the backslash-u-hex characters on screen.

Type the real typographic character — `"` `"` `'` `'` `—` `–` `…` ` ` —
directly into the JSX text instead.

- BAD:  a `<p>` whose text is a backslash-u-2-0-1-C escape then `Best bakery`
  then a backslash-u-2-0-1-D escape → renders the raw escape characters.
- GOOD: `<p>"Best bakery in town."</p>` with the real curly quotes typed in.
- GOOD: `<span>Open 7 AM — 4 PM</span>` with a real em-dash typed in.

If you truly need the escape form, wrap it in a JS expression so it
decodes: `<p>{"“quote”"}</p>`.


## Icons: exactly one segment, never invent brand glyphs

`Icons.<Name>` takes EXACTLY ONE PascalCase segment from lucide-react.
Two failure modes both render `undefined` → React error #130 → the
whole component blanks out:

1. **Never chain or double-namespace.** Icon components have no
   sub-properties.
   BAD: `<Icons.Icons.Pinterest />`  BAD: `<Icons.X.Pinterest />`
   BAD (loop var): `[{icon: Icons.Star}].map(s => <Icons.s.icon/>)`
   GOOD: `<Icons.Pinterest />`  GOOD: `{stats.map(s => <s.icon/>)}`
2. **Never invent names for brand/social glyphs not in lucide**
   (Pinterest, TikTok, WhatsApp, Snapchat, Discord…). Use the closest
   real lucide icon or a generic one — `Icons.Link`, `Icons.Share2`,
   `Icons.Globe` — or render the brand name as text.

(`Instagram`, `Facebook`, `Twitter`, `Youtube`, `Linkedin`, `Github`,
`Slack`, `Twitch`, `Dribbble` ARE valid lucide names; many other brands
are not.)


## No hardcoded KPI/stat values
NEVER hardcode numeric values for KPIs, counts, totals, or statistics.
Derive them at render time from backend data — aggregate a `useModel()`
result in the component, or read a pre-computed figure from a `useHandler()`
stats call. (`useApp()` selectors are only for genuinely shared FLAT state;
there is no computed engine to read pre-aggregated values from.)
Use `0`, `--`, or a loading skeleton as the fallback — NEVER a fake number.

BAD:  `<span>{totalStockValue?.toLocaleString() || '124,500'}</span>`
GOOD: `const items = useModel('inventory').data ?? [];`
      `const totalStockValue = items.reduce((s, i) => s + i.qty * i.price, 0);`
      `<span>{totalStockValue.toLocaleString()}</span>`
GOOD: `<span>{stats?.totalStockValue?.toLocaleString() ?? '0'}</span>`  // stats from useHandler(...)

## No Math.random() in render
NEVER use `Math.random()` in the render path or JSX expressions — nor a
volatile `Date.now()` value used as a React key, id, or random seed during
render. Each render produces a different value, so React remounts nodes and
the UI flickers. `Math.random()` in the render path is an ERROR-severity rule:
it does NOT merely flicker — it STUBS the whole component. If sample data is
needed, define it as a constant outside the component, or defer the random
call into `useMemo(() => …, [])` / `useRef(Math.random())`.

Stable date expressions are FINE and are NOT flagged: `{new Date().getFullYear()}`
in a footer, or deriving last-N-months labels for a chart axis — these evaluate
to the same value across renders within a session. (`Date.now()` itself is not
forbidden; only its volatile use as a render-time key/seed is discouraged.)

## No fabricated summary cards
Summary cards (total counts, valuations, averages) MUST derive values from
backend data — a `useModel()` aggregation or a `useHandler()` stats call. Do
NOT invent numbers.

## No inline font-family styles
NEVER use `style={ fontFamily: '...' }` — use Tailwind's `font-headline` or
`font-body` classes from the design system instead.

BAD: `<h1 style={ fontFamily: 'Outfit' }>Title</h1>`
GOOD: `<h1 className="font-headline text-4xl font-bold">Title</h1>`

## Color Pairing Mistakes

NEVER assume semantic `on-*` tokens are always white. They come from the resolved theme palette.

BAD:
```tsx
<section className="bg-primary">
  <p className="text-on-surface">Body copy</p>
</section>
```

GOOD:
```tsx
<section className="bg-primary text-on-primary">
  <p>Body copy</p>
</section>
```

BAD:
```tsx
<p className="text-on-primary">Default page text</p>
```

GOOD:
```tsx
<p className="text-on-surface">Default page text</p>
```

BAD:
```tsx
<footer className="bg-inverse-surface">
  <p className="text-on-surface-variant">Muted footer copy</p>
</footer>
```

GOOD:
```tsx
<footer className="bg-inverse-surface text-inverse-on-surface">
  <p>Muted footer copy</p>
</footer>
```

BAD:
```tsx
<p className="text-on-surface/60">Muted text</p>
```

GOOD:
```tsx
<p className="text-on-surface-variant">Muted text</p>
```

## Opacity Modifier Clamps

The validator clamps these patterns automatically. Emit them correctly the
first time so we don't waste tokens on auto-fixes — and so the resulting
component has the right contrast on first render instead of relying on a
clamp pass.

### Never use `text-{color}/{N}` opacity modifiers

ALWAYS use full-opacity text colors. The validator strips `/N` from any
`text-*` class because palette-derived pairs (e.g. `text-on-primary/90` on
`bg-primary`) routinely fail WCAG AA. Use the design system's full-opacity
muted variants instead.

BAD:
```tsx
<p className="text-white/90">Hero subhead</p>
<p className="text-on-surface/60">Caption</p>
```

GOOD:
```tsx
<p className="text-white">Hero subhead</p>
<p className="text-on-surface-variant">Caption</p>
```

### `bg-{color}/{N}` requires `N >= 30`

Backgrounds with opacity below 30% are visually invisible against most
canvases and the validator clamps them to `/30`. If you intend a "barely
there" surface, use `/30` and tune the underlying color choice.

BAD:
```tsx
<div className="bg-white/10">Glass card</div>
<div className="bg-white/20 backdrop-blur">Floating chip</div>
```

GOOD:
```tsx
<div className="bg-white/30 backdrop-blur">Glass card</div>
<div className="bg-surface/40 backdrop-blur">Floating chip</div>
```

### `hover:bg-{color}/{N}` requires `N <= 10`

Hover backgrounds should be subtle hints, not solid swaps. The validator
caps `hover:bg-{color}/{N}` above 10 down to `/10` for visual restraint.

BAD:
```tsx
<button className="hover:bg-white/30">Action</button>
```

GOOD:
```tsx
<button className="hover:bg-white/10">Action</button>
```

## `animate-in duration-N` antipattern

`animate-in` is a Tailwind enter-animation utility. Combining it with the
generic `duration-N` class (e.g. `animate-in duration-300`) emits an
implicit `transition: all` on every property, causing a visible
first-paint layout shift before the animation starts. The validator
auto-rewrites this on every build.

```
✅ animate-in [animation-duration:300ms]
❌ animate-in duration-300
```

Use the arbitrary-value `[animation-duration:Nms]` form whenever you
combine `animate-in` (or `animate-out`) with a duration.

## Heading hierarchy must be sequential

Within a single component, heading levels must descend by one. Skipping
levels (e.g. `h2` followed by `h4`) breaks screen-reader navigation and
SEO outline parsing. The validator auto-demotes skipped headings.

```
✅ <h2>Section</h2> ... <h3>Subsection</h3> ... <h4>Detail</h4>
❌ <h2>Section</h2> ... <h4>Detail</h4>          // skipped h3
```

If you need a smaller-looking heading, use `font-size`/`text-*` classes
on the correct semantic level — never demote the tag.

## Never embed raw third-party image URLs

Images come from the platform asset pipeline only. The agent-side
resolver populates ``<ExepadImage>`` with the right ``src`` automatically
based on `keywords`, downloading and self-hosting the asset under
``__ASSET_IMG:assets/images/<slug>.jpg__``. Never hand-author a URL.

```
❌ <img src="https://images.pexels.com/photos/.../foo.jpeg" />
❌ <ExepadImage src="https://images.unsplash.com/.../bar.jpg" keywords="..." />
❌ image: { src: "https://images.pexels.com/photos/...", vendor: "pexels" }
✅ <ExepadImage keywords="<5+ descriptive words>" importance={5} width={...} height={...} />
✅ image: "__PLACEHOLDER__"   // inside data arrays — resolver fills in the asset path
```

`pexels.com`, `unsplash.com`, `pixabay.com`, `picsum.photos`,
`via.placeholder.com`, and any CDN we don't allow-list are flagged as
hallucinated and rewritten to placeholders.

## NULL SAFETY (MANDATORY)

- `useModel()` returns `data: T[] | null`. ALWAYS use `(data ?? [])` before
  `.map()`, `.filter()`, `.find()`, `.length`, `.forEach()`, `.reduce()`.
  Example: `(courses ?? []).map(c => <div>{c.title}</div>)`
- `useCurrentUser()` returns `email: null`, `name: null`, `id: null` for
  anonymous/unauthenticated/preview users. ALWAYS use optional chaining:
  `user?.email?.toUpperCase()`, `user?.email?.[0]?.toUpperCase() ?? "U"`.
- `useHandler()` returns `data: T | null`. Check before accessing properties:
  `stats?.totalCount ?? 0`.
- Show `<Spinner />` or skeleton when `loading` is true. Handle `error` state.
