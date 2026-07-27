"""
Session state mutation and prompt forwarding utilities.

Centralizes all operations that modify ctx.session.state, making
state changes traceable and testable.
"""

import time
import structlog
from google.adk.events import Event, EventActions
from google.genai.types import Content, Part
from typing import Any

logger = structlog.get_logger(__name__)


async def push_session_state_update(ctx, state_changes):
    """Helper function to push state updates as system events."""
    current_time = time.time()
    actions_with_update = EventActions(state_delta=state_changes)
    system_event = Event(
        author="ExepadAgent",
        actions=actions_with_update,
        timestamp=current_time,
    )
    # Persist first, then update local state — avoids corruption if append_event fails
    await ctx.session_service.append_event(ctx.session, system_event)

    # Update local session state so subsequent reads in the same execution context see the changes
    if (
        hasattr(ctx, "session")
        and hasattr(ctx.session, "state")
        and isinstance(ctx.session.state, dict)
    ):
        ctx.session.state.update(state_changes)


async def push_prompt_to_next_agent(ctx, prompt):
    """Helper function to push prompt to app builder."""
    current_time = time.time()
    system_event = Event(
        author="user",
        timestamp=current_time,
        content=Content(role="user", parts=[Part(text=prompt)]),
    )
    await ctx.session_service.append_event(ctx.session, system_event)

    # Also store in session state for tracking purposes
    await push_session_state_update(ctx, {"last_prompt_to_agent": prompt})


def parse_result_chat_response(full_output: Any) -> tuple:
    """Parse the result_chat_response from session state into (chat_response, conversation_summary).

    Handles three payload shapes:
      - dict  → extract keys "result_chat_response" and "conversation_message_summary"
      - str   → treat as chat_response directly
      - object → attempt attribute access, fall back to str()

    Returns:
        (chat_response, conversation_summary) — either may be None.
    """
    if not full_output:
        return None, None

    if isinstance(full_output, dict):
        chat_response = full_output.get("result_chat_response") or str(full_output)
        conversation_summary = full_output.get("conversation_message_summary")
    elif isinstance(full_output, str):
        chat_response = full_output
        conversation_summary = None
    else:
        chat_response = getattr(full_output, "result_chat_response", str(full_output))
        conversation_summary = getattr(full_output, "conversation_message_summary", None)

    return chat_response, conversation_summary
