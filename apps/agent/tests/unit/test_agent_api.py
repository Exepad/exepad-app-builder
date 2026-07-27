"""Tests for agent_api.py — /r endpoint, verify_iam_caller, health check.

Uses FastAPI TestClient and mocks to avoid needing a running server or real LLM calls.
"""

import json
import os
import time
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# =============================================================================
# verify_iam_caller
# =============================================================================


class TestVerifyIamCaller:
    """Tests for the IAM caller verification function."""

    @pytest.mark.unit
    def test_valid_token_returns_true(self):
        """Valid GCP ID token from expected SA → (True, '')."""
        mock_claims = {
            "email": "sa-backend@exepad.iam.gserviceaccount.com",
            "aud": "https://exepad-agent.run.app",
        }

        with (
            patch("google.oauth2.id_token.verify_oauth2_token", return_value=mock_claims),
            patch(
                "agent_api.EXPECTED_BACKEND_SERVICE_ACCOUNT",
                "sa-backend@exepad.iam.gserviceaccount.com",
            ),
            patch("agent_api.AGENT_SERVICE_URL", "https://exepad-agent.run.app"),
        ):
            from agent_api import verify_iam_caller

            is_valid, msg = verify_iam_caller("Bearer valid-token-here")

        assert is_valid is True
        assert msg == ""

    @pytest.mark.unit
    def test_wrong_service_account_returns_false(self):
        """Token from unexpected SA → (False, error)."""
        mock_claims = {
            "email": "attacker@evil-project.iam.gserviceaccount.com",
        }

        with (
            patch("google.oauth2.id_token.verify_oauth2_token", return_value=mock_claims),
            patch(
                "agent_api.EXPECTED_BACKEND_SERVICE_ACCOUNT",
                "sa-backend@exepad.iam.gserviceaccount.com",
            ),
            patch("agent_api.AGENT_SERVICE_URL", "https://exepad-agent.run.app"),
        ):
            from agent_api import verify_iam_caller

            is_valid, msg = verify_iam_caller("Bearer wrong-sa-token")

        assert is_valid is False
        assert "Unauthorized" in msg or "attacker" in msg

    @pytest.mark.unit
    def test_invalid_token_returns_false(self):
        """Malformed/expired token → (False, error)."""
        with (
            patch(
                "google.oauth2.id_token.verify_oauth2_token",
                side_effect=ValueError("Token expired"),
            ),
            patch("agent_api.AGENT_SERVICE_URL", "https://exepad-agent.run.app"),
        ):
            from agent_api import verify_iam_caller

            is_valid, msg = verify_iam_caller("Bearer expired-token")

        assert is_valid is False
        assert "Invalid IAM token" in msg

    @pytest.mark.unit
    def test_malformed_auth_header(self):
        """Empty/missing header → (False, error)."""
        from agent_api import verify_iam_caller

        is_valid, msg = verify_iam_caller("")
        assert is_valid is False

    @pytest.mark.unit
    def test_skips_sa_check_when_not_configured(self):
        """When EXPECTED_BACKEND_SERVICE_ACCOUNT is empty, skip SA check."""
        mock_claims = {
            "email": "any-sa@any-project.iam.gserviceaccount.com",
        }

        with (
            patch("google.oauth2.id_token.verify_oauth2_token", return_value=mock_claims),
            patch("agent_api.EXPECTED_BACKEND_SERVICE_ACCOUNT", ""),
            patch("agent_api.AGENT_SERVICE_URL", ""),
        ):
            from agent_api import verify_iam_caller

            is_valid, msg = verify_iam_caller("Bearer some-token")

        assert is_valid is True
        assert msg == ""


# =============================================================================
# create_workflow_failure_payload
# =============================================================================


