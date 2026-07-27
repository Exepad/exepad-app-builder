"""Unit tests for rate limit handler module.

Tests for the error classifiers and the workflow failure payload generation.
"""

import pytest

from main_agent.agents.utils.rate_limit_handler import (
    is_rate_limit_error,
    is_transient_error,
    should_retry_error,
    get_error_type,
)

# =============================================================================
# Tests for is_rate_limit_error
# =============================================================================


class TestIsRateLimitError:
    """Tests for is_rate_limit_error function."""

    @pytest.mark.unit
    def test_429_error_detected(self):
        """429 status code should be detected as rate limit error."""
        error = Exception("429 Too Many Requests")
        assert is_rate_limit_error(error) is True

    @pytest.mark.unit
    def test_resource_exhausted_detected(self):
        """RESOURCE_EXHAUSTED should be detected as rate limit error."""
        error = Exception("429 RESOURCE_EXHAUSTED. Please try again later.")
        assert is_rate_limit_error(error) is True

    @pytest.mark.unit
    def test_resource_exhausted_lowercase(self):
        """resource_exhausted (lowercase) should be detected."""
        error = Exception("Error: resource_exhausted")
        assert is_rate_limit_error(error) is True

    @pytest.mark.unit
    def test_quota_exceeded_detected(self):
        """Quota exceeded should be detected as rate limit error."""
        error = Exception("Quota exceeded for this project")
        assert is_rate_limit_error(error) is True

    @pytest.mark.unit
    def test_too_many_requests_detected(self):
        """'Too many requests' should be detected as rate limit error."""
        error = Exception("too many requests - please slow down")
        assert is_rate_limit_error(error) is True

    @pytest.mark.unit
    def test_rate_limit_phrase_detected(self):
        """'Rate limit' phrase should be detected."""
        error = Exception("Rate limit exceeded")
        assert is_rate_limit_error(error) is True

    @pytest.mark.unit
    def test_non_rate_limit_not_detected(self):
        """Generic errors should not be detected as rate limit."""
        error = Exception("Something went wrong")
        assert is_rate_limit_error(error) is False

    @pytest.mark.unit
    def test_500_error_not_detected(self):
        """500 Internal Server Error should not be rate limit."""
        error = Exception("500 Internal Server Error")
        assert is_rate_limit_error(error) is False

    @pytest.mark.unit
    def test_503_error_not_detected_as_rate_limit(self):
        """503 Service Unavailable should not be rate limit (it's transient)."""
        error = Exception("503 Service Unavailable")
        assert is_rate_limit_error(error) is False

    @pytest.mark.unit
    def test_timeout_not_rate_limit(self):
        """Timeout errors should not be rate limit."""
        error = TimeoutError("Connection timed out")
        assert is_rate_limit_error(error) is False


# =============================================================================
# Tests for is_transient_error
# =============================================================================


class TestIsTransientError:
    """Tests for is_transient_error function."""

    @pytest.mark.unit
    def test_503_service_unavailable(self):
        """503 Service Unavailable should be detected as transient."""
        error = Exception("503 Service Unavailable")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_502_bad_gateway(self):
        """502 Bad Gateway should be detected as transient."""
        error = Exception("502 Bad Gateway")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_504_gateway_timeout(self):
        """504 Gateway Timeout should be detected as transient."""
        error = Exception("504 Gateway Timeout")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_timeout_error_exception_type(self):
        """TimeoutError exception type should be detected as transient."""
        error = TimeoutError("Connection timed out")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_timeout_in_message(self):
        """'Timeout' in message should be detected as transient."""
        error = Exception("Request timeout after 30 seconds")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_timed_out_in_message(self):
        """'Timed out' in message should be detected as transient."""
        error = Exception("Connection timed out")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_connection_refused(self):
        """Connection refused should be detected as transient."""
        error = Exception("Connection refused by server")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_connection_reset(self):
        """Connection reset should be detected as transient."""
        error = Exception("Connection reset by peer")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_connection_error_exception_type(self):
        """ConnectionError exception type should be detected as transient."""
        error = ConnectionError("Unable to connect")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_unavailable_keyword(self):
        """'Unavailable' keyword should be detected as transient."""
        error = Exception("Service temporarily unavailable")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_temporarily_keyword(self):
        """'Temporarily' keyword should be detected as transient."""
        error = Exception("Resource temporarily blocked")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_dns_error(self):
        """DNS errors should be detected as transient."""
        error = Exception("DNS resolution failed")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_network_error(self):
        """Network errors should be detected as transient."""
        error = Exception("Network unreachable")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_econnreset(self):
        """ECONNRESET should be detected as transient."""
        error = Exception("ECONNRESET: Connection reset")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_etimedout(self):
        """ETIMEDOUT should be detected as transient."""
        error = Exception("ETIMEDOUT: Connection timed out")
        assert is_transient_error(error) is True

    @pytest.mark.unit
    def test_non_transient_not_detected(self):
        """Generic errors should not be detected as transient."""
        error = Exception("Invalid input data")
        assert is_transient_error(error) is False

    @pytest.mark.unit
    def test_400_error_not_transient(self):
        """400 Bad Request should not be transient."""
        error = Exception("400 Bad Request")
        assert is_transient_error(error) is False

    @pytest.mark.unit
    def test_401_error_not_transient(self):
        """401 Unauthorized should not be transient."""
        error = Exception("401 Unauthorized")
        assert is_transient_error(error) is False

    @pytest.mark.unit
    def test_429_not_transient(self):
        """429 Rate Limit should NOT be transient (it's rate limit)."""
        error = Exception("429 Too Many Requests")
        assert is_transient_error(error) is False

    @pytest.mark.unit
    def test_500_not_transient_without_keywords(self):
        """Generic 500 without keywords should not be transient."""
        error = Exception("500 Internal Server Error")
        assert is_transient_error(error) is False


