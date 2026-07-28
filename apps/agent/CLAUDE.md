# CLAUDE.md — Exepad Agent (`apps/agent`)

## Overview

The Exepad Agent is a Python-based AI orchestration service built on Google's ADK (Agent Development Kit). It converts user requests into fully-functional web application JSON configurations by orchestrating multiple specialized AI agents (planner, builder, editor, etc.). Output is consumed by the `runtime` (Vite + Hono on Node) and the in-process `app-backend`.

**Core flow:** User request → `/r` SSE endpoint → PipelineOrchestrator → Multi-agent workflow → JSON app config

## Tech Stack

| Layer            | Technology                                             |
|------------------|--------------------------------------------------------|
| Language         | Python 3.12                                            |
| Web Framework    | FastAPI 0.128+, Uvicorn (`:8081` in-container; `make run` uses 8080) |
| AI Framework     | Google ADK 1.25; Gemini 3 Flash Preview default, any vendor via LiteLLM (`EXEPAD_LLM_PROVIDER`) |
| Validation       | Pydantic 2.12+ (strict mode), jsonschema               |
| Database         | SQLAlchemy 2.0 + aiosqlite (SQLite-only in the OSS build) |
| Artifact Storage | In-memory (ADK); pulled by the runtime worker post-build |
| Logging          | structlog → stdout (Cloud Logging only under `ENVIRONMENT=production`, which self-host never sets) |
| Tracing          | OpenTelemetry                                          |
| Formatting       | Black (line-length 100)                                |
| Linting          | Flake8 (max-complexity 12)                             |
| Type Checking    | mypy with Pydantic plugin                              |
| Testing          | pytest 8+ with pytest-asyncio (auto mode)              |

## Key Commands

```bash
# Development
make run                    # uvicorn dev server with --reload (port 8080)
make run-prod               # Production server (no reload)
make install                # Install all deps (prod + dev)

# Code Quality
make format                 # Auto-format with Black
make format-check           # Check formatting (CI)
make lint                   # Flake8 linting
make typecheck              # mypy type checking
make static                 # All static analysis (format + lint + typecheck)
make check                  # Quick dev check (format + lint + unit tests)
make precommit              # Full pre-commit (all static + all tests)

# Testing
make test                   # All tests (excludes eval)
make test-unit              # Unit tests only (fast)
make test-integration       # Integration tests only
make test-cov               # Tests with coverage (min 50%)

# Agent Evaluation (requires Vertex AI credentials)
make eval                   # ROUGE-1 evaluations (fast, CI-friendly)
make eval-rubric            # LLM-as-judge rubric evaluations (slower)
make eval-all               # Both ROUGE-1 and rubric
make eval-routing           # AppHelpDesk routing evaluations
make eval-building          # Deterministic building replay/pipeline confidence cases
make eval-support           # ResultResponseWriter evaluations
make test-validation-confidence  # Deterministic PR confidence gate

Building-layer confidence comes from deterministic replay and pipeline tests, not ADK eval wrappers.

# Cleanup
make clean                  # Remove caches, __pycache__, htmlcov, .coverage
```

## Project Structure

