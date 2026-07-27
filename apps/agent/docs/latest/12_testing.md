# Testing Guide

The project has four test suites: unit, integration, end-to-end, and agent evaluation. All tests use pytest with async support via pytest-asyncio.

---

## Test Structure

```
tests/
├── conftest.py                        # Global pytest fixtures
├── unit/                              # Fast, isolated unit tests
│   └── test_*.py
├── integration/                       # Tests requiring service interactions
│   └── test_*.py
├── e2e/                               # End-to-end tests for /r endpoint
│   ├── conftest.py                    # E2E fixtures and payload factories
│   ├── utils/
│   │   └── sse_parser.py             # SSE response parsing utilities
│   ├── fixtures/
│   │   ├── app_configs/              # Sample app configurations
│   │   │   ├── codefocus_webapp.json
│   │   │   ├── minimal_webapp.json
│   │   │   ├── webapp_with_sections.json
│   │   │   └── webapp_multi_page.json
│   │   └── payloads/
│   │       └── README.md
│   ├── test_creation_workflow.py
│   ├── test_editing_workflow.py
│   └── test_help_desk.py
├── eval/                              # ADK agent evaluation tests
│   ├── conftest.py
│   ├── registry.py                    # Eval case registry
│   ├── test_agent_evaluation.py       # Pytest integration
│   ├── agents/                        # Agent wrapper modules
│   │   ├── help_desk.py
│   │   └── response_writer.py
│   ├── benchmarks/                    # Performance benchmark cases
│   ├── building/                      # Deterministic building-layer confidence cases
│   ├── routing/                       # AppHelpDesk evaluations
│   └── support/                       # ResultResponseWriter evaluations
├── confidence/                        # Deterministic PR / nightly confidence gates
├── replay/                            # Sanitized replay corpus for deterministic confidence
└── fixtures/                          # Shared test data
```

---

## Running Tests

### Quick Reference

```bash
make test                    # All tests
make test-unit              # Unit tests only (fast)
make test-integration       # Integration tests
make test-cov               # Tests with coverage report
make test-fast              # Parallel execution (requires pytest-xdist)
make check                  # Format + lint + unit tests
make precommit              # Full pre-commit (all static + all tests)
```

### By Test Type

```bash
pytest tests/unit -v
pytest tests/integration -v -m "integration"
pytest tests/e2e -v -m "e2e"
```

### By Workflow

```bash
pytest tests/e2e/test_creation_workflow.py -v
pytest tests/e2e/test_editing_workflow.py -v
pytest tests/e2e/test_help_desk.py -v
```

### By App Type

```bash
pytest tests/e2e -v -m "websites"
pytest tests/e2e -v -m "forms"
pytest tests/e2e -v -m "dataapps"
pytest tests/e2e -v -m "blogging"
```

### Skip Slow Tests

```bash
pytest tests/e2e -v -m "e2e and not slow"
pytest tests/e2e/test_editing_workflow.py::TestQuickRemove -v
pytest tests/e2e/test_editing_workflow.py::TestQuickModify -v
```

### Coverage

```bash
pytest tests/ --cov=main_agent --cov-report=term-missing
pytest tests/ --cov=main_agent --cov-report=html
# HTML report at htmlcov/index.html
```

Minimum coverage target: **50%** (configured in `.coveragerc`).

---

## Test Markers

| Marker | Description |
|--------|-------------|
| `unit` | Unit tests (fast, no external dependencies) |
| `integration` | Integration tests (may require services) |
| `e2e` | End-to-end tests for /r endpoint |
| `slow` | Slow tests (> 30 seconds, typically creation workflow) |
| `websites` | Website app type tests |
| `forms` | Form app type tests |
| `dataapps` | Data app type tests |
| `blogging` | Blogging workflow tests |
| `eval` | All ADK evaluation tests |
| `eval_fast` | ROUGE-1 word matching (fast, CI/CD friendly) |
| `eval_rubric` | LLM-as-judge rubric evaluation (slower, higher confidence) |
| `eval_routing` | Routing layer (AppHelpDesk) |
| `eval_building` | Building-layer deterministic replay and pipeline confidence tests |
| `eval_support` | Support layer (ResultResponseWriter) |

---

## Writing E2E Tests

### Available Fixtures

| Fixture | Description |
|---------|-------------|
| `e2e_client` | FastAPI TestClient for /r endpoint |
| `unique_session` | Unique user_id/session_id per test |
| `creation_payload_factory` | Factory for create mode payloads |
| `edit_payload_factory` | Factory for edit mode payloads |
| `direct_action_payload_factory` | Factory for direct action payloads |
| `minimal_webapp_config` | Minimal app configuration |
| `webapp_with_sections_config` | App with sections |
| `webapp_with_blog_config` | App with blog enabled |
| `webapp_with_blog_posts_config` | App with blog posts |
| `webapp_multi_page_config` | Multi-page app |
| `get_component_uuid` | Helper to find component UUIDs |
| `get_page_uuid` | Helper to find page UUIDs |