class TestCreateWorkflowFailurePayload:
    """Tests for the failure payload structure."""

    @pytest.mark.unit
    def test_payload_structure(self):
        """Failure payload has correct structure and status='failed'."""
        from agent_api import create_workflow_failure_payload

        error = ValueError("Something broke")
        state_delta = {
            "correlation_id": "corr-123",
            "app_uuid": "app-456",
            "operation_mode": "create",
        }

        payload = create_workflow_failure_payload(error, "session-789", state_delta)

        assert payload["type"] == "backend_response"
        assert "timestamp" in payload
        assert "callback_data" in payload

        cb = payload["callback_data"]
        assert cb["status"] == "failed"
        assert cb["session_id"] == "session-789"
        assert cb["correlation_id"] == "corr-123"
        assert cb["app_uuid"] == "app-456"
        assert cb["workflow_type"] == "create"
        assert cb["error"]["type"] == "ValueError"
        assert "Something broke" in cb["error"]["message"]
        assert len(cb["agent_errors"]) == 1
        assert cb["agent_errors"][0]["error_type"] == "workflow_error"
        assert cb["agent_errors"][0]["is_transient"] is False

    @pytest.mark.unit
    def test_long_error_message_truncated(self):
        """Error messages longer than 1000 chars are truncated."""
        from agent_api import create_workflow_failure_payload

        long_msg = "x" * 2000
        error = RuntimeError(long_msg)

        payload = create_workflow_failure_payload(error, "s-1", {})
        assert len(payload["callback_data"]["error"]["message"]) <= 1000

    @pytest.mark.unit
    def test_rate_limit_error_classification(self):
        """Rate limit errors are classified as rate_limit_exhausted."""
        from agent_api import create_workflow_failure_payload

        error = Exception("429 RESOURCE_EXHAUSTED: quota exceeded")
        payload = create_workflow_failure_payload(error, "s-1", {})
        agent_err = payload["callback_data"]["agent_errors"][0]
        assert agent_err["error_type"] == "rate_limit_exhausted"

    @pytest.mark.unit
    def test_transient_error_classification(self):
        """Transient errors (timeouts, 503) are classified as llm_unavailable."""
        from agent_api import create_workflow_failure_payload

        error = TimeoutError("Connection timed out")
        payload = create_workflow_failure_payload(error, "s-1", {})
        agent_err = payload["callback_data"]["agent_errors"][0]
        assert agent_err["error_type"] == "llm_unavailable"
        assert agent_err["is_transient"] is True

    @pytest.mark.unit
    def test_permanent_error_classification(self):
        """Permanent errors (ValueError, etc.) are classified as workflow_error."""
        from agent_api import create_workflow_failure_payload

        error = ValueError("invalid config")
        payload = create_workflow_failure_payload(error, "s-1", {})
        agent_err = payload["callback_data"]["agent_errors"][0]
        assert agent_err["error_type"] == "workflow_error"
        assert agent_err["is_transient"] is False


# =============================================================================
# /r endpoint
# =============================================================================


class TestRunEndpoint:
    """Tests for the /r POST endpoint."""

    @pytest.mark.unit
    def test_missing_fields_returns_422(self, test_client):
        """Missing required fields → 422 with list of missing fields."""
        response = test_client.post("/r", json={"user_id": "u1"})
        assert response.status_code == 422
        data = response.json()
        assert "missing" in data
        assert "session_id" in data["missing"]
        assert "operation_mode" in data["missing"]

    @pytest.mark.unit
    def test_invalid_json_body_returns_400(self, test_client):
        """Malformed JSON in request body → 400."""
        response = test_client.post(
            "/r",
            content=b"not-json{{{",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 400

    @pytest.mark.unit
    def test_invalid_payload_field_returns_400(self, test_client):
        """Non-dict payload → 400.

        We mock get_session_service to return a mock that won't hit the real
        InMemorySessionService API, isolating the payload validation logic.
        IS_PRODUCTION is False in tests, so IAM verification is skipped.
        """
        mock_session_svc = MagicMock()
        mock_session_svc.get_session = AsyncMock(side_effect=KeyError("no session"))
        mock_session_svc.create_session = AsyncMock(
            return_value=MagicMock(id="s1", user_id="u1", state={})
        )

        with patch("agent_api.get_session_service", return_value=mock_session_svc):
            response = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "create",
                    "payload": '"just a string"',
                },
            )
        assert response.status_code == 400

    @pytest.mark.unit
    def test_iam_rejected_returns_403(self, test_client):
        """In production, failed IAM verification → 403."""
        with (
            patch("agent_api.IS_PRODUCTION", True),
            patch(
                "agent_api.verify_iam_caller", return_value=(False, "Unauthorized service account")
            ),
        ):
            response = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "create",
                    "payload": json.dumps({"app_name": "test"}),
                },
                headers={"Authorization": "Bearer fake-token"},
            )
        assert response.status_code == 403
        data = response.json()
        assert data["error"] == "Forbidden"


# =============================================================================
# /health endpoint
# =============================================================================


