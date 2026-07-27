# Code Focus Agentic Workflow

Code Focus is an alternative app-generation mode that produces **TSX code components** instead of JSON component configs. Components are compiled to ES modules and rendered at runtime in Light DOM with Tailwind CSS scoped via `@layer exepad-app`. The workflow orchestrates multiple specialized LLM agents through Google's ADK (Agent Development Kit) to plan, build, validate, and assemble a complete web application from a single user prompt.

## Directory Structure

```
webapp/
├── subagents/           # LLM agent definitions and artifact tools
├── workflows/           # Creation and editing orchestration
├── services/            # Assembly, image resolution, post-processing, design context
└── prompts/             # (reserved for prompt templates)
```

## Agent Architecture

Seven specialized agents collaborate through a pipeline, each with a narrow responsibility:

| Agent | Role | Output |
|-------|------|--------|
| **Creator** | Plans the entire app: pages, components, navigation, design tokens, backend/logic/security needs | `CodeFocusCreatorOutput` (structured plan) |
| **Design System Builder** | Generates the visual foundation from creator's color/font tokens | `theme.css` artifact |
| **Component Builder** | Generates individual TSX components from the plan | `codefocus_component:{Name}.tsx` artifacts |
| **Logic Builder** | Generates frontend shared state | `logic.json` artifact |
| **Backend Props Builder** | Generates data models, handlers, and CRUD config | `backend.json` artifact |
| **Seed Data Builder** | Generates sample CSV datasets for backend models | `seed:{name}.csv` artifacts |

Shared agents (Logic, Backend Props, Seed Data) live in `app_types/shared/builders/` and are re-exported here for backward compatibility. There is no LLM-based code-repair agent — validation runs inline at save with deterministic auto-fixers; warnings ship with the artifact, errors abort the component.

Skills (build-flow + domain) are loaded by ComponentBuilder /
ComponentBuilderMultiple at inference time via an attached
`google.adk.tools.skill_toolset.SkillToolset` — there is no upfront
LLM-driven selection step. See
[apps/agent/docs/latest/skills.md](../../../../../docs/latest/skills.md)
for the authoring guide.

## Creation Workflow

`CreationWorkflow.execute()` orchestrates the following stages:

```
User Prompt
    │
    ▼
┌─────────────────────────────────────────────────┐
│  1. PLANNING                                    │
│     Creator agent → structured plan             │
│     (pages, components, design, backend needs)  │
│     Retries up to 3x on malformed output        │
└─────────────────┬───────────────────────────────┘
                  │
    ▼─────────────┼──────────────────────┐
    │ PARALLEL PRE-BUILD (if flag on)    │
    │ ┌──────────┐ ┌─────────┐ ┌──────┐ │
    │ │2. DESIGN │ │3a.LOGIC │ │3b.   │ │
    │ │  SYSTEM  │ │(opt.)   │ │BACK- │ │
    │ │theme.css │ │logic.   │ │END   │ │
    │ │          │ │json     │ │(opt.)│ │
    │ └──────────┘ └─────────┘ └──────┘ │
    │  via TimeoutParallelAgent (300s)   │
    └─────────────┬──────────────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│  4. COMPONENT GENERATION (sequential)           │
│     For each component plan → Component Builder │
│     (header/sidebar → footer → page content)    │
│     Passes: design context, image URLs,         │
│             app context, skill context,          │
│             content artifacts                    │
└─────────────────┬───────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│  5. FINAL COMPILE GATE                          │
│     Single deterministic Tailwind v4 compile    │
│     against final theme + all components (~1s)  │
│     No LLM, no retries.                          │
│     Duplicate content SHA detection             │
└─────────────────┬───────────────────────────────┘
                  ▼
    ┌─────────────┼──────────────────────┐
    │ PARALLEL POST-BUILD (if flag on)   │
    │                                    │
    │ Phase 1 (concurrent):              │
    │ ┌──────────────┐ ┌──────────────┐  │
    │ │ 6. IMAGE     │ │ 7. BACKEND   │  │
    │ │ RESOLUTION   │ │ HANDLER      │  │
    │ │ (Pexels /    │ │ BUILDER      │  │
    │ │  Pixabay)    │ │ (opt.)       │  │
    │ └──────────────┘ └──────────────┘  │
    │                                    │
    │ Phase 2 (sequential):              │
    │ ┌──────────────────────────────┐   │
    │ │ 8. SEED DATA (optional)      │   │
    │ │    seed:{name}.csv           │   │
    │ └──────────────────────────────┘   │
    └─────────────┬──────────────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│  9. ASSEMBLY                                    │
│     CodeFocusAssemblyService → app_config.json  │
│     Wires: repo, pages, nav, backend, logic,    │
│     security, fonts, seed routing               │
└─────────────────┬───────────────────────────────┘
                  ▼
┌─────────────────────────────────────────────────┐
│ 10. POST-PROCESSING & SAVE                      │
│     UUID fix, timestamp, cross-validation       │
│     Push APP_CONFIG to session → SSE to client  │
└─────────────────────────────────────────────────┘
```

