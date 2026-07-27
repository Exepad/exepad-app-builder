"""Tests for ``main_agent/agents/utils/retry_feedback.py``.

The Onix Studio failure showed that the prior retry message was
generic ("take a different approach") and the model couldn't act on
it. :func:`build_retry_feedback` replaces that with:

- Per-error guidance from the forbidden_api_registry (Pattern E).
- History callouts when a category recurs.
- The auto-fixed TSX as anchor for surgical edit.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services import (
    retry_context_service as rcs,
)
from main_agent.agents.utils.retry_feedback import build_retry_feedback

pytestmark = [pytest.mark.unit]


def _state() -> dict:
    return {}


def _record_prior_attempt(state: dict, *, errors: list[str], tsx: str = "// prior") -> None:
    """Helper: simulate a prior save attempt landing in retry context.

    The save tool calls record_attempt BEFORE build_retry_feedback in
    the actual flow, so tests should populate the history first to
    match the runtime ordering.
    """
    rcs.record_attempt(
        state,
        "HomeContent",
        auto_fixed_tsx=tsx,
        auto_fixes_categorized={},
        errors_categorized=rcs.categorize_errors_by_api_id(errors),
        error_summaries=errors,
        final_status="semantic_fail",
    )


# ──────────────────────────────────────────────────────────────────────
# Per-error guidance — sourced from forbidden_api_registry (Pattern E)
# ──────────────────────────────────────────────────────────────────────


def test_addEventListener_error_includes_useEffect_pattern():
    """REGRESSION: Onix Studio. Pre-fix the LLM got generic "take a
    different approach" — no actionable pattern. Now the addendum
    includes the registry's retry_guidance with useRef + useEffect.
    """
    state = _state()
    errors = ["addEventListener() bypasses React's event system — use React synthetic events"]
    _record_prior_attempt(state, errors=errors)

    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=errors,
        auto_fixed_tsx="export default function H() { return null; }",
        fail_count=1,
        max_retries=3,
    )
    assert "Targeted fix guidance" in addendum
    assert "addEventListener" in addendum
    assert "useEffect" in addendum
    assert "useRef" in addendum or "ref.current" in addendum
    assert "removeEventListener" in addendum  # cleanup


def test_console_log_error_includes_registry_guidance():
    state = _state()
    errors = ["console.log() is forbidden — remove debug logging"]
    _record_prior_attempt(state, errors=errors)

    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=errors,
        auto_fixed_tsx="// x",
        fail_count=1,
        max_retries=3,
    )
    assert "console.log" in addendum.lower() or "console_log" in addendum
    # Registry guidance text mentions all 5 console methods.
    assert "console.log/warn/error/info/debug" in addendum


def test_unknown_errors_skip_guidance_block_quietly():
    """An error that doesn't map to any registered api_id shouldn't
    fail the builder — it just gets no targeted guidance."""
    state = _state()
    errors = ["Some new error class that has no registered guidance yet"]
    _record_prior_attempt(state, errors=errors)

    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=errors,
        auto_fixed_tsx="// x",
        fail_count=1,
        max_retries=3,
    )
    # No "Targeted fix guidance" header when nothing matched.
    assert "Targeted fix guidance" not in addendum
    # But the anchor block should still be present.
    assert "previous_attempt_after_auto_fix" in addendum


# ──────────────────────────────────────────────────────────────────────
# History callouts — recurrence detection
# ──────────────────────────────────────────────────────────────────────


def test_no_history_callout_on_first_attempt():
    """First attempt has no history yet — only the just-recorded entry."""
    state = _state()
    errors = ["addEventListener bypasses React's event system"]
    _record_prior_attempt(state, errors=errors)  # this is the only attempt

    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=errors,
        auto_fixed_tsx="// x",
        fail_count=1,
        max_retries=3,
    )
    assert "Repeated antipatterns" not in addendum


def test_history_callout_when_category_recurs():
    """When the same error category appears in attempt 1 AND attempt 2,
    flag it explicitly so the LLM understands it's been ignored before.
    """
    state = _state()
    errors = ["addEventListener bypasses React's event system"]
    # Two attempts with the same error category.
    _record_prior_attempt(state, errors=errors)
    _record_prior_attempt(state, errors=errors)

    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=errors,
        auto_fixed_tsx="// x",
        fail_count=2,
        max_retries=3,
    )
    assert "Repeated antipatterns" in addendum
    assert "addEventListener" in addendum
    assert "2 times" in addendum


# ──────────────────────────────────────────────────────────────────────
# Anchor — the missing baseline
# ──────────────────────────────────────────────────────────────────────


def test_anchor_block_includes_auto_fixed_tsx():
    state = _state()
    tsx = "export default function H() { return <div>foo</div>; }"
    _record_prior_attempt(state, errors=["addEventListener bypasses React's event system"])

    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=["addEventListener bypasses React's event system"],
        auto_fixed_tsx=tsx,
        fail_count=1,
        max_retries=3,
    )
    assert "<previous_attempt_after_auto_fix>" in addendum
    assert tsx in addendum
    assert "</previous_attempt_after_auto_fix>" in addendum


def test_anchor_block_truncates_oversized_tsx():
    state = _state()
    huge = "x" * 20_000
    _record_prior_attempt(state, errors=["console.log() is forbidden"])

    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=["console.log() is forbidden"],
        auto_fixed_tsx=huge,
        fail_count=1,
        max_retries=3,
    )
    # Should NOT include the entire 20K — must be capped.
    assert addendum.count("x") < 20_000
    assert "truncated" in addendum


def test_anchor_block_omitted_when_tsx_empty():
    state = _state()
    _record_prior_attempt(state, errors=["console.log() is forbidden"])

    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=["console.log() is forbidden"],
        auto_fixed_tsx="",
        fail_count=1,
        max_retries=3,
    )
    assert "previous_attempt_after_auto_fix" not in addendum


# ──────────────────────────────────────────────────────────────────────
# Attempt-counter messaging
# ──────────────────────────────────────────────────────────────────────


def test_first_attempt_skips_attempt_counter_phrase():
    state = _state()
    _record_prior_attempt(state, errors=["addEventListener bypasses React's event system"])
    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=["addEventListener bypasses React's event system"],
        auto_fixed_tsx="// x",
        fail_count=1,
        max_retries=3,
    )
    assert "attempt 1/3" not in addendum


def test_retry_attempt_includes_attempt_counter_phrase():
    state = _state()
    _record_prior_attempt(state, errors=["addEventListener bypasses React's event system"])
    _record_prior_attempt(state, errors=["addEventListener bypasses React's event system"])
    addendum = build_retry_feedback(
        state=state,
        component_name="HomeContent",
        current_errors=["addEventListener bypasses React's event system"],
        auto_fixed_tsx="// x",
        fail_count=2,
        max_retries=3,
    )
    assert "attempt 2/3" in addendum
    # Critically, NOT the old generic "take a DIFFERENT approach" string.
    assert "DIFFERENT approach" not in addendum