class TestHealthCheck:
    """Tests for the /health GET endpoint."""

    @pytest.mark.unit
    def test_health_ok(self, test_client):
        """Health check returns status=ok when services are available."""
        response = test_client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] in ("ok", "degraded")  # depends on env

    @pytest.mark.unit
    def test_health_contains_environment(self, test_client):
        """Health check response includes environment field."""
        response = test_client.get("/health")
        data = response.json()
        assert "environment" in data

    @pytest.mark.unit
    def test_health_degraded_when_session_service_fails(self, test_client):
        """When session service fails, health returns degraded."""
        with patch("agent_api.get_session_service", side_effect=RuntimeError("DB down")):
            response = test_client.get("/health")
            data = response.json()
            assert data["session_service"] == "unavailable"
            assert data["status"] == "degraded"


# =============================================================================
# get_allowed_origins
# =============================================================================


class TestGetAllowedOrigins:
    """Tests for CORS origin configuration."""

    @pytest.mark.unit
    def test_development_returns_wildcard(self):
        """Development environment returns ['*']."""
        with patch.dict(os.environ, {"ENVIRONMENT": "development"}, clear=False):
            from agent_api import get_allowed_origins

            origins = get_allowed_origins()
            assert "*" in origins

    @pytest.mark.unit
    def test_production_returns_configured_origins(self):
        """Production returns exactly the operator-configured ALLOWED_ORIGINS (no wildcard)."""
        with patch.dict(
            os.environ,
            {
                "ENVIRONMENT": "production",
                "ALLOWED_ORIGINS": "https://backend.exepad.com, https://app.exepad.com",
            },
            clear=False,
        ):
            from agent_api import get_allowed_origins

            origins = get_allowed_origins()
            assert "*" not in origins
            assert origins == ["https://backend.exepad.com", "https://app.exepad.com"]

    @pytest.mark.unit
    def test_production_requires_allowed_origins(self):
        """Production with ALLOWED_ORIGINS unset must fail loud, not silently default to a cloud host."""
        with patch.dict(
            os.environ, {"ENVIRONMENT": "production", "ALLOWED_ORIGINS": ""}, clear=False
        ):
            from agent_api import get_allowed_origins

            with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
                get_allowed_origins()


# =============================================================================
# Streaming-pipeline test helpers
# =============================================================================


async def _empty_async_gen(*args, **kwargs):
    """Async generator that yields nothing — mock for runner.run_async."""
    return
    yield  # makes the function an async generator


def _build_streaming_mocks(artifact_keys=None):
    """Create common mocks for a full streaming /r request.

    Returns (mock_session_svc, mock_artifact_svc).
    """
    mock_session = MagicMock(id="s1", user_id="u1", app_name="orchestrator")

    mock_session_svc = MagicMock()
    mock_session_svc.get_session = AsyncMock(side_effect=KeyError("not found"))
    mock_session_svc.create_session = AsyncMock(return_value=mock_session)
    mock_session_svc.append_event = AsyncMock()
    mock_session_svc.delete_session = AsyncMock()

    mock_artifact_svc = MagicMock()
    mock_artifact_svc.list_artifact_keys = AsyncMock(return_value=artifact_keys or [])
    mock_artifact_svc.delete_artifact = AsyncMock()

    return mock_session_svc, mock_artifact_svc


def _streaming_context(mock_session_svc, mock_artifact_svc):
    """Return a tuple of patch context managers for the full streaming pipeline.

    Usage::

        with (
            *_streaming_context(mock_session_svc, mock_artifact_svc),
        ) as (...):
            ...

    Instead, callers should use ``_run_streaming_request`` or the helper
    ``_get_append_event_state_delta`` which handle patching internally.
    """
    raise NotImplementedError("use _run_streaming_request or inline patches")


# =============================================================================
# cleanup() — session-only cleanup
#
# The ADK session row is per-turn scratch and is deleted after each workflow.
# ADK artifacts are intentionally retained because later turns, replay/debug
# flows, and import pipelines may need to reload them by app/user/session path.
#
# The `workflow_failed` parameter is retained for log-tag purposes only;
# it no longer changes control flow.
# =============================================================================


async def _failing_async_gen(*args, **kwargs):
    """Async generator that raises — used to simulate workflow failure."""
    raise RuntimeError("synthetic workflow failure")
    yield  # unreachable, makes this an async generator


