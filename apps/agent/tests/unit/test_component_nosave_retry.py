"""Lever A — ComponentBuilder no-save retry support (y0o1ltmw, 2026-05-24).

A ComponentBuilder slot can end its single turn with no `validate_and_save`
call (gemini-3-flash no-save) → no artifact → a placeholder is shipped. The
creation workflow now re-dispatches such components once (an independent re-roll,
since slots sample with temperature>0). Recovery is detected by checking whether
the artifact is still a placeholder.

These tests pin the two pure pieces that the retry's correctness hinges on:
- `is_placeholder_tsx` correctly distinguishes a shipped placeholder from a real
  ComponentBuilder artifact (the recovery signal), and round-trips with
  `build_placeholder_component_tsx`.
- the retry config flags parse with the intended defaults (on, 1 attempt).
"""

from __future__ import annotations

import asyncio
import importlib
from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.component_failure_service import (  # noqa: E501
    build_placeholder_component_tsx,
    is_placeholder_tsx,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


def _ctx(state: dict) -> SimpleNamespace:
    return SimpleNamespace(session=SimpleNamespace(id="s", user_id="u", app_name="a", state=state))


def _patch_recovery(monkeypatch, artifact_source):
    """Patch creation_workflow so _clear_if_recovered sees `artifact_source` and
    state updates land back on ctx.session.state."""
    from main_agent.agents.orchestrator.app_types.webapp.workflows import (
        creation_workflow as cw,
    )

    async def fake_load(ctx, key):  # ArtifactManager.load_artifact_as_string
        return artifact_source

    async def fake_push(ctx, updates):  # push_session_state_update
        ctx.session.state.update(updates)

    monkeypatch.setattr(cw.ArtifactManager, "load_artifact_as_string", staticmethod(fake_load))
    monkeypatch.setattr(cw, "push_session_state_update", fake_push)
    return cw


_REAL_TSX = (
    'import { React, LightDOMContainer } from "@exepad/sdk";\n'
    "function MainFooter() { return (<LightDOMContainer><footer>ok</footer>"
    "</LightDOMContainer>); }\nexport default MainFooter;\n"
)


# ── is_placeholder_tsx ───────────────────────────────────────────────


def test_placeholder_roundtrip_detected():
    """Whatever build_placeholder_component_tsx emits MUST be detected as a
    placeholder — this is the recovery signal the retry relies on."""
    tsx = build_placeholder_component_tsx(
        "MainFooter", "builder escalated", "builder_escalated", "footer"
    )
    assert is_placeholder_tsx(tsx) is True


def test_placeholder_roundtrip_detected_all_roles():
    for role in ("content", "footer", "header", "hero"):
        tsx = build_placeholder_component_tsx("X", "reason", None, role)
        assert is_placeholder_tsx(tsx) is True, role


def test_real_component_not_flagged():
    """A normal ComponentBuilder artifact must NOT look like a placeholder,
    otherwise a successful retry would be misread as still-failed."""
    real = (
        'import { React, LightDOMContainer, Button } from "@exepad/sdk";\n'
        "function MainFooter() {\n"
        "  return (<LightDOMContainer><footer>"
        "<p>© 2026 RentWise. All rights reserved.</p>"
        "<Button>Contact</Button></footer></LightDOMContainer>);\n"
        "}\nexport default MainFooter;\n"
    )
    assert is_placeholder_tsx(real) is False


def test_empty_or_none_is_not_placeholder():
    # "no artifact" is handled separately by the caller — not a placeholder.
    assert is_placeholder_tsx("") is False
    assert is_placeholder_tsx(None) is False


# ── config flags ─────────────────────────────────────────────────────


def test_retry_flags_default_on_two_attempts(monkeypatch):
    monkeypatch.delenv("COMPONENT_BUILDER_ESCALATION_RETRY", raising=False)
    monkeypatch.delenv("COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS", raising=False)
    import config

    importlib.reload(config)
    assert config.COMPONENT_BUILDER_ESCALATION_RETRY is True
    # Default bumped to 2 for self-host: operator-chosen models (OpenRouter/
    # LiteLLM/local) have more variable tool-calling adherence than native Gemini,
    # so they need an extra independent re-roll to converge (p^2 → p^3).
    assert config.COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS == 2


def test_retry_attempts_env_override(monkeypatch):
    monkeypatch.setenv("COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS", "2")
    monkeypatch.setenv("COMPONENT_BUILDER_ESCALATION_RETRY", "false")
    import config

    importlib.reload(config)
    assert config.COMPONENT_BUILDER_ESCALATION_RETRY is False
    assert config.COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS == 2
    # restore defaults for any later test that imports config fresh
    monkeypatch.delenv("COMPONENT_BUILDER_ESCALATION_RETRY", raising=False)
    monkeypatch.delenv("COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS", raising=False)
    importlib.reload(config)


# ── _clear_if_recovered — the reset-and-recover bookkeeping ───────────


def test_clear_if_recovered_real_artifact_recovers(monkeypatch):
    """A real (non-placeholder) artifact after retry → recovered: cleared from
    UNRESOLVED + COMPONENT_FAILURE_DETAILS, and a ComponentEntry is appended."""
    cw = _patch_recovery(monkeypatch, _REAL_TSX)
    state = {
        StateKeys.UNRESOLVED_COMPONENTS: {"MainFooter": "builder_escalated"},
        StateKeys.COMPONENT_FAILURE_DETAILS: {"MainFooter": {"failure_class": None}},
    }
    ctx = _ctx(state)
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)
    entries: list = []

    recovered = asyncio.run(
        wf._clear_if_recovered(ctx, {"name": "MainFooter", "role": "footer"}, entries)
    )

    assert recovered is True
    assert "MainFooter" not in ctx.session.state[StateKeys.UNRESOLVED_COMPONENTS]
    assert "MainFooter" not in ctx.session.state[StateKeys.COMPONENT_FAILURE_DETAILS]
    assert [e.name for e in entries] == ["MainFooter"]