> **Note:** Backend **model + handler + seed** artifacts are now built together
> in the **pre-build** phase via `BackendBuilder.build_create`, BEFORE component
> generation (see the CreationWorkflow docstring and `docs/latest/05_workflows.md`).
> The post-build phase in the diagram above now covers **image resolution** only;
> the "Backend Handler Builder" / "Seed Data" post-build boxes reflect the older
> flow and are pending a diagram refresh.

### Stage Details

**1. Planning** — The Creator agent receives the user prompt, image catalog summary, and any document artifacts. It outputs a `CodeFocusCreatorOutput` containing: component plans (name, role, page slug, building instructions, image references), design system tokens (hex colors, fonts, design style), navigation type, `app_secondary_type` (website vs dataapp), and optional logic/backend/security/data plans. Up to `MAX_REPAIR_ATTEMPTS=3` retries on malformed output.

**2-3. Parallel Pre-Build** — When `PARALLEL_PRE_BUILD=true` (default) and logic or backend agents are present, the Design System Builder, Logic Builder, and Backend Props Builder run concurrently via `TimeoutParallelAgent` (`parallel_pre_build.py`). Each agent is cloned with a dedicated session-state input key to avoid prompt conflicts. If only the Design System Builder is needed, it runs sequentially. A `TimeoutError` from the parallel agent is caught and re-raised as `PipelineError`.

The Design System Builder first computes an M3 material palette (`compute_m3_palette`) from the creator's hex colors to ensure WCAG contrast, then generates `theme.css`. The Logic Builder produces `logic.json`. The Backend Props Builder produces `backend.json`.

