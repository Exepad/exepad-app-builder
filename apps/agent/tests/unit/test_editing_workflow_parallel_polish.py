"""Integration-style tests for EditingWorkflow's parallel-polish branch.

Validates the gate logic + per-round state contract of
``_run_phase_frontend_build_parallel_polish``. The polish parallel agent's
``_run_async_impl`` is mocked to a no-op event stream so the tests stay
fast and don't require a real LLM.

What's covered:
  * Gate: multi-action design imports take the parallel path; single-action
    design imports and non-design-import edits take the sequential path.
  * Per-round state setup: each active slot gets its own ``{slot}_input``,
    ``_expected_component_name__{slot}``, ``{slot}_tool_calls``=0, and
    per-slot ``_files_modified_this_turn__{slot}=[]``.
  * Per-round cleanup: all per-slot state keys popped before the next round.
  * Chunked dispatch: 5 actions at NUM_SLOTS=3 splits into 3+2 rounds.
  * Cross-slot module overlap detection emits a warning when two slots
    wrote the same file (simulated via per-slot dirty-list state).
  * Entry-name extraction from a FrontendBuildAction prompt.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.editor import (
    EditorOutput,
    FrontendBuildAction,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder_multiple_polish_pool import (
    NUM_SLOTS as POLISH_NUM_SLOTS,
    SLOT_NAMES as POLISH_SLOT_NAMES,
    STATE_EXECUTION_COMPONENTS_POLISH,
    slot_expected_name_state_key as polish_slot_expected_name_state_key,
    slot_files_modified_state_key as polish_slot_files_modified_state_key,
    slot_input_state_key as polish_slot_input_state_key,
    slot_tool_call_state_key as polish_slot_tool_call_state_key,
)
from main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow import (
    EditingWorkflow,
)

pytestmark = [pytest.mark.unit]


# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------


class _StubSession:
    def __init__(self, state):
        self.state = state
        self.id = "session-1"
        self.user_id = "user-1"
        self.app_name = "test-app"


class _StubInvocationContext:
    def __init__(self, initial_state=None):
        self.session = _StubSession(dict(initial_state or {}))
        self.artifact_service = MagicMock()
        self.session_service = MagicMock()
        self.session_service.append_event = AsyncMock(return_value=None)


def _make_workflow() -> EditingWorkflow:
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


def _make_state(actions):
    """Minimal ``_EditPhaseState``-shaped object covering the fields the
    parallel polish path touches."""
    progress_tracker = MagicMock(name="progress_tracker")
    progress_tracker.create_event.return_value = SimpleNamespace(_progress_beat=True)
    metrics_tracker = MagicMock(name="metrics_tracker")
    metrics_tracker.start_agent = AsyncMock(return_value=None)
    metrics_tracker.stop_agent = AsyncMock(return_value=None)
    metrics_tracker.record_tokens = AsyncMock(return_value=None)
    edit_plan = EditorOutput(reasoning="parallel polish test", frontend_build_actions=actions)
    return SimpleNamespace(
        edit_plan=edit_plan,
        progress_tracker=progress_tracker,
        metrics_tracker=metrics_tracker,
        agent_name="EditingWorkflow",
        design_system_context="{}",
        backend_surface_for_builder=lambda: "{}",
        logic_surface="",
        app_context_json=lambda: '{"pages": [], "app_name": "Test"}',
        image_urls_json=lambda: "",
        app_language_code="en",
        current_config={"frontend": {"pages": []}},
        added_components=[],
        modified_names=[],
        removed_names=[],
        removed_page_uuids=[],
        existing_page_list=[],
        existing_pages={},
        updated_backend_config={"models": [], "handlers": []},
        updated_logic_config={"state": []},
    )


def _make_action(entry_name: str, priority: int = 0) -> FrontendBuildAction:
    return FrontendBuildAction(
        prompt=(
            f"Polish the mechanically-translated entry component `{entry_name}` "
            f"for platform compliance. Supporting modules to include in the "
            f"polish pass: Shell, Icons."
        ),
        priority=priority,
    )


async def _consume(generator):
    """Drain an async generator into a list of events."""
    events = []
    async for event in generator:
        events.append(event)
    return events


# ---------------------------------------------------------------------------
# Gate: multi-action design imports take the parallel path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_multi_action_design_import_takes_parallel_path():
    """Two or more actions + EDIT_PLAN_SOURCE="design_import" → parallel branch."""
    workflow = _make_workflow()
    actions = [_make_action("HomeContent"), _make_action("AboutContent")]
    state = _make_state(actions)
    from main_agent.constants import StateKeys
    ctx = _StubInvocationContext({StateKeys.EDIT_PLAN_SOURCE: "design_import"})

    parallel_path = AsyncMock(return_value=None)

    async def fake_parallel_path(c, s, sorted_actions):
        # Yield a sentinel so the caller's ``async for ... yield event``
        # exercises the branch end-to-end.
        yield SimpleNamespace(_parallel_branch=True)

    sequential_called = False

    async def fake_sequential_inner(c, s, action):
        nonlocal sequential_called
        sequential_called = True
        if False:
            yield  # pragma: no cover

    with (
        patch.object(workflow, "_run_phase_frontend_build_parallel_polish", side_effect=fake_parallel_path),
        patch.object(workflow, "_tick", new=AsyncMock(return_value=None)),
        patch.object(
            workflow,
            "_run_cbm_with_caps",
            side_effect=fake_sequential_inner,
        ),
    ):
        events = await _consume(workflow._run_phase_frontend_build(ctx, state))

    assert any(getattr(e, "_parallel_branch", False) for e in events), (
        "parallel branch was not invoked"
    )
    assert sequential_called is False, "sequential path leaked into the parallel run"


@pytest.mark.asyncio
async def test_single_action_design_import_takes_sequential_path():
    """A 1-action design import stays on the existing sequential path —
    we don't pay parallel overhead for a single page."""
    workflow = _make_workflow()
    actions = [_make_action("HomeContent")]
    state = _make_state(actions)
    from main_agent.constants import StateKeys
    ctx = _StubInvocationContext({StateKeys.EDIT_PLAN_SOURCE: "design_import"})

    parallel_called = False

    async def fake_parallel_path(c, s, sorted_actions):
        nonlocal parallel_called
        parallel_called = True
        if False:
            yield  # pragma: no cover

    async def fake_cbm(*args, **kwargs):
        if False:
            yield  # pragma: no cover

    with (
        patch.object(workflow, "_run_phase_frontend_build_parallel_polish", side_effect=fake_parallel_path),
        patch.object(workflow, "_tick", new=AsyncMock(return_value=None)),
        patch.object(workflow, "_run_cbm_with_caps", side_effect=fake_cbm),
        patch.object(workflow, "_run_tier2_fix_up_loop", side_effect=fake_cbm),
        patch.object(workflow, "_apply_frontend_build_post_dispatch", new=AsyncMock(return_value=None)),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.collect_frontend_artifact_sources",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.snapshot_to_bare_names",
            return_value={},
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_session_state_update",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_prompt_to_next_agent",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.render_action_prompt",
            return_value="prompt",
        ),
    ):
        await _consume(workflow._run_phase_frontend_build(ctx, state))

    assert parallel_called is False, "single-action design import incorrectly hit the parallel path"


