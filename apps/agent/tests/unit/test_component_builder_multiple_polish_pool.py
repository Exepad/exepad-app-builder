"""Unit tests for the static ComponentBuilderMultiplePolish slot pool.

Mirrors :mod:`tests.unit.test_component_builder_pool` — same shape, same
invariants — but exercises the polish-specific surface: env var, state-key
prefixes (``execution_components_polish``, ``_files_modified_this_turn__{slot}``,
``{slot}_tool_calls``), and the per-slot tool-call cap guardrail that
replaces the sequential ``_run_cbm_with_caps`` wrapper.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder_multiple_polish_pool import (
    NUM_SLOTS,
    SLOT_NAMES,
    STATE_EXECUTION_COMPONENTS_POLISH,
    chunk_components,
    component_builder_multiple_polish_parallel,
    component_builder_multiple_polish_slots,
    make_slot_agent,
    slot_expected_name_state_key,
    slot_files_modified_state_key,
    slot_input_state_key,
    slot_instruction_provider,
    slot_polish_tool_cap_guardrail,
    slot_skip_callback,
    slot_tool_call_state_key,
    _resolve_slot_count,
)
from main_agent.agents.utils.timeout_parallel_agent import TimeoutParallelAgent

pytestmark = [pytest.mark.unit]


# ---------------------------------------------------------------------------
# _resolve_slot_count — env var resolution
# ---------------------------------------------------------------------------


class TestResolveSlotCount:
    def test_default_when_env_unset(self, monkeypatch):
        monkeypatch.delenv("COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM", raising=False)
        assert _resolve_slot_count() == 3

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM", "4")
        assert _resolve_slot_count() == 4

    def test_clamp_low(self, monkeypatch):
        monkeypatch.setenv("COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM", "0")
        assert _resolve_slot_count() == 1

    def test_clamp_high(self, monkeypatch):
        """Polish pool is capped at 5 (smaller than CB pool's 10) — heavier per-dispatch."""
        monkeypatch.setenv("COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM", "100")
        assert _resolve_slot_count() == 5

    def test_invalid_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM", "not-a-number")
        assert _resolve_slot_count() == 3

    def test_one_reproduces_sequential(self, monkeypatch):
        """NUM_SLOTS=1 is the kill-switch — reproduces pre-parallel behavior."""
        monkeypatch.setenv("COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM", "1")
        assert _resolve_slot_count() == 1


# ---------------------------------------------------------------------------
# Slot name + count invariants
# ---------------------------------------------------------------------------


class TestSlotNamesAndCount:
    def test_slot_names_match_count(self):
        assert len(SLOT_NAMES) == NUM_SLOTS

    def test_slot_names_format(self):
        for i, name in enumerate(SLOT_NAMES, start=1):
            assert name == f"component_builder_multiple_polish_slot_{i}"

    def test_slot_names_are_unique(self):
        assert len(set(SLOT_NAMES)) == len(SLOT_NAMES)

    def test_state_key_helpers(self):
        slot = "component_builder_multiple_polish_slot_2"
        assert slot_input_state_key(slot) == f"{slot}_input"
        assert slot_expected_name_state_key(slot) == f"_expected_component_name__{slot}"
        assert slot_tool_call_state_key(slot) == f"{slot}_tool_calls"
        assert slot_files_modified_state_key(slot) == f"_files_modified_this_turn__{slot}"

    def test_polish_slot_prefix_matches_record_artifact_namespace(self):
        """The slot name prefix MUST match the ``_POLISH_SLOT_NAME_PREFIX`` constant
        in artifact_tools.py — that's how ``_record_artifact_write_kind`` decides
        to write to the per-slot dirty key. A mismatch silently breaks the
        per-slot accumulator and re-introduces the cross-slot list race."""
        from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
            _POLISH_SLOT_NAME_PREFIX,
        )

        for name in SLOT_NAMES:
            assert name.startswith(_POLISH_SLOT_NAME_PREFIX), (
                f"Slot {name!r} must start with {_POLISH_SLOT_NAME_PREFIX!r} so "
                f"artifact_tools._record_artifact_write_kind routes the write "
                f"to its per-slot key."
            )


