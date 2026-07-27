"""Re-plan-on-actionless-editor tests for ``EditingWorkflow._plan_edits``.

GLITCH-4 (2026-06-29): on a weak non-Gemini model the Editor sometimes
returns a well-formed but ACTIONLESS ``EditorOutput`` — it "reasons" (e.g.
"let me load the HomeContent component first") and then emits no
``FrontendBuildAction``. The bounded re-plan loop previously used its second
iteration ONLY for the dropped-ingest mis-route, so a *pure* actionless plan
hard-failed on attempt 0, wasted the available retry, and dropped a working
preview to ``error`` (``[Editing] Editor returned no actions``).

These tests pin the fix: an actionless plan triggers exactly ONE corrective
re-plan; it recovers when the re-roll emits an action, and settles to a single
error event only when the SECOND plan is still empty.
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
_DEP_MAP = (
    "main_agent.agents.orchestrator.app_types.webapp.services."
    "dependency_map_builder.build_dependency_map"
)


# --------------------------------------------------------------------------- #
# Stubs (mirror test_editing_workflow_pre_built_plan_skip.py)
# --------------------------------------------------------------------------- #


class _StateLikeMapping(dict):
    """ADK ``State``-shaped dict that suppresses pop / __delitem__."""

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


def _make_state() -> _EditPhaseState:
    return _EditPhaseState(
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
            create_event=MagicMock(side_effect=lambda ctx, kind, **kw: {"event": kind, **kw})
        ),
        metrics_tracker=None,
    )


def _empty_content_context() -> SimpleNamespace:
    return SimpleNamespace(
        unresolved_references=[],
        image_catalog_summary="",
        document_artifact_list=[],
        large_document_list=[],
        user_referenced_images=[],
        user_referenced_documents=[],
        user_referenced_large_documents=[],
    )


def _editor_runner_for(plans):
    """Async-gen factory that writes successive ``EditorOutput`` dicts into
    ``EDIT_PLAN`` (one per Editor invocation) and counts the calls."""
    calls = SimpleNamespace(n=0)

    async def _runner(ctx, agent, agent_name, max_attempts):
        idx = min(calls.n, len(plans) - 1)
        ctx.session.state[StateKeys.EDIT_PLAN] = plans[idx]
        calls.n += 1
        if False:  # pragma: no cover — make this an async generator that yields nothing
            yield

    return _runner, calls


async def _run_plan_edits(workflow, ctx, state):
    """Drive ``_plan_edits`` with the three module-level helpers it must traverse
    stubbed. Returns ``(events, push_mock)`` — ``push_mock`` captures every
    ``push_prompt_to_next_agent(ctx, prompt)`` so a test can assert WHICH
    corrective feedback reached each Editor call (the load-bearing mechanism)."""
    push_mock = AsyncMock()
    with (
        patch(f"{_MODULE}.push_prompt_to_next_agent", new=push_mock),
        patch(
            f"{_MODULE}.DocumentArtifactService.prepare_content_context",
            new=AsyncMock(return_value=_empty_content_context()),
        ),
        patch(_DEP_MAP, new=AsyncMock(return_value={})),
    ):
        events = [
            ev async for ev in workflow._plan_edits(ctx, state, '{"frontend": {"pages": []}}')
        ]
    return events, push_mock


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_actionless_plan_replans_and_recovers():
    """An actionless first plan must trigger ONE corrective re-roll; if the
    second plan emits an action, the edit proceeds (no error, plan consumed)."""
    workflow = _bare_workflow()
    actionless = EditorOutput(reasoning="Let me load the HomeContent component first.").model_dump()
    recovered = EditorOutput(
        reasoning="Adding the FAQ section.",
        frontend_build_actions=[FrontendBuildAction(prompt="Add a FAQ section to HomeContent.")],
    ).model_dump()
    runner, calls = _editor_runner_for([actionless, recovered])
    workflow.validation_service = SimpleNamespace(_run_agent_with_retry=runner)
    workflow._run_data_ingest_pre_pass = AsyncMock(return_value=("", []))

    ctx = _StubInvocationContext(initial_state={StateKeys.CURRENT_PROMPT: "Add a FAQ section"})
    state = _make_state()

    events, push = await _run_plan_edits(workflow, ctx, state)

    assert calls.n == 2, "Editor should be re-rolled exactly once after an actionless plan"
    assert state.edit_plan is not None, "the recovered plan must be consumed"
    assert state.total_actions == 1
    assert len(state.edit_plan.frontend_build_actions) == 1
    error_events = [e for e in events if isinstance(e, dict) and e.get("event") == "error"]
    assert not error_events, "recovery must NOT yield an error event"

    # The load-bearing mechanism: the 2nd Editor call must carry the ACTIONLESS
    # corrective feedback (unique marker "ZERO edit actions"), NOT empty feedback
    # and NOT the dropped-ingest text. Guards against the branch silently
    # emitting the wrong / no feedback.
    assert push.await_count == 2
    first_prompt = push.call_args_list[0].args[1]
    second_prompt = push.call_args_list[1].args[1]
    assert "ZERO edit actions" not in first_prompt, "attempt-0 must not carry re-plan feedback"
    assert "ZERO edit actions" in second_prompt, "re-roll must carry the actionless feedback"
    assert "`frontend_build_action`" in second_prompt


@pytest.mark.asyncio
async def test_actionless_plan_twice_settles_single_error():
    """Two consecutive actionless plans settle to exactly one error event and
    leave ``edit_plan`` None — but only AFTER the corrective re-plan was spent
    (so the retry budget is genuinely used, not wasted on attempt 0)."""
    workflow = _bare_workflow()
    actionless = EditorOutput(reasoning="Still reasoning; no action emitted.").model_dump()
    runner, calls = _editor_runner_for([actionless, actionless])
    workflow.validation_service = SimpleNamespace(_run_agent_with_retry=runner)
    workflow._run_data_ingest_pre_pass = AsyncMock(return_value=("", []))

    ctx = _StubInvocationContext(initial_state={StateKeys.CURRENT_PROMPT: "Make it nicer"})
    state = _make_state()

    events, push = await _run_plan_edits(workflow, ctx, state)

    assert (
        calls.n == 2
    ), "Editor must be re-rolled once before giving up (not hard-fail on attempt 0)"
    assert state.edit_plan is None
    error_events = [e for e in events if isinstance(e, dict) and e.get("event") == "error"]
    assert len(error_events) == 1, "exactly one terminal error event after the bounded re-plan"


@pytest.mark.asyncio
async def test_actionless_plan_with_surveyor_shape_none_does_not_replan():
    """SAFETY: when the Surveyor concluded suggested_resolution_shape='none'
    (no fix needed — e.g. the user asked about expected behavior), a zero-action
    Editor plan must NOT trigger the 'you MUST emit an action' re-roll. Forcing
    one there could fabricate a spurious edit on a working app. It settles in a
    SINGLE Editor call with no MUST-emit pressure."""
    workflow = _bare_workflow()
    actionless = EditorOutput(reasoning="No change needed — the behavior is expected.").model_dump()
    runner, calls = _editor_runner_for([actionless, actionless])
    workflow.validation_service = SimpleNamespace(_run_agent_with_retry=runner)
    workflow._run_data_ingest_pre_pass = AsyncMock(return_value=("", []))

    ctx = _StubInvocationContext(
        initial_state={
            StateKeys.CURRENT_PROMPT: "Is the Pro plan billed monthly or annually?",
            StateKeys.DIAGNOSTIC_REPORT: {
                "suggested_resolution_shape": "none",
                "symptom": "User asks about billing cadence; no defect.",
            },
        }
    )
    state = _make_state()

    events, push = await _run_plan_edits(workflow, ctx, state)

    assert calls.n == 1, "shape='none' must settle in ONE Editor call (no re-roll)"
    assert push.await_count == 1
    assert (
        "ZERO edit actions" not in push.call_args_list[0].args[1]
    ), "the no-fix-needed path must never apply the MUST-emit pressure"
    assert state.edit_plan is None
    error_events = [e for e in events if isinstance(e, dict) and e.get("event") == "error"]
    assert len(error_events) == 1
