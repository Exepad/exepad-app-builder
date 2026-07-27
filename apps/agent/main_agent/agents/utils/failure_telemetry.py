"""Structured outcome events for production analytics.

Per-session debug artifacts (``agent_errors.json``) are uploaded to GCS
today but nothing aggregates them — the same antipattern can fail 1000
production runs with no platform-team visibility. This emitter writes
one stable JSON line per workflow terminal so Cloud Logging can sink
it into BigQuery for weekly aggregation.

Schema is **non-PII by construction**: only category keys, counts, and
control-plane identifiers. Never includes raw TSX, raw user prompts,
or raw error message strings — the rule registry's ``api_id`` is the
canonical category for forbidden-API failures, and other failure
classes have their own enumerated names.

Consumers (BigQuery view + weekly digest) live in
``apps/agent/sql/agent_outcomes_weekly.sql``. The Cloud Logging →
BigQuery sink is provisioned manually (see
``apps/agent/docs/latest/telemetry.md``).
"""

from __future__ import annotations

from typing import Any, Literal

import structlog

import config

logger = structlog.get_logger(__name__)

# Stable structlog event key. Cloud Logging filters on this when
# routing to the BigQuery sink. Don't rename without coordinating
# with the sink config.
EVENT_KEY = "agent_outcome"

Outcome = Literal["success", "partial_ship", "abort"]
Workflow = Literal["creation", "editing"]


def emit_outcome(
    *,
    session_id: str,
    workflow: Workflow,
    outcome: Outcome,
    component_count: int = 0,
    fatal_failures: list[str] | None = None,
    recoverable_failures: list[str] | None = None,
    failure_classes: dict[str, str] | None = None,
    error_categories: dict[str, int] | None = None,
    auto_fix_categories: dict[str, int] | None = None,
    cost_usd: float | None = None,
    duration_seconds: float | None = None,
) -> None:
    """Log one ``agent_outcome`` event line.

    No-op when ``ENABLE_FAILURE_TELEMETRY`` is False — keeps the call
    sites unconditional and lets ops disable telemetry without code
    changes.

    Args:
        session_id: ADK session ID. Used for correlating multiple
            outcomes from the same session if e.g. partial-ship is
            followed by a regenerate-failed-component edit.
        workflow: Which workflow terminated.
        outcome: ``success`` (clean), ``partial_ship`` (some components
            shipped as placeholders), or ``abort`` (build aborted).
        component_count: Total components ComponentBuilder attempted.
        fatal_failures: Component names that failed with a fatal class.
        recoverable_failures: Component names that shipped as placeholders.
        failure_classes: Per-component failure class (``jsx_syntax_error``,
            ``validation_failed``, etc.) — enumerated, never raw text.
        error_categories: Counts of ``forbidden_api_registry`` api_id
            occurrences across the session. Aggregates Pattern A's
            per-attempt categorisation.
        auto_fix_categories: Counts of categorised auto-fixes applied
            (``tiny_font_clamp``, ``console_strip``, etc.).
        cost_usd: Total session cost in USD if tracked.
        duration_seconds: Total workflow duration.

    Returns:
        None. Side effect: one structlog line at INFO level with
        ``event=agent_outcome``.
    """
    if not config.ENABLE_FAILURE_TELEMETRY:
        return

    # Filter None values so the BigQuery schema stays compact —
    # missing keys are easier to evolve than always-null columns.
    payload: dict[str, Any] = {
        "session_id": session_id,
        "workflow": workflow,
        "outcome": outcome,
        "component_count": component_count,
    }
    if fatal_failures:
        payload["fatal_failures"] = list(fatal_failures)
    if recoverable_failures:
        payload["recoverable_failures"] = list(recoverable_failures)
    if failure_classes:
        payload["failure_classes"] = dict(failure_classes)
    if error_categories:
        payload["error_categories"] = dict(error_categories)
    if auto_fix_categories:
        payload["auto_fix_categories"] = dict(auto_fix_categories)
    if cost_usd is not None:
        payload["cost_usd"] = float(cost_usd)
    if duration_seconds is not None:
        payload["duration_seconds"] = float(duration_seconds)

    # ``event`` is the stable structlog key; Cloud Logging routes on
    # this. structlog renders the rest as labelled fields automatically.
    logger.info(EVENT_KEY, **payload)
