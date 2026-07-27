"""
Error classifiers for LLM-call failures.

This module answers one question: given an exception raised while running an
agent, is it worth retrying, and what kind of failure was it? The classifiers
are consumed by ``ValidationService`` (which owns the agent retry loop) and by
``agent_api.create_workflow_failure_payload`` (which reports the failure to the
runtime worker).

Usage:
    from main_agent.agents.utils.rate_limit_handler import (
        should_retry_error,
        get_error_type,
    )

    try:
        ...
    except Exception as e:
        if should_retry_error(e):
            ...  # back off and re-run
        error_kind = get_error_type(e)  # rate_limit | transient | ...
"""

from pydantic import ValidationError as PydanticValidationError


def is_rate_limit_error(error: Exception) -> bool:
    """
    Check if an exception is a rate limit (429) error.

    Args:
        error: The exception to check

    Returns:
        True if this is a rate limit error that should trigger retry
    """
    # Unwrap ExceptionGroup (raised by asyncio.TaskGroup / ParallelAgent)
    if isinstance(error, BaseExceptionGroup):
        return any(
            is_rate_limit_error(exc) for exc in error.exceptions if isinstance(exc, Exception)
        )

    # Prefer checking exception type hierarchy for known Google API errors
    try:
        from google.api_core.exceptions import ResourceExhausted, TooManyRequests

        if isinstance(error, (ResourceExhausted, TooManyRequests)):
            return True
    except ImportError:
        pass

    # Fallback to string matching for other providers/unknown exception types
    error_str = str(error).lower()
    error_type = type(error).__name__.lower()

    # Check for common rate limit indicators
    rate_limit_indicators = [
        "429",
        "resource_exhausted",
        "resourceexhausted",
        "rate limit",
        "quota exceeded",
        "too many requests",
    ]

    # Check error message
    if any(indicator in error_str for indicator in rate_limit_indicators):
        return True

    # Check error type name
    if any(indicator in error_type for indicator in rate_limit_indicators):
        return True

    return False


def is_transient_error(error: Exception) -> bool:
    """
    Check if an exception is a transient error that may resolve with retry.

    Transient errors include server errors (502, 503, 504), timeouts,
    and connection issues that are typically temporary.

    Args:
        error: The exception to check

    Returns:
        True if this is a transient error that should trigger retry
    """
    # Unwrap ExceptionGroup (raised by asyncio.TaskGroup / ParallelAgent)
    if isinstance(error, BaseExceptionGroup):
        return any(
            is_transient_error(exc) for exc in error.exceptions if isinstance(exc, Exception)
        )

    error_str = str(error).lower()
    error_type = type(error).__name__.lower()

    # Check for common transient error indicators
    transient_indicators = [
        # HTTP server errors
        "502",
        "503",
        "504",
        "bad gateway",
        "service unavailable",
        "gateway timeout",
        # Timeout errors
        "timeout",
        "timed out",
        "etimedout",
        # Connection errors
        "connection refused",
        "connection reset",
        "connection error",
        "econnreset",
        "econnrefused",
        # Availability errors
        "unavailable",
        "temporarily",
        "try again later",
        # Network errors
        "network",
        "dns",
    ]

    # Check error message
    if any(indicator in error_str for indicator in transient_indicators):
        return True

    # Check error type name
    if any(indicator in error_type for indicator in transient_indicators):
        return True

    # Check for common exception types
    transient_exception_types = [
        "timeouterror",
        "connectionerror",
        "connectionreseterror",
        "connectionrefusederror",
    ]
    if error_type in transient_exception_types:
        return True

    return False


def is_deadline_exceeded_error(error: Exception) -> bool:
    """
    Check if an exception is a 504 DEADLINE_EXCEEDED error from Gemini.

    Unlike other transient errors, DEADLINE_EXCEEDED typically indicates the
    request payload is too large for the server to process in time. Retrying
    with the same payload will likely fail again — batch splitting is more
    effective than retry.

    Args:
        error: The exception to check

    Returns:
        True if this is a DEADLINE_EXCEEDED error
    """
    # Unwrap ExceptionGroup (raised by asyncio.TaskGroup / ParallelAgent)
    if isinstance(error, BaseExceptionGroup):
        return any(
            is_deadline_exceeded_error(exc)
            for exc in error.exceptions
            if isinstance(exc, Exception)
        )

    error_str = str(error).lower()

    deadline_indicators = [
        "deadline_exceeded",
        "deadline expired",
    ]

    return any(indicator in error_str for indicator in deadline_indicators)


def is_thought_signature_error(error: Exception) -> bool:
    """
    Detect Gemini 3 thought_signature validation errors.

    These 400 INVALID_ARGUMENT errors occur when the model inconsistently
    generates thought_signature fields on function_call parts.  Rare after
    the preserve-signatures fix, but kept as a safety-net retry trigger.

    See: https://github.com/google/adk-python/issues/3705
    """
    if isinstance(error, BaseExceptionGroup):
        return any(
            is_thought_signature_error(exc)
            for exc in error.exceptions
            if isinstance(exc, Exception)
        )
    error_str = str(error).lower()
    return "thought_signature" in error_str and (
        "invalid_argument" in error_str or "400" in error_str
    )


