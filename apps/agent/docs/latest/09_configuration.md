# Configuration Reference

All configuration is managed through environment variables and Python constants in `config.py`.

---

## Environment Files

| File | Purpose | Committed? |
|------|---------|-----------|
| `env.example` | Template with all variables | Yes |
| `.env` | Base config | No (gitignored) |
| `.env.local` | Local overrides (takes precedence) | No (gitignored) |

Loading order: `.env` first, then `.env.local` overrides.

In the shipped container the agent does not read a `.env` of its own — the
entrypoint exports the environment it needs (LLM provider/key from the
operator's `.env` or the in-app Settings) before starting uvicorn on
`127.0.0.1:${AGENT_PORT:-8081}`.

---

## Agent Model Configuration

Each agent has a default Gemini model that can be overridden via environment variable.

### Defaults (from `config.py`)

```python
# Most agents default to flash-preview (fast, cost-effective).
# One reasoning-heavy seat is promoted to gemini-3.1-pro-preview:
#   - BACKEND_HANDLER_BUILDER_MODEL (handler SQL must reason about ownerScope
#     to avoid emitting `WHERE owner_id = ?` on shared-scope models)
"gemini-3-flash-preview": AppHelpDesk, Creator, Editor, ComponentBuilder,
    ComponentBuilderMultiple, DesignSystemBuilder, LogicBuilder,
    BackendModelBuilder, SeedDataBuilder, BlogPostCreator,
    PreCreator, ResultResponseWriter, Surveyor, DesignImporter
"gemini-3.1-pro-preview": BackendHandlerBuilder
```

> Note: numeric `thinking_budget` is deprecated on Gemini 3.x — use `thinking_level`
> instead, and drop `temperature` (likely no-op on 3.5-flash).

### Override via Environment

```bash
# Override any agent's model
COMPONENT_BUILDER_MODEL="gemini-3-pro-preview"
DESIGN_SYSTEM_BUILDER_MODEL="gemini-3-pro-preview"
```

### Complete Agent Model Env Vars

| Environment Variable | Agent | Default Model |
|---------------------|-------|---------------|
| `APP_HELP_DESK_MODEL` | AppHelpDesk | gemini-3-flash-preview |
| `CREATOR_MODEL` | Creator | gemini-3-flash-preview |
| `EDITOR_MODEL` | Editor | gemini-3-flash-preview |
| `COMPONENT_BUILDER_MODEL` | ComponentBuilder | gemini-3-flash-preview |
| `COMPONENT_BUILDER_MULTIPLE_MODEL` | ComponentBuilderMultiple | gemini-3-flash-preview |
| `DESIGN_SYSTEM_BUILDER_MODEL` | DesignSystemBuilder | gemini-3-flash-preview |
| `LOGIC_BUILDER_MODEL` | LogicBuilder | gemini-3-flash-preview |
| `BACKEND_MODEL_BUILDER_MODEL` | BackendModelBuilder | gemini-3-flash-preview |
| `BACKEND_HANDLER_BUILDER_MODEL` | BackendHandlerBuilder | **gemini-3.1-pro-preview** |
| `SEED_DATA_BUILDER_MODEL` | SeedDataBuilder | gemini-3-flash-preview |
| `BLOG_POST_CREATOR_MODEL` | BlogPostCreator | gemini-3-flash-preview |
| `PRE_CREATOR_MODEL` | PreCreator | gemini-3-flash-preview |
| `DESIGN_IMPORTER_MODEL` | DesignImporter | gemini-3-flash-preview |
| `SURVEYOR_MODEL` | Surveyor | gemini-3-flash-preview |
| `RESULT_RESPONSE_WRITER_MODEL` | ResultResponseWriter | gemini-3-flash-preview |

Legacy env var names from older deploy files are still accepted as compatibility aliases, but startup logs now warn and point to the current key name.

---

## Feature Flags

| Env Var | Default | Description |
|---------|---------|-------------|
| `PARALLEL_PRE_BUILD` | `true` | Run Design System + Logic + Backend builders in parallel via `TimeoutParallelAgent` |
| `PARALLEL_POST_BUILD` | `true` | Run image resolution + backend handler builder concurrently, then seed data sequentially |
| `SURVEYOR_RUNTIME_PROBES_ENABLED` | `false` | Surveyor Phase 2 — adds 5 Class B runtime probe tools (`execute_handler_tool`, `query_db_tool`, `sample_table_tool`, `screenshot_preview_tool`, `read_browser_state_tool`) to the Surveyor's tool list. Read at agent startup; cycling requires a restart so the LlmAgent's tool list and skill prompt stay in lockstep. Requires `PLATFORM_DIAGNOSTIC_SECRET` and the runtime worker's diagnostic.ts route deployed. |

### Surveyor Runtime Probes (Phase 2)

When `SURVEYOR_RUNTIME_PROBES_ENABLED=true`, the agent also reads:

| Env Var | Default | Description |
|---------|---------|-------------|
| `PLATFORM_DIAGNOSTIC_SECRET` | _(unset)_ | Shared secret sent as the `X-Diagnostic-Secret` header on the runtime's `/api/{appId}/_diag/*` endpoints. **The same value must be set on the runtime process** — it reads `process.env.PLATFORM_DIAGNOSTIC_SECRET` (see `apps/runtime/worker/src/server/build-runtime-env.ts`). In the container, export it once in the environment both processes inherit. Rotate periodically. |
| `EXEPAD_RUNTIME_BASE` | `http://localhost:8080` | Runtime base URL for diagnostic probes. Match the port your runtime is on (`8090` under `./run.sh local`). Read at `RuntimeProbeClient` construction (not module import) so per-instance overrides work. |

---

## Performance Tuning

### Validation & Retry Settings

| Constant | Value | Description |
|----------|-------|-------------|
| `MAX_REPAIR_ATTEMPTS` | 6 | Max attempts to repair invalid agent output |
| `MAX_RETRY_ATTEMPTS` | 6 | Max retries for agent execution failures |

### Timing

Progress estimation constants live in
`agents/orchestrator/models/progress_tracker.py` (not `config.py`) and each has
its own env override.

| Constant | Value | Env Var | Description |
|----------|-------|---------|-------------|
| `BASE_PIPELINE_TIME` | 30 seconds | `PROGRESS_BASE_PIPELINE_TIME` | Fixed pipeline overhead |
| `PER_PAGE_BUILDING_TIME` | 40 seconds | `PROGRESS_PER_PAGE_TIME` | Expected time per page |
| `PER_SECTION_BUILDING_TIME` | 8 seconds | `PROGRESS_PER_SECTION_TIME` | Expected time per section |
| `PER_COMPONENT_BUILDING_TIME` | 18 seconds | `PROGRESS_PER_COMPONENT_TIME` | Expected time per Code Focus component |

### Parallel Execution

| Constant | Value | Env Var | Description |
|----------|-------|---------|-------------|
| `COMPONENT_BUILDER_PARALLELISM` | 6 | `COMPONENT_BUILDER_PARALLELISM` | ComponentBuilder pool slot count, clamped to `[1, 10]`. Resolved once at module import (`webapp/subagents/component_builder_pool.py`); `1` reproduces sequential behaviour. |
| `COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM` | 3 | `COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM` | Polish-pool slot count for design imports, clamped to `[1, 5]` |

### Rate Limit Retry (for 429 errors from the LLM provider)

| Constant | Value | Description |
|----------|-------|-------------|
| `RATE_LIMIT_MAX_RETRIES` | 5 | Max retry attempts for 429 errors |
| `RATE_LIMIT_INITIAL_DELAY` | 2.0 seconds | Initial delay before first retry |
| `RATE_LIMIT_MAX_DELAY` | 60.0 seconds | Maximum delay cap |
| `RATE_LIMIT_BACKOFF_MULTIPLIER` | 2.0 | Exponential backoff multiplier |
| `RATE_LIMIT_JITTER` | true | Add random jitter to prevent thundering herd |
| `RATE_LIMIT_BATCH_DELAY` | 1.0 seconds | Delay between batch processing |

### Failed Batch Retry

After all batches complete, failed ones get one additional retry pass.

| Constant | Value | Env Var | Description |
|----------|-------|---------|-------------|
| `RETRY_FAILED_BATCHES_ENABLED` | true | `RETRY_FAILED_BATCHES_ENABLED` | Re-run failed batches after all complete |
| `RETRY_FAILED_BATCHES_DELAY` | 30.0 seconds | `RETRY_FAILED_BATCHES_DELAY` | Delay before retry pass |
| `RETRY_FAILED_BATCHES_INITIAL_DELAY` | 10.0 seconds | `RETRY_FAILED_BATCHES_INITIAL_DELAY` | Initial delay before first failed-batch retry |

### LLM Timeout Settings

| Constant | Value | Env Var | Description |
|----------|-------|---------|-------------|
| `LLM_REQUEST_TIMEOUT_MS` | 300000 (5 min) | `LLM_REQUEST_TIMEOUT_MS` | Per-HTTP-request timeout for `generate_content()` calls (ms) |
| `LLM_AGENT_OPERATION_TIMEOUT` | 480 (8 min) | `LLM_AGENT_OPERATION_TIMEOUT` | Per-agent-operation timeout including all retries (s) |

On the native Gemini path, agents use the `TimedGemini` model adapter (a subclass of `Gemini`) that injects `HttpOptions.timeout` on every request, preventing indefinite hangs from slow 503 responses. On the LiteLLM path the equivalent knobs are `LITELLM_TIMEOUT_SECONDS` (per-operation, via httpx), `LITELLM_CALL_WALL_CLOCK_SECONDS` (total elapsed per non-stream call — the only one that bounds a trickling provider) and `LITELLM_NUM_RETRIES`.

### Parallel Agent Timeouts

| Constant | Default | Env Var | Description |
|----------|---------|---------|-------------|
| `PARALLEL_INITIAL_BUILDERS_TIMEOUT` | 300s (5 min) | `PARALLEL_INITIAL_BUILDERS_TIMEOUT` | Skeleton, theme, logic, backend, example selector |
| `PARALLEL_TSX_BUILDER_TIMEOUT` | 300s (5 min) | `PARALLEL_TSX_BUILDER_TIMEOUT` | TSX code generation phase |
| `PARALLEL_BUILD_PHASE_TIMEOUT` | 600s (10 min) | `PARALLEL_BUILD_PHASE_TIMEOUT` | Full ComponentBuilder + Backend Handler Builder phase |

---

## Content Handling

| Env Var | Default | Description |
|---------|---------|-------------|
| `DOCUMENT_MAX_SIZE_CHARS` | 50000 | Documents larger than this use Vertex AI Search |
| `IMAGE_CATALOG_SUMMARY_LIMIT` | 10 | Max images in planner agent summary |
| `IMAGE_DESCRIPTION_MAX_LENGTH` | 60 | Max chars for image descriptions in summary |
| `DOCUMENT_FETCH_MAX_RETRIES` | 3 | Retries for fetching external documents |
| `DOCUMENT_FETCH_INITIAL_DELAY` | 1.0 | Initial delay for document fetch retry |
| `DOCUMENT_FETCH_BACKOFF_MULTIPLIER` | 2.0 | Backoff multiplier for document fetch |
| `DOCUMENT_FETCH_TIMEOUT` | 30 | Timeout in seconds for document fetch |
| `SKIP_DOCUMENT_FETCH` | false | Skip HTTP fetches (for testing) |

---

## LLM Provider

Self-host accepts any vendor. `EXEPAD_LLM_PROVIDER` picks the path: Gemini and
Vertex use ADK's native Gemini integration, everything else goes through ADK's
`LiteLlm` wrapper.

| Env Var | Default | Description |
|---------|---------|-------------|
| `EXEPAD_LLM_PROVIDER` | `gemini` | `gemini` \| `vertex` \| `anthropic` \| `openai` \| `openrouter` \| `ollama` \| `groq` \| `mistral` \| `deepseek` \| `custom` / `openai-compatible` |
| `EXEPAD_LLM_API_KEY` | (none) | API key for the selected non-Gemini provider. LiteLLM also honors vendor-native vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, …). |
| `EXEPAD_LLM_BASE_URL` | (none) | Endpoint for OpenAI-compatible / self-hosted servers (Ollama, vLLM, LM Studio, a corporate gateway) |
| `EXEPAD_LLM_MODEL_DEFAULT` | (none) | Model used when a non-Gemini provider is selected but an agent still carries a `gemini-*` default. Per-agent `{AGENT}_MODEL` overrides still win; values containing `/` pass through to LiteLLM verbatim. |
| `GEMINI_API_KEY` | (none) | Key for the native Gemini path (read by the ADK/`google-genai` client, not by `config.py`). The container's entrypoint warns at boot if neither this nor `EXEPAD_LLM_API_KEY` is set. |
| `GOOGLE_GENAI_USE_VERTEXAI` | (none) | `True` routes the native path through Vertex AI |
| `OPENROUTER_PRICING_LIVE` | `true` | Price non-Gemini runs from OpenRouter's public model catalog; `false` uses only the built-in static table (no network) |

