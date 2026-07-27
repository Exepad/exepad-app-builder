"""Fixture-driven tests for ``apply_component_redundant_json_parse_fixes``.

Covers the design-import contract drift surfaced on app ``alo48zsn``
(2026-05-15): the app-backend auto-parses ``type:"json"`` columns to a
JS object/array before the frontend sees them, but ComponentBuilder
emits a defensive ``JSON.parse(field || "[]")`` ternary that crashes
with ``SyntaxError: "[object Object]" is not valid JSON`` whenever the
parsed value is an object instead of an array.

The fixer rewrites the ternary to a defensive Array/typeof check that
handles array, object, and null cases. Gated on the per-app model
schema so legitimate ``JSON.parse`` calls on text-typed columns are
left alone.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_redundant_json_parse import (
    apply_component_redundant_json_parse_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_redundant_json_parse")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_redundant_json_parse_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_redundant_json_parse_fixes, case["tsx"], ctx)
    assert_case(result, case)
