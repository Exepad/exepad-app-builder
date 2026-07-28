"""Fixture-driven tests for ``apply_component_a11y_ux_fixes``.

Covers status-key map lowercasing, DialogDescription injection, mixed
icon+text Trigger Button wrapping, and status string-literal lowercasing.
See ``fixtures/component_a11y_ux/README.md`` for the branch grid.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_a11y_ux import (
    apply_component_a11y_ux_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_a11y_ux")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_a11y_ux_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_a11y_ux_fixes, case["tsx"], ctx)
    assert_case(result, case)