OpenRouter-only routing knobs: `EXEPAD_LLM_PROVIDER_ORDER` (comma-separated
provider slugs, in order), `EXEPAD_LLM_PROVIDER_SORT` (`price` | `throughput` |
`latency`), `EXEPAD_LLM_PROVIDER_ALLOW_FALLBACKS`.

LiteLLM retry/timeout: `LITELLM_NUM_RETRIES` (2), `LITELLM_TIMEOUT_SECONDS`
(90), `LITELLM_ERROR_FINISH_RETRIES` (2), `LITELLM_ERROR_FINISH_INITIAL_DELAY`
(3.0), `LITELLM_CALL_WALL_CLOCK_SECONDS` (derived: 80% of the tightest parallel
phase budget, i.e. 240 at defaults; `0` disables).

`LITELLM_TIMEOUT_SECONDS` is handed to httpx and is **per-operation**
(connect/read/write/pool), so it cannot bound a provider that trickles bytes — a
slow-but-steady response resets the read clock on every chunk and runs
unbounded. `LITELLM_CALL_WALL_CLOCK_SECONDS` is the **total-elapsed** ceiling for
one non-stream call, shared across all `LITELLM_ERROR_FINISH_RETRIES` re-rolls
(not per attempt, which would multiply it past the phase budgets). On expiry the
call degrades to the empty-provider-error shape rather than raising, so a single
slow route costs one component instead of the whole parallel round. Streaming
calls are not bounded. Raise it only alongside
`PARALLEL_INITIAL_BUILDERS_TIMEOUT` / `PARALLEL_BUILD_PHASE_TIMEOUT` — it must
stay under both or the phase timeout fires first and aborts the round.

