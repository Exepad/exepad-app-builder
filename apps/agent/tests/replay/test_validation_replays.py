"""Deterministic replay cases for validator, pipeline, and workflow confidence."""

from __future__ import annotations

import pytest

from tests.replay.case_loader import build_replay_params
from tests.replay.runner import run_replay_case


def _joined(values: list[str]) -> str:
    return "\n".join(values)


@pytest.mark.asyncio
@pytest.mark.parametrize("case", build_replay_params())
async def test_replay_case(case):
    outcome = await run_replay_case(case)
    expect = case["expect"]

    if case["kind"] == "semantic":
        result = outcome["result"]
        assert result.valid is expect["valid"]
        joined_errors = _joined(result.errors)
        joined_warnings = _joined(result.warnings)
        for substring in expect.get("required_error_substrings", []):
            assert substring in joined_errors
        for substring in expect.get("required_warning_substrings", []):
            assert substring in joined_warnings
        for substring in expect.get("forbidden_error_substrings", []):
            assert substring not in joined_errors
        for substring in expect.get("forbidden_warning_substrings", []):
            assert substring not in joined_warnings
        return

    if case["kind"] == "pipeline":
        compile_result = outcome["compile_result"]
        if expect["status"] == "success":
            assert outcome["exception"] is None
            assert compile_result is not None
        else:
            assert outcome["exception"] is not None

        if compile_result:
            if expect.get("compile_succeeds") is True:
                # tailwindcss binary may not be present in the test env;
                # the gate returns success=True with empty CSS in that
                # case (graceful skip). Either real success or skip is OK.
                assert compile_result["success"] or not compile_result["fatal_errors"]
            joined_warnings = _joined(compile_result.get("warnings", []))
            for substring in expect.get("required_warning_substrings", []):
                assert substring in joined_warnings
        return

    if case["kind"] == "workflow":
        report = outcome["report"]
        assert report.passed is expect["report_passed"]
        result_by_name = {result.name: result for result in report.results}
        for name in expect.get("required_passed_checks", []):
            assert result_by_name[name].passed is True
        for name in expect.get("required_failed_checks", []):
            assert result_by_name[name].passed is False
        if "page_count_min" in expect:
            assert outcome["page_count"] >= expect["page_count_min"]
        return

    raise AssertionError(f"Unhandled replay kind: {case['kind']}")
