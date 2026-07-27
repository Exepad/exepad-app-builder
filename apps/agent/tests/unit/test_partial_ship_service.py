"""Tests for the partial-ship routing decision.

Pattern C splits unresolved-component failures into fatal vs recoverable:

- Any fatal class → abort (existing behaviour preserved)
- Only recoverable + ``ENABLE_PARTIAL_SHIP=True`` → ship with placeholders
- Only recoverable + flag off → abort (rollout safety)

The decision is pure — no state mutation. These tests pin the routing
table and the gating-flag interaction.
"""

from __future__ import annotations

import pytest

import config
from main_agent.agents.orchestrator.app_types.webapp.services import (
    partial_ship_service,
)

pytestmark = [pytest.mark.unit]


# ──────────────────────────────────────────────────────────────────────
# Fatal failures always abort regardless of flag
# ──────────────────────────────────────────────────────────────────────


def test_fatal_failure_aborts_even_with_flag_on(monkeypatch):
    monkeypatch.setattr(config, "ENABLE_PARTIAL_SHIP", True)
    decision = partial_ship_service.decide(
        all_unresolved={"HomeContent": "syntax error", "MainHeader": "validation_failed"},
        failure_classes={
            "HomeContent": "jsx_syntax_error",  # fatal
            "MainHeader": "validation_failed",  # recoverable
        },
    )
    assert decision.should_abort is True
    assert decision.ship_partial is False
    assert decision.fatal_components == ["HomeContent"]
    assert decision.recoverable_components == ["MainHeader"]


def test_missing_model_class_is_recoverable(monkeypatch):
    # Under the always-ship contract, only jsx_syntax_error is fatal.
    # missing_model maps to recoverable — placeholder ships, build deploys.
    monkeypatch.setattr(config, "ENABLE_PARTIAL_SHIP", True)
    decision = partial_ship_service.decide(
        all_unresolved={"DataTable": "no model"},
        failure_classes={"DataTable": "missing_model"},
    )
    assert decision.should_abort is False
    assert decision.ship_partial is True


# ──────────────────────────────────────────────────────────────────────
# Recoverable-only failures route on the flag
# ──────────────────────────────────────────────────────────────────────


def test_recoverable_only_ships_partial_when_flag_on(monkeypatch):
    """REGRESSION: Onix Studio. Pre-fix the workflow aborted on
    validation_failed even though placeholder TSX was already saved.
    With Pattern C, recoverable-only failures ship placeholders +
    chat warning when the flag is on."""
    monkeypatch.setattr(config, "ENABLE_PARTIAL_SHIP", True)
    decision = partial_ship_service.decide(
        all_unresolved={"HomeContent": "addEventListener forbidden"},
        failure_classes={"HomeContent": "validation_failed"},
    )
    assert decision.should_abort is False
    assert decision.ship_partial is True
    assert decision.recoverable_components == ["HomeContent"]
    assert decision.fatal_components == []


def test_recoverable_only_aborts_when_flag_off(monkeypatch):
    """Rollout safety: until the user-facing UI ships the partial-ship
    chat message + Regenerate button, keep the existing all-or-nothing
    behaviour."""
    monkeypatch.setattr(config, "ENABLE_PARTIAL_SHIP", False)
    decision = partial_ship_service.decide(
        all_unresolved={"HomeContent": "addEventListener forbidden"},
        failure_classes={"HomeContent": "validation_failed"},
    )
    assert decision.should_abort is True
    assert decision.ship_partial is False


# ──────────────────────────────────────────────────────────────────────
# Edge cases
# ──────────────────────────────────────────────────────────────────────


def test_no_failures_returns_no_action():
    decision = partial_ship_service.decide(all_unresolved={}, failure_classes={})
    assert decision.should_abort is False
    assert decision.ship_partial is False


def test_unclassified_failure_treated_as_recoverable(monkeypatch):
    """Conservative default: a failure with no class entry falls into the
    partial-ship bucket so the gating flag controls behaviour rather
    than the absence of classification data."""
    monkeypatch.setattr(config, "ENABLE_PARTIAL_SHIP", True)
    decision = partial_ship_service.decide(
        all_unresolved={"HomeContent": "some failure reason"},
        failure_classes={},  # no entry for HomeContent
    )
    assert decision.ship_partial is True
    assert decision.recoverable_components == ["HomeContent"]


def test_mixed_fatal_and_recoverable_groups_correctly(monkeypatch):
    # Under the always-ship contract, only jsx_syntax_error is fatal.
    # missing_handler is recoverable — same group as validation_failed.
    monkeypatch.setattr(config, "ENABLE_PARTIAL_SHIP", True)
    decision = partial_ship_service.decide(
        all_unresolved={
            "Page1": "x",
            "Page2": "y",
            "Page3": "z",
        },
        failure_classes={
            "Page1": "jsx_syntax_error",
            "Page2": "validation_failed",
            "Page3": "missing_handler",
        },
    )
    assert decision.should_abort is True
    assert decision.fatal_components == ["Page1"]
    assert sorted(decision.recoverable_components) == ["Page2", "Page3"]