```
apps/agent/
├── agent_api.py                → FastAPI app, /r endpoint, session/artifact management
├── agent_cli.py                → CLI interface for local testing
├── config.py                   → Agent model config, timeouts, rate limits, env overrides
├── main_agent/
│   ├── agent.py                → ADK App + PipelineOrchestrator init
│   ├── constants.py            → StateKeys, ComponentType enums
│   ├── services/
│   │   └── validation/         → Code Focus inline validation + final compile gate
│   │       ├── syntax_validator.py      → Stage 1 (esbuild) + Stage 1.5 (tsc)
│   │       ├── tsc_validator/           → Per-app .d.ts generator + tsc runner
│   │       ├── tsx_ast/                 → tree-sitter rule engine (Stage 2)
│   │       ├── css_ast/                 → tinycss2 rule engine for theme.css
│   │       ├── semantic_validator.py    → Stage 2 residual regex checks
│   │       ├── fixers/                  → Deterministic auto-fix passes
│   │       ├── style_coverage.py        → Stage 4: custom class vs theme tokens
│   │       ├── final_compile_gate.py    → Single Tailwind compile, runs once at workflow end
│   │       └── exceptions.py            → Pipeline error types
│   ├── testing/                → Test utilities and mock helpers
│   └── agents/
│       ├── tools/              → ADK tools (content artifacts, etc.)
│       ├── utils/              → Helpers, artifact manager, state utilities
│       └── orchestrator/
│           ├── core.py                 → PipelineOrchestrator routing logic
│           ├── service_registry.py     → DI factory for all services
│           ├── models/                 → Pydantic output models + ProgressTracker
│           ├── importers/              → Design-bundle staging, decomposition, JSX→TSX
│           └── app_types/
│               ├── base/           → BaseWorkflow, BaseService interfaces
│               ├── shared/
│               │   ├── builders/       → LogicBuilder + backend_builders (model/handler/seed)
│               │   ├── models/         → plan_models.py (LogicPlan, ModelPlan, HandlerPlan, …)
│               │   ├── services/       → ValidationService, Pricing, BackendNotificationService, etc.
│               │   └── subagents/      → AppHelpDesk, ChatResponseWriter
│               └── webapp/
│                   ├── subagents/      → PreCreator, Creator, Editor, ComponentBuilder, ComponentBuilderMultiple, DesignSystemBuilder
│                   ├── workflows/      → CreationWorkflow, DesignImportWorkflow, EditingWorkflow, frontend_build_side_effects
│                   └── services/       → assembly, post-processing, image resolver
├── tests/
│   ├── conftest.py             → Shared fixtures (validate_config, sample configs, test_client)
│   ├── unit/                   → Fast tests, no external deps
│   ├── integration/            → Service-level tests
│   ├── e2e/                    → Full /r endpoint workflow tests
│   │   ├── fixtures/           → Test payloads and app configs
│   │   └── utils/              → E2E helpers
│   ├── eval/                   → Agent quality evaluations
│   │   ├── agents/             → help_desk.py, response_writer.py
│   │   ├── benchmarks/         → Performance benchmark cases
│   │   ├── building/           → Deterministic building-layer confidence cases
│   │   ├── routing/            → AppHelpDesk routing evaluations
│   │   └── support/            → ResultResponseWriter evaluations
│   ├── confidence/             → Deterministic PR / nightly confidence gates
│   ├── replay/                 → Sanitized validator/workflow replay corpus
│   └── fixtures/               → Mock agents and contexts
├── docs/
│   └── latest/                 → Architecture and development docs
├── Makefile                    → All dev/test/eval/deploy commands
├── requirements.txt            → Production deps (pinned versions)
├── requirements-dev.txt        → Dev deps (black, flake8, mypy, pytest, faker)
├── pyproject.toml              → Black config (line-length 100, py312)
├── pytest.ini                  → Pytest config (markers, asyncio_mode=auto)
├── mypy.ini                    → mypy config (strict_optional, pydantic plugin)
├── .flake8                     → Flake8 config (ignores W503, E203, E266, E501)
├── .coveragerc                 → Coverage config (source=main_agent, fail_under=50)
├── env.example                 → Documented env var template
└── .env / .env.local           → Local environment (not committed)
```

## API

### `POST /r` — Main Orchestration Endpoint (SSE)

Streams Server-Sent Events (progress, chat messages, config updates).

**Request:** `{ operation_mode, user_id, session_id, payload: { app_uuid, app_name, app_type, app_description, chat_history, correlation_id, image_catalog, document_catalog, ... } }`

**SSE event types:** `progress`, `chat_message`, `page_reload`, `app_config_updated`, `backend_response`

**Features:** Idempotency via `correlation_id`, per-session locking, rate limiting (10 req/60s), IAM verification (prod).

### `POST /cancel` — Out-of-band Cancellation

Drops a process-local marker (keyed by `session_id`) that the in-flight `/r` watchdog polls, so a caller can cancel a run mid-phase. The self-host container is a single instance, so the marker is an in-memory dict. IAM verification (prod).

### `GET /health` — Health Check

## Agent Architecture

### Workflow Routing

