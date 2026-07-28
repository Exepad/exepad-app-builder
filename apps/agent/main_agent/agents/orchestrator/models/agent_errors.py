"""Agent error models for reporting failures to the backend."""

from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class AgentErrorType(str, Enum):
    """Types of agent errors that need to be reported to the backend."""

    ARTIFACT_GENERATION_FAILED = "artifact_generation_failed"
    RATE_LIMIT_EXHAUSTED = "rate_limit_exhausted"  # For 429 errors after retries exhausted
    LLM_UNAVAILABLE = "llm_unavailable"  # For complete LLM failures (503, timeouts, etc.)
    CONTENT_REFERENCE_UNRESOLVED = (
        "content_reference_unresolved"  # For @filename refs that couldn't be matched
    )
    WORKFLOW_ERROR = "workflow_error"  # For unhandled permanent exceptions in the workflow
    VALIDATION_ERROR = "validation_error"  # For JSON/schema validation failures
    TIMEOUT_ERROR = "timeout_error"  # For timeout-related permanent failures


class FailedArtifactDetail(BaseModel):
    """Details about a single failed artifact generation."""

    artifact_identifier: str = Field(
        description="The identifier of the artifact that failed to generate"
    )
    page_uuid: Optional[str] = Field(
        default=None, description="UUID of the page this artifact belongs to"
    )
    page_slug: Optional[str] = Field(
        default=None, description="Slug of the page this artifact belongs to"
    )
    section_name: Optional[str] = Field(
        default=None, description="Name of the section this artifact represents"
    )
    section_slug: Optional[str] = Field(
        default=None, description="Slug of the section this artifact represents"
    )
    is_header: bool = Field(
        default=False, description="Whether this artifact is a header component"
    )
    is_footer: bool = Field(
        default=False, description="Whether this artifact is a footer component"
    )


class AgentError(BaseModel):
    """Represents a single agent error event."""

    error_type: AgentErrorType = Field(description="The type of error that occurred")
    agent_name: str = Field(description="Name of the agent that encountered the error")
    timestamp: str = Field(description="ISO 8601 timestamp when the error was detected")
    summary: str = Field(description="Human-readable summary of the error")

    # Batch processing specific fields
    total_tasks_requested: int = Field(description="Total number of tasks that were requested")
    total_tasks_succeeded: int = Field(description="Number of tasks that completed successfully")
    total_tasks_failed: int = Field(description="Number of tasks that failed")

    # Detailed failure information
    failed_artifacts: List[FailedArtifactDetail] = Field(
        default_factory=list,
        description="List of artifacts that failed to generate with their metadata",
    )

    # Optional additional context
    batch_index: Optional[int] = Field(
        default=None,
        description="Index of the batch if multiple batches were processed",
    )
    total_batches: Optional[int] = Field(
        default=None, description="Total number of batches in the batch processing"
    )


class RateLimitAgentError(BaseModel):
    """Represents a rate limit exhaustion error event (429 RESOURCE_EXHAUSTED)."""

    error_type: AgentErrorType = Field(
        default=AgentErrorType.RATE_LIMIT_EXHAUSTED,
        description="The type of error (always RATE_LIMIT_EXHAUSTED for this model)",
    )
    agent_name: str = Field(description="Name of the agent that encountered the rate limit")
    timestamp: str = Field(description="ISO 8601 timestamp when the error was detected")
    summary: str = Field(description="Human-readable summary of the rate limit error")

    # Rate limit specific fields
    retry_attempts: int = Field(description="Number of retry attempts made before giving up")
    total_delay_seconds: float = Field(
        description="Total time spent waiting during retries (in seconds)"
    )
    last_error_message: str = Field(description="The error message from the last failed attempt")

    # Context about what was being processed
    batch_index: Optional[int] = Field(
        default=None, description="Index of the batch being processed when error occurred"
    )
    total_batches: Optional[int] = Field(
        default=None, description="Total number of batches in the operation"
    )
    components_affected: List[str] = Field(
        default_factory=list,
        description="List of component identifiers that were affected by this error",
    )


class LLMUnavailableError(BaseModel):
    """Represents a complete LLM failure (503, timeouts, connection errors, etc.)."""

    error_type: AgentErrorType = Field(
        default=AgentErrorType.LLM_UNAVAILABLE,
        description="The type of error (always LLM_UNAVAILABLE for this model)",
    )
    agent_name: str = Field(description="Name of the agent that encountered the LLM failure")
    timestamp: str = Field(description="ISO 8601 timestamp when the error was detected")
    summary: str = Field(description="Human-readable summary of the LLM failure")

    # Error details
    error_class: str = Field(
        description="The exception class name (e.g., 'TimeoutError', 'ConnectionError')"
    )
    error_message: str = Field(description="The error message from the failed attempt")
    retry_attempts: int = Field(description="Number of retry attempts made before giving up")
    is_transient: bool = Field(
        default=False,
        description="Whether this was a transient error (503, timeout) vs permanent failure",
    )

    # Context about what was being processed
    batch_index: Optional[int] = Field(
        default=None, description="Index of the batch being processed when error occurred"
    )
    total_batches: Optional[int] = Field(
        default=None, description="Total number of batches in the operation"
    )
    components_affected: List[str] = Field(
        default_factory=list,
        description="List of component identifiers that were affected by this error",
    )


class ContentReferenceError(BaseModel):
    """Represents unresolved @filename references in user prompt."""

    error_type: AgentErrorType = Field(
        default=AgentErrorType.CONTENT_REFERENCE_UNRESOLVED,
        description="The type of error (always CONTENT_REFERENCE_UNRESOLVED for this model)",
    )
    agent_name: str = Field(
        default="DocumentArtifactService",
        description="Name of the service that detected the unresolved references",
    )
    timestamp: str = Field(description="ISO 8601 timestamp when the error was detected")
    summary: str = Field(description="Human-readable summary of the unresolved references")

    # Unresolved reference details
    unresolved_references: List[str] = Field(
        default_factory=list,
        description="List of filenames that could not be matched to catalog entries",
    )
