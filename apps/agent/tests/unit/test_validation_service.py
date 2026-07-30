"""Tests for ValidationService._run_agent_with_retry."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from main_agent.agents.orchestrator.app_types.shared.services.validation_service import (
    ValidationService,
)
from tests.fixtures.mock_agents import create_mock_agent, create_mock_event
from tests.fixtures.mock_ctx import create_mock_ctx

pytestmark = [pytest.mark.unit]


# =============================================================================
# _run_agent_with_retry
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
    return_value="gemini-3-flash-preview",
)
class TestRunAgentWithRetry:
    """Test ValidationService._run_agent_with_retry()."""

    def _make_event(self, author="TestAgent", text="output"):
        """Create an event with usage_metadata=None to avoid MagicMock issues."""
        event = create_mock_event(author=author, text=text)
        event.usage_metadata = None
        return event

    async def _collect_events(self, gen):
        """Helper to collect all events from an async generator."""
        events = []
        async for event in gen:
            events.append(event)
        return events

    def _make_service(self):
        """Create a ValidationService with a mocked metrics_tracker."""
        service = ValidationService()
        service.metrics_tracker = MagicMock()
        service.metrics_tracker.start_agent = AsyncMock()
        service.metrics_tracker.stop_agent = AsyncMock(return_value={"duration": 1.0})
        service.metrics_tracker.record_tokens = AsyncMock()
        return service

    async def test_successful_first_attempt(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        service = self._make_service()
        ctx = create_mock_ctx()
        event = self._make_event()
        agent = create_mock_agent(events=[event], name="TestAgent")
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"

        # Simulate agent producing output in session state
        original_run = agent.run_async

        async def run_with_state(c):
            async for e in original_run(c):
                yield e
            c.session.state["test_output_0"] = "valid output"

        agent.run_async = run_with_state

        events = await self._collect_events(
            service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=3)
        )
        assert len(events) == 1
        assert events[0].author == "TestAgent"
        mock_push_prompt.assert_not_called()

    async def test_empty_response_triggers_retry_then_succeeds(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        service = self._make_service()
        ctx = create_mock_ctx()

        call_count = 0

        async def run_with_retry(c):
            nonlocal call_count
            call_count += 1
            ev = self._make_event()
            yield ev
            if call_count == 1:
                # First call: leave output empty to trigger retry
                c.session.state["test_output_0"] = ""
            else:
                # Second call: provide valid output
                c.session.state["test_output_0"] = "valid output"

        agent = MagicMock()
        agent.name = "TestAgent"
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"
        agent.run_async = run_with_retry

        events = await self._collect_events(
            service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=3)
        )
        assert call_count == 2
        # push_prompt_to_next_agent called with the missing-output prompt
        mock_push_prompt.assert_called_once()
        prompt_arg = mock_push_prompt.call_args[0][1]
        assert "No content received" in prompt_arg

    async def test_truncation_error_triggers_truncation_prompt(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        service = self._make_service()
        ctx = create_mock_ctx()

        call_count = 0

        async def run_truncation(c):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                c.session.state["test_output_0"] = ""
                raise Exception("FINISH_REASON_MAX_TOKENS: output truncated")
            else:
                ev = create_mock_event(author="TestAgent", text="event")
                ev.usage_metadata = None
                yield ev
                c.session.state["test_output_0"] = "valid output"

        agent = MagicMock()
        agent.name = "TestAgent"
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"
        agent.run_async = run_truncation

        with (
            patch(
                "main_agent.agents.orchestrator.app_types.shared.services.validation_service.is_truncation_error",
                side_effect=lambda e: "MAX_TOKENS" in str(e),
            ),
            patch(
                "main_agent.agents.orchestrator.app_types.shared.services.validation_service.should_retry_error",
                return_value=False,
            ),
        ):
            events = await self._collect_events(
                service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=3)
            )
        assert call_count == 2
        prompt_arg = mock_push_prompt.call_args[0][1]
        assert "truncated" in prompt_arg

    async def test_max_tokens_finish_reason_routes_to_truncation_prompt(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        """Empty output_key + MAX_TOKENS finish_reason on the last event
        must raise a truncation-flavored exception (matched by
        ``is_truncation_error``) so the retry uses ``_TRUNCATION_PROMPT``
        instead of ``_MISSING_OUTPUT_PROMPT``. Regression test for
        8qfb42sm (2026-05-18): DesignImporter hit the 32K output cap but
        the empty-output path mis-routed retries through "re-read your
        instructions" which pushes the model to write MORE, not less."""
        service = self._make_service()
        ctx = create_mock_ctx()

        call_count = 0

        async def run_with_max_tokens(c):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # Emit an event whose candidate carries
                # finish_reason=MAX_TOKENS, then leave output_key empty
                # — same shape ADK surfaces on a truncated structured-
                # output response.
                ev = create_mock_event(author="TestAgent", text="partial")
                ev.usage_metadata = None
                cand = MagicMock()
                cand.finish_reason = "MAX_TOKENS"
                ev.candidates = [cand]
                yield ev
                c.session.state["test_output_0"] = ""
            else:
                ev = create_mock_event(author="TestAgent", text="complete")
                ev.usage_metadata = None
                ev.candidates = []
                yield ev
                c.session.state["test_output_0"] = "valid output"

        agent = MagicMock()
        agent.name = "TestAgent"
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"
        agent.run_async = run_with_max_tokens

        events = await self._collect_events(
            service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=3)
        )
        assert call_count == 2
        # The retry prompt sent between attempts must be the truncation
        # prompt ("MORE CONCISE response"), NOT the missing-output prompt
        # ("No content received").
        mock_push_prompt.assert_called_once()
        prompt_arg = mock_push_prompt.call_args[0][1]
        assert "truncated" in prompt_arg.lower() or "concise" in prompt_arg.lower()
        assert "no content received" not in prompt_arg.lower()
        assert len(events) >= 1

    async def test_max_attempts_exhausted_raises(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        service = self._make_service()
        ctx = create_mock_ctx()

        async def always_empty(c):
            ev = self._make_event()
            yield ev
            c.session.state["test_output_0"] = ""

        agent = MagicMock()
        agent.name = "TestAgent"
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"
        agent.run_async = always_empty

        with pytest.raises(Exception, match="output was empty"):
            await self._collect_events(
                service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=2)
            )

    async def test_non_retryable_error_raises_immediately(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        service = self._make_service()
        ctx = create_mock_ctx()

        async def fatal_error(c):
            raise ValueError("Unexpected configuration error")
            yield  # noqa: unreachable

        agent = MagicMock()
        agent.name = "TestAgent"
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"
        agent.run_async = fatal_error

        with (
            patch(
                "main_agent.agents.orchestrator.app_types.shared.services.validation_service.is_truncation_error",
                return_value=False,
            ),
            patch(
                "main_agent.agents.orchestrator.app_types.shared.services.validation_service.should_retry_error",
                return_value=False,
            ),
        ):
            with pytest.raises(ValueError, match="Unexpected configuration error"):
                await self._collect_events(
                    service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=3)
                )
        # No retry prompt should have been sent
        mock_push_prompt.assert_not_called()

    async def test_metrics_start_and_stop_called(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        service = self._make_service()
        ctx = create_mock_ctx()
        event = self._make_event()
        agent = create_mock_agent(events=[event], name="TestAgent")
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"

        original_run = agent.run_async

        async def run_with_state(c):
            async for e in original_run(c):
                yield e
            c.session.state["test_output_0"] = "valid output"

        agent.run_async = run_with_state

        await self._collect_events(
            service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=2)
        )
        service.metrics_tracker.start_agent.assert_called_once_with(
            ctx, "TestAgent", model="gemini-3-flash-preview"
        )
        service.metrics_tracker.stop_agent.assert_called_once_with(ctx)

    async def test_metrics_stop_called_on_failure(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        service = self._make_service()
        ctx = create_mock_ctx()

        async def fatal_error(c):
            raise ValueError("Fatal")
            yield  # noqa: unreachable

        agent = MagicMock()
        agent.name = "TestAgent"
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"
        agent.run_async = fatal_error

        with (
            patch(
                "main_agent.agents.orchestrator.app_types.shared.services.validation_service.is_truncation_error",
                return_value=False,
            ),
            patch(
                "main_agent.agents.orchestrator.app_types.shared.services.validation_service.should_retry_error",
                return_value=False,
            ),
        ):
            with pytest.raises(ValueError):
                await self._collect_events(
                    service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=2)
                )
        # stop_agent must be called even on failure (finally block)
        service.metrics_tracker.stop_agent.assert_called_once_with(ctx)

    async def test_artifact_agent_empty_output_no_retry(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        """Artifact-based agents (output_schema=None) skip empty-output retry."""
        service = self._make_service()
        ctx = create_mock_ctx()

        event = self._make_event(author="ArtifactAgent")
        agent = create_mock_agent(events=[event], name="ArtifactAgent")
        agent.output_key = "artifact_output_0"
        agent.output_schema = None  # artifact-based agent

        # Leave output empty - should NOT trigger retry
        ctx.session.state["artifact_output_0"] = ""

        events = await self._collect_events(
            service._run_agent_with_retry(ctx, agent, "ArtifactAgent", max_attempts=3)
        )
        assert len(events) == 1
        mock_push_prompt.assert_not_called()

    async def test_dict_output_is_accepted(
        self, mock_model_name, mock_push_prompt, mock_push_state
    ):
        """Dict output from agent is JSON-serialized and accepted as valid."""
        service = self._make_service()
        ctx = create_mock_ctx()

        async def run_with_dict_output(c):
            ev = self._make_event()
            yield ev
            c.session.state["test_output_0"] = {"key": "value"}

        agent = MagicMock()
        agent.name = "TestAgent"
        agent.output_key = "test_output_0"
        agent.output_schema = "SomeSchema"
        agent.run_async = run_with_dict_output

        events = await self._collect_events(
            service._run_agent_with_retry(ctx, agent, "TestAgent", max_attempts=2)
        )
        assert len(events) == 1
        mock_push_prompt.assert_not_called()