@pytest.mark.asyncio
async def test_non_design_import_multi_action_takes_sequential_path():
    """Multiple actions BUT EDIT_PLAN_SOURCE != "design_import" (regular
    editing turn) keeps the sequential path — the parallel pool is gated
    to the design-import polish flow only."""
    workflow = _make_workflow()
    actions = [_make_action("Hero"), _make_action("Footer")]
    state = _make_state(actions)
    ctx = _StubInvocationContext({})  # no EDIT_PLAN_SOURCE

    parallel_called = False

    async def fake_parallel_path(c, s, sorted_actions):
        nonlocal parallel_called
        parallel_called = True
        if False:
            yield  # pragma: no cover

    async def fake_cbm(*args, **kwargs):
        if False:
            yield  # pragma: no cover

    with (
        patch.object(workflow, "_run_phase_frontend_build_parallel_polish", side_effect=fake_parallel_path),
        patch.object(workflow, "_tick", new=AsyncMock(return_value=None)),
        patch.object(workflow, "_run_cbm_with_caps", side_effect=fake_cbm),
        patch.object(workflow, "_run_tier2_fix_up_loop", side_effect=fake_cbm),
        patch.object(workflow, "_apply_frontend_build_post_dispatch", new=AsyncMock(return_value=None)),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.collect_frontend_artifact_sources",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.snapshot_to_bare_names",
            return_value={},
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_session_state_update",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_prompt_to_next_agent",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.render_action_prompt",
            return_value="prompt",
        ),
    ):
        await _consume(workflow._run_phase_frontend_build(ctx, state))

    assert parallel_called is False


