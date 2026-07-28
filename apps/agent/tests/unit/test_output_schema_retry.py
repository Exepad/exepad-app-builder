"""Regression tests for output-schema ValidationError retry classification.

Origin: app ah5jff5ks (2026-06-28). A weak / non-Gemini Creator
(deepseek-v4-flash via OpenRouter) returned a malformed, error-shaped object
``{"response_type": "ERROR_... task cannot be completed."}`` instead of the
required ``CreatorOutput`` fields. ADK's ``output_schema`` parse raised a
``pydantic.ValidationError`` ("4 validation errors ... Field required"), which
the retry plumbing classified as NON-retryable (it was neither empty, truncated,
nor a rate-limit error). The build died on attempt 1 of ``MAX_CREATOR_ATTEMPTS=2``
and the App row was deleted.

Fix: ``rate_limit_handler.is_output_schema_error`` treats such a parse failure
as the same family as empty/truncated output — retry it via ``_MISSING_OUTPUT_PROMPT``.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic import BaseModel, ValidationError, field_validator

from main_agent.agents.utils.rate_limit_handler import (
    is_output_schema_error,
    is_truncation_error,
)
from main_agent.agents.orchestrator.app_types.shared.services.validation_service import (
    ValidationService,
)
from tests.fixtures.mock_ctx import create_mock_ctx
from tests.fixtures.mock_agents import create_mock_event

pytestmark = [pytest.mark.unit]


class _TinyPlan(BaseModel):
    """Stand-in for an output_schema with required fields (like CreatorOutput)."""

    app_name: str
    component_plans: list


def _make_schema_validation_error() -> ValidationError:
    """Produce a real pydantic ValidationError of the shape ADK raises when the
    model returns an object missing the required output_schema fields — exactly
    the ah5jff5ks failure (``{"response_type": "ERROR_..."}``)."""
    try:
        _TinyPlan.model_validate({"response_type": "ERROR_... task cannot be completed."})
    except ValidationError as e:
        return e
    raise AssertionError("expected a ValidationError")  # pragma: no cover


class _TinyReport(BaseModel):
    """Stand-in for DiagnosticReport — a field_validator that rejects an empty
    ``symptom``. A weak Surveyor (app auqofu6p5 2026-06-29) returned a report
    with ``symptom=""`` → pydantic ``value_error`` (NOT a missing-field error)."""

    symptom: str

    @field_validator("symptom")
    @classmethod
    def _non_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("symptom must be non-empty — restate the user's complaint")
        return v


def _make_diagnostic_value_error() -> ValidationError:
    """The Surveyor's exact failure shape: a ``value_error`` from a
    field_validator, not a ``missing``/``Field required`` error."""
    try:
        _TinyReport.model_validate({"symptom": ""})
    except ValidationError as e:
        return e
    raise AssertionError("expected a ValidationError")  # pragma: no cover


# =============================================================================
# is_output_schema_error classifier
# =============================================================================


class TestIsOutputSchemaError:
    def test_pydantic_validation_error_is_schema_error(self):
        err = _make_schema_validation_error()
        # Sanity: this is the real failure shape (missing required fields).
        assert "field required" in str(err).lower()
        assert is_output_schema_error(err) is True

    def test_generic_error_is_not_schema_error(self):
        assert is_output_schema_error(ValueError("Unexpected configuration error")) is False

    def test_truncation_validation_error_is_excluded(self):
        # A truncation-shaped ValidationError ("EOF while parsing") belongs to
        # is_truncation_error (drives _TRUNCATION_PROMPT), NOT is_output_schema_error.
        trunc = Exception("1 validation error for Foo: EOF while parsing a value")
        assert is_truncation_error(trunc) is True
        assert is_output_schema_error(trunc) is False

    def test_exception_group_is_unwrapped(self):
        err = _make_schema_validation_error()
        group = ExceptionGroup("parallel agent failed", [err])
        assert is_output_schema_error(group) is True

    def test_string_fallback_for_wrapped_error(self):
        # If the pydantic error is re-raised inside a generic Exception (losing
        # its class identity), the "N validation error(s) for <Model>" signature
        # still classifies it.
        wrapped = RuntimeError("4 validation errors for CreatorOutput\napp_name\n  Field required")
        assert is_output_schema_error(wrapped) is True

    def test_string_fallback_does_not_false_positive(self):
        assert is_output_schema_error(RuntimeError("connection error to upstream")) is False

    def test_diagnostic_report_value_error_is_schema_error(self):
        # The Surveyor's empty-symptom failure is a `value_error` from a custom
        # field_validator, a DIFFERENT pydantic shape than the Creator's
        # missing-field error. It must STILL classify as retryable so the
        # Surveyor re-rolls instead of degrading every off-Gemini edit to an
        # empty DiagnosticReport. (app auqofu6p5 2026-06-29)
        err = _make_diagnostic_value_error()
        assert "non-empty" in str(err).lower()
        assert "value_error" in str(err) or "value error" in str(err).lower()
        assert is_output_schema_error(err) is True


# =============================================================================
# Surveyor attempt budget — the schema-retry only helps if the Surveyor gets >1
# attempt (it ran with max_attempts=1, so the retryable classification above had
# no budget to act on → empty report on every off-Gemini edit). See
# core.py _run_surveyor + config.MAX_SURVEYOR_ATTEMPTS.
# =============================================================================


def test_surveyor_attempt_budget_allows_a_reroll():
    from config import MAX_SURVEYOR_ATTEMPTS

    assert MAX_SURVEYOR_ATTEMPTS >= 2, (
        "Surveyor must get >1 attempt so a malformed/empty DiagnosticReport "
        "re-rolls (the model self-corrects) instead of falling back to an empty "
        "report on every off-Gemini edit"
    )


# =============================================================================
# _run_agent_with_retry — end-to-end retry on a schema ValidationError
# =============================================================================


@patch(
    "main_agent.agents.orchestrator.app_types.shared.services.validation_service.push_session_state_update",
    new_callable=AsyncMock,
)
@patch(
    "main_agent.agents.orchestrator.app_types.shared.services.validation_service.push_prompt_to_next_agent",
    new_callable=AsyncMock,
)
@patch(
    "main_agent.agents.orchestrator.app_types.shared.services.validation_service.get_agent_model_name",
    return_value="openrouter/deepseek/deepseek-v4-flash",
)
class TestSchemaErrorRetry:
    def _make_service(self):
        service = ValidationService()
        service.metrics_tracker = MagicMock()
        service.metrics_tracker.start_agent = AsyncMock()
        service.metrics_tracker.stop_agent = AsyncMock(return_value={"duration": 1.0})
        service.metrics_tracker.record_tokens = AsyncMock()
        return service

    async def _collect(self, gen):
        return [e async for e in gen]

    async def test_schema_validation_error_retries_then_succeeds(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        """A first-attempt output-schema ValidationError must re-roll (not die)
        and the second attempt's valid output completes the run. This FAILS
        before the fix (ValidationError was non-retryable → raised on attempt 1).
        """
        service = self._make_service()
        ctx = create_mock_ctx()
        verr = _make_schema_validation_error()
        call_count = 0

        async def run_schema_error(c):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise verr
                yield  # noqa: unreachable — make this an async generator
            ev = create_mock_event(author="Creator", text="plan")
            ev.usage_metadata = None
            yield ev
            c.session.state["test_output_0"] = '{"app_name":"Lumina","component_plans":[{}]}'

        agent = MagicMock()
        agent.name = "Creator"
        agent.output_key = "test_output_0"
        agent.output_schema = "CreatorOutput"
        agent.run_async = run_schema_error

        events = await self._collect(
            service._run_agent_with_retry(ctx, agent, "Creator", max_attempts=2)
        )

        assert call_count == 2, "Creator should have retried after the schema ValidationError"
        # The retry prompt must be the missing-output re-read prompt, not the
        # truncation "be more concise" prompt.
        mock_push_prompt.assert_called_once()
        prompt_arg = mock_push_prompt.call_args[0][1]
        assert "re-read your instructions" in prompt_arg.lower()
        assert "concise" not in prompt_arg.lower()
        assert len(events) >= 1

    async def test_schema_validation_error_exhausts_then_raises(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        """If every attempt fails the schema parse, the wrapper still raises
        after exhausting max_attempts (no silent success) — but it tried twice."""
        service = self._make_service()
        ctx = create_mock_ctx()
        verr = _make_schema_validation_error()
        call_count = 0

        async def always_schema_error(c):
            nonlocal call_count
            call_count += 1
            raise verr
            yield  # noqa: unreachable

        agent = MagicMock()
        agent.name = "Creator"
        agent.output_key = "test_output_0"
        agent.output_schema = "CreatorOutput"
        agent.run_async = always_schema_error

        with pytest.raises(ValidationError):
            await self._collect(
                service._run_agent_with_retry(ctx, agent, "Creator", max_attempts=2)
            )
        assert call_count == 2, "should have used the full MAX_CREATOR_ATTEMPTS budget"
