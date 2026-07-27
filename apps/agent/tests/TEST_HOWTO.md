# Test Guide

## Setup

```bash
# Install dev dependencies
pip install -r requirements-dev.txt
```

## Code Quality

```bash
# Format code
black tests/ main_agent/ agent_api.py config.py

# Lint code  
flake8 tests/
```

## Running Tests

### Run All Tests

```bash
pytest tests/ -v
```

### Run by Test Type

```bash
# Unit tests only (fast, isolated)
pytest tests/unit -v

# Integration tests (may require services)
pytest tests/integration -v -m "integration"

# E2E tests for /r endpoint
pytest tests/e2e -v -m "e2e"
```

### Run E2E Tests by Workflow

```bash
# Creation workflow tests (slow - creates new apps)
pytest tests/e2e/test_creation_workflow.py -v

# Editing workflow tests
pytest tests/e2e/test_editing_workflow.py -v

# Blogging workflow tests
pytest tests/e2e/test_blogging_workflow.py -v

# Direct actions tests
pytest tests/e2e/test_direct_actions.py -v

# Help desk tests
pytest tests/e2e/test_help_desk.py -v
```

### Run E2E Tests by App Type

```bash
# Website creation tests
pytest tests/e2e -v -m "websites"

# Form creation tests
pytest tests/e2e -v -m "forms"

# Data app creation tests
pytest tests/e2e -v -m "dataapps"

# Blogging workflow tests
pytest tests/e2e -v -m "blogging"
```

### Run Fast Tests Only

```bash
# Skip slow tests (creation workflow is slow)
pytest tests/e2e -v -m "e2e and not slow"

# Run only quick action tests
pytest tests/e2e/test_editing_workflow.py::TestQuickRemove -v
pytest tests/e2e/test_editing_workflow.py::TestQuickModify -v
```

### Run with Coverage

```bash
# Full coverage report
pytest tests/ --cov=main_agent --cov-report=term-missing

# E2E coverage only
pytest tests/e2e --cov=main_agent --cov-report=term-missing
```

### Run with Parallel Execution

```bash
# Requires pytest-xdist
pip install pytest-xdist

# Run with auto-detected parallelism
pytest tests/e2e -v -n auto

# Run with specific number of workers
pytest tests/e2e -v -n 4
```

## Test Markers

| Marker | Description |
|--------|-------------|
| `unit` | Unit tests (fast, no external dependencies) |
| `integration` | Integration tests (may require services) |
| `e2e` | End-to-end tests for /r endpoint |
| `slow` | Slow running tests (> 30s) |
| `websites` | Website app type tests |
| `forms` | Form app type tests |
| `dataapps` | Data app type tests |
| `blogging` | Blogging workflow tests |

## E2E Test Structure

```
tests/e2e/
├── __init__.py
├── conftest.py                    # E2E fixtures and payload factories
├── utils/
│   ├── __init__.py
│   └── sse_parser.py              # SSE response parsing utilities
├── fixtures/
│   ├── __init__.py
│   ├── app_configs/               # Sample app configurations
│   │   ├── minimal_webapp.json
│   │   ├── webapp_with_blog.json
│   │   ├── webapp_with_sections.json
│   │   └── webapp_multi_page.json
│   └── payloads/
│       └── README.md              # Payload structure documentation
├── test_creation_workflow.py      # App creation tests
├── test_editing_workflow.py       # App editing tests
├── test_blogging_workflow.py      # Blogging tests
├── test_direct_actions.py         # Direct action tests
└── test_help_desk.py              # Help desk tests
```

## Writing E2E Tests

### Using Fixtures

