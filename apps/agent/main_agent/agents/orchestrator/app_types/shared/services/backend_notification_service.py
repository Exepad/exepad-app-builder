"""
Backend notification service.

Handles notifying the Django backend that agent execution has completed,
including retry logic, authentication, test-mode handling, and error reporting.

Extracted from PipelineOrchestrator._notify_backend_completion to keep the
orchestrator focused on routing and coordination.
"""

from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import AsyncGenerator

import httpx
import structlog
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from .....utils.helpers import push_session_state_update
from ...base.base_service import BaseService

logger = structlog.get_logger(__name__)


# Agent error types that indicate the workflow aborted and no app_config was
# saved. Used to switch the backend callback to a tight budget — on failure the
# callback is advisory only (for dashboard record keeping).
_TERMINAL_FAILURE_ERROR_TYPES: frozenset[str] = frozenset(
    {"validation_pipeline_error", "component_generation_failed"}
)


def _has_terminal_failure(session_state: dict) -> bool:
    """Return True when the session aborted with a terminal component failure.

    Shared between ``notify_completion`` (gates the callback budget) and
    ``_build_callback_data`` (sets ``status="failed"``).
    """
    for err in session_state.get("agent_errors", []):
        if isinstance(err, dict) and err.get("type") in _TERMINAL_FAILURE_ERROR_TYPES:
            return True
    return False