---

## Infrastructure

| Env Var | Default | Description |
|---------|---------|-------------|
| `ENVIRONMENT` | `development` | `development`, `production`, `selfhost`, or `test`. The container sets `selfhost`. |
| `AGENT_PORT` | `8081` | Port the container entrypoint binds uvicorn to (`--host 127.0.0.1`, loopback only) |
| `PORT` | `8081` | Port used when running `python agent_api.py` directly. `make run` ignores both and hardcodes 8080. |
| `IS_TEST` | `false` | Enable test mode (in-memory services, skip validation) |
| `SESSION_SERVICE_URI` | _(unset)_ | Optional SQLAlchemy URI for ADK's `DatabaseSessionService`. When unset — including in the shipped container, whose entrypoint never sets it — the agent logs a warning and uses `InMemorySessionService`, so sessions do not survive a restart. |
| `PEXELS_API_KEY` | (none) | Pexels image search API key (free) |
| `PIXABAY_API_KEY` | (none) | Pixabay image search API key (free) |
| `UNSPLASH_API_KEY` | (none) | Unsplash Access Key — search + mandatory download ping; URLs are hotlinked, never rehosted |
| `IMAGE_PROVIDER` | `pexels` | Preferred first stock provider: `pexels`, `pixabay`, or `unsplash`. With no key set, keyless Openverse (CC) → Lorem Picsum fill placeholders. |
| `ALLOWED_IMAGE_DOMAINS` | (none) | Extra image hosts (comma/space separated) the auto-fixer KEEPS instead of stripping |
| `ALLOWED_ORIGINS` | (none) | Additional CORS origins (comma-separated) |
| `RATE_LIMIT_REQUESTS` | 10 | Max requests per rate limit window |
| `RATE_LIMIT_WINDOW` | 60 | Rate limit window in seconds |

