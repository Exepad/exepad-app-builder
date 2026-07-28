## DECISION TREE

> **Field-name reconciliation (read first).** The tree below uses legacy action
> names. The real `EditorOutput` has exactly these 10 lists: `modify_styles_actions`,
> `change_backend_models_actions`, `modify_logic_actions`, `add_handler_actions`,
> `modify_handler_actions`, `remove_handler_actions`, `rename_page_title_actions`,
> `frontend_build_actions`, `ingest_data_actions`, `edit_seed_data_actions`. Map as
> you read: `ModifyComponentAction` → a `FrontendBuildAction` in `frontend_build_actions`;
> `AddPageAction`/`RemovePageAction` → a `FrontendBuildAction` with
> `page_creates`/`page_removes`; `ModifyPageMetadataAction` → `frontend_build_actions`
> with `page_slug_renames` (slug change) or `rename_page_title_actions` (title only).
> **Never** put a component/page/text change into `ingest_data_actions` — that list
> is ONLY for appending rows from a tabular file uploaded THIS turn (see the
> "## Data Upload" section of your prompt; if it says nothing was uploaded, the
> list must stay empty). A change to a data VALUE (no schema change) goes in
> `edit_seed_data_actions`, NOT `change_backend_models_actions`.

```
Change text/layout/behavior of an existing component?
  -> ModifyComponentAction

Change/swap/replace an image (background, hero photo, avatar, illustration)?
  -> FrontendBuildAction whose prompt describes WHAT the new image should
     look like (subject, mood, composition).
     ComponentBuilder owns the JSX mechanics — do NOT write "remove the
     src" or "update keywords" in your prompt. Phrase as intent:
     "Replace the X with <description of the new image>".
     See `editor/docs/04_IMAGE_OPS.md` for prompt-phrasing examples.

Add a section to an existing page?
  -> ModifyComponentAction on that page's content component

Add a new page?
  -> ONE frontend_build_action: page_creates for the new page + a prompt
     covering the page content AND the Header nav link (nav is NOT a separate action)

Remove a page?
  -> ONE frontend_build_action: page_removes + a prompt telling the builder to
     remove the Header nav link (nav is NOT a separate action)

Rename a page / change its slug?
  -> Title only: rename_page_title_actions (deterministic).
     Slug change: ONE frontend_build_action with page_slug_renames + a prompt to
     update the Header nav-link href (slug cascade is NOT a separate action)

Change colors/fonts/spacing/global styles?
  -> ModifyStylesAction
     (If the new theme drops Material 3 tokens that existing components still
      reference, the workflow auto-escalates: ComponentBuilder rewrites those
      components against the new theme. You do NOT need to add explicit
      ModifyComponentAction entries for that case — see
      `frontend/component_builder/skills/theme-token-migration/SKILL.md`.)

Change a data VALUE in an existing model (edit/add/remove a specific row —
NO schema or column change: a price, a name, a sample record)?
  -> edit_seed_data_actions
     (NOT ChangeBackendModelsAction — that only alters SCHEMA. A value change
      routed there is a no-op: the schema is unchanged, so the value never
      updates and the turn is wasted.)

Add/change/remove a model or column?
  -> ChangeBackendModelsAction
  -> PLUS ModifyHandlerAction for each handler in model_to_handlers[model]
     (or RemoveHandlerAction if the model is being removed and the handler
      exists only to query that model)
  -> PLUS ModifyComponentAction for each component in handler_to_components[h]

Add a new handler?
  -> AddHandlerAction
  -> PLUS ModifyComponentAction for components that will use it

Change an existing handler's logic (body only, no signature change)?
  -> ModifyHandlerAction

Change an existing handler's signature?
  -> See ModifyHandlerAction SIGNATURE EDIT DECISION TREE above

Remove a handler?
  -> ModifyComponentAction for each caller to stop using it
  -> PLUS RemoveHandlerAction

Add/change shared state variables?
  -> ModifyLogicAction + ModifyComponentAction to wire the state
```

## TARGETING SUB-REGIONS WITHIN A COMPONENT

Each component in `repo.frontend.components` carries a `summary` that
begins with a one-sentence intent and may continue with a `Sections:`
block listing the file's sub-regions and their line ranges. Example:

```
Bloop World platformer with playable controls.

Sections:
- tweaks-panel.jsx (lines 1-540) — components: TweaksPanel, TweakSlider, ...; hook: useTweaks
- game.jsx (lines 541-1540) — components: Game, BloopWorldGame; functions: parseLevel, makeEnemy
```

When you emit a `FrontendBuildAction`, name these line ranges IN PROSE inside
your `prompt` so the downstream builder knows exactly which region to modify.
`FrontendBuildAction` has no `building_plan` field — all targeting is written
as sentences in `prompt`. Without the line ranges the builder must scan the
entire file (often 1000+ lines for Babel-shell imports).

GOOD (targeted, written in `prompt`):
- `"In the Donut chart (charts.jsx, lines 387-460): increase the segment gap from 2px to 6px."`
- `"In the Sidebar (shell.jsx, lines 24-69): replace the Home icon with a Dashboard icon."`

BAD (vague — forces builder to search):
- `"Make the donut thicker."`
- `"Update the sidebar."`

When the `summary` carries no `Sections:` block (small single-file
component), targeting by line range is unnecessary — the file is small
enough for the builder to handle without hints.

## TARGETING SUPPORTING MODULES (Babel-shell per-module)

Some entries carry a `supporting_modules: [...]` list in their slim
config — these are Babel-shell imports translated as separate TSX
modules that the deploy pipeline bundles into the entry. Example:

```json
"SchoolDashboardShell": {
  "summary": "School admin dashboard shell with sidebar + 11 pages.\n\nSections: ...",
  "supporting_modules": ["DataLib", "Icons", "Charts", "Shell",
                         "TweaksPanel", "OverviewPage", "StudentsPage",
                         "ClassesPage", "OtherPages"]
}
```

When the user's request scopes to a feature owned by ONE module — a
chart's spacing, a sidebar item, a data field, the tweaks panel's
options — NAME that module IN PROSE inside your `FrontendBuildAction.prompt`
so the builder can focus on it. `FrontendBuildAction` has no `module_name`
field; module scoping is just a sentence in the `prompt`.

GOOD (single-module scope — say which module in `prompt`):
- "Increase the donut segment gap — this lives in the Charts module."
- "Add a Reports link to the sidebar — the Shell module owns the nav."
- "Add three more sample students — they live in the DataLib module."

Cross-cutting work (name every module the change touches):
- "Wire the sidebar's Reports click to a new ReportsPage — touches the
  Shell module AND the entry's page routing."
- "Change the page header text — an entry-level concern."

When you scope to a single module, write the `prompt` AS IF the builder
sees only that module's source. Don't say "find the TweaksPanel inside the
dashboard"; say "in the TweaksPanel module, increase the section gap on
TweakSection from 8px to 12px".
