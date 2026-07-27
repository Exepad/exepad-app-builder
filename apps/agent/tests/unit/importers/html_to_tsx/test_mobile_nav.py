"""Fixture-driven tests for the mobile-nav scaffold injection."""

from __future__ import annotations

import pytest

from tests.unit.importers.html_to_tsx._harness import (
    assert_case,
    load_cases,
    run_transformer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("mobile_nav")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
def test_mobile_nav(case):
    result = run_transformer(case)
    assert_case(case, result)
