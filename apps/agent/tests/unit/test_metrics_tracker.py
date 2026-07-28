"""Tests for MetricsTracker — timing, token tracking, and cost calculation.

Tests cover:
- start_workflow / start_agent / stop_agent lifecycle
- record_tokens accumulation
- get_workflow_duration
- get_summary aggregation
- format_summary human-readable output
"""

import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from main_agent.agents.orchestrator.models.timing_tracker import (
    MetricsTracker,
    _empty_tokens,
)
from tests.fixtures.mock_ctx import create_mock_ctx


@pytest.fixture
def tracker():
    """Create a MetricsTracker instance."""
    return MetricsTracker()


def _make_usage_metadata(**kwargs):
    """Create a mock GenerateContentResponseUsageMetadata."""
    meta = MagicMock()
    meta.total_token_count = kwargs.get("total", 100)
    meta.prompt_token_count = kwargs.get("prompt", 50)
    meta.candidates_token_count = kwargs.get("candidates", 40)
    meta.thoughts_token_count = kwargs.get("thoughts", 5)
    meta.tool_use_prompt_token_count = kwargs.get("tool_use", 3)
    meta.cached_content_token_count = kwargs.get("cached", 2)
    return meta


# =============================================================================
# _empty_tokens
# =============================================================================


class TestEmptyTokens:
    """Tests for the _empty_tokens helper."""

    @pytest.mark.unit
    def test_returns_zero_dict(self):
        """All token fields should be zero."""
        tokens = _empty_tokens()
        assert tokens["total_tokens"] == 0
        assert tokens["prompt_tokens"] == 0
        assert tokens["candidates_tokens"] == 0
        assert tokens["thoughts_tokens"] == 0
        assert tokens["tool_use_tokens"] == 0
        assert tokens["cached_tokens"] == 0
        assert tokens["cost"] == 0.0


# =============================================================================
# start_workflow
# =============================================================================


