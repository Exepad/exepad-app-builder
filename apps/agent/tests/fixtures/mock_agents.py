"""Mock Agent and Event helpers for unit tests."""

import json
import time
from unittest.mock import MagicMock


def create_mock_event(
    author="TestAgent",
    text=None,
    text_dict=None,
    turn_complete=False,
):
    """Create a mock Event with text content.

    Args:
        author: Event author name
        text: Raw text string for the event content
        text_dict: Dict that will be JSON-serialized as text (overrides text)
        turn_complete: Whether this event completes the turn

    Returns:
        MagicMock mimicking an Event
    """
    event = MagicMock()
    event.author = author
    event.turn_complete = turn_complete
    event.timestamp = time.time()

    if text_dict is not None:
        text = json.dumps(text_dict)

    if text is not None:
        part = MagicMock()
        part.text = text
        event.content = MagicMock()
        event.content.parts = [part]
    else:
        event.content = None

    return event


def create_mock_agent(events=None, name="MockAgent", side_effect=None):
    """Create a mock LlmAgent that yields predefined events.

    Args:
        events: List of Event objects to yield during run_async
        name: Agent name
        side_effect: Optional exception to raise during run_async

    Returns:
        MagicMock mimicking an LlmAgent
    """
    agent = MagicMock()
    agent.name = name

    if side_effect is not None:

        async def mock_run_error(ctx):
            raise side_effect
            yield  # noqa: unreachable — makes this an async generator

        agent.run_async = mock_run_error
    else:

        async def mock_run(ctx):
            for event in events or []:
                yield event

        agent.run_async = mock_run

    return agent
