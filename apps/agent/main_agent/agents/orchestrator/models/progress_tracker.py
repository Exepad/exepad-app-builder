"""
Progress tracking for the pipeline orchestrator.

This module provides progress tracking for the app creation workflow,
generating structured SSE events that conform to the shared event schema.

See also:
    - backend/agent_service/events/sse_events_schema.py
    - frontend/src/types/sse-events.ts
    - docs/SSE_EVENT_SCHEMA.md
"""

import os
import time
import json
import structlog
from dataclasses import dataclass
from typing import Optional
from google.adk.events import Event
from google.adk.agents.invocation_context import InvocationContext
from google.genai.types import Content, Part
from ...utils.helpers import push_session_state_update

logger = structlog.get_logger(__name__)

# Base time constants for progress estimation (configurable via env vars)
BASE_PIPELINE_TIME = int(os.getenv("PROGRESS_BASE_PIPELINE_TIME", "30"))  # seconds — fixed overhead
PER_PAGE_BUILDING_TIME = int(
    os.getenv("PROGRESS_PER_PAGE_TIME", "40")
)  # seconds per page (JSON workflow)
PER_SECTION_BUILDING_TIME = int(os.getenv("PROGRESS_PER_SECTION_TIME", "8"))  # seconds per section
PER_COMPONENT_BUILDING_TIME = int(
    os.getenv("PROGRESS_PER_COMPONENT_TIME", "18")
)  # seconds per code-focus component