```
Request → PipelineOrchestrator
  ├── operation_mode="create" + design_bundle_id
  │       → DesignImportWorkflow (self-contained, NO CreationWorkflow)
  │           Phase 0–3.1: stage bundle → DesignImporter LLM →
  │                        deterministic decomposition → grounding →
  │                        app_secondary_type reconciliation →
  │                        data extraction (arrays → backend models)
  │           _translate_mechanical_tsx (Babel-shell → TSX, deterministic)
  │           _run_backend_build (BackendBuilder.build_create direct call —
  │                               models + handlers + seeds in parallel)
  │           _build_initial_app_config (AssemblyService, deterministic)
  │           Synthesize EditorOutput with one FrontendBuildAction per
  │             entry. Push EDIT_PLAN_SOURCE="design_import" so
  │             EditingWorkflow skips its Editor LLM.
  │           Delegate to EditingWorkflow.execute() →
  │             phase 10 frontend_build dispatches
  │             COMPONENT_BUILDER_MULTIPLE_POLISH (one LLM turn per entry;
  │             plain ComponentBuilderMultiple is the unwired fallback)
  │             for cleanup + data wiring.
  │
  ├── operation_mode="create" (no bundle)
  │       → CreationWorkflow (Code Focus)
  │           PreCreator → Creator → builders → Assembly
  │
  ├── operation_mode="edit"
  │       → AppHelpDesk → edit | help_desk
  │           edit → EditingWorkflow (10 phases, ending in
  │                  frontend_build → ComponentBuilderMultiple)
  │
  └── operation_mode="help_desk" → Q&A Response
```

See [docs/latest/14-design-imports.md](../../docs/latest/14-design-imports.md) for the design-import flow in detail. See [docs/latest/05_workflows.md](docs/latest/05_workflows.md) for full workflow phase ordering.

### Agent Registry (`config.py`)

Most agents default to Gemini 3 Flash Preview. One reasoning-heavy seat defaults to **Gemini 3.1 Pro Preview**: `BACKEND_HANDLER_BUILDER_MODEL` (handler SQL generation needs to reason about `ownerScope` to avoid emitting `WHERE owner_id = ?` on shared-scope models). Override per-agent via env vars: `{AGENT_NAME}_MODEL=gemini-3-pro-preview`.

| Agent | Role |
|-------|------|
| AppHelpDeskAgent | Routing intelligence (edit/help_desk) |
| ResultResponseWriter | User-facing chat response |

**Shared Builders:**

| Agent | Role |
|-------|------|
| LogicBuilder | JSON config builder for frontend logic (shared) |
| BackendModelBuilder | Backend model config builder (shared). **Skills via SkillToolset** (`backend/skills/database-schema-design`). |
| BackendHandlerBuilder | Backend handler TSX builder (shared). **Skills via SkillToolset** (`backend/skills/handler-patterns-rpc`). |
| SeedDataBuilder | JSON config builder for seed data (shared). **Skills via SkillToolset** (`backend/skills/seed-data-csv`). |

**Webapp Agents:**

| Agent | Role |
|-------|------|
| PreCreator | Classifies app type and language before planning |
| Creator | Plans app structure, design system, logic, backend needs, and favicon |
| ComponentBuilder | Single-file TSX component builder used by CreationWorkflow per-component build loop. |
| ComponentBuilderMultiple | Multi-file frontend coding agent (Glob / Grep / Edit / Read / Write / Delete + dependency graph + symbol references + describe + state inspection — 12 tools). Dispatched from EditingWorkflow's `_run_phase_frontend_build`; resolves cross-file cascades in one LLM turn. Default model: `gemini-3-flash-preview`. |
| ComponentBuilderMultiplePolish | Narrow polish-mode variant of ComponentBuilderMultiple, dispatched **only** from the design-import branch's frontend_build phase (phase 10 of the delegated EditingWorkflow; sequential for a single entry, the parallel polish pool for multi-page). Uses a narrowed subset of ComponentBuilder's SkillToolset (`component-editing`, `state-hooks`, `theme-token-migration`) with a "translate, don't regenerate" prompt. Default model: `gemini-3-flash-preview` (env `COMPONENT_BUILDER_MULTIPLE_POLISH_MODEL`). |
| DesignSystemBuilder | Generates theme.css (Tailwind v4 is CSS-first; no tailwind.config.js). **Skills via SkillToolset** (`frontend/design_builder/skills/{dark-mode-tokens,font-pairing}`). |
| Editor | Plans edit actions over a 10-action schema; emits `FrontendBuildAction` for all cross-file frontend work. Default model: `gemini-3-flash-preview`. |
| Surveyor | Read-only diagnostic pre-pass for edit-class turns. Produces a `DiagnosticReport` (Pydantic) the Editor consumes to ground its plan in evidence. 13 Class A tools (7 ADK artifact + 6 diagnostic, including `code_revision_diff_tool` and `field_mismatch_report_tool`); +5 Class B runtime probes (`execute_handler_tool`, `query_db_tool`, `sample_table_tool`, `screenshot_preview_tool`, `read_browser_state_tool`) when `SURVEYOR_RUNTIME_PROBES_ENABLED=true`. **Skills via SkillToolset** (`diagnostic/skills/<profile>`). |
| DesignImporter | Plans slug/chrome/M3-pillar mapping for uploaded design bundles. Replaces Creator on the design-import branch. |