class TestCleanup:
    """Tests for cleanup() — session deleted, artifacts preserved every turn."""

    def _run_streaming_request(
        self,
        test_client,
        mock_session_svc,
        mock_artifact_svc,
        payload_extra=None,
        workflow_raises: bool = False,
    ):
        """Execute a /r POST through the full streaming pipeline.

        IS_PRODUCTION is False in tests, so IAM verification is skipped.
        Pass ``workflow_raises=True`` to simulate a workflow crash so
        cleanup runs with workflow_failed=True.
        """
        payload_data = {"app_name": "test"}
        if payload_extra:
            payload_data.update(payload_extra)

        with (
            patch("agent_api.get_session_service", return_value=mock_session_svc),
            patch("agent_api.get_artifact_service", return_value=mock_artifact_svc),
            patch("agent_api.Runner") as MockRunner,
            patch("agent_api.export_test_run_data", new_callable=AsyncMock),
            patch("agent_api._notify_backend_failure", new_callable=AsyncMock),
        ):
            mock_runner = MockRunner.return_value
            mock_runner.session_service = mock_session_svc
            mock_runner.artifact_service = mock_artifact_svc
            gen = _failing_async_gen if workflow_raises else _empty_async_gen
            mock_runner.run_async = MagicMock(side_effect=lambda *a, **kw: gen())

            return test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "create",
                    "payload": json.dumps(payload_data),
                },
            )

    @pytest.mark.unit
    def test_success_deletes_session_without_touching_artifacts(self, test_client):
        """Happy path: session is deleted, artifacts are left reusable."""
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks(
            artifact_keys=["art1", "art2"],
        )

        response = self._run_streaming_request(
            test_client,
            mock_session_svc,
            mock_artifact_svc,
        )

        assert response.status_code == 200
        mock_artifact_svc.list_artifact_keys.assert_not_called()
        mock_artifact_svc.delete_artifact.assert_not_called()
        mock_session_svc.delete_session.assert_called_once()

    @pytest.mark.unit
    def test_failure_deletes_session_without_touching_artifacts(self, test_client):
        """Failure path: cleanup still preserves artifacts and deletes the session."""
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks(
            artifact_keys=["art1", "art2"],
        )

        response = self._run_streaming_request(
            test_client,
            mock_session_svc,
            mock_artifact_svc,
            workflow_raises=True,
        )

        assert response.status_code == 200
        mock_artifact_svc.list_artifact_keys.assert_not_called()
        mock_artifact_svc.delete_artifact.assert_not_called()
        mock_session_svc.delete_session.assert_called_once()

    @pytest.mark.unit
    def test_cleanup_does_not_depend_on_artifact_service(self, test_client):
        """Session cleanup succeeds even if artifact listing would fail."""
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()
        mock_artifact_svc.list_artifact_keys = AsyncMock(
            side_effect=RuntimeError("GCS down"),
        )

        response = self._run_streaming_request(
            test_client,
            mock_session_svc,
            mock_artifact_svc,
            workflow_raises=True,
        )

        assert response.status_code == 200
        mock_artifact_svc.list_artifact_keys.assert_not_called()
        mock_artifact_svc.delete_artifact.assert_not_called()
        mock_session_svc.delete_session.assert_called_once()

    @pytest.mark.unit
    def test_success_clears_correlation_id(self, test_client):
        """correlation_id is removed from inflight set on success."""
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()

        response = self._run_streaming_request(
            test_client,
            mock_session_svc,
            mock_artifact_svc,
            payload_extra={"correlation_id": "corr-xyz"},
        )

        assert response.status_code == 200
        import agent_api

        assert "corr-xyz" not in agent_api._INFLIGHT_CORRELATION_IDS


# =============================================================================
# Correlation-ID leak guards — regression tests for the 2026-04-21 incident
# where retries hit HTTP 409 because a prior run's correlation_id was stuck
# in _INFLIGHT_CORRELATION_IDS for up to an hour.
# =============================================================================