@dataclass
class ProgressTracker:
    """
    Manages progress tracking and event generation for the pipeline orchestrator.

    Tracks overall progress percentage and estimated time to completion,
    and generates progress events for consumption by the frontend.

    This class is stateless and stores data in the InvocationContext session state.
    """

    async def reset(self, ctx: InvocationContext) -> None:
        """Reset progress to initial state."""
        await push_session_state_update(
            ctx,
            {
                "progress_number": 0,
                "total_time_to_complete": 0,
                "workflow_start_time": time.time(),
                "postprocessing_progress": 10,  # default
                "generation_steps": [],
                "current_agent": "",
                "current_agent_start_time": None,
            },
        )
        logger.debug("Progress tracker reset in session")

    async def update(self, ctx: InvocationContext, progress: int, message: str = "") -> None:
        """
        Update progress to a specific value (monotonically increasing).

        Args:
            ctx: Invocation context
            progress: Progress percentage (0-100)
            message: Optional message describing the current operation
        """
        current = ctx.session.state.get("progress_number", 0)
        new_progress = max(current, min(100, progress))
        await push_session_state_update(ctx, {"progress_number": new_progress})

        if message:
            logger.info(f"Progress: {new_progress}% - {message}")

    async def increment(self, ctx: InvocationContext, delta: int, message: str = "") -> None:
        """
        Increment progress by a delta value.

        Args:
            ctx: Invocation context
            delta: Amount to increment progress by
            message: Optional message describing the current operation
        """
        current_progress = ctx.session.state.get("progress_number", 0)
        new_progress = max(0, min(100, current_progress + delta))
        await push_session_state_update(ctx, {"progress_number": new_progress})

        if message:
            logger.info(f"Progress: {new_progress}% - {message}")

    async def calculate_total_time(
        self,
        ctx: InvocationContext,
        pages_count: int,
        total_sections: int = 0,
    ) -> None:
        """
        Calculate estimated total time for the JSON workflow based on pages/sections.

        Args:
            ctx: Invocation context
            pages_count: Number of pages to be generated
            total_sections: Total section count across all pages (0 = legacy flat estimate)
        """
        if total_sections > 0:
            # Section-weighted estimate
            total_time = (
                BASE_PIPELINE_TIME
                + PER_PAGE_BUILDING_TIME * pages_count
                + PER_SECTION_BUILDING_TIME * total_sections
            )
        else:
            # Legacy flat estimate (backwards compatible)
            total_time = PER_PAGE_BUILDING_TIME * (pages_count + 1)

        await push_session_state_update(ctx, {"total_time_to_complete": total_time})
        logger.info(
            f"Estimated total time: {total_time}s "
            f"(pages={pages_count}, sections={total_sections})"
        )

    async def calculate_total_time_codefocus(
        self,
        ctx: InvocationContext,
        component_count: int,
    ) -> None:
        """
        Calculate estimated total time for the Code Focus workflow.

        Code Focus components are smaller, individually-generated TSX units
        that build faster than full JSON pages.

        Args:
            ctx: Invocation context
            component_count: Number of code-focus components to be generated
        """
        total_time = BASE_PIPELINE_TIME + PER_COMPONENT_BUILDING_TIME * component_count

        await push_session_state_update(ctx, {"total_time_to_complete": total_time})
        logger.info(
            f"Estimated total time (codefocus): {total_time}s " f"(components={component_count})"
        )

    def get_estimated_time_remaining(self, ctx: InvocationContext) -> float:
        """
        Calculate estimated time remaining using actual elapsed wall-clock time.

        When enough progress has been made (>5%), extrapolates from actual
        elapsed time rather than the static pre-calculated total.  Falls back
        to the proportional estimate for the very first events.

        Returns:
            Estimated seconds remaining, or -1 if cannot estimate
        """
        progress_number = ctx.session.state.get("progress_number", 0)
        total_time = ctx.session.state.get("total_time_to_complete", 0)
        start_time = ctx.session.state.get("workflow_start_time", 0)

        if progress_number <= 0 or total_time <= 0:
            return -1

        elapsed = time.time() - start_time if start_time else 0

        if progress_number >= 5 and elapsed > 0:
            pace_remaining = int(elapsed / (progress_number / 100) * (1 - progress_number / 100))
            proportional = int(total_time * (1 - progress_number / 100))
            return min(pace_remaining, proportional)

        return int(total_time * (1 - float(progress_number) / 100))

    def create_event(
        self,
        ctx: InvocationContext,
        action: str,
        internal_message: str = "",
        estimated_time_to_complete: Optional[int] = None,
    ) -> Event:
        """
        Create a progress event for the current state.

        This method creates structured progress events with action codes.
        The backend will normalize progress and add user-friendly messages.

        Note: The 'internal_message' parameter is for logging/debugging only.
        User-facing messages are added by the backend's ProgressOrchestrator.

        Args:
            ctx: Invocation context
            action: Action identifier (e.g., "component_building", "app_building_started")
                   Used by backend to determine phase and user message.
            internal_message: Internal message for logging/debugging only.
                            NOT shown to users - backend adds user-friendly messages.
            estimated_time_to_complete: Optional override for estimated time remaining.
                If not provided, will be calculated based on progress.

        Returns:
            Event object containing progress information conforming to SSE schema
        """
        current_time = time.time()
        progress_number = ctx.session.state.get("progress_number", 0)
        app_uuid = ctx.session.state.get("app_uuid")

        # Calculate estimated time remaining
        if estimated_time_to_complete is not None:
            estimated_time = estimated_time_to_complete
        else:
            estimated_time = self.get_estimated_time_remaining(ctx)

        # Create structured event with action code
        # Backend will normalize progress and add user-friendly message
        msg_obj = {
            "type": "progress",
            "action": action,
            "progress": progress_number,
            # Internal message for logging - backend replaces with user-friendly message
            "internal_message": internal_message,
            "timestamp": current_time,
            "estimated_time_to_complete": estimated_time,
        }

        # Include app_uuid if available
        if app_uuid:
            msg_obj["app_uuid"] = app_uuid

        return Event(
            author="ProgressAgent",
            timestamp=current_time,
            content=Content(parts=[Part(text=json.dumps(msg_obj))]),
            turn_complete=False,
        )

    def create_page_reload_event(
        self, ctx: InvocationContext, goto_page_slug: Optional[str] = None
    ) -> Event:
        """
        Create a page reload event.

        Args:
            ctx: Invocation context
            goto_page_slug: Optional slug of the page to navigate to after reload

        Returns:
            Event object containing page reload instruction
        """
        current_time = time.time()
        app_uuid = ctx.session.state.get("app_uuid")

        msg_obj = {
            "type": "page_reload",
            "goto_page_slug": goto_page_slug,
            "timestamp": current_time,
        }

        # Include app_uuid if available
        if app_uuid:
            msg_obj["app_uuid"] = app_uuid

        return Event(
            author="ProgressAgent",
            timestamp=current_time,
            content=Content(parts=[Part(text=json.dumps(msg_obj))]),
            turn_complete=False,
        )

    def create_app_config_updated_event(
        self,
        ctx: InvocationContext,
        reload_app: bool = False,
        changed_component_uuid: Optional[str] = None,
        change_type: Optional[str] = None,
        changed_page_uuid: Optional[str] = None,
        changed_component_config: Optional[dict] = None,
    ) -> Event:
        """
        Create an app config updated event.

        Args:
            ctx: Invocation context
            reload_app: Whether a full reload is needed
            changed_component_uuid: UUID of the changed component (for hot reload)
            change_type: Type of change ('modify' or 'remove')
            changed_page_uuid: UUID of the page containing the changed component
            changed_component_config: The actual component config data (for direct update)

        Returns:
            Event object containing app config update information
        """
        current_time = time.time()
        app_uuid = ctx.session.state.get("app_uuid")
        app_name = ctx.session.state.get("app_name")

        msg_obj = {
            "type": "app_config_updated",
            "reload_app": reload_app,
            "timestamp": current_time,
        }

        # Include app metadata
        if app_uuid:
            msg_obj["app_uuid"] = app_uuid
        if app_name:
            msg_obj["app_name"] = app_name

        # Include hot reload metadata for component changes
        if changed_component_uuid:
            msg_obj["changed_component_uuid"] = changed_component_uuid
        if change_type:
            msg_obj["change_type"] = change_type
        if changed_page_uuid:
            msg_obj["changed_page_uuid"] = changed_page_uuid

        # Include actual component config for direct update (no fetch needed)
        if changed_component_config:
            msg_obj["changed_component_config"] = changed_component_config

        return Event(
            author="ProgressAgent",
            timestamp=current_time,
            content=Content(parts=[Part(text=json.dumps(msg_obj))]),
            turn_complete=False,
        )

    async def create_completion_event(self, ctx: InvocationContext) -> Event:
        """
        Create a final completion event (100% progress).

        Returns:
            Event object indicating workflow completion
        """
        await push_session_state_update(ctx, {"progress_number": 100})
        return self.create_event(ctx, "app_building_finished", internal_message="Build complete")

    def create_chat_message_event(self, ctx: InvocationContext, chat_response: str) -> Event:
        """
        Create a chat message event.

        Args:
            ctx: Invocation context
            chat_response: The chat message text to send to the frontend

        Returns:
            Event object containing the chat message
        """
        current_time = time.time()
        app_uuid = ctx.session.state.get("app_uuid")

        msg_obj = {
            "type": "chat_message",
            "text": chat_response,
            "timestamp": current_time,
        }

        # Include app_uuid if available
        if app_uuid:
            msg_obj["app_uuid"] = app_uuid

        return Event(
            author="ExepadCreator",
            timestamp=current_time,
            content=Content(parts=[Part(text=json.dumps(msg_obj))]),
            turn_complete=False,
        )

    def create_backend_response_event(self, ctx: InvocationContext, callback_data: dict) -> Event:
        """
        Create a backend response event (for test mode capture).

        This event contains the full callback data that would normally be
        sent to the Django backend. Used in test mode to capture the
        response for validation.

        Args:
            ctx: Invocation context
            callback_data: The data that would be sent to the backend

        Returns:
            Event object containing the backend response data
        """
        current_time = time.time()
        app_uuid = ctx.session.state.get("app_uuid")

        msg_obj = {
            "type": "backend_response",
            "timestamp": current_time,
            "callback_data": callback_data,
        }

        # Include app_uuid if available
        if app_uuid:
            msg_obj["app_uuid"] = app_uuid

        return Event(
            author="BackendNotifier",
            timestamp=current_time,
            content=Content(parts=[Part(text=json.dumps(msg_obj))]),
            turn_complete=False,
        )