**Skills (loaded by LLM at inference time via ADK `SkillToolset`):**

The nine LlmAgents that own a `SkillToolset` are:

- **ComponentBuilder + ComponentBuilderMultiple** — `frontend/component_builder/skills/` (27 skills: 3 flow + 24 domain). **ComponentBuilderMultiplePolish** loads a narrowed 3-skill subset (`component-editing`, `state-hooks`, `theme-token-migration`) of the same root.
- **DesignSystemBuilder** — `frontend/design_builder/skills/` (2 skills: `dark-mode-tokens`, `font-pairing`)
- **BackendModelBuilder + BackendHandlerBuilder + SeedDataBuilder** — `backend/skills/` (3 skills, shared toolset)
- **Surveyor** — `diagnostic/skills/` (6 profiles)
- **DesignImporter** — `design_bundle_importer/skills/` (2 skills)

Each toolset injects the four ADK tools (`list_skills`, `load_skill`, `load_skill_resource`, `run_skill_script`) plus an `<available_skills>` XML preamble that lists the family's catalogue. Catalogue total: **40 skills** (27 + 2 + 3 + 6 + 2). See [docs/latest/skills.md](docs/latest/skills.md) for the authoring guide and per-family `metadata.kind` table.

**Deterministic helpers (no LLM):**

| Helper | Role |
|--------|------|
| `services/artifact_search.py` | Glob (`list_artifacts_by_pattern`), Grep (`search_artifact_contents`), Edit-splice (`apply_edit_to_artifact`) primitives backing ComponentBuilderMultiple's read/edit tools. |
| `services/dependency_graph.py` | AST-based import-graph (`build_dependency_graph`), TSX-aware symbol-reference lookup (`find_symbol_references`), structural artifact summary (`describe_artifact`), live workflow-state inspection (`inspect_app_state`). |
| `webapp/workflows/frontend_build_side_effects.py` | Post-agent registry mutations after `FrontendBuildAction` runs — page registry add / remove / slug rename, supporting-modules auto-registration via import-graph inference, orphan GC. |
| `importers/tools/decomposition/runner.py` | Phase 1.5: emits theme.css + per-page HTML + chrome regions + per-sibling Babel-shell modules from staged `bundle:*` artifacts. |
| `importers/grounding.py` | Phase 2: reseeds placeholder-shaped `app_name` and generic content-component names from `bundle_digest`. |
| `importers/tools/jsx_to_tsx/data_extractor.py` | Phase 3.1: walks Babel-shell siblings for `const NAME = [{...}]` arrays with `.map()` consumers; promotes them to backend models + seed CSV. |
| `importers/tools/jsx_to_tsx/module_transformer.py` | Per-module Babel-shell → TSX translator (cross-module ES imports, `useX` destructure dedupe). |

### Code Focus Validation Pipeline

Validation is **inline at component save** plus **a single final compile gate** at workflow end. There is no LLM "Fixer" agent and no batch re-validation pass — those were removed.

Inline (per component, in the save tool):

1. **Stage 1 — Syntax** (esbuild) — validates TSX syntax.
2. **Stage 1.5 — tsc** (`tsc --noEmit`, fails open without Node) — type-checks the component against per-app generated `app.d.ts` (model/handler/state/route names).
3. **Stage 2 — Semantic** (AST rules + residual regex + auto-fix). Auto-fixers run first; remaining warnings ship with the artifact, errors block save.
4. **Stage 4 — Style coverage** (custom classes vs theme tokens).