class TestCorrelationIdLeakGuards:
    """Ensure correlation_id is released on EVERY exit path of /r.

    Covered scenarios:
      - append_event raises before streaming starts (pre-G2 leak gap).
      - Workflow exception mid-stream (already covered by cleanup, verified here).
      - Idempotent re-registration after release succeeds (same corr-id
        can be used again — no permanent exclusion).
      - ``_release_inflight`` is idempotent and ``None``-safe.
    """

    @pytest.mark.unit
    def test_release_inflight_is_idempotent_and_none_safe(self):
        import agent_api

        agent_api._INFLIGHT_CORRELATION_IDS.clear()
        agent_api._INFLIGHT_CORRELATION_IDS["abc"] = time.time()

        agent_api._release_inflight("abc")
        assert "abc" not in agent_api._INFLIGHT_CORRELATION_IDS

        # Second release for the same id is a no-op, not an error.
        agent_api._release_inflight("abc")
        assert "abc" not in agent_api._INFLIGHT_CORRELATION_IDS

        # None is accepted.
        agent_api._release_inflight(None)

        # Unknown id is accepted.
        agent_api._release_inflight("never-seen")

    @pytest.mark.unit
    def test_append_event_failure_releases_correlation_id(self, test_client):
        """If append_event raises after correlation_id is registered, the
        handler MUST release it before returning 500 — otherwise the
        client's retry hits a stuck 409 for the full TTL.
        """
        import agent_api

        agent_api._INFLIGHT_CORRELATION_IDS.clear()
        agent_api._session_locks.clear()

        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()
        mock_session_svc.append_event = AsyncMock(
            side_effect=RuntimeError("synthetic append_event failure"),
        )

        with (
            patch("agent_api.get_session_service", return_value=mock_session_svc),
            patch("agent_api.get_artifact_service", return_value=mock_artifact_svc),
            patch("agent_api.Runner") as MockRunner,
            patch("agent_api.export_test_run_data", new_callable=AsyncMock),
        ):
            mock_runner = MockRunner.return_value
            mock_runner.session_service = mock_session_svc
            mock_runner.artifact_service = mock_artifact_svc
            mock_runner.run_async = MagicMock(side_effect=lambda *a, **kw: _empty_async_gen())

            response = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "sess-append-fail",
                    "operation_mode": "create",
                    "payload": json.dumps(
                        {"app_name": "t", "correlation_id": "corr-append-fail"},
                    ),
                },
            )

        # Handler returns 500 for the append_event failure.
        assert response.status_code == 500
        # Critical invariant: correlation_id is no longer in the inflight set.
        assert "corr-append-fail" not in agent_api._INFLIGHT_CORRELATION_IDS
        # Session lock was also released (retry must succeed).
        lock = agent_api._session_locks.get("sess-append-fail")
        assert lock is None or not lock.locked()

    @pytest.mark.unit
    def test_correlation_id_can_be_reused_after_workflow_failure(self, test_client):
        """After a workflow exception, the same correlation_id can be
        re-submitted and is accepted (not stuck at 409).

        This is the end-to-end version of the leak guard: it proves that
        a second attempt with the same corr-id does NOT hit the 409
        duplicate-request guard because cleanup released the slot.
        """
        import agent_api

        agent_api._INFLIGHT_CORRELATION_IDS.clear()
        agent_api._session_locks.clear()

        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()

        # First run: workflow raises mid-stream, cleanup should release.
        with (
            patch("agent_api.get_session_service", return_value=mock_session_svc),
            patch("agent_api.get_artifact_service", return_value=mock_artifact_svc),
            patch("agent_api.Runner") as MockRunner,
            patch("agent_api.export_test_run_data", new_callable=AsyncMock),
            patch("agent_api._notify_backend_failure", new_callable=AsyncMock),
        ):
            mock_runner = MockRunner.return_value
            mock_runner.session_service = mock_session_svc
            mock_runner.artifact_service = mock_artifact_svc
            mock_runner.run_async = MagicMock(side_effect=lambda *a, **kw: _failing_async_gen())
            r1 = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "sess-reuse",
                    "operation_mode": "create",
                    "payload": json.dumps(
                        {"app_name": "t", "correlation_id": "corr-reuse"},
                    ),
                },
            )
            # Stream completes (200), even though workflow raised.
            assert r1.status_code == 200
            # Consume the SSE body so the generator's finally runs.
            _ = r1.text

        # After the first run, the slot must be free.
        assert "corr-reuse" not in agent_api._INFLIGHT_CORRELATION_IDS

        # Second run with the SAME correlation_id must NOT 409.
        mock_session_svc2, mock_artifact_svc2 = _build_streaming_mocks()
        with (
            patch("agent_api.get_session_service", return_value=mock_session_svc2),
            patch("agent_api.get_artifact_service", return_value=mock_artifact_svc2),
            patch("agent_api.Runner") as MockRunner,
            patch("agent_api.export_test_run_data", new_callable=AsyncMock),
        ):
            mock_runner = MockRunner.return_value
            mock_runner.session_service = mock_session_svc2
            mock_runner.artifact_service = mock_artifact_svc2
            mock_runner.run_async = MagicMock(side_effect=lambda *a, **kw: _empty_async_gen())
            r2 = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "sess-reuse-2",
                    "operation_mode": "create",
                    "payload": json.dumps(
                        {"app_name": "t", "correlation_id": "corr-reuse"},
                    ),
                },
            )
            _ = r2.text
            assert r2.status_code == 200


