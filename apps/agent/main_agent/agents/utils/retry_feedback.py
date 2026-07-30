"""Compose targeted retry feedback for ComponentBuilder save failures.

Pre-Pattern-A, the save-tool failure response was:

    "Semantic errors — fix and retry:\n  1. addEventListener bypasses..."
    "WARNING: This is attempt 2/3 — take a DIFFERENT approach."

The model regenerated from scratch and re-emitted the same antipattern
because the warning was generic ("different approach") and the
auto-fixed TSX (the closest thing to a working baseline) was thrown
away. This module replaces the generic warning with:

1. **Per-error guidance** sourced from
   :mod:`services.validation.forbidden_api_registry` — each error
   category gets a concrete pattern to use instead. Looking up by
   ``api_id`` (not substring matching the error text) means error
   messages can be edited without breaking the dispatch.

2. **History callouts** when the same category fired in a prior
   attempt — surfaces "you keep doing this" instead of re-sending the
   same generic warning.

3. **Auto-fixed TSX as anchor** — the next ComponentBuilder turn sees
   the post-auto-fix output as a reference baseline. The model can
   edit it surgically (preserving the 26 fixes the auto-fixer just
   applied) instead of regenerating from scratch.

The composed string is appended to the ``error`` field of the
``{success: False, error: ...}`` save-tool response. ADK passes the
error verbatim back to the LLM as the tool result.
"""

from __future__ import annotations

from main_agent.agents.orchestrator.app_types.webapp.services import (
    retry_context_service as rcs,
)
from main_agent.services.validation import forbidden_api_registry as registry

# Cap on the auto-fixed TSX reference we send back. ComponentBuilder's
# context is large but not unbounded; truncate at a generous boundary
# so the failure response stays under typical 8KB per-tool-message
# limits. The model gets enough to use as anchor; if the source is
# bigger we send a head + tail with an ellipsis marker.
_MAX_TSX_REFERENCE_CHARS = 5000


def build_retry_feedback(
    *,
    state,
    component_name: str,
    current_errors: list[str],
    auto_fixed_tsx: str,
    fail_count: int,
    max_retries: int,
) -> str:
    """Compose the retry-feedback addendum appended to the failure error.

    Records the current attempt in the :class:`RetryContext` first so
    the history callouts reflect this attempt too, then composes:

    - Per-error guidance (Pattern E ``retry_guidance``)
    - History callouts (categories that recur ≥2 attempts)
    - Anchor TSX (``<previous_attempt_after_auto_fix>``)

    Returns the full addendum as a string. Empty if nothing actionable
    was found (rare — most errors map to a registered api_id).
    """
    error_categories = rcs.categorize_errors_by_api_id(current_errors)

    parts: list[str] = []

    guidance = _format_per_error_guidance(error_categories)
    if guidance:
        parts.append(guidance)

    history = _format_history_callouts(state, component_name, error_categories)
    if history:
        parts.append(history)

    anchor = _format_anchor(auto_fixed_tsx)
    if anchor:
        parts.append(anchor)

    if fail_count > 1:
        parts.append(
            f"This is attempt {fail_count}/{max_retries}. The errors above "
            "have a specific fix pattern — apply it directly. Do not "
            "regenerate the whole component if a small surgical edit on "
            "the previous_attempt_after_auto_fix block resolves the issue."
        )

    return "\n\n".join(parts)


def _format_per_error_guidance(
    error_categories: dict[str, list[str]],
) -> str:
    """One bullet per error category, with the registry's retry_guidance."""
    lines: list[str] = []
    for api_id, errors in error_categories.items():
        if api_id == "unknown":
            continue
        entry = registry.get(api_id)
        if entry is None or not entry.retry_guidance:
            continue
        count_suffix = f" (×{len(errors)})" if len(errors) > 1 else ""
        lines.append(f"### Fix pattern for `{api_id}`{count_suffix}\n{entry.retry_guidance}")
    if not lines:
        return ""
    return "## Targeted fix guidance\n\n" + "\n\n".join(lines)


def _format_history_callouts(
    state,
    component_name: str,
    current_categories: dict[str, list[str]],
) -> str:
    """Highlight error categories that ALSO appeared on a prior attempt.

    Reads the recorded :class:`RetryContext` (populated by save-tool
    before this builder runs). If a category recurs, the LLM is more
    likely to have ignored the guidance — flag it explicitly so the
    next attempt understands "you keep doing this" rather than just
    seeing a fresh-looking error each time.
    """
    history = rcs.get_retry_context(state, component_name)
    if len(history.attempts) <= 1:
        return ""
    # Look at all PRIOR attempts (last entry is the just-recorded one).
    prior = history.attempts[:-1]
    recurring = []
    for api_id in current_categories:
        if api_id == "unknown":
            continue
        prior_count = sum(1 for a in prior if api_id in (a.errors_categorized or {}))
        if prior_count >= 1:
            recurring.append((api_id, prior_count + 1))
    if not recurring:
        return ""
    lines = [
        f"- `{api_id}` has now failed validation **{n} times** in a row" for api_id, n in recurring
    ]
    return "## Repeated antipatterns — apply the fix pattern above\n\n" + "\n".join(lines)


def _format_anchor(auto_fixed_tsx: str) -> str:
    """Wrap the auto-fixed TSX in a clearly-tagged reference block.

    The XML-style tag boundary makes it easy for the model to spot the
    section visually and easy for any downstream prompt-debugging to
    extract it. Truncates at a generous limit if the TSX is enormous.
    """
    if not auto_fixed_tsx:
        return ""
    tsx = auto_fixed_tsx
    if len(tsx) > _MAX_TSX_REFERENCE_CHARS:
        head = tsx[: _MAX_TSX_REFERENCE_CHARS // 2]
        tail = tsx[-_MAX_TSX_REFERENCE_CHARS // 2 :]
        tsx = (
            f"{head}\n\n[... {len(auto_fixed_tsx) - _MAX_TSX_REFERENCE_CHARS}"
            f" chars truncated ...]\n\n{tail}"
        )
    return (
        "## Previous attempt (after deterministic auto-fixes)\n\n"
        "Use this as your starting point. Make the MINIMUM edit needed "
        "to resolve the errors above. Do NOT re-introduce patterns the "
        "validator silently corrected — they will fail again next attempt.\n\n"
        f"<previous_attempt_after_auto_fix>\n{tsx}\n</previous_attempt_after_auto_fix>"
    )
