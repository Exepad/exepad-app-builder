# Agent System

The live agent app is organized around one root orchestrator plus a focused set of planning, building, routing, and support agents.

---

## Root Agent

### PipelineOrchestrator

- **File:** `main_agent/agents/orchestrator/core.py`
- **Role:** Root workflow router for create, edit, design-import, and help-desk operations

It coordinates progress tracking, delegates to the correct workflow, and emits the event stream consumed by `/r`. When a request carries `design_bundle_id`, the orchestrator routes to `DesignImportWorkflow` instead of `CreationWorkflow`.

## Routing & Support

### AppHelpDesk

- **File:** `main_agent/agents/orchestrator/app_types/shared/subagents/app_help_desk.py`
- **Role:** Routes edit requests into `edit` or `help_desk`, and chooses direct sub-actions when possible

### ResultResponseWriter

- **File:** `main_agent/agents/orchestrator/app_types/shared/subagents/chat_response_writer.py`
- **Role:** Writes the final user-facing summary after a workflow completes

## Planning Agents

### DesignImporter

- **File:** `main_agent/agents/orchestrator/importers/design_importer.py`
- **Role:** Small constrained LLM that runs only on design-bundle uploads. Reads `bundle:manifest.md` + format-specific skill (`stitch-importer` / `claude-design-importer`) and returns a `DecompositionPlan` (slug mappings, chrome roles, four M3 theme pillars, navigation, backend intent). Never emits HTML/CSS/JSX bodies. Replaces PreCreator + Creator in the design-import flow.

### PreCreator

- **File:** `main_agent/agents/orchestrator/app_types/webapp/subagents/pre_creator.py`
- **Role:** Lightweight app-type and language classifier used before planning. Skipped when an upstream workflow has pre-populated `StateKeys.CREATOR_PLAN` (design-import path).

### Creator

- **File:** `main_agent/agents/orchestrator/app_types/webapp/subagents/creator.py`
- **Role:** Produces the creation plan: pages, navigation, design system, shared logic, backend plan, favicon, and component build plans. Skipped when `StateKeys.CREATOR_PLAN` is already populated upstream.

### Editor

- **File:** `main_agent/agents/orchestrator/app_types/webapp/subagents/editor.py`
- **Model:** `gemini-3-flash-preview` (defaults via `EDITOR_MODEL` — planner-side reasoning seat)
- **Role:** Produces structured edit actions for existing apps. The output schema has ten fields: `modify_styles_actions`, `change_backend_models_actions`, `modify_logic_actions`, `add_handler_actions`, `modify_handler_actions`, `remove_handler_actions`, `rename_page_title_actions`, `frontend_build_actions`, `ingest_data_actions`, and `edit_seed_data_actions`. All cross-file frontend work — component create / modify / remove with cascade, module CRUD, slug renames with nav-link cascade, page add / remove — flows through `FrontendBuildAction` to `ComponentBuilderMultiple`. Backend cascades are emitted as paired `FrontendBuildAction`s alongside the specialized backend action.
- **Intent vs mechanics:** Editor action prompts describe *intent* (WHAT to change); builders own the *mechanics* (HOW). No JSX, CSS, SQL, or SDK hook syntax appears in Editor prompts or examples. For example, an image swap is "Replace X with description"; `ComponentBuilderMultiple` is the one that deletes the `src` attribute and updates `keywords`.
- **ADK brace-injection caveat:** literal `{identifier}` tokens in an agent's static instruction crash ADK (it tries to template-substitute and there is no escape). Use backticks or concrete examples instead. This has bitten the `SkillSelector` and `ResultResponseWriter` prompts historically.

### Surveyor