# =============================================================================
# IAM caller verification at /r endpoint
# =============================================================================


class TestIamCallerVerificationEndpoint:
    """Tests for IAM caller verification in the /r endpoint."""

    @pytest.mark.unit
    def test_production_rejects_missing_auth(self, test_client):
        """In production, missing Authorization header → 401."""
        with patch("agent_api.IS_PRODUCTION", True):
            response = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "create",
                    "payload": json.dumps({"app_name": "test"}),
                },
            )
        assert response.status_code == 401
        # authenticate_caller() returns a generic `error` with the specific
        # reason in `message` (uniform shape across /r, /cancel, /artifacts).
        assert response.json()["message"] == "Authorization header required"

    @pytest.mark.unit
    def test_production_rejects_invalid_iam_token(self, test_client):
        """In production, invalid IAM token → 403."""
        with (
            patch("agent_api.IS_PRODUCTION", True),
            patch("agent_api.verify_iam_caller", return_value=(False, "Invalid IAM token")),
        ):
            response = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "create",
                    "payload": json.dumps({"app_name": "test"}),
                },
                headers={"Authorization": "Bearer garbage-token"},
            )
        assert response.status_code == 403

    @pytest.mark.unit
    def test_development_skips_iam_check(self, test_client):
        """In development, IAM verification is skipped entirely."""
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()

        with (
            patch("agent_api.IS_PRODUCTION", False),
            patch("agent_api.get_session_service", return_value=mock_session_svc),
            patch("agent_api.get_artifact_service", return_value=mock_artifact_svc),
            patch("agent_api.Runner") as MockRunner,
            patch("agent_api.export_test_run_data", new_callable=AsyncMock),
        ):
            mock_runner = MockRunner.return_value
            mock_runner.session_service = mock_session_svc
            mock_runner.artifact_service = mock_artifact_svc
            mock_runner.run_async = MagicMock(side_effect=lambda *a, **kw: _empty_async_gen())

            response = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "create",
                    "payload": json.dumps({"app_name": "test"}),
                },
            )
        # Request proceeds past auth (200 streaming response) — no 401/403
        assert response.status_code == 200


# =============================================================================
# Fix 4: Concurrent session guard
# =============================================================================


class TestConcurrentSessionGuard:
    """Tests for Fix 4 — per-session locking."""

    @pytest.mark.unit
    def test_locked_session_returns_409(self, test_client):
        """Request for an already-locked session → 409.

        IS_PRODUCTION is False in tests, so IAM verification is skipped.
        """
        mock_lock = MagicMock()
        mock_lock.locked.return_value = True

        with patch("agent_api._get_session_lock", return_value=mock_lock):
            response = test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "create",
                    "payload": json.dumps({"app_name": "test"}),
                },
            )
        assert response.status_code == 409
        assert "already being processed" in response.json()["error"]

    @pytest.mark.unit
    def test_get_session_lock_returns_same_instance(self):
        """Same session_id returns the same Lock object."""
        from agent_api import _get_session_lock, _session_locks

        _session_locks.clear()
        lock1 = _get_session_lock("test-session-lock")
        lock2 = _get_session_lock("test-session-lock")
        assert lock1 is lock2

    @pytest.mark.unit
    def test_session_locks_cap_memory(self):
        """Lock store evicts oldest entries when capacity is exceeded."""
        from agent_api import _get_session_lock, _session_locks

        _session_locks.clear()

        with patch("agent_api._SESSION_LOCKS_MAX", 5):
            for i in range(8):
                _get_session_lock(f"s-{i}")
            assert len(_session_locks) <= 5
            # Most recent sessions should still be present
            assert "s-7" in _session_locks
            assert "s-6" in _session_locks


# =============================================================================
# Fix 7: Chat history truncation
# =============================================================================


