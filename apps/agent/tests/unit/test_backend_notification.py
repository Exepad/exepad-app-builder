"""Tests for BackendNotificationService: _build_callback_data and _get_auth_headers."""

import os

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from main_agent.agents.orchestrator.app_types.shared.services.backend_notification_service import (
    BackendNotificationService,
    _has_terminal_failure,
)
from tests.fixtures.mock_ctx import create_mock_ctx

pytestmark = [pytest.mark.unit]


# =============================================================================
# _build_callback_data
# =============================================================================


class TestBuildCallbackData:
    """Test BackendNotificationService._build_callback_data()."""

    def setup_method(self):
        self.service = BackendNotificationService()
        self.metrics_tracker = MagicMock()
        self.metrics_tracker.get_summary.return_value = {
            "workflow_duration": 12.5,
            "totals": {"input_tokens": 1000, "output_tokens": 500},
            "agent_metrics": [],
            "image_stats": {},
            "workflow_start_iso": "2026-03-26T00:00:00+00:00",
        }

    def test_success_status_when_no_errors(self):
        ctx = create_mock_ctx(
            session_state={
                "user_prompt": "build me an app",
                "chat_response": "Done!",
                "workflow_type": "create",
                "save_app_config": True,
                "agent_errors": [],
            }
        )
        result = self.service._build_callback_data(ctx, self.metrics_tracker, "corr-123")
        assert result["status"] == "success"

    def test_partial_success_when_agent_errors_present(self):
        ctx = create_mock_ctx(
            session_state={
                "workflow_type": "edit",
                "save_app_config": True,
                "agent_errors": [{"type": "some_warning", "message": "minor issue"}],
            }
        )
        result = self.service._build_callback_data(ctx, self.metrics_tracker, "corr-123")
        assert result["status"] == "partial_success"

    def test_failed_status_when_validation_pipeline_error(self):
        ctx = create_mock_ctx(
            session_state={
                "workflow_type": "create",
                "save_app_config": True,
                "agent_errors": [
                    {"type": "validation_pipeline_error", "message": "pipeline failed"}
                ],
            }
        )
        result = self.service._build_callback_data(ctx, self.metrics_tracker, "corr-123")
        assert result["status"] == "failed"

    def test_failed_status_when_create_and_save_false(self):
        ctx = create_mock_ctx(
            session_state={
                "workflow_type": "create",
                "save_app_config": False,
                "agent_errors": [],
            }
        )
        result = self.service._build_callback_data(ctx, self.metrics_tracker, "corr-123")
        assert result["status"] == "failed"

    def test_includes_correlation_id_and_session_id(self):
        ctx = create_mock_ctx(
            session_state={"agent_errors": []},
            session_id="sess-abc",
        )
        result = self.service._build_callback_data(ctx, self.metrics_tracker, "corr-456")
        assert result["correlation_id"] == "corr-456"
        assert result["session_id"] == "sess-abc"

    def test_includes_user_prompt_and_chat_response(self):
        ctx = create_mock_ctx(
            session_state={
                "user_prompt": "make it blue",
                "chat_response": "I made it blue.",
                "agent_errors": [],
            }
        )
        result = self.service._build_callback_data(ctx, self.metrics_tracker, "corr-1")
        assert result["user_prompt"] == "make it blue"
        assert result["assistant_response"] == "I made it blue."

    def test_includes_metrics_from_tracker(self):
        ctx = create_mock_ctx(session_state={"agent_errors": []})
        result = self.service._build_callback_data(ctx, self.metrics_tracker, "corr-1")
        assert result["metrics"]["workflow_duration"] == 12.5
        assert result["metrics"]["totals"] == {"input_tokens": 1000, "output_tokens": 500}

    def test_includes_file_refs_when_provided(self):
        ctx = create_mock_ctx(session_state={"agent_errors": []})
        file_refs = {"app_config": "gs://bucket/config.json"}
        result = self.service._build_callback_data(
            ctx, self.metrics_tracker, "corr-1", file_refs=file_refs
        )
        assert result["session_state"]["files"] == file_refs

    def test_no_file_refs_when_empty(self):
        ctx = create_mock_ctx(session_state={"agent_errors": []})
        result = self.service._build_callback_data(ctx, self.metrics_tracker, "corr-1")
        assert "files" not in result["session_state"]

    def test_empty_session_state_uses_defaults(self):
        ctx = create_mock_ctx(session_state={})
        result = self.service._build_callback_data(ctx, self.metrics_tracker, None)
        assert result["correlation_id"] is None
        assert result["user_prompt"] == ""
        assert result["assistant_response"] == ""
        assert result["workflow_type"] == "unknown"
        assert result["session_state"]["save_app_config"] is False


