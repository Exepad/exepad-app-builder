"""Tests for the BackendModelBuilder save-loop guardrail.

ADK runs its own tool-calling loop and ignores genai's
``AutomaticFunctionCallingConfig.maximumRemoteCalls``, so a builder whose
instruction says "ONLY output a tool call" can re-invoke the save tool forever
when it has nothing new to save (e.g. a no-op schema "edit" for a seed-DATA
change). App 0ahokkja hit 109 identical ``backend.json`` saves in a single run
before the user manually disabled Vertex AI.

``backend_model_save_guardrail`` (a ``before_tool_callback``) bounds this the
same way the handler builder does: count per-invocation save calls and, past the
cap, set ``tool_context.actions.escalate`` to hard-terminate the agent loop and
return a terminal error dict. ``sanitize_backend_model_save_response`` keeps the
success signal minimal so the model stops re-calling.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_artifact_tools import (  # noqa: E501
    _MAX_TOTAL_SAVE_CALLS,
    _MODEL_SAVE_CALL_KEY,
    _SAVE_TOOL_NAME,
    backend_model_save_guardrail,
    sanitize_backend_model_save_response,
)

pytestmark = [pytest.mark.unit]


class _Tool:
    def __init__(self, name: str) -> None:
        self.name = name


def _ctx(state: dict | None = None):
    return SimpleNamespace(
        state=state if state is not None else {},
        actions=SimpleNamespace(escalate=False),
    )


class TestBackendModelSaveGuardrail:
    def test_ignores_non_save_tools(self):
        ctx = _ctx()
        out = backend_model_save_guardrail(_Tool("load_artifacts"), {}, ctx)
        assert out is None
        assert ctx.actions.escalate is False
        assert _MODEL_SAVE_CALL_KEY not in ctx.state

    def test_allows_calls_up_to_cap_without_escalating(self):
        ctx = _ctx()
        tool = _Tool(_SAVE_TOOL_NAME)
        for i in range(1, _MAX_TOTAL_SAVE_CALLS + 1):
            out = backend_model_save_guardrail(tool, {"backend_json": "{}"}, ctx)
            assert out is None, f"call {i} should pass through"
            assert ctx.state[_MODEL_SAVE_CALL_KEY] == i
            assert ctx.actions.escalate is False

    def test_escalates_and_returns_terminal_past_cap(self):
        ctx = _ctx({_MODEL_SAVE_CALL_KEY: _MAX_TOTAL_SAVE_CALLS})
        out = backend_model_save_guardrail(_Tool(_SAVE_TOOL_NAME), {}, ctx)
        assert out is not None
        assert out["success"] is False
        assert out.get("terminal") is True
        assert ctx.actions.escalate is True
        assert "STOP" in out["error"]

    def test_counter_is_per_invocation_resettable(self):
        # The caller resets the key to 0 before each build; the guardrail then
        # counts fresh and a single edit can never exceed the cap.
        ctx = _ctx({_MODEL_SAVE_CALL_KEY: 0})
        tool = _Tool(_SAVE_TOOL_NAME)
        for _ in range(_MAX_TOTAL_SAVE_CALLS):
            assert backend_model_save_guardrail(tool, {}, ctx) is None
        # cap+1 escalates
        assert backend_model_save_guardrail(tool, {}, ctx) is not None
        assert ctx.actions.escalate is True


class TestSanitizeBackendModelSaveResponse:
    def test_ignores_non_save_tools(self):
        out = sanitize_backend_model_save_response(
            _Tool("get_exepad_schema"), {}, _ctx(), {"success": True}
        )
        assert out is None

    def test_collapses_success_to_minimal_terminal_message(self):
        resp = {
            "success": True,
            "artifact_filename": "backend.json",
            "version": 3,
            "summary": "1 models, 0 handlers",
            "checks_passed": ["json_syntax", "schema"],
        }
        out = sanitize_backend_model_save_response(_Tool(_SAVE_TOOL_NAME), {}, _ctx(), resp)
        assert out == {
            "success": True,
            "artifact_filename": "backend.json",
            "version": 3,
            "message": "Backend models saved successfully. Your task is complete.",
        }

    def test_leaves_failure_responses_untouched(self):
        out = sanitize_backend_model_save_response(
            _Tool(_SAVE_TOOL_NAME), {}, _ctx(), {"success": False, "error": "bad"}
        )
        assert out is None
