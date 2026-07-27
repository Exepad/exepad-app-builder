"""
Unified error handling for the agent pipeline.

Defines error severity levels and base exceptions used throughout
the pipeline orchestrator and workflow execution.
"""

from enum import Enum


class ErrorSeverity(str, Enum):
    """Error severity levels for pipeline steps."""

    FATAL = "fatal"  # Stop the entire pipeline
    ERROR = "error"  # Skip this step, continue pipeline
    WARNING = "warning"  # Log and continue


class PipelineError(Exception):
    """Base exception for pipeline errors with severity and context.

    Attributes:
        severity: How the pipeline should respond to this error.
        step_name: Which pipeline step produced the error.
        context: Additional context for debugging.
    """

    def __init__(
        self,
        message: str,
        severity: ErrorSeverity = ErrorSeverity.ERROR,
        step_name: str = "",
        context: dict | None = None,
    ):
        super().__init__(message)
        self.severity = severity
        self.step_name = step_name
        self.context = context or {}


class BuilderError(PipelineError):
    """Error from a builder agent (JSON/TSX generation failures)."""

    def __init__(self, message: str, builder_name: str, **kwargs):
        super().__init__(
            message,
            step_name=builder_name,
            **kwargs,
        )
        self.builder_name = builder_name


class ValidationError(PipelineError):
    """Error from schema validation or cross-reference validation."""

    def __init__(self, message: str, validation_errors: list[str] | None = None, **kwargs):
        super().__init__(message, **kwargs)
        self.validation_errors = validation_errors or []
