# Session & State Management

Exepad Agent uses Google ADK's session system for state management and artifact storage. All state is JSON-serializable and persisted as events.

---

## Session Lifecycle

```
1. Request arrives at POST /r
2. Get or create session (session_service.get_session / create_session)
3. Push initial state delta as Event
4. Workflow runs, agents read/write session.state
5. On success: delete session (cleanup)
6. On failure: preserve session for retry/debugging
```

### Session Identity

Each session is identified by:
- **`app_name`** — Always `"orchestrator"`
- **`user_id`** — The user making the request
- **`session_id`** — Unique per request (UUID recommended)

## Session Services

| Service | When | Description |
|---------|------|-------------|
| `InMemorySessionService` | `IS_TEST=true`, **or** `SESSION_SERVICE_URI` unset | Fast, no persistence. Data lost on restart. |
| `DatabaseSessionService` | `SESSION_SERVICE_URI` set (and not test mode) | Any SQLAlchemy URI, e.g. `sqlite+aiosqlite:///./agent_data.db`. Persistent across restarts. |

Service selection depends only on `IS_TEST` and `SESSION_SERVICE_URI`
(`agent_api.py:get_session_service`) — `ENVIRONMENT` plays no part:

```python
# Test mode → always in-memory
if IS_TEST:
    service = InMemorySessionService()

# Any environment, DB URI set → database
elif SESSION_SERVICE_URI:
    service = DatabaseSessionService(db_url=SESSION_SERVICE_URI)

# Otherwise → in-memory (logs a warning at startup)
else:
    service = InMemorySessionService()
```

**The shipped container never sets `SESSION_SERVICE_URI`** — not in the root
`Dockerfile`, not in `docker/entrypoint.sh`, not in any compose file. Container
agent sessions are therefore **in-memory and do not survive a restart**, and
nothing about them is written to the `/data` volume. A build's real output is not
at risk: the runtime worker pulls the artifacts over `GET /artifacts/{session}`
while the run is still live and materializes them to local storage.

Services are lazily initialized to avoid async initialization issues during module import.

---

## Session State

All agent communication happens through `ctx.session.state`, a JSON-serializable
dict. Code reads and writes it directly, always keying off the `StateKeys`
constants rather than raw strings:

```python
from main_agent.constants import StateKeys

config = ctx.session.state.get(StateKeys.APP_CONFIG)
ctx.session.state[StateKeys.APP_CONFIG] = new_config
```

> A typed `SessionState` accessor class used to live at
> `main_agent/session_state.py`. It was never adopted — nothing imported it —
> and was removed. Use `StateKeys` with the dict directly.

### StateKeys Reference

All keys are defined as constants in `main_agent/constants.py`:

#### App Configuration

| Key | Type | Description |
|-----|------|-------------|
| `app_config` | dict \| None | Main application JSON configuration |
| `app_config_editor_processing` | dict \| str \| None | Intermediate config during editing |
| `app_config_generated` | dict \| None | Config after generation, before post-processing |
| `app_config_intermediate` | dict \| None | Intermediate config state |
| `app_config_post_processed` | dict \| str \| None | Config after post-processing |
| `initial_app_config_for_comparison` | str \| None | Snapshot of config before edits |

#### App Identity

| Key | Type | Description |
|-----|------|-------------|
| `app_uuid` | str | Application UUID |
| `app_name` | str | Application name |
| `app_type` | str | Application type (website, landing page, etc.) |
| `app_language_code` | str | Target language (ISO 639-1) |
| `app_design_style` | str | Visual design approach |
| `app_color_palette` | str | Color scheme |
| `app_building_plan` | str | Overall building plan from Creator |
| `app_navigation_building_plan` | str | Navigation structure plan |
| `app_pages_building_plan_list` | str | Per-page building plans |
| `project_name` | str | Project name |
| `initial_description` | str | User's original description |

#### Core Control

