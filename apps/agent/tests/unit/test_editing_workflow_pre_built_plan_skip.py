"""Pre-built EditPlan skip tests for EditingWorkflow.

When DesignImportWorkflow synthesizes an EditPlan upstream and pushes
``StateKeys.EDIT_PLAN_SOURCE = "design_import"``, ``EditingWorkflow``
must SKIP the Editor LLM and consume the plan directly. These tests
guard that contract.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

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


# --------------------------------------------------------------------------- #
# Stubs
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
        state = _StateLikeMapping(initial_state or {})
        self.session = _StubSession(state)
        self.artifact_service = MagicMock()


def _bare_workflow(editor_should_run: bool = True) -> EditingWorkflow:
    """Construct an EditingWorkflow with all dependencies mocked."""
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


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_pre_built_plan_skips_editor_llm():
    """When EDIT_PLAN_SOURCE is "design_import", _plan_edits must NOT
    invoke the Editor LLM. The plan is consumed directly via
    EditorOutput.model_validate."""
    workflow = _bare_workflow(editor_should_run=False)

    pre_built_plan = EditorOutput(
        reasoning="Synthesized by DesignImportWorkflow",
        frontend_build_actions=[
            FrontendBuildAction(prompt="Validate entry HomeContent."),
        ],
    )
    ctx = _StubInvocationContext(
        initial_state={
            StateKeys.EDIT_PLAN: pre_built_plan.model_dump(),
            StateKeys.EDIT_PLAN_SOURCE: "design_import",
        }
    )

    # Sentinel: validation_service._run_agent_with_retry should NEVER fire.
    workflow.validation_service = SimpleNamespace(
        _run_agent_with_retry=AsyncMock(
            side_effect=AssertionError(
                "Editor LLM was invoked despite pre-built plan source"
            )
        )
    )

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
        progress_tracker=MagicMock(create_event=MagicMock(return_value=MagicMock())),
        metrics_tracker=None,
    )

    events = []
    async for ev in workflow._plan_edits(ctx, state, '{"frontend": {"pages": []}}'):
        events.append(ev)

    assert state.edit_plan is not None
    assert state.total_actions == 1
    assert len(state.edit_plan.frontend_build_actions) == 1
    assert state.edit_plan.frontend_build_actions[0].prompt == "Validate entry HomeContent."


@pytest.mark.asyncio
async def test_pre_built_plan_with_malformed_dict_yields_error():
    """If EDIT_PLAN_SOURCE marks the plan as design-import but the
    dict fails ``EditorOutput.model_validate``, the workflow yields an
    error event and leaves ``state.edit_plan`` as None."""
    workflow = _bare_workflow(editor_should_run=False)

    ctx = _StubInvocationContext(
        initial_state={
            StateKeys.EDIT_PLAN: {"reasoning": "x", "frontend_build_actions": "not a list"},
            StateKeys.EDIT_PLAN_SOURCE: "design_import",
        }
    )

    workflow.validation_service = SimpleNamespace(
        _run_agent_with_retry=AsyncMock(
            side_effect=AssertionError("Editor LLM should not run on malformed pre-built plan")
        )
    )

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
        progress_tracker=MagicMock(create_event=MagicMock(return_value=MagicMock())),
        metrics_tracker=None,
    )

    events = []
    async for ev in workflow._plan_edits(ctx, state, '{"frontend": {"pages": []}}'):
        events.append(ev)

    assert state.edit_plan is None
    # Some progress event was emitted (the error event)
    assert events, "expected an error event to be yielded"
