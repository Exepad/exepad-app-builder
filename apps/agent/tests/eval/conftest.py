"""Shared pytest fixtures for ADK evaluation tests.

This module provides fixtures and configurations for running
ADK evaluations on individual subagents.
"""

import pytest
from pathlib import Path

from .registry import AGENT_MODULES

EVAL_DIR = Path(__file__).parent


@pytest.fixture(scope="session")
def eval_base_dir():
    """Base directory for eval test files."""
    return EVAL_DIR


@pytest.fixture(scope="session")
def routing_eval_dir(eval_base_dir):
    """Directory for routing layer eval tests."""
    return eval_base_dir / "routing"


@pytest.fixture(scope="session")
def planning_eval_dir(eval_base_dir):
    """Directory for planning layer eval tests."""
    return eval_base_dir / "planning"


@pytest.fixture(scope="session")
def building_eval_dir(eval_base_dir):
    """Directory for building layer eval tests."""
    return eval_base_dir / "building"


@pytest.fixture(scope="session")
def support_eval_dir(eval_base_dir):
    """Directory for support layer eval tests."""
    return eval_base_dir / "support"


@pytest.fixture(scope="session")
def agent_modules():
    """Dictionary mapping agent names to their module paths."""
    return AGENT_MODULES
