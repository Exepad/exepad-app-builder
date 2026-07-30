"""Fixture-driven tests for ``apply_component_forbidden_api_fixes``.

Covers ``window.location`` → ``navigate()`` rewrites (assignment +
``.assign()``/``.replace()`` method calls) and the paren-balanced
``console.{log,warn,error,info,debug}`` strip — including inline,
multi-line, JSX-attribute, JSX-expression, template-literal, and
escaped-quote edge cases.

Pipeline-integration coverage (rewrite + auto-import) lives in
``test_dispatcher_orchestration.py``; this file isolates the fixer.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_forbidden_apis import (
    apply_component_forbidden_api_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_forbidden_apis")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_forbidden_apis_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_forbidden_api_fixes, case["tsx"], ctx)
    assert_case(result, case)
