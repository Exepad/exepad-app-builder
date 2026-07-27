# Exepad Agent Documentation

**Version:** 2.1.0  
**Python:** 3.12  
**Framework:** FastAPI + Google ADK

---

## What This Service Does

The agent app turns user requests into Exepad web apps by orchestrating a small set of planning, building, validation, and response-writing agents. All apps ship as **Code Focus** TSX components rendered in the light DOM with Tailwind compiled per-app (the legacy JSON scaffold system was removed in April 2026 and is no longer relevant). It streams progress over SSE, stores intermediate artifacts, validates generated TSX/config output, and hands the final app config back to the platform backend/runtime.

## Current Pipeline At a Glance

```text
POST /r                                POST /cancel
  -> FastAPI edge (validation, auth, rate limiting, SSE)
  -> PipelineOrchestrator
     -> AppHelpDesk routing for edit/help_desk branches
     -> DesignImportWorkflow when design_bundle_id is present
     -> PreCreator + Creator for creation planning
     -> DesignSystemBuilder / LogicBuilder / BackendBuilder
     -> ComponentBuilder / ComponentBuilderMultiple
        (skills loaded via ADK SkillToolset at inference time)
     -> Inline validation + final compile gate, assembly, post-processing
     -> ResultResponseWriter
```

## Key Capabilities

- Create complete multi-page web apps from natural language
- Import Stitch / Claude Design bundles via the `DesignImportWorkflow` branch
- Edit existing apps through routed action plans
- Generate backend models, handlers, and seed data when needed
- Build TSX components with on-demand skill loading via ADK `SkillToolset`
- Stream progress and completion events to the caller
- Out-of-band Stop: `POST /cancel` drops a process-local marker keyed by
  `session_id` that the in-flight watchdog picks up and aborts the LLM call in
  ~1.5 s (the self-hosted container is a single instance, so an in-memory dict
  is sufficient)

## Read Next

| Document | Description |
|----------|-------------|
| [Getting Started](02_getting-started.md) | Installation, environment setup, local run commands |
| [Architecture](03_architecture.md) | Runtime architecture, layers, artifact flow |
| [Agent System](04_agent-system.md) | Active agents, builders, and their responsibilities |
| [Workflows](05_workflows.md) | Creation, editing, design-import, and help-desk flows |
| [Services](06_services.md) | Shared and webapp-specific services |
| [Session & State](07_session-and-state.md) | Important session state keys and artifact flow |
| [API Reference](08_api-reference.md) | HTTP payloads, SSE event formats, error shapes |
| [Configuration](09_configuration.md) | Environment variables, feature flags, timeouts |
| [Schemas & Models](10_schemas-and-models.md) | `packages/schemas` docs, artifacts, and Pydantic models |
| [Error Handling](11_error-handling.md) | Retry, timeout, validation, and failure behavior |
| [Testing](12_testing.md) | Unit, integration, e2e, and eval guidance |
| [Deployment](13_deployment.md) | How the agent ships inside the container |
| [Contributing](14_contributing.md) | Coding conventions and extension points |
| [Failure Telemetry](15_telemetry.md) | `agent_outcome` events, BigQuery sink setup, schema reference |