```python
def test_example(e2e_client, edit_payload_factory, minimal_webapp_config):
    """Example E2E test."""
    payload = edit_payload_factory(
        app_config=minimal_webapp_config,
        prompt="Add a hero section",
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

### Available Fixtures

- `e2e_client`: FastAPI TestClient for /r endpoint
- `unique_session`: Unique user_id/session_id per test
- `creation_payload_factory`: Factory for create mode payloads
- `edit_payload_factory`: Factory for edit mode payloads
- `direct_action_payload_factory`: Factory for direct action payloads
- `minimal_webapp_config`: Minimal app config fixture
- `webapp_with_sections_config`: App with sections
- `webapp_with_blog_config`: App with blog enabled
- `webapp_with_blog_posts_config`: App with blog posts
- `webapp_multi_page_config`: Multi-page app
- `get_component_uuid`: Helper to find component UUIDs
- `get_page_uuid`: Helper to find page UUIDs

## Troubleshooting

### Tests Skip Due to Missing Database

E2E tests require database connection. If tests skip:

1. Ensure `SESSION_SERVICE_URI` is set in `.env.local`
2. Or use in-memory session service for testing

### Slow Tests

Creation workflow tests are slow (30-120s each). Use markers to skip:

```bash
pytest tests/e2e -v -m "e2e and not slow"
```

### SSE Parsing Issues

If SSE events aren't parsing correctly:

1. Check response content type is `text/event-stream`
2. Verify events follow SSE format: `data: {...}\n\n`
3. Use `extract_progress_messages()` to debug event flow

## ADK Agent Evaluation

The project includes Google ADK evaluation tests for the isolated routing and support wrappers:

- `AppHelpDeskAgent`
- `ResultResponseWriter`

Building-layer confidence comes from deterministic replay and pipeline tests, not ADK eval wrappers.

### Prerequisites

```bash
# Install ADK with evaluation support
pip install "google-adk[eval]"
```

The deterministic confidence stack is split across:

- `tests/unit/` for validator contracts
- `tests/replay/` for sanitized production-shaped regressions
- `tests/eval/` for isolated ADK evals of routing/support behavior

### Running Evaluation Tests

Two evaluation modes are available:
- **eval_fast**: ROUGE-1 word matching (fast, CI/CD friendly)
- **eval_rubric**: LLM-as-judge semantic evaluation (slower, higher confidence)

```bash
# Run fast ROUGE-1 evaluations (default, CI/CD friendly)
make eval
make eval-fast
pytest tests/eval -v -m "eval_fast"

# Run rubric-based LLM evaluations (higher confidence)
make eval-rubric
pytest tests/eval -v -m "eval_rubric"

# Run both evaluation modes
make eval-all
pytest tests/eval -v -m "eval_fast or eval_rubric"

# Run by layer
make eval-routing    # AppHelpDeskAgent
make eval-planning   # AppCreator, AppEditor, AppBlogger
make eval-building   # Deterministic building replays and pipeline cases
make eval-support    # ImageFinder, ExampleSelector, ResponseWriter
make test-validation-confidence  # Deterministic PR confidence gate
make test-replay-smoke           # Replay smoke subset
make test-replay-all             # Full deterministic replay corpus

# Run specific agent evaluation
pytest tests/eval -v -k "help_desk"
pytest tests/eval -v -k "response_writer"
```

### Evaluation Test Markers

| Marker | Description |
|--------|-------------|
| `eval` | All ADK evaluation tests |
| `eval_fast` | Fast ROUGE-1 evaluation tests (CI/CD friendly) |
| `eval_rubric` | LLM-as-judge rubric evaluation tests (slower, higher confidence) |
| `eval_routing` | Routing layer (AppHelpDeskAgent) |
| `eval_planning` | Planning layer (AppCreator, AppEditor, AppBlogger) |
| `eval_building` | Building-layer deterministic replay and pipeline confidence tests |
| `eval_support` | Support layer (ImageFinder, ExampleSelector, ResponseWriter) |
| `replay` | Sanitized deterministic replay corpus |
| `confidence_pr` | Fast replay/validator subset for PR gating |
| `nightly` | Extended replay coverage for scheduled runs |

### Evaluation Test Structure

```
tests/eval/
├── __init__.py
├── conftest.py                        # Shared eval fixtures
├── test_agent_evaluation.py           # Pytest integration
│
├── agents/                            # Agent wrapper modules (expose individual agents)
│   ├── __init__.py
│   ├── help_desk.py                   # agent = app_help_desk_agent
│   └── response_writer.py             # agent = result_response_writer_agent
│
├── routing/
│   ├── help_desk/                     # Fast ROUGE-1 tests (eval_fast)
│   │   ├── routing.test.json          # Test cases
│   │   └── test_config.json           # ROUGE-1 criteria
│   └── help_desk_rubric/              # Rubric tests (eval_rubric)
│       ├── routing.test.json -> ../help_desk/routing.test.json  # Symlink
│       └── test_config.json           # LLM-judge rubric criteria
│
└── support/
    ├── response_writer/
    └── response_writer_rubric/
```

Building-layer confidence lives in `tests/replay/` and validator contract tests rather than in ADK eval wrappers.

### How Evaluation Works

1. **Input**: Test case provides `user_content` (JSON input to agent)
2. **Execution**: ADK runs the agent with the input
3. **Comparison**: Agent's actual output is compared to `final_response`
4. **Scoring**: ROUGE-1 calculates unigram overlap between expected and actual

```
Expected: {"branch_label": "edit", "sub_action": "quick_modify", ...}
Actual:   {"branch_label": "edit", "sub_action": "quick_modify", ...}
                              ↓
          Score = common_words / total_words_in_expected