**4. Component Generation** — Each component plan is dispatched sequentially to the Component Builder with: the building plan, design system context JSON, resolved image URLs, app context (page list, navigation links), language code, and optional content artifact references. The builder has an ADK `SkillToolset` attached and calls `list_skills` → `load_skill('scratch-creation')` (and optionally a domain skill matched against the component's plan + role) before any other tool call; skill bodies live as SKILL.md directories under `packages/schemas/data/agent_docs/frontend/component_builder/skills/`. The builder generates TSX and saves it via `validate_and_save_tsx_component_artifact` which runs inline syntax + semantic validation, giving the LLM immediate feedback for self-correction.

**6. Final Compile Gate** — A single deterministic Tailwind v4 compile runs against the final theme + every saved component. ~1 s, no LLM. Duplicate content is detected via SHA hashing and regenerated. See [Validation Pipeline](#validation-pipeline) below.

**Post-Build (image resolution)** — Backend handlers and seed data are no longer built here; they are produced pre-build inside `BackendBuilder.build_create` (see the note above). Post-build now runs image resolution against the generated components.

**6. Image Resolution** — `resolve_placeholder_images` scans all TSX for `<img>` tags with `__PLACEHOLDER__` src, empty src, `data:` URIs, or hallucinated domains. Phase 1 matches `alt` text to the image catalog (token overlap >= 2). Phase 2 fetches stock images concurrently (max 5 parallel) from the free providers (Pexels / Pixabay / Unsplash, keyless Openverse last) using alt text as search keywords.

**Backend Handler Builder** — Generates `handler_code:{name}.tsx` for backend handlers defined in `backend.json`. Runs in the **pre-build** phase as part of `BackendBuilder.build_create` (models + handlers + seeds in parallel), not post-build.

**10. Assembly** — `CodeFocusAssemblyService.assemble_app_config` builds the final `WebAppProps`-shaped dict: `repo.frontend.components` (component registry with TSX source references), `repo.frontend.styles` and `repo.frontend.fonts`, page routing with component assignments, header/sidebar/footer wiring, and optional `repo.backend.handlers`, `frontend.logic`, and `backend` model configs. Seed data routing is injected by shared finalization utilities.

## Editing Workflow

`EditingWorkflow.execute()` handles modifications to existing apps:

```
User Edit Request + Current app_config
    │
    ▼
┌─────────────────────────────────────────────┐
│  1. EDITOR AGENT                            │
│     Analyzes request → typed action groups  │
│     on EditorOutput (styles, backend models,│
│      logic, handlers, page title, frontend  │
│      build, data ingest, seed data)         │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  2. PER-PHASE EXECUTION (fixed order)       │
│     modify_styles → change_backend_models → │
│     edit_seed_data → ingest_data →          │
│     modify_logic → add/modify/remove_handler│
│     → rename_page_title → frontend_build     │
│     All cross-file frontend work (component/ │
│     module/page add·modify·remove, slug      │
│     renames) routes through                  │
│     frontend_build → ComponentBuilderMultiple│
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  3. FINAL COMPILE GATE (if comps touched)   │
│     run_final_compile_gate against the      │
│     edited theme + all components (~1s)     │
└──────────────────┬──────────────────────────┘
                   ▼
┌─────────────────────────────────────────────┐
│  4. ASSEMBLY UPDATE & SAVE                  │
│     update_app_config_for_edit →            │
│     add/remove pages, merge backend/logic   │
│     Post-process → save → SSE response      │
└─────────────────────────────────────────────┘
```

### Edit Action Groups (`EditorOutput`)

| Action group | What It Does |
|--------------|-------------|
| `modify_styles_actions` | Theme / design-system changes (rewrites `theme.css`) |
| `change_backend_models_actions` | Add / alter / remove D1 models (schema changes) |
| `modify_logic_actions` | Frontend state (`logic.json`) changes |
| `add_handler_actions` | New backend handlers |
| `modify_handler_actions` | Edit existing backend handlers |
| `remove_handler_actions` | Delete backend handlers |
| `rename_page_title_actions` | Title-only page rename (deterministic) |
| `frontend_build_actions` | All cross-file frontend work → ComponentBuilderMultiple |
| `ingest_data_actions` | Append / replace into an existing model from a DataIngester upload |
| `edit_seed_data_actions` | Change VALUES in an existing model's seed rows (no schema change) |

All frontend component/page/module work (add, modify, remove, slug rename) flows through `FrontendBuildAction` → ComponentBuilderMultiple, which discovers affected files and edits them in a single turn.

A special `quick_remove` sub-action path handles page/component removal without invoking the Editor LLM.

## Validation Pipeline

Validation is **inline at component save** plus **a single final compile gate** at workflow end. There is no LLM "Fixer" agent and no batch re-validation pass.

### Inline (per component, in `validate_and_save_tsx_component_artifact`)

#### Stage 1 — Syntax (esbuild)

Validates TSX via the esbuild parser. On failure, the LLM receives the syntax error inline so it can self-correct on the next save attempt. The save tool caps attempts at `_MAX_SEMANTIC_RETRIES = 1` — if the second save still fails, the component ships as a stub.

#### Stage 1.5 — TypeScript (`tsc --noEmit`)

Generates a per-app `app.d.ts` from the backend/logic/pages manifest (model/handler/state names, route slugs) and runs `tsc --noEmit` against the component + SDK declarations. Catches `useModel('unknown')`, `Icons.Foo`, `setState('unknownKey', …)`, and similar cross-reference typos at compile time. **Fails open** when `tsc` is not on PATH (local dev without Node).

#### Stage 2 — Semantic (AST rules + auto-fix)

Two-phase:
- **Auto-fix** (`apply_auto_fixes`): deterministic rewrites — fixes import paths, removes forbidden APIs, normalizes export names, M3 token pairing, null-safety injection, etc.
- **Semantic checks** (`run_semantic_checks` + `run_rules`): validates SDK imports, forbidden APIs, backend refs, JSX shape, hooks-of-rules, useApp selector contract. Errors block the save; warnings ship with the artifact.

#### Stage 4 — Style Coverage

Three sub-stages:
- **4** — `validate_style_coverage`: every custom Tailwind class must have a matching `--color-*` / `--font-*` token in the `@theme` block. ComponentBuilder owns the primary fix path via the `add_theme_tokens` tool, which splices new declarations into `theme.css` before saving.
- **4a** — `auto_fix_missing_m3_colors`: deterministic safety net that derives M3 sibling tokens (e.g., `tertiary-fixed` from `tertiary`).
- **4c** — `validate_contrast_pairs` + `auto_fix_contrast_pairs`: WCAG contrast on text/background combos.

### End-of-workflow

#### Final Compile Gate (`final_compile_gate.run_final_compile_gate`)

Single deterministic Tailwind v4 compile against the final theme + every saved component, ~1 s, no LLM. If the initial compile fails, deterministic recovery passes run (lift nested `@import`/`@source`/`@utility`, strip unknown `@apply` classes, fix bare-comma syntax) and the compile retries. A fatal compile error blocks deploy of CSS but not the workflow.

### Severity contract

- **`error`** — blocks save. Reserved for syntax (esbuild + tsc), forbidden security APIs, SQL injection, hooks-of-rules, missing SDK imports, conditional hooks, useApp inline-object selector, design-import parity, all CSS rules, handler structural rules.
- **`warning`** — ships with the artifact. Surfaced in SSE `backend_response.validation_warnings`. Runtime degrades the visible issue (`useModel('unknown')` returns empty data, `Icons.Foo` renders nothing, `ComponentErrorBoundary` catches `ReferenceError`); the user iterates via the editor flow.

## Rendering Modes

All components use `react_jsx` rendering mode — Light DOM with `LightDOMContainer`, Tailwind CSS scoped via `@layer exepad-app`, and Lucide icons (`Icons.*` from SDK).

## Artifact Naming Conventions

| Prefix | Example | Content |
|--------|---------|---------|
| `codefocus_component:` | `codefocus_component:HomeContent.tsx` | TSX component source |
| `codefocus_style:` | `codefocus_style:theme.css` | Theme CSS with custom properties |
| `logic.json` | — | Frontend shared state |
| `backend.json` | — | Data models, handlers, CRUD config |
| `handler_code:` | `handler_code:processOrder.tsx` | Custom backend handler TSX |
| `seed:` | `seed:products.csv` | Sample data CSV |
| `content:` | `content:home:hero.md` | Markdown content for components |

## Key Data Models

### `CodeFocusCreatorOutput`

The planner's structured output that drives all downstream agents:

```
├── component_plans: list[CodeFocusComponentPlan]
│   ├── name (PascalCase)
│   ├── role ("header" | "sidebar" | "footer" | "content")
│   ├── page_slug, page_title (for content components)
│   ├── building_plan: list[str]  (actionable build instructions)
│   ├── interactive_elements: list[str]
│   ├── image_references: list[str]  (UUIDs from image catalog)
│   ├── content_artifact: str  (optional markdown source)
│   └── complexity_level: "basic" | "intermediate" | "complex"
├── design_system: CodeFocusDesignSystemPlan
│   ├── primary_color, secondary_color, surface_color, error_color
│   ├── headline_font, body_font
│   └── design_style
├── navigation_type ("HeaderMenuTop" | "SidebarMenuLeft")
├── app_secondary_type ("website" | "dataapp")
├── app_logic_plan: LogicPlan (state only — actions/computed removed)
├── app_backend_plan: BackendPlan (models, handlers)
├── app_security_plan: SecurityPlan
├── app_data_plan: DataPlan (datasets)
└── language_codes: list[str]
```

### `ComponentEntry`

Used by the Assembly Service to track built components:

```python
@dataclass
class ComponentEntry:
    name: str         # PascalCase component name
    role: str         # "header", "sidebar", "footer", "content"
    page_slug: str    # e.g. "/", "/about"
    page_title: str   # e.g. "Home", "About Us"
    summary: str      # short description
```

### `AssemblyContext`

Input to the final config assembly:

```python
@dataclass
class AssemblyContext:
    app_name: str
    app_alias: str
    app_secondary_type: str   # "website" or "dataapp"
    navigation_type: str      # "HeaderMenuTop" or "SidebarMenuLeft"
    font_urls: list
    components: list[ComponentEntry]
    backend_config: dict      # parsed backend.json (optional)
    logic_config: dict        # parsed logic.json (optional)
    design_system: dict       # color/font tokens for theme
```

## Image Handling

Images flow through three stages:

1. **Planning** — Creator assigns image UUIDs from the `image_catalog` to component plans via `image_references`.
2. **Building** — Workflow resolves UUIDs to URLs and passes them as `image_urls` JSON to the Component Builder. The builder uses real URLs where available and `__PLACEHOLDER__` with descriptive `alt` text for unresolved images.
3. **Post-build resolution** — `resolve_placeholder_images` scans TSX for images needing resolution (placeholder, empty, data URI, hallucinated domain), matches against the catalog by alt-text token overlap, then fetches stock images concurrently from the free provider APIs (Pexels / Pixabay / Unsplash, keyless Openverse last) for remaining unresolved slots.

## Inline vs End-of-Workflow Validation

Validation happens at two levels:

- **Inline (per-save):** When the Component Builder calls `validate_and_save_tsx_component_artifact`, esbuild syntax + tsc type check + semantic checks (AST rules + auto-fix + style coverage) run immediately. Errors return to the LLM for self-correction; warnings ship with the artifact. The save tool caps attempts at one retry — there is no LLM-driven repair loop.
- **End-of-workflow:** A single deterministic Tailwind v4 compile runs against the final theme + all components (`run_final_compile_gate`). ~1 s, no LLM. Failed compiles emit fatal errors that block CSS deploy without aborting the workflow.

## Dependencies

### External Binaries

- **esbuild** — TSX/JS syntax validation (must be on PATH in Docker)
- **tailwindcss** — CSS compilation for Stage 3 validation (graceful skip if missing)

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `PEXELS_API_KEY` | Stock image search for placeholder resolution |
| `PIXABAY_API_KEY` | Additional free stock image source |
| `*_MODEL` env overrides | Per-agent LLM model selection (see `config.py`) |

### Shared Dependencies

| Module | Purpose |
|--------|---------|
| `app_types/shared/builders/` | Logic, Backend Props, Seed Data builders |
| `app_types/shared/services/config_finalization` | `fix_uuids`, `inject_seed_routing`, `run_cross_validation` |
| `app_types/shared/builders/code_generator` | Backend handler TSX generation |
| `app_types/shared/services/document_artifact_service` | Content document preparation |
| `app_types/shared/services/validation_service` | Validation pipeline wrapper |
| `main_agent/services/validation/` | 4-stage validation pipeline implementation |

## Session State Keys

Key entries managed during the workflow (defined in `main_agent/constants.py:StateKeys`):

| Key | Purpose |
|-----|---------|
| `codefocus_plan` | Creator output (structured plan) |
| `codefocus_edit_plan` | Editor output (edit actions) |
| `APP_CONFIG` | Final assembled app config |
| `image_catalog` | User-uploaded image registry |
| `_validation_context_models` | Backend model names for semantic checks |
| `_validation_context_logic` | Logic config for semantic cross-referencing |
| `_validation_context_page_slugs` | Valid page slugs for navigation validation |
| `_adk_activated_skill_<agent_name>` | ADK `SkillToolset` bookkeeping — skills the agent has loaded so far in this session. Auto-populated by `load_skill`. |
| `_pre_build_ds_input` | Parallel pre-build: Design System Builder input JSON |
| `_pre_build_logic_input` | Parallel pre-build: Logic Builder input JSON |
| `_pre_build_backend_input` | Parallel pre-build: Backend Props Builder input JSON |
| `validation_result` | Pipeline output (fixed sources, warnings) |
| `validation_failures` | Components that failed all repair attempts |
| `tsx_component_validation_log` | Per-component validation history (last 50 entries) |