# =============================================================================
# Tests for should_retry_error
# =============================================================================


class TestShouldRetryError:
    """Tests for should_retry_error function."""

    @pytest.mark.unit
    def test_rate_limit_should_retry(self):
        """Rate limit errors should trigger retry."""
        error = Exception("429 RESOURCE_EXHAUSTED")
        assert should_retry_error(error) is True

    @pytest.mark.unit
    def test_transient_should_retry(self):
        """Transient errors should trigger retry."""
        error = Exception("503 Service Unavailable")
        assert should_retry_error(error) is True

    @pytest.mark.unit
    def test_timeout_should_retry(self):
        """Timeout errors should trigger retry."""
        error = TimeoutError("Connection timed out")
        assert should_retry_error(error) is True

    @pytest.mark.unit
    def test_connection_error_should_retry(self):
        """Connection errors should trigger retry."""
        error = ConnectionError("Connection refused")
        assert should_retry_error(error) is True

    @pytest.mark.unit
    def test_permanent_should_not_retry(self):
        """Permanent errors should not trigger retry."""
        error = Exception("Invalid API key")
        assert should_retry_error(error) is False

    @pytest.mark.unit
    def test_400_should_not_retry(self):
        """400 Bad Request should not trigger retry."""
        error = Exception("400 Bad Request: Invalid JSON")
        assert should_retry_error(error) is False

    @pytest.mark.unit
    def test_401_should_not_retry(self):
        """401 Unauthorized should not trigger retry."""
        error = Exception("401 Unauthorized")
        assert should_retry_error(error) is False

    @pytest.mark.unit
    def test_403_should_not_retry(self):
        """403 Forbidden should not trigger retry."""
        error = Exception("403 Forbidden")
        assert should_retry_error(error) is False

    @pytest.mark.unit
    def test_500_only_should_not_retry(self):
        """Generic 500 without specific keywords should not retry."""
        error = Exception("500 Internal Server Error")
        assert should_retry_error(error) is False

    @pytest.mark.unit
    def test_value_error_should_not_retry(self):
        """ValueError should not trigger retry."""
        error = ValueError("Invalid value provided")
        assert should_retry_error(error) is False

    @pytest.mark.unit
    def test_deadline_exceeded_should_retry(self):
        """504 DEADLINE_EXCEEDED is a transient server overload signal —
        retrying with backoff is the correct behavior. Used to be the only
        retryable class wired up but never reached because the
        classification didn't OR-in is_deadline_exceeded_error."""
        error = Exception("504 DEADLINE_EXCEEDED: deadline expired")
        assert should_retry_error(error) is True

    @pytest.mark.unit
    def test_deadline_exceeded_grpc_should_retry(self):
        """gRPC-style ``DEADLINE_EXCEEDED`` strings without an HTTP code
        prefix must also classify as retryable."""
        error = Exception("DEADLINE_EXCEEDED")
        assert should_retry_error(error) is True


# =============================================================================
# Tests for get_error_type
# =============================================================================


class TestGetErrorType:
    """Tests for get_error_type function."""

    @pytest.mark.unit
    def test_rate_limit_type(self):
        """Rate limit errors should return 'rate_limit' type."""
        error = Exception("429 RESOURCE_EXHAUSTED")
        assert get_error_type(error) == "rate_limit"

    @pytest.mark.unit
    def test_quota_exceeded_type(self):
        """Quota exceeded should return 'rate_limit' type."""
        error = Exception("Quota exceeded")
        assert get_error_type(error) == "rate_limit"

    @pytest.mark.unit
    def test_transient_type_503(self):
        """503 errors should return 'transient' type."""
        error = Exception("503 Service Unavailable")
        assert get_error_type(error) == "transient"

    @pytest.mark.unit
    def test_transient_type_timeout(self):
        """Timeout errors should return 'transient' type."""
        error = TimeoutError("Connection timed out")
        assert get_error_type(error) == "transient"

    @pytest.mark.unit
    def test_transient_type_connection(self):
        """Connection errors should return 'transient' type."""
        error = ConnectionError("Connection refused")
        assert get_error_type(error) == "transient"

    @pytest.mark.unit
    def test_permanent_type(self):
        """Non-retryable errors should return 'permanent' type."""
        error = Exception("400 Bad Request")
        assert get_error_type(error) == "permanent"

    @pytest.mark.unit
    def test_permanent_type_generic(self):
        """Generic errors should return 'permanent' type."""
        error = Exception("Something went wrong")
        assert get_error_type(error) == "permanent"

    @pytest.mark.unit
    def test_permanent_type_value_error(self):
        """ValueError should return 'permanent' type."""
        error = ValueError("Invalid input")
        assert get_error_type(error) == "permanent"

    @pytest.mark.unit
    def test_deadline_exceeded_classified(self):
        """``deadline_exceeded`` is its own classification (NOT folded into
        ``transient``) so callers can apply a longer first-attempt backoff."""
        error = Exception("DEADLINE_EXCEEDED")
        assert get_error_type(error) == "deadline_exceeded"

    @pytest.mark.unit
    def test_deadline_with_504_prefix_classified_as_transient_first(self):
        """``504 DEADLINE_EXCEEDED`` is matched by ``is_transient_error``'s
        ``"504"`` substring rule before reaching the deadline branch — so
        it classifies as ``transient``. This is intentional precedence:
        the 504 substring is more specific to the HTTP path."""
        error = Exception("504 DEADLINE_EXCEEDED: deadline expired")
        assert get_error_type(error) == "transient"


