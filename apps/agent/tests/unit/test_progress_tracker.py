"""Tests for ProgressTracker — progress tracking and SSE event generation.

Tests cover:
- reset/update/increment operations
- calculate_total_time estimation
- get_estimated_time_remaining calculation
- Event creation methods (progress, page_reload, app_config_updated, chat, completion)
"""

import asyncio
import json
import pytest
from unittest.mock import AsyncMock, patch

from main_agent.agents.orchestrator.models.progress_tracker import (
    ProgressTracker,
    PER_PAGE_BUILDING_TIME,
)
from tests.fixtures.mock_ctx import create_mock_ctx


@pytest.fixture
def tracker():
    """Create a ProgressTracker instance."""
    return ProgressTracker()


# =============================================================================
# reset
# =============================================================================


class TestReset:
    """Tests for ProgressTracker.reset."""

    @pytest.mark.unit
    def test_reset_sets_initial_state(self, tracker):
        """Reset sets progress_number to 0 and clears tracking state."""
        ctx = create_mock_ctx(session_state={"progress_number": 50})

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            asyncio.run(tracker.reset(ctx))

            mock_push.assert_called_once()
            state_changes = mock_push.call_args[0][1]
            assert state_changes["progress_number"] == 0
            assert state_changes["total_time_to_complete"] == 0
            assert state_changes["generation_steps"] == []
            assert state_changes["current_agent"] == ""


# =============================================================================
# update / increment
# =============================================================================


class TestUpdateIncrement:
    """Tests for progress update and increment."""

    @pytest.mark.unit
    def test_update_sets_value(self, tracker):
        """Update sets progress to exact value."""
        ctx = create_mock_ctx()

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            asyncio.run(
                tracker.update(ctx, 75, "Three quarters done")
            )

            state_changes = mock_push.call_args[0][1]
            assert state_changes["progress_number"] == 75

    @pytest.mark.unit
    def test_update_clamps_to_100(self, tracker):
        """Progress is clamped to 100 max."""
        ctx = create_mock_ctx()

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            asyncio.run(tracker.update(ctx, 150))

            state_changes = mock_push.call_args[0][1]
            assert state_changes["progress_number"] == 100

    @pytest.mark.unit
    def test_update_clamps_to_0(self, tracker):
        """Progress is clamped to 0 min."""
        ctx = create_mock_ctx()

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            asyncio.run(tracker.update(ctx, -10))

            state_changes = mock_push.call_args[0][1]
            assert state_changes["progress_number"] == 0

    @pytest.mark.unit
    def test_increment_adds_delta(self, tracker):
        """Increment adds delta to current progress."""
        ctx = create_mock_ctx(session_state={"progress_number": 40})

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            asyncio.run(tracker.increment(ctx, 20, "More progress"))

            state_changes = mock_push.call_args[0][1]
            assert state_changes["progress_number"] == 60

    @pytest.mark.unit
    def test_increment_clamps_to_100(self, tracker):
        """Increment is clamped to 100."""
        ctx = create_mock_ctx(session_state={"progress_number": 90})

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            asyncio.run(tracker.increment(ctx, 20))

            state_changes = mock_push.call_args[0][1]
            assert state_changes["progress_number"] == 100


# =============================================================================
# calculate_total_time
# =============================================================================


class TestCalculateTotalTime:
    """Tests for time estimation."""

    @pytest.mark.unit
    def test_total_time_for_pages(self, tracker):
        """Total time = PER_PAGE_BUILDING_TIME * (pages + 1)."""
        ctx = create_mock_ctx()

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            asyncio.run(tracker.calculate_total_time(ctx, 3))

            state_changes = mock_push.call_args[0][1]
            expected = PER_PAGE_BUILDING_TIME * (3 + 1)
            assert state_changes["total_time_to_complete"] == expected

    @pytest.mark.unit
    def test_total_time_for_single_page(self, tracker):
        """Single page → PER_PAGE_BUILDING_TIME * 2 (page + 1)."""
        ctx = create_mock_ctx()

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            asyncio.run(tracker.calculate_total_time(ctx, 1))

            state_changes = mock_push.call_args[0][1]
            assert state_changes["total_time_to_complete"] == PER_PAGE_BUILDING_TIME * 2


# =============================================================================
# get_estimated_time_remaining
# =============================================================================


