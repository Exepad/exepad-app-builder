---
name: bug-root-cause
description: "Field-mismatch sweep, prior-turn diff, code revision diff, and (when enabled) live runtime probes for fix-class intents. Use when the user reports broken behavior — \"doesn't work\", \"shows wrong X\", \"no data\", \"still empty after the last fix\", \"values are zero\". Output is evidence-bound root_cause findings citing specific producer/consumer source locations. The load-bearing tool is field_mismatch_report_tool — it deterministically detects frontend↔backend field-name mismatches without LLM reasoning, which is the largest class of post-fix regressions."
metadata:
  kind: diagnostic-profile
  applies_to: surveyor
  tool_budget: '15'
  intent_keywords: "broken doesn't_work no_data wrong missing zero empty still_not_working after_fix"
---
# Bug Root Cause Investigation

The user is reporting broken behavior. Your job is to find the proximate
cause, cite evidence from your tools, and tell the Editor what shape of
fix to plan. **No guessing. No name-based intuition. Tool-call evidence
only.**

## Step 1 — Restate the symptom concretely

Start your `symptom` field with the user's literal words, then refine to
something testable:

> "Chart displays no data" → "Occupancy Rate Trend (30 Days) chart renders
> the SVG container but no Charts.Area path elements appear because the
> data prop's array elements lack the field referenced by `dataKey`."

If you don't yet know the mechanism, leave the second clause empty until
you've gathered evidence. Don't speculate.

## Step 2 — Always run the prior-turn check first

Call `prior_turn_diff_tool()` and `prior_turn_diagnosis_tool()` BEFORE
anything else. If the user is on a fix-class request, there's a high
chance a prior turn already touched this code and the user is back
because that didn't work.

**Pattern: "prior fix renamed one side, didn't update the other."**
This is the `tfluo79j` bug class shipped 2026-05-08:

- Turn N: handler `getOccupancyTrend` renames output field `rate` → `percentage`.
- Turn N+1: user reports the chart is still empty.
- Cause: `<Charts.Area dataKey="rate">` was never updated; consumer reads
  a field the producer no longer returns.

If `prior_actions_summary` shows a handler/model rename in the prior turn
and the user's current complaint mentions the same surface, suspect this
class first. Verify with `field_mismatch_report_tool`.

## Step 2.5 — Diff the deployed code if the symptom is regression-shaped

When the user's wording is regression-shaped — "worked yesterday", "after
your last edit it stopped working", "you broke X" — call
`code_revision_diff_tool` on the affected file. This diffs the current
GCS-versioned blob against the immediately-prior revision, so it shows
what literally shipped (after auto-fixers + validation cleanups), not
what the planner intended:

```
code_revision_diff_tool(kind='handler', name='getOccupancyTrend')
code_revision_diff_tool(kind='component', name='DashboardContent')
code_revision_diff_tool(kind='seed', name='reservations')
```

The result includes a `unified_diff` field. Cite it as Evidence with
`tool: "code_revision_diff_tool"`. Pair with `field_mismatch_report_tool`
— the diff tells you *what* changed; the mismatch report tells you
*whether* the change broke a producer/consumer contract.

If the tool returns `has_revisions: false` with `note: 'single_revision_only'`,
the file has never been edited — skip and move on. If the diff is empty
the symptom isn't a regression in this file; investigate elsewhere.

## Step 3 — Run the field-mismatch sweep

```
field_mismatch_report_tool(components=[<the affected component, if known>])
```

If you don't know which component is affected yet, omit `components` to
scan everything. The tool returns:

```
{
  "producers": {handler_name: {field: type}, ...},
  "models": {model_name: {column: "unknown"}, ...},
  "components_scanned": [...],
  "mismatches": [
    {producer, consumer, field, kind, sites, detail}, ...
  ]
}
```

`mismatches[*].kind` semantics:

- **`missing_in_producer`** — the rate/percentage bug class. Consumer reads
  field X; producer never returns X. **This is almost always a
  `severity: root_cause` finding** — cite the mismatch as Evidence with
  `tool: "field_mismatch_report_tool"` and the specific producer/consumer
  names + line/col from `sites`.
- **`dead_in_consumer`** — producer returns a field nothing reads. Often
  benign (forward-compat); usually a `contributing` or `warning` finding,
  not a root cause.
- **`type_mismatch`** — producer returns string, consumer treats as number.
  Less common in MVP (type inference is shallow); when it fires, treat as
  `root_cause`.

