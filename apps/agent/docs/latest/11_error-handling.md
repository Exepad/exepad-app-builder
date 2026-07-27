# Error Handling

The agent app combines deterministic guards, retry logic, validation stages, and session error recording to keep failures observable and bounded.

---

## Main Error Paths

### Pipeline Errors

- **File:** `main_agent/errors.py`
- **Purpose:** Represents workflow-level failures with severity and step context

These are used when a workflow cannot safely continue, for example after unrecoverable build/validation failure.

### Session-Level Agent Errors

Workflows also append structured error entries into `session.state["agent_errors"]` so the backend callback and streamed response can report what went wrong.

Examples include:

- unresolved `@filename` references
- rate-limit exhaustion
- content generation failures
- backend callback failures

## Retry Logic

### Rate Limits and Transient Failures

- **File:** `main_agent/agents/utils/rate_limit_handler.py`

The retry helper wraps agent runs and backs off on:

- `429 RESOURCE_EXHAUSTED`
- transient upstream/network failures
- timeout-like retryable conditions

Important config in `config.py`:

- `RATE_LIMIT_MAX_RETRIES`
- `RATE_LIMIT_INITIAL_DELAY`
- `RATE_LIMIT_MAX_DELAY`
- `RATE_LIMIT_BACKOFF_MULTIPLIER`
- `RATE_LIMIT_JITTER`

## Validation Pipeline

### Component / Handler Validation

- **Directory:** `main_agent/services/validation/`

Key stages include:

1. **Stage 1 — Syntax** validation (esbuild)
2. **Stage 1.5 — tsc** type-check against the per-app generated `app.d.ts`
3. **Stage 2 — Semantic** (AST rules + residual regex + deterministic auto-fix)
4. **Stage 4 — Style coverage** / design-system token checks
5. **Final compile gate** — single Tailwind v4 compile against the final theme +
   every component, runs once at workflow end (no LLM)

**Single-attempt save contract.** Validation runs inline at component save and
ComponentBuilder gets one save per file. Warnings ship with the artifact; errors
abort that component but the rest of the workflow still completes. There is no
LLM "Fixer" agent and no batch re-validation pass — both were removed. When
deterministic fixes are not enough, the component ships as a stub and the user
iterates via the editor flow. `ComponentBuilderMultiple` shares the same
single-attempt contract via its `edit_artifact_tool`, so it cannot sidestep the
gate by issuing many small edits.

Full rule catalog: [validation/rules.md](../validation/rules.md). Severity
allocation policy: [validation/severity-policy.md](../validation/severity-policy.md).
Auto-fixer coverage map: [validation/fixer-audit.md](../validation/fixer-audit.md).

## Component Builder Guardrails

The `ComponentBuilder` has extra protections in its tool callbacks:

- blocks cross-component saves when the model tries to write the wrong component name
- caps repeated save attempts per component
- strips verbose success payloads to reduce AFC-style loops

Relevant code:

- `component_save_guardrail(...)`
- `sanitize_save_response(...)`

Both live in `app_types/webapp/subagents/component_builder.py`.

## Timeout Handling

Parallel orchestration uses explicit timeouts instead of waiting forever:

- `TimeoutParallelAgent` in `agents/utils/timeout_parallel_agent.py`
- `parallel_pre_build.py` applies timeout wrapping to pre-build fanout

Relevant config:

- `LLM_REQUEST_TIMEOUT_MS`
- `PARALLEL_INITIAL_BUILDERS_TIMEOUT`
- `PARALLEL_TSX_BUILDER_TIMEOUT`
- `PARALLEL_BUILD_PHASE_TIMEOUT`

## Content Reference Failures

`DocumentArtifactService` records unresolved user references and large-document fallbacks during content preparation. These do not necessarily abort the run, but they are surfaced through logs and `agent_errors`.

## Failure Reporting

On terminal failure, the service reports a structured `backend_response` payload with:

- overall status
- correlation/session ids
- summarized error message
- collected `agent_errors`

This lets the backend distinguish recoverable guidance from a hard build failure.