# =============================================================================
# Tests for create_workflow_failure_payload
# =============================================================================


class TestWorkflowFailurePayload:
    """Tests for create_workflow_failure_payload function."""

    @pytest.mark.unit
    def test_payload_structure(self):
        """Failure payload should have correct structure."""
        from agent_api import create_workflow_failure_payload

        error = Exception("Test error")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session-123",
            state_delta={"correlation_id": "corr-456", "app_uuid": "app-789"},
        )

        assert "type" in payload
        assert "timestamp" in payload
        assert "callback_data" in payload

    @pytest.mark.unit
    def test_status_is_failed(self):
        """Failure payload status should be 'failed'."""
        from agent_api import create_workflow_failure_payload

        error = Exception("Test error")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={},
        )

        assert payload["callback_data"]["status"] == "failed"

    @pytest.mark.unit
    def test_type_is_backend_response(self):
        """Payload type should be 'backend_response'."""
        from agent_api import create_workflow_failure_payload

        error = Exception("Test error")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={},
        )

        assert payload["type"] == "backend_response"

    @pytest.mark.unit
    def test_error_type_captured(self):
        """Error type should be captured in payload."""
        from agent_api import create_workflow_failure_payload

        error = ValueError("Invalid value")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={},
        )

        assert payload["callback_data"]["error"]["type"] == "ValueError"

    @pytest.mark.unit
    def test_error_message_captured(self):
        """Error message should be captured in payload."""
        from agent_api import create_workflow_failure_payload

        error = Exception("Something went wrong")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={},
        )

        assert "Something went wrong" in payload["callback_data"]["error"]["message"]

    @pytest.mark.unit
    def test_error_message_truncated(self):
        """Long error messages should be truncated."""
        from agent_api import create_workflow_failure_payload

        long_message = "X" * 2000
        error = Exception(long_message)
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={},
        )

        # Message should be truncated to 1000 chars
        assert len(payload["callback_data"]["error"]["message"]) <= 1000

    @pytest.mark.unit
    def test_timestamp_format(self):
        """Timestamp should be in ISO 8601 format."""
        from agent_api import create_workflow_failure_payload

        error = Exception("Test error")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={},
        )

        timestamp = payload["timestamp"]
        # Should contain T separator and timezone indicator
        assert "T" in timestamp
        # Should be parseable as ISO format (contains expected chars)
        assert "-" in timestamp

    @pytest.mark.unit
    def test_session_id_captured(self):
        """Session ID should be captured in payload."""
        from agent_api import create_workflow_failure_payload

        error = Exception("Test error")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="my-session-id",
            state_delta={},
        )

        assert payload["callback_data"]["session_id"] == "my-session-id"

    @pytest.mark.unit
    def test_correlation_id_captured(self):
        """Correlation ID should be captured from state_delta."""
        from agent_api import create_workflow_failure_payload

        error = Exception("Test error")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={"correlation_id": "corr-123"},
        )

        assert payload["callback_data"]["correlation_id"] == "corr-123"

    @pytest.mark.unit
    def test_agent_errors_list(self):
        """Payload should contain agent_errors list."""
        from agent_api import create_workflow_failure_payload

        error = Exception("Test error")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={},
        )

        assert "agent_errors" in payload["callback_data"]
        assert isinstance(payload["callback_data"]["agent_errors"], list)
        assert len(payload["callback_data"]["agent_errors"]) == 1

    @pytest.mark.unit
    def test_agent_error_structure(self):
        """Agent error in payload should have correct structure."""
        from agent_api import create_workflow_failure_payload

        error = TimeoutError("Connection timed out")
        payload = create_workflow_failure_payload(
            error=error,
            session_id="test-session",
            state_delta={},
        )

        agent_error = payload["callback_data"]["agent_errors"][0]

        assert agent_error["error_type"] == "llm_unavailable"
        assert agent_error["agent_name"] == "Workflow"
        assert "TimeoutError" in agent_error["summary"]
        assert agent_error["error_class"] == "TimeoutError"