# ---------------------------------------------------------------------------
# chunk_components helper (re-exported from the pool module)
# ---------------------------------------------------------------------------


class TestChunkComponents:
    def test_eleven_into_threes(self):
        chunks = list(chunk_components(range(11), 3))
        assert chunks == [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10]]

    def test_five_into_threes_two_rounds(self):
        """The canonical fv83uavm 5-page case: 5 actions, NUM_SLOTS=3 → 3+2 split."""
        chunks = list(chunk_components(range(5), 3))
        assert chunks == [[0, 1, 2], [3, 4]]

    def test_three_into_threes_single_round(self):
        chunks = list(chunk_components(range(3), 3))
        assert chunks == [[0, 1, 2]]

    def test_two_into_threes_short_round(self):
        chunks = list(chunk_components(range(2), 3))
        assert chunks == [[0, 1]]

    def test_empty_yields_no_chunks(self):
        assert list(chunk_components([], 3)) == []

    def test_size_one_serializes(self):
        chunks = list(chunk_components(range(3), 1))
        assert chunks == [[0], [1], [2]]

    def test_invalid_size_raises(self):
        with pytest.raises(ValueError):
            list(chunk_components(range(3), 0))


# ---------------------------------------------------------------------------
# slot_skip_callback — workflow_triage relevance gate
# ---------------------------------------------------------------------------


def _make_callback_ctx(state: dict) -> MagicMock:
    ctx = MagicMock()
    ctx.state = state
    return ctx


class TestSlotSkipCallback:
    def test_idle_when_slot_not_in_active_set(self):
        cb = slot_skip_callback("component_builder_multiple_polish_slot_3")
        ctx = _make_callback_ctx(
            {STATE_EXECUTION_COMPONENTS_POLISH: ["component_builder_multiple_polish_slot_1"]}
        )
        result = cb(ctx)
        assert result is not None
        assert "component_builder_multiple_polish_slot_3" in result.parts[0].text
        assert "idle" in result.parts[0].text.lower()

    def test_active_when_slot_in_set(self):
        cb = slot_skip_callback("component_builder_multiple_polish_slot_1")
        ctx = _make_callback_ctx(
            {
                STATE_EXECUTION_COMPONENTS_POLISH: [
                    "component_builder_multiple_polish_slot_1",
                    "component_builder_multiple_polish_slot_2",
                ]
            }
        )
        assert cb(ctx) is None

    def test_idle_when_state_missing_key(self):
        cb = slot_skip_callback("component_builder_multiple_polish_slot_1")
        ctx = _make_callback_ctx({})
        result = cb(ctx)
        assert result is not None

    def test_idle_when_state_value_is_none(self):
        cb = slot_skip_callback("component_builder_multiple_polish_slot_1")
        ctx = _make_callback_ctx({STATE_EXECUTION_COMPONENTS_POLISH: None})
        result = cb(ctx)
        assert result is not None

    def test_reads_polish_specific_key_not_creation_key(self):
        """STATE_EXECUTION_COMPONENTS_POLISH MUST be distinct from CreationWorkflow's
        STATE_EXECUTION_COMPONENTS so the two pools can't accidentally activate
        each other's slots if both were ever live in the same session."""
        from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder_pool import (
            STATE_EXECUTION_COMPONENTS,
        )

        assert STATE_EXECUTION_COMPONENTS_POLISH != STATE_EXECUTION_COMPONENTS

        cb = slot_skip_callback("component_builder_multiple_polish_slot_1")
        # Set the CreationWorkflow key instead — slot must still be idle.
        ctx = _make_callback_ctx(
            {STATE_EXECUTION_COMPONENTS: ["component_builder_multiple_polish_slot_1"]}
        )
        result = cb(ctx)
        assert result is not None


# ---------------------------------------------------------------------------
# slot_polish_tool_cap_guardrail — per-slot tool-call cap
# ---------------------------------------------------------------------------


def _make_tool_context(agent_name: str, state: dict) -> MagicMock:
    """Mock a ToolContext with ``agent_name``, ``state``, and ``actions.escalate``."""
    ctx = MagicMock()
    ctx.agent_name = agent_name
    ctx.state = state
    ctx.actions = MagicMock()
    ctx.actions.escalate = False
    return ctx