End-of-workflow:

5. **Final compile gate** (`final_compile_gate.run_final_compile_gate`) — single deterministic Tailwind v4 compile against the final theme + every component, ~1 s, no LLM.

**Single-attempt contract.** ComponentBuilder gets one save attempt per file; warnings ship in the SSE response, errors abort that component (the rest of the workflow still completes). The user iterates via the editor flow.

**ComponentBuilderMultiple shares the same single-attempt save contract.** Its surgical `edit_artifact_tool` invokes the same validation chain (esbuild → tsc → AST → fixers → semantic → style coverage) and counts against the same retry caps as a full save, so the agent can't sidestep the contract by issuing many small edits. Cross-file visibility comes from `_codefocus_sibling_modules` — workflow-seeded with every staged frontend artifact at dispatch start, refreshed after every save.

#### Rule engines

Three engines share a common `Finding` type (`services/validation/finding.py`) and crash-isolated `run_rules()` runner:

- **`services/validation/tsx_ast/`** — tree-sitter-TSX rule engine. Three factories in `rules/default_set.py`:
  - `shared_tsx_rules()` — imports + forbidden APIs (applies to handler and component TSX).
  - `handler_rules()` — shared + handler-specific (export shape, handler signature, SQL, return fields, owner-filter scope).
  - `component_rules()` — shared + component-specific (hook safety, useApp selector, cross-refs, JSX shape, a11y, null safety, model payload, handler output fields).
- **`services/validation/css_ast/`** — tinycss2-backed rule engine for `theme.css`. Single factory `theme_css_rules()` covers forbidden patterns, required structure, HSL format, and WCAG AA contrast pairs.
- **`services/validation/semantic_validator.py`** — residual regex checks (hardcoded data arrays, hallucinated URLs, M3 color pairing, a11y subset). Called from `run_semantic_checks` alongside the AST pass.

Full rule catalog: see [docs/validation/rules.md](docs/validation/rules.md).

#### Fixers

`services/validation/fixers/` is the canonical import site for the auto-fix pass. Re-exports:

- `apply_auto_fixes(tsx, models, actions, state_keys, ...)` — 33-function deterministic rewrite pass (import rewrites, icon typo fuzzy-match, null-safety injection, M3 token pairing, etc.).
- `apply_handler_auto_fixes(tsx, model_names)` — narrower pass for handler TSX.
- `rewrite_useapp_destructures(tsx)` — AST-based useApp destructure rewriter used by `apply_auto_fixes`.

Fix bodies live in per-category modules under `fixers/` (`component_imports`, `component_urls_images`, `component_m3_colors`, `component_null_safety`, `component_typos`, `component_a11y_ux`, `component_polishing`, `component_inline_styles`, `component_forbidden_apis`). The dispatchers (`dispatcher.py`, `handler_dispatcher.py`) orchestrate them in a fixed order.

### Artifacts

- `skeleton.json` — App structure (header, footer, pages list)
- `theme.json` — Theme configuration
- `page:{slug}.json` — Per-page component config
- `section_{n}.json` — Section components
- `content:{page}:{component}.md` — Markdown content

**Code Focus artifacts:**
- `codefocus_component:{Name}.tsx` — Generated TSX component
- `codefocus_style:theme.css` — Theme CSS
- `logic.json` — Frontend logic config (state only)
- `backend.json` — Backend models + handlers config
- `handler_code:{name}.tsx` — Custom handler TSX
- `seed:{name}.csv` — Seed data CSV

### Session State

Read and write `ctx.session.state` directly, always keying off the constants in `main_agent/constants.py:StateKeys` — use `StateKeys.APP_CONFIG`, never the raw `"app_config"`.

## Code Conventions

- **Formatting:** Black, line-length 100, target Python 3.12
- **Linting:** Flake8 with max-complexity 12; ignores W503, E203, E266, E501 (Black-compatible)
- **Type checking:** mypy with `strict_optional`, `check_untyped_defs`, Pydantic plugin
- **Constants over strings:** Use the `StateKeys` and `ComponentType` enums — never raw string keys
- **Validation:** Pydantic BaseModel for all agent inputs/outputs with strict typing
- **Async patterns:** `async for event in agent.run_async(ctx): yield event`
- **Error handling:** Errors collected in `StateKeys.AGENT_ERRORS`; workflow failures yield SSE `backend_response` with `status="failed"`
- **Logging:** `structlog.get_logger(__name__)` — structured key-value logging
- **Imports:** Standard lib → third-party → local; `from dotenv import load_dotenv` at top of `agent_api.py`