class TestGetEstimatedTimeRemaining:
    """Tests for estimated time remaining calculation."""

    @pytest.mark.unit
    def test_returns_remaining_time(self, tracker):
        """At 50% with 120s total → ~60s remaining."""
        ctx = create_mock_ctx(
            session_state={
                "progress_number": 50,
                "total_time_to_complete": 120,
            }
        )
        remaining = tracker.get_estimated_time_remaining(ctx)
        assert remaining == 60

    @pytest.mark.unit
    def test_returns_zero_at_100_percent(self, tracker):
        """At 100% → 0 remaining."""
        ctx = create_mock_ctx(
            session_state={
                "progress_number": 100,
                "total_time_to_complete": 120,
            }
        )
        remaining = tracker.get_estimated_time_remaining(ctx)
        assert remaining == 0

    @pytest.mark.unit
    def test_returns_negative_one_when_no_data(self, tracker):
        """Returns -1 when progress or total_time is 0."""
        ctx = create_mock_ctx(
            session_state={
                "progress_number": 0,
                "total_time_to_complete": 0,
            }
        )
        remaining = tracker.get_estimated_time_remaining(ctx)
        assert remaining == -1


# =============================================================================
# Event creation
# =============================================================================


class TestCreateEvent:
    """Tests for various event creation methods."""

    @pytest.mark.unit
    def test_create_progress_event(self, tracker):
        """Progress event has correct structure."""
        ctx = create_mock_ctx(
            session_state={
                "progress_number": 30,
                "total_time_to_complete": 120,
                "app_uuid": "app-123",
            }
        )

        event = tracker.create_event(
            ctx, "component_building", internal_message="Building component 1"
        )

        assert event.author == "ProgressAgent"
        assert event.turn_complete is False

        # Parse the event text
        text = json.loads(event.content.parts[0].text)
        assert text["type"] == "progress"
        assert text["action"] == "component_building"
        assert text["progress"] == 30
        assert text["app_uuid"] == "app-123"
        assert "timestamp" in text

    @pytest.mark.unit
    def test_create_event_without_app_uuid(self, tracker):
        """Progress event omits app_uuid when not in state."""
        ctx = create_mock_ctx(session_state={"progress_number": 10})

        event = tracker.create_event(ctx, "starting")
        text = json.loads(event.content.parts[0].text)
        assert "app_uuid" not in text

    @pytest.mark.unit
    def test_create_page_reload_event(self, tracker):
        """Page reload event has correct type and optional goto_page_slug."""
        ctx = create_mock_ctx(session_state={"app_uuid": "app-1"})

        event = tracker.create_page_reload_event(ctx, goto_page_slug="/about")
        text = json.loads(event.content.parts[0].text)
        assert text["type"] == "page_reload"
        assert text["goto_page_slug"] == "/about"
        assert text["app_uuid"] == "app-1"

    @pytest.mark.unit
    def test_create_app_config_updated_event(self, tracker):
        """App config updated event includes hot reload metadata."""
        ctx = create_mock_ctx(
            session_state={
                "app_uuid": "app-1",
                "app_name": "Test App",
            }
        )

        event = tracker.create_app_config_updated_event(
            ctx,
            reload_app=False,
            changed_component_uuid="comp-1",
            change_type="modify",
            changed_page_uuid="page-1",
        )
        text = json.loads(event.content.parts[0].text)
        assert text["type"] == "app_config_updated"
        assert text["reload_app"] is False
        assert text["changed_component_uuid"] == "comp-1"
        assert text["change_type"] == "modify"
        assert text["changed_page_uuid"] == "page-1"

    @pytest.mark.unit
    def test_create_chat_message_event(self, tracker):
        """Chat message event contains the response text."""
        ctx = create_mock_ctx(session_state={"app_uuid": "app-1"})

        event = tracker.create_chat_message_event(ctx, "Here is your answer!")
        text = json.loads(event.content.parts[0].text)
        assert text["type"] == "chat_message"
        assert text["text"] == "Here is your answer!"
        assert event.author == "ExepadCreator"

    @pytest.mark.unit
    def test_create_completion_event(self, tracker):
        """Completion event sets progress to 100 and action to 'app_building_finished'."""
        ctx = create_mock_ctx(
            session_state={
                "progress_number": 90,
                "total_time_to_complete": 120,
            }
        )

        with patch(
            "main_agent.agents.orchestrator.models.progress_tracker.push_session_state_update",
            new_callable=AsyncMock,
        ) as mock_push:
            event = asyncio.run(
                tracker.create_completion_event(ctx)
            )

            # Should have set progress to 100
            state_changes = mock_push.call_args[0][1]
            assert state_changes["progress_number"] == 100

        text = json.loads(event.content.parts[0].text)
        assert text["action"] == "app_building_finished"

    @pytest.mark.unit
    def test_create_backend_response_event(self, tracker):
        """Backend response event wraps callback_data."""
        ctx = create_mock_ctx(session_state={"app_uuid": "app-1"})
        callback = {"status": "success", "app_config": {"name": "test"}}

        event = tracker.create_backend_response_event(ctx, callback)
        text = json.loads(event.content.parts[0].text)
        assert text["type"] == "backend_response"
        assert text["callback_data"] == callback
        assert event.author == "BackendNotifier"
