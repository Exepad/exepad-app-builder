"""Stub-baseline guard tests for ``EditingWorkflow._prepare_phase_state``.

When the source-rehydration step replaces any component with an empty
stub (its GCS source blob is missing), continuing the edit would let
the LLM rewrite the component from a blank slate, replacing the
deployed code rather than modifying it. Bug surfaced 2026-05-07 on
app 8wpuopnb after a "Put a fancy movie poster animation at dashboard"
edit destroyed every other dashboard section because all components
had been rehydrated as stubs.

These tests guard the new contract: if ``_stubbed_components`` is
non-empty after rehydration, ``_prepare_phase_state`` must set
``terminal_failure_summary`` and append a ``StubBaselineAbort`` entry
to ``AGENT_ERRORS`` so the workflow aborts BEFORE the Editor LLM runs.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow import (
    EditingWorkflow,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


class _StateLikeMapping(dict):
    def pop(self, *args, **kwargs):  # type: ignore[override]
        raise NotImplementedError("Production State forbids pop()")


class _StubSession:
    def __init__(self, state):
        self.state = state
        self.id = "session-1"
        self.user_id = "user-1"
        self.app_name = "test-app"


class _StubInvocationContext:
    def __init__(self, initial_state=None):
        state = _StateLikeMapping(initial_state or {})
        self.session = _StubSession(state)
        self.artifact_service = MagicMock()
        # ``push_session_state_update`` reads ctx.session_service; stub it
        # out so the helper can complete without hitting a real DB.
        self.session_service = SimpleNamespace(
            append_event=AsyncMock(return_value=None),
        )


def _bare_workflow() -> EditingWorkflow:
    return EditingWorkflow(
        editor_agent=MagicMock(name="editor_agent"),
        component_builder_agent=MagicMock(name="component_builder_agent"),
        component_builder_multiple_agent=MagicMock(name="component_builder_multiple_agent"),
        post_processing_service=MagicMock(name="post_processing_service"),
        assembly_service=MagicMock(name="assembly_service"),
        write_result_response_fn=MagicMock(name="write_result_response_fn"),
        logic_builder_agent=MagicMock(name="logic_builder_agent"),
        backend_builder=MagicMock(name="backend_builder"),
        design_system_builder_agent=MagicMock(name="design_system_builder_agent"),
    )


def _patch_theme_palette(monkeypatch):
    """Stub out the theme palette resolver so we don't hit GCS."""
    from main_agent.agents.orchestrator.app_types.webapp.workflows import (
        editing_workflow as ewf,
    )

    monkeypatch.setattr(
        ewf,
        "load_and_persist_theme_palette",
        AsyncMock(
            return_value=SimpleNamespace(
                palette={},
                fonts={},
                theme_css="",
            )
        ),
    )


@pytest.mark.asyncio
async def test_stubbed_components_set_aborts_with_terminal_failure(monkeypatch):
    """Rehydration leaves ``_stubbed_components`` non-empty → guard fires."""
    workflow = _bare_workflow()
    ctx = _StubInvocationContext(initial_state={"app_uuid": "app-1"})

    async def _fake_rehydrate(ctx_, _cfg):
        # Simulate the production code path: missing GCS blob for
        # DashboardContent + CatalogContent → both get stubbed.
        ctx_.session.state["_stubbed_components"] = [
            "DashboardContent",
            "CatalogContent",
        ]

    from main_agent.agents.orchestrator.app_types.webapp.services import (
        source_rehydration_service,
    )

    monkeypatch.setattr(source_rehydration_service, "rehydrate_sources", _fake_rehydrate)
    _patch_theme_palette(monkeypatch)

    state = await workflow._prepare_phase_state(
        ctx,
        current_config={"frontend": {"pages": [], "logic": {}}, "backend": {}},
        progress_tracker=MagicMock(create_event=MagicMock(return_value=MagicMock())),
        metrics_tracker=None,
        agent_name="Editing",
    )

    # Terminal failure was set: the workflow's main loop will return early.
    assert state.terminal_failure_summary is not None
    assert "DashboardContent" in state.terminal_failure_summary
    assert "CatalogContent" in state.terminal_failure_summary

    # AGENT_ERRORS got a structured entry the SSE callback can surface.
    errors = ctx.session.state.get(StateKeys.AGENT_ERRORS, [])
    assert any(e.get("stage") == "StubBaselineAbort" for e in errors), errors
    abort_entry = next(e for e in errors if e.get("stage") == "StubBaselineAbort")
    assert sorted(abort_entry["stubbed_components"]) == [
        "CatalogContent",
        "DashboardContent",
    ]

    # SAVE_APP_CONFIG must be False so the destructive edit doesn't get
    # persisted by accident downstream.
    assert ctx.session.state.get(StateKeys.SAVE_APP_CONFIG) is False


@pytest.mark.asyncio
async def test_no_stubbed_components_does_not_abort(monkeypatch):
    """Happy path: rehydration leaves ``_stubbed_components`` empty → no abort."""
    workflow = _bare_workflow()
    ctx = _StubInvocationContext(initial_state={"app_uuid": "app-2"})

    async def _fake_rehydrate(ctx_, _cfg):
        # All components rehydrated cleanly — no stubs.
        ctx_.session.state["_stubbed_components"] = []

    from main_agent.agents.orchestrator.app_types.webapp.services import (
        source_rehydration_service,
    )

    monkeypatch.setattr(source_rehydration_service, "rehydrate_sources", _fake_rehydrate)
    _patch_theme_palette(monkeypatch)

    state = await workflow._prepare_phase_state(
        ctx,
        current_config={"frontend": {"pages": [], "logic": {}}, "backend": {}},
        progress_tracker=MagicMock(create_event=MagicMock(return_value=MagicMock())),
        metrics_tracker=None,
        agent_name="Editing",
    )

    assert state.terminal_failure_summary is None
    errors = ctx.session.state.get(StateKeys.AGENT_ERRORS, [])
    assert not any(e.get("stage") == "StubBaselineAbort" for e in errors)


