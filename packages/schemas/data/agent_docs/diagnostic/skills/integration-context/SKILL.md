---
name: integration-context
description: "Pattern discovery for feature-class intents. Use when the user asks to add something new — \"add a button\", \"wire up an export\", \"create a new section\". The Surveyor's job is not to fix anything but to surface the existing patterns the new feature should mirror, the available producers it can consume, and the conventions other components follow. Output is mostly context findings that ground the Editor's integration plan."
metadata:
  kind: diagnostic-profile
  applies_to: surveyor
  tool_budget: '3'
  intent_keywords: add create new wire_up build_a
---
# Integration Context Investigation

The user wants to add new code. **Your job is not to find a bug** — there
isn't one. Your job is to surface the existing patterns and resources the
new feature should plug into, so the Editor's plan composes cleanly with
what's already there.

Most findings will have `severity: context` or `contributing`, not
`root_cause`. There's no symptom to root-cause; instead, the Editor
needs ground truth about the surrounding code.

## Step 1 — Identify the integration target

Where is the new thing being added? Determine:

- The page or component the user means (often clear from
  `selected_component_name` in your input; otherwise from the user's
  language).
- Whether existing handlers / models cover the new feature's data needs
  or if new ones are required.
- Whether neighbor components already implement a similar pattern the
  new feature can mirror (e.g. "add an export button" — does another
  page already have one?).

Set `symptom` to a concrete restatement of the user's request:

> "Add a CSV export button to the Reservations page."

## Step 2 — Survey existing patterns

Use these tools, in order, to build the context:

1. `inspect_app_state_tool('all')` — orient yourself on what models,
   handlers, pages, and components exist.
2. `search_artifacts_tool(<keyword>)` — grep for similar features.
   Examples:
   - User asks "add export" → grep for `export` / `download` / `csv` to
     find prior export implementations.
   - User asks "add a date filter" → grep for `useState.*date` /
     `<Calendar` / `DatePicker`.
   - User asks "add a chart" → grep for `Charts.` to find the existing
     chart conventions.
3. `describe_artifact_tool(<neighbor>)` — get the exports/imports/hooks
   summary of one or two neighbor components that implement the most
   similar pattern.

You generally do NOT need `load_artifacts_tool` here — the structural
summary from `describe_artifact_tool` is enough for the Editor to write
the integration prompt.

## Step 3 — Identify reusable resources

Surface specific items the Editor should reference in its plan:

- **Existing handlers** that the new feature can reuse instead of adding
  a duplicate. Cite by handler name.
- **Existing components or modules** that should be imported rather than
  duplicated (e.g. an existing `<KpiCard>` component the new section
  should reuse).
- **Existing skills** the ComponentBuilder is wired to use (charts,
  CRUD, kanban, …) — they're listed in
  `packages/schemas/data/agent_docs/frontend/component_builder/skills/_registry.json`.
  The Editor's `FrontendBuildAction.prompt` benefits from a skill hint.
- **Naming conventions** used by neighbors (PascalCase component names,
  camelCase handler names, snake_case model columns). Don't restate the
  obvious cases — only surface non-default conventions.

## Step 4 — Identify gaps

If the new feature CAN'T be built without new handlers/models/columns,
list them as `severity: context` findings. The Editor will pair the
appropriate `AddHandlerAction` / `ChangeBackendModelsAction` with the
frontend build.

Example finding:

```json
{
  "statement": "No handler currently aggregates billing totals by month. The user's 'monthly revenue chart' request needs a new handler.",
  "severity": "context",
  "evidence": [
    {
      "tool": "inspect_app_state_tool",
      "args": {"kind": "handlers"},
      "excerpt": "Existing handlers: getDashboardMetrics, getOccupancyTrend, updateRoomStatus. None aggregate by time period.",
      "location": "session_state:app_config"
    }
  ],
  "affected_entities": ["BillingContent"]
}
```

## Step 5 — Set the resolution shape

For integration-context, the most common values:

- `add_neighbor_pattern` — new feature should mirror an existing pattern
  in another component. Name the neighbor in the prose.
- `add_field_to_handler` — an existing handler is close but lacks a
  needed field; the Editor should extend it.
- `none` — the user's request is already satisfied by existing code (rare;
  surface this honestly when it applies).

`unknown` is acceptable when the integration depends on user clarification
(e.g. "what columns should the export include?"); set `confidence: low`
and list the ambiguity in `blockers`.

## Tool budget — ~3 calls

This is a cheap profile by design. Typical flow:

1. `inspect_app_state_tool('all')` — orient (1 call)
2. `search_artifacts_tool('<feature keyword>')` or `find_symbol_references_tool` — find prior art (1 call)
3. `describe_artifact_tool(<best neighbor>)` — extract conventions (1 call)

If 3 calls aren't enough to ground the integration, set `confidence: low`
and explain. Do NOT spend `bug-root-cause`-tier budget on a feature add.

## Confidence

- `high` — neighbor pattern identified, all required producers exist, the
  Editor has unambiguous integration guidance.
- `medium` — pattern identified but new producers/columns are needed; the
  Editor will need to plan additional actions.
- `low` — request is genuinely ambiguous; user clarification will help
  more than further investigation. Surface the ambiguity in `blockers`.

## Anti-patterns

- ❌ Inventing root_cause findings. There's no bug to root-cause here.
- ❌ Running `field_mismatch_report_tool` on every component in the app.
  That tool is for `bug-root-cause`; on integration turns it's noise.
- ❌ Loading full source with `load_artifacts_tool` when the structural
  summary is enough.
- ❌ Surfacing every existing component as a "neighbor pattern". Cite the
  ONE most similar example, not five marginal ones.