def is_truncation_error(error: Exception) -> bool:
    """
    Check if an exception is caused by output truncation (model hit max output tokens).

    This typically manifests as a pydantic ValidationError with "EOF while parsing"
    in the JSON error detail, meaning the model's JSON output was cut off mid-stream.

    Args:
        error: The exception to check

    Returns:
        True if this is a truncation error that should trigger retry
    """
    if isinstance(error, BaseExceptionGroup):
        return any(
            is_truncation_error(exc) for exc in error.exceptions if isinstance(exc, Exception)
        )

    error_str = str(error).lower()

    truncation_indicators = [
        "eof while parsing",
        "unexpected end of json",
        "unterminated string",
        # ValidationService emits this string when the agent's last event
        # had finish_reason=MAX_TOKENS and the output_key in session state
        # is empty. Without this indicator, the empty-output catch raised
        # the generic "Your previous output was empty" exception, which
        # routed retries through _MISSING_OUTPUT_PROMPT ("re-read your
        # instructions") instead of _TRUNCATION_PROMPT ("be more concise").
        # 8qfb42sm 2026-05-18 hit exactly that mis-routing.
        "output truncated by max_output_tokens",
    ]

    return any(indicator in error_str for indicator in truncation_indicators)


def is_output_schema_error(error: Exception) -> bool:
    """
    Check if an exception is the model failing to produce schema-valid output.

    ADK's ``LlmAgent`` parses the model response through
    ``output_schema.model_validate_json(result)``. A weak / non-Gemini model
    (deepseek-v4-flash via OpenRouter, observed 2026-06-28 on app ah5jff5ks)
    sometimes returns a malformed or error-shaped object — e.g.
    ``{"response_type": "ERROR_... task cannot be completed."}`` instead of the
    required ``CreatorOutput`` fields — so ADK raises a ``pydantic.ValidationError``
    ("N validation errors for X / Field required [type=missing]"). This is the same
    family as an empty or truncated response: the model produced no *usable*
    structured output, and a re-roll (via ``_MISSING_OUTPUT_PROMPT``) usually
    recovers it. Without this classifier the error fell through ``should_retry_error``
    (rate-limit/transient only) → ``is_retryable=False`` → the build died on
    attempt 1 of ``MAX_CREATOR_ATTEMPTS=2`` and the App row was deleted.

    Truncation-shaped ValidationErrors ("EOF while parsing") are deliberately
    EXCLUDED here — ``is_truncation_error`` already classifies those so the retry
    routes through ``_TRUNCATION_PROMPT`` ("be more concise") rather than
    ``_MISSING_OUTPUT_PROMPT`` ("re-read your instructions").

    Note: a genuine refusal is NOT a schema error — agents that can decline
    (e.g. PreCreator/AppHelpDesk) emit a VALID object with decline fields
    populated, which never raises ValidationError. So retrying schema failures
    does not re-roll a safety refusal. (PreCreator's decline short-circuit runs
    BEFORE the Creator, so the planning agent never sees a refusal turn.)

    Args:
        error: The exception to check

    Returns:
        True if this is an output-schema validation failure that should retry
    """
    # Unwrap ExceptionGroup (raised by asyncio.TaskGroup / ParallelAgent)
    if isinstance(error, BaseExceptionGroup):
        return any(
            is_output_schema_error(exc) for exc in error.exceptions if isinstance(exc, Exception)
        )

    # Truncation is its own classifier (drives a different retry prompt).
    if is_truncation_error(error):
        return False

    if isinstance(error, PydanticValidationError):
        return True

    # String fallback for cases where the pydantic error is wrapped/re-raised
    # (e.g. inside a generic Exception) and loses its class identity. Matches
    # pydantic's "N validation error(s) for <Model>" signature without
    # false-positiving on arbitrary messages that merely contain "error".
    error_str = str(error).lower()
    return ("validation error" in error_str) and (" for " in error_str)


def should_retry_error(error: Exception) -> bool:
    """
    Check if an error should trigger a retry (rate limit OR transient).

    This is the main function to use when deciding whether to retry an operation.

    Args:
        error: The exception to check

    Returns:
        True if this error should trigger a retry attempt
    """
    # Unwrap ExceptionGroup (raised by asyncio.TaskGroup / ParallelAgent)
    if isinstance(error, BaseExceptionGroup):
        return any(
            should_retry_error(exc) for exc in error.exceptions if isinstance(exc, Exception)
        )

    return (
        is_rate_limit_error(error)
        or is_transient_error(error)
        or is_deadline_exceeded_error(error)
        or is_thought_signature_error(error)
    )


def get_error_type(error: Exception) -> str:
    """
    Determine the type of error for reporting purposes.

    Unwraps ExceptionGroup to classify the underlying cause.

    Args:
        error: The exception to classify

    Returns:
        One of: "rate_limit", "transient", "deadline_exceeded", "permanent"
    """
    # Unwrap ExceptionGroup: classify by the first retryable sub-exception
    if isinstance(error, BaseExceptionGroup):
        for exc in error.exceptions:
            if isinstance(exc, Exception):
                sub_type = get_error_type(exc)
                if sub_type != "permanent":
                    return sub_type
        return "permanent"

    if is_rate_limit_error(error):
        return "rate_limit"
    elif is_transient_error(error):
        return "transient"
    elif is_deadline_exceeded_error(error):
        # Order matters: deadline classification is the most actionable for
        # backoff tuning (longer first wait — server is genuinely overloaded
        # rather than rate-limiting us). Classified here only when neither
        # rate-limit nor generic transient match first.
        return "deadline_exceeded"
    else:
        return "permanent"
