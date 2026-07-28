# Pipeline Orchestrator

## Overview

The Pipeline Orchestrator routes user requests to the appropriate Code Focus (TSX) workflow — creation or editing — and coordinates shared services like validation, progress tracking, and blog management.

## Directory Structure

```
orchestrator/
├── core.py                         # Main orchestrator (routing + coordination)
├── service_registry.py             # Dependency injection / service wiring
├── README.md
│
├── models/                         # Shared data models
│   ├── progress_tracker.py         # Progress tracking and events
│   ├── timing_tracker.py           # Timing instrumentation
│   └── agent_errors.py             # Collected workflow/agent errors
│
├── services/                       # Orchestrator-level services
│   └── __init__.py
│
├── prompts/                        # Shared prompt templates
│   └── __init__.py
│
└── app_types/                      # App-type implementations
    ├── shared/                     # Shared across app types
    │   ├── builders/               # TSX builders, backend handler builder, logic/backend/seed builders
    │   ├── models/                 # Plan models, creator input
    │   ├── services/               # Validation, blog actions, document artifacts, pricing, GCS output
    │   └── subagents/              # AppHelpDesk, ResultResponseWriter
    │
    └── webapp/                     # Code Focus (TSX) implementation
        ├── subagents/              # PreCreator, Creator, ComponentBuilder,
        │                           #   ComponentBuilderMultiple,
        │                           #   DesignSystemBuilder, Editor
        ├── workflows/              # CreationWorkflow, EditingWorkflow, parallel_pre_build
        └── services/               # Assembly, post-processing, design system context,
                                    #   image resolver
```

## Core Components

### PipelineOrchestrator (`core.py`)

Routes requests to the appropriate workflow:
- **Creation**: New app generation via `CreationWorkflow`
- **Editing**: App modifications via `EditingWorkflow`
- **Direct actions**: Blog enable/disable, help desk queries

### ServiceRegistry (`service_registry.py`)

Constructs and wires all services and workflows via a single `create()` factory method.

### Workflows

**CreationWorkflow** (`app_types/webapp/workflows/creation_workflow.py`)
1. Run Creator agent to get plan (pages, navigation, design system, backend needs)
2. Build design system + logic + backend in parallel (or sequentially if flag off)
3. Build TSX components with ComponentBuilder; each agent discovers its own domain skills at inference time via its `SkillToolset` (no pre-selection pass)
4. Batch validation, then image resolution + backend handler builder (parallel), then seed data
5. Assembly and post-processing

**EditingWorkflow** (`app_types/webapp/workflows/editing_workflow.py`)
1. Run help desk agent to classify request
2. Run Editor agent to get a grouped action plan
3. Execute the fixed phase pipeline: `modify_styles` → `change_backend_models` → `edit_seed_data` → `ingest_data` → `modify_logic` → `add_handler` → `modify_handler` → `remove_handler` → `rename_page_title` → `frontend_build`. All cross-file frontend work routes through ComponentBuilderMultiple in the `frontend_build` phase.
4. Batch validation, then assemble and save updated config

### Key Services

- **ValidationService** — Schema validation and repair loops
- **BlogActionsService** — Blog enable/disable, post removal
- **DocumentArtifactService** — ADK artifact I/O for app configs
- **GcsOutputService** — Upload debug artifacts to GCS
- **CodeFocusPostProcessingService** — Final config cleanup
- **Skills** — Loaded at agent boot via `main_agent/agents/utils/skills.py` (`load_frontend_skills`, `load_diagnostic_skills`, `load_design_importer_skills`) and exposed to the LLM through ADK `SkillToolset` instances attached to each agent

## Adding Functionality

1. **Services**: Add to `app_types/shared/services/` if shared, or `app_types/webapp/services/` if webapp-specific
2. **Subagents**: Add to `app_types/shared/subagents/` or `app_types/webapp/subagents/`
3. **Builders**: Add to `app_types/shared/builders/`
4. **Workflows**: Add to `app_types/webapp/workflows/`
5. **Skills**: Add a `<root>/<kebab-name>/SKILL.md` under the relevant skill root in `packages/schemas/data/agent_docs/` (e.g. `frontend/component_builder/skills/`) and update the expected catalogue set in `tests/unit/test_skills_conformance.py`. There is no registry to update — each agent's `SkillToolset` reads skills from disk at boot via `main_agent/agents/utils/skills.py`. See [docs/latest/skills.md](../../../docs/latest/skills.md).
