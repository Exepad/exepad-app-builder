"""Unit tests for agent error models.

Tests for the error model classes used to report failures to the backend,
including AgentErrorType, RateLimitAgentError, and LLMUnavailableError.
"""

import pytest

from main_agent.agents.orchestrator.models import (
    AgentErrorType,
    FailedArtifactDetail,
    AgentError,
    RateLimitAgentError,
    LLMUnavailableError,
)

# =============================================================================
# Tests for AgentErrorType Enum
# =============================================================================


class TestAgentErrorType:
    """Tests for AgentErrorType enum."""

    @pytest.mark.unit
    def test_error_type_values(self):
        """AgentErrorType should have expected values."""
        assert AgentErrorType.ARTIFACT_GENERATION_FAILED.value == "artifact_generation_failed"
        assert AgentErrorType.RATE_LIMIT_EXHAUSTED.value == "rate_limit_exhausted"
        assert AgentErrorType.LLM_UNAVAILABLE.value == "llm_unavailable"

    @pytest.mark.unit
    def test_all_error_types_are_strings(self):
        """All AgentErrorType values should be strings."""
        for error_type in AgentErrorType:
            assert isinstance(error_type.value, str)
            assert len(error_type.value) > 0

    @pytest.mark.unit
    def test_error_type_count(self):
        """AgentErrorType should have exactly 7 error types."""
        assert len(AgentErrorType) == 7

    @pytest.mark.unit
    def test_error_type_inherits_str(self):
        """AgentErrorType should inherit from str for JSON serialization."""
        assert isinstance(AgentErrorType.RATE_LIMIT_EXHAUSTED, str)
        # Can use as string directly
        assert AgentErrorType.RATE_LIMIT_EXHAUSTED == "rate_limit_exhausted"


# =============================================================================
# Tests for FailedArtifactDetail
# =============================================================================


class TestFailedArtifactDetail:
    """Tests for FailedArtifactDetail model."""

    @pytest.mark.unit
    def test_create_with_required_fields(self):
        """FailedArtifactDetail should be creatable with only required fields."""
        detail = FailedArtifactDetail(artifact_identifier="hero_hero.json")

        assert detail.artifact_identifier == "hero_hero.json"
        assert detail.page_uuid is None
        assert detail.page_slug is None
        assert detail.is_header is False
        assert detail.is_footer is False

    @pytest.mark.unit
    def test_create_with_all_fields(self):
        """FailedArtifactDetail should accept all optional fields."""
        detail = FailedArtifactDetail(
            artifact_identifier="features_features.json",
            page_uuid="page-123",
            page_slug="/about",
            section_name="Features Section",
            section_slug="features",
            is_header=False,
            is_footer=False,
        )

        assert detail.artifact_identifier == "features_features.json"
        assert detail.page_uuid == "page-123"
        assert detail.page_slug == "/about"
        assert detail.section_name == "Features Section"

    @pytest.mark.unit
    def test_header_footer_flags(self):
        """is_header and is_footer flags should work correctly."""
        header_detail = FailedArtifactDetail(
            artifact_identifier="header.json",
            is_header=True,
        )
        footer_detail = FailedArtifactDetail(
            artifact_identifier="footer.json",
            is_footer=True,
        )

        assert header_detail.is_header is True
        assert header_detail.is_footer is False
        assert footer_detail.is_header is False
        assert footer_detail.is_footer is True


# =============================================================================
# Tests for RateLimitAgentError
# =============================================================================