# ---------------------------------------------------------------------------
# Per-round state contract + cleanup
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parallel_polish_round_state_setup_and_cleanup():
    """Verify each round sets per-slot state keys and pops them on exit."""
    workflow = _make_workflow()
    # 2 actions, fits in 1 round at NUM_SLOTS >= 2.
    actions = [_make_action("HomeContent"), _make_action("AboutContent")]
    state = _make_state(actions)
    ctx = _StubInvocationContext({})

    state_during_dispatch = {}

    async def fake_parallel_impl(c):
        # Capture the state observed during the dispatch — the workflow
        # has already populated per-slot keys here.
        state_during_dispatch.update(c.session.state)
        if False:
            yield  # pragma: no cover

    with (
        patch.object(workflow, "_tick", new=AsyncMock(return_value=None)),
        patch.object(workflow, "_apply_frontend_build_post_dispatch", new=AsyncMock(return_value=None)),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.component_builder_multiple_polish_parallel"
        ) as parallel_mock,
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.collect_frontend_artifact_sources",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.snapshot_to_bare_names",
            return_value={},
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_session_state_update",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.render_action_prompt",
            return_value="prompt",
        ),
    ):
        parallel_mock._run_async_impl = fake_parallel_impl
        await _consume(
            workflow._run_phase_frontend_build_parallel_polish(ctx, state, actions)
        )

    # During dispatch, the active slots' state keys must have been populated.
    active_slots = POLISH_SLOT_NAMES[:2]
    assert state_during_dispatch.get(STATE_EXECUTION_COMPONENTS_POLISH) == list(active_slots)
    # v2 fix: _polish_active_slots (for the inline overlap detector) and
    # _polish_owned_files__<slot> (for the edit_artifact_tool ownership
    # gate) must also be seeded before dispatch.
    assert state_during_dispatch.get("_polish_active_slots") == list(active_slots)
    expected_entries = ["HomeContent", "AboutContent"]
    for slot, expected_entry in zip(active_slots, expected_entries):
        assert polish_slot_input_state_key(slot) in state_during_dispatch
        assert polish_slot_expected_name_state_key(slot) in state_during_dispatch
        assert state_during_dispatch[polish_slot_tool_call_state_key(slot)] == 0
        assert state_during_dispatch[polish_slot_files_modified_state_key(slot)] == []
        assert state_during_dispatch[f"_polish_owned_files__{slot}"] == [
            f"codefocus_component:{expected_entry}.tsx"
        ]

    # After the round, all per-slot keys must be popped — including the
    # v2 ownership / active-slots keys so they don't leak between rounds.
    assert STATE_EXECUTION_COMPONENTS_POLISH not in ctx.session.state
    assert "_polish_active_slots" not in ctx.session.state
    for slot in POLISH_SLOT_NAMES:
        assert polish_slot_input_state_key(slot) not in ctx.session.state
        assert polish_slot_expected_name_state_key(slot) not in ctx.session.state
        assert polish_slot_tool_call_state_key(slot) not in ctx.session.state
        assert polish_slot_files_modified_state_key(slot) not in ctx.session.state
        assert f"_polish_owned_files__{slot}" not in ctx.session.state


