"""Fixture-driven tests for ``apply_component_polishing_fixes``.

Covers console.log strip, cn() unwrap variants, hover overlay capping,
tiny-font clamping, low-contrast text promotion, and the
animate-in+duration-N rewrite that prevents implicit transition: all
layout shift on mount.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_polishing import (
    apply_component_polishing_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_polishing")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_polishing_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_polishing_fixes, case["tsx"], ctx)
    assert_case(result, case)
