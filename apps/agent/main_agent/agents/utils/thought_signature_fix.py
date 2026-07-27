"""
Thought metadata cleanup for Gemini 3 models.

Gemini 3 models generate ``thought_signature`` fields on function_call parts
as encrypted snapshots of the model's reasoning state.  These signatures are
**mandatory** — the API rejects requests where they are missing or altered.

This module provides before/after model callbacks that:

  1. **Remove pure thought text parts** (the model's internal reasoning) from
     conversation history to save context tokens.  The model re-thinks on every
     turn and does not need its previous reasoning.

  2. **Preserve ``thought`` and ``thought_signature`` on function_call parts
     exactly as received**.  The API requires these for correct multi-turn
     function calling with thinking enabled.

  3. **Measure per-LLM-call wall-clock duration** so an agent's total runtime
     can be split across its individual model turns. Surfaced 2026-05-15 on
     ``wdsqpfq9``: DesignImporter consumed 1019s of the 1200s workflow budget
     across only two visible token-usage entries — without per-call timing,
     operators can't tell whether one call hung or several were slow.

Tracking:
- https://github.com/google/adk-python/issues/3705
- https://discuss.ai.google.dev/t/118936
"""

import time
from typing import Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse

import structlog

logger = structlog.get_logger(__name__)


_THINKING_LOG_PREVIEW_CHARS = 2000

# Per-agent dispatch timestamps. LLM calls within a single agent run are
# async-serialized (ADK awaits each model turn before the next), so an
# ``agent_name -> monotonic_start`` map is sufficient and avoids leaking
# state across concurrent sessions when distinct agents run in parallel.
# A stack lets the rare nested/retry case keep stacking starts without
# clobbering the outer call's timing.
_llm_call_starts: dict[str, list[float]] = {}


def _agent_name_from_context(callback_context: CallbackContext) -> str:
    name = getattr(callback_context, "agent_name", None)
    return str(name) if name else "unknown"


def strip_thinking_from_response(
    callback_context: CallbackContext,
    llm_response: LlmResponse,
) -> Optional[LlmResponse]:
    """Remove pure thought text from the model response before it enters history.

    Only removes text-only thought parts (the model's internal reasoning).
    Function call and function response parts — including their
    ``thought_signature`` fields — are preserved exactly as generated.

    Returns None so the ADK proceeds with the (now-cleaned) response.
    """
    agent_name = _agent_name_from_context(callback_context)
    stack = _llm_call_starts.get(agent_name)
    if stack:
        started = stack.pop()
        if not stack:
            _llm_call_starts.pop(agent_name, None)
        duration = time.monotonic() - started
        logger.info(
            "llm_call_duration",
            agent=agent_name,
            duration_sec=round(duration, 3),
        )

    content = getattr(llm_response, "content", None)
    if not content or not getattr(content, "parts", None):
        return None

    stripped = 0
    thought_texts: list[str] = []
    cleaned_parts = []
    for part in content.parts:
        # Pure thought text → log then drop (saves context tokens)
        is_pure_thought = (
            getattr(part, "thought", False)
            and getattr(part, "text", None)
            and not getattr(part, "function_call", None)
            and not getattr(part, "function_response", None)
        )
        if is_pure_thought:
            stripped += 1
            thought_texts.append(part.text)
            continue

        # All other parts (including function_call with thought_signature) → keep as-is
        cleaned_parts.append(part)

    # Log thinking text before it is discarded so production logs
    # capture the model's reasoning during long-running editor calls.
    if thought_texts:
        combined = "\n---\n".join(thought_texts)
        preview = combined[:_THINKING_LOG_PREVIEW_CHARS]
        if len(combined) > _THINKING_LOG_PREVIEW_CHARS:
            preview += "…"
        agent_name = (
            callback_context.agent_name if hasattr(callback_context, "agent_name") else "unknown"
        )
        logger.info(
            "model_thinking",
            agent=agent_name,
            text_len=len(combined),
            preview=preview,
        )

    if cleaned_parts:
        content.parts = cleaned_parts
    # else: keep original parts (don't leave empty content)

    if stripped:
        logger.debug(
            "Stripped thought text from model response",
            stripped_thought_parts=stripped,
            agent=(
                callback_context.agent_name
                if hasattr(callback_context, "agent_name")
                else "unknown"
            ),
        )

    return None


def strip_thinking_metadata(
    callback_context: CallbackContext,
    llm_request: LlmRequest,
) -> Optional[LlmResponse]:
    """Remove pure thought text from conversation history before the model call.

    Only removes text-only thought parts (the model's internal reasoning)
    to save context tokens.  Function call and function response parts —
    including their ``thought`` and ``thought_signature`` fields — are
    preserved exactly as stored in session history.

    If removing thought parts would leave a Content with zero parts, the
    thought parts are kept to avoid breaking the conversation turn structure.

    Returns None so the model call proceeds normally.
    """
    agent_name = _agent_name_from_context(callback_context)
    _llm_call_starts.setdefault(agent_name, []).append(time.monotonic())

    stripped_thought_parts = 0

    for content in llm_request.contents:
        if not content or not content.parts:
            continue

        cleaned_parts = []
        for part in content.parts:
            # Pure thought text: model's internal reasoning → remove
            is_pure_thought = (
                getattr(part, "thought", False)
                and getattr(part, "text", None)
                and not getattr(part, "function_call", None)
                and not getattr(part, "function_response", None)
            )
            if is_pure_thought:
                stripped_thought_parts += 1
                continue  # drop this part

            # All other parts (including function_call with thought_signature) → keep
            cleaned_parts.append(part)

        # Safety: don't leave a Content with zero parts
        if cleaned_parts:
            content.parts = cleaned_parts
        # else: all parts were thoughts — keep original parts intact

    if stripped_thought_parts:
        logger.debug(
            "Stripped thought text from history",
            stripped_thought_parts=stripped_thought_parts,
            agent=(
                callback_context.agent_name
                if hasattr(callback_context, "agent_name")
                else "unknown"
            ),
        )

    return None
