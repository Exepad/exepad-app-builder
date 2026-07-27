---
name: search-and-filter
description: "Search/filter UX for list views — debounced text search, multi-select filter chips, status/category dropdowns, sort, URL-synced query state, empty-search-results UX. Load when a CRUD/dataapp list view needs interactive filtering or search beyond a static table. Composes with crud-data-app for the data layer. Keywords: search, filter, debounce, chips, sort, query, faceted, multi-select, search-input, no-results."
metadata:
  kind: domain
---
# Skill: Search & Filter UX

For list/table/grid views that need interactive filtering. The data
layer (model fetch, useModel) is covered by [`crud-data-app`](../crud-data-app/SKILL.md);
this skill covers the **input UX** that drives the filter state.

## Search input — always debounce

```tsx
import { useState, useEffect } from 'react';

function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

const [query, setQuery] = useState('');
const debounced = useDebounced(query, 250);

// debounced is what you pass to filtering/server queries
const filtered = useMemo(
  () => (data ?? []).filter((r) =>
    !debounced || r.name.toLowerCase().includes(debounced.toLowerCase())
  ),
  [data, debounced]
);
```

**Rules:**
- 250 ms debounce. 100 ms feels twitchy; 500 ms feels laggy.
- The text input itself stays controlled (`value={query}`); the
  debounced value drives derived state.
- Show a clear button (`<Icons.X>`) inside the input when `query` is
  non-empty.

```tsx
<div className="relative max-w-md">
  <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
  <Input
    placeholder="Search by name…"
    value={query}
    onChange={(e) => setQuery(e.target.value)}
    className="pl-9 pr-9"
  />
  {query && (
    <button
      onClick={() => setQuery('')}
      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-muted"
      aria-label="Clear search"
    >
      <Icons.X className="h-4 w-4 text-muted-foreground" />
    </button>
  )}
</div>
```

## Filter chips — multi-select toggles

For status, category, tag-like filters: render each option as a chip
the user can toggle on/off.

```tsx
const STATUSES = ['active', 'paused', 'archived'] as const;
const [selected, setSelected] = useState<Set<string>>(new Set());

function toggle(s: string) {
  setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });
}

return (
  <div className="flex flex-wrap gap-2">
    {STATUSES.map((s) => (
      <button
        key={s}
        onClick={() => toggle(s)}
        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
          selected.has(s)
            ? 'bg-primary text-primary-foreground border-primary'
            : 'bg-background text-foreground border-border hover:bg-muted'
        }`}
      >
        {s}
        {selected.has(s) && <Icons.Check className="inline ml-1 h-3 w-3" />}
      </button>
    ))}
    {selected.size > 0 && (
      <button onClick={() => setSelected(new Set())} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground">
        Clear filters
      </button>
    )}
  </div>
);
```

**Empty selection means "all" — don't filter at all** in that branch.
Filtering by an empty Set produces zero results, which surprises users.

## Filter combinations

Compose query + chips + sort into a single derived view:

```tsx
const filtered = useMemo(() => {
  let rows = data ?? [];
  if (debounced) {
    const q = debounced.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(q));
  }
  if (selected.size > 0) {
    rows = rows.filter((r) => selected.has(r.status));
  }
  if (sortKey) {
    rows = [...rows].sort((a, b) => {
      const [av, bv] = [a[sortKey], b[sortKey]];
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
    });
  }
  return rows;
}, [data, debounced, selected, sortKey, sortDir]);
```

## URL-synced state (optional, for shareable filtered views)

When filters should survive a refresh / be shareable, sync to query
params via the SDK's `useQueryParam` (or hand-roll with
`URLSearchParams`):

```tsx
import { useQueryParam } from "@exepad/sdk";

const [query, setQuery] = useQueryParam('q', '');         // ?q=foo
const [status, setStatus] = useQueryParam('status', '');  // ?status=active,paused
```

Don't sync transient state (debounce timing, hover states, modal open).
Only sync user intent (query, selected filters, sort, page).

## Empty-search-results

A search returning zero rows is a **different empty state** than "no
data exists" — load [`empty-error-loading-states`](../empty-error-loading-states/SKILL.md)
for the canonical pattern. Short version:

```tsx
{filtered.length === 0 && data && data.length > 0 && (
  <div className="py-16 text-center">
    <Icons.SearchX className="mx-auto h-12 w-12 text-muted-foreground" />
    <h3 className="mt-4 text-lg font-medium">No results for "{debounced}"</h3>
    <p className="mt-2 text-muted-foreground">Try a different search or clear your filters.</p>
    <Button variant="ghost" className="mt-4" onClick={() => { setQuery(''); setSelected(new Set()); }}>
      Reset filters
    </Button>
  </div>
)}
```

The reset button must clear **all** active filters in one click — a
must-have escape hatch.

## Sort headers (for tables)

```tsx
function SortHeader({ k, label }: { k: string; label: string }) {
  const active = sortKey === k;
  return (
    <button
      className="flex items-center gap-1 font-medium hover:text-foreground"
      onClick={() => {
        if (active) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        else { setSortKey(k); setSortDir('asc'); }
      }}
    >
      {label}
      <Icons.ChevronUp className={`h-3 w-3 transition-transform ${active && sortDir === 'desc' ? 'rotate-180' : ''} ${active ? 'opacity-100' : 'opacity-30'}`} />
    </button>
  );
}
```

## Anti-patterns

- ✗ Filter on every keystroke without debounce. Burns CPU on `.filter()`/server calls; the indicator flickers.
- ✗ Using `<select>` for multi-select. Native multi-select is unusable on touch and rarely on desktop. Use chips or a custom `<DropdownMenu>` with checkmarks.
- ✗ "Apply filters" button. Filters should apply on change. The user already toggled the chip — they don't want to confirm twice.
- ✗ Filters that hide rows the user just edited ("just saved a draft, now it's gone"). Indicate it with a toast or briefly highlight after save.
- ✗ Server-side filtering when client-side handles it. If the dataset is < 1000 rows and already loaded, filter in memory; don't refetch.

## Compatibility

`useDebounced` is a small inline hook (no SDK helper). `useQueryParam`
ships with the SDK if URL sync is needed. `Icons.Search`, `Icons.X`,
`Icons.SearchX`, `Icons.ChevronUp` are the canonical Lucide icons —
don't invent new ones.