class TestRateLimitAgentError:
    """Tests for RateLimitAgentError model."""

    @pytest.mark.unit
    def test_create_with_required_fields(self):
        """RateLimitAgentError should be creatable with required fields."""
        error = RateLimitAgentError(
            agent_name="ComponentBuilder",
            timestamp="2026-01-20T12:00:00Z",
            summary="Rate limit exhausted after 5 retries",
            retry_attempts=5,
            total_delay_seconds=62.5,
            last_error_message="429 RESOURCE_EXHAUSTED",
        )

        assert error.agent_name == "ComponentBuilder"
        assert error.retry_attempts == 5
        assert error.total_delay_seconds == 62.5

    @pytest.mark.unit
    def test_default_error_type(self):
        """RateLimitAgentError should have RATE_LIMIT_EXHAUSTED as default error type."""
        error = RateLimitAgentError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            retry_attempts=3,
            total_delay_seconds=10.0,
            last_error_message="429 error",
        )

        assert error.error_type == AgentErrorType.RATE_LIMIT_EXHAUSTED
        assert error.error_type.value == "rate_limit_exhausted"

    @pytest.mark.unit
    def test_components_affected_default_empty(self):
        """components_affected should default to empty list."""
        error = RateLimitAgentError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            retry_attempts=3,
            total_delay_seconds=10.0,
            last_error_message="429 error",
        )

        assert error.components_affected == []

    @pytest.mark.unit
    def test_components_affected_with_values(self):
        """components_affected should accept list of component IDs."""
        error = RateLimitAgentError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            retry_attempts=3,
            total_delay_seconds=10.0,
            last_error_message="429 error",
            components_affected=["hero_hero.json", "features_features.json"],
        )

        assert len(error.components_affected) == 2
        assert "hero_hero.json" in error.components_affected

    @pytest.mark.unit
    def test_batch_context_fields(self):
        """RateLimitAgentError should accept batch context fields."""
        error = RateLimitAgentError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Batch 2/3 failed",
            retry_attempts=5,
            total_delay_seconds=30.0,
            last_error_message="429 error",
            batch_index=1,
            total_batches=3,
        )

        assert error.batch_index == 1
        assert error.total_batches == 3

    @pytest.mark.unit
    def test_model_dump_serialization(self):
        """RateLimitAgentError should serialize correctly."""
        error = RateLimitAgentError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            retry_attempts=3,
            total_delay_seconds=10.5,
            last_error_message="429 RESOURCE_EXHAUSTED",
            components_affected=["comp1.json"],
        )

        data = error.model_dump()

        assert data["error_type"] == "rate_limit_exhausted"
        assert data["agent_name"] == "TestAgent"
        assert data["retry_attempts"] == 3
        assert data["total_delay_seconds"] == 10.5
        assert data["components_affected"] == ["comp1.json"]


# =============================================================================
# Tests for LLMUnavailableError
# =============================================================================