def _make_tool(name: str = "edit_artifact_tool") -> MagicMock:
    tool = MagicMock()
    tool.name = name
    return tool


class TestSlotPolishToolCapGuardrail:
    def test_first_call_increments_counter_returns_none(self):
        slot = "component_builder_multiple_polish_slot_1"
        state = {}
        ctx = _make_tool_context(slot, state)
        result = slot_polish_tool_cap_guardrail(_make_tool(), {}, ctx)
        assert result is None
        assert state[slot_tool_call_state_key(slot)] == 1

    def test_subsequent_calls_increment(self):
        slot = "component_builder_multiple_polish_slot_2"
        state = {slot_tool_call_state_key(slot): 5}
        ctx = _make_tool_context(slot, state)
        result = slot_polish_tool_cap_guardrail(_make_tool(), {}, ctx)
        assert result is None
        assert state[slot_tool_call_state_key(slot)] == 6

    def test_cap_breach_returns_terminal_error_and_escalates(self, monkeypatch):
        """When the counter exceeds the cap, return a terminal-flagged error
        AND set ``tool_context.actions.escalate=True`` so ADK exits the slot's
        agent loop."""
        # Patch the cap to a small value to keep the test fast.
        monkeypatch.setattr(
            "main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder_multiple_polish_pool.COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS",
            3,
        )
        slot = "component_builder_multiple_polish_slot_1"
        # Counter already at cap; this call (the 4th) MUST trigger termination.
        state = {slot_tool_call_state_key(slot): 3}
        ctx = _make_tool_context(slot, state)

        result = slot_polish_tool_cap_guardrail(_make_tool(), {}, ctx)
        assert result is not None
        assert result["success"] is False
        assert result["terminal"] is True
        assert "cap" in result["error"].lower()
        assert ctx.actions.escalate is True

    def test_non_polish_caller_is_ignored(self):
        """A non-polish-slot agent_name (e.g., the regular ComponentBuilderMultiple
        agent) must NOT be touched by this guardrail — it has its own
        outer-wrapper cap via ``_run_cbm_with_caps``."""
        slot = "component_builder_multiple_agent"  # not a polish slot
        state = {}
        ctx = _make_tool_context(slot, state)
        result = slot_polish_tool_cap_guardrail(_make_tool(), {}, ctx)
        assert result is None
        # Critically: no counter written for a non-polish caller.
        assert slot_tool_call_state_key(slot) not in state

    def test_empty_agent_name_is_ignored(self):
        state = {}
        ctx = _make_tool_context("", state)
        result = slot_polish_tool_cap_guardrail(_make_tool(), {}, ctx)
        assert result is None
        assert state == {}

    def test_counts_all_tool_kinds_not_just_writes(self):
        """The sequential outer wrapper counted every function call (including
        list/grep/describe). The per-slot guardrail must match."""
        slot = "component_builder_multiple_polish_slot_1"
        state = {}
        ctx = _make_tool_context(slot, state)

        slot_polish_tool_cap_guardrail(_make_tool("list_artifacts_tool"), {}, ctx)
        slot_polish_tool_cap_guardrail(_make_tool("search_artifacts_tool"), {}, ctx)
        slot_polish_tool_cap_guardrail(_make_tool("edit_artifact_tool"), {}, ctx)
        assert state[slot_tool_call_state_key(slot)] == 3


# ---------------------------------------------------------------------------
# slot_instruction_provider — cached prefix + per-round input
# ---------------------------------------------------------------------------


def _make_readonly_ctx(state: dict) -> MagicMock:
    ctx = MagicMock()
    ctx.state = state
    return ctx