class TestChatHistoryBounds:
    """Tests for Fix 7 — chat_history capped at MAX_CHAT_HISTORY_ENTRIES."""

    def _get_append_event_state_delta(
        self,
        test_client,
        mock_session_svc,
        mock_artifact_svc,
        payload_data,
    ):
        """Run a request and return state_delta from the append_event call.

        IS_PRODUCTION is False in tests, so IAM verification is skipped.
        """
        with (
            patch("agent_api.get_session_service", return_value=mock_session_svc),
            patch("agent_api.get_artifact_service", return_value=mock_artifact_svc),
            patch("agent_api.Runner") as MockRunner,
            patch("agent_api.export_test_run_data", new_callable=AsyncMock),
        ):
            mock_runner = MockRunner.return_value
            mock_runner.session_service = mock_session_svc
            mock_runner.artifact_service = mock_artifact_svc
            mock_runner.run_async = MagicMock(side_effect=lambda *a, **kw: _empty_async_gen())

            test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "create",
                    "payload": json.dumps(payload_data),
                },
            )

        # Extract the Event object passed to append_event
        event_arg = mock_session_svc.append_event.call_args[0][1]
        return event_arg.actions.state_delta

    @pytest.mark.unit
    def test_long_chat_history_truncated(self, test_client):
        """chat_history with >20 entries is truncated to 20."""
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()
        history = [{"role": "user", "text": f"msg-{i}"} for i in range(30)]

        state_delta = self._get_append_event_state_delta(
            test_client,
            mock_session_svc,
            mock_artifact_svc,
            {"app_name": "test", "chat_history": history},
        )
        assert len(state_delta["chat_history"]) == 20

    @pytest.mark.unit
    def test_short_chat_history_preserved(self, test_client):
        """chat_history with <=20 entries is left unchanged."""
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()
        history = [{"role": "user", "text": f"msg-{i}"} for i in range(5)]

        state_delta = self._get_append_event_state_delta(
            test_client,
            mock_session_svc,
            mock_artifact_svc,
            {"app_name": "test", "chat_history": history},
        )
        assert len(state_delta["chat_history"]) == 5

    @pytest.mark.unit
    def test_truncation_keeps_latest_entries(self, test_client):
        """When truncated, the last 20 entries are kept (most recent messages)."""
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()
        history = [{"role": "user", "text": f"msg-{i}"} for i in range(30)]

        state_delta = self._get_append_event_state_delta(
            test_client,
            mock_session_svc,
            mock_artifact_svc,
            {"app_name": "test", "chat_history": history},
        )
        # Should keep entries 10–29 (the last 20). Entries are normalized from
        # {role, text} dicts to "role: text" strings at the boundary.
        assert state_delta["chat_history"][0] == "user: msg-10"
        assert state_delta["chat_history"][-1] == "user: msg-29"

    @pytest.mark.unit
    def test_dict_turns_normalized_to_strings(self, test_client):
        """{role, content} turns become strings so list[str] models don't crash.

        Regression: the runtime worker sends chat_history as
        [{"role": "user", "content": "hi"}], which raised a Pydantic
        string_type ValidationError at AppHelpDeskInput construction and
        aborted the whole SSE run.
        """
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()
        history = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello there"},
        ]

        state_delta = self._get_append_event_state_delta(
            test_client,
            mock_session_svc,
            mock_artifact_svc,
            {"app_name": "test", "chat_history": history},
        )
        assert state_delta["chat_history"] == ["user: hi", "assistant: hello there"]
        assert all(isinstance(e, str) for e in state_delta["chat_history"])


# =============================================================================
# current_prompt backfill — edit routing reads state["current_prompt"], but the
# worker's edit payload only sends app_description/initial_description/user_prompt.
# Without the backfill the AppHelpDesk router gets an empty user_request and
# intermittently mis-routes a clear edit to help_desk (silent no-op).
# =============================================================================


class TestCurrentPromptBackfill:
    def _state_delta(self, test_client, payload_data):
        mock_session_svc, mock_artifact_svc = _build_streaming_mocks()
        with (
            patch("agent_api.get_session_service", return_value=mock_session_svc),
            patch("agent_api.get_artifact_service", return_value=mock_artifact_svc),
            patch("agent_api.Runner") as MockRunner,
            patch("agent_api.export_test_run_data", new_callable=AsyncMock),
        ):
            mock_runner = MockRunner.return_value
            mock_runner.session_service = mock_session_svc
            mock_runner.artifact_service = mock_artifact_svc
            mock_runner.run_async = MagicMock(side_effect=lambda *a, **kw: _empty_async_gen())
            test_client.post(
                "/r",
                json={
                    "user_id": "u1",
                    "session_id": "s1",
                    "operation_mode": "edit",
                    "payload": json.dumps(payload_data),
                },
            )
        return mock_session_svc.append_event.call_args[0][1].actions.state_delta

    @pytest.mark.unit
    def test_current_prompt_backfilled_from_app_description(self, test_client):
        """The worker's edit payload sends the prompt as app_description only."""
        sd = self._state_delta(
            test_client, {"app_name": "t", "app_description": "Add a footer line"}
        )
        assert sd["current_prompt"] == "Add a footer line"

    @pytest.mark.unit
    def test_current_prompt_backfilled_from_initial_description(self, test_client):
        sd = self._state_delta(
            test_client, {"app_name": "t", "initial_description": "Make the total bold"}
        )
        assert sd["current_prompt"] == "Make the total bold"

    @pytest.mark.unit
    def test_explicit_current_prompt_is_preserved(self, test_client):
        """An explicit current_prompt is never overwritten by the description shim."""
        sd = self._state_delta(
            test_client,
            {"app_name": "t", "app_description": "desc", "current_prompt": "explicit"},
        )
        assert sd["current_prompt"] == "explicit"

    @pytest.mark.unit
    def test_no_current_prompt_when_no_description(self, test_client):
        sd = self._state_delta(test_client, {"app_name": "t"})
        assert not sd.get("current_prompt")