```

### Evaluation Criteria & Confidence Levels

The `response_match_score` uses ROUGE-1 (unigram overlap). Lower thresholds are used because LLMs produce semantically correct but differently worded responses.

| Agent | Threshold | Confidence | What It Tests |
|-------|-----------|------------|---------------|
| AppHelpDeskAgent | 0.45 | Medium | Routing decisions (branch, sub_action) |
| ResponseWriter | 0.2 | Low | Response generation |

**Confidence Level Meaning:**

| Threshold Range | Confidence | Interpretation |
|-----------------|------------|----------------|
| 0.8+ | High | Near-exact match required |
| 0.5-0.8 | Medium | Correct structure, flexible wording |
| 0.3-0.5 | Low-Medium | Basic correctness check |
| < 0.3 | Low | Sanity check only (agent runs, produces output) |

**Current tests provide baseline regression safety**, catching:
- Agent crashes
- Completely wrong routing (edit vs blogging vs help_desk)
- Invalid output structure

**Not well tested:**
- Semantic correctness of reasoning
- Edge cases and ambiguous inputs
- Multi-language handling

### Rubric-Based Evaluation (eval_rubric)

For production quality gates, **rubric-based evaluation** is available using LLM-as-judge.
Each agent has a `rubric_config.json` with semantic rubrics that evaluate:

| Agent | Rubrics | What They Check |
|-------|---------|-----------------|
| AppHelpDeskAgent | 5 | Branch correctness, sub-action, config scope, language match, reasoning |
| ResponseWriter | 3 | Response length, language match, format compliance |

Example rubric config (`rubric_config.json`):

```json
{
  "criteria": {
    "rubric_based_final_response_quality_v1": {
      "threshold": 0.8,
      "judge_model_options": {
        "judge_model": "gemini-2.0-flash",
        "num_samples": 3
      },
      "rubrics": [
        {
          "rubric_id": "correct_branch",
          "rubric_content": {
            "text_property": "The branch_label correctly matches the user's intent: 'edit' for modifications, 'blogging' for blog operations, 'help_desk' for questions"
          }
        }
      ]
    }
  }
}
```

Run rubric evaluations:
```bash
make eval-rubric
pytest tests/eval -v -m "eval_rubric"
```

### Adding New Evaluation Tests

1. **Create agent wrapper** in `tests/eval/agents/`:
   ```python
   # tests/eval/agents/my_agent.py
   from main_agent.path.to.my_agent import my_agent
   agent = my_agent  # ADK expects 'agent' variable
   ```

2. **Create test directory** and files:
   ```
   tests/eval/layer/my_agent/
   ├── tests.test.json    # Test cases
   └── test_config.json   # Evaluation criteria
   ```

3. **Add test case** following ADK EvalSet schema:
   ```json
   {
     "eval_set_id": "my_agent_tests",
     "name": "My Agent Evaluation",
     "eval_cases": [
       {
         "eval_id": "test_case_1",
         "conversation": [
           {
             "invocation_id": "inv-001",
             "user_content": {
               "parts": [{"text": "{\"field\": \"value\"}"}],
               "role": "user"
             },
             "final_response": {
               "parts": [{"text": "{\"output\": \"expected\"}"}],
               "role": "model"
             },
             "intermediate_data": {"tool_uses": [], "intermediate_responses": []}
           }
         ],
         "session_input": {"app_name": "orchestrator", "user_id": "test", "state": {}}
       }
     ]
   }
   ```

4. **Register in test runner** (`tests/eval/test_agent_evaluation.py`):
   ```python
   AGENT_EVAL_CONFIGS = [
       # ...existing configs...
       ("layer/my_agent", "tests.eval.agents.my_agent", "Layer: MyAgent", "eval_layer"),
   ]
   ```

### Evaluation vs E2E Tests

| Aspect | Evaluation Tests | E2E Tests |
|--------|------------------|-----------|
| **Scope** | Individual agents in isolation | Full orchestrator workflow |
| **Speed** | ~60-120s per agent | ~30-120s per test |
| **Dependencies** | LLM API only | LLM API + Database + Server |
| **Output** | Agent JSON response | SSE events + final app_config |
| **Focus** | Agent decision quality | System integration |
| **Use Case** | Regression, agent tuning | Integration, deployment validation |

### Troubleshooting

**ModuleNotFoundError: Eval module not installed**
```bash
pip install "google-adk[eval]"
```

**Tests fail with very low scores (< 0.1)**
- Check that agent wrapper module exposes `agent` (not `root_agent`)
- Verify test input format matches agent's expected input schema
- Lower the threshold or switch to rubric-based evaluation

**Tests take too long**
- Each agent evaluation runs the full agent with LLM calls
- Run specific agent: `pytest tests/eval -v -k "help_desk"`
- Use parallel execution: `pytest tests/eval -v -n 4` (requires pytest-xdist)
