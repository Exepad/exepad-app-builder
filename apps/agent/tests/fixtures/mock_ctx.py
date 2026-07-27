"""Mock InvocationContext and Session helpers for unit tests."""

from unittest.mock import AsyncMock, MagicMock


def create_mock_session(state=None, session_id="test-session-id", user_id="test-user-id"):
    """Create a mock Session object.

    Args:
        state: Initial session state dict (default: empty dict)
        session_id: Session ID
        user_id: User ID

    Returns:
        MagicMock mimicking a Session object
    """
    session = MagicMock()
    session.id = session_id
    session.user_id = user_id
    session.state = state if state is not None else {}
    return session


def create_mock_ctx(session_state=None, session_id="test-session-id", user_id="test-user-id"):
    """Create a mock InvocationContext for unit tests.

    The returned mock has:
    - ctx.session.state — a real dict (supports .get(), .update(), etc.)
    - ctx.session.id / ctx.session.user_id
    - ctx.session_service.append_event — AsyncMock
    - ctx.session_service.get_session — AsyncMock

    Args:
        session_state: Initial session state dict (default: empty dict)
        session_id: Session ID
        user_id: User ID

    Returns:
        MagicMock mimicking an InvocationContext
    """
    ctx = MagicMock()
    ctx.session = create_mock_session(state=session_state, session_id=session_id, user_id=user_id)
    ctx.session_service = MagicMock()
    ctx.session_service.append_event = AsyncMock()
    ctx.session_service.get_session = AsyncMock(return_value=ctx.session)
    return ctx
