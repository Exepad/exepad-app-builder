# Workflows

Workflows are deterministic async generators that coordinate agents, services, validation, and artifact assembly.

---

## Operation Modes

| Mode | Entry Point | Description |
|------|-------------|-------------|
| `create` (no bundle) | `CreationWorkflow` | Build a new webapp from scratch |
| `create` (with `design_bundle_id`) | `DesignImportWorkflow` → `EditingWorkflow` (compliance pass) | Import a Stitch / Claude Design bundle and ground it into a buildable app |
| `edit` | `EditingWorkflow` via `AppHelpDesk` | Modify an existing app |
| `help_desk` | Routed response | Return guidance without changing the app |

## Creation Workflow

**File:** `main_agent/agents/orchestrator/app_types/webapp/workflows/creation_workflow.py`

`CreationWorkflow` is now purely "create from prompt." Design-bundle handling lives entirely in `DesignImportWorkflow` (no delegation back to CreationWorkflow). The legacy `_plan_already_set` skip is gone.

High-level flow:

```text
1. Prepare content context
   - documents
   - large-document summaries
   - images
   - @filename references

2. PreCreator + Creator
   - PreCreator: classify app type, resolve app language
   - Creator: app plan, component plans, design system, logic / backend
     / security plan

3. Pre-build phase
   - DesignSystemBuilder
   - LogicBuilder
   - BackendBuilder.build_create → BackendModelBuilder +
     BackendHandlerBuilder + SeedDataBuilder run in parallel
     (models + handlers + seeds), all before component generation
   - may run via parallel_pre_build.py when enabled

4. Component generation
   - ComponentBuilder creates TSX component artifacts (single-file).
   - The agent has a SkillToolset attached and calls `load_skill` on
     the relevant flow + domain skill at inference time.
   - Validation context is injected before each build.

5. (intentionally vacant — was upfront SkillSelector LLM call; replaced
   by the inference-time `load_skill` step inside ComponentBuilder)

6. Validation + assembly
   - Validation pipeline runs (final Tailwind compile gate covers entry
     components AND Babel-shell supporting modules)
   - AssemblyService builds final app_config
   - CrossValidator and PostProcessingService finalize output
   - GcsOutputService computes per-entry bundle_hash + bumps source path
     when supporting modules change → backend re-bundles on next deploy

7. Result response + backend notification
```

Main outputs:

- theme artifacts
- TSX component artifacts
- `logic.json`
- `backend.json`
- handler TSX artifacts
- seed artifacts
- final `app_config`

## Design Import Workflow

**File:** `main_agent/agents/orchestrator/app_types/webapp/workflows/design_import_workflow.py`

Top-level workflow chosen by `PipelineOrchestrator` whenever `StateKeys.DESIGN_BUNDLE_ID` is present. Self-contained: imports the design, generates backend artifacts directly, assembles the initial config, and synthesizes a frontend-only compliance EditPlan that delegates to `EditingWorkflow`. **Does NOT touch `CreationWorkflow`.**

High-level flow:

```text
1. Phase 0 — Stage bundle ZIP entries → bundle:* artifacts
   (importers/dispatcher.dispatch_design_bundle).

2. Phase 1 — DesignImporter LLM returns a DecompositionPlan
   (slug mappings, chrome roles, M3 pillars, navigation, backend
   intent). NO HTML/CSS/JSX bodies in the response.

3. Phase 1.5 — Deterministic decomposition runner emits
   codefocus_style:theme.css, content:<slug>:page.html,
   content:main:{header,footer}.html, and (Babel-shell only)
   per-sibling module artifacts; materializes images into
   repo.assets.images; synthesizes a Creator-compatible plan.

4. Phase 2 — Grounding pass: reseeds placeholder-shaped app_name
   and generic content-component names from bundle_digest +
   page titles. Phase 3.1 data extraction promotes
   ``const X = [...]`` arrays into backend models + extracted seed
   rows.

5. Phase 2.3 — Reconcile app_secondary_type. dataapp only when
   navigation is SidebarMenuLeft AND a dynamic backend exists
   (LLM-emitted models OR Phase 3.1 extracted models); otherwise
   website.

6. _translate_mechanical_tsx — Walk every component_plan with
   source_jsx_modules; run transform_babel_shell_modules; save
   ``codefocus_component:<Name>.tsx`` and
   ``codefocus_module:<Name>.tsx`` artifacts. Merge translated
   bodies into ``_codefocus_sibling_modules`` so the downstream
   tsc gate resolves cross-sibling imports.

7. _run_backend_build — When ``app_backend_plan.backend_type ==
   "dynamic"``, call ``BackendBuilder.build_create()`` directly
   (the same call ``CreationWorkflow`` makes for its own backend).
   Runs BackendModelBuilder + BackendHandlerBuilder + SeedDataBuilder
   in parallel, materialising ``backend.json``, ``handler_code:*.tsx``,
   and ``seed:*.csv`` artifacts.

8. _build_initial_app_config — ``AssemblyService.assemble_app_config``
   produces ``StateKeys.APP_CONFIG`` from the staged artifacts.

9. _synthesize_frontend_compliance_edit_plan — Emit a frontend-only
   ``EditorOutput`` (one ``FrontendBuildAction`` per entry component)
   describing cleanup + data-wiring intent. Push to
   ``StateKeys.EDIT_PLAN`` AND set
   ``StateKeys.EDIT_PLAN_SOURCE = "design_import"``.

10. Delegate to EditingWorkflow.execute() — which sees the
    ``"design_import"`` source flag in ``_plan_edits`` and skips
    the Editor LLM. Phase 10 (frontend_build) dispatches
    COMPONENT_BUILDER_MULTIPLE_POLISH (sequential for a single
    entry, the parallel polish pool for multi-page; plain
    ComponentBuilderMultiple is the unwired fallback) — one LLM
    turn per entry, full cross-file visibility. Final batch
    validation + compile gate run as usual.
```

