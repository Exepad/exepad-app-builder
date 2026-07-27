"""Fixture-driven tests for ``apply_handler_auto_fixes``.

The handler fixer has a different signature from the component fixers
— ``(tsx, model_names: list[str] | None) -> (tsx, fixes)`` rather than
the ``(tsx, ctx, fixes_applied) -> tsx`` shape the harness expects.
We adapt it via a small wrapper so the same manifest pattern applies.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from main_agent.services.validation.fixers.handler_dispatcher import (
    apply_handler_auto_fixes,
)
from tests.unit.validation._fixer_harness import (
    FixerResult,
    assert_case,
    make_fix_context,
)

pytestmark = [pytest.mark.unit]

_FIXTURE_DIR = Path(__file__).parent / "fixtures" / "handler_validation"


def _load_handler_cases() -> list[dict]:
    manifest = json.loads((_FIXTURE_DIR / "cases.json").read_text(encoding="utf-8"))
    cases: list[dict] = []
    for case in manifest["cases"]:
        tsx_path = _FIXTURE_DIR / case["tsx_path"]
        cases.append(
            {
                **case,
                "tsx": tsx_path.read_text(encoding="utf-8"),
            }
        )
    return cases


CASES = _load_handler_cases()


def _run_handler(tsx: str, model_names: list[str] | None) -> FixerResult:
    """Adapter: run the handler fixer twice (idempotence) and return a
    FixerResult so the shared ``assert_case`` helper applies."""
    fixed, fixes = apply_handler_auto_fixes(tsx, model_names)
    second_fixed, second_fixes = apply_handler_auto_fixes(fixed, model_names)
    return FixerResult(
        output=fixed,
        fixes=fixes,
        idempotent_output=second_fixed,
        idempotent_fixes=second_fixes,
    )


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_handler_dispatcher_fixer(case):
    # context.model_names is the only handler-fixer kwarg we care about
    # — the FixContext fields are not consulted by this fixer.
    model_names = case.get("context", {}).get("model_names")
    result = _run_handler(case["tsx"], model_names)
    assert_case(result, case)


def test_make_fix_context_silently_ignores_handler_only_kwargs():
    """Sanity: harness drops unknown kwargs (e.g. model_names) without raising."""
    ctx = make_fix_context(model_names=["order"])
    assert ctx.models == []  # nothing forwarded; default factory used