class BackendNotificationService(BaseService):
    """Sends execution-complete callbacks to the Django backend.

    Responsibilities:
    - Assemble callback_data from session state and metrics
    - Handle test-mode (emit event instead of HTTP call)
    - Handle dev-mode (skip when DJANGO_BACKEND_URL is unset)
    - Authenticate via IAM token (production) or API key (other envs)
    - Retry with exponential backoff on transient failures
    """

    # Retry configuration
    MAX_RETRIES: int = 3
    BASE_DELAY: float = 2.0
    # The backend execution-complete handler downloads from GCS and uploads
    # to R2 (components + images) synchronously before returning.  This can
    # take 60-90s for apps with many assets.  A 30s timeout causes the agent
    # to retry prematurely — the retry hits the idempotency guard ("still
    # processing") and loops until the first request finishes.  120s gives
    # enough headroom for a single round-trip.
    REQUEST_TIMEOUT: float = float(os.environ.get("BACKEND_NOTIFICATION_TIMEOUT", "120"))

    def __init__(self) -> None:
        super().__init__()

    async def notify_completion(
        self,
        ctx: InvocationContext,
        metrics_tracker,
        progress_tracker,
    ) -> AsyncGenerator[Event, None]:
        """Notify Django backend that agent execution completed.

        In test mode, emits a ``backend_response`` event with the callback data
        instead of sending to the backend.

        Yields:
            Event: ``backend_response`` event (test mode only)

        Side effect:
            Sets ``ctx.session.state["_backend_save_result"]`` to ``True``/``False``
        """
        service_name = "BackendNotificationService"
        try:
            is_test = ctx.session.state.get("is_test", False)
            backend_url = os.getenv("DJANGO_BACKEND_URL")
            app_uuid = ctx.session.state.get("app_uuid")
            # Use public_id for backend callback URL (backend routes by
            # public_id).  Falls back to app_uuid for backwards compat.
            app_public_id = ctx.session.state.get("app_public_id") or app_uuid
            correlation_id = ctx.session.state.get("correlation_id")

            # Terminal failures switch the callback to a tight budget. The Django
            # record is nice-to-have when the build already failed — don't let an
            # unreachable Django hold the session lock open for minutes.
            has_terminal_failure = _has_terminal_failure(ctx.session.state)

            # Self-host ships no file_refs: the runtime worker pulls the build
            # output directly from the agent's artifact store (GET /artifacts/
            # {session}) rather than from a shared object store. The cloud
            # topology uploaded outputs to GCS here and passed gs:// refs in the
            # callback; that path was removed with GcsOutputService.
            file_refs: dict[str, str] = {}

            # Build callback_data (app_config removed; file refs included when available)
            callback_data = self._build_callback_data(
                ctx, metrics_tracker, correlation_id, file_refs=file_refs
            )

            # Test mode: emit backend_response event and skip actual backend call
            if is_test:
                logger.info(f"[{service_name}] Test mode detected, emitting backend_response event")
                yield progress_tracker.create_backend_response_event(ctx, callback_data)
                await push_session_state_update(ctx, {"_backend_save_result": True})
                return

            # Development mode bypass: if DJANGO_BACKEND_URL is not configured
            if not backend_url:
                logger.info(
                    f"[{service_name}] DJANGO_BACKEND_URL not configured, "
                    "skipping backend notification (dev mode)"
                )
                await push_session_state_update(ctx, {"_backend_save_result": True})
                return

            # Validate required fields for production
            if not app_uuid:
                logger.warning(
                    f"[{service_name}] No app_uuid in session state, skipping backend notification"
                )
                await push_session_state_update(ctx, {"_backend_save_result": False})
                return

            if not correlation_id:
                logger.error(f"[{service_name}] No correlation_id found in session state")
                await push_session_state_update(ctx, {"_backend_save_result": False})
                return

            # Send with retry — use public_id for the backend URL since
            # the backend routes by public_id. Terminal-failure runs use a
            # tight budget (15s × 1 attempt) since the callback is advisory
            # only — no payload round-trip to wait on.
            if has_terminal_failure:
                success = await self._send_with_retry(
                    ctx,
                    backend_url,
                    app_public_id,
                    callback_data,
                    service_name,
                    timeout=self.FAILURE_REQUEST_TIMEOUT,
                    max_retries=self.FAILURE_MAX_RETRIES,
                )
            else:
                success = await self._send_with_retry(
                    ctx,
                    backend_url,
                    app_public_id,
                    callback_data,
                    service_name,
                )
            await push_session_state_update(ctx, {"_backend_save_result": success})

        except httpx.HTTPError as e:
            logger.error(f"[{service_name}] HTTP error notifying backend: {e}", exc_info=True)
            await push_session_state_update(ctx, {"_backend_save_result": False})
        except Exception as e:
            logger.error(f"[{service_name}] Failed to notify backend: {e}", exc_info=True)
            await push_session_state_update(ctx, {"_backend_save_result": False})

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _build_callback_data(
        self,
        ctx: InvocationContext,
        metrics_tracker,
        correlation_id: str | None,
        *,
        file_refs: dict[str, str] | None = None,
    ) -> dict:
        """Assemble the callback payload from session state and metrics.

        ``app_config`` is never included inline.  In production, the
        ``file_refs`` dict (GCS URIs) is attached as ``session_state.files``
        so the backend can retrieve files from GCS.
        """
        from ...webapp.services.component_failure_service import build_component_issues

        user_prompt = ctx.session.state.get("user_prompt", "")
        chat_response = ctx.session.state.get("chat_response", "")
        workflow_type = ctx.session.state.get("workflow_type", "unknown")
        metrics_summary = metrics_tracker.get_summary(ctx)
        environment = os.getenv("ENVIRONMENT", "development")
        agent_errors = ctx.session.state.get("agent_errors", [])
        component_issues = build_component_issues(ctx.session.state)

        session_state_data: dict = {
            "save_app_config": ctx.session.state.get("save_app_config", False),
            "is_first_app_creation": ctx.session.state.get("is_first_app_creation", False),
            "app_name": ctx.session.state.get("app_name"),
            "app_language_code": ctx.session.state.get("app_language_code"),
            "app_building_plan": ctx.session.state.get("app_building_plan"),
            # `app_design_style` was removed — the `design_style[]` array used to
            # propagate the planner's natural-language vocabulary (e.g.
            # "tertiary_fixed background") into every edit's prompt, baking in
            # token names that DesignSystemBuilder didn't actually emit.
            # Backend column `app_design_style` is now nullable and slated for
            # removal in a follow-up migration.
            "app_color_palette": (
                [
                    ds.get("primary_color"),
                    ds.get("secondary_color"),
                    ds.get("surface_color"),
                    ds.get("error_color"),
                ]
                if (ds := ctx.session.state.get("design_system"))
                else None
            ),
            "pages_to_update": ctx.session.state.get("pages_to_update"),
            "pages_to_add": ctx.session.state.get("pages_to_add"),
            "pages_to_delete": ctx.session.state.get("pages_to_delete"),
            "reload_app": ctx.session.state.get("reload_app", False),
            "changed_component_uuid": ctx.session.state.get("changed_component_uuid"),
            "change_type": ctx.session.state.get("change_type"),
            "changed_page_uuid": ctx.session.state.get("changed_page_uuid"),
            "conversation_message_summary": ctx.session.state.get("conversation_message_summary"),
            "component_issues": component_issues,
            # Edit-touch signals: tells the backend deploy pipeline which
            # components / handlers / styles / models actually changed on
            # this edit, so it can skip GCS→R2 + esbuild + placeholder rewrite
            # for untouched assets. None on creation (full-scan sentinel).
            # Populated by EditingWorkflow._assemble_and_save.
            "_edit_touched_components": ctx.session.state.get("_edit_touched_components"),
            "_edit_touched_handlers": ctx.session.state.get("_edit_touched_handlers"),
            "_edit_styles_touched": ctx.session.state.get("_edit_styles_touched"),
            "_edit_models_touched": ctx.session.state.get("_edit_models_touched"),
            "_edit_seeds_touched": ctx.session.state.get("_edit_seeds_touched"),
        }

        # Include GCS file references when available (production)
        if file_refs:
            session_state_data["files"] = file_refs

        save_config = ctx.session.state.get("save_app_config", False)
        has_terminal_failure = _has_terminal_failure(ctx.session.state)
        decline_reason = ctx.session.state.get("decline_reason")
        decline_category = ctx.session.state.get("decline_category", "none")
        if decline_reason:
            # Set by _emit_decline_directly in either gate (PreCreator on
            # create, AppHelpDesk on edit). Tells the backend to skip
            # credit deduction and (on create) soft-delete the App row.
            status = "declined"
        elif has_terminal_failure or (workflow_type == "create" and not save_config):
            status = "failed"
        elif agent_errors:
            status = "partial_success"
        else:
            status = "success"

        # Surface decline metadata into both the top-level payload and the
        # session_state block. Top-level fields are what the backend reads
        # in its decline branch; the session_state copy is for the audit
        # row stored on AgentExecution.
        if decline_reason:
            session_state_data["decline_reason"] = decline_reason
            session_state_data["decline_category"] = decline_category

        return {
            "correlation_id": correlation_id,
            "session_id": ctx.session.id,
            "status": status,
            "user_prompt": user_prompt,
            "assistant_response": chat_response,
            "workflow_type": workflow_type,
            "session_state": session_state_data,
            "decline_reason": decline_reason or "",
            "decline_category": decline_category if decline_reason else "",
            "metrics": {
                "workflow_duration": metrics_summary.get("workflow_duration"),
                "totals": metrics_summary.get("totals"),
                "agent_metrics": metrics_summary.get("agent_metrics"),
                "image_stats": metrics_summary.get("image_stats"),
            },
            "execution_context": {
                "agent_version": os.getenv("AGENT_VERSION", "unknown"),
                "environment": environment,
                "started_at": metrics_summary.get("workflow_start_iso"),
                "completed_at": datetime.now(timezone.utc).isoformat(),
            },
            "agent_errors": agent_errors,
        }

    def _get_auth_headers(self, backend_url: str, service_name: str) -> dict:
        """Build authentication headers based on the current environment.

        In production, generates a fresh GCP IAM ID token each time this is
        called so that retries always use a valid (non-expired) token.
        """
        environment = os.getenv("ENVIRONMENT", "development")
        api_key = os.getenv("AGENT_SERVICE_API_KEY", "")
        headers: dict[str, str] = {}

        if environment == "production":
            try:
                import google.auth.transport.requests
                import google.oauth2.id_token

                auth_req = google.auth.transport.requests.Request()
                token = google.oauth2.id_token.fetch_id_token(auth_req, backend_url)
                headers["Authorization"] = f"Bearer {token}"
                logger.info(f"[{service_name}] Generated IAM token for backend callback")
            except Exception as e:
                logger.error(
                    f"[{service_name}] CRITICAL: Failed to generate IAM token for "
                    f"backend callback. The execution-complete request will be "
                    f"rejected by the backend. Error: {e}",
                    exc_info=True,
                )
                # Fallback: use API key in Authorization header if available
                if api_key:
                    headers["Authorization"] = f"Api-Key {api_key}"
                    logger.warning(
                        f"[{service_name}] Using API key fallback in Authorization header"
                    )
        else:
            if api_key:
                headers["Authorization"] = f"Api-Key {api_key}"
                logger.info(f"[{service_name}] Using API key for {environment} environment")

        return headers

    # Failure-path callback budget. For terminal-failure runs we don't stream
    # large payloads back to the backend — the callback is advisory only (so
    # Django can mark the build failed in the dashboard). Use a tight timeout
    # and a single attempt so the session lock releases quickly even when
    # Django is unreachable.
    FAILURE_REQUEST_TIMEOUT: float = 15.0
    FAILURE_MAX_RETRIES: int = 0

    async def _send_with_retry(
        self,
        ctx: InvocationContext,
        backend_url: str,
        app_uuid: str,
        callback_data: dict,
        service_name: str,
        *,
        timeout: float | None = None,
        max_retries: int | None = None,
    ) -> bool:
        """POST callback_data to Django with exponential-backoff retry.

        A fresh auth token is generated on each attempt so that transient
        metadata-server failures or near-expiry tokens don't doom every retry.

        Callers may override ``timeout`` and ``max_retries`` per-call (used to
        apply a tighter budget on terminal-failure runs where the callback is
        advisory only).

        Returns True on success, False if all retries are exhausted.
        """
        effective_timeout = timeout if timeout is not None else self.REQUEST_TIMEOUT
        effective_retries = max_retries if max_retries is not None else self.MAX_RETRIES

        logger.info(f"[{service_name}] Backend URL: {backend_url}")

        pages_to_add = ctx.session.state.get("pages_to_add")
        pages_to_update = ctx.session.state.get("pages_to_update")
        pages_to_delete = ctx.session.state.get("pages_to_delete")
        logger.debug(
            f"[{service_name}] Sending to backend - "
            f"pages_to_add={pages_to_add}, pages_to_update={pages_to_update}, "
            f"pages_to_delete={pages_to_delete}"
        )

        async with httpx.AsyncClient(timeout=effective_timeout) as client:
            for attempt in range(effective_retries + 1):
                headers = self._get_auth_headers(backend_url, service_name)
                if not headers.get("Authorization"):
                    logger.error(
                        f"[{service_name}] No Authorization header available — "
                        f"backend will reject the request (attempt "
                        f"{attempt + 1}/{effective_retries + 1})"
                    )

                try:
                    response = await client.post(
                        f"{backend_url}/api/agent/apps/{app_uuid}/execution-complete/",
                        json=callback_data,
                        headers=headers,
                    )
                    response.raise_for_status()

                    response_data = response.json()
                    logger.info(f"[{service_name}] Backend response: {response_data}")
                    logger.info(
                        f"[{service_name}] Successfully notified backend of completion "
                        f"for session {ctx.session.id}"
                    )
                    return True

                except (httpx.HTTPStatusError, httpx.ConnectError, httpx.TimeoutException) as e:
                    if attempt < effective_retries:
                        delay = self.BASE_DELAY * (2**attempt)
                        logger.warning(
                            f"[{service_name}] Backend notification attempt "
                            f"{attempt + 1}/{effective_retries + 1} failed: {e}. "
                            f"Retrying in {delay:.1f}s..."
                        )
                        await asyncio.sleep(delay)
                    else:
                        logger.error(
                            f"[{service_name}] Backend notification failed after "
                            f"{effective_retries + 1} attempts: {e}",
                            exc_info=True,
                        )

        # All retries exhausted
        return False
