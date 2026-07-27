---
name: a11y-keyboard-aria
description: "Proactive WCAG-AA accessibility patterns — focus management, keyboard navigation, ARIA labels, alt text, semantic HTML, skip links, screen-reader-only text. Complements the deterministic AST a11y validator. Always load when building any interactive component (forms, dialogs, lists, navs, custom widgets). Keywords: accessibility, a11y, wcag, aria, keyboard, focus, screen-reader, alt-text, semantic, skip-link, sr-only, tab-order."
metadata:
  kind: domain
---
# Skill: Accessibility — Keyboard & ARIA

The CSS-AST validator already enforces the **mechanical** rules
(contrast pairs, button labels, image alt presence, dialog descriptions).
This skill teaches the **proactive design choices** the validator can't
catch — keyboard reachability, focus order, semantic markup, error
association.

## Foundation: prefer semantic HTML over custom widgets

The first accessibility move is choosing the right element. A button
that's a `<button>` gets keyboard activation, focus ring, and
`role="button"` for free.

| Use case | Wrong | Right |
|----------|-------|-------|
| Click-to-do | `<div onClick>` | `<button>` |
| Link to elsewhere | `<button onClick={navigate}>` | `<a href>` (or SDK `<Link>`) |
| List | `<div><div>...</div></div>` | `<ul><li>...</li></ul>` |
| Form region | `<div className="form">` | `<form>` |
| Heading | `<div className="text-2xl">` | `<h2>` |
| Status message | inline `<span>` | `<div role="status">` or `<output>` |

The Radix-backed SDK primitives (`<Dialog>`, `<DropdownMenu>`,
`<Tabs>`, `<Popover>`) ALL bake in ARIA roles, focus management, and
keyboard nav. Use them; don't reinvent.

## Focus management

Every interactive element MUST be reachable by keyboard and have a
visible focus state.

```tsx
// the SDK theme already provides this on <Button>; for custom controls:
<button className="rounded-lg px-4 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
```

Rules:
- **Use `:focus-visible`, not `:focus`.** `:focus` shows the ring on
  mouse click too — visually noisy. `:focus-visible` only shows on
  keyboard navigation.
- **Never `outline: none` without a replacement.** Removing the ring
  with no alternative is the single most-cited accessibility regression.
- **`tab-index="-1"` on programmatic-focus targets only.** Don't use it
  to skip elements; use semantic structure instead.

### Auto-focus on dialog open

Radix `<Dialog>` already focuses the first focusable element. To focus
a specific input:

```tsx
const inputRef = useRef<HTMLInputElement>(null);
useEffect(() => {
  if (open) setTimeout(() => inputRef.current?.focus(), 0);
}, [open]);
```

### Restore focus after dialog close

Radix does this automatically — the trigger button regains focus when
the dialog closes. Don't override.

## Keyboard navigation patterns

| Widget | Required keys | SDK primitive |
|--------|--------------|---------------|
| Button | Enter, Space | `<Button>` |
| Link | Enter | `<a>` / `<Link>` |
| Tab list | ←/→/Home/End | `<Tabs>` |
| Menu | ↑/↓/Enter/Esc | `<DropdownMenu>` |
| Dialog | Tab/Shift+Tab/Esc | `<Dialog>` |
| Combobox | ↑/↓/Enter/Esc/typing | `<Combobox>` |
| Listbox | ↑/↓/Enter | custom — see below |

For custom listbox-style widgets (e.g. arrow-key navigation through
filter chips):

```tsx
const refs = useRef<(HTMLButtonElement | null)[]>([]);

function onKeyDown(e: React.KeyboardEvent, i: number) {
  if (e.key === 'ArrowRight') { e.preventDefault(); refs.current[i + 1]?.focus(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); refs.current[i - 1]?.focus(); }
  if (e.key === 'Home')       { e.preventDefault(); refs.current[0]?.focus(); }
  if (e.key === 'End')        { e.preventDefault(); refs.current[refs.current.length - 1]?.focus(); }
}
```

## ARIA: only when semantic HTML can't do it

ARIA is a **last resort**, not a default. The first rule of ARIA is "no
ARIA is better than bad ARIA".

### Required ARIA attributes

```tsx
{/* icon-only button — invisible label */}
<button aria-label="Close" onClick={close}>
  <Icons.X className="h-4 w-4" />
</button>

{/* buttons that toggle state */}
<button aria-pressed={isFavorite} onClick={toggle}>
  <Icons.Star className={isFavorite ? 'fill-current' : ''} />
</button>

{/* dynamic alerts (validation errors, async results) */}
<div role="alert" className="text-destructive">{errorMsg}</div>

{/* live regions for non-critical updates */}
<div role="status" aria-live="polite">{loading ? 'Saving…' : ''}</div>
```

### Non-interactive value displays (ratings, gauges, meters)

A read-only display that encodes a value **only** through repeated icons or
colour — a star rating, a progress meter, a sentiment gauge — is silent to a
screen reader: the icons are decorative SVGs and the number never reaches the
accessibility tree. Give the container `role="img"` with an `aria-label` that
states the value, so it's announced as a single labelled image.