@pytest.mark.asyncio
async def test_chunked_rounds_five_actions_split_into_3_and_2():
    """5 actions at NUM_SLOTS=3 → 2 rounds (3+2). Confirms the canonical
    fv83uavm 5-page case dispatches the parallel agent exactly twice."""
    workflow = _make_workflow()
    actions = [_make_action(f"Page{i}Content") for i in range(5)]
    state = _make_state(actions)
    ctx = _StubInvocationContext({})

    round_active_slots: list[list[str]] = []

    async def fake_parallel_impl(c):
        round_active_slots.append(list(c.session.state.get(STATE_EXECUTION_COMPONENTS_POLISH, [])))
        if False:
            yield  # pragma: no cover

    with (
        patch.object(workflow, "_tick", new=AsyncMock(return_value=None)),
        patch.object(workflow, "_apply_frontend_build_post_dispatch", new=AsyncMock(return_value=None)),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.component_builder_multiple_polish_parallel"
        ) as parallel_mock,
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.collect_frontend_artifact_sources",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.snapshot_to_bare_names",
            return_value={},
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_session_state_update",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.render_action_prompt",
            return_value="prompt",
        ),
    ):
        parallel_mock._run_async_impl = fake_parallel_impl
        await _consume(
            workflow._run_phase_frontend_build_parallel_polish(ctx, state, actions)
        )

    # With POLISH_NUM_SLOTS=3 (the default), expect 2 rounds: 3 then 2 slots.
    # The test is robust to env override — assert against POLISH_NUM_SLOTS directly.
    assert len(round_active_slots) >= 1
    if POLISH_NUM_SLOTS >= 5:
        # Single round at extreme parallelism.
        assert len(round_active_slots) == 1
        assert len(round_active_slots[0]) == 5
    elif POLISH_NUM_SLOTS == 3:
        # Canonical case: 3 + 2.
        assert len(round_active_slots) == 2
        assert len(round_active_slots[0]) == 3
        assert len(round_active_slots[1]) == 2
    # Total slot-assignments across rounds == 5 actions either way.
    assert sum(len(r) for r in round_active_slots) == 5


# ---------------------------------------------------------------------------
# Cross-slot module overlap detection
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cross_slot_module_overlap_logs_warning():
    """When two slots write the same filename in the same round, emit a
    structured ``cross_slot_module_overlap`` warning. We patch the
    structlog logger directly because ``caplog`` doesn't intercept
    structlog's output stream."""
    workflow = _make_workflow()
    actions = [_make_action("HomeContent"), _make_action("AboutContent")]
    state = _make_state(actions)
    ctx = _StubInvocationContext({})

    async def fake_parallel_impl_with_overlap(c):
        active = c.session.state.get(STATE_EXECUTION_COMPONENTS_POLISH, [])
        for slot in active:
            c.session.state[polish_slot_files_modified_state_key(slot)] = [
                "codefocus_module:Shell.tsx"
            ]
        if False:
            yield  # pragma: no cover

    with (
        patch.object(workflow, "_tick", new=AsyncMock(return_value=None)),
        patch.object(workflow, "_apply_frontend_build_post_dispatch", new=AsyncMock(return_value=None)),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.component_builder_multiple_polish_parallel"
        ) as parallel_mock,
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.collect_frontend_artifact_sources",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.snapshot_to_bare_names",
            return_value={},
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_session_state_update",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.render_action_prompt",
            return_value="prompt",
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.logger"
        ) as logger_mock,
    ):
        parallel_mock._run_async_impl = fake_parallel_impl_with_overlap
        await _consume(
            workflow._run_phase_frontend_build_parallel_polish(ctx, state, actions)
        )

    overlap_calls = [
        call
        for call in logger_mock.warning.call_args_list
        if call.args and call.args[0] == "cross_slot_module_overlap"
    ]
    assert len(overlap_calls) >= 1, (
        f"expected `cross_slot_module_overlap` warning; got {logger_mock.warning.call_args_list}"
    )
    payload = overlap_calls[0].kwargs
    assert payload.get("filename") == "codefocus_module:Shell.tsx"
    assert len(payload.get("slots") or []) >= 2


