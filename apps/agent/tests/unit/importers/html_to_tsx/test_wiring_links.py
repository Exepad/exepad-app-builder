"""Fixture-driven tests for the link wiring rule."""

from __future__ import annotations

import pytest

from tests.unit.importers.html_to_tsx._harness import (
    assert_case,
    load_cases,
    run_transformer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("wiring_links")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
def test_wiring_links(case):
    result = run_transformer(case)
    assert_case(case, result)
