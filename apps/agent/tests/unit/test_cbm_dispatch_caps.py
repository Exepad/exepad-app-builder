"""Tests for ``EditingWorkflow._run_cbm_with_caps``.

Guards the safety wrapper around ComponentBuilderMultiple dispatch.
ADK's ``LlmAgent.run_async`` has no built-in iteration limit, so the
workflow needs to cap CBM invocations by both tool-call count and
wall-clock seconds — otherwise a non-converging agent runs until Cloud
Run's 60-min request kill.

These tests stub the inner ``_run_agent_with_metrics`` to inject
controllable event streams (with / without function calls, slow / fast)
and assert the wrapper:

1. Yields events normally and exits when the inner stream completes.
2. Aborts after the configured tool-call cap.
3. Aborts after the configured wall-clock timeout.
4. Records a phase-level error in ``StateKeys.AGENT_ERRORS`` on abort
   so the workflow's terminal path picks it up.
5. Closes the inner generator on abort (no leak / no orphan tasks).
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow import (
    EditingWorkflow,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


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
        # `push_session_state_update` calls
        # ``ctx.session_service.append_event(...)``; the AsyncMock keeps
        # the persistence call a no-op while letting the local-state
        # update path still run.
        self.session_service = MagicMock()
        self.session_service.append_event = AsyncMock(return_value=None)


class _FakeEvent:
    """Minimal Event substitute exposing ``get_function_calls()``."""

    def __init__(self, *, function_call_count: int = 0):
        self._fcs = [object() for _ in range(function_call_count)]

    def get_function_calls(self):
        return list(self._fcs)


def _make_workflow() -> EditingWorkflow:
    return EditingWorkflow(
        editor_agent=MagicMock(name="editor_agent"),
        component_builder_agent=MagicMock(name="component_builder_agent"),
        component_builder_multiple_agent=MagicMock(name="cbm_agent"),
        post_processing_service=MagicMock(name="post_processing_service"),
        assembly_service=MagicMock(name="assembly_service"),
        write_result_response_fn=MagicMock(name="write_result_response_fn"),
        logic_builder_agent=MagicMock(name="logic_builder_agent"),
        backend_builder=MagicMock(name="backend_builder"),
        design_system_builder_agent=MagicMock(name="design_system_builder_agent"),
    )


def _make_state():
    """Return a minimal ``_EditPhaseState``-shaped object for the wrapper.

    The wrapper now also emits SSE progress beats via
    ``state.progress_tracker.create_event(...)`` every PROGRESS_BEAT_EVERY
    tool calls — supply a MagicMock so any existing test that doesn't
    care about progress events continues to pass.
    """
    progress_tracker = MagicMock(name="progress_tracker")
    # Each beat call returns a sentinel that's distinguishable from a
    # _FakeEvent (no `get_function_calls` attribute). Tests that filter
    # by "is _FakeEvent" can use isinstance() to ignore beats.
    progress_tracker.create_event.side_effect = (
        lambda *_a, **_k: SimpleNamespace(_progress_beat=True)
    )
    return SimpleNamespace(metrics_tracker=None, progress_tracker=progress_tracker)


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_normal_termination_yields_all_events_no_error():
    """Stream completes naturally → wrapper yields every event, no error."""
    workflow = _make_workflow()
    ctx = _StubInvocationContext()

    async def fake_inner(*_args, **_kwargs):
        for n in range(5):
            yield _FakeEvent(function_call_count=1)

    yielded = []
    with patch.object(workflow, "_run_agent_with_metrics", side_effect=fake_inner):
        async for event in workflow._run_cbm_with_caps(
            ctx, _make_state(), invocation_label="test"
        ):
            if not getattr(event, "_progress_beat", False):
                yielded.append(event)

    assert len(yielded) == 5
    assert StateKeys.AGENT_ERRORS not in ctx.session.state


@pytest.mark.asyncio
async def test_tool_call_cap_aborts_and_records_error():
    """Stream that exceeds the tool-call cap must abort with a recorded error."""
    workflow = _make_workflow()
    ctx = _StubInvocationContext()

    async def fake_inner(*_args, **_kwargs):
        # Emits 1 tool call per event indefinitely.
        while True:
            yield _FakeEvent(function_call_count=1)

    yielded = []
    with patch(
        "config.COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS", 3
    ), patch.object(workflow, "_run_agent_with_metrics", side_effect=fake_inner):
        async for event in workflow._run_cbm_with_caps(
            ctx, _make_state(), invocation_label="cap_test"
        ):
            if not getattr(event, "_progress_beat", False):
                yielded.append(event)

    # Wrapper yields up to and including the event that pushes the count to N.
    assert len(yielded) == 3
    errors = ctx.session.state.get(StateKeys.AGENT_ERRORS) or []
    assert len(errors) == 1
    assert "tool-call cap" in errors[0]
    assert "cap_test" in errors[0]


@pytest.mark.asyncio
async def test_timeout_aborts_and_records_error():
    """Inner stream that hangs indefinitely must abort on wall-clock timeout."""
    workflow = _make_workflow()
    ctx = _StubInvocationContext()

    async def fake_inner(*_args, **_kwargs):
        # Yield one event then hang forever — emulates a slow LLM call.
        yield _FakeEvent(function_call_count=1)
        await asyncio.sleep(60)
        yield _FakeEvent(function_call_count=1)  # never reached

    yielded = []
    with patch(
        "config.COMPONENT_BUILDER_MULTIPLE_TIMEOUT_SECONDS", 1
    ), patch.object(workflow, "_run_agent_with_metrics", side_effect=fake_inner):
        async for event in workflow._run_cbm_with_caps(
            ctx, _make_state(), invocation_label="timeout_test"
        ):
            if not getattr(event, "_progress_beat", False):
                yielded.append(event)

    assert len(yielded) == 1  # The first event got through; the hang was cut.
    errors = ctx.session.state.get(StateKeys.AGENT_ERRORS) or []
    assert len(errors) == 1
    assert "timeout" in errors[0]
    assert "timeout_test" in errors[0]


@pytest.mark.asyncio
async def test_cap_event_with_zero_function_calls_does_not_count():
    """Events without function_calls don't count toward the cap."""
    workflow = _make_workflow()
    ctx = _StubInvocationContext()

    async def fake_inner(*_args, **_kwargs):
        # 5 zero-call events + 2 single-call events = 2 toward cap.
        for _ in range(5):
            yield _FakeEvent(function_call_count=0)
        for _ in range(2):
            yield _FakeEvent(function_call_count=1)

    yielded = []
    with patch(
        "config.COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS", 3
    ), patch.object(workflow, "_run_agent_with_metrics", side_effect=fake_inner):
        async for event in workflow._run_cbm_with_caps(
            ctx, _make_state(), invocation_label="zero_count"
        ):
            if not getattr(event, "_progress_beat", False):
                yielded.append(event)

    # Stream completed naturally before hitting the cap.
    assert len(yielded) == 7
    assert StateKeys.AGENT_ERRORS not in ctx.session.state


