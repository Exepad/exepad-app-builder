"""Fixture-driven tests for ``apply_component_typos_fixes``.

Covers JSX handler-ref fuzzy fix, ``useModel`` / ``useHandler`` /
``setState`` string-arg typo correction, and navigate/href path typo
correction with a fallback-to-first-page when no plausible match exists.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_typos import (
    apply_component_typos_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_typos")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_typos_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_typos_fixes, case["tsx"], ctx)
    assert_case(result, case)
