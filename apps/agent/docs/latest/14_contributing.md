# Contributing Guide

This guide covers code style, quality tools, and how to add new components to the Exepad Agent.

---

## Code Style

### Formatter: Black

```bash
make format          # Auto-format all code
make format-check    # Check without modifying
```

Configuration (`pyproject.toml`):
- Line length: **100**
- Target Python: **3.12**
- String normalization: enabled

### Linter: Flake8

```bash
make lint            # Lint main code
make lint-all        # Lint including tests
```

Configuration (`.flake8`):
- Max line length: 100
- Max complexity: 12
- Ignored: W503, E203, E266, E501
- Per-file ignores for tests, `__init__.py`, and schemas

### Type Checker: MyPy

```bash
make typecheck
```

Configuration (`mypy.ini`):
- Python version: 3.12
- Strict optional: enabled
- Check untyped defs: enabled
- Pydantic plugin: enabled
- Per-module overrides for tests and google packages

---

## Pre-Commit Workflow

### Quick check (during development)

```bash
make check
# Runs: format-check → lint → unit tests
```

### Full pre-commit (before committing)

```bash
make precommit
# Runs: format-check → lint → typecheck → all tests
```

---

## Adding a New Agent

### Step 1: Define the agent

Create a new file in the appropriate subagents directory:

```
main_agent/agents/orchestrator/app_types/shared/subagents/my_agent.py
```

Define the agent using ADK's `LlmAgent`:

```python
from google.adk.agents import LlmAgent
from pydantic import BaseModel, Field
from config import get_agent_model, AgentName


class MyAgentInput(BaseModel):
    """Input schema for MyAgent."""
    task_description: str = Field(description="What to generate")
    context: str = Field(default="", description="Additional context")


class MyAgentOutput(BaseModel):
    """Output schema for MyAgent."""
    result: str = Field(description="Generated result")


def my_agent_instruction_provider(context):
    return """You are an expert at...

    Follow these rules:
    1. ...
    2. ...
    """


my_agent = LlmAgent(
    name=AgentName.MY_AGENT.value,
    model=get_agent_model(AgentName.MY_AGENT),
    instruction=my_agent_instruction_provider,
    input_schema=MyAgentInput,
    output_schema=MyAgentOutput,
)
```

### Step 2: Register in config.py

```python
# Add to AgentName enum
class AgentName(str, Enum):
    # ...existing agents...
    MY_AGENT = "MyAgent"

# Add default model
_AGENT_MODEL_DEFAULTS = {
    # ...existing defaults...
    AgentName.MY_AGENT: "gemini-3-flash-preview",
}

# Add env var mapping
_ENV_KEY_MAP = {
    # ...existing mappings...
    AgentName.MY_AGENT: "MY_AGENT_MODEL",
}
```

### Step 3: Export from subagents

In `subagents/__init__.py`:

```python
from .my_agent import my_agent
```

### Step 4: Wire into the pipeline

Depending on where the agent fits:
- Add to orchestrator constructor if it's a top-level agent
- Add to a workflow if it's part of a workflow step
- Add to a ParallelAgent if it runs in parallel with others

### Step 5: Add evaluation tests

Create test files in `tests/eval/`:

```
tests/eval/layer/my_agent/
├── tests.test.json      # Test cases
└── test_config.json     # Evaluation criteria
```

Create agent wrapper in `tests/eval/agents/my_agent.py`:

```python
from main_agent.agents.orchestrator.app_types.shared.subagents import my_agent
agent = my_agent
```

---

## Adding a New JSON Config Builder (Factory Pattern)

For agents that generate JSON configuration artifacts (like LogicBuilder or BackendModelBuilder), use the `create_json_config_builder()` factory instead of defining an `LlmAgent` from scratch:

### Step 1: Define input schema and instruction provider

```python
# my_builder.py
from pydantic import BaseModel, Field

class MyBuilderInput(BaseModel):
    """Input schema — must have string fields for the ParallelAgent data-sharing pattern."""
    building_plan: str = Field(description="The building plan for this config section")
    app_context: str = Field(default="", description="Additional context")

def my_builder_instruction_provider(context):
    return """You are an expert at generating ...
    Follow these rules: ...
    """
```

### Step 2: Use the factory to create the agent

```python
from .builder_factories import create_json_config_builder
from config import AgentName

my_builder_agent = create_json_config_builder(
    agent_name=AgentName.MY_BUILDER,
    instruction_provider=my_builder_instruction_provider,
    input_schema=MyBuilderInput,
    output_key="my_builder_output_0",
    doc_filenames=["MY_SCHEMA_DOCS.md"],  # loaded from schemas/docs/
)
```

