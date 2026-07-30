---
name: cascade-enumeration
description: "Full field-level dependency walk for structural-class intents. Use when the user wants to rename, remove, restructure, or split something — \"rename this column\", \"remove this handler\", \"split the dashboard\". The Surveyor's job is to enumerate every site that depends on the affected entity, so the Editor's plan covers the cascade and doesn't leave dangling references. Output is a context+root_cause hybrid where the \"root cause\" of any future failure would be missing one cascade site."
metadata:
  kind: diagnostic-profile
  applies_to: surveyor
  tool_budget: '5'
  intent_keywords: rename remove split restructure delete extract refactor
---
# Cascade Enumeration Investigation

The user wants to make a structural change. **Your job is to enumerate
every consumer / dependent of the affected entity** so the Editor's
plan covers the full cascade.

The bug class you prevent: "the rename or remove only updated one site,
the others now break". This is structurally identical to the
`bug-root-cause` class but discovered preemptively rather than after the
user complains.

## Step 1 — Identify the entity being changed

Determine from the user's request:

- **Field rename / remove** — which producer's field, and what's the
  new name?
- **Handler rename / remove** — which handler?
- **Component rename / remove / split** — which component?
- **Page rename / slug change / remove** — which page?
- **Model rename / column rename / remove** — which model and column?

Restate as `symptom`:

> "User wants to rename handler `getOccupancyTrend` to
> `getRoomOccupancyByDay`. Need to enumerate every consumer that calls
> `useHandler('getOccupancyTrend')` so the Editor pairs the rename with
> a frontend cascade."

## Step 2 — Run the appropriate enumeration tool

### Field-level rename / remove

```
field_mismatch_report_tool(components=None)
```

Look at the `producers` map for the affected handler/model. Then look
at `consumer_sites` per component to find every site that reads the
field you're about to rename/remove.

Each site becomes one entry in `affected_entities` for a
`severity: context` finding (or `root_cause` if you can already see a
prior turn shipped a partial change).

### Handler-level rename / remove

```
find_symbol_references_tool(symbol="getOccupancyTrend", kinds=["all"])
```

Returns every site that calls or imports the handler. Cross-check with:

```
inspect_app_state_tool('handlers')
```

to confirm the handler exists and to see its declared signature.

### Component-level rename / remove / split

```
find_symbol_references_tool(symbol="DashboardContent", kinds=["import", "jsx_element"])
discover_dependencies_tool(file_names=["codefocus_component:DashboardContent.tsx"], direction="imported_by", transitive=True)
```

The dependency graph tells you which other components / modules import
this one — every importer needs updating on a remove or split.

### Model-level rename / column rename / remove

```
inspect_app_state_tool('models')
```

to confirm the model + column exist.

```
search_artifacts_tool(pattern="useModel\\(['\"]<model_name>['\"]")
```

to find every `useModel` call against this model. For column-level
changes, also run `field_mismatch_report_tool` — the columns appear in
the model_shapes map and consumer reads will surface mismatches.

For backend-side cascades (handlers that SQL against the model), use:

```
search_artifacts_tool(pattern="FROM <model_name>|<model_name>\\.\\b", name_glob="handler_code:*")
```

### Page rename / slug change

```
search_artifacts_tool(pattern="navigate\\(['\"]<old_slug>|to=['\"]<old_slug>")
```

Captures `navigate('/old-slug')` and `<Link to="/old-slug">` references.
Plus check the page registry via `inspect_app_state_tool('pages')`.

## Step 3 — Build the cascade map

Each affected site becomes a Finding. Use `severity: context` for the
"this is a site that needs updating" claims:

```json
{
  "statement": "DashboardContent calls useHandler('getOccupancyTrend') at line 24. Will need to be updated to the new name.",
  "severity": "context",
  "evidence": [
    {
      "tool": "find_symbol_references_tool",
      "args": {"symbol": "getOccupancyTrend"},
      "excerpt": "DashboardContent.tsx:24 (kind=string_literal_argument): const { data: trend } = useHandler(\"getOccupancyTrend\", { params: { days: 30 } });",
      "location": "DashboardContent.tsx:24"
    }
  ],
  "affected_entities": ["DashboardContent"]
}
```

Group multiple sites for the same entity into ONE finding (e.g. a
handler called from three components → one finding with three Evidence
records).

## Step 4 — Set the resolution shape

For cascade-enumeration:

- **`rename_with_cascade`** — most common case. Producer + every
  consumer needs updating. The Editor must pair the
  rename action with a `FrontendBuildAction` whose prompt names every
  consumer site.
- **`remove_dead_field`** — the entity has no consumers, removal is
  safe. The Editor can skip the cascade.
- **`unknown`** — you couldn't enumerate the cascade fully (e.g. the
  symbol references tool returned errors, or the codebase contains
  string-constructed handler names that static analysis can't catch).
  `confidence: low`, list the gap in `blockers`.

## Step 5 — Surface a `root_cause` finding ONLY if a prior turn shipped a partial change

Run `prior_turn_diff_tool()`. If the prior turn already started this
cascade and stopped halfway:

```json
{
  "statement": "Prior turn renamed handler `getMetrics` to `getDashboardKPIs` but did not update DashboardContent.tsx (still calls useHandler('getMetrics')). The Editor's plan must include a frontend cascade.",
  "severity": "root_cause",
  "evidence": [
    {
      "tool": "prior_turn_diff_tool",
      "args": {},
      "excerpt": "Prior turn: modify_handler(getMetrics) renamed via new_outputs; no frontend_build action paired.",
      "location": "session_state:edit_plan"
    },
    {
      "tool": "find_symbol_references_tool",
      "args": {"symbol": "getMetrics"},
      "excerpt": "DashboardContent.tsx:21 (kind=string_literal_argument): const { data: metrics } = useHandler(\"getMetrics\");",
      "location": "DashboardContent.tsx:21"
    }
  ],
  "affected_entities": ["DashboardContent", "getMetrics"]
}
```

## Tool budget — ~5 calls

Typical flow:

1. `prior_turn_diff_tool()` (free signal, always run)
2. `inspect_app_state_tool(<relevant kind>)` — orient (1)
3. `find_symbol_references_tool` OR `field_mismatch_report_tool` — main
   enumeration (1)
4. `discover_dependencies_tool` (only when component-level)
5. (Optional) `search_artifacts_tool` for string-literal references not
   caught by the AST tools

If you've spent 5 calls and still can't enumerate the cascade fully, set
`confidence: medium` with the partial enumeration and list the
unenumerated risk in `blockers`. The Editor can then choose to be more
conservative.

## Confidence

- `high` — full cascade enumerated, no string-constructed references
  suspected, the Editor has every site it needs to touch.
- `medium` — most sites enumerated, but some risk of dynamic / string-
  constructed references the static tools missed. Editor should run
  follow-up symbol-reference searches when planning.
- `low` — could not enumerate fully; user should consider a smaller
  refactor.

## Anti-patterns

- ❌ Stopping at the first reference. Enumerate ALL of them.
- ❌ Returning `severity: root_cause` for the cascade sites themselves.
  They aren't bugs YET — they will be after the rename ships unpaired.
  Use `severity: context`. Reserve `root_cause` for the prior-turn-
  partial-change case.
- ❌ Skipping `find_symbol_references_tool` because "I can grep for the
  name". Symbol references are AST-aware (no false positives in
  comments / string literals); raw grep is not.
- ❌ Loading full source of every importer when `discover_dependencies_tool`
  + structural summaries already gave you the cascade sites.