- **File:** `main_agent/agents/orchestrator/app_types/webapp/subagents/surveyor.py`
- **Model:** `gemini-3-flash-preview` (defaults via `SURVEYOR_MODEL`)
- **Role:** Read-only diagnostic pre-pass for edit-class turns. Runs sequentially before the Editor on requests classified as `edit` by `AppHelpDesk`, produces a structured `DiagnosticReport` (symptom + evidence-bound findings + suggested resolution shape + confidence), and the Editor consumes it as input so plans are grounded in tool evidence rather than confabulated from names. Single-attempt execution (no retries); falls back to a low-confidence empty report on failure so the workflow never blocks.
- **Profile selection:** `AppHelpDesk` classifies the request into one of `bug-root-cause` / `cascade-enumeration` / `integration-context` / `referent-and-current-state` / `performance-audit` / `a11y-audit` / `none`. The selected profile drives which `SKILL.md` the Surveyor loads on demand via `SkillToolset`. `none` skips the Surveyor entirely.
- **Output schema:** `DiagnosticReport` (Pydantic, validated). `Evidence.tool` accepts arbitrary tool names (forward-compat for new tools). Persisted as `diagnostic_report:{turn_index}.json` artifact via the `persist_diagnostic_report` after-agent callback so the next turn's `prior_turn_diagnosis_tool` can read it.
- **Tool surface (Class A — always on):** 7 read-only ADK artifact tools (`list_artifacts_tool`, `search_artifacts_tool`, `describe_artifact_tool`, `find_symbol_references_tool`, `discover_dependencies_tool`, `inspect_app_state_tool`, `load_artifacts`) + 6 diagnostic tools (`infer_handler_return_shape_tool`, `infer_consumer_field_reads_tool`, `field_mismatch_report_tool`, `prior_turn_diff_tool`, `prior_turn_diagnosis_tool`, `code_revision_diff_tool`). The load-bearing tool for `bug-root-cause` is `field_mismatch_report_tool` — deterministic AST-based detection of frontend ↔ backend field-name mismatches. `code_revision_diff_tool` existed to diff versioned blobs in a cloud object store; self-host keeps no durable revision history, so it always returns `has_revisions: False` and the Surveyor treats that as "nothing to diff".
- **Tool surface (Class B — gated on `SURVEYOR_RUNTIME_PROBES_ENABLED`):** 5 live runtime probes that observe the deployed preview app at investigation time: `execute_handler_tool` (proxies a single handler call through the runtime to the in-process app-backend), `query_db_tool` (read-only SQL on the preview SQLite database, guarded by a SELECT/PRAGMA whitelist), `sample_table_tool` (convenience wrapper for `SELECT * FROM X LIMIT N`), `read_browser_state_tool` (DOM text/styles/attributes + page errors), and `screenshot_preview_tool`. The last two depend on the runtime's `/_diag/inspect` probe, which has **no self-host equivalent** and returns 503 `browser_unavailable`; `screenshot_preview_tool` additionally has nowhere to host a PNG, so it reports capture metadata with `screenshot_storage_unavailable` rather than an image. Bytes never enter the LLM context. All of it talks to the runtime's `/api/{appId}/_diag/*` endpoints via `main_agent/services/runtime_probe_client.py` (auth: `X-Diagnostic-Secret` header). Per-tool latency / error counts are appended to `runtime_probe_log` in session state and surfaced in the `RUNTIME PROBES SUMMARY` block of the workflow metrics.

## Build Agents

### DesignSystemBuilder

- **File:** `main_agent/agents/orchestrator/app_types/webapp/subagents/design_system_builder.py`
- **Role:** Generates the `theme.css` artifact (Tailwind v4 is CSS-first — no tailwind.config.js)

### ComponentBuilder

- **File:** `main_agent/agents/orchestrator/app_types/webapp/subagents/component_builder.py`
- **Role:** Single-file TSX component builder. Used by `CreationWorkflow` per-component build loop and by the styles-only escalation path in `EditingWorkflow`. Receives `ComponentBuilderInput` (one component / module per invocation), saves through the inline-validation pipeline (esbuild → tsc → AST rules → fixers → semantic → style coverage). Single-attempt save contract.
- **Cache stability invariant:** the `system_instruction` MUST stay byte-identical across components in a build so the prompt cache hits. Per-component data flows through the agent's structured input model (`ComponentBuilderInput` / `ComponentBuilderMultipleInput`) and the on-demand `load_skill` tool result — never via string interpolation into `system_instruction`. Cache misses turn one cheap build into N expensive uncached builds.

### ComponentBuilderMultiple