### Step 3: Wire it into the creation flow

If the builder should participate during app creation, register it in the relevant workflow or pre-build helper such as `parallel_pre_build.py` or `creation_workflow.py`.

### Step 4: Register in config.py

Add `AgentName.MY_BUILDER`, default model, and env var mapping.

---

## Adding a New Editing Action Type

The editing workflow supports deterministic action types that modify config without LLM calls. To add a new one:

### Step 1: Add the action to the editor output

Add the action type to the `Editor` output schema and update the prompt to instruct it to produce this action.

### Step 2: Handle in the editing workflow

Add handling logic in `EditingWorkflow` to execute the new action type.

### Step 3: Update session state docs

Add any new state keys to `session-and-state.md`.

---

## Adding a New App Type

The architecture supports multiple app types. To add one:

### Step 1: Create directory structure

```
main_agent/agents/orchestrator/app_types/my_app_type/
├── __init__.py
├── subagents/
│   ├── __init__.py
│   └── my_creator_agent.py
├── workflows/
│   ├── __init__.py
│   ├── creation_workflow.py
│   └── editing_workflow.py
├── services/
│   ├── __init__.py
│   └── my_service.py
└── prompts/
    ├── __init__.py
    └── my_prompts.py
```

### Step 2: Implement base interfaces

```python
from main_agent.agents.orchestrator.app_types.base.base_workflow import BaseWorkflow

class MyCreationWorkflow(BaseWorkflow):
    async def execute(self, ctx, progress_tracker):
        # Your workflow logic
        yield event
```

### Step 3: Register in orchestrator

Update `orchestrator/core.py` to route to your app type based on `app_type` in session state.

---

## Adding a New Service

### Step 1: Create the service

For app-specific services:
```
app_types/shared/services/my_service.py
```

For shared services:
```
orchestrator/services/my_service.py
```

### Step 2: Implement the service

```python
from main_agent.agents.orchestrator.app_types.base.base_service import BaseService

class MyService(BaseService):
    def __init__(self, validation_service, ...):
        super().__init__()
        self._validation = validation_service

    async def do_something(self, ctx, input_data):
        # Service logic
        pass
```

### Step 3: Register in ServiceRegistry

```python
# In service_registry.py
self.my_service = MyService(
    validation_service=self.validation_service,
)
```

---

## Adding a New Workflow

### Step 1: Create the workflow file

```
app_types/shared/workflows/my_workflow.py
```

### Step 2: Implement BaseWorkflow

```python
from main_agent.agents.orchestrator.app_types.base.base_workflow import BaseWorkflow

class MyWorkflow(BaseWorkflow):
    def __init__(self, services, agents):
        self._services = services
        self._agents = agents

    async def execute(self, ctx, progress_tracker):
        # Step 1
        progress_tracker.advance("Planning", weight=1)
        plan = await self._services.validation.run_agent(...)
        yield progress_event

        # Step 2
        progress_tracker.advance("Building", weight=3)
        result = await self._services.builder.build(...)
        yield result_event
```

### Step 3: Wire into orchestrator

Add routing logic in `orchestrator/core.py` to invoke your workflow.

---

## Schema Sync Process

When component schemas change in the platform:

1. Modify schemas in the monorepo's `packages/schemas/`
2. The agent imports directly from `packages/schemas/scripts/py/` (added to `sys.path` at startup)
3. The root `Dockerfile` copies `packages/schemas/scripts/py/` and `packages/schemas/data/` into the image at `/packages/schemas/` and sets `PYTHONPATH` accordingly — no vendoring step

---

## Project Conventions

### File Organization

- **One agent per file** in `subagents/`
- **One service per file** in `services/`
- **Co-locate** subagents with their app type implementation
- **Shared utilities** go in `agents/utils/`
- **Constants** are centralized in `constants.py` — no magic strings

### Naming

- Agent files: `creator.py`, `design_system_builder.py`
- Service files: `validation_service.py`, `document_artifact_service.py`
- Test files: `test_validation.py`, `test_creation_workflow.py`
- Constants: `UPPER_SNAKE_CASE` for module-level, enums for typed constants

### State Management

- All session state values must be JSON-serializable (dict, list, str, int, float, bool, None)
- Use `StateKeys` constants instead of raw strings, reading/writing
  `ctx.session.state` directly
- Push state changes via `push_session_state_update()` helper

### Error Handling

- Use `PipelineError` subclasses with appropriate severity
- Record errors in session state for backend notification
- Fail gracefully — skip steps when possible, preserve session on failure
- Never swallow exceptions silently
