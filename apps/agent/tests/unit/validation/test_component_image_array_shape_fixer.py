"""Fixture-driven tests for ``apply_component_image_array_shape_fixes``.

Covers the bare-top-level-``keywords:`` array shape that the resolver's
array-aware regex misses, plus the canonical-shape and unrelated-array
correct fixtures that must round-trip unchanged.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_image_array_shape import (
    apply_component_image_array_shape_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_image_array_shape")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_image_array_shape_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_image_array_shape_fixes, case["tsx"], ctx)
    assert_case(result, case)
