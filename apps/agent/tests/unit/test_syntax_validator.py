"""Unit tests for syntax_validator without relying on a local esbuild binary."""

from __future__ import annotations

import subprocess
from types import SimpleNamespace

import pytest

from main_agent.services.validation.syntax_validator import validate_tsx_syntax

pytestmark = [pytest.mark.unit]


def test_validate_tsx_syntax_success(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stderr="", stdout=""),
    )

    valid, errors = validate_tsx_syntax("export default function Hero() { return <div />; }")

    assert valid is True
    assert errors == []


def test_validate_tsx_syntax_extracts_structured_errors(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=1,
            stderr="✘ [ERROR] Unexpected closing tag\nerror: Unexpected closing tag",
            stdout="",
        ),
    )

    valid, errors = validate_tsx_syntax("broken")

    assert valid is False
    assert errors == ["error: Unexpected closing tag"]


def test_validate_tsx_syntax_falls_back_to_raw_output(monkeypatch):
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=1,
            stderr="esbuild exploded without structured formatting",
            stdout="",
        ),
    )

    valid, errors = validate_tsx_syntax("broken")

    assert valid is False
    assert errors == ["esbuild exploded without structured formatting"]


def test_validate_tsx_syntax_timeout(monkeypatch):
    def _raise_timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="esbuild", timeout=10)

    monkeypatch.setattr(subprocess, "run", _raise_timeout)

    valid, errors = validate_tsx_syntax("broken")

    assert valid is False
    assert errors == ["esbuild timed out (>10s)"]


def test_validate_tsx_syntax_missing_binary_is_non_blocking(monkeypatch):
    def _missing_binary(*args, **kwargs):
        raise FileNotFoundError("esbuild")

    monkeypatch.setattr(subprocess, "run", _missing_binary)

    valid, errors = validate_tsx_syntax("export default function Hero() { return <div />; }")

    assert valid is True
    assert errors == []


def test_validate_tsx_syntax_error_filter_is_case_insensitive(monkeypatch):
    """The validator extracts lines whose lowercased text contains 'error:'.
    Mixed-case ``Error:`` and uppercase ``ERROR:`` must be picked up too.
    """
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(
            returncode=1,
            stderr="ERROR: tag mismatch on line 1\nNote: a hint\nError: missing brace at line 5",
            stdout="",
        ),
    )

    valid, errors = validate_tsx_syntax("broken")

    assert valid is False
    assert errors == [
        "ERROR: tag mismatch on line 1",
        "Error: missing brace at line 5",
    ]


def test_validate_tsx_syntax_returns_exit_code_when_streams_empty(monkeypatch):
    """When esbuild fails with no stderr or stdout, the validator surfaces
    a synthetic ``esbuild exited with code N`` error so the failure is
    visible upstream instead of silently passing.
    """
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=2, stderr="", stdout=""),
    )

    valid, errors = validate_tsx_syntax("broken")

    assert valid is False
    assert errors == ["esbuild exited with code 2 (no error output)"]


def test_validate_tsx_syntax_truncates_long_unstructured_output(monkeypatch):
    """Raw fallback truncates at 500 chars to keep upstream prompts and logs
    bounded. The trailing 'TAIL' chars must be absent in the recorded error.
    """
    long_blob = ("X" * 1000) + "TAIL"
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=1, stderr=long_blob, stdout=""),
    )

    valid, errors = validate_tsx_syntax("broken")

    assert valid is False
    assert len(errors) == 1
    assert len(errors[0]) == 500
    assert "TAIL" not in errors[0]
