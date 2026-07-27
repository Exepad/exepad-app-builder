---
name: performance-audit
description: "Performance audit profile for the Surveyor — bundle size, missing useEffect deps, unvirtualized lists, unmemoized child renders, expensive renders inside loops, large image assets without sizing. Use when the user reports the app feels slow, laggy, janky, frozen, or stuttering. Output is evidence-bound findings citing specific TSX locations and the antipattern detected. Keywords: slow, lag, jank, freeze, stutter, performance, perf, render, fps, hitch, sluggish."
metadata:
  kind: diagnostic-profile
  applies_to: surveyor
  tool_budget: '6'
  intent_keywords: "slow lag jank freeze stutter sluggish laggy choppy hitching slow_to_load"
---
# Performance Audit Investigation

The user feels the app is slow. Your job is to identify the specific
antipatterns causing the perceived slowness, cite evidence from
component sources, and tell the Editor what to refactor.

## Step 1 — Restate the symptom concretely

Convert "feels slow" into something testable. Examples:

- "Initial page paint feels slow" → "Slow first paint: hero image is
  not sized; CLS triggers a relayout."
- "Typing in the search box stutters" → "Per-keystroke filter renders
  1,200 list items without memoisation."
- "Scrolling the dashboard hitches" → "All chart datasets recompute
  every scroll frame because their useMemo deps include a new array
  reference."

Be specific. "Slow" is not a finding; "rerender storm on
DashboardPage:117" is.

## Step 2 — Targeted scan (tool-driven)

Use these tools in order, stopping early if you find sufficient cause:

1. **`list_artifacts_tool`** — get the artifact map. Note any
   `codefocus_component:*.tsx` larger than ~12 KB (often a render
   hot-spot).
2. **`describe_artifact_tool`** for the suspect component(s) — count
   `useEffect`, `useMemo`, `useCallback` and their dep arrays.
3. **`search_artifacts_tool`** for known antipatterns:
   - `useMemo\\([^,]+,\\s*\\[\\]\\)` — empty-deps memo (= useEffect-once,
     usually wrong)
   - `\\.map\\(.*=>.*<.*\\.\\.\\..*\\)` — spread inside a list render
   - `<img\\s+(?!.*(?:width|height|className.*aspect-))` — unsized image
   - `new (Date|Set|Map|Array)\\(` inside JSX — fresh allocation each
     render
   - `setState.*setState` — multiple sequential setStates in handlers

For each hit, note the file + line.

## Step 3 — Common antipatterns and severity

### High severity (visible jank)

| Antipattern | Detection | Fix recipe |
|-------------|-----------|-----------|
| List of >100 items without virtualization | grep for `\.map(` over arrays bigger than 100 in seed/state | Switch to a windowed list (`<VirtualList>`) or pagination |
| `useEffect` with missing deps causing re-fetch loop | dep array doesn't include all referenced state | Add the missing deps; or wrap in `useCallback` |
| Object/array literal in JSX prop | `<Child config={{ x: 1 }} />` causes re-render every parent render | Hoist to const or `useMemo` |
| Image without `width`/`height` | unsized `<img>` triggers CLS layout shift | Add intrinsic dimensions; use `<ExepadImage>` |
| Per-render `new Date()`, `new Set()` | fresh ref every render | Move outside component or wrap in `useMemo` |

### Medium severity (degrades over time)

| Antipattern | Detection | Fix |
|-------------|-----------|-----|
| `useMemo` over a primitive computation | `useMemo(() => x + y, [x, y])` | Remove — primitives don't benefit |
| Component defined inside another component | function declaration inside render | Extract to module scope |
| Listener attached every render | `addEventListener` in render body | Move to `useEffect` with cleanup |
| Wrong key in lists (`key={i}`) | array index as key on dynamic lists | Use stable id |
| Heavy compute in render | `data.filter(...).sort(...).reduce(...)` directly in JSX | `useMemo` if deps are stable |

### Low severity (hygiene)

- Logging in render (`console.log` in component body)
- Inline event handlers (`onClick={() => setOpen(true)}`) — only matters
  for memoised children; otherwise fine

## Step 4 — Output structure

Produce evidence-bound findings — same shape as `bug-root-cause`:

```jsonc
{
  "symptom": "Dashboard stutters on scroll, ~5 fps under typing",
  "findings": [
    {
      "severity": "high",
      "antipattern": "rerender_storm",
      "file": "codefocus_component:DashboardPage.tsx",
      "line_range": "117-145",
      "evidence": "<DataTable data={records.filter(r => r.status === filter).sort(...)} /> — filter+sort on every render of 1240 records",
      "fix_hint": "Wrap the filter+sort in useMemo([records, filter]) so the work runs only when records or filter change."
    },
    {
      "severity": "medium",
      "antipattern": "unsized_image",
      "file": "codefocus_component:HeroSection.tsx",
      "line_range": "48",
      "evidence": "<img src={...} /> with no width/height triggers CLS",
      "fix_hint": "Replace with <ExepadImage keywords=... className=\"aspect-video w-full\" /> or specify intrinsic dimensions."
    }
  ]
}
```

## Tool budget

`tool_budget: 6` — caps your tool calls. Spend roughly:
1. `list_artifacts_tool` (1 call)
2. `search_artifacts_tool` for the big-pattern regexes (2–3 calls)
3. `describe_artifact_tool` on the worst-offender component (1 call)
4. `find_symbol_references_tool` if you need to confirm where a heavy
   helper is called (1 call optional)

## Anti-patterns to avoid in your diagnosis

- ✗ Suggesting `useCallback` everywhere. Most callbacks don't need it
  unless they're props on memoised children.
- ✗ Recommending `React.memo` blanket-wrap. Adds prop-equality cost;
  only meaningful when the parent re-renders frequently with stable
  props.
- ✗ "The app uses too many useState hooks." Hook count isn't the issue;
  per-render work is.
- ✗ Naming "performance" vaguely. Always cite a specific antipattern
  + file + line.

## Compatibility

This profile reuses the existing Surveyor toolset (`list_artifacts`,
`search_artifacts`, `describe_artifact`, `find_symbol_references`,
`inspect_app_state`). No new tools are required.
