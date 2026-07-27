"""No-op-edit honesty guard for ``EditingWorkflow._assemble_and_save``.

GLITCH (2026-06-29): on the weak model an edit could report SUCCESS while
changing NOTHING. The Editor emits a valid ``frontend_build_action``, but
ComponentBuilderMultiple exhausts its 25 tool-call budget without landing a
single save (every turn ``ToolUse:0`` → 0 files modified). The workflow then
deployed a version byte-identical to the previous one and the ResultResponseWriter
fabricated "Applied N edits" / "I added a FAQ section…".

These tests pin the guard: a turn whose net effect is zero config-affecting
change settles with an ``error`` event and does NOT deploy or call the
result-writer — while a turn that genuinely modified something proceeds.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.editor import (
    EditorOutput,
    FrontendBuildAction,
)
from main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow import (
    EditingWorkflow,
    _EditPhaseState,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]

_MODULE = "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow"
_CROSS_VAL = (
    "main_agent.agents.orchestrator.app_types.shared.services."
    "config_finalization.run_cross_validation"
)


# --------------------------------------------------------------------------- #
# Stubs
# --------------------------------------------------------------------------- #


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
        self.session = _StubSession(_StateLikeMapping(initial_state or {}))
        self.artifact_service = MagicMock()


def _bare_workflow() -> EditingWorkflow:
    return EditingWorkflow(
        editor_agent=MagicMock(),
        component_builder_agent=MagicMock(),
        component_builder_multiple_agent=MagicMock(),
        post_processing_service=MagicMock(),
        assembly_service=MagicMock(),
        write_result_response_fn=MagicMock(),
        logic_builder_agent=MagicMock(),
        backend_builder=MagicMock(),
        design_system_builder_agent=MagicMock(),
    )


def _make_state(**overrides) -> _EditPhaseState:
    state = _EditPhaseState(
        agent_name="Editing",
        current_config={"frontend": {"pages": []}},
        app_language_code="en",
        app_secondary_type="website",
        design_system_context="",
        pre_computed_palette=None,
        fonts={},
        image_uuid_to_url={},
        existing_backend={},
        existing_security=None,
        existing_pages=[],
        progress_tracker=MagicMock(
            create_event=MagicMock(side_effect=lambda ctx, kind, **kw: {"event": kind, **kw}),
            update=AsyncMock(),
        ),
        metrics_tracker=None,
    )
    for k, v in overrides.items():
        setattr(state, k, v)
    return state


def _frontend_only_plan() -> EditorOutput:
    return EditorOutput(
        reasoning="Add a FAQ section to HomeContent.",
        frontend_build_actions=[FrontendBuildAction(prompt="Add a FAQ section.")],
    )


# --------------------------------------------------------------------------- #
# Decision-matrix unit tests for the pure helper
# --------------------------------------------------------------------------- #


def test_noop_true_when_frontend_build_planned_but_nothing_landed():
    state = _make_state(edit_plan=_frontend_only_plan(), total_actions=1)
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is True


def test_noop_false_when_a_component_was_modified():
    state = _make_state(
        edit_plan=_frontend_only_plan(), total_actions=1, modified_names=["HomeContent"]
    )
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is False


def test_noop_false_when_a_component_was_added():
    added = SimpleNamespace(name="PricingSection")
    state = _make_state(edit_plan=_frontend_only_plan(), total_actions=1, added_components=[added])
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is False


def test_noop_false_when_a_component_was_removed():
    state = _make_state(edit_plan=_frontend_only_plan(), total_actions=1, removed_names=["OldHero"])
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is False


def test_noop_false_for_design_import_even_when_diff_empty():
    """Design-import polish legitimately diffs empty — components are
    materialized upstream — so the deploy is real and must NOT be flagged."""
    state = _make_state(edit_plan=_frontend_only_plan(), total_actions=1)
    assert EditingWorkflow._edit_produced_no_change(state, "design_import") is False


def test_noop_false_when_plan_touched_styles_elsewhere():
    plan = _frontend_only_plan()
    plan.modify_styles_actions = ["<sentinel-style-action>"]
    state = _make_state(edit_plan=plan, total_actions=2)
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is False


def test_noop_false_when_plan_renamed_a_page():
    plan = _frontend_only_plan()
    plan.rename_page_title_actions = ["<sentinel-rename>"]
    state = _make_state(edit_plan=plan, total_actions=2)
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is False


def test_noop_false_when_no_plan():
    state = _make_state(edit_plan=None)
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is False


def test_noop_false_when_frontend_build_renames_a_page_slug():
    """A slug-rename-only FrontendBuildAction applies in place to current_config
    (→ side_effects.slug_remaps) but populates NONE of the four state fields, so
    a CBM run that lands 0 component saves must NOT be discarded as a no-op."""
    fba = FrontendBuildAction(prompt="Rename the pricing page slug to /plans.")
    fba.page_slug_renames = ["<sentinel-rename>"]  # only truthiness matters here
    plan = EditorOutput(reasoning="rename", frontend_build_actions=[fba])
    state = _make_state(edit_plan=plan, total_actions=1)
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is False


def test_noop_false_when_frontend_build_creates_a_page():
    """An (even empty-mount) page_create adds a page to current_config — a real
    structural change that must not be flagged as a no-op."""
    fba = FrontendBuildAction(prompt="Add a new About page.")
    fba.page_creates = ["<sentinel-create>"]
    plan = EditorOutput(reasoning="create", frontend_build_actions=[fba])
    state = _make_state(edit_plan=plan, total_actions=1)
    assert EditingWorkflow._edit_produced_no_change(state, "editor") is False


# --------------------------------------------------------------------------- #
# Integration: the guard in _assemble_and_save
# --------------------------------------------------------------------------- #


def _wire_result_writer(workflow):
    """Replace write_result_response with an async-gen that records calls."""
    rec = SimpleNamespace(n=0, args=None)

    async def _wrr(ctx, mode, user_request, summary):
        rec.n += 1
        rec.args = (mode, user_request, summary)
        if False:  # pragma: no cover — async generator that yields nothing
            yield

    workflow.write_result_response = _wrr
    return rec


@pytest.mark.asyncio
async def test_assemble_and_save_noop_yields_error_and_skips_result_writer():
    """A net-zero-change edit must yield an `error` event and must NOT call the
    result-writer (no fabricated success) nor push save_app_config (no deploy of
    an unchanged version)."""
    workflow = _bare_workflow()
    rec = _wire_result_writer(workflow)
    # Make the would-be-downstream path survivable so this is a real
    # fail-before/pass-after: WITHOUT the guard, the method runs to the writer.
    workflow.assembly_service.update_app_config_for_edit = MagicMock(
        return_value={"frontend": {"pages": []}}
    )
    workflow.post_processing_service.process = MagicMock(return_value={"frontend": {"pages": []}})

    ctx = _StubInvocationContext(
        initial_state={
            StateKeys.CURRENT_PROMPT: "Add a FAQ section",
            StateKeys.EDIT_PLAN_SOURCE: "editor",
        }
    )
    state = _make_state(edit_plan=_frontend_only_plan(), total_actions=1)

    with (
        patch(_CROSS_VAL, new=MagicMock()),
        patch(f"{_MODULE}.push_session_state_update", new=AsyncMock()) as push_state,
    ):
        events = [
            ev
            async for ev in workflow._assemble_and_save(
                ctx, state.current_config, state, "Add a FAQ section"
            )
        ]

    error_events = [e for e in events if isinstance(e, dict) and e.get("event") == "error"]
    assert len(error_events) == 1, "no-op edit must yield exactly one error event"
    assert rec.n == 0, "the result-writer must NOT run (no fabricated success)"
    # save_app_config must never be pushed → no deploy of an unchanged version.
    for call in push_state.await_args_list:
        payload = call.args[1] if len(call.args) > 1 else {}
        assert "save_app_config" not in payload


@pytest.mark.asyncio
async def test_assemble_and_save_proceeds_when_a_component_changed():
    """A turn that genuinely modified a component must NOT trip the guard — it
    reaches the result-writer and pushes save_app_config (deploy)."""
    workflow = _bare_workflow()
    rec = _wire_result_writer(workflow)
    workflow.assembly_service.update_app_config_for_edit = MagicMock(
        return_value={"frontend": {"pages": []}}
    )
    workflow.post_processing_service.process = MagicMock(return_value={"frontend": {"pages": []}})

    ctx = _StubInvocationContext(
        initial_state={
            StateKeys.CURRENT_PROMPT: "Add a FAQ section",
            StateKeys.EDIT_PLAN_SOURCE: "editor",
        }
    )
    state = _make_state(
        edit_plan=_frontend_only_plan(), total_actions=1, modified_names=["HomeContent"]
    )

    with (
        patch(_CROSS_VAL, new=MagicMock()),
        patch(f"{_MODULE}.push_session_state_update", new=AsyncMock()) as push_state,
    ):
        events = [
            ev
            async for ev in workflow._assemble_and_save(
                ctx, state.current_config, state, "Add a FAQ section"
            )
        ]

    error_events = [e for e in events if isinstance(e, dict) and e.get("event") == "error"]
    assert not error_events, "a real edit must not yield the no-op error"
    assert rec.n == 1, "the result-writer must run for a real edit"
    pushed_save = any(
        "save_app_config" in (c.args[1] if len(c.args) > 1 else {})
        for c in push_state.await_args_list
    )
    assert pushed_save, "a real edit must push save_app_config (deploy)"
