# Service Layer Reference

Services encapsulate reusable domain logic and are composed into workflows. They are instantiated via the `ServiceRegistry` and injected into the orchestrator.

---

## Service Registry

The `ServiceRegistry` (`orchestrator/service_registry.py`) centralizes service instantiation, cross-reference wiring, and workflow construction via a `create()` factory method:

```python
registry = ServiceRegistry.create(
    write_result_response_fn=self._write_result_response,
    codefocus_creator_agent=codefocus_creator_agent,
    codefocus_component_builder_agent=codefocus_component_builder_agent,
    codefocus_design_system_builder_agent=codefocus_design_system_builder_agent,
    codefocus_editor_agent=codefocus_editor_agent,
)
# registry.validation_service, registry.codefocus_creation_workflow, etc. are ready to use
```

The factory constructs all services, wires cross-references (e.g., post-processing needs validation), and builds both Code Focus workflows (creation and editing) in one call.

---

## Shared Services

### ValidationService

**Location:** `app_types/shared/services/validation_service.py`

Runs agents with retry logic and validation. The core method `_run_agent_with_retry()` handles:

- **Token tracking** via MetricsTracker — records input/output tokens per agent call
- **Empty response detection** — detects when agents produce no output
- **Automatic repair** — feeds validation errors back to the agent with repair prompts
- **Max attempts** — configurable via `MAX_REPAIR_ATTEMPTS` (default: 6)

```
Agent call
    ↓
Parse output → Validate against schema
    ↓ (valid)
Return result
    ↓ (invalid)
Feed errors back → Repair prompt → Retry
    ↓ (max attempts)
Record error → Continue pipeline
```

### DocumentArtifactService

**Location:** `app_types/shared/services/document_artifact_service.py`

Handles user-uploaded documents:

- Loads documents from `content_url` in the document catalog
- Matches `@filename` references in user prompts to documents
- Provides document summaries and content to planning agents
- Respects `DOCUMENT_MAX_SIZE_CHARS` limit (uses Vertex AI Search for large docs)
- Supports retry with exponential backoff for document fetching

### PricingService

**Location:** `app_types/shared/services/pricing_service.py`

Estimates credit costs for operations before execution. The catalog covers the
current Gemini family including `gemini-3-flash-preview`, `gemini-3.1-pro-preview`,
and `gemini-3.5-flash` ($1.50 / $9 / $0.15 per M input / output / cached). Add
new model SKUs here before they're referenced from `config.py`.

### BackendNotificationService

**Location:** `app_types/shared/services/backend_notification_service.py`

Posts a completion callback when agent execution finishes. Handles:

- Callback data assembly from session state and metrics
- Test mode (emits event instead of HTTP call)
- Skipped entirely when `DJANGO_BACKEND_URL` is unset — which is the case in
  self-host, where the runtime drives the run over SSE and then pulls artifacts
  itself, so no callback target exists
- IAM token auth (`ENVIRONMENT=production`) or `AGENT_SERVICE_API_KEY` otherwise
- Retry with exponential backoff on transient failures

**Note:** `app_config` is never included inline in the callback (`session_state.files` is always empty). The runtime worker pulls the agent's build output directly from the in-process artifact store via `GET /artifacts/{session}` after the run completes, then materializes it to local storage.

### Build-output retrieval (self-host)

The assembled `app_config` is snapshotted into the ADK artifact store on the success path (`agent_api.py:_save_app_config_artifact`) before the session is cleaned up, alongside the component/handler/seed/theme artifacts. The runtime worker fetches all of them via `GET /artifacts/{session}` and writes them to local storage (`materialize-build.ts`). On a later **edit**, the worker ships the prior `app_config` + sources back inline in the `/r` payload (`app_config` + `source_files`), which `source_rehydration_service` loads into the artifact store. There is no external object store.

### ConfigFinalization

**Location:** `app_types/shared/services/config_finalization.py`

Assembles the final app configuration from generated artifacts and applies last-mile transformations before output.

### CrossValidator

**Location:** `app_types/shared/services/cross_validator.py`

Validates cross-cutting concerns across the generated configuration, such as ensuring backend model references in components match actual model definitions and auth-related consistency checks.

---

## Webapp Services

### AssemblyService

**Location:** `app_types/webapp/services/codefocus_assembly_service.py`

Assembles generated components, design system artifacts, and logic/backend configs into the final app configuration structure.

### PostProcessingService

**Location:** `app_types/webapp/services/codefocus_post_processing.py`

Runs post-processing steps on generated app configs after generation — handles image resolution, navigation fixes, and other deterministic transformations specific to the webapp build pipeline.

### Image Resolution Helpers

**Location:** `app_types/webapp/services/codefocus_image_resolver.py`

Resolves image references in generated components against the image catalog, mapping placeholder URLs to actual asset URLs.

### DesignSystemContext

**Location:** `app_types/webapp/services/design_system_context.py`

Provides design system context (theme CSS, Tailwind config) to component builders so generated components align with the app's visual design.

---

## Service Patterns

### Generation-Validation-Repair Loop

The core pattern used by ValidationService:

```
1. Run agent with prompt
2. Parse output as JSON
3. Validate against schema
4. If valid → return result
5. If invalid → create repair prompt with errors
6. Retry (up to MAX_REPAIR_ATTEMPTS)
7. If exhausted → record error, continue pipeline
```

### Deterministic vs. LLM Operations

| Operation | Type | Why |
|-----------|------|-----|
| Logic modification | Deterministic | Dict add/remove/modify |
| Backend modification | Deterministic | Dict add/remove/modify |
| Image resolution | Deterministic | Catalog URL lookup |
| Component generation | LLM | Requires creative generation |
| Theme generation | LLM | Requires design judgment |
| Page planning | LLM | Requires understanding intent |