class TestLLMUnavailableError:
    """Tests for LLMUnavailableError model."""

    @pytest.mark.unit
    def test_create_with_required_fields(self):
        """LLMUnavailableError should be creatable with required fields."""
        error = LLMUnavailableError(
            agent_name="JsonComponentBuilder",
            timestamp="2026-01-20T12:00:00Z",
            summary="LLM unavailable: TimeoutError",
            error_class="TimeoutError",
            error_message="Connection timed out after 30 seconds",
            retry_attempts=5,
        )

        assert error.agent_name == "JsonComponentBuilder"
        assert error.error_class == "TimeoutError"
        assert error.error_message == "Connection timed out after 30 seconds"
        assert error.retry_attempts == 5

    @pytest.mark.unit
    def test_default_error_type(self):
        """LLMUnavailableError should have LLM_UNAVAILABLE as default error type."""
        error = LLMUnavailableError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            error_class="ConnectionError",
            error_message="Connection refused",
            retry_attempts=3,
        )

        assert error.error_type == AgentErrorType.LLM_UNAVAILABLE
        assert error.error_type.value == "llm_unavailable"

    @pytest.mark.unit
    def test_is_transient_default_false(self):
        """is_transient should default to False."""
        error = LLMUnavailableError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            error_class="Exception",
            error_message="Some error",
            retry_attempts=1,
        )

        assert error.is_transient is False

    @pytest.mark.unit
    def test_is_transient_flag_true(self):
        """is_transient should be settable to True for transient errors."""
        error = LLMUnavailableError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="503 Service Unavailable",
            error_class="ServiceUnavailableError",
            error_message="503 Service Unavailable",
            retry_attempts=5,
            is_transient=True,
        )

        assert error.is_transient is True

    @pytest.mark.unit
    def test_components_affected_default_empty(self):
        """components_affected should default to empty list."""
        error = LLMUnavailableError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            error_class="TimeoutError",
            error_message="Timeout",
            retry_attempts=3,
        )

        assert error.components_affected == []

    @pytest.mark.unit
    def test_components_affected_with_values(self):
        """components_affected should accept list of affected components."""
        error = LLMUnavailableError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            error_class="TimeoutError",
            error_message="Timeout",
            retry_attempts=3,
            components_affected=["hero_section", "navigation_bar"],
        )

        assert len(error.components_affected) == 2
        assert "hero_section" in error.components_affected

    @pytest.mark.unit
    def test_batch_context_fields(self):
        """LLMUnavailableError should accept batch context fields."""
        error = LLMUnavailableError(
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Batch 1/2 failed",
            error_class="TimeoutError",
            error_message="Timeout",
            retry_attempts=5,
            batch_index=0,
            total_batches=2,
        )

        assert error.batch_index == 0
        assert error.total_batches == 2

    @pytest.mark.unit
    def test_model_dump_serialization(self):
        """LLMUnavailableError should serialize correctly."""
        error = LLMUnavailableError(
            agent_name="ComponentBuilder",
            timestamp="2026-01-20T12:00:00Z",
            summary="LLM unavailable",
            error_class="TimeoutError",
            error_message="Connection timed out",
            retry_attempts=5,
            is_transient=True,
            components_affected=["hero_section.tsx"],
        )

        data = error.model_dump()

        assert data["error_type"] == "llm_unavailable"
        assert data["agent_name"] == "ComponentBuilder"
        assert data["error_class"] == "TimeoutError"
        assert data["is_transient"] is True
        assert data["retry_attempts"] == 5
        assert data["components_affected"] == ["hero_section.tsx"]


# =============================================================================
# Tests for AgentError (Base Model)
# =============================================================================


class TestAgentError:
    """Tests for AgentError base model."""

    @pytest.mark.unit
    def test_create_with_required_fields(self):
        """AgentError should be creatable with all required fields."""
        error = AgentError(
            error_type=AgentErrorType.ARTIFACT_GENERATION_FAILED,
            agent_name="ComponentBuilder",
            timestamp="2026-01-20T12:00:00Z",
            summary="3 of 10 artifacts failed to generate",
            total_tasks_requested=10,
            total_tasks_succeeded=7,
            total_tasks_failed=3,
        )

        assert error.error_type == AgentErrorType.ARTIFACT_GENERATION_FAILED
        assert error.total_tasks_requested == 10
        assert error.total_tasks_succeeded == 7
        assert error.total_tasks_failed == 3

    @pytest.mark.unit
    def test_failed_artifacts_default_empty(self):
        """failed_artifacts should default to empty list."""
        error = AgentError(
            error_type=AgentErrorType.ARTIFACT_GENERATION_FAILED,
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="Test error",
            total_tasks_requested=5,
            total_tasks_succeeded=5,
            total_tasks_failed=0,
        )

        assert error.failed_artifacts == []

    @pytest.mark.unit
    def test_failed_artifacts_with_details(self):
        """AgentError should accept failed artifact details."""
        failed_detail = FailedArtifactDetail(
            artifact_identifier="hero_hero.json",
            page_uuid="page-001",
            section_name="Hero",
        )

        error = AgentError(
            error_type=AgentErrorType.ARTIFACT_GENERATION_FAILED,
            agent_name="TestAgent",
            timestamp="2026-01-20T12:00:00Z",
            summary="1 artifact failed",
            total_tasks_requested=5,
            total_tasks_succeeded=4,
            total_tasks_failed=1,
            failed_artifacts=[failed_detail],
        )

        assert len(error.failed_artifacts) == 1
        assert error.failed_artifacts[0].artifact_identifier == "hero_hero.json"