### Example E2E Test

```python
def test_quick_modify(e2e_client, edit_payload_factory, minimal_webapp_config):
    """Test quick modification of a component."""
    payload = edit_payload_factory(
        app_config=minimal_webapp_config,
        prompt="Add a hero section with a call-to-action",
    )

    response = e2e_client.post("/r", json=payload)
    assert response.status_code == 200
```

### Parsing SSE Responses

```python
from tests.e2e.utils import parse_sse_response, get_chat_response

def test_with_sse_parsing(e2e_client, edit_payload_factory, minimal_webapp_config):
    payload = edit_payload_factory(...)
    response = e2e_client.post("/r", json=payload)

    events = parse_sse_response(response.content)
    chat_response = get_chat_response(events)
    assert chat_response is not None
```

---

## ADK Agent Evaluation

Agent evaluation tests isolated LLM agents using Google ADK's evaluation framework.
The active ADK eval wrappers cover:

- `AppHelpDeskAgent`
- `ResultResponseWriter`

Building-layer confidence comes from deterministic replay and pipeline tests, not ADK eval wrappers.

### Two Evaluation Modes

| Mode | Marker | Method | Speed | Use Case |
|------|--------|--------|-------|----------|
| **ROUGE-1** | `eval_fast` | Unigram word overlap | Fast | CI/CD, regression |
| **Rubric** | `eval_rubric` | LLM-as-judge semantic eval | Slow | Quality gates |

### Running Evaluations

```bash
make eval                    # Fast ROUGE-1 (default)
make eval-fast              # Same as above
make eval-rubric            # LLM-as-judge rubric
make eval-all               # Both modes
make eval-routing           # Routing layer only (AppHelpDesk)
make eval-building          # Building-layer deterministic replays and pipeline cases
make eval-support           # Support layer only (ResultResponseWriter)
make test-validation-confidence  # Deterministic PR confidence gate
make test-replay-smoke          # Replay smoke subset
make test-replay-all            # Full deterministic replay corpus

# Specific agent
pytest tests/eval -v -k "help_desk"
pytest tests/eval -v -k "response_writer"
```

### How Evaluation Works

```
1. Input: Test case provides user_content (JSON input)
2. Execution: ADK runs the agent with the input
3. Comparison: Actual output compared to expected final_response
4. Scoring: ROUGE-1 calculates unigram overlap
```

### Evaluation Thresholds

| Agent | ROUGE-1 Threshold | Confidence | What It Tests |
|-------|-------------------|------------|---------------|
| AppHelpDesk | 0.45 | Medium | Routing decisions |
| ResponseWriter | 0.2 | Low | Response generation |

### Rubric Evaluation

Rubric evaluations use an LLM judge to assess semantic correctness:

| Agent | Rubrics | Key Checks |
|-------|---------|------------|
| AppHelpDesk | 5 | Branch correctness, sub-action, config scope, language, reasoning |
| ResponseWriter | 3 | Response length, language match, format compliance |

### Adding New Evaluation Tests

1. **Create agent wrapper** in `tests/eval/agents/`:
   ```python
   # tests/eval/agents/my_agent.py
   from main_agent.path.to.my_agent import my_agent
   agent = my_agent  # ADK expects 'agent' variable
   ```

2. **Create test directory and files:**
   ```
   tests/eval/layer/my_agent/
   ├── tests.test.json    # Test cases (ADK EvalSet schema)
   └── test_config.json   # Evaluation criteria
   ```

3. **Register in test runner** (`tests/eval/test_agent_evaluation.py`)

---

## CI

The repository ships two GitHub Actions workflows — `.github/workflows/packaging-ci.yml`
and `.github/workflows/release.yml` — and **neither runs the agent's pytest suites**.
`packaging-ci.yml` has an `agent-deps` job that sets up Python 3.12 and checks that
`requirements.lock` resolves; the rest of its jobs cover the CLI, installers, MSI,
deploy templates, and version lockstep.

Agent test runs are therefore local (or manual): use `make check` before a commit and
`make precommit` before a PR.

---

## Troubleshooting

### Session state is not persisted between runs

Tests always use `InMemorySessionService` — `IS_TEST=true` forces it regardless of
`SESSION_SERVICE_URI`. Nothing is written to disk, and session state does not survive
the process. Set `SESSION_SERVICE_URI` in `.env.local` if you want a persistent
session DB for a *non-test* local run.

### Slow tests

Creation workflow tests take 30-120 seconds each (they invoke LLM agents). Skip with:
```bash
pytest tests/e2e -v -m "e2e and not slow"
```

### SSE parsing issues

If SSE events aren't parsing:
1. Check response content type is `text/event-stream`
2. Verify events follow format: `data: {...}\n\n`
3. Use `extract_progress_messages()` to debug event flow

### Evaluation tests fail with low scores (< 0.1)

- Verify agent wrapper exposes `agent` variable (not `root_agent`)
- Check test input format matches agent's expected input schema
- Consider lowering the threshold or switching to rubric evaluation
