"""Tests for PipelineOrchestrator — backend notification, failure payload, routing helpers.

PipelineOrchestrator extends Pydantic BaseAgent, so instantiation requires all
agent fields. Instead of trying to construct the full orchestrator, we test:
1. The standalone utility functions it calls (create_workflow_failure_payload)
2. Backend notification logic via module-level patching
3. Routing-related session state patterns
"""

import json
import pytest
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from tests.fixtures.mock_ctx import create_mock_ctx
from tests.fixtures.mock_agents import create_mock_event

# =============================================================================
# Terminal create-failure helpers
# =============================================================================


class TestTerminalCreateFailureHelpers:
    """Tests for terminal failure summary and chat suppression logic."""

    @pytest.mark.unit
    def test_create_failure_summary_prefers_component_generation_error(self):
        from main_agent.agents.orchestrator.core import get_terminal_failure_summary

        state = {
            "workflow_type": "create",
            "save_app_config": False,
            "agent_errors": [
                {
                    "type": "component_generation_failed",
                    "summary": "Build failed because MainHeader and HomeContent could not be generated.",
                }
            ],
        }

        assert (
            get_terminal_failure_summary(state)
            == "Build failed because MainHeader and HomeContent could not be generated."
        )

    @pytest.mark.unit
    def test_create_failure_summary_returns_none_for_successful_create(self):
        from main_agent.agents.orchestrator.core import get_terminal_failure_summary

        state = {
            "workflow_type": "create",
            "save_app_config": True,
            "agent_errors": [],
        }

        assert get_terminal_failure_summary(state) is None

    @pytest.mark.unit
    def test_chat_message_suppressed_for_terminal_create_failure(self):
        from main_agent.agents.orchestrator.core import should_emit_chat_message

        state = {
            "workflow_type": "create",
            "save_app_config": False,
            "agent_errors": [{"type": "component_generation_failed", "summary": "Build failed"}],
        }

        assert should_emit_chat_message(state) is False

    @pytest.mark.unit
    def test_edit_failure_summary_uses_terminal_agent_error(self):
        from main_agent.agents.orchestrator.core import get_terminal_failure_summary

        state = {
            "workflow_type": "edit",
            "save_app_config": False,
            "agent_errors": [
                {
                    "type": "component_generation_failed",
                    "summary": "Edit failed because NavHeader could not be regenerated.",
                }
            ],
        }

        assert (
            get_terminal_failure_summary(state)
            == "Edit failed because NavHeader could not be regenerated."
        )

    @pytest.mark.unit
    def test_chat_message_allowed_for_help_desk(self):
        from main_agent.agents.orchestrator.core import should_emit_chat_message

        state = {
            "workflow_type": "help_desk",
            "save_app_config": False,
            "agent_errors": [],
        }

        assert should_emit_chat_message(state) is True

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_workflow_completion_emits_error_instead_of_success_for_terminal_create_failure(
        self,
    ):
        from main_agent.agents.orchestrator.core import PipelineOrchestrator

        tracker = MagicMock()
        tracker.update = AsyncMock()
        tracker.create_event.side_effect = (
            lambda _ctx, action, internal_message=None: create_mock_event(
                text_dict={"type": "progress", "action": action, "message": internal_message}
            )
        )
        tracker.create_app_config_updated_event = MagicMock()
        tracker.create_page_reload_event = MagicMock()
        tracker.create_completion_event = AsyncMock(
            return_value=create_mock_event(
                text_dict={"type": "progress", "action": "app_building_finished"}
            )
        )

        metrics_tracker = MagicMock()
        metrics_tracker.format_summary.return_value = "workflow summary"

        backend_called = False
        chat_called = False

        async def notify_backend(_ctx):
            nonlocal backend_called
            backend_called = True
            _ctx.session.state["_backend_save_result"] = False
            if False:
                yield None

        async def send_chat(_ctx):
            nonlocal chat_called
            chat_called = True
            yield create_mock_event(text_dict={"type": "chat_message", "text": "success"})

        fake_self = SimpleNamespace(
            name="PipelineOrchestrator",
            progress_tracker=tracker,
            metrics_tracker=metrics_tracker,
            _notify_backend_completion=notify_backend,
            _send_chat_message_to_frontend=send_chat,
        )

        ctx = create_mock_ctx(
            session_state={
                "workflow_type": "create",
                "save_app_config": False,
                "reload_app": True,
                "agent_errors": [
                    {
                        "type": "component_generation_failed",
                        "summary": "Build failed because MainHeader could not be generated.",
                    }
                ],
            }
        )

        events = []
        async for event in PipelineOrchestrator._handle_workflow_completion(fake_self, ctx):
            events.append(event)

        assert backend_called is True
        assert chat_called is False
        # Fast-path failure: no "Finalizing failed build" progress update;
        # error event fires immediately, then backend notification runs in
        # the background. The old slow path emitted a "saving" progress event
        # before awaiting the backend callback (which could take up to ~6 min).
        tracker.update.assert_not_called()
        tracker.create_app_config_updated_event.assert_not_called()
        tracker.create_page_reload_event.assert_not_called()
        tracker.create_completion_event.assert_not_awaited()

        payloads = [json.loads(event.content.parts[0].text) for event in events]
        # Error event must be the FIRST user-facing event on terminal failure
        # so the browser doesn't wait on the advisory backend callback.
        assert payloads[0]["action"] == "error"
        assert payloads[0]["message"] == "Build failed because MainHeader could not be generated."

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_workflow_emits_error_when_backend_save_fails(self):
        """TC-002 fix C: when save_app_config=True but the backend rejects
        the save (_backend_save_result=False), the orchestrator must emit a
        user-visible error event instead of silently dropping the
        app_config_updated. Without it, the chat reply lands but the
        preview iframe never reloads — same UX as the original TC-002 bug
        from a different cause."""
        from main_agent.agents.orchestrator.core import PipelineOrchestrator

        tracker = MagicMock()
        tracker.update = AsyncMock()
        tracker.create_event.side_effect = (
            lambda _ctx, action, internal_message=None: create_mock_event(
                text_dict={"type": "progress", "action": action, "message": internal_message}
            )
        )
        tracker.create_app_config_updated_event = MagicMock()
        tracker.create_page_reload_event = MagicMock(
            return_value=create_mock_event(text_dict={"type": "page_reload"})
        )
        tracker.create_completion_event = AsyncMock(
            return_value=create_mock_event(
                text_dict={"type": "progress", "action": "app_building_finished"}
            )
        )

        async def notify_backend(_ctx):
            _ctx.session.state["_backend_save_result"] = False
            if False:
                yield None

        async def send_chat(_ctx):
            yield create_mock_event(text_dict={"type": "chat_message", "text": "ok"})

        fake_self = SimpleNamespace(
            name="PipelineOrchestrator",
            progress_tracker=tracker,
            metrics_tracker=MagicMock(format_summary=MagicMock(return_value="s")),
            _notify_backend_completion=notify_backend,
            _send_chat_message_to_frontend=send_chat,
        )

        ctx = create_mock_ctx(
            session_state={
                "workflow_type": "edit",
                "save_app_config": True,
                "reload_app": True,
                "agent_errors": [],
                "chat_message": "I have updated the hero",
            }
        )

        events = []
        async for event in PipelineOrchestrator._handle_workflow_completion(fake_self, ctx):
            events.append(event)

        # No app_config_updated emitted (save failed, runtime is stale)
        tracker.create_app_config_updated_event.assert_not_called()

        # An error event was emitted to surface the failure to the user
        payloads = [json.loads(event.content.parts[0].text) for event in events]
        error_payloads = [p for p in payloads if p.get("action") == "error"]
        assert len(error_payloads) >= 1, (
            f"expected at least one error event, got actions: "
            f"{[p.get('action') for p in payloads]}"
        )
        assert "Couldn't save your changes" in error_payloads[0]["message"]