If the sweep returns zero mismatches, the bug isn't in the field-name
contract. Move to step 4.

## Step 4 — If field-mismatch comes up empty

Investigate other root-cause classes:

### Data emptiness — handler returns `[]`

The handler may run successfully but return no rows. Causes seen in
production:

- Date filters mismatched against data shape (e.g. `check_in <= date AND
  check_out > date` filtered everything because the seed data uses ISO
  timestamps with timezone suffixes that the comparison strips).
- WHERE clause uses byte-exact comparison against data with different
  case (e.g. `WHERE status = 'cancelled'` against `'Cancelled'` — see the
  `component_filter_enum_case` rule).
- Handler queries a model that has zero rows (no seed data, user hasn't
  created anything yet).

For these, you can't prove the cause from static analysis alone — they're
runtime/data dependent. If Class B runtime probes are available
(`execute_handler_tool` etc. — see Step 4.5), call them now to promote
the finding from `contributing` to `root_cause`. Otherwise set
`confidence: medium`, emit a `contributing` finding with the suspected
mechanism, and let the Editor decide.

## Step 4.5 — Class B runtime probes (when feature-flagged on)

If the following tools are present in your toolset, you can probe the
live preview deployment to settle data/runtime questions that static
analysis can't reach. **If these tools are absent, skip this section
entirely** — the feature flag is off and you should proceed with Class
A/C tools only.

Available Class B tools:

- `execute_handler_tool(handler_name, params={}, as_user=None)` — proxies
  a single handler call to the preview WfP worker. Returns
  `{status, duration_ms, response, error?}`. **Pass `as_user=<owner_id>`
  to probe data the real user sees**; without it, handler row filters
  on `owner_id` return rows owned by the synthetic
  `_exepad_diagnostic_` principal (typically empty).
