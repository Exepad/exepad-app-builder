"""Tests for the Surveyor's cross-turn artifact persistence path.

Covers the contract between ``persist_diagnostic_report`` (writer, runs as
``after_agent_callback`` on ``surveyor_agent``) and
``prior_turn_diagnosis_tool_impl`` (reader, exposed to the LLM as
``prior_turn_diagnosis_tool``).

Until this callback was added, ``output_key=DIAGNOSTIC_REPORT`` only wrote to
session state — the reader's ``list_artifacts`` scan never found anything,
so ``has_prior_diagnosis`` was permanently ``False``. These tests pin the
filename pattern, turn-index source, and round-trip integrity.
"""

from __future__ import annotations

import json
from typing import Any

from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor import (
    _diagnostic_report_artifact_name,
    persist_diagnostic_report,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor_tools import (
    prior_turn_diagnosis_tool_impl,
)
from main_agent.constants import StateKeys


# ---------------------------------------------------------------------------
# Fake context — duck-types both CallbackContext (writer) and ToolContext
# (reader). Backed by a single in-memory {filename: bytes} dict so a write
# from the callback is visible to a subsequent tool-context read.
# ---------------------------------------------------------------------------


class _FakePart:
    """Minimal stand-in for ``google.genai.types.Part`` with ``inline_data``.

    The reader path (``surveyor_tools._load_artifact_source``) reads
    ``artifact.inline_data.data`` and decodes utf-8.
    """

    class _Inline:
        def __init__(self, data: bytes):
            self.data = data

    def __init__(self, data: bytes):
        self.inline_data = self._Inline(data)


class FakeArtifactContext:
    """Single fake context that serves as both CallbackContext and ToolContext.

    Production uses two different ADK types but they share the same
    artifact-method shape for our purposes (``save_artifact`` /
    ``list_artifacts`` / ``load_artifact``) — see
    ``apps/agent/.venv/.../google/adk/agents/context.py`` and the ToolContext
    docstrings. Sharing one fake makes round-trip tests trivial.
    """

    def __init__(self, state: dict[str, Any] | None = None):
        self.state: dict[str, Any] = dict(state or {})
        self._artifacts: dict[str, bytes] = {}

    async def save_artifact(self, *, filename: str, artifact, **_: Any) -> int:
        # Production passes a ``types.Part.from_bytes(...)`` whose payload is
        # at ``inline_data.data``. We store the raw bytes.
        data = artifact.inline_data.data
        self._artifacts[filename] = data
        return 0

    async def list_artifacts(self) -> list[str]:
        return sorted(self._artifacts.keys())

    async def load_artifact(self, *, filename: str, **_: Any):
        data = self._artifacts.get(filename)
        if data is None:
            return None
        return _FakePart(data)


# ---------------------------------------------------------------------------
# Filename pattern — pinned across writer and reader
# ---------------------------------------------------------------------------


class TestArtifactFilenamePattern:
    def test_filename_pattern(self):
        # Writer's filename helper.
        assert _diagnostic_report_artifact_name(0) == "diagnostic_report:0.json"
        assert _diagnostic_report_artifact_name(7) == "diagnostic_report:7.json"

    def test_filename_matches_reader_prefix_and_suffix(self):
        # The reader at surveyor_tools.py:455 filters on
        # `name.startswith("diagnostic_report:")` and parses the turn via
        # `removeprefix("diagnostic_report:").removesuffix(".json")`. Drift
        # between writer and reader would silently break the lookup.
        name = _diagnostic_report_artifact_name(42)
        assert name.startswith("diagnostic_report:")
        assert name.endswith(".json")
        stem = name.removeprefix("diagnostic_report:").removesuffix(".json")
        assert int(stem) == 42


# ---------------------------------------------------------------------------
# Writer — persist_diagnostic_report
# ---------------------------------------------------------------------------


def _good_report_state(turn: int = 1) -> dict[str, Any]:
    return {
        StateKeys.DIAGNOSTIC_REPORT: {
            "profile": "bug-root-cause",
            "symptom": "chart shows no data",
            "findings": [
                {
                    "statement": "dataKey='rate' but handler returns 'percentage'",
                    "severity": "root_cause",
                    "evidence": [
                        {
                            "tool": "field_mismatch_report_tool",
                            "args": {},
                            "excerpt": "missing_in_producer field=rate",
                            "location": "DashboardContent.tsx:137",
                        }
                    ],
                    "affected_entities": ["DashboardContent", "getOccupancyTrend"],
                }
            ],
            "suggested_resolution_shape": "both_sides_paired",
            "suggested_resolution_prose": "Update consumer dataKey or rename producer field.",
            "confidence": "high",
        },
        StateKeys.DIAGNOSTIC_TURN_INDEX: turn,
    }


class TestPersistDiagnosticReport:
    async def test_writes_artifact_under_expected_name(self):
        ctx = FakeArtifactContext(state=_good_report_state(turn=3))
        await persist_diagnostic_report(ctx)

        names = await ctx.list_artifacts()
        assert names == ["diagnostic_report:3.json"]

    async def test_artifact_payload_is_json_round_trippable(self):
        state = _good_report_state(turn=5)
        ctx = FakeArtifactContext(state=state)
        await persist_diagnostic_report(ctx)

        part = await ctx.load_artifact(filename="diagnostic_report:5.json")
        assert part is not None
        decoded = part.inline_data.data.decode("utf-8")
        parsed = json.loads(decoded)
        assert parsed == state[StateKeys.DIAGNOSTIC_REPORT]

    async def test_falls_back_to_chat_history_length_when_turn_index_missing(self):
        # If the orchestrator forgot to push DIAGNOSTIC_TURN_INDEX, the
        # callback derives the turn from chat_history length so the artifact
        # name still ends up sensible (not 'diagnostic_report:None.json').
        state = _good_report_state(turn=0)
        del state[StateKeys.DIAGNOSTIC_TURN_INDEX]
        state[StateKeys.CHAT_HISTORY] = ["msg1", "msg2", "msg3", "msg4"]
        ctx = FakeArtifactContext(state=state)
        await persist_diagnostic_report(ctx)
        assert await ctx.list_artifacts() == ["diagnostic_report:4.json"]

    async def test_defaults_turn_to_zero_when_no_state(self):
        state = _good_report_state(turn=0)
        del state[StateKeys.DIAGNOSTIC_TURN_INDEX]
        ctx = FakeArtifactContext(state=state)
        await persist_diagnostic_report(ctx)
        assert await ctx.list_artifacts() == ["diagnostic_report:0.json"]

    async def test_no_op_when_report_missing(self):
        # No DIAGNOSTIC_REPORT in state → no artifact written.
        # Surveyor failed and the orchestrator's empty-report fallback may
        # still write later; persisting nothing here is correct.
        ctx = FakeArtifactContext(state={StateKeys.DIAGNOSTIC_TURN_INDEX: 1})
        await persist_diagnostic_report(ctx)
        assert await ctx.list_artifacts() == []

    async def test_no_op_when_report_is_falsy(self):
        ctx = FakeArtifactContext(
            state={
                StateKeys.DIAGNOSTIC_REPORT: {},
                StateKeys.DIAGNOSTIC_TURN_INDEX: 1,
            }
        )
        await persist_diagnostic_report(ctx)
        assert await ctx.list_artifacts() == []

    async def test_save_failure_does_not_raise(self):
        # A persistence failure must never abort the edit turn — the Editor
        # still has the in-state report to plan against.
        class FailingCtx(FakeArtifactContext):
            async def save_artifact(self, **_: Any) -> int:
                raise RuntimeError("simulated GCS outage")

        ctx = FailingCtx(state=_good_report_state(turn=1))
        # Should not raise.
        await persist_diagnostic_report(ctx)


# ---------------------------------------------------------------------------
# Round-trip — writer-then-reader, the load-bearing scenario this fix
# unblocks. Until the callback existed, the reader saw an empty list every
# time, regardless of how many edit turns had run.
# ---------------------------------------------------------------------------


class TestWriterReaderRoundTrip:
    async def test_prior_turn_diagnosis_finds_persisted_report(self):
        # Turn 1 — Surveyor runs, callback persists the artifact.
        state_turn_1 = _good_report_state(turn=1)
        ctx = FakeArtifactContext(state=state_turn_1)
        await persist_diagnostic_report(ctx)

        # Turn 2 — same session, Surveyor's prior_turn_diagnosis_tool runs.
        # The artifact bucket carries forward (single FakeArtifactContext
        # mirrors a single ADK session).
        result = await prior_turn_diagnosis_tool_impl(ctx)  # type: ignore[arg-type]
        assert result["has_prior_diagnosis"] is True
        assert result["artifact"] == "diagnostic_report:1.json"
        assert result["report"]["confidence"] == "high"
        assert result["report"]["findings"][0]["severity"] == "root_cause"

    async def test_prior_turn_diagnosis_picks_highest_turn_index(self):
        # Multi-turn session: every Surveyor invocation persists its own
        # numbered artifact. The reader should always surface the most
        # recent (highest turn index), not the first or a lexicographic
        # winner ("diagnostic_report:9.json" < "diagnostic_report:10.json"
        # alphabetically — the reader has to parse ints to get this right).
        ctx = FakeArtifactContext(state=_good_report_state(turn=3))
        await persist_diagnostic_report(ctx)

        ctx.state.update(_good_report_state(turn=10))
        ctx.state[StateKeys.DIAGNOSTIC_REPORT]["confidence"] = "medium"
        await persist_diagnostic_report(ctx)

        ctx.state.update(_good_report_state(turn=9))
        await persist_diagnostic_report(ctx)

        result = await prior_turn_diagnosis_tool_impl(ctx)  # type: ignore[arg-type]
        assert result["has_prior_diagnosis"] is True
        assert result["artifact"] == "diagnostic_report:10.json"
        assert result["report"]["confidence"] == "medium"

    async def test_first_turn_returns_no_prior_diagnosis(self):
        # No prior writes — turn 1 of a fresh session.
        ctx = FakeArtifactContext()
        result = await prior_turn_diagnosis_tool_impl(ctx)  # type: ignore[arg-type]
        assert result == {"has_prior_diagnosis": False}


# pytest-asyncio is auto mode in this project (see pytest.ini), so async
# tests in this file run without explicit decorators. No module-level mark
# is needed and applying one would warn on the two sync tests above.