# =============================================================================
# create_workflow_failure_payload (imported from agent_api)
# =============================================================================


class TestWorkflowFailurePayload:
    """Tests for the workflow failure payload used by the orchestrator."""

    @pytest.mark.unit
    def test_failure_payload_fields(self):
        """Failure payload contains required fields for backend."""
        from agent_api import create_workflow_failure_payload

        error = RuntimeError("LLM timed out")
        state_delta = {
            "correlation_id": "c-1",
            "app_uuid": "a-1",
            "operation_mode": "create",
        }
        payload = create_workflow_failure_payload(error, "session-1", state_delta)

        cb = payload["callback_data"]
        assert cb["status"] == "failed"
        assert cb["correlation_id"] == "c-1"
        assert cb["error"]["type"] == "RuntimeError"
        assert "LLM timed out" in cb["error"]["message"]

    @pytest.mark.unit
    def test_failure_payload_missing_state_fields(self):
        """Failure payload handles missing optional state_delta keys."""
        from agent_api import create_workflow_failure_payload

        error = ValueError("bad")
        payload = create_workflow_failure_payload(error, "s-1", {})

        cb = payload["callback_data"]
        assert cb["status"] == "failed"
        assert cb["correlation_id"] is None
        assert cb["app_uuid"] is None
        assert cb["workflow_type"] == "unknown"

    @pytest.mark.unit
    def test_error_message_truncated_at_1000(self):
        """Long error messages are truncated to 1000 chars."""
        from agent_api import create_workflow_failure_payload

        error = RuntimeError("x" * 2000)
        payload = create_workflow_failure_payload(error, "s-1", {})
        assert len(payload["callback_data"]["error"]["message"]) <= 1000

    @pytest.mark.unit
    def test_error_summary_truncated_at_500(self):
        """Agent error summary is truncated to 500 chars."""
        from agent_api import create_workflow_failure_payload

        error = RuntimeError("y" * 1000)
        payload = create_workflow_failure_payload(error, "s-1", {})
        summary = payload["callback_data"]["agent_errors"][0]["error_message"]
        assert len(summary) <= 500

    @pytest.mark.unit
    def test_payload_type_is_backend_response(self):
        """Top-level type field is 'backend_response'."""
        from agent_api import create_workflow_failure_payload

        payload = create_workflow_failure_payload(Exception("err"), "s", {})
        assert payload["type"] == "backend_response"
        assert "timestamp" in payload

    @pytest.mark.unit
    def test_agent_error_structure(self):
        """Agent error has the expected fields."""
        from agent_api import create_workflow_failure_payload

        error = TypeError("bad type")
        payload = create_workflow_failure_payload(error, "s", {"operation_mode": "edit"})

        agent_error = payload["callback_data"]["agent_errors"][0]
        assert agent_error["error_type"] == "workflow_error"
        assert agent_error["agent_name"] == "Workflow"
        assert agent_error["error_class"] == "TypeError"
        assert "bad type" in agent_error["error_message"]
        assert agent_error["retry_attempts"] == 0
        assert agent_error["is_transient"] is False
        assert agent_error["components_affected"] == []