def test_clear_if_recovered_existing_entry_not_duplicated(monkeypatch):
    """When a placeholder entry already exists (the common round-1 path), recovery
    clears bookkeeping but does NOT append a duplicate entry."""
    cw = _patch_recovery(monkeypatch, _REAL_TSX)
    state = {StateKeys.UNRESOLVED_COMPONENTS: {"MainFooter": "x"}}
    ctx = _ctx(state)
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)
    existing = SimpleNamespace(name="MainFooter")
    entries = [existing]

    recovered = asyncio.run(
        wf._clear_if_recovered(ctx, {"name": "MainFooter"}, entries)
    )
    assert recovered is True
    assert entries == [existing]  # no duplicate appended


def test_clear_if_recovered_still_placeholder(monkeypatch):
    """A still-placeholder artifact → NOT recovered: state untouched."""
    placeholder = build_placeholder_component_tsx("MainFooter", "reason", None, "footer")
    cw = _patch_recovery(monkeypatch, placeholder)
    state = {StateKeys.UNRESOLVED_COMPONENTS: {"MainFooter": "x"}}
    ctx = _ctx(state)
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)
    entries: list = []

    recovered = asyncio.run(
        wf._clear_if_recovered(ctx, {"name": "MainFooter"}, entries)
    )
    assert recovered is False
    assert ctx.session.state[StateKeys.UNRESOLVED_COMPONENTS] == {"MainFooter": "x"}
    assert entries == []


def test_clear_if_recovered_no_artifact(monkeypatch):
    """No artifact at all (still no-save) → NOT recovered."""
    cw = _patch_recovery(monkeypatch, None)
    state = {StateKeys.UNRESOLVED_COMPONENTS: {"MainFooter": "x"}}
    ctx = _ctx(state)
    wf = cw.CreationWorkflow.__new__(cw.CreationWorkflow)

    recovered = asyncio.run(
        wf._clear_if_recovered(ctx, {"name": "MainFooter"}, [])
    )
    assert recovered is False
    assert ctx.session.state[StateKeys.UNRESOLVED_COMPONENTS] == {"MainFooter": "x"}