| Key | Type | Description |
|-----|------|-------------|
| `operation_mode` | str | `create` \| `edit` — the only two values `core.py` routes; anything else errors out |
| `action_label` | str \| None | Direct action identifier (bypasses help desk) |
| `action_payload` | str \| None | Data for direct actions |
| `workflow_type` | str \| None | Internal workflow type |
| `current_prompt` | str \| None | Current prompt for agent |
| `user_prompt` | str | User's natural language request |
| `correlation_id` | str | Request idempotency key |
| `is_test` | bool | Whether running in test mode |
| `is_app_created` | bool | Whether this is an existing app |
| `is_first_app_creation` | bool | Whether this is the first creation |

#### Current Context

| Key | Type | Description |
|-----|------|-------------|
| `current_page_uuid` | str \| None | UUID of the page being viewed |
| `current_page_type` | str \| None | Type of the current page |
| `selected_component` | str \| None | UUID of selected component |
| `selected_component_config` | str \| None | JSON config of selected component |
| `selected_component_location` | str \| None | Location path of selected component |

#### Agent Outputs

| Key | Type | Description |
|-----|------|-------------|
| `app_help_desk_output` | dict | Routing decision from AppHelpDesk |
| `result_chat_response` | dict \| str \| None | Final response for user |
| `result_response_writer_prompt` | str | Prompt for ResultResponseWriter |
| `last_prompt_to_agent` | str \| None | Last prompt sent to an agent |

#### Flags & Control

| Key | Type | Description |
|-----|------|-------------|
| `save_app_config` | bool | Flag to save config to backend |
| `reload_app` | bool | Flag to trigger frontend reload |
| `goto_page_slug` | str \| None | Navigate to this page after operation |
| `changed_component_uuid` | str \| None | UUID of changed component |
| `change_type` | str \| None | Type of change made |
| `changed_page_uuid` | str \| None | UUID of changed page |

#### Page Operations

| Key | Type | Description |
|-----|------|-------------|
| `pages_to_add` | list | Pages to add in editing workflow |
| `pages_to_update` | list | Pages to update |
| `pages_to_delete` | list | Pages to remove |
| `app_new_page_stub_final` | dict \| None | Finalized new page stub for assembly |
| `page_artifacts_generated` | bool | Whether page artifacts are ready |

#### Editing Actions (8-action surface)

| Key | Type | Description |
|-----|------|-------------|
| `modify_styles_actions` | list | Whole-theme rewrites (DesignSystemBuilder) |
| `change_backend_models_actions` | list | Add/remove/modify backend models (deterministic) |
| `modify_logic_actions` | list | Add/remove/modify state keys (deterministic) |
| `add_handler_actions` | list | Backend handler creation (BackendHandlerBuilder) |
| `modify_handler_actions` | list | Backend handler edits (BackendHandlerBuilder) |
| `remove_handler_actions` | list | Backend handler removal (deterministic) |
| `rename_page_title_actions` | list | Title-only page rename (deterministic; slug renames go through `frontend_build_actions`) |
| `frontend_build_actions` | list | All cross-file frontend refactor work — routed to ComponentBuilderMultiple. Each action carries a natural-language `prompt` plus optional `page_creates` / `page_removes` / `page_slug_renames` registry side-effects. |

#### Builder Inputs

| Key | Type | Description |
|-----|------|-------------|
| `_backend_build_model_input` | str (JSON) | Internal BackendModelBuilder payload used during backend generation |
| `_adk_activated_skill_<agent_name>` | list[str] | ADK SkillToolset bookkeeping — skills the agent has loaded so far in this session. Auto-populated by `load_skill`. |

#### Assets & Content

| Key | Type | Description |
|-----|------|-------------|
| `image_catalog` | list | User's available images |
| `document_catalog` | list | User's available documents |
| `assets_dir` | str \| None | Assets directory path |
| `app_config_path` | str \| None | App config file path |

#### Chat & Messages

| Key | Type | Description |
|-----|------|-------------|
| `chat_history` | list | Conversation history |
| `chat_response` | str \| None | Chat response text |
| `conversation_message_summary` | str \| None | Summarized conversation context |
| `user_language_code` | str \| None | Detected user language (ISO 639-1) |

#### Seed Data

| Key | Type | Description |
|-----|------|-------------|
| `seed_data_metadata` | dict \| None | Metadata from SeedDataBuilder (dataset names, record counts) |

#### Progress & Metrics