## Environment Variables

Copy `env.example` to `.env` and `.env.local`. Key variables:

| Variable | Purpose |
|----------|---------|
| `*_MODEL` | Per-agent LLM model override (see env.example) |
| `EXEPAD_LLM_PROVIDER` | `gemini` (default) / `vertex` → native ADK; anything else → LiteLLM |
| `EXEPAD_LLM_API_KEY` | Key for the selected non-Gemini provider |
| `EXEPAD_LLM_BASE_URL` | Endpoint for OpenAI-compatible / self-hosted servers |
| `EXEPAD_LLM_MODEL_DEFAULT` | Model used when a non-Gemini provider is active but an agent still carries a `gemini-*` default |
| `GEMINI_API_KEY` | Key for the native Gemini path |
| `ENVIRONMENT` | `development` / `selfhost` (the container) / `production` / `test` |
| `SESSION_SERVICE_URI` | Optional SQLAlchemy DB URI for ADK session persistence. **Unset by default and never set by the container** — sessions are in-memory and do not survive a restart. |
| `GOOGLE_GENAI_USE_VERTEXAI` | Route the native path through Vertex AI (`True`) |
| `PEXELS_API_KEY` | Pexels image search API key |
| `RATE_LIMIT_REQUESTS` | Max requests per window (default: 10) |
| `RATE_LIMIT_WINDOW` | Window in seconds (default: 60) |
| `PARALLEL_*_TIMEOUT` | Parallel agent timeouts (180s/300s/600s) |
| `DOCUMENT_MAX_SIZE_CHARS` | Max doc size before Vertex AI Search (50000) |
| `SKIP_DOCUMENT_FETCH` | Skip HTTP fetches in tests (`true`/`false`) |

## Testing

**Markers:** `unit`, `integration`, `e2e`, `slow`, `eval`, `eval_fast`, `eval_rubric`, `eval_routing`, `eval_building`, `eval_support`

```bash
# Run specific markers
pytest tests/unit -v
pytest tests/ -m "integration"
pytest tests/e2e -m "e2e"
pytest tests/eval -m "eval_fast"      # ROUGE-1 (CI-friendly)
pytest tests/eval -m "eval_rubric"    # LLM-as-judge (slower)
```

**Fixtures** (in `tests/conftest.py`): `validate_config()`, `sample_valid_webapp`, `minimal_app_config`, `sample_image_catalog`, `sample_document_catalog`, `test_client` (FastAPI TestClient).

**Async:** `asyncio_mode = auto` — all async tests run automatically without `@pytest.mark.asyncio`.

## Deployment

- **In-container:** the agent ships inside the single self-hosted image (root `Dockerfile`); the entrypoint runs it on internal **:8081**, reverse-proxied by the runtime worker at `/agent/*`
- **Binaries:** `esbuild` (TSX syntax validation) and the npm `@tailwindcss/cli` + vendored `tailwindcss` package (CSS compilation) installed in the container
- **Shared packages:** Schema validation from `/packages/schemas/` copied into container at `/packages/schemas/`

## Monorepo Integration

Part of the Exepad monorepo (pnpm + Turborepo):
- Consumes schemas from `packages/schemas/scripts/py/` — on `sys.path` locally, copied to `/packages/schemas/` by the root `Dockerfile`
- Generates `WebAppProps` configs conforming to types in `packages/types/`
- Output consumed by `apps/runtime` (renders JSON → React) and `apps/app-backend` (auto-CRUD)

## Generated App MCP Capabilities

Apps built by the agent can include `mcp: { enabled: true }` in their backend config. When deployed, the app-backend for that app exposes a `POST /mcp` endpoint (Streamable HTTP, JSON-RPC 2.0) for AI agent tool access, reachable through the runtime gateway at `/api/{appId}/mcp` and authenticated with an `exepad_sk_*` API key. The agent does not generate `mcp` blocks by default — this is a platform feature enabled per app in its config. See `apps/app-backend/docs/latest/api-reference.md` for the protocol.
