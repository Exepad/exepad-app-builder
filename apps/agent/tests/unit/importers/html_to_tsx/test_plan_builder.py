"""Fixture-driven tests for the building-plan augmentation pass."""

from __future__ import annotations

import pytest

from tests.unit.importers.html_to_tsx._harness import (
    assert_case,
    load_cases,
    run_transformer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("plan_builder")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
def test_plan_builder(case):
    result = run_transformer(case)
    assert_case(case, result)