class TestSlotInstructionProvider:
    def test_includes_per_round_input_from_state(self):
        slot = "component_builder_multiple_polish_slot_1"
        provider = slot_instruction_provider(slot)
        ctx = _make_readonly_ctx({slot_input_state_key(slot): '{"prompt":"polish HomeContent"}'})
        instruction = provider(ctx)
        assert "## YOUR INPUT" in instruction
        assert '"prompt":"polish HomeContent"' in instruction

    def test_empty_input_when_state_missing_key(self):
        provider = slot_instruction_provider("component_builder_multiple_polish_slot_1")
        ctx = _make_readonly_ctx({})
        instruction = provider(ctx)
        # Still emits the marker so the prefix shape is byte-stable.
        assert "## YOUR INPUT" in instruction

    def test_null_context_yields_prefix_only(self):
        """Calling with ``None`` (module-import-time prefix resolution) returns
        the byte-stable cached prefix + empty input section. Must not raise."""
        provider = slot_instruction_provider("component_builder_multiple_polish_slot_1")
        instruction = provider(None)
        assert isinstance(instruction, str)
        assert len(instruction) > 0

    def test_prefix_byte_stable_across_slots(self):
        """Two slots' instruction providers MUST emit byte-identical prefixes
        when given empty state. The trailing ``## YOUR INPUT\\n<state>\\n``
        block is the only per-slot diff, and only when state differs."""
        provider1 = slot_instruction_provider("component_builder_multiple_polish_slot_1")
        provider2 = slot_instruction_provider("component_builder_multiple_polish_slot_2")
        ctx1 = _make_readonly_ctx({})
        ctx2 = _make_readonly_ctx({})
        # Both empty-input ⇒ identical output. Vertex prompt-cache prefix
        # therefore hits the same key across slots.
        assert provider1(ctx1) == provider2(ctx2)

    def test_per_slot_input_isolation(self):
        """Slot 1's input MUST NOT bleed into slot 2's instruction body."""
        provider1 = slot_instruction_provider("component_builder_multiple_polish_slot_1")
        provider2 = slot_instruction_provider("component_builder_multiple_polish_slot_2")
        ctx = _make_readonly_ctx(
            {
                slot_input_state_key("component_builder_multiple_polish_slot_1"): "INPUT_FOR_SLOT_1",
                slot_input_state_key("component_builder_multiple_polish_slot_2"): "INPUT_FOR_SLOT_2",
            }
        )
        instruction1 = provider1(ctx)
        instruction2 = provider2(ctx)
        assert "INPUT_FOR_SLOT_1" in instruction1
        assert "INPUT_FOR_SLOT_2" not in instruction1
        assert "INPUT_FOR_SLOT_2" in instruction2
        assert "INPUT_FOR_SLOT_1" not in instruction2


# ---------------------------------------------------------------------------
# make_slot_agent — factory invariants
# ---------------------------------------------------------------------------


class TestMakeSlotAgent:
    def test_agent_name_matches_slot(self):
        slot = "component_builder_multiple_polish_slot_test"
        agent = make_slot_agent(slot)
        assert agent.name == slot

    def test_input_schema_is_none(self):
        """Per-round input flows through state, NOT ADK input binding —
        otherwise the parallel pool's per-slot input routing breaks."""
        agent = make_slot_agent("component_builder_multiple_polish_slot_test")
        assert agent.input_schema is None

    def test_callbacks_wired(self):
        agent = make_slot_agent("component_builder_multiple_polish_slot_test")
        assert agent.before_agent_callback is not None
        assert agent.before_tool_callback is slot_polish_tool_cap_guardrail


# ---------------------------------------------------------------------------
# Module singletons — pool + parallel agent
# ---------------------------------------------------------------------------


class TestComponentBuilderMultiplePolishParallel:
    def test_parallel_is_timeout_parallel_agent(self):
        assert isinstance(component_builder_multiple_polish_parallel, TimeoutParallelAgent)

    def test_parallel_has_expected_name(self):
        assert component_builder_multiple_polish_parallel.name == "component_builder_multiple_polish_parallel"

    def test_parallel_wraps_all_slots(self):
        assert list(component_builder_multiple_polish_parallel.sub_agents) == component_builder_multiple_polish_slots

    def test_slots_count_matches_num_slots(self):
        assert len(component_builder_multiple_polish_slots) == NUM_SLOTS

    def test_slots_have_unique_names(self):
        names = [s.name for s in component_builder_multiple_polish_slots]
        assert len(set(names)) == len(names)
        assert names == SLOT_NAMES

    def test_parallel_has_timeout_set(self):
        assert component_builder_multiple_polish_parallel.timeout_seconds is not None
        assert component_builder_multiple_polish_parallel.timeout_seconds > 0
