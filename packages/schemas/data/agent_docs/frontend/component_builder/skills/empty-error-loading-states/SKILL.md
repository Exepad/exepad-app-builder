---
name: empty-error-loading-states
description: "UX polish — skeleton loaders during fetch, empty states with \"create your first X\" CTAs, error fallbacks with retry, no-results-from-search distinction. Always load when a component renders async data (useModel, useHandler) or any list/grid/table/dashboard. Universal cross-cutting pattern. Keywords: skeleton, loader, spinner, empty-state, no-data, error, retry, fallback, placeholder, illustration, no-results."
metadata:
  kind: domain
---
# Skill: Empty / Error / Loading States

Three visual states every async-data component must handle. Skipping
them is the #1 "looks unfinished" tell.

## Decision tree

```
data === undefined → loading → render <Skeleton />
data === [] && no error filters → empty → render <EmptyState onAction={create} />
data === [] && filters active → no-results → render <NoResults onReset={...} />
error → error → render <ErrorState onRetry={refetch} />
data → render the list/grid/table
```

## Loading — skeleton placeholders

Use shape-matched skeletons over generic spinners. The user should see
the layout taking shape, not a spinner over an empty area.

```tsx
const { data, loading } = useModel('records');

if (loading) {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-4 rounded-lg border bg-background">
          <div className="h-10 w-10 rounded-full bg-muted animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
```

Rules:
- **Match the real layout's spacing.** A 5-row skeleton for a
  10-row table is fine; a 1-line skeleton for a card grid is not.
- **`animate-pulse`**, not `animate-spin`. Pulse signals "content
  loading"; spin signals "operation in progress".
- **Don't show the spinner first then the skeleton.** Skeleton straight
  through to data; the spinner is for in-place refreshes only.
- **Cap the skeleton count.** Don't render 50 skeletons for a 50-row
  table — 5–10 is enough to fill the viewport.

For inline operations (button click → save), use a button-internal
spinner instead:

```tsx
<Button disabled={saving} onClick={onSave}>
  {saving && <Icons.Loader2 className="mr-2 h-4 w-4 animate-spin" />}
  Save
</Button>
```

## Empty — no data exists yet

```tsx
{data && data.length === 0 && !filtersActive && (
  <div className="py-16 text-center">
    <div className="mx-auto h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center text-primary">
      <Icons.Inbox className="h-8 w-8" />
    </div>
    <h3 className="mt-4 text-lg font-semibold">No applications yet</h3>
    <p className="mt-2 text-muted-foreground max-w-sm mx-auto">
      Applications you receive will show up here. Share your job posting to start collecting them.
    </p>
    <Button className="mt-6" onClick={onCreate}>
      <Icons.Plus className="mr-2 h-4 w-4" /> Create your first application
    </Button>
  </div>
)}
```

Rules:
- **Heading is specific to the entity** ("No applications yet", not "No data").
- **Body explains how rows get created.** "Applications you receive show up here…" is more useful than "Nothing to display".
- **CTA matches the natural creation path.** Click → opens the same
  Dialog the page header's "+ New" button does.
- **Use a contextual icon.** `Inbox`, `FileText`, `Folder`, `Users`,
  `BarChart`, etc. — not the generic `AlertCircle`.

## No results from search/filter (different from "empty")

Important: this is a **separate** state. The data exists, the user's
filter just doesn't match.

```tsx
{filtered.length === 0 && data && data.length > 0 && (
  <div className="py-16 text-center">
    <Icons.SearchX className="mx-auto h-12 w-12 text-muted-foreground" />
    <h3 className="mt-4 text-lg font-medium">No results for "{query}"</h3>
    <p className="mt-2 text-muted-foreground">Try different search terms or clear your filters.</p>
    <Button variant="ghost" className="mt-4" onClick={resetFilters}>Reset filters</Button>
  </div>
)}
```

Don't show a "create your first" CTA here — the user has data, they're
just searching.

## Error — fetch / save failure

```tsx
{error && (
  <div className="py-16 text-center">
    <div className="mx-auto h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center text-destructive">
      <Icons.AlertTriangle className="h-6 w-6" />
    </div>
    <h3 className="mt-4 text-lg font-semibold">Couldn't load applications</h3>
    <p className="mt-2 text-muted-foreground max-w-sm mx-auto">
      {error.message || 'Something went wrong. Try again, or refresh the page.'}
    </p>
    <Button variant="outline" className="mt-4" onClick={refetch}>
      <Icons.RefreshCw className="mr-2 h-4 w-4" /> Try again
    </Button>
  </div>
)}
```

Rules:
- **Always provide a retry path.** Even if the underlying call is
  permanent (404), let the user trigger a fresh attempt — they may have
  fixed the underlying state.
- **Show the actual error message** when it's safe (network errors, validation). Don't show stack traces or auth tokens.
- **Distinguish from empty visually** — destructive-tinted icon, not the
  positive primary tint of an empty state.

## Inline error states for forms

For form submission failures, render the error inline above the
submit button — not as a toast (toasts dismiss before the user can
read them):

```tsx
{submitError && (
  <div className="flex items-start gap-2 p-3 rounded-lg border border-destructive/20 bg-destructive/5 text-sm">
    <Icons.AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
    <div>
      <p className="font-medium text-destructive">Couldn't save</p>
      <p className="text-muted-foreground">{submitError}</p>
    </div>
  </div>
)}
```

## Anti-patterns

- ✗ A bare `<div>Loading...</div>` text, especially centered. Skeleton or spinner.
- ✗ "No data" with a generic frowning-face icon and no CTA. Always offer the next action.
- ✗ Empty states that suggest contacting support before suggesting "+ New".
- ✗ Showing loading skeleton during a save operation. Keep the existing list visible; show the spinner inside the Save button.
- ✗ Wrapping everything in `<ErrorBoundary>` and showing a generic "Oops". Catch errors at the data layer, render contextual messages.
- ✗ Skeleton that doesn't match real layout (3 lines of `h-2` bars where the real card has icon + heading + body — looks broken when content swaps in).

## Compatibility

`Icons.Inbox`, `Icons.SearchX`, `Icons.AlertTriangle`, `Icons.AlertCircle`, `Icons.RefreshCw`, `Icons.Loader2` are all standard Lucide. The
`animate-pulse` and `animate-spin` utilities are Tailwind defaults — no
SDK helper needed.
