"""Unit tests for the static ComponentBuilder slot pool."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from google.adk.agents import LlmAgent

from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder_pool import (
    NUM_SLOTS,
    SLOT_NAMES,
    STATE_EXECUTION_COMPONENTS,
    chunk_components,
    component_builder_parallel,
    component_builder_slots,
    make_slot_agent,
    slot_expected_name_state_key,
    slot_expected_save_tool_state_key,
    slot_input_state_key,
    slot_instruction_provider,
    slot_save_guardrail,
    slot_skip_callback,
    _resolve_slot_count,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
    _MAX_TOTAL_SAVE_CALLS,
    _MODULE_SAVE_TOOL_NAME,
    _SAVE_TOOL_NAME,
    _TERMINAL_LATCH_KEY,
)
from main_agent.agents.utils.timeout_parallel_agent import TimeoutParallelAgent


# ---------------------------------------------------------------------------
# _resolve_slot_count — env var resolution
# ---------------------------------------------------------------------------


class TestResolveSlotCount:
    def test_default_when_env_unset(self, monkeypatch):
        monkeypatch.delenv("COMPONENT_BUILDER_PARALLELISM", raising=False)
        assert _resolve_slot_count() == 6

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("COMPONENT_BUILDER_PARALLELISM", "6")
        assert _resolve_slot_count() == 6

    def test_clamp_low(self, monkeypatch):
        monkeypatch.setenv("COMPONENT_BUILDER_PARALLELISM", "0")
        assert _resolve_slot_count() == 1

    def test_clamp_high(self, monkeypatch):
        monkeypatch.setenv("COMPONENT_BUILDER_PARALLELISM", "100")
        assert _resolve_slot_count() == 10

    def test_invalid_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("COMPONENT_BUILDER_PARALLELISM", "not-a-number")
        assert _resolve_slot_count() == 6

    def test_one_reproduces_sequential(self, monkeypatch):
        """NUM_SLOTS=1 is the explicit kill-switch escape hatch."""
        monkeypatch.setenv("COMPONENT_BUILDER_PARALLELISM", "1")
        assert _resolve_slot_count() == 1


# ---------------------------------------------------------------------------
# Slot name + count invariants
# ---------------------------------------------------------------------------


class TestSlotNamesAndCount:
    def test_slot_names_match_count(self):
        assert len(SLOT_NAMES) == NUM_SLOTS

    def test_slot_names_format(self):
        for i, name in enumerate(SLOT_NAMES, start=1):
            assert name == f"component_builder_slot_{i}"

    def test_slot_names_are_unique(self):
        assert len(set(SLOT_NAMES)) == len(SLOT_NAMES)

    def test_state_key_helpers(self):
        assert slot_input_state_key("foo") == "foo_input"
        assert slot_expected_name_state_key("foo") == "_expected_component_name__foo"
        assert slot_expected_save_tool_state_key("foo") == "_expected_save_tool_name__foo"


# ---------------------------------------------------------------------------
# chunk_components helper
# ---------------------------------------------------------------------------


class TestChunkComponents:
    def test_eleven_into_fours(self):
        chunks = list(chunk_components(range(11), 4))
        assert chunks == [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10]]

    def test_four_into_fours_single_round(self):
        chunks = list(chunk_components(range(4), 4))
        assert chunks == [[0, 1, 2, 3]]

    def test_three_into_fours_short_round(self):
        chunks = list(chunk_components(range(3), 4))
        assert chunks == [[0, 1, 2]]

    def test_empty_yields_no_chunks(self):
        assert list(chunk_components([], 4)) == []

    def test_size_one_serializes(self):
        chunks = list(chunk_components(range(3), 1))
        assert chunks == [[0], [1], [2]]

    def test_invalid_size_raises(self):
        with pytest.raises(ValueError):
            list(chunk_components(range(3), 0))


# ---------------------------------------------------------------------------
# slot_skip_callback — relevance gate
# ---------------------------------------------------------------------------


def _make_callback_ctx(state: dict) -> MagicMock:
    ctx = MagicMock()
    ctx.state = state
    return ctx


class TestSlotSkipCallback:
    def test_idle_when_slot_not_in_active_set(self):
        cb = slot_skip_callback("component_builder_slot_3")
        ctx = _make_callback_ctx({STATE_EXECUTION_COMPONENTS: ["component_builder_slot_1"]})
        result = cb(ctx)
        assert result is not None
        assert "component_builder_slot_3" in result.parts[0].text
        assert "idle" in result.parts[0].text.lower()

    def test_active_when_slot_in_set(self):
        cb = slot_skip_callback("component_builder_slot_1")
        ctx = _make_callback_ctx(
            {STATE_EXECUTION_COMPONENTS: ["component_builder_slot_1", "component_builder_slot_2"]}
        )
        assert cb(ctx) is None

    def test_idle_when_state_missing_key(self):
        cb = slot_skip_callback("component_builder_slot_1")
        ctx = _make_callback_ctx({})
        result = cb(ctx)
        assert result is not None

    def test_idle_when_state_value_is_none(self):
        cb = slot_skip_callback("component_builder_slot_1")
        ctx = _make_callback_ctx({STATE_EXECUTION_COMPONENTS: None})
        result = cb(ctx)
        assert result is not None


# ---------------------------------------------------------------------------
# slot_instruction_provider — cached prefix + per-round input
# ---------------------------------------------------------------------------


def _make_readonly_ctx(state: dict) -> MagicMock:
    ctx = MagicMock()
    ctx.state = state
    return ctx


class TestSlotInstructionProvider:
    def test_appends_state_input(self):
        provider = slot_instruction_provider("component_builder_slot_1")
        ctx = _make_readonly_ctx(
            {slot_input_state_key("component_builder_slot_1"): '{"component_name":"Header"}'}
        )
        instruction = provider(ctx)
        assert "## YOUR INPUT" in instruction
        assert '"component_name":"Header"' in instruction

    def test_handles_none_context(self):
        provider = slot_instruction_provider("component_builder_slot_1")
        instruction = provider(None)
        assert "## YOUR INPUT" in instruction
        # Per-round input is empty, but the cached prefix must still be present.
        assert len(instruction) > 100

    def test_handles_missing_state_key(self):
        provider = slot_instruction_provider("component_builder_slot_1")
        ctx = _make_readonly_ctx({})
        instruction = provider(ctx)
        assert "## YOUR INPUT" in instruction

    def test_prefix_is_byte_stable_across_rounds(self):
        """Two calls with different state inputs must produce identical bytes
        for the cached prefix region (everything before '## YOUR INPUT')."""
        provider = slot_instruction_provider("component_builder_slot_1")
        ctx1 = _make_readonly_ctx(
            {slot_input_state_key("component_builder_slot_1"): '{"x":1}'}
        )
        ctx2 = _make_readonly_ctx(
            {slot_input_state_key("component_builder_slot_1"): '{"y":2}'}
        )
        out1 = provider(ctx1)
        out2 = provider(ctx2)
        prefix1 = out1.split("## YOUR INPUT")[0]
        prefix2 = out2.split("## YOUR INPUT")[0]
        assert prefix1 == prefix2

    def test_each_slot_reads_its_own_state_key(self):
        provider1 = slot_instruction_provider("component_builder_slot_1")
        provider2 = slot_instruction_provider("component_builder_slot_2")
        ctx = _make_readonly_ctx(
            {
                slot_input_state_key("component_builder_slot_1"): '{"slot":"one"}',
                slot_input_state_key("component_builder_slot_2"): '{"slot":"two"}',
            }
        )
        assert '"slot":"one"' in provider1(ctx)
        assert '"slot":"two"' not in provider1(ctx)
        assert '"slot":"two"' in provider2(ctx)
        assert '"slot":"one"' not in provider2(ctx)


# ---------------------------------------------------------------------------
# slot_save_guardrail — bleed prevention + call cap, slot-aware
# ---------------------------------------------------------------------------


def _make_tool(name: str = _SAVE_TOOL_NAME) -> MagicMock:
    tool = MagicMock()
    tool.name = name
    return tool


def _make_tool_context(agent_name: str, state: dict) -> MagicMock:
    tc = MagicMock()
    tc.agent_name = agent_name
    tc.state = state
    tc.actions = MagicMock()
    return tc


class TestSlotSaveGuardrail:
    def test_non_save_tool_passes_through(self):
        tool = _make_tool(name="some_other_tool")
        tc = _make_tool_context("component_builder_slot_1", {})
        assert slot_save_guardrail(tool, {"component_name": "Foo"}, tc) is None

    def test_correct_component_returns_none(self):
        tool = _make_tool()
        tc = _make_tool_context(
            "component_builder_slot_1",
            {slot_expected_name_state_key("component_builder_slot_1"): "Header"},
        )
        result = slot_save_guardrail(tool, {"component_name": "Header"}, tc)
        assert result is None

    def test_cross_component_bleed_blocked(self):
        tool = _make_tool()
        tc = _make_tool_context(
            "component_builder_slot_1",
            {slot_expected_name_state_key("component_builder_slot_1"): "Header"},
        )
        result = slot_save_guardrail(tool, {"component_name": "Footer"}, tc)
        assert result is not None
        assert result["success"] is False
        assert "Header" in result["error"]
        assert "Footer" in result["error"]

    def test_module_name_arg_also_checked(self):
        """The module save tool passes ``module_name``, not ``component_name``."""
        tool = _make_tool(name=_MODULE_SAVE_TOOL_NAME)
        tc = _make_tool_context(
            "component_builder_slot_1",
            {
                slot_expected_name_state_key("component_builder_slot_1"): "Charts",
                slot_expected_save_tool_state_key(
                    "component_builder_slot_1"
                ): _MODULE_SAVE_TOOL_NAME,
            },
        )
        # Matching module name → allowed
        assert slot_save_guardrail(tool, {"module_name": "Charts"}, tc) is None
        # Mismatched module name → blocked
        result = slot_save_guardrail(tool, {"module_name": "Sidebar"}, tc)
        assert result is not None
        assert result["success"] is False

    def test_uses_tool_context_agent_name(self):
        """Two slots running concurrently must each resolve their OWN expected name."""
        tool = _make_tool()
        shared_state = {
            slot_expected_name_state_key("component_builder_slot_1"): "Header",
            slot_expected_name_state_key("component_builder_slot_2"): "Footer",
        }

        tc_slot1 = _make_tool_context("component_builder_slot_1", shared_state)
        tc_slot2 = _make_tool_context("component_builder_slot_2", shared_state)

        # slot_1 saving Header: allowed
        assert slot_save_guardrail(tool, {"component_name": "Header"}, tc_slot1) is None
        # slot_2 saving Footer: allowed
        assert slot_save_guardrail(tool, {"component_name": "Footer"}, tc_slot2) is None
        # slot_1 trying to save Footer: blocked
        r = slot_save_guardrail(tool, {"component_name": "Footer"}, tc_slot1)
        assert r is not None and r["success"] is False

    def test_call_cap_keyed_by_component_name_not_slot(self):
        """Cap counter follows the component across slot reuse between rounds."""
        tool = _make_tool()
        state = {slot_expected_name_state_key("component_builder_slot_1"): "Header"}
        tc = _make_tool_context("component_builder_slot_1", state)

        # First _MAX_TOTAL_SAVE_CALLS attempts go through.
        for i in range(_MAX_TOTAL_SAVE_CALLS):
            assert slot_save_guardrail(tool, {"component_name": "Header"}, tc) is None
            assert state["_save_tool_calls:Header"] == i + 1

        # Cap+1: blocked with terminal=True
        result = slot_save_guardrail(tool, {"component_name": "Header"}, tc)
        assert result is not None
        assert result["success"] is False
        assert result.get("terminal") is True

    def test_call_cap_does_not_carry_across_components(self):
        """Slot reused for two different components: each gets its own counter."""
        tool = _make_tool()
        state = {}
        tc = _make_tool_context("component_builder_slot_1", state)

        # Round 1: build Header — exhaust the cap
        state[slot_expected_name_state_key("component_builder_slot_1")] = "Header"
        for _ in range(_MAX_TOTAL_SAVE_CALLS):
            slot_save_guardrail(tool, {"component_name": "Header"}, tc)
        # Header is now at the cap
        assert state["_save_tool_calls:Header"] == _MAX_TOTAL_SAVE_CALLS

        # Round 2: same slot now builds Footer — counter must start fresh
        state[slot_expected_name_state_key("component_builder_slot_1")] = "Footer"
        result = slot_save_guardrail(tool, {"component_name": "Footer"}, tc)
        assert result is None
        assert state["_save_tool_calls:Footer"] == 1

    def test_terminal_latch_short_circuits(self):
        tool = _make_tool()
        state = {
            slot_expected_name_state_key("component_builder_slot_1"): "Header",
            _TERMINAL_LATCH_KEY: {"Header": "fatal: blocked"},
        }
        tc = _make_tool_context("component_builder_slot_1", state)
        result = slot_save_guardrail(tool, {"component_name": "Header"}, tc)
        assert result is not None
        assert result["success"] is False
        assert result.get("terminal") is True

    def test_wrong_save_tool_blocked(self):
        """When state expects module save tool, a component-tool call is rejected."""
        # State expects MODULE save tool, but the LLM calls the COMPONENT save tool.
        wrong_tool = _make_tool(name=_SAVE_TOOL_NAME)
        state = {
            slot_expected_name_state_key("component_builder_slot_1"): "Charts",
            slot_expected_save_tool_state_key(
                "component_builder_slot_1"
            ): _MODULE_SAVE_TOOL_NAME,
        }
        tc = _make_tool_context("component_builder_slot_1", state)
        result = slot_save_guardrail(wrong_tool, {"component_name": "Charts"}, tc)
        assert result is not None
        assert result["success"] is False
        assert "module" in result["error"].lower()


# ---------------------------------------------------------------------------
# make_slot_agent — factory shape
# ---------------------------------------------------------------------------


class TestMakeSlotAgent:
    def test_returns_llm_agent(self):
        agent = make_slot_agent("component_builder_slot_test")
        assert isinstance(agent, LlmAgent)

    def test_name_matches_argument(self):
        agent = make_slot_agent("component_builder_slot_test")
        assert agent.name == "component_builder_slot_test"

    def test_input_schema_is_none(self):
        agent = make_slot_agent("component_builder_slot_test")
        assert agent.input_schema is None
        assert agent.output_schema is None

    def test_has_skip_callback(self):
        agent = make_slot_agent("component_builder_slot_test")
        assert agent.before_agent_callback is not None

    def test_has_save_guardrail(self):
        agent = make_slot_agent("component_builder_slot_test")
        assert agent.before_tool_callback is slot_save_guardrail

    def test_include_contents_none(self):
        agent = make_slot_agent("component_builder_slot_test")
        assert agent.include_contents == "none"


# ---------------------------------------------------------------------------
# Module-level pool singleton invariants
# ---------------------------------------------------------------------------


class TestPoolSingletons:
    def test_pool_is_timeout_parallel_agent(self):
        assert isinstance(component_builder_parallel, TimeoutParallelAgent)

    def test_pool_name(self):
        assert component_builder_parallel.name == "component_builder_parallel"

    def test_pool_sub_agents_equal_slots_list(self):
        assert list(component_builder_parallel.sub_agents) == component_builder_slots

    def test_pool_sub_agents_share_identity_with_slot_list(self):
        """No copying: ParallelAgent holds the same LlmAgent instances as
        component_builder_slots. This is what guarantees the slot pool
        is a true process-level singleton — not a per-construction copy."""
        for parallel_sub, slot in zip(
            component_builder_parallel.sub_agents, component_builder_slots
        ):
            assert parallel_sub is slot

    def test_pool_size_matches_num_slots(self):
        assert len(component_builder_parallel.sub_agents) == NUM_SLOTS
        assert len(component_builder_slots) == NUM_SLOTS

    def test_slot_names_in_pool_unique(self):
        names = [sa.name for sa in component_builder_parallel.sub_agents]
        assert names == SLOT_NAMES
        assert len(set(names)) == len(names)

    def test_pool_has_timeout(self):
        assert component_builder_parallel.timeout_seconds is not None
        assert component_builder_parallel.timeout_seconds > 0
