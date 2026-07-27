"""Fixture-driven tests for ``apply_component_null_safety_fixes``.

Covers all 6 branches of the null-safety fixer:
``useApp`` selector var, ``useApp`` destructure, ``useModel`` data array
guard, SDK hook destructured fields, SDK hook var-bound chains, and
broken-optional-chain repair. Manifest-driven; see
``fixtures/component_null_safety/README.md`` for the branch grid.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_null_safety import (
    apply_component_null_safety_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_null_safety")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_null_safety_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_null_safety_fixes, case["tsx"], ctx)
    assert_case(result, case)