- **File:** `main_agent/agents/orchestrator/app_types/webapp/subagents/component_builder_multiple.py`
- **Model:** `gemini-3-flash-preview` (defaults via `COMPONENT_BUILDER_MULTIPLE_MODEL` — multi-file refactor reasoning)
- **Role:** Multi-file frontend coding agent dispatched from `EditingWorkflow._run_phase_frontend_build` (and indirectly from `DesignImportWorkflow` via synthesized `FrontendBuildAction`s). Receives a single natural-language `prompt` plus read-only context (no per-file targets), discovers files itself via a Claude-Code-style coding-agent tool surface, and edits cross-file cascades in one LLM turn. Resolves the cross-file failure class where two sibling files need to change together (e.g. `Card({label,children})` ↔ `<Card title=…/>`) — the per-file builder cannot satisfy both sides simultaneously.
- **Tool surface (12 tools):**
  - **Read:** `load_artifacts`, `list_artifacts_tool` (Glob), `search_artifacts_tool` (Grep), `describe_artifact_tool` (cheap AST summary), `discover_dependencies_tool` (import graph), `find_symbol_references_tool` (TSX-aware symbol lookup), `inspect_app_state_tool` (live workflow state)
  - **Write:** `validate_and_save_tsx_component_artifact_tool`, `validate_and_save_tsx_module_artifact_tool`, `edit_artifact_tool` (surgical replace, validated end-to-end), `add_theme_tokens_tool`
  - **Delete:** `delete_artifact_tool` (with importer pre-check; rejects orphaning callers)
- **Scope:** frontend artifacts only (`codefocus_component:*.tsx`, `codefocus_module:*.tsx`, `codefocus_style:theme.css`). Backend prefixes (`handler_code:*`, `backend.json`, seed data) are rejected at the tool layer — those are owned by their dedicated builders.
- **Cache stability:** shares the long static authoring prefix (`static_authoring_prefix()` in `component_builder.py`) byte-identically with `ComponentBuilder`. Per-agent suffix (`multi_file_suffix()`) appended after.

### Skills (no separate agent — loaded by ADK `SkillToolset`)

- **Catalogues:** `packages/schemas/data/agent_docs/{frontend/component_builder/skills,diagnostic/skills,design_bundle_importer}/<skill>/SKILL.md` (AgentSkills.io spec).
- **Loader:** `main_agent/agents/utils/skills.py` exposes `load_frontend_skills`, `load_diagnostic_skills`, `load_design_importer_skills`. Each returns a list of `google.adk.skills.Skill`.
- **Attachment:** ComponentBuilder, ComponentBuilderMultiple, Surveyor, and DesignImporter each carry a `SkillToolset` whose tools (`list_skills`, `load_skill`, `load_skill_resource`, `run_skill_script`) let the LLM pull the relevant SKILL.md body on demand. There is no upfront LLM-driven selection step anymore.
- **Authoring:** see [docs/latest/skills.md](skills.md).

### LogicBuilder

- **File:** `main_agent/agents/orchestrator/app_types/shared/builders/logic_builder.py`
- **Role:** Generates `logic.json` for shared frontend state

### BackendModelBuilder

- **File:** `main_agent/agents/orchestrator/app_types/shared/builders/backend_builders/backend_model_builder.py`
- **Role:** Generates backend model configuration written into `backend.json`

### BackendHandlerBuilder

- **File:** `main_agent/agents/orchestrator/app_types/shared/builders/backend_builders/backend_handler_builder.py`
- **Role:** Generates handler TSX artifacts for backend actions. Frontend cascades from handler add / modify / remove are handled via paired `FrontendBuildAction`s emitted by the Editor (the agent never touches `handler_code:*` artifacts).

### SeedDataBuilder

- **File:** `main_agent/agents/orchestrator/app_types/shared/builders/backend_builders/seed_data_builder.py`
- **Role:** Generates sample dataset artifacts when the backend plan asks for seed data

## Deterministic Helpers (no LLM)

Several passes act as pseudo-agents — invoked from the workflow with structured inputs/outputs — but contain zero LLM calls. They are listed here so the agent map is complete.

### Artifact Search Service

- **File:** `main_agent/services/artifact_search.py`
- **Role:** Glob (`list_artifacts_by_pattern`), Grep (`search_artifact_contents`), and Edit-splice (`apply_edit_to_artifact`) primitives backing the corresponding ComponentBuilderMultiple tools. Frontend-prefix-only.

### Dependency Graph Service