```tsx
{/* ✗ silent — a screen reader announces nothing; the 4/5 is colour-only */}
<div className="flex gap-0.5">
  {[1, 2, 3, 4, 5].map((star) => (
    <Icons.Star key={star} className={star <= rating ? 'fill-primary text-primary' : 'text-outline-variant'} />
  ))}
</div>

{/* ✓ announced as "4 out of 5 stars"; individual stars hidden as decorative */}
<div className="flex gap-0.5" role="img" aria-label={`${rating} out of 5 stars`}>
  {[1, 2, 3, 4, 5].map((star) => (
    <Icons.Star key={star} aria-hidden="true" className={star <= rating ? 'fill-primary text-primary' : 'text-outline-variant'} />
  ))}
</div>
```

Rules:
- **The label carries the value**, not just the metric: `"4 out of 5 stars"`,
  `"63% complete"`, `"Priority: high"` — never a bare `aria-label="rating"`.
- **A helper that returns a bare array of icons** (e.g. `renderStars(value)`)
  has no container to label — wrap its output in a `role="img"` element, or
  add an sibling `<span className="sr-only">{value} out of 5</span>`.
- **This is distinct from an interactive rating input**, where each star is its
  own `<button aria-label="Rate N stars">` — see the aria-pressed example above.
- Applies equally to icon-only status pills, trend arrows (`↑ 12%`), and any
  chart/sparkline whose meaning is visual: give it a text alternative.

### Form labels and errors

```tsx
<div>
  <Label htmlFor="email">Email</Label>
  <Input
    id="email"
    type="email"
    aria-describedby={error ? "email-error" : undefined}
    aria-invalid={!!error}
    value={email}
    onChange={(e) => setEmail(e.target.value)}
  />
  {error && <p id="email-error" role="alert" className="mt-1 text-sm text-destructive">{error}</p>}
</div>
```

Rules:
- **Every input has a visible `<Label htmlFor>`.** Placeholder text is
  not a label.
- **Errors are linked via `aria-describedby`** so screen readers
  announce them on focus.
- **`aria-invalid` mirrors validation state** — gives the screen reader
  more context than colour alone.

### Hidden labels

For inputs without a visible label (search bars in toolbars):

```tsx
<input type="search" aria-label="Search records" />
```

Or use the SDK convenience:

```tsx
<Label htmlFor="q" className="sr-only">Search</Label>
<Input id="q" type="search" placeholder="Search…" />
```

## Image alt text

```tsx
{/* informative image — describe content */}
<ExepadImage src="..." alt="Bar chart showing revenue per quarter from 2023 to 2025" />

{/* decorative image — empty alt to hide from screen readers */}
<ExepadImage src="..." alt="" role="presentation" />

{/* user-uploaded avatar — fallback gracefully */}
<ExepadImage src={user.avatar_url} alt={`Avatar of ${user.name}`} />
```

Rules:
- **Alt describes meaning, not appearance.** "Photo of woman" → "Photo
  of Jennifer Martinez, VP Marketing".
- **Decorative images get `alt=""`** — empty, not omitted.
- **Don't repeat surrounding text** in alt. If a heading already says
  "Quarterly revenue", the chart alt is the *content* of the chart, not
  the title again.

## Skip links (for marketing/multi-page apps)

The first focusable element on every page should be a "Skip to main
content" link, hidden by default but visible on focus:

```tsx
<a
  href="#main"
  className="absolute left-4 top-4 -translate-y-20 focus:translate-y-0 transition-transform z-50 px-4 py-2 rounded-lg bg-primary text-primary-foreground"
>
  Skip to main content
</a>

<main id="main" tabIndex={-1}>
  {/* … */}
</main>
```

Belongs in the page-level layout, not per-component — note in the
component plan if missing.

## sr-only utility

For screen-reader-only text (not visible, but spoken):

```tsx
<button>
  <Icons.Trash className="h-4 w-4" />
  <span className="sr-only">Delete</span>
</button>
```

The SDK theme defines `.sr-only` (visually hidden, screen-reader
accessible). Use it instead of `aria-label` when the text is more than
a single word — `sr-only` is easier to translate.

## Anti-patterns

- ✗ `role="button"` on a `<div>`. Use `<button>`.
- ✗ `tabIndex={0}` on a `<div>` to "make it focusable". Use a `<button>`.
- ✗ Toast as the only error feedback. Toasts disappear; users with
  cognitive accessibility needs miss them. Pair with inline error.
- ✗ Colour-only signaling (red text for error, green for success). Pair
  with an icon or a phrase.
- ✗ `aria-label` on text-bearing elements ("Save" button with
  `aria-label="Save"`). Redundant.
- ✗ `onKeyPress`. Deprecated. Use `onKeyDown`.
- ✗ Focus ring removed without replacement (`focus:outline-none` alone).

## Compatibility

`Icons.*`, `<Label>`, `<Input>`, `<Button>`, `<Dialog>`, `<DropdownMenu>` ship from `@exepad/sdk`. The `.sr-only` Tailwind utility is built in. WCAG-AA contrast pairs are enforced by the CSS-AST validator (separate from this skill).