# =============================================================================
# Internal shared-secret auth (self-host / non-production)
# =============================================================================


def _fake_request(headers=None):
    """A minimal stand-in for a Starlette Request with a case-flexible headers.get."""
    hdrs = headers or {}
    req = MagicMock()
    req.headers.get = lambda key, default="": hdrs.get(key, default)
    return req


class TestInternalTokenAuth:
    """Tests for verify_internal_caller / authenticate_caller in self-host mode."""

    @pytest.mark.unit
    def test_valid_internal_token_accepted(self):
        import agent_api

        with patch("agent_api.INTERNAL_AGENT_TOKEN", "s3cret"):
            ok, msg = agent_api.verify_internal_caller(
                _fake_request({"X-Exepad-Internal-Secret": "s3cret"})
            )
        assert ok is True
        assert msg == ""

    @pytest.mark.unit
    def test_wrong_internal_token_rejected(self):
        import agent_api

        with patch("agent_api.INTERNAL_AGENT_TOKEN", "s3cret"):
            ok, msg = agent_api.verify_internal_caller(
                _fake_request({"X-Exepad-Internal-Secret": "nope"})
            )
        assert ok is False

    @pytest.mark.unit
    def test_missing_internal_token_header_rejected(self):
        import agent_api

        with patch("agent_api.INTERNAL_AGENT_TOKEN", "s3cret"):
            ok, msg = agent_api.verify_internal_caller(_fake_request({}))
        assert ok is False

    @pytest.mark.unit
    def test_unconfigured_token_rejects_by_default(self):
        """No token configured and no escape hatch → fail closed."""
        import agent_api

        with (
            patch("agent_api.INTERNAL_AGENT_TOKEN", ""),
            patch("agent_api.ALLOW_UNAUTHENTICATED_AGENT", False),
        ):
            ok, msg = agent_api.verify_internal_caller(_fake_request({}))
        assert ok is False
        assert "not configured" in msg

    @pytest.mark.unit
    def test_escape_hatch_allows_unauthenticated(self):
        import agent_api

        with (
            patch("agent_api.INTERNAL_AGENT_TOKEN", ""),
            patch("agent_api.ALLOW_UNAUTHENTICATED_AGENT", True),
        ):
            ok, msg = agent_api.verify_internal_caller(_fake_request({}))
        assert ok is True

    @pytest.mark.unit
    def test_authenticate_caller_selfhost_enforces_token(self):
        """Not production, not test → the internal token is required (finding #0)."""
        import agent_api

        with (
            patch("agent_api.IS_PRODUCTION", False),
            patch("agent_api.IS_TEST", False),
            patch("agent_api.INTERNAL_AGENT_TOKEN", "s3cret"),
            patch("agent_api.ALLOW_UNAUTHENTICATED_AGENT", False),
        ):
            ok, status, _ = agent_api.authenticate_caller(_fake_request({}))
            assert ok is False
            assert status == 403

            ok2, status2, _ = agent_api.authenticate_caller(
                _fake_request({"X-Exepad-Internal-Secret": "s3cret"})
            )
            assert ok2 is True
            assert status2 == 0

    @pytest.mark.unit
    def test_authenticate_caller_production_uses_iam(self):
        """Production path still goes through IAM, not the internal token."""
        import agent_api

        with (
            patch("agent_api.IS_PRODUCTION", True),
            patch("agent_api.verify_iam_caller", return_value=(True, "")) as m,
        ):
            ok, status, _ = agent_api.authenticate_caller(
                _fake_request({"Authorization": "Bearer tok"})
            )
        assert ok is True
        m.assert_called_once()
