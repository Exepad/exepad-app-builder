"""Consistency checks for the active eval registry and testing docs."""

from __future__ import annotations

from importlib import import_module
from pathlib import Path

import pytest

from tests.eval.registry import ACTIVE_EVAL_SPECS, BUILDING_CONFIDENCE_NOTE

pytestmark = [pytest.mark.unit]

REPO_ROOT = Path(__file__).resolve().parents[2]
TESTS_HOWTO = REPO_ROOT / "tests" / "TEST_HOWTO.md"
LATEST_TESTING_DOC = REPO_ROOT / "docs" / "latest" / "12_testing.md"
CLAUDE_DOC = REPO_ROOT / "CLAUDE.md"


def test_active_eval_wrappers_import_and_expose_agent():
    for spec in ACTIVE_EVAL_SPECS:
        module = import_module(spec.agent_module)
        assert hasattr(module, "agent"), f"{spec.agent_module} must export `agent`"


def test_active_eval_directories_exist():
    eval_root = REPO_ROOT / "tests" / "eval"
    for spec in ACTIVE_EVAL_SPECS:
        fast_dir = eval_root / spec.fast_eval_path
        rubric_dir = eval_root / spec.rubric_eval_path
        assert fast_dir.exists(), f"Missing fast eval dir: {fast_dir}"
        assert rubric_dir.exists(), f"Missing rubric eval dir: {rubric_dir}"
        assert (fast_dir / "test_config.json").exists()
        assert (rubric_dir / "test_config.json").exists()
        assert list(fast_dir.glob("*.test.json")), f"No evalset found in {fast_dir}"


def test_legacy_tsx_builder_eval_removed():
    legacy_fast_dir = REPO_ROOT / "tests" / "eval" / "building" / "tsx_builder"
    legacy_rubric_dir = REPO_ROOT / "tests" / "eval" / "building" / "tsx_builder_rubric"

    assert not (REPO_ROOT / "tests" / "eval" / "agents" / "tsx_builder.py").exists()
    assert not legacy_fast_dir.exists() or not any(legacy_fast_dir.iterdir())
    assert not legacy_rubric_dir.exists() or not any(legacy_rubric_dir.iterdir())


@pytest.mark.parametrize("doc_path", [TESTS_HOWTO, LATEST_TESTING_DOC, CLAUDE_DOC])
def test_testing_docs_reference_active_eval_registry(doc_path: Path):
    text = doc_path.read_text(encoding="utf-8")

    for spec in ACTIVE_EVAL_SPECS:
        assert spec.docs_label in text, f"{doc_path.name} missing {spec.docs_label}"

    assert BUILDING_CONFIDENCE_NOTE in text, f"{doc_path.name} missing building confidence note"