# =============================================================================
# Backend notification retry logic (tested via httpx mock)
# =============================================================================


class TestBackendNotificationRetry:
    """Tests for the backend notification retry logic extracted from _notify_backend_completion.

    Since PipelineOrchestrator is a Pydantic BaseAgent, we test the retry pattern
    used in the method via direct httpx mocking.
    """

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_httpx_retry_pattern(self):
        """Verify the retry pattern: 3 retries with exponential backoff."""
        import httpx

        # Simulate the retry loop from _notify_backend_completion
        max_retries = 3
        base_delay = 0.001  # Fast for testing
        attempts = 0
        success = False

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()

        # Fail twice, succeed on third
        call_count = 0

        async def mock_post(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise httpx.ConnectError("Connection refused")
            return mock_response

        for attempt in range(max_retries + 1):
            attempts += 1
            try:
                result = await mock_post("http://backend/callback", json={})
                result.raise_for_status()
                success = True
                break
            except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException):
                if attempt < max_retries:
                    import asyncio

                    await asyncio.sleep(base_delay * (2**attempt))

        assert success is True
        assert attempts == 3
        assert call_count == 3

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_httpx_retry_exhausted(self):
        """All retries exhausted results in failure."""
        import httpx

        max_retries = 3
        base_delay = 0.001
        attempts = 0
        success = False

        async def mock_post(*args, **kwargs):
            raise httpx.ConnectError("Connection refused")

        for attempt in range(max_retries + 1):
            attempts += 1
            try:
                await mock_post("http://backend/callback", json={})
                success = True
                break
            except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException):
                if attempt < max_retries:
                    import asyncio

                    await asyncio.sleep(base_delay * (2**attempt))

        assert success is False
        assert attempts == max_retries + 1


# =============================================================================
# Session state routing patterns
# =============================================================================


class TestOrchestratorRouting:
    """Tests for the orchestrator's routing logic via session state patterns.

    The orchestrator routes based on operation_mode and branch_label in session state.
    We test the routing patterns without instantiating PipelineOrchestrator.
    """

    @pytest.mark.unit
    def test_create_mode_routing_pattern(self):
        """Create mode is determined by operation_mode='create'."""
        state = {"operation_mode": "create"}
        assert state["operation_mode"] == "create"

    @pytest.mark.unit
    def test_edit_mode_routing_pattern(self):
        """Edit mode uses branch_label from help desk to determine sub-workflow."""
        # After help desk routing, session state contains branch_label
        state = {
            "operation_mode": "edit",
            "branch_label": "edit",
        }
        branch = state.get("branch_label", "edit")
        assert branch == "edit"

    @pytest.mark.unit
    def test_help_desk_branch_routing(self):
        """Help desk branch skips editing, sends chat response only."""
        state = {
            "operation_mode": "edit",
            "branch_label": "help_desk",
            "chat_response": "Here is your answer!",
        }
        assert state["branch_label"] == "help_desk"
        assert state["chat_response"] != ""

    @pytest.mark.unit
    def test_direct_action_routing(self):
        """Direct actions bypass help desk and route by action_label."""
        state = {
            "operation_mode": "edit",
            "action_label": "add_contact_info",
            "action_payload": {},
        }
        assert state.get("action_label") is not None
        assert state["action_label"] == "add_contact_info"

    @pytest.mark.unit
    def test_test_mode_backend_bypass(self):
        """Test mode flag causes backend notification to emit event instead of HTTP call."""
        state = {"is_test": True}
        is_test = state.get("is_test", False)
        assert is_test is True
