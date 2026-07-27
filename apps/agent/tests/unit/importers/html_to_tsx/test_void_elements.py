"""Fixture-driven tests for HTML5 void-element self-closing rules."""

from __future__ import annotations

import pytest

from tests.unit.importers.html_to_tsx._harness import (
    assert_case,
    load_cases,
    run_transformer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("void_elements")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.id)
def test_void_elements(case):
    result = run_transformer(case)
    assert_case(case, result)
