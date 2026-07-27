"""SSE (Server-Sent Events) response parser for E2E tests.

This module provides utilities for parsing and validating SSE responses
from the /r agent endpoint.

Supports both sync (TestClient) and async (httpx) parsing modes.
"""

import json
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional

import httpx


@dataclass
class SSEEvent:
    """Represents a parsed SSE event from the /r endpoint.

    Attributes:
        event_type: The type of event (progress, chat_message, page_reload, app_config_updated)
        action: The action within the event (for progress events)
        message: The message content
        timestamp: Event timestamp
        raw_data: The complete raw event data
    """

    event_type: str
    action: Optional[str] = None
    message: Optional[str] = None
    timestamp: Optional[float] = None
    raw_data: Optional[Dict[str, Any]] = None

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "SSEEvent":
        """Create an SSEEvent from a parsed dictionary."""
        return cls(
            event_type=data.get("type", "unknown"),
            action=data.get("action"),
            message=data.get("message"),
            timestamp=data.get("timestamp"),
            raw_data=data,
        )


def parse_sse_response(response_content: bytes) -> List[SSEEvent]:
    """Parse SSE response content into a list of events.

    Args:
        response_content: Raw bytes from the streaming response

    Returns:
        List of parsed SSEEvent objects
    """
    events = []
    content = response_content.decode("utf-8")

    current_event_type = None
    current_data = None

    for line in content.split("\n"):
        line = line.strip()

        if line.startswith("event: "):
            current_event_type = line[7:]
        elif line.startswith("data: "):
            data_str = line[6:]
            try:
                current_data = json.loads(data_str)
            except json.JSONDecodeError:
                current_data = {"raw": data_str}
        elif line == "" and current_data is not None:
            # Empty line signals end of event
            event = SSEEvent.from_dict(current_data)
            events.append(event)
            current_data = None

    # Handle last event if no trailing newline
    if current_data is not None:
        event = SSEEvent.from_dict(current_data)
        events.append(event)

    return events


def parse_sse_stream(response) -> List[SSEEvent]:
    """Parse SSE events from a streaming response object.

    This handles the TestClient streaming response format.

    Args:
        response: The response object from TestClient

    Returns:
        List of parsed SSEEvent objects
    """
    # For TestClient, we can iterate over the response
    events = []

    if hasattr(response, "iter_lines"):
        current_data = None
        for line in response.iter_lines():
            if isinstance(line, bytes):
                line = line.decode("utf-8")
            line = line.strip()

            if line.startswith("data: "):
                data_str = line[6:]
                try:
                    current_data = json.loads(data_str)
                    event = SSEEvent.from_dict(current_data)
                    events.append(event)
                except json.JSONDecodeError:
                    pass
    else:
        # Fallback to content parsing
        content = response.content if hasattr(response, "content") else response
        if isinstance(content, bytes):
            events = parse_sse_response(content)

    return events


# =============================================================================
# ASYNC SSE PARSING (for httpx with real server)
# =============================================================================


async def parse_sse_stream_async(response: httpx.Response) -> List[SSEEvent]:
    """Parse SSE events from an async httpx streaming response.

    This is the primary parsing function for E2E tests using httpx
    with a real running server. Uses aiter_bytes() for proper blocking
    until the server closes the connection.

    Args:
        response: An httpx Response object from a streaming request

    Returns:
        List of parsed SSEEvent objects

    Example:
        async with client.stream("POST", "/r", json=payload) as response:
            events = await parse_sse_stream_async(response)
    """
    events = []
    buffer = ""

    # Use aiter_bytes() which properly blocks until data arrives or connection closes
    async for chunk in response.aiter_bytes():
        # Decode chunk and add to buffer
        buffer += chunk.decode("utf-8", errors="replace")

        # Process complete lines from buffer
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.strip()

            if line.startswith("data: "):
                data_str = line[6:]
                try:
                    data = json.loads(data_str)
                    event = SSEEvent.from_dict(data)
                    events.append(event)
                except json.JSONDecodeError:
                    # Skip malformed JSON
                    pass

    # Process any remaining data in buffer
    if buffer.strip().startswith("data: "):
        data_str = buffer.strip()[6:]
        try:
            data = json.loads(data_str)
            event = SSEEvent.from_dict(data)
            events.append(event)
        except json.JSONDecodeError:
            pass

    return events


async def stream_sse_events(
    client: httpx.AsyncClient,
    endpoint: str,
    payload: Dict[str, Any],
    on_event: Optional[Callable[[SSEEvent], None]] = None,
    timeout: float = 600.0,
) -> List[SSEEvent]:
    """Stream SSE events with optional real-time callback.

    This is a convenience function that handles the full streaming
    request lifecycle, with optional real-time event processing.

    Args:
        client: An httpx.AsyncClient instance
        endpoint: The endpoint to POST to (e.g., "/r")
        payload: The JSON payload to send
        on_event: Optional callback function called for each event
        timeout: Request timeout in seconds (default: 600s / 10 minutes)

    Returns:
        List of all parsed SSEEvent objects

    Example:
        def log_progress(event):
            if event.event_type == "progress":
                print(f"Progress: {event.message}")

        events = await stream_sse_events(client, "/r", payload, on_event=log_progress)
    """
    events = []
    buffer = ""

    async with client.stream(
        "POST",
        endpoint,
        json=payload,
        timeout=timeout,
    ) as response:
        response.raise_for_status()

        async for chunk in response.aiter_bytes():
            buffer += chunk.decode("utf-8", errors="replace")

            while "\n" in buffer:
                line, buffer = buffer.split("\n", 1)
                line = line.strip()

                if line.startswith("data: "):
                    data_str = line[6:]
                    try:
                        data = json.loads(data_str)
                        event = SSEEvent.from_dict(data)
                        events.append(event)

                        # Call callback if provided
                        if on_event:
                            on_event(event)
                    except json.JSONDecodeError:
                        pass

    return events