Images are always hotlinked from the provider's own CDN — the agent uploads
nothing and needs no object-storage credentials.

---

## Environment Modes

| Mode | Session | Artifacts | Output Files | Logging | Tracing |
|------|---------|-----------|-------------|---------|---------|
| `development` / `selfhost` | In-Memory or DB | In-Memory | Pulled by the runtime worker via `GET /artifacts/{session}` | Local (stdout) | Off |
| `test` | InMemorySessionService | InMemoryArtifactService | Local only (via test export) | Local | Off |

`ENVIRONMENT=production` additionally switches on Google Cloud Logging and IAM
caller verification on `/r`. That path targets a managed GCP deployment and is
**not** what the self-hosted container runs — it sets `selfhost`, which keeps
logging on stdout and skips IAM entirely.

---

## Makefile Targets

| Target | Description |
|--------|-------------|
| `make help` | Show all available targets |
| **Installation** | |
| `make install` | Install all dependencies (production + dev) |
| `make install-dev` | Install dev dependencies only |
| **Code Quality** | |
| `make format` | Auto-format with Black |
| `make format-check` | Check formatting without changes |
| `make lint` | Run Flake8 linting |
| `make lint-all` | Lint all files including tests |
| `make typecheck` | Run MyPy type checking |
| `make static` | Run all static analysis |
| **Testing** | |
| `make test` | Run all tests |
| `make test-unit` | Run unit tests only (fast) |
| `make test-integration` | Run integration tests |
| `make test-cov` | Run tests with coverage report |
| `make test-fast` | Run tests in parallel (requires pytest-xdist) |
| **Evaluation** | |
| `make eval` | Run ROUGE-1 evaluations (fast) |
| `make eval-fast` | Same as `eval` |
| `make eval-rubric` | Run LLM-as-judge rubric evaluations |
| `make eval-all` | Run both ROUGE-1 and rubric evaluations |
| `make eval-routing` | Evaluate routing layer (AppHelpDesk) |
| `make eval-planning` | Evaluate planning layer |
| `make eval-building` | Evaluate building layer |
| `make eval-support` | Evaluate support layer |
| `make eval-cli` | Run evaluations via ADK CLI |
| **Development** | |
| `make run` | Start dev server with auto-reload |
| `make run-prod` | Start production server |
| `make check` | Quick check (format + lint + unit tests) |
| `make precommit` | Full pre-commit (all static + all tests) |
| `make clean` | Remove generated files and caches |
