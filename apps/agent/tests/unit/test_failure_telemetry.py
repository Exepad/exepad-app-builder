"""Tests for ``failure_telemetry.emit_outcome``.

Two invariants the BigQuery sink depends on:

1. The ``event="agent_outcome"`` key is stable so Cloud Logging can
   filter on it.
2. The schema is non-PII by construction — only category keys, counts,
   and control-plane identifiers. Never raw TSX, raw user prompts, or
   raw error message strings.

The Pattern C abort/partial-ship paths and the success path all call
this. Tests verify the basic shape and the feature-flag gate.
"""

from __future__ import annotations

import pytest

import config
from main_agent.agents.utils.failure_telemetry import EVENT_KEY, emit_outcome

pytestmark = [pytest.mark.unit]


def test_event_key_is_stable():
    """Cloud Logging filter routes on this exact string. Don't rename
    without coordinating with the sink config."""
    assert EVENT_KEY == "agent_outcome"


def test_emit_writes_event_line_when_flag_on(capsys, monkeypatch):
    """structlog's default renderer writes to stdout. Capture it via
    capsys (caplog only sees stdlib-logging records)."""
    monkeypatch.setattr(config, "ENABLE_FAILURE_TELEMETRY", True)
    emit_outcome(
        session_id="Session_xyz",
        workflow="creation",
        outcome="success",
        component_count=3,
    )
    captured = capsys.readouterr()
    text = captured.out + captured.err
    assert EVENT_KEY in text, f"expected {EVENT_KEY} in stdout/stderr, got: {text[:200]!r}"


def test_emit_is_noop_when_flag_off(capsys, monkeypatch):
    monkeypatch.setattr(config, "ENABLE_FAILURE_TELEMETRY", False)
    emit_outcome(
        session_id="Session_xyz",
        workflow="creation",
        outcome="success",
        component_count=3,
    )
    captured = capsys.readouterr()
    text = captured.out + captured.err
    assert EVENT_KEY not in text, "telemetry must no-op when ENABLE_FAILURE_TELEMETRY=False"


def test_emit_includes_failure_lists_in_payload(capsys, monkeypatch):
    monkeypatch.setattr(config, "ENABLE_FAILURE_TELEMETRY", True)
    emit_outcome(
        session_id="Session_xyz",
        workflow="creation",
        outcome="abort",
        component_count=3,
        fatal_failures=["HomeContent"],
        recoverable_failures=["MainFooter"],
        failure_classes={"HomeContent": "jsx_syntax_error", "MainFooter": "validation_failed"},
    )
    captured = capsys.readouterr()
    text = captured.out + captured.err
    assert "HomeContent" in text
    assert "MainFooter" in text
    assert "abort" in text


def test_emit_omits_none_optional_fields(capsys, monkeypatch):
    """None-valued kwargs aren't rendered as 'None' strings — they're
    filtered out so the BigQuery schema stays compact."""
    monkeypatch.setattr(config, "ENABLE_FAILURE_TELEMETRY", True)
    emit_outcome(
        session_id="Session_xyz",
        workflow="creation",
        outcome="success",
        component_count=3,
        cost_usd=None,
        duration_seconds=None,
    )
    captured = capsys.readouterr()
    text = captured.out + captured.err
    assert "cost_usd=None" not in text
    assert "duration_seconds=None" not in text


def test_emit_accepts_partial_ship_outcome(capsys, monkeypatch):
    monkeypatch.setattr(config, "ENABLE_FAILURE_TELEMETRY", True)
    emit_outcome(
        session_id="Session_xyz",
        workflow="creation",
        outcome="partial_ship",
        component_count=3,
        recoverable_failures=["HomeContent"],
    )
    captured = capsys.readouterr()
    text = captured.out + captured.err
    assert "partial_ship" in text
    assert "HomeContent" in text


def test_schema_does_not_carry_raw_tsx_or_prompts():
    """Defensive: the function signature only accepts category keys and
    enumerated values. No parameter name suggests raw content. This
    test makes the no-PII contract enforceable as a code-review check.
    """
    import inspect

    sig = inspect.signature(emit_outcome)
    forbidden_names = {"tsx", "prompt", "raw_error", "user_input", "error_message"}
    for param in sig.parameters:
        assert (
            param not in forbidden_names
        ), f"emit_outcome must not accept raw content via parameter {param!r}"