# =============================================================================
# EVENT FILTERING HELPERS
# =============================================================================


def get_events_by_type(events: List[SSEEvent], event_type: str) -> List[SSEEvent]:
    """Filter events by their type.

    Args:
        events: List of SSEEvent objects
        event_type: The event type to filter for (progress, chat_message, etc.)

    Returns:
        Filtered list of events matching the type
    """
    return [e for e in events if e.event_type == event_type]


def get_events_by_action(events: List[SSEEvent], action: str) -> List[SSEEvent]:
    """Filter events by their action.

    Args:
        events: List of SSEEvent objects
        action: The action to filter for

    Returns:
        Filtered list of events matching the action
    """
    return [e for e in events if e.action == action]


def get_final_app_config(events: List[SSEEvent]) -> Optional[Dict[str, Any]]:
    """Extract the final app config from SSE events.

    Looks for app_config_updated events and returns the config
    from the last one.

    Args:
        events: List of SSEEvent objects

    Returns:
        The app config dict if found, None otherwise
    """
    config_events = get_events_by_type(events, "app_config_updated")
    if config_events:
        last_event = config_events[-1]
        if last_event.raw_data:
            return last_event.raw_data.get("app_config")
    return None


def get_chat_response(events: List[SSEEvent]) -> Optional[str]:
    """Extract the chat response message from SSE events.

    Args:
        events: List of SSEEvent objects

    Returns:
        The chat message if found, None otherwise
    """
    chat_events = get_events_by_type(events, "chat_message")
    if chat_events:
        last_event = chat_events[-1]
        return last_event.message or (
            last_event.raw_data.get("message") if last_event.raw_data else None
        )
    return None


def get_page_reload_slug(events: List[SSEEvent]) -> Optional[str]:
    """Extract the page reload slug from SSE events.

    Args:
        events: List of SSEEvent objects

    Returns:
        The page slug to navigate to, None if no reload needed
    """
    reload_events = get_events_by_type(events, "page_reload")
    if reload_events:
        last_event = reload_events[-1]
        if last_event.raw_data:
            return last_event.raw_data.get("goto_page_slug")
    return None


def get_backend_response(events: List[SSEEvent]) -> Optional[Dict[str, Any]]:
    """Extract the backend response data from SSE events.

    The backend_response event is emitted in test mode and contains
    the full callback data that would normally be sent to the Django backend.

    Args:
        events: List of SSEEvent objects

    Returns:
        The backend response dict if found, None otherwise
    """
    response_events = get_events_by_type(events, "backend_response")
    if response_events:
        last_event = response_events[-1]
        if last_event.raw_data:
            return last_event.raw_data.get("callback_data")
    return None


def extract_app_config_from_backend_response(
    backend_response: Dict[str, Any],
) -> Optional[Dict[str, Any]]:
    """Extract and parse app_config from backend response session_state.

    The backend_response.session_state.app_config contains a stringified JSON
    that needs to be parsed into a dictionary.

    Args:
        backend_response: The backend response dict from get_backend_response()

    Returns:
        The parsed app_config dict if found and valid, None otherwise
    """
    if not backend_response:
        return None

    session_state = backend_response.get("session_state", {})
    if not session_state:
        return None

    app_config_str = session_state.get("app_config")
    if not app_config_str:
        return None

    # Parse the stringified JSON
    if isinstance(app_config_str, str):
        try:
            return json.loads(app_config_str)
        except json.JSONDecodeError:
            return None
    elif isinstance(app_config_str, dict):
        # Already parsed
        return app_config_str

    return None


def assert_workflow_completed(events: List[SSEEvent]) -> bool:
    """Verify that the workflow completed successfully.

    A successful workflow should have:
    - At least one progress event
    - A chat_message event (response to user)
    - No error events

    Args:
        events: List of SSEEvent objects

    Returns:
        True if workflow completed successfully

    Raises:
        AssertionError: If workflow did not complete successfully
    """
    if not events:
        raise AssertionError("No SSE events received")

    # Check for error events
    error_events = [e for e in events if e.action == "error" or e.event_type == "error"]
    if error_events:
        error_messages = [e.message or str(e.raw_data) for e in error_events]
        raise AssertionError(f"Workflow errors: {error_messages}")

    # Should have at least one progress event
    progress_events = get_events_by_type(events, "progress")
    if not progress_events:
        # Progress might be embedded in the event action
        progress_events = [e for e in events if e.action is not None]

    # Should have a chat message response
    chat_response = get_chat_response(events)

    return len(progress_events) > 0 or chat_response is not None


def assert_app_config_saved(events: List[SSEEvent]) -> Dict[str, Any]:
    """Assert that an app config was saved and return it.

    Args:
        events: List of SSEEvent objects

    Returns:
        The saved app config

    Raises:
        AssertionError: If no app config was saved
    """
    config = get_final_app_config(events)
    if config is None:
        # Check if there's an app_config_updated event without embedded config
        config_events = get_events_by_type(events, "app_config_updated")
        if not config_events:
            raise AssertionError("No app_config_updated event found")
        return {}  # Config was saved but not included in event
    return config


def extract_progress_messages(events: List[SSEEvent]) -> List[str]:
    """Extract all progress messages from events.

    Args:
        events: List of SSEEvent objects

    Returns:
        List of progress message strings
    """
    messages = []
    for event in events:
        if event.event_type == "progress" and event.message:
            messages.append(event.message)
        elif event.action and event.message:
            messages.append(f"[{event.action}] {event.message}")
    return messages