See [docs/latest/14-design-imports.md](../../../../docs/latest/14-design-imports.md) for the full design-import flow.

## Editing Workflow

**File:** `main_agent/agents/orchestrator/app_types/webapp/workflows/editing_workflow.py`

High-level flow:

```text
1. AppHelpDesk routing
   - help_desk
   - edit
   - direct actions when possible

2. Editor
   - emits structured edit actions
   - 10 action lists in EditorOutput:
     · modify_styles_actions
     · change_backend_models_actions
     · modify_logic_actions
     · add_handler_actions
     · modify_handler_actions
     · remove_handler_actions
     · rename_page_title_actions
     · frontend_build_actions  ← all cross-file frontend work
     · ingest_data_actions
     · edit_seed_data_actions

3. Phase execution (10 phases, fixed order)
   1) modify_styles       → DesignSystemBuilder
   2) change_backend_models → BackendModelBuilder via BackendBuilder
   3) edit_seed_data      → deterministic seed-row value edits (Phase 2.4, no schema change)
   4) ingest_data         → append / replace model rows from a DataIngester upload (Phase 2.5)
   5) modify_logic        → LogicBuilder
   6) add_handler         → BackendHandlerBuilder + backend.json patch
   7) modify_handler      → BackendHandlerBuilder (+ optional signature patch)
   8) remove_handler      → deterministic backend.json patch + artifact delete
                            (pre-flight check: paired FrontendBuildAction
                             must mention the handler name when callers exist)
   9) rename_page_title   → deterministic page entry mutation (slug renames
                            forbidden — they cascade through the agent)
  10) frontend_build      → ComponentBuilderMultiple (one LLM turn per
                            action; skills loaded via SkillToolset at
                            inference time) → side-effect application
                            (page registry + supporting-modules auto-register
                            via import-graph inference + orphan GC)

4. Validation + assembly
   - rebuild final app_config
   - post-process and cross-validate
   - styles-only edits with token-coverage warnings escalate via
     ComponentBuilder per-component rewrite (uses single-file builder
     because the components are independently in scope)

5. Result response
```

### FrontendBuildAction dispatch (Phase 10 detail)

For each action in `frontend_build_actions`:

1. **Snapshot.** Collect every staged frontend artifact body and stash under `_codefocus_sibling_modules` so tsc has full peer visibility on the agent's first save. Initialise `_files_created_this_turn` and `_files_deleted_this_turn` for post-agent bookkeeping.
2. **Worker invocation.** Build a `ComponentBuilderMultipleInput` with the action's `prompt` plus read-only context (`design_system_context`, `backend_surface`, `logic_surface`, `app_context`, `image_urls`, `app_language_code`). Invoke `ComponentBuilderMultiple` once. The agent has a `SkillToolset` attached: it calls `list_skills` → `load_skill('component-editing')` (and optionally a domain skill matching the action's prompt) before issuing any other tool call. Then it discovers files via its read tool surface (Glob, Grep, find_symbol_references, discover_dependencies, describe_artifact, inspect_app_state) and edits / saves / deletes per the prompt.
3. **Post-agent diff + side-effects.** Compare staged artifact bodies before / after to identify created / modified / deleted entries and modules. Apply `frontend_build_side_effects.apply_frontend_build_side_effects`:
   - `action.page_creates` → register pages, mount entry components
   - `action.page_slug_renames` → update page registry (agent already rewrote nav links)
   - `action.page_removes` → drop pages, garbage-collect orphan components
   - Created supporting modules → auto-registered under whichever entry imports them (walked from the import graph)
   - Deleted entries / modules → dropped from `repo.frontend.components`, page mounts, sibling `supporting_modules`
4. **Image resolution sweep** over each modified / added entry.
5. **Validation context refresh** so the next phase / action sees the updated registry.

## Help Desk Flow

If `AppHelpDesk` returns `branch_label="help_desk"`, no editing workflow runs. The orchestrator returns the response directly as streamed chat output.
