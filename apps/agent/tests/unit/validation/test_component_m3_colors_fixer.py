"""Fixture-driven tests for ``apply_component_m3_colors_fixes``.

Covers the dispatcher's three regex passes (text opacity strip, bare
outline-variant rewrite, low-opacity bg clamp) plus the header
bg-transparent rewrite, and pins two integration scenarios with the AST
pairing walker (``rewrite_m3_color_pairings``). Deep AST coverage lives
in tests/unit/test_semantic_validator_m3_pairing.py.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_m3_colors import (
    apply_component_m3_colors_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_m3_colors")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_m3_colors_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_m3_colors_fixes, case["tsx"], ctx)
    assert_case(result, case)
