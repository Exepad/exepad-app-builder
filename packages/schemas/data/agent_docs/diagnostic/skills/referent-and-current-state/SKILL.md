---
name: referent-and-current-state
description: "Resolve referents and capture current visual or stylistic state for cosmetic-class intents. Use when the user says \"this\", \"that\", \"make X prettier\", \"tighten the spacing\", \"change the color\" — anything where the request implicates a specific UI region without naming it. Output disambiguates the referent and surfaces the current state so the Editor's restyle plan touches the right element with the right delta."
metadata:
  kind: diagnostic-profile
  applies_to: surveyor
  tool_budget: '3'
  intent_keywords: this that make prettier color spacing tighter looser bigger smaller restyle
---
# Referent + Current State Investigation

The user's request implies a specific element but may not name it
(`"make this prettier"`, `"tighten the spacing"`, `"change the color"`).
Your job is to:

1. Disambiguate the referent — which component / element does the user mean?
2. Capture the current state — what styles/tokens does it currently use?
3. Tell the Editor what to change without prescribing the new style.

There is no bug to root-cause. Most findings are `severity: context`.

## Step 1 — Resolve the referent

Look at your input first:

- **`selected_component_name`** is non-empty → the user clicked something
  in the UI. THAT is the referent. Skip to step 2.
- **`current_page_uuid`** is set → the referent is somewhere on this
  page. Use `inspect_app_state_tool('pages')` to enumerate components on
  the page.
- **Neither set** → the referent is genuinely ambiguous. Set
  `suggested_resolution_shape: unknown`, list the ambiguity in
  `blockers`, return a single `severity: context` finding asking the
  Editor to pick (or relay back to user).

When multiple candidates remain, prefer the one most recently mentioned
in `chat_history`. If still ambiguous, don't guess — surface both as
`context` findings and let the Editor / user disambiguate.

## Step 2 — Capture the current state

Once the referent is resolved, use `describe_artifact_tool` (cheap) to
get the structural summary, then `load_artifacts_tool` ONLY if you need
the actual class names / inline styles.

What to capture in `Evidence`:

- The current Tailwind classes on the relevant JSX element
  (`bg-primary`, `text-on-primary`, `p-6`, `rounded-2xl`, …).
- Any inline `style={{ ... }}` overrides.
- Any custom theme tokens referenced (`bg-surface-container`,
  `text-on-surface-variant`).
- Whether the element already uses M3 tokens (theme-token-clean) or
  hardcoded hex/rgb values.

Cite specific class strings in your Evidence excerpts. The Editor uses
these as the baseline against which to express the requested change.

## Step 3 — Identify the current theme system

Check `inspect_app_state_tool('all')` for the theme contract — is the app
using M3 tokens, custom tokens, or hardcoded colors? This affects whether
the Editor should:

- Edit the component to use a different existing token (cheap), OR
- Add new tokens to `codefocus_style:theme.css` and then reference them.

Surface this as a `context` finding so the Editor knows whether the
request needs a paired `ModifyStylesAction`.

## Step 4 — Set resolution shape

For this profile:

- **`restyle_referent`** — the most common case. Clear referent, clear
  current state, change is purely cosmetic. The Editor's
  `FrontendBuildAction` will edit the component and possibly pair with
  `ModifyStylesAction` for theme additions.
- **`unknown`** — referent could not be disambiguated. `confidence: low`,
  list candidates in `blockers`.
- **`none`** — the requested change already matches the current state
  (e.g. user asks "make it red" and it's already red). Surface as a
  context finding so the Editor can clarify with the user.

## Step 5 — Build the report

Example for `"make the dashboard charts prettier"` with selected
component = `DashboardContent`:

```json
{
  "profile": "referent-and-current-state",
  "symptom": "User wants the chart visuals on DashboardContent to look 'prettier'. Specific delta is unspecified; current state is captured below.",
  "findings": [
    {
      "statement": "Referent resolved to DashboardContent (selected). The component renders one Charts.AreaChart (Occupancy Rate Trend) and uses M3 tokens consistently.",
      "severity": "context",
      "evidence": [
        {
          "tool": "describe_artifact_tool",
          "args": {"filename": "codefocus_component:DashboardContent.tsx"},
          "excerpt": "exports: ['DashboardContent', 'StatCard']; jsx_root_tag: LightDOMContainer; hooks_used: [useHandler, useModel]",
          "location": "DashboardContent.tsx"
        },
        {
          "tool": "search_artifacts_tool",
          "args": {"pattern": "Charts\\.", "name_glob": "codefocus_component:DashboardContent.tsx"},
          "excerpt": "Line 100: <Charts.ResponsiveContainer width=\"100%\" height=\"100%\">; Line 101: <Charts.AreaChart data={trend?.trendData ?? []} margin={...}>; Line 108: <Charts.CartesianGrid strokeDasharray=\"3 3\" stroke=\"var(--color-outline-variant)\" opacity={0.2}>",
          "location": "DashboardContent.tsx:100-108"
        }
      ],
      "affected_entities": ["DashboardContent"]
    },
    {
      "statement": "Theme already uses M3 token system (--color-secondary, --color-outline-variant). Theme additions, if any, should follow the same convention.",
      "severity": "context",
      "evidence": [
        {
          "tool": "inspect_app_state_tool",
          "args": {"kind": "all"},
          "excerpt": "theme.css uses html.dark + M3 tokens (primary, secondary, surface, outline-variant, ...)",
          "location": "session_state:app_config"
        }
      ],
      "affected_entities": ["theme"]
    }
  ],
  "suggested_resolution_shape": "restyle_referent",
  "suggested_resolution_prose": "User asked for 'prettier' without specifics. The chart already uses M3 tokens correctly. Editor should produce a FrontendBuildAction asking the agent to enhance visual polish (e.g. add subtle gradient fill, increase margin breathing room, soften the line stroke) while preserving M3 tokens. No new theme tokens needed unless the agent decides to introduce a chart-specific accent.",
  "confidence": "high",
  "blockers": []
}
```

## Tool budget — ~3 calls

Typical flow:

1. `describe_artifact_tool(<resolved component>)` — structural summary (1)
2. `search_artifacts_tool('<style-relevant pattern>', name_glob='<component>')` — capture current classes (1)
3. (Optional) `inspect_app_state_tool('all')` — confirm theme system (1)

Do not load full source unless the structural summary is missing the
class strings you need. Do not run `field_mismatch_report_tool` — it's
not relevant here.

## Confidence

- `high` — referent resolved, current state captured, the Editor has
  enough to plan the restyle.
- `medium` — referent resolved but the requested delta is ambiguous
  ("prettier" with no theme hint). The Editor will need to make taste
  decisions; flag this in `suggested_resolution_prose`.
- `low` — referent could not be disambiguated. The Editor should ask the
  user, not guess.

## Anti-patterns

- ❌ Loading full source for every component on the page when the user
  has a clear selected component.
- ❌ Prescribing a specific style change ("change to bg-primary"). That's
  the agent's job; you describe the current state and the user's intent,
  not the new style.
- ❌ Running `field_mismatch_report_tool`. Wrong tool for cosmetic edits.
- ❌ Ignoring `selected_component_name` and re-deriving the referent from
  scratch.
