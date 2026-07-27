"""Fixture-driven tests for ``apply_component_urls_images_fixes``.

The fixer (700 LOC, 9 distinct rewrite branches) was previously covered
only indirectly via ``test_auto_fix_coverage_gaps``. This file parametrizes
every branch from a manifest at ``fixtures/component_urls_images/cases.json``,
asserting both the rewrite output and the human-readable fix message —
plus idempotence on every case via the harness.

Add a regression case by dropping a TSX file under ``examples/`` and an
entry in ``cases.json``. See ``fixtures/README.md`` for the schema.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_urls_images import (
    apply_component_urls_images_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_urls_images")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_urls_images_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_urls_images_fixes, case["tsx"], ctx)
    assert_case(result, case)
