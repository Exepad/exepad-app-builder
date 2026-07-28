"""Fixture-driven tests for the design-import parity validator."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from main_agent.services.validation.design_import_parity import check_parity

pytestmark = [pytest.mark.unit]

FIXTURES_ROOT = Path(__file__).resolve().parent / "fixtures" / "design_import_parity"
CASES_PATH = FIXTURES_ROOT / "cases.json"
EXAMPLES_DIR = FIXTURES_ROOT / "examples"


def _load_cases() -> list[dict]:
    raw = json.loads(CASES_PATH.read_text(encoding="utf-8"))
    return raw["cases"]


CASES = _load_cases()


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_design_import_parity(case):
    before = (EXAMPLES_DIR / case["before_path"][len("examples/") :]).read_text(encoding="utf-8")
    after = (EXAMPLES_DIR / case["after_path"][len("examples/") :]).read_text(encoding="utf-8")
    backend_surface = case.get("backend_surface")
    result = check_parity(
        before_tsx=before,
        after_tsx=after,
        backend_surface=backend_surface,
    )
    case_id = case["id"]
    kind = case["kind"]

    if kind == "allow":
        assert result.passed, (
            f"[{case_id}] expected no violations but got: "
            f"{[(v.code, v.message) for v in result.violations]}"
        )
    elif kind == "block":
        assert (
            not result.passed
        ), f"[{case_id}] expected at least one violation but the validator passed"
        actual_codes = sorted({v.code for v in result.violations})
        for needle in case.get("expected_codes", []):
            assert needle in actual_codes, (
                f"[{case_id}] expected violation code {needle!r} in {actual_codes!r}.\n"
                f"  violations: {[(v.code, v.message[:80]) for v in result.violations]}"
            )
    else:
        raise ValueError(f"Unknown case kind {kind!r} on {case_id}")
