"""ADK Evaluation test runner for Exepad Agent subagents (shared wrappers).

This module provides pytest integration for running Google ADK evaluations
on agent test files. Remaining eval wrappers (declarative-only webapp agents removed):

- Routing: AppHelpDeskAgent
- Building: TsxComponentBuilderAgent
- Support: ResultResponseWriterAgent

Each agent is tested in isolation using wrapper modules that expose the
individual agent as `agent` for ADK evaluation.

Two evaluation modes are available:
- eval_fast: ROUGE-1 word matching (fast, CI/CD friendly)
- eval_rubric: LLM-as-judge semantic evaluation (slower, higher confidence)

Usage:
    # Run fast ROUGE-1 evaluations
    pytest tests/eval -v -m "eval_fast"
    make eval-fast

    # Run rubric-based LLM evaluations
    pytest tests/eval -v -m "eval_rubric"
    make eval-rubric

    # Run all evaluations
    pytest tests/eval -v -m "eval_fast or eval_rubric"
    make eval-all

    # Run specific agent
    pytest tests/eval -v -k "help_desk"
"""

import pytest
from pathlib import Path

from .registry import AGENT_EVAL_CONFIGS_FAST, AGENT_EVAL_CONFIGS_RUBRIC

# Import ADK evaluation module
try:
    from google.adk.evaluation.agent_evaluator import AgentEvaluator

    ADK_EVAL_AVAILABLE = True
except ImportError:
    ADK_EVAL_AVAILABLE = False
    AgentEvaluator = None

# Base directory for eval test files
EVAL_DIR = Path(__file__).parent


def check_eval_dir_exists(eval_path: str) -> bool:
    """Check if evaluation directory and test files exist."""
    full_path = EVAL_DIR / eval_path
    if not full_path.exists():
        return False

    # Check for test files and config
    test_files = list(full_path.glob("*.test.json"))
    config_file = full_path / "test_config.json"
    return len(test_files) > 0 and config_file.exists()


# =============================================================================
# Fast ROUGE-1 Evaluation Tests (eval_fast marker)
# =============================================================================


@pytest.mark.eval
@pytest.mark.eval_fast
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "eval_path,agent_module,description,layer_marker",
    AGENT_EVAL_CONFIGS_FAST,
    ids=[f"fast:{config[2]}" for config in AGENT_EVAL_CONFIGS_FAST],
)
async def test_agent_evaluation_fast(
    eval_path: str, agent_module: str, description: str, layer_marker: str
):
    """Run fast ROUGE-1 evaluation for each agent.

    Uses test_config.json with response_match_score criteria.
    Fast and deterministic - suitable for CI/CD.

    Args:
        eval_path: Relative path to the evaluation directory
        agent_module: Python module path to the agent wrapper
        description: Human-readable description of the agent
        layer_marker: Pytest marker for the layer
    """
    if not ADK_EVAL_AVAILABLE:
        pytest.skip("google.adk.evaluation module not available")

    full_path = EVAL_DIR / eval_path
    if not check_eval_dir_exists(eval_path):
        pytest.skip(f"Evaluation directory or test_config.json not found: {full_path}")

    # Run evaluation with test_config.json (ROUGE-1)
    await AgentEvaluator.evaluate(
        agent_module=agent_module,
        eval_dataset_file_path_or_dir=str(full_path),
    )


# =============================================================================
# Rubric-Based LLM Evaluation Tests (eval_rubric marker)
# =============================================================================


@pytest.mark.eval
@pytest.mark.eval_rubric
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "eval_path,agent_module,description,layer_marker",
    AGENT_EVAL_CONFIGS_RUBRIC,
    ids=[f"rubric:{config[2]}" for config in AGENT_EVAL_CONFIGS_RUBRIC],
)
async def test_agent_evaluation_rubric(
    eval_path: str, agent_module: str, description: str, layer_marker: str
):
    """Run rubric-based LLM evaluation for each agent.

    Uses *_rubric/ directories with test_config.json containing
    rubric_based_final_response_quality_v1 criteria.
    Uses LLM-as-judge for semantic evaluation - slower but higher confidence.

    Args:
        eval_path: Relative path to the rubric evaluation directory
        agent_module: Python module path to the agent wrapper
        description: Human-readable description of the agent
        layer_marker: Pytest marker for the layer
    """
    if not ADK_EVAL_AVAILABLE:
        pytest.skip("google.adk.evaluation module not available")

    full_path = EVAL_DIR / eval_path
    if not check_eval_dir_exists(eval_path):
        pytest.skip(f"Rubric evaluation directory not found: {full_path}")

    # Run evaluation with test_config.json (rubric-based LLM judge)
    await AgentEvaluator.evaluate(
        agent_module=agent_module,
        eval_dataset_file_path_or_dir=str(full_path),
    )