| Key | Type | Description |
|-----|------|-------------|
| `progress_number` | int | Current progress (0-100) |
| `total_time_to_complete` | int | Estimated total time in seconds |
| `workflow_start_time` | float | Unix timestamp of workflow start |
| `workflow_start_iso` | str | ISO timestamp of workflow start |
| `agent_metrics` | dict | Per-agent metrics (tokens, timing) |
| `agent_timings` | dict | Per-agent timing data |
| `current_agent` | str | Name of currently running agent |
| `current_agent_start_time` | float | Unix timestamp of current agent start |
| `current_agent_metrics` | dict | Metrics for currently running agent |
| `current_agent_tokens` | dict | Token counts for currently running agent |

#### Errors & Internal

| Key | Type | Description |
|-----|------|-------------|
| `agent_errors` | list | List of agent error records |
| `_backend_save_result` | dict \| None | Result of backend save operation (internal) |

---

## Event System

State changes propagate through ADK Events:

```python
from google.adk.events import Event, EventActions

# Push state update
event = Event(
    author="AgentName",
    actions=EventActions(state_delta={"progress_number": 50}),
    timestamp=time.time(),
)
await session_service.append_event(session, event)
```

The `push_session_state_update()` helper in `agents/utils/helpers.py` simplifies this:

```python
await push_session_state_update(ctx, {"progress_number": 50})
```

---

## Artifact System

Artifacts are named files stored alongside sessions. They hold generated outputs that are too large or structured for session state.

### Artifact Services

| Service | Environment | Description |
|---------|-------------|-------------|
| `InMemoryArtifactService` | All | Stored in process memory; pulled by the runtime worker via `GET /artifacts/{session}` after the build |

### Artifact Naming Conventions

Artifact names follow the patterns below (they are written as literals at the
call sites; the unused `ArtifactNames` helper class was removed). Active builds are
Code Focus — the legacy JSON scaffold artifacts (`skeleton.json`, `theme.json`,
`page:{slug}.json`, `section_{n}.json`, `tsx_component:{name}.tsx`) were removed
in April 2026 and no longer appear in new builds:

| Artifact | Name Pattern | Content |
|----------|-------------|---------|
| Theme CSS | `codefocus_style:theme.css` | M3-pillar theme tokens (compiled per-app) |
| Tailwind config | `codefocus_style:tailwind.config.js` | Per-app Tailwind config |
| TSX entry | `codefocus_component:{Name}.tsx` | Entry component for a page / chrome region |
| TSX module | `codefocus_module:{Name}.tsx` | Supporting module imported by an entry |
| Logic | `logic.json` | Frontend shared state (`frontend.logic.state` only) |
| Backend | `backend.json` | Models and handlers config |
| Handler code | `handler_code:{name}.tsx` | Backend handler TSX |
| Seed | `seed:{dataset}.csv` | Sample dataset |
| Content | `content:{page}:{component}.md` | Markdown content |

### ArtifactManager

The `ArtifactManager` (`agents/utils/artifact_manager.py`) provides helper functions:

```python
# Load artifact as parsed dict
config = await load_artifact_as_dict(ctx, "backend.json")

# Load artifact as raw string
code = await load_artifact_as_string(ctx, "codefocus_component:Hero.tsx")
```

### Artifact Flow Through Pipeline

```
Step 1: Design system generation
    DesignSystemBuilder → codefocus_style:theme.css, codefocus_style:tailwind.config.js

Step 2: Backend artifact builders (if backend_needed)
    LogicBuilder → logic.json
    BackendModelBuilder / BackendBuilder → backend.json

Step 3: Component builders generate TSX artifacts
    ComponentBuilder → codefocus_component:{Name}.tsx
                       codefocus_module:{Name}.tsx (supporting modules)

Step 4: Backend handler building (if backend_needed)
    BackendHandlerBuilder → handler_code:{name}.tsx

Step 5: Seed data (if backend_needed)
    SeedDataBuilder → seed:{name}.csv

Step 6: Inline validation runs at each save (esbuild → tsc → AST + auto-fix
    → style coverage); single-attempt save contract.

Step 7: Assembly reads all artifacts
    Merges into final app_config

Step 8: Final Tailwind compile gate runs once (no LLM), then PostProcessing /
    CrossValidator finalize the config.
```