@pytest.mark.asyncio
async def test_stubbed_components_unset_does_not_abort(monkeypatch):
    """Rehydration leaves the key UNSET (creation path) → no abort."""
    workflow = _bare_workflow()
    ctx = _StubInvocationContext(initial_state={"app_uuid": "app-3"})

    async def _fake_rehydrate(ctx_, _cfg):
        # Production rehydration only sets the key when stubs were
        # created. Unset key must mean "no stubs" — same as empty list.
        pass

    from main_agent.agents.orchestrator.app_types.webapp.services import (
        source_rehydration_service,
    )

    monkeypatch.setattr(source_rehydration_service, "rehydrate_sources", _fake_rehydrate)
    _patch_theme_palette(monkeypatch)

    state = await workflow._prepare_phase_state(
        ctx,
        current_config={"frontend": {"pages": [], "logic": {}}, "backend": {}},
        progress_tracker=MagicMock(create_event=MagicMock(return_value=MagicMock())),
        metrics_tracker=None,
        agent_name="Editing",
    )

    assert state.terminal_failure_summary is None


# ─────────────────────────────────────────────────────────────────────────
# Design-import branch: rehydration must be SKIPPED entirely.
#
# The mechanical translator + BackendBuilder.build_create + decomposition
# runner all save fresh artifacts to ctx.artifact_service before
# EditingWorkflow runs. On first deploy GCS is empty, so rehydration would
# overwrite the fresh in-memory TSX with stubs and cascade into 0 saved
# components. Bug reproduced 2026-05-15 on app r74zfpfj.
# ─────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rehydration_skipped_on_design_import_branch(monkeypatch):
    """plan_source == design_import → rehydrate_sources must NOT run."""
    workflow = _bare_workflow()
    ctx = _StubInvocationContext(
        initial_state={
            "app_uuid": "app-di-1",
            StateKeys.EDIT_PLAN_SOURCE: "design_import",
        }
    )

    rehydrate_calls = {"count": 0}

    async def _spy_rehydrate(ctx_, _cfg):
        rehydrate_calls["count"] += 1

    from main_agent.agents.orchestrator.app_types.webapp.services import (
        source_rehydration_service,
    )

    monkeypatch.setattr(source_rehydration_service, "rehydrate_sources", _spy_rehydrate)
    _patch_theme_palette(monkeypatch)

    state = await workflow._prepare_phase_state(
        ctx,
        current_config={"frontend": {"pages": [], "logic": {}}, "backend": {}},
        progress_tracker=MagicMock(create_event=MagicMock(return_value=MagicMock())),
        metrics_tracker=None,
        agent_name="Editing",
    )

    assert rehydrate_calls["count"] == 0, (
        "rehydrate_sources should be skipped on design-import branch"
    )
    assert state.terminal_failure_summary is None


@pytest.mark.asyncio
async def test_rehydration_runs_on_edit_branch(monkeypatch):
    """plan_source == editor (or unset) → rehydrate_sources MUST run."""
    workflow = _bare_workflow()
    ctx = _StubInvocationContext(
        initial_state={
            "app_uuid": "app-edit-1",
            StateKeys.EDIT_PLAN_SOURCE: "editor",
        }
    )

    rehydrate_calls = {"count": 0}

    async def _spy_rehydrate(ctx_, _cfg):
        rehydrate_calls["count"] += 1
        ctx_.session.state["_stubbed_components"] = []

    from main_agent.agents.orchestrator.app_types.webapp.services import (
        source_rehydration_service,
    )

    monkeypatch.setattr(source_rehydration_service, "rehydrate_sources", _spy_rehydrate)
    _patch_theme_palette(monkeypatch)

    await workflow._prepare_phase_state(
        ctx,
        current_config={"frontend": {"pages": [], "logic": {}}, "backend": {}},
        progress_tracker=MagicMock(create_event=MagicMock(return_value=MagicMock())),
        metrics_tracker=None,
        agent_name="Editing",
    )

    assert rehydrate_calls["count"] == 1, (
        "rehydrate_sources MUST run on the edit branch (rollback-correctness contract)"
    )


@pytest.mark.asyncio
async def test_rehydration_runs_when_plan_source_unset(monkeypatch):
    """plan_source unset (default 'editor') → rehydrate_sources MUST run."""
    workflow = _bare_workflow()
    ctx = _StubInvocationContext(initial_state={"app_uuid": "app-edit-2"})

    rehydrate_calls = {"count": 0}

    async def _spy_rehydrate(ctx_, _cfg):
        rehydrate_calls["count"] += 1
        ctx_.session.state["_stubbed_components"] = []

    from main_agent.agents.orchestrator.app_types.webapp.services import (
        source_rehydration_service,
    )

    monkeypatch.setattr(source_rehydration_service, "rehydrate_sources", _spy_rehydrate)
    _patch_theme_palette(monkeypatch)

    await workflow._prepare_phase_state(
        ctx,
        current_config={"frontend": {"pages": [], "logic": {}}, "backend": {}},
        progress_tracker=MagicMock(create_event=MagicMock(return_value=MagicMock())),
        metrics_tracker=None,
        agent_name="Editing",
    )

    assert rehydrate_calls["count"] == 1, (
        "rehydrate_sources MUST run when plan_source is unset (defaults to 'editor')"
    )
