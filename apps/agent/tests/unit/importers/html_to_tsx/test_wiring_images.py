"""Fixture-driven tests for the image wiring rule."""

from __future__ import annotations

import pytest

from tests.unit.importers.html_to_tsx._harness import (
    assert_case,
    load_cases,
    run_transformer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("wiring_images")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
def test_wiring_images(case):
    result = run_transformer(case)
    assert_case(case, result)