- `query_db_tool(sql)` — read-only SQL on the preview D1 (SELECT and
  PRAGMA only, 100-row cap). Use when you need to confirm what's
  actually in the table — e.g. before claiming "handler returns []
  because of a date filter", run `SELECT COUNT(*) FROM reservations
  WHERE check_in > '2026-01-01'` and cite the count.
- `sample_table_tool(name, limit=10)` — convenience wrapper for
  `SELECT * FROM <name> LIMIT N`. Quick "is the seed data there at all"
  check.
- `read_browser_state_tool(path, selector)` — snapshots DOM text +
  computed styles + attributes for one CSS selector, plus any
  `page_errors` and `failed_requests` captured during page load.
  **Browser-side first** for visual / DOM-state symptoms ("chart shows
  wrong colors", "button doesn't appear", "page is blank").
- `screenshot_preview_tool(path)` — captures a PNG, uploads to GCS,
  returns a 1-hour signed URL. Bytes never enter the LLM context — you
  can't "see" the image, but the URL is in the record for human
  post-hoc debugging.

When to call which:

- **Visual / DOM symptom** ("colors wrong", "layout broken", "blank
  page"): start with `read_browser_state_tool` on the suspect selector.
  Add `screenshot_preview_tool` only if the human reviewer will need
  the visual.
- **Handler returns wrong/empty data**: `query_db_tool` to inspect what's
  actually in D1, then `execute_handler_tool` to see what the handler
  returns when called with realistic params. The diff between the two
  is your evidence.
- **5xx in production logs**: `execute_handler_tool` to reproduce. Pair
  with `code_revision_diff_tool` on the same handler — the diff
  explains why the runtime call now fails.

Resolution-shape mapping for Class B evidence:

- `screenshot_preview_tool` + visual mismatch → `restyle_referent`
- `execute_handler_tool` returns 5xx → `add_field_to_handler` or
  `both_sides_paired` depending on what the diff shows
- `query_db_tool` confirms empty seed data → `none` (data state, not
  bug — the Editor should ask the user, not generate a fix)

Tool budget for Class B is ~4 calls. If you blow past that without
forming a root_cause finding, set `confidence: medium` and list the
blocker; don't keep probing.

### Frontend rendering — chart container present but empty

If the data prop is non-empty but no shapes render, suspect:

- `dataKey` references a field whose value is `null` / `undefined` for
  every row. (Field-mismatch sweep won't catch this — the field exists
  but has no usable values.)
- Numeric axis with all-zero values renders a flat line at the baseline,
  which can look "empty" to the user.

These are runtime-dependent — flag as `contributing` in Phase 1.

### Wrong handler being called

Check `inspect_app_state_tool('handlers')` and `find_symbol_references_tool`
for the suspect handler name — the consumer might be calling a stale
or duplicate handler.

## Step 5 — Set the resolution shape

| Finding pattern | `suggested_resolution_shape` |
|---|---|
| Producer + consumer disagree on field name | `both_sides_paired` |
| Producer needs to add a field consumers reference | `add_field_to_handler` |
| Consumer reads a misnamed field; producer is correct | `rename_field_in_consumer` |
| Field is in producer but no consumer uses it | `remove_dead_field` |
| Could not determine; need runtime probes (Phase 2) | `unknown` |

When `suggested_resolution_shape: both_sides_paired`, write the
`suggested_resolution_prose` so the Editor knows BOTH sides need updating
in this turn. Reference the specific producer field and the specific
consumer site so the Editor's plan is unambiguous.

## Step 6 — Build the report

For the `tfluo79j` rate/percentage example:

```json
{
  "profile": "bug-root-cause",
  "symptom": "Occupancy Rate Trend (30 Days) chart renders no data points; the chart's data prop is populated but no <Charts.Area> path elements draw.",
  "reproduction": "Static analysis only: field-name contract is broken between handler and component. Phase 2 runtime probe will confirm by calling getOccupancyTrend and inspecting the response.",
  "findings": [
    {
      "statement": "Chart `<Charts.Area dataKey=\"rate\">` reads field 'rate', but handler `getOccupancyTrend` returns 'percentage'.",
      "severity": "root_cause",
      "evidence": [
        {
          "tool": "field_mismatch_report_tool",
          "args": {"components": ["DashboardContent"]},
          "excerpt": "Mismatch: producer=getOccupancyTrend consumer=DashboardContent.tsx field=rate kind=missing_in_producer detail='Consumer reads rate from handler getOccupancyTrend, but the handler only returns [date, percentage].'",
          "location": "DashboardContent.tsx:137"
        },
        {
          "tool": "prior_turn_diff_tool",
          "args": {},
          "excerpt": "Prior turn: modify_handler(getOccupancyTrend): rename output field rate -> percentage. No frontend_build action paired.",
          "location": "session_state:edit_plan"
        }
      ],
      "affected_entities": ["DashboardContent", "getOccupancyTrend"]
    }
  ],
  "suggested_resolution_shape": "both_sides_paired",
  "suggested_resolution_prose": "Either restore the handler's output field to 'rate' (revert the prior rename and pair no frontend change), OR keep the handler's 'percentage' field and update DashboardContent.tsx so <Charts.Area dataKey> reads 'percentage' instead of 'rate'. The latter is cleaner if 'percentage' more accurately describes the value's domain.",
  "confidence": "high",
  "blockers": []
}
```

## Tool budget — ~15 calls (10 Class A/C + 1 code_revision_diff + ~4 Class B)

A tight bug-root-cause investigation typically lands in 4-6 Class A/C
calls:

1. `prior_turn_diff_tool()` (free signal, always run)
2. `prior_turn_diagnosis_tool()` (free signal, always run)
3. `inspect_app_state_tool('handlers')` (orient)
4. `field_mismatch_report_tool()` (the big one)
5. (When regression-shaped) `code_revision_diff_tool(kind, name)` on the suspect file
6. (Optional) `describe_artifact_tool` on suspect components for the affected_entities list
7. (Optional) `load_artifacts_tool` if you need an excerpt from raw source

When Class B runtime probes are enabled, add up to ~4 more for live
deployment evidence (Step 4.5). If you've spent 15 calls total without
forming a root_cause finding, set `confidence: low` and list the
blockers. Don't burn budget on speculative spelunking.

## Anti-patterns

- ❌ "I think the chart is reading the wrong field." → Use
  `field_mismatch_report_tool` and cite its output. Never speculate.
- ❌ "Based on my reading of the source..." → Cite a specific tool call's
  excerpt. The schema requires it.
- ❌ Calling `load_artifacts_tool` on every component in the file. Use
  `describe_artifact_tool` first; only load full source when needed.
- ❌ Returning `confidence: high` with no `root_cause` finding. The schema
  rejects it. Use `medium` or `low`.
- ❌ Ignoring `prior_turn_diff_tool` because "this is a fresh request".
  The user being back IS the prior turn signal.