@pytest.mark.asyncio
async def test_no_overlap_warning_when_slots_write_disjoint_files():
    """The common case: slots write their own entry components, no overlap.
    No warning should fire."""
    workflow = _make_workflow()
    actions = [_make_action("HomeContent"), _make_action("AboutContent")]
    state = _make_state(actions)
    ctx = _StubInvocationContext({})

    async def fake_parallel_impl_disjoint(c):
        active = c.session.state.get(STATE_EXECUTION_COMPONENTS_POLISH, [])
        for i, slot in enumerate(active):
            c.session.state[polish_slot_files_modified_state_key(slot)] = [
                f"codefocus_component:Entry{i}.tsx"
            ]
        if False:
            yield  # pragma: no cover

    with (
        patch.object(workflow, "_tick", new=AsyncMock(return_value=None)),
        patch.object(workflow, "_apply_frontend_build_post_dispatch", new=AsyncMock(return_value=None)),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.component_builder_multiple_polish_parallel"
        ) as parallel_mock,
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.collect_frontend_artifact_sources",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.snapshot_to_bare_names",
            return_value={},
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_session_state_update",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.render_action_prompt",
            return_value="prompt",
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.logger"
        ) as logger_mock,
    ):
        parallel_mock._run_async_impl = fake_parallel_impl_disjoint
        await _consume(
            workflow._run_phase_frontend_build_parallel_polish(ctx, state, actions)
        )

    overlap_calls = [
        call
        for call in logger_mock.warning.call_args_list
        if call.args and call.args[0] == "cross_slot_module_overlap"
    ]
    assert overlap_calls == [], (
        f"false-positive overlap warning on disjoint writes: {overlap_calls}"
    )


@pytest.mark.asyncio
async def test_overlap_detector_runs_even_on_dispatch_cancellation():
    """Defence-in-depth: when ``_run_async_impl`` raises mid-stream
    (simulating WORKFLOW_TIMEOUT cancelling the SSE generator and
    propagating GeneratorExit through the ParallelAgent's TaskGroup),
    the post-round overlap detector must STILL fire because it lives
    in the dispatch ``finally:`` block. The v1 placement after the
    try/finally was unreachable on cancellation — the bug that hid
    cross-slot collisions in production app b9kwhxdv."""
    workflow = _make_workflow()
    actions = [_make_action("HomeContent"), _make_action("AboutContent")]
    state = _make_state(actions)
    ctx = _StubInvocationContext({})

    async def fake_parallel_impl_raises(c):
        # Both slots get a chance to record a write, then dispatch
        # raises (mimicking TimeoutError → GeneratorExit unwind).
        active = c.session.state.get(STATE_EXECUTION_COMPONENTS_POLISH, [])
        for slot in active:
            c.session.state[polish_slot_files_modified_state_key(slot)] = [
                "codefocus_module:Shell.tsx"
            ]
        raise TimeoutError("Workflow exceeded 1200s timeout")
        if False:
            yield  # pragma: no cover

    with (
        patch.object(workflow, "_tick", new=AsyncMock(return_value=None)),
        patch.object(workflow, "_apply_frontend_build_post_dispatch", new=AsyncMock(return_value=None)),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.component_builder_multiple_polish_parallel"
        ) as parallel_mock,
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.collect_frontend_artifact_sources",
            new=AsyncMock(return_value={}),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.snapshot_to_bare_names",
            return_value={},
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.push_session_state_update",
            new=AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.render_action_prompt",
            return_value="prompt",
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow.logger"
        ) as logger_mock,
    ):
        parallel_mock._run_async_impl = fake_parallel_impl_raises
        with pytest.raises(TimeoutError):
            await _consume(
                workflow._run_phase_frontend_build_parallel_polish(ctx, state, actions)
            )

    overlap_calls = [
        call
        for call in logger_mock.warning.call_args_list
        if call.args and call.args[0] == "cross_slot_module_overlap"
    ]
    assert len(overlap_calls) >= 1, (
        "expected overlap warning to fire from the dispatch finally: block, "
        "but no warning landed. Got: "
        f"{logger_mock.warning.call_args_list}"
    )


# ---------------------------------------------------------------------------
# Entry-name extraction
# ---------------------------------------------------------------------------


class TestEntryNameFromAction:
    def test_extracts_entry_from_polish_prompt(self):
        action = _make_action("StudentsContent")
        assert EditingWorkflow._entry_name_from_action(action) == "StudentsContent"

    def test_falls_back_when_no_match(self):
        action = SimpleNamespace(prompt="some unrelated prompt with no entry pattern")
        assert (
            EditingWorkflow._entry_name_from_action(action) == "frontend_build_action"
        )

    def test_handles_missing_prompt_attribute(self):
        action = SimpleNamespace()
        assert (
            EditingWorkflow._entry_name_from_action(action) == "frontend_build_action"
        )