# =============================================================================
# _get_auth_headers
# =============================================================================


class TestGetAuthHeaders:
    """Test BackendNotificationService._get_auth_headers()."""

    def setup_method(self):
        self.service = BackendNotificationService()

    @patch.dict(os.environ, {"ENVIRONMENT": "development", "AGENT_SERVICE_API_KEY": "my-key"})
    def test_dev_env_with_api_key(self):
        headers = self.service._get_auth_headers("http://localhost:8000", "test")
        assert headers["Authorization"] == "Api-Key my-key"

    @patch.dict(
        os.environ,
        {"ENVIRONMENT": "development", "AGENT_SERVICE_API_KEY": ""},
        clear=False,
    )
    def test_dev_env_without_api_key(self):
        headers = self.service._get_auth_headers("http://localhost:8000", "test")
        assert headers == {}

    @patch.dict(os.environ, {"ENVIRONMENT": "production", "AGENT_SERVICE_API_KEY": ""})
    @patch("google.oauth2.id_token.fetch_id_token", return_value="iam-token-123")
    def test_production_env_attempts_iam_token(self, mock_fetch):
        headers = self.service._get_auth_headers("https://backend.example.com", "test")
        assert headers["Authorization"] == "Bearer iam-token-123"
        mock_fetch.assert_called_once()

    @patch.dict(os.environ, {"ENVIRONMENT": "production", "AGENT_SERVICE_API_KEY": "fallback-key"})
    @patch("google.oauth2.id_token.fetch_id_token", side_effect=Exception("metadata error"))
    def test_production_env_falls_back_to_api_key(self, mock_fetch):
        headers = self.service._get_auth_headers("https://backend.example.com", "test")
        assert headers["Authorization"] == "Api-Key fallback-key"


# =============================================================================
# _has_terminal_failure helper
# =============================================================================


class TestHasTerminalFailure:
    """Shared helper used by both notify_completion and _build_callback_data."""

    def test_component_generation_failed_is_terminal(self):
        state = {"agent_errors": [{"type": "component_generation_failed", "summary": "x"}]}
        assert _has_terminal_failure(state) is True

    def test_validation_pipeline_error_is_terminal(self):
        state = {"agent_errors": [{"type": "validation_pipeline_error", "summary": "y"}]}
        assert _has_terminal_failure(state) is True

    def test_no_errors_is_not_terminal(self):
        assert _has_terminal_failure({"agent_errors": []}) is False
        assert _has_terminal_failure({}) is False

    def test_non_terminal_error_type_is_not_terminal(self):
        state = {"agent_errors": [{"type": "something_else"}]}
        assert _has_terminal_failure(state) is False


# =============================================================================
# Failure-path budget for _send_with_retry
# =============================================================================


class TestFailurePathBudget:
    """P1 Layer 2: terminal-failure runs use 15s × 1 attempt, not 120s × 4."""

    def setup_method(self):
        self.service = BackendNotificationService()

    def test_failure_constants_are_tight(self):
        assert self.service.FAILURE_REQUEST_TIMEOUT == 15.0
        assert self.service.FAILURE_MAX_RETRIES == 0

    def test_success_constants_are_generous(self):
        # Sanity: success path still has the original budget.
        assert self.service.MAX_RETRIES == 3
        assert self.service.REQUEST_TIMEOUT >= 60  # env override permits, but default 120

    @pytest.mark.asyncio
    async def test_send_with_retry_accepts_per_call_overrides(self):
        """Ensure callers can pass timeout + max_retries per call."""
        import httpx

        service = BackendNotificationService()
        ctx = create_mock_ctx(session_state={})

        # Build a single failing attempt so the retry loop exits on 1st attempt.
        with patch(
            "httpx.AsyncClient",
            autospec=True,
        ) as mock_client_cls:
            mock_client = mock_client_cls.return_value.__aenter__.return_value
            mock_client.post = AsyncMock(side_effect=httpx.ConnectError("no route to host"))
            service._get_auth_headers = MagicMock(return_value={"Authorization": "Bearer x"})

            success = await service._send_with_retry(
                ctx,
                "https://backend.example.com",
                "app-123",
                {"status": "failed"},
                "test-service",
                timeout=15.0,
                max_retries=0,
            )

        assert success is False
        # Single attempt only — no retries — with the failure timeout wired in.
        assert mock_client.post.await_count == 1
        # AsyncClient constructed with the override timeout, not 120.
        assert mock_client_cls.call_args.kwargs["timeout"] == 15.0
