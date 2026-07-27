---
name: responsive-mobile-first
description: "Tailwind responsive-design strategy — mobile-first breakpoint usage (sm/md/lg/xl), 44–48 px touch targets, overflow-handling, orientation, dvh viewport units. Always load when authoring layout-heavy components (header, sidebar, footer, hero, dashboard, table, multi-column grid). Keywords: responsive, mobile, mobile-first, breakpoint, sm, md, lg, touch, viewport, dvh, overflow, fluid, container."
metadata:
  kind: domain
---
# Skill: Responsive / Mobile-First Layout

Tailwind v4 is mobile-first by default — base classes apply everywhere,
and `sm:`, `md:`, `lg:`, `xl:` add overrides at progressively wider
viewports. Author every layout starting from the smallest screen.

## Breakpoint cheat sheet

| Prefix | Min-width | Typical use |
|--------|-----------|-------------|
| (none) | 0 px      | Mobile portrait — single column, stacked |
| `sm:`  | 640 px    | Mobile landscape / large phones |
| `md:`  | 768 px    | Tablet portrait — start using 2-col grids |
| `lg:`  | 1024 px   | Tablet landscape / small laptop — 3-col grids, sidebars |
| `xl:`  | 1280 px   | Desktop — wider gutters, fixed-width content |
| `2xl:` | 1536 px   | Large desktop — usually unnecessary |

Most apps need `sm:`, `md:`, `lg:` only. `xl:` for marketing content,
`2xl:` rarely.

## Mobile-first authoring pattern

```tsx
{/* base: stacked, full width, generous padding */}
{/* md+: 2-col grid with smaller gap */}
{/* lg+: 3-col with sidebar layout */}

<div className="
  grid grid-cols-1 gap-6 px-4 py-6
  md:grid-cols-2 md:px-6
  lg:grid-cols-3 lg:px-8 lg:py-12
">
  {items.map(...)}
</div>
```

The base classes never include a `max-` or `min-` prefix. Add overrides
upward, never downward — `lg:grid-cols-3 sm:grid-cols-1` reads right to
left mentally and is bug-prone.

## Touch targets

**Minimum tap target: 44 × 44 px (Apple HIG) / 48 × 48 px (Material).**
Aim for 48 px when content allows. Tailwind:

```tsx
<button className="min-h-12 min-w-12 px-3 ...">       {/* 48 px = 12 * 4 */}
<button className="min-h-11 min-w-11 px-3 ...">       {/* 44 px = 11 * 4 */}
```

Buttons sized only by content (`px-3 py-1.5` → 28 px tall) work on
desktop but fail on mobile — wrap with min-h.

For icon-only buttons, set both dimensions:

```tsx
<button className="h-10 w-10 sm:h-9 sm:w-9 rounded-lg flex items-center justify-center">
  <Icons.X className="h-4 w-4" />
</button>
```

Bigger on mobile (40 px), tighter on desktop (36 px).

## Common patterns

### Hero — stacked on mobile, side-by-side on desktop

```tsx
<section className="grid grid-cols-1 lg:grid-cols-2 gap-12 px-6 py-16 md:py-24">
  <div className="space-y-6 lg:order-1">
    <h1 className="text-4xl md:text-5xl lg:text-6xl">{headline}</h1>
    <p className="text-lg text-muted-foreground">{subhead}</p>
    <Button>Get started</Button>
  </div>
  <div className="lg:order-2">
    <ExepadImage keywords={...} className="rounded-2xl w-full" />
  </div>
</section>
```

`lg:order-1` / `lg:order-2` makes the text appear left, image right on
desktop while stacking text-first on mobile (the order users expect).

### Dashboard — sidebar collapse

```tsx
<div className="min-h-screen flex">
  {/* Sidebar — hidden on mobile, persistent on lg+ */}
  <aside className="hidden lg:block lg:w-64 border-r">
    <Sidebar />
  </aside>

  {/* Mobile sidebar — Sheet from the left */}
  <div className="lg:hidden">
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon">
          <Icons.Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <Sidebar />
      </SheetContent>
    </Sheet>
  </div>

  <main className="flex-1 p-4 lg:p-8">{children}</main>
</div>
```

### Tables — overflow-scroll on mobile

```tsx
<div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
  <table className="w-full min-w-[640px]">
    {/* table cells */}
  </table>
</div>
```

`min-w-[640px]` ensures the table keeps its column widths on narrow
viewports; `overflow-x-auto` lets the user swipe sideways. The
`-mx-4 px-4` lets the scroll area reach the screen edge on mobile.

For large tables, consider switching to a card layout under `md:`:

```tsx
{/* hide table on mobile */}
<table className="hidden md:table w-full">...</table>

{/* show card list on mobile */}
<div className="md:hidden space-y-3">
  {rows.map((r) => <RecordCard key={r.id} record={r} />)}
</div>
```

### Forms — full-width on mobile, max-width on desktop

```tsx
<form className="mx-auto max-w-md w-full px-4 sm:px-0 space-y-6">
  ...
</form>
```

Avoid: `<form className="w-1/2">` — breaks on mobile. Always use
`max-w-*` for desktop sizing, never percentage widths.

## Viewport heights — use `dvh` not `vh`

Mobile browsers' chrome (URL bar, toolbar) changes height as the user
scrolls. `100vh` doesn't account for this — it overflows on iOS Safari.
Use `100dvh` (dynamic viewport height):

```tsx
<div className="h-screen md:h-dvh">         {/* Tailwind v4 has dvh utility */}
<div className="min-h-[100dvh]">             {/* full bleed even when chrome resizes */}
```

For full-screen game canvases or splash screens, `100dvh` is
load-bearing.

## Orientation handling

Most apps don't need explicit orientation logic — the `sm:` breakpoint
handles landscape. For canvas-heavy games or media apps:

```tsx
<div className="aspect-video md:aspect-auto md:h-screen">
  {/* on mobile portrait → 16:9 box */}
  {/* on tablet+ → fill viewport */}
</div>
```

## Container queries (Tailwind v4)

For self-resizing components (cards in a flex/grid that don't know
their own width), container queries beat breakpoints:

```tsx
<div className="@container">
  <div className="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-4">
    ...
  </div>
</div>
```

The `@md:` prefix here means "when the container is ≥ 768 px" — even if
the viewport is 1400 px but the container is in a narrow column.
Tailwind v4 ships container queries enabled by default.

## Anti-patterns

- ✗ Designing desktop-first then bolting on mobile (`xl:grid-cols-3 lg:grid-cols-2 md:grid-cols-1`). Reads backwards. Author mobile-first.
- ✗ `<button className="px-2 py-1 text-xs">` for primary actions. 32-px tall buttons fail mobile usability.
- ✗ `100vh` — overflows on iOS Safari. Use `100dvh`.
- ✗ Fixed widths in pixels (`w-[600px]`) without responsive override. Use `max-w-2xl mx-auto` patterns.
- ✗ `display: none` for entire features on mobile. If the user gets to your URL on a phone, all features should be reachable (perhaps via a Sheet or stacked layout).
- ✗ Tables with 8+ columns and no mobile fallback. Either truncate columns under `md:` or switch to a card list.
- ✗ Tap targets smaller than 44 × 44 px. The validator may not catch this — author it correctly the first time.

## Compatibility

`@exepad/sdk` doesn't override Tailwind breakpoints. The `dvh` utility
and container queries (`@container` + `@<breakpoint>:` prefixes) are
Tailwind v4 native — no plugin required.
