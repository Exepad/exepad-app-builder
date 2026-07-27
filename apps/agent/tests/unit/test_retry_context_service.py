"""Tests for the per-component retry-context state service.

Pre-Pattern-A, the auto-fixed TSX and categorised errors from a failed
save attempt died as Python locals when the tool function returned.
:func:`record_attempt` is the bridge — it persists those values into
session state so the next ComponentBuilder turn can anchor on them.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services import (
    retry_context_service as rcs,
)

pytestmark = [pytest.mark.unit]


# Minimal session-state stand-in. ADK's State wrapper is dict-like with
# __getitem__/__setitem__/get; a plain dict is enough for the recorder
# under test.
def _state() -> dict:
    return {}


# ──────────────────────────────────────────────────────────────────────
# record_attempt + get_retry_context
# ──────────────────────────────────────────────────────────────────────


def test_get_retry_context_returns_empty_when_no_record():
    state = _state()
    ctx = rcs.get_retry_context(state, "HomeContent")
    assert ctx.component_name == "HomeContent"
    assert ctx.attempts == []
    assert ctx.last_auto_fixed_tsx is None


def test_record_attempt_appends_history():
    state = _state()
    rcs.record_attempt(
        state,
        "HomeContent",
        auto_fixed_tsx="export default function H() { return null; }",
        auto_fixes_categorized={"tiny_font_clamp": 5},
        errors_categorized={"addEventListener": ["addEventListener forbidden..."]},
        error_summaries=["addEventListener forbidden..."],
        final_status="semantic_fail",
    )
    ctx = rcs.get_retry_context(state, "HomeContent")
    assert len(ctx.attempts) == 1
    assert ctx.attempts[0].attempt_number == 1
    assert ctx.attempts[0].auto_fixes_categorized == {"tiny_font_clamp": 5}
    assert "addEventListener" in ctx.attempts[0].errors_categorized
    assert ctx.last_auto_fixed_tsx is not None


def test_record_attempt_increments_attempt_number():
    state = _state()
    for i in range(3):
        rcs.record_attempt(
            state,
            "HomeContent",
            auto_fixed_tsx=f"// attempt {i}",
            auto_fixes_categorized={},
            errors_categorized={},
            error_summaries=[],
            final_status="semantic_fail",
        )
    ctx = rcs.get_retry_context(state, "HomeContent")
    assert [a.attempt_number for a in ctx.attempts] == [1, 2, 3]


def test_record_attempt_keeps_components_isolated():
    state = _state()
    rcs.record_attempt(
        state,
        "HomeContent",
        auto_fixed_tsx="// home",
        auto_fixes_categorized={},
        errors_categorized={},
        error_summaries=[],
        final_status="semantic_fail",
    )
    rcs.record_attempt(
        state,
        "MainFooter",
        auto_fixed_tsx="// footer",
        auto_fixes_categorized={},
        errors_categorized={},
        error_summaries=[],
        final_status="semantic_fail",
    )
    home = rcs.get_retry_context(state, "HomeContent")
    footer = rcs.get_retry_context(state, "MainFooter")
    assert home.last_auto_fixed_tsx == "// home"
    assert footer.last_auto_fixed_tsx == "// footer"


def test_clear_retry_context_drops_history():
    state = _state()
    rcs.record_attempt(
        state,
        "HomeContent",
        auto_fixed_tsx="// x",
        auto_fixes_categorized={},
        errors_categorized={},
        error_summaries=[],
        final_status="semantic_fail",
    )
    rcs.clear_retry_context(state, "HomeContent")
    ctx = rcs.get_retry_context(state, "HomeContent")
    assert ctx.attempts == []


# ──────────────────────────────────────────────────────────────────────
# categorize_error / categorize_errors_by_api_id
# ──────────────────────────────────────────────────────────────────────


def test_categorize_error_matches_addEventListener():
    err = (
        "addEventListener() bypasses React's event system — use React "
        "synthetic events (onClick, onChange, onScroll) or useEffect with refs"
    )
    assert rcs.categorize_error(err) == "addEventListener"


def test_categorize_error_matches_console_log():
    assert (
        rcs.categorize_error("console.log() is forbidden — remove debug logging") == "console_log"
    )


def test_categorize_error_matches_window_location():
    assert (
        rcs.categorize_error("window.location mutation forbidden — use navigate()")
        == "window_location"
    )


def test_categorize_error_returns_none_for_unrelated():
    assert rcs.categorize_error("ExepadImage missing keywords prop") is None


def test_categorize_errors_by_api_id_groups_correctly():
    grouped = rcs.categorize_errors_by_api_id(
        [
            "addEventListener bypasses React's event system",
            "console.log() is forbidden",
            "ExepadImage missing keywords",  # → "unknown"
        ]
    )
    assert "addEventListener" in grouped
    assert "console_log" in grouped
    assert "unknown" in grouped
    assert len(grouped["unknown"]) == 1


# ──────────────────────────────────────────────────────────────────────
# categorize_fix / categorize_fixes
# ──────────────────────────────────────────────────────────────────────


def test_categorize_fix_recognises_tiny_font_clamp():
    assert (
        rcs.categorize_fix("Clamped text-[10px] → text-[11px] (accessibility)") == "tiny_font_clamp"
    )


def test_categorize_fix_recognises_console_strip():
    assert rcs.categorize_fix("Stripped console.log() calls") == "console_strip"


def test_categorize_fix_recognises_window_location_rewrite():
    assert (
        rcs.categorize_fix("Rewrote forbidden window.location assignment → navigate('/')")
        == "window_location_to_navigate"
    )


def test_categorize_fix_falls_back_to_other():
    assert rcs.categorize_fix("Some new fix that doesn't match yet") == "other"


def test_categorize_fix_strips_dispatcher_prefix():
    """Dispatcher tags every fix with ``[<fixer>] `` for log bisection.
    The categorizer must strip that wrapper so the underlying category
    prefix still matches. Regression for the per-fixer-rollback wiring.
    """
    assert (
        rcs.categorize_fix("[polishing] Clamped text-[10px] → text-[11px]")
        == "tiny_font_clamp"
    )
    assert (
        rcs.categorize_fix("[forbidden_apis] Stripped console.log() calls")
        == "console_strip"
    )
    assert (
        rcs.categorize_fix(
            "[forbidden_apis] Rewrote forbidden window.location assignment → navigate('/')"
        )
        == "window_location_to_navigate"
    )
    # Bracket in the middle (not a dispatcher prefix) shouldn't be stripped.
    assert (
        rcs.categorize_fix("Clamped text-[10px] → text-[11px]")
        == "tiny_font_clamp"
    ), "Unprefixed messages must still categorize correctly"


def test_categorize_fixes_counts_by_category():
    counts = rcs.categorize_fixes(
        [
            "Clamped text-[10px] → text-[11px] (accessibility)",
            "Clamped text-[9px] → text-[11px] (accessibility)",
            "Stripped console.log() calls",
        ]
    )
    assert counts.get("tiny_font_clamp") == 2
    assert counts.get("console_strip") == 1
