"""Validation service for agent execution with retry logic and metrics tracking."""

import json
import structlog
from typing import AsyncGenerator
from google.adk.events import Event
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents import LlmAgent

from ...base import BaseService
from ....models import MetricsTracker
from .....utils.helpers import (
    push_prompt_to_next_agent,
    push_session_state_update,
)  # noqa: F401  (patched by tests)
from .....utils.artifact_manager import ArtifactManager
from .....utils.rate_limit_handler import (
    should_retry_error,
    is_truncation_error,
    is_output_schema_error,
)
from config import get_agent_model_name

logger = structlog.get_logger(__name__)

_MISSING_OUTPUT_PROMPT = """
No content received from your last response.
Please re-read your instructions carefully and provide a valid, complete response.
Do not skip any required steps in your workflow.
"""

_TRUNCATION_PROMPT = """
Your previous response was truncated because it exceeded the maximum output length.
The JSON output was cut off and could not be parsed.

Please try again with a MORE CONCISE response:
- Keep building plan descriptions shorter and more focused
- Use brief bullet points instead of long paragraphs
- Do not include actual code in plan fields - only describe what to build
- Aim for at most 2-3 sentences per plan item
"""


class ValidationService(BaseService):
    """
    Handles agent execution with retry logic and metrics tracking.

    Primary method: _run_agent_with_retry() — runs any LlmAgent with
    error handling, retries, empty-response detection, and token tracking.
    """

    def __init__(self):
        super().__init__()
        self.metrics_tracker = MetricsTracker()

    async def _run_agent_with_retry(
        self, ctx: InvocationContext, agent: LlmAgent, agent_name: str, max_attempts: int
    ) -> AsyncGenerator[Event, None]:
        """
        Run an agent with error handling, retries, and timing tracking.

        Args:
            ctx: Invocation context
            agent: The agent to run
            agent_name: Name for logging
            max_attempts: Maximum number of retry attempts

        Yields:
            Events from the agent execution
        """
        # Start metrics tracking for this agent with model info
        try:
            model = get_agent_model_name(agent_name)
        except KeyError:
            model = None
        await self.metrics_tracker.start_agent(ctx, agent_name, model=model)

        # Save agent input as artifact
        input_data = ctx.session.state.get("last_prompt_to_agent")
        await ArtifactManager.save_agent_io_artifact(ctx, agent_name, "input", input_data)

        # Snapshot artifact keys BEFORE the agent runs. Used to capture
        # a meaningful `_output.json` for artifact-based agents (which
        # write to artifacts not session state, so `agent_output` below
        # is empty for them). Without this snapshot the symmetric
        # `_input.json + _output.json` pair the test-automation tooling
        # relies on is broken — rdzn62gx (2026-05-16) had the
        # ComponentBuilderMultiplePolish `_input.json` saved but no
        # `_output.json`, blinding the diagnostic skill.
        artifacts_before: set[str] = set()
        try:
            keys_before = await ArtifactManager.list_artifacts(ctx)
            if keys_before:
                artifacts_before = set(keys_before)
        except Exception:
            # list_artifacts may fail in tests or in dev contexts without
            # a real artifact service. Fail open — we just don't capture
            # the artifact list.
            pass

        try:
            for attempt in range(max_attempts):
                try:
                    logger.info(
                        f"[{agent_name}] Running agent, attempt {attempt + 1}/{max_attempts}"
                    )
                    # Track the most recent finish_reason emitted by the
                    # model during this attempt. Used below to distinguish
                    # MAX_TOKENS truncation from a genuinely empty response
                    # (8qfb42sm 2026-05-18 — DesignImporter hit MAX_TOKENS
                    # but session state stayed empty because ADK couldn't
                    # parse the truncated JSON; the prior path raised a
                    # generic empty-output error that mis-routed retries
                    # through _MISSING_OUTPUT_PROMPT instead of
                    # _TRUNCATION_PROMPT).
                    last_finish_reason: str = ""
                    async for event in agent.run_async(ctx):
                        # Record token usage via metrics tracker
                        if hasattr(event, "usage_metadata") and event.usage_metadata:
                            await self.metrics_tracker.record_tokens(
                                ctx, event.usage_metadata, agent_name
                            )
                        # Capture finish_reason from any terminal candidate
                        # on the event. ADK exposes this on Gemini events
                        # via ``event.content.parts``-bearing candidates;
                        # tolerate shape drift with broad try/except.
                        try:
                            for cand in getattr(event, "candidates", None) or []:
                                fr = getattr(cand, "finish_reason", None)
                                if fr:
                                    last_finish_reason = str(fr)
                        except Exception:  # noqa: BLE001
                            pass
                        yield event

                    # Capture the output after agent execution
                    output_key = agent.output_key
                    agent_output = ctx.session.state.get(output_key, "")

                    # Skip output validation for artifact-based agents (output_schema=None)
                    # These agents save output directly to artifacts, not session state
                    is_artifact_agent = getattr(agent, "output_schema", None) is None

                    if len(agent_output) == 0 and not is_artifact_agent:
                        truncated = (
                            "MAX_TOKENS" in last_finish_reason.upper()
                            if last_finish_reason
                            else False
                        )
                        if truncated:
                            logger.error(
                                f"[{agent_name}] **************** MAX_TOKENS_TRUNCATED ****************"
                            )
                            logger.error(
                                f"[{agent_name}] Model hit max_output_tokens on attempt {attempt + 1} "
                                f"(finish_reason={last_finish_reason}); structured output could not be parsed."
                            )
                            # The "output truncated by max_output_tokens"
                            # phrase is matched by
                            # ``rate_limit_handler.is_truncation_error``
                            # so the retry below routes through
                            # _TRUNCATION_PROMPT ("be more concise") rather
                            # than _MISSING_OUTPUT_PROMPT ("re-read your
                            # instructions"), which would push the LLM to
                            # produce MORE content on retry.
                            raise Exception(
                                "Output truncated by max_output_tokens — the model hit the "
                                "output cap before completing the structured JSON. Retry with "
                                "a more concise plan."
                            )
                        logger.error(
                            f"[{agent_name}] **************** EMPTY_RESPONSE ****************"
                        )
                        logger.error(
                            f"[{agent_name}] EMPTY_RESPONSE: No output captured from agent on attempt {attempt + 1}"
                        )
                        raise Exception(f"""
                        Your previous output was empty. Please try again.
                        """)

                    # Convert output to string if it's a dict/object
                    if isinstance(agent_output, dict):
                        agent_output = json.dumps(
                            agent_output, separators=(",", ":"), ensure_ascii=False
                        )
                    elif not isinstance(agent_output, str):
                        agent_output = str(agent_output)

                    # Save agent output as artifact
                    if agent_output:
                        await ArtifactManager.save_agent_io_artifact(
                            ctx, agent_name, "output", agent_output
                        )
                    elif is_artifact_agent:
                        # Artifact-based agent: capture the diff of
                        # artifact keys written during this dispatch as
                        # the `_output.json` body. Restores the symmetric
                        # input/output pair the debug tooling expects.
                        try:
                            keys_after = await ArtifactManager.list_artifacts(ctx)
                            new_keys = sorted(set(keys_after or []) - artifacts_before)
                        except Exception:
                            new_keys = []
                        summary = json.dumps(
                            {
                                "agent_name": agent_name,
                                "agent_kind": "artifact",
                                "artifacts_written": new_keys,
                                "artifacts_written_count": len(new_keys),
                            },
                            separators=(",", ":"),
                            ensure_ascii=False,
                        )
                        await ArtifactManager.save_agent_io_artifact(
                            ctx, agent_name, "output", summary
                        )

                    break  # Success

                except Exception as e:
                    is_empty_output = "output was empty" in str(
                        e
                    ) or "previous output was empty" in str(e)
                    is_truncated = is_truncation_error(e)
                    # A pydantic ValidationError from ADK's output_schema parse
                    # (model returned a malformed / error-shaped object instead
                    # of the required fields) is the same family as empty/
                    # truncated output — re-roll it via _MISSING_OUTPUT_PROMPT
                    # rather than killing the build on attempt 1. Weak / non-
                    # Gemini models hit this routinely (ah5jff5ks 2026-06-28:
                    # Creator returned {"response_type": "ERROR_..."} → 4 missing
                    # required fields → build died + App row deleted).
                    is_schema_error = is_output_schema_error(e)
                    is_retryable = (
                        is_empty_output or is_truncated or is_schema_error or should_retry_error(e)
                    )

                    # A retryable error (schema/empty/truncated/transient) will
                    # be re-rolled, so log it concisely — the full traceback of a
                    # pydantic ValidationError carries the entire model output as
                    # `input_value` and renders thousands of lines per attempt
                    # (a weak-model plain-text response spammed ~6k lines). Keep
                    # the exc_info traceback only for a genuinely fatal error.
                    logger.error(
                        f"[{agent_name}] Error running agent on attempt {attempt + 1}: {e} "
                        f"(retryable={is_retryable}, truncated={is_truncated})",
                        exc_info=not is_retryable,
                    )

                    if not is_retryable:
                        raise

                    try:
                        output_key = agent.output_key
                        agent_output = ctx.session.state.get(output_key, "")

                        logger.info(f"[{agent_name}] Erroneous agent output: {agent_output}")

                        if isinstance(agent_output, dict):
                            agent_output = json.dumps(
                                agent_output, separators=(",", ":"), ensure_ascii=False
                            )
                        elif not isinstance(agent_output, str):
                            agent_output = str(agent_output)

                    except Exception:
                        logger.debug(
                            f"[{agent_name}] Failed to extract agent output for retry",
                            exc_info=True,
                        )

                    retry_prompt = _TRUNCATION_PROMPT if is_truncated else _MISSING_OUTPUT_PROMPT
                    await push_prompt_to_next_agent(ctx, retry_prompt)

                    if attempt == max_attempts - 1:
                        raise
                    logger.info(f"[{agent_name}] Retrying...")
        finally:
            # Stop metrics tracking when agent completes (success or failure)
            agent_metrics = await self.metrics_tracker.stop_agent(ctx)
            if agent_metrics:
                logger.info(
                    f"[{agent_name}] Total execution time: {agent_metrics['duration']:.2f}s"
                )
