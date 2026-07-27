# System Architecture

This service is a FastAPI + ADK application that coordinates planning agents, deterministic workflow code, validation services, and artifact storage to produce Exepad app configs.

---

## Runtime Layers

```text
HTTP Layer
  agent_api.py
  - request parsing
  - auth / subscription checks
  - SSE streaming on /r
  - out-of-band cancellation on /cancel (process-local marker + _iter_with_cancel watchdog)

Orchestrator Layer
  main_agent/agent.py
  main_agent/agents/orchestrator/core.py
  - root ADK app
  - workflow routing
  - progress + result coordination

Workflow Layer
  app_types/webapp/workflows/
  - creation_workflow.py
  - editing_workflow.py
  - design_import_workflow.py
  - parallel_pre_build.py
  - frontend_build_side_effects.py

Agent / Builder Layer
  app_types/webapp/subagents/
  app_types/shared/builders/
  - planning
  - TSX generation
  - design system generation
  - backend model / handler / seed generation

Service Layer
  app_types/shared/services/
  app_types/webapp/services/
  main_agent/services/validation/
  - content preparation
  - validation
  - assembly
  - post-processing
  - backend notifications

Infrastructure Layer
  ADK sessions (in-memory unless SESSION_SERVICE_URI is set) + in-memory artifacts
  LLM provider (native Gemini/Vertex, or any vendor via LiteLLM)
  runtime callback APIs
```

## Core Request Flow

```text
User request
  -> /r
  -> PipelineOrchestrator
  -> create/edit/help branch
  -> workflow-specific agents + services
  -> validated artifacts
  -> assembled app_config
  -> SSE events + backend callback
```

## Artifact-Driven Build Model

Active apps are built as Code Focus TSX components (the legacy JSON scaffolds —
Crud/Dashboard/Settings/Auth/Chat — were removed in April 2026). The webapp
pipeline communicates primarily through artifacts and session state:

- `codefocus_style:theme.css`
- `codefocus_style:tailwind.config.js`
- `codefocus_component:{ComponentName}.tsx`
- `codefocus_module:{ModuleName}.tsx` (supporting modules)
- `logic.json`
- `backend.json`
- `handler_code:{handler}.tsx`
- `seed:{dataset}.csv`
- `content:{page}:{component}.md`

Auth pages are generated as ordinary Code Focus TSX when
`security.authProviders` is set and no auth pages exist — there is no separate
scaffold path. This keeps builder outputs decoupled and lets workflows validate,
assemble, and post-process them deterministically.

## Important Services

- `DocumentArtifactService`: resolves user documents, image catalogs, and `@filename` references
- `ValidationService`: wraps agent runs with retry / repair behavior
- `AssemblyService`: converts generated artifacts into final `app_config`
- `PostProcessingService`: UUID/timestamp normalization and final deterministic fixes
- `CrossValidator`: checks assembled configs for cross-cutting consistency
- `BackendNotificationService`: reports success / failure back to the platform backend

## Directory Landmarks

```text
apps/agent/
  agent_api.py
  config.py
  main_agent/
    agent.py
    services/validation/
    agents/orchestrator/
      core.py
      service_registry.py
      app_types/
        shared/
        webapp/
  tests/
  deployment/

packages/schemas/
  data/agent_docs/
  data/examples/
  scripts/py/validation/
```
