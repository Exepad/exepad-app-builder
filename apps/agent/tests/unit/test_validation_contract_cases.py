"""Table-driven validator contract tests backed by checked-in fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from main_agent.services.validation.semantic_validator import run_semantic_checks
from main_agent.services.validation.style_coverage import (
    auto_fix_contrast_pairs,
    validate_contrast_pairs,
)

pytestmark = [pytest.mark.unit]

CASE_FILE = (
    Path(__file__).resolve().parents[1]
    / "fixtures"
    / "validation_cases"
    / "semantic_contract_cases.json"
)
CASES = json.loads(CASE_FILE.read_text(encoding="utf-8"))


def _joined(items: list[str]) -> str:
    return "\n".join(items)


@pytest.mark.parametrize("case", CASES["semantic_cases"], ids=lambda case: case["id"])
def test_semantic_contract_cases(case):
    result = run_semantic_checks(
        case["tsx"],
        case.get("models", []),
        case.get("logic", {}),
        case.get("page_slugs", []),
        expected_component_name=case.get("expected_component_name", ""),
        theme_palette=case.get("theme_palette"),
    )

    expect = case["expect"]
    assert result.valid is expect["valid"]

    joined_errors = _joined(result.errors)
    joined_warnings = _joined(result.warnings)

    for substring in expect.get("required_error_substrings", []):
        assert substring in joined_errors
    for substring in expect.get("required_warning_substrings", []):
        assert substring in joined_warnings
    for substring in expect.get("forbidden_warning_substrings", []):
        assert substring not in joined_warnings


@pytest.mark.parametrize("case", CASES["theme_cases"], ids=lambda case: case["id"])
def test_theme_contract_cases(case):
    warnings = validate_contrast_pairs(case["css"])
    joined_warnings = _joined(warnings)

    for substring in case.get("expect_warning_substrings", []):
        assert substring in joined_warnings

    fixed = auto_fix_contrast_pairs(case["css"])
    assert fixed is not None
    for substring in case.get("expect_fixed_contains", []):
        assert substring in fixed
