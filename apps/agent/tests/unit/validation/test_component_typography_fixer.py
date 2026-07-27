"""Fixture-driven tests for ``apply_component_typography_fixes``.

Covers numeric ``font-NNN`` (Tailwind v4 non-utility) rewrites to the
named weight tokens, plus correct cases that the fixer must leave
untouched (already-named utilities, arbitrary form ``font-[NNN]``, and
template-literal classNames with dynamic interpolation).
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_typography import (
    apply_component_typography_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_typography")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_typography_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_typography_fixes, case["tsx"], ctx)
    assert_case(result, case)
