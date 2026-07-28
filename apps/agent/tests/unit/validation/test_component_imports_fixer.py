"""Fixture-driven tests for ``apply_component_imports_fixes``.

Covers export-rename, react/framer-motion/lucide-react import rewrites,
SDK import maintenance (missing add + unknown strip), and the legacy
useApp regex fallbacks. See ``fixtures/component_imports/README.md``.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers.component_imports import (
    apply_component_imports_fixes,
)
from tests.unit.validation._fixer_harness import (
    assert_case,
    load_cases,
    make_fix_context,
    run_fixer,
)

pytestmark = [pytest.mark.unit]

CASES = load_cases("component_imports")


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_component_imports_fixer(case):
    ctx = make_fix_context(**case.get("context", {}))
    result = run_fixer(apply_component_imports_fixes, case["tsx"], ctx)
    assert_case(result, case)
