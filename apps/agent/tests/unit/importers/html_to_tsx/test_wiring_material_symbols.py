"""Fixture-driven tests for the Material Symbols passthrough rule."""

from __future__ import annotations

import pytest

from tests.unit.importers.html_to_tsx._harness import (
    assert_case,
    load_cases,
    run_transformer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("wiring_material_symbols")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
def test_wiring_material_symbols(case):
    result = run_transformer(case)
    assert_case(case, result)