@pytest.mark.asyncio
async def test_parallel_function_calls_in_one_event_count_correctly():
    """An event carrying N parallel function calls counts as N toward the cap."""
    workflow = _make_workflow()
    ctx = _StubInvocationContext()

    async def fake_inner(*_args, **_kwargs):
        # 1 event with 3 parallel calls hits the cap of 3 immediately.
        yield _FakeEvent(function_call_count=3)
        yield _FakeEvent(function_call_count=1)  # should not be reached

    yielded = []
    with patch(
        "config.COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS", 3
    ), patch.object(workflow, "_run_agent_with_metrics", side_effect=fake_inner):
        async for event in workflow._run_cbm_with_caps(
            ctx, _make_state(), invocation_label="parallel_calls"
        ):
            if not getattr(event, "_progress_beat", False):
                yielded.append(event)

    assert len(yielded) == 1
    errors = ctx.session.state.get(StateKeys.AGENT_ERRORS) or []
    assert len(errors) == 1
    assert "tool-call cap" in errors[0]


@pytest.mark.asyncio
async def test_progress_beats_emitted_every_three_tool_calls():
    """Regression for ckfk4mun 2026-05-18: the wrapper used to emit zero
    SSE progress events during a multi-minute polish dispatch, so the
    front-end progress bar froze and the user killed Vertex AI mid-build.
    A progress beat must fire at least every PROGRESS_BEAT_EVERY (=3)
    tool calls, reusing the existing ``building_component`` action so no
    backend mapping change is required."""
    workflow = _make_workflow()
    ctx = _StubInvocationContext()
    state = _make_state()

    async def fake_inner(*_args, **_kwargs):
        # 9 single-call events → expect 3 beats (after calls 3, 6, 9).
        for _ in range(9):
            yield _FakeEvent(function_call_count=1)

    real_events = 0
    beats = 0
    with patch.object(workflow, "_run_agent_with_metrics", side_effect=fake_inner):
        async for event in workflow._run_cbm_with_caps(
            ctx, state, invocation_label="beat_test"
        ):
            if getattr(event, "_progress_beat", False):
                beats += 1
            else:
                real_events += 1

    assert real_events == 9
    assert beats == 3, f"Expected 3 progress beats for 9 tool calls, got {beats}"

    # Each beat reuses the `building_component` action so the backend's
    # progress_orchestrator maps it to phase='building' without any
    # action-table change.
    beat_calls = state.progress_tracker.create_event.call_args_list
    assert all(call.args[1] == "building_component" for call in beat_calls)
    # Internal message includes the running counter for log visibility.
    assert all(
        "Polishing components" in call.kwargs.get("internal_message", "")
        for call in beat_calls
    )


@pytest.mark.asyncio
async def test_progress_beats_skipped_on_zero_function_call_events():
    """Events without function calls (e.g., text-only LLM responses) must
    NOT trigger a progress beat — the bucket only advances when a tool
    call actually happened."""
    workflow = _make_workflow()
    ctx = _StubInvocationContext()
    state = _make_state()

    async def fake_inner(*_args, **_kwargs):
        for _ in range(10):
            yield _FakeEvent(function_call_count=0)

    with patch.object(workflow, "_run_agent_with_metrics", side_effect=fake_inner):
        async for _ in workflow._run_cbm_with_caps(
            ctx, state, invocation_label="no_beat_test"
        ):
            pass

    state.progress_tracker.create_event.assert_not_called()


@pytest.mark.asyncio
async def test_inner_aclose_called_on_cap_hit():
    """When the cap fires, the inner generator must be closed (no orphan)."""
    workflow = _make_workflow()
    ctx = _StubInvocationContext()
    closed = {"flag": False}

    async def fake_inner(*_args, **_kwargs):
        try:
            while True:
                yield _FakeEvent(function_call_count=1)
        except GeneratorExit:
            closed["flag"] = True
            raise

    with patch(
        "config.COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS", 2
    ), patch.object(workflow, "_run_agent_with_metrics", side_effect=fake_inner):
        async for _ in workflow._run_cbm_with_caps(
            ctx, _make_state(), invocation_label="aclose_test"
        ):
            pass

    assert closed["flag"], "Inner generator's GeneratorExit handler did not fire"