class TestStartWorkflow:
    """Tests for starting workflow tracking."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_initializes_state(self, tracker):
        """start_workflow sets initial tracking state."""
        ctx = create_mock_ctx()

        with patch(
            "main_agent.agents.orchestrator.models.timing_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            await tracker.start_workflow(ctx)

            state = mock_push.call_args[0][1]
            assert "workflow_start_time" in state
            assert "workflow_start_iso" in state
            assert state["agent_metrics"] == {}
            assert state["current_agent_metrics"] is None


# =============================================================================
# start_agent / stop_agent
# =============================================================================


class TestAgentLifecycle:
    """Tests for starting and stopping agent tracking."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_start_agent_sets_state(self, tracker):
        """start_agent records agent name and start time."""
        ctx = create_mock_ctx(session_state={"current_agent_metrics": None})

        with patch(
            "main_agent.agents.orchestrator.models.timing_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            await tracker.start_agent(ctx, "AppCreator", model="gemini-3-flash-preview")

            state = mock_push.call_args[0][1]
            assert state["current_agent_metrics"] == "AppCreator"
            assert state["current_agent_model"] == "gemini-3-flash-preview"
            assert isinstance(state["current_agent_start_time"], float)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_stop_agent_returns_metrics(self, tracker):
        """stop_agent returns AgentMetrics with duration and tokens."""
        start_time = time.time() - 5.0  # 5 seconds ago
        ctx = create_mock_ctx(
            session_state={
                "current_agent_metrics": "AppCreator",
                "current_agent_start_time": start_time,
                "current_agent_tokens": {
                    "total_tokens": 200,
                    "prompt_tokens": 100,
                    "candidates_tokens": 80,
                    "thoughts_tokens": 10,
                    "tool_use_tokens": 5,
                    "cached_tokens": 5,
                    "cost": 0.001,
                },
                "current_agent_model": "gemini-3-flash-preview",
                "agent_metrics": {},
                "agent_timings": {},
            }
        )

        with patch(
            "main_agent.agents.orchestrator.models.timing_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ):
            metrics = await tracker.stop_agent(ctx)

        assert metrics is not None
        assert metrics["duration"] >= 4.0  # At least ~5 seconds
        assert metrics["total_tokens"] == 200
        assert metrics["prompt_tokens"] == 100
        assert metrics["cost"] == pytest.approx(0.001)
        assert metrics["model"] == "gemini-3-flash-preview"

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_stop_agent_returns_none_when_not_tracking(self, tracker):
        """stop_agent returns None when no agent is being tracked."""
        ctx = create_mock_ctx(
            session_state={
                "current_agent_metrics": None,
                "current_agent_start_time": None,
            }
        )

        metrics = await tracker.stop_agent(ctx)
        assert metrics is None

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_stop_agent_appends_generation_step(self, tracker):
        """stop_agent appends a generation_steps record so the GCS
        debug log isn't empty. Regression: coje33ih's
        debug/generation_steps.json shipped as ``[]`` because no caller
        wrote to the field — fixed by writing on stop_agent."""
        start_time = time.time() - 3.0
        ctx = create_mock_ctx(
            session_state={
                "current_agent_metrics": "AppCreator",
                "current_agent_start_time": start_time,
                "current_agent_start_iso": "2026-05-12T18:51:00+00:00",
                "current_agent_tokens": {
                    "total_tokens": 150,
                    "prompt_tokens": 100,
                    "candidates_tokens": 40,
                    "thoughts_tokens": 5,
                    "tool_use_tokens": 3,
                    "cached_tokens": 50,
                    "cost": 0.002,
                },
                "current_agent_model": "gemini-3-flash-preview",
                "agent_metrics": {},
                "agent_timings": {},
                "generation_steps": [],
            }
        )
        captured: dict = {}

        async def _capture(_ctx, updates):
            captured.update(updates)

        with patch(
            "main_agent.agents.orchestrator.models.timing_tracker.push_session_state_update",
            new=_capture,
        ):
            await tracker.stop_agent(ctx)

        steps = captured.get("generation_steps")
        assert isinstance(steps, list) and len(steps) == 1
        step = steps[0]
        assert step["name"] == "AppCreator"
        assert step["started_at"] == "2026-05-12T18:51:00+00:00"
        assert step["finished_at"] is not None
        assert step["duration_sec"] >= 2.0
        assert step["model"] == "gemini-3-flash-preview"
        assert step["total_tokens"] == 150
        assert step["cached_tokens"] == 50
        assert step["cost"] == pytest.approx(0.002)

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_stop_agent_appends_to_existing_steps_list(self, tracker):
        """Subsequent stop_agent calls preserve prior step records."""
        prior = [{"name": "PreCreator", "duration_sec": 1.2}]
        ctx = create_mock_ctx(
            session_state={
                "current_agent_metrics": "Creator",
                "current_agent_start_time": time.time() - 2.0,
                "current_agent_start_iso": "2026-05-12T18:52:00+00:00",
                "current_agent_tokens": _empty_tokens(),
                "current_agent_model": "gemini-3-flash-preview",
                "agent_metrics": {},
                "agent_timings": {},
                "generation_steps": list(prior),
            }
        )
        captured: dict = {}

        async def _capture(_ctx, updates):
            captured.update(updates)

        with patch(
            "main_agent.agents.orchestrator.models.timing_tracker.push_session_state_update",
            new=_capture,
        ):
            await tracker.stop_agent(ctx)

        steps = captured["generation_steps"]
        assert [s["name"] for s in steps] == ["PreCreator", "Creator"]

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_stop_agent_accumulates_multiple_runs(self, tracker):
        """Multiple start/stop cycles for same agent accumulate metrics."""
        start_time = time.time() - 2.0
        ctx = create_mock_ctx(
            session_state={
                "current_agent_metrics": "AppCreator",
                "current_agent_start_time": start_time,
                "current_agent_tokens": {
                    "total_tokens": 100,
                    "prompt_tokens": 50,
                    "candidates_tokens": 40,
                    "thoughts_tokens": 5,
                    "tool_use_tokens": 3,
                    "cached_tokens": 2,
                    "cost": 0.001,
                },
                "current_agent_model": "gemini-3-flash-preview",
                "agent_metrics": {
                    "AppCreator": {
                        "duration": 3.0,
                        "total_tokens": 150,
                        "prompt_tokens": 75,
                        "candidates_tokens": 60,
                        "thoughts_tokens": 8,
                        "tool_use_tokens": 4,
                        "cached_tokens": 3,
                        "cost": 0.002,
                        "model": "gemini-3-flash-preview",
                    }
                },
                "agent_timings": {"AppCreator": 3.0},
            }
        )

        with patch(
            "main_agent.agents.orchestrator.models.timing_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            metrics = await tracker.stop_agent(ctx)

        assert metrics is not None
        assert metrics["total_tokens"] == 100  # Current run tokens


# =============================================================================
# record_tokens
# =============================================================================


class TestRecordTokens:
    """Tests for token usage recording."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_accumulates_tokens(self, tracker):
        """record_tokens accumulates token counts."""
        ctx = create_mock_ctx(
            session_state={
                "current_agent_tokens": _empty_tokens(),
                "current_agent_metrics": "AppCreator",
            }
        )

        usage = _make_usage_metadata(total=100, prompt=50, candidates=40)

        with patch(
            "main_agent.agents.orchestrator.models.timing_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            with patch(
                "main_agent.agents.orchestrator.app_types.shared.services.pricing_service.calculate_gemini_cost",
                return_value=0.0005,
            ):
                await tracker.record_tokens(ctx, usage)

                state = mock_push.call_args[0][1]
                tokens = state["current_agent_tokens"]
                assert tokens["total_tokens"] == 100
                assert tokens["prompt_tokens"] == 50
                assert tokens["candidates_tokens"] == 40
                assert tokens["cost"] == pytest.approx(0.0005)


# =============================================================================
# get_workflow_duration
# =============================================================================


class TestGetWorkflowDuration:
    """Tests for workflow duration calculation."""

    @pytest.mark.unit
    def test_returns_duration(self, tracker):
        """Returns elapsed time since workflow start."""
        start = time.time() - 10.0
        ctx = create_mock_ctx(session_state={"workflow_start_time": start})

        duration = tracker.get_workflow_duration(ctx)
        assert duration >= 9.0

    @pytest.mark.unit
    def test_returns_none_when_not_started(self, tracker):
        """Returns None when workflow hasn't been started."""
        ctx = create_mock_ctx(session_state={})

        duration = tracker.get_workflow_duration(ctx)
        assert duration is None


# =============================================================================
# get_summary
# =============================================================================


class TestGetSummary:
    """Tests for the complete metrics summary."""

    @pytest.mark.unit
    def test_summary_structure(self, tracker):
        """Summary contains all expected fields."""
        ctx = create_mock_ctx(
            session_state={
                "workflow_start_time": time.time() - 30.0,
                "workflow_start_iso": "2026-01-01T00:00:00Z",
                "agent_metrics": {
                    "AppCreator": {
                        "duration": 10.0,
                        "total_tokens": 500,
                        "prompt_tokens": 250,
                        "candidates_tokens": 200,
                        "thoughts_tokens": 25,
                        "tool_use_tokens": 15,
                        "cached_tokens": 10,
                        "cost": 0.005,
                        "model": "gemini-3-flash-preview",
                    },
                    "DesignSystemBuilder": {
                        "duration": 5.0,
                        "total_tokens": 200,
                        "prompt_tokens": 100,
                        "candidates_tokens": 80,
                        "thoughts_tokens": 10,
                        "tool_use_tokens": 5,
                        "cached_tokens": 5,
                        "cost": 0.002,
                        "model": "gemini-3-flash-preview",
                    },
                },
            }
        )

        summary = tracker.get_summary(ctx)

        assert summary["workflow_duration"] >= 29.0
        assert summary["workflow_start_iso"] == "2026-01-01T00:00:00Z"
        assert len(summary["agent_metrics"]) == 2
        assert summary["totals"]["total_tokens"] == 700
        assert summary["totals"]["prompt_tokens"] == 350
        assert summary["totals"]["cost"] == pytest.approx(0.007)
        assert summary["totals"]["agent_time"] == pytest.approx(15.0)

    @pytest.mark.unit
    def test_summary_empty_metrics(self, tracker):
        """Summary with no agents returns zero totals."""
        ctx = create_mock_ctx(
            session_state={
                "workflow_start_time": time.time() - 1.0,
                "agent_metrics": {},
            }
        )

        summary = tracker.get_summary(ctx)
        assert summary["totals"]["total_tokens"] == 0
        assert summary["totals"]["cost"] == 0.0


# =============================================================================
# format_summary
# =============================================================================


class TestFormatSummary:
    """Tests for human-readable summary formatting."""

    @pytest.mark.unit
    def test_format_contains_key_sections(self, tracker):
        """Formatted summary contains expected sections."""
        ctx = create_mock_ctx(
            session_state={
                "workflow_start_time": time.time() - 30.0,
                "workflow_start_iso": "2026-01-01T00:00:00Z",
                "agent_metrics": {
                    "AppCreator": {
                        "duration": 10.0,
                        "total_tokens": 500,
                        "prompt_tokens": 250,
                        "candidates_tokens": 200,
                        "thoughts_tokens": 25,
                        "tool_use_tokens": 15,
                        "cached_tokens": 10,
                        "cost": 0.005,
                        "model": "gemini-3-flash",
                    },
                },
            }
        )

        output = tracker.format_summary(ctx)

        assert "WORKFLOW METRICS SUMMARY" in output
        assert "AGENT BREAKDOWN" in output
        assert "TOKEN BREAKDOWN" in output
        assert "TIMING BREAKDOWN" in output
        assert "COST SUMMARY" in output
        assert "AppCreator" in output

    @pytest.mark.unit
    def test_runtime_probes_summary_emitted_when_log_present(self, tracker):
        """Surveyor Phase 2 Class B telemetry — when ``runtime_probe_log``
        is populated, format_summary must emit the aggregate block."""
        ctx = create_mock_ctx(
            session_state={
                "workflow_start_time": time.time() - 5.0,
                "workflow_start_iso": "2026-01-01T00:00:00Z",
                "runtime_probe_log": [
                    {"tool": "execute_handler_tool", "duration_ms": 87},
                    {"tool": "execute_handler_tool", "duration_ms": 52, "error": "http_500"},
                    {"tool": "query_db_tool", "duration_ms": 12},
                    {"tool": "screenshot_preview_tool", "duration_ms": 812, "byte_size": 14_321},
                ],
            }
        )

        output = tracker.format_summary(ctx)
        assert "RUNTIME PROBES SUMMARY" in output
        assert "execute_handler_tool" in output
        assert "query_db_tool" in output
        assert "screenshot_preview_tool" in output
        # 87 + 52 + 12 + 812 = 963 ms = 0.96s
        assert "Total probe overhead: 0.96s" in output
        # 2 calls of execute_handler_tool aggregated, 1 of which errored
        # Find the line for execute_handler_tool and check it shows '2' calls + '1' error
        eh_line = next(
            line for line in output.splitlines()
            if "execute_handler_tool" in line and "Calls" not in line
        )
        # Format: "  execute_handler_tool                  2        139        1          0"
        parts = eh_line.split()
        assert parts[1] == "2"   # calls
        assert parts[2] == "139"  # total_ms (87 + 52)
        assert parts[3] == "1"   # errors

    @pytest.mark.unit
    def test_runtime_probes_summary_omitted_when_no_log(self, tracker):
        """When no Class B probes ran, the section MUST NOT appear —
        otherwise dark-ship deployments will see noise in every metrics
        summary."""
        ctx = create_mock_ctx(
            session_state={"workflow_start_time": time.time() - 1.0}
        )
        output = tracker.format_summary(ctx)
        assert "RUNTIME PROBES SUMMARY" not in output
        assert "Total probe overhead" not in output

    @pytest.mark.unit
    def test_runtime_probes_summary_handles_empty_log(self, tracker):
        """An empty log (probe wrapper imported but never called) should
        also be silent — same as if the key was absent."""
        ctx = create_mock_ctx(
            session_state={
                "workflow_start_time": time.time() - 1.0,
                "runtime_probe_log": [],
            }
        )
        output = tracker.format_summary(ctx)
        assert "RUNTIME PROBES SUMMARY" not in output