- **File:** `main_agent/services/dependency_graph.py`
- **Role:** AST-based import-graph resolution (`build_dependency_graph`), TSX-aware symbol-reference lookup (`find_symbol_references`), structural artifact summary (`describe_artifact`), and live workflow-state inspection (`inspect_app_state`). All ComponentBuilderMultiple code-intelligence tools delegate here.

### Decomposition Runner

- **File:** `main_agent/agents/orchestrator/importers/tools/decomposition/runner.py`
- **Role:** Phase 1.5. Reads staged `bundle:*` source bytes and emits `codefocus_style:theme.css`, `content:<slug>:page.html`, `content:main:{header,footer}.html`, and per-sibling Babel-shell module artifacts. Synthesizes a Creator-compatible `creator_plan` so the rest of the workflow runs unchanged.

### Grounding Pass

- **File:** `main_agent/agents/orchestrator/importers/grounding.py`
- **Role:** Phase 2. Reseeds placeholder-shaped `app_name` and generic content-component names (e.g. `PostFeed`, `FeaturedContent`) using `bundle_digest.brand_name` and the first page's title. Mutates the synthesized plan in place; returns metadata reporting what changed.

### Data Extractor

- **File:** `main_agent/agents/orchestrator/importers/tools/jsx_to_tsx/data_extractor.py`
- **Role:** Phase 3.1. Walks Babel-shell sibling JSX with tree-sitter for top-level `const NAME = [{...}]` arrays that have at least one `.map()` consumer. Infers a `ModelPlan`-compatible column schema, returns seed rows + wiring candidates so SeedDataBuilder writes a CSV. The wiring rewrites no longer run inline — they're folded into a `FrontendBuildAction` that `DesignImportWorkflow` dispatches via `ComponentBuilderMultiple` after assembly.

### JSX Module Transformer

- **File:** `main_agent/agents/orchestrator/importers/tools/jsx_to_tsx/module_transformer.py`
- **Role:** Per-module Babel-shell → TSX translator. Strips bootstrap+window globals, prefixes exports, injects ES imports across siblings, dedupes `const {useX}=React` destructures.

### FrontendBuildAction Side-Effects

- **File:** `main_agent/agents/orchestrator/app_types/webapp/workflows/frontend_build_side_effects.py`
- **Role:** Post-agent registry mutations after each `FrontendBuildAction` run — page registry add / remove / slug rename, supporting-modules auto-registration via import-graph inference, orphan garbage-collection. Drives off the action's structured side-effect fields (`page_creates`, `page_removes`, `page_slug_renames`) plus the `_files_created_this_turn` / `_files_deleted_this_turn` bookkeeping the save / delete tools maintain.

## Model Configuration

Model defaults and environment overrides live in `apps/agent/config.py`. Most agents default to `gemini-3-flash-preview`. One reasoning-heavy seat is promoted to `gemini-3.1-pro-preview` by default:

- `BACKEND_HANDLER_BUILDER_MODEL` — handler SQL generation requires reasoning about `ownerScope` ("shared" vs "user") to avoid emitting `WHERE owner_id = ?` on shared-scope models.

The promotion is env-var-overridable per the existing `{AGENT_NAME}_MODEL` convention so production can roll back to flash if cost or latency surprises emerge.

Current active env vars:

- `APP_HELP_DESK_MODEL`
- `PRE_CREATOR_MODEL`
- `CREATOR_MODEL`
- `EDITOR_MODEL`
- `DESIGN_SYSTEM_BUILDER_MODEL`
- `COMPONENT_BUILDER_MODEL`
- `COMPONENT_BUILDER_MULTIPLE_MODEL`
- `LOGIC_BUILDER_MODEL`
- `BACKEND_MODEL_BUILDER_MODEL`
- `BACKEND_HANDLER_BUILDER_MODEL` *(default `gemini-3.1-pro-preview`)*
- `SEED_DATA_BUILDER_MODEL`
- `SURVEYOR_MODEL`
- `RESULT_RESPONSE_WRITER_MODEL`
- `BLOG_POST_CREATOR_MODEL`
- `DESIGN_IMPORTER_MODEL`

No upfront `SkillSelector` agent exists anymore; the `SKILL_SELECTOR_MODEL`
env var from older deploy files is ignored (see [skills.md](skills.md)).
