"""Per-component retry context shared across save-tool attempts.

The Onix Studio failure showed that the platform was throwing away its
own work between retries:

    attempt 1: ComponentBuilder generates TSX_v1
       ↓ auto-fixer applies 26 fixes → TSX_v1_FIXED
       ↓ validator finds 1 residual error
       ↓ save_component_artifact returns {"success": False, "error": "..."}
       ← TSX_v1_FIXED is discarded; only the error string survives
    attempt 2: ComponentBuilder regenerates from SCRATCH
       ← re-emits the 26 antipatterns the auto-fixer already corrected

This module is the shared state where each save attempt records its
auto-fixed TSX + the errors that survived + the categorised fixes that
were applied. Pattern A's :func:`build_retry_feedback` reads from here
to compose a failure response that includes the auto-fixed TSX as an
anchor for the next attempt — so ComponentBuilder regenerate is no
longer flying blind.

Stored under ``StateKeys.COMPONENT_RETRY_CONTEXT`` as a dict keyed by
component name. Cleared on success or terminal failure.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

from main_agent.constants import StateKeys

AttemptStatus = Literal[
    "success",
    "syntax_fail",
    "semantic_fail",
    "coverage_fail",
    "terminal",
]


@dataclass
class Attempt:
    """One save-tool attempt's record.

    Stored as a plain dict in session state (ADK's State wrapper requires
    JSON-serialisable values). The :func:`record_attempt` helper handles
    the conversion.
    """

    attempt_number: int
    auto_fixes_categorized: dict[str, int] = field(default_factory=dict)
    errors_categorized: dict[str, list[str]] = field(default_factory=dict)
    error_summaries: list[str] = field(default_factory=list)
    final_status: AttemptStatus = "semantic_fail"


@dataclass
class RetryContext:
    """All recorded attempts for one component plus the most recent
    auto-fixed TSX.

    The TSX field is the missing baseline — pre-fix, the auto-fixed
    output existed only as a Python local in the save tool and died
    when the function returned. Storing it here lets Pattern A surface
    it to the next ComponentBuilder turn.
    """

    component_name: str
    attempts: list[Attempt] = field(default_factory=list)
    last_auto_fixed_tsx: str | None = None


# ──────────────────────────────────────────────────────────────────────
# State I/O
# ──────────────────────────────────────────────────────────────────────


def _key(state: Any) -> str:
    """Single source of truth for the state key — kept in sync with
    :data:`StateKeys.COMPONENT_RETRY_CONTEXT`. Accepting ``state`` keeps
    the API symmetric with ``get_retry_context`` even though the key
    itself is constant.
    """
    del state
    return StateKeys.COMPONENT_RETRY_CONTEXT


def get_retry_context(state: Any, component_name: str) -> RetryContext:
    """Return the recorded :class:`RetryContext` for ``component_name``.

    Returns a fresh empty context if no record exists yet. The caller
    receives a read-only snapshot — to mutate, call
    :func:`record_attempt`.
    """
    raw = state.get(_key(state), {}) or {}
    record = raw.get(component_name)
    if record is None:
        return RetryContext(component_name=component_name)
    attempts = [Attempt(**a) for a in record.get("attempts", [])]
    return RetryContext(
        component_name=component_name,
        attempts=attempts,
        last_auto_fixed_tsx=record.get("last_auto_fixed_tsx"),
    )


def record_attempt(
    state: Any,
    component_name: str,
    *,
    auto_fixed_tsx: str,
    auto_fixes_categorized: dict[str, int],
    errors_categorized: dict[str, list[str]],
    error_summaries: list[str],
    final_status: AttemptStatus,
) -> RetryContext:
    """Append one attempt to the component's history.

    The ``auto_fixed_tsx`` is the post-auto-fix TSX the validator ran
    against — this is what the next attempt should anchor on, NOT the
    raw model output (which would re-introduce auto-fixed antipatterns).
    """
    bag = dict(state.get(_key(state), {}) or {})
    record = dict(bag.get(component_name, {}))
    attempts = list(record.get("attempts", []))
    attempts.append(
        asdict(
            Attempt(
                attempt_number=len(attempts) + 1,
                auto_fixes_categorized=dict(auto_fixes_categorized),
                errors_categorized={cat: list(errs) for cat, errs in errors_categorized.items()},
                error_summaries=list(error_summaries),
                final_status=final_status,
            )
        )
    )
    record["attempts"] = attempts
    record["last_auto_fixed_tsx"] = auto_fixed_tsx
    bag[component_name] = record
    state[_key(state)] = bag

    return get_retry_context(state, component_name)


def clear_retry_context(state: Any, component_name: str) -> None:
    """Drop the record for ``component_name`` (success or terminal)."""
    bag = dict(state.get(_key(state), {}) or {})
    if component_name in bag:
        del bag[component_name]
        state[_key(state)] = bag


# ──────────────────────────────────────────────────────────────────────
# Categorisation — maps free-form fix descriptions and error strings
# into stable category keys consumed by :func:`build_retry_feedback`.
# ──────────────────────────────────────────────────────────────────────


def categorize_fix(fix_description: str) -> str:
    """Return a stable category key for an auto-fix description.

    Pattern matching is keyed off the prefix the fixer modules emit so
    each category survives unrelated wording changes elsewhere in the
    fix string.

    The dispatcher (``services/validation/fixers/dispatcher.py``) prefixes
    every fix message with ``[<fixer>] `` for log bisection. Strip that
    wrapper before matching so the category prefixes (``Clamped text-[``,
    ``Stripped console.``, etc.) still resolve.
    """
    s = fix_description
    if s.startswith("[") and "] " in s:
        # Drop the ``[<fixer>] `` wrapper so the underlying message's
        # well-known prefix is what we match on.
        s = s.split("] ", 1)[1]
    s = s.lower()
    if s.startswith("clamped text-["):
        return "tiny_font_clamp"
    if s.startswith("stripped console."):
        return "console_strip"
    if s.startswith("rewrote forbidden window.location"):
        return "window_location_to_navigate"
    if s.startswith("unwrapped cn("):
        return "cn_unwrap"
    if s.startswith("capped hover:bg-"):
        return "hover_overlay_clamp"
    if s.startswith("animation: rewrote"):
        return "animation_duration_rewrite"
    if s.startswith("contrast: rewrote"):
        return "low_contrast_promote"
    if s.startswith("heading order:"):
        return "heading_order"
    if s.startswith("added missing sdk imports"):
        return "missing_sdk_import"
    if s.startswith("rewrote react imports"):
        return "react_import_rewrite"
    if "optional chaining" in s:
        return "null_safety_inject"
    return "other"


# Mapping from substring matches in error messages to the
# forbidden_api_registry api_id for retry guidance lookup. Keep in
# sync with the error_message values in
# ``services/validation/forbidden_api_registry.py``.
_ERROR_TO_API_ID: tuple[tuple[str, str], ...] = (
    ("addEventListener", "addEventListener"),
    ("console.log", "console_log"),
    ("Direct document access", "dom_access"),
    ("fetch() forbidden", "fetch"),
    ("cn() forbidden", "cn"),
    ("eval() is forbidden", "call:eval"),
    ("new Function()", "new:Function"),
    ("XMLHttpRequest", "new:XMLHttpRequest"),
    ("localStorage", "ident:localStorage"),
    ("sessionStorage", "ident:sessionStorage"),
    ("window.location mutation", "window_location"),
    ("innerHTML forbidden", "innerhtml"),
)


def categorize_error(error_message: str) -> str | None:
    """Return the forbidden_api_registry api_id matching this error
    string, or None if no rule maps to it.

    Used by :func:`build_retry_feedback` to look up the targeted
    ``retry_guidance`` for each error.
    """
    for needle, api_id in _ERROR_TO_API_ID:
        if needle in error_message:
            return api_id
    return None


def categorize_errors_by_api_id(errors: list[str]) -> dict[str, list[str]]:
    """Group ``errors`` by registry api_id (or ``"unknown"`` for misses)."""
    grouped: dict[str, list[str]] = {}
    for err in errors:
        key = categorize_error(err) or "unknown"
        grouped.setdefault(key, []).append(err)
    return grouped


def categorize_fixes(fixes: list[str]) -> dict[str, int]:
    """Count fix descriptions by category for compact retry feedback."""
    counts: dict[str, int] = {}
    for fix in fixes:
        counts[categorize_fix(fix)] = counts.get(categorize_fix(fix), 0) + 1
    return counts
