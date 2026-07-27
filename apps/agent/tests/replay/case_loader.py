"""Loading and parametrizing replay fixtures."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

CASE_ROOT = Path(__file__).parent / "cases"


def iter_replay_cases() -> list[dict]:
    """Load all replay cases from JSON fixture files."""
    cases: list[dict] = []
    for path in sorted(CASE_ROOT.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        file_cases = payload.get("cases", payload)
        if isinstance(file_cases, dict):
            file_cases = [file_cases]
        for case in file_cases:
            case["_fixture_path"] = str(path)
            cases.append(case)
    return cases


def build_replay_params() -> list[object]:
    """Create pytest params with markers derived from replay tags."""
    params = []
    for case in iter_replay_cases():
        marks = [pytest.mark.replay]
        tags = set(case.get("tags", []))
        if "smoke" in tags:
            marks.append(pytest.mark.confidence_pr)
        if "nightly" in tags:
            marks.append(pytest.mark.nightly)
        if "building" in tags:
            marks.append(pytest.mark.eval_building)
        if case.get("kind") in {"semantic", "pipeline"}:
            marks.append(pytest.mark.unit)
        params.append(pytest.param(case, marks=marks, id=case["id"]))
    return params
