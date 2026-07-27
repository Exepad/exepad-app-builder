"""Tests for the auto-fix dispatcher orchestration.

Per-fixer behaviour is covered by the manifest-driven tests under
``fixtures/<module>/``. This file pins the wiring between fixers — fix
ordering, idempotence across the WHOLE pipeline, and the source-html
gate that keeps translation-parity rules quiet on scratch creations.

The dispatcher entry point is
``main_agent.services.validation.fixers.apply_auto_fixes`` (see
[`dispatcher.py`](../../../main_agent/services/validation/fixers/dispatcher.py)).
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers import apply_auto_fixes

pytestmark = [pytest.mark.unit]


# Single TSX that exercises 4+ branches across multiple fixers in one pass:
#   component_imports — react import → @exepad/sdk
#   component_urls_images — hallucinated unsplash URL, bare-slug navigate()
#   component_a11y_ux — title-case status keys lowercased
#   component_forbidden_apis — console.log strip (paren-balanced scanner)
#   component_null_safety — useApp destructure → ?.
_MULTI_BRANCH_TSX = """\
import React from "react";
import { useApp, useNavigate, Icons } from "@exepad/sdk";

const STATUS_LABELS = {
  Paid: "Payment received",
  Pending: "Awaiting capture",
  Sent: "Already sent",
};

export default function OrderRow() {
  console.log("OrderRow render");
  const { profile } = useApp();
  const navigate = useNavigate();
  return (
    <div>
      <span className="bg-primary text-on-primary">{STATUS_LABELS[profile.status]}</span>
      <button onClick={() => navigate("about")}>About</button>
      <img src="https://images.unsplash.com/photo-12345" alt="hero banner image" />
    </div>
  );
}
"""


_FIXTURE_CONTEXT = dict(
    models=[],
    actions={},
    state_keys={"profile": None},
    expected_component_name="OrderRow",
    handlers=None,
    page_slugs=["/", "/about"],
    theme_palette=None,
)


def _run() -> tuple[str, list[str]]:
    return apply_auto_fixes(_MULTI_BRANCH_TSX, **_FIXTURE_CONTEXT)


def test_dispatcher_runs_all_relevant_fixers_in_one_pass():
    """A single ``apply_auto_fixes`` call activates every fixer whose
    branch is exercised in the input. We assert each fixer's signature
    fix message appears, proving the dispatcher wires them in.
    """
    fixed, fixes = _run()
    fixes_str = "\n".join(fixes)

    # component_imports: react → @exepad/sdk
    assert "Rewrote react imports → @exepad/sdk" in fixes_str
    # component_urls_images: hallucinated img URL + bare-slug navigate
    assert "hallucinated" in fixes_str.lower() or "unsplash" in fixes_str
    assert "Prepended leading '/' to navigate() arg" in fixes_str
    # component_a11y_ux: title-case status keys
    assert "Lowercased status map keys" in fixes_str
    # component_forbidden_apis: console.log strip (moved here from polishing
    # so the paren-balanced scanner can catch inline calls and the four
    # non-``log`` console methods that the previous regex missed)
    assert "Stripped console.log() calls" in fixes_str
    # component_null_safety: useApp destructure rewrite (delegated to
    # component_imports which calls rewrite_useapp_destructures), then
    # the null-safety fixer adds optional chaining.
    assert "Added optional chaining to" in fixes_str

    # Output sanity — each branch's expected string is in the result.
    assert "from '@exepad/sdk'" in fixed
    assert 'navigate("/about")' in fixed
    assert "paid:" in fixed and "Paid:" not in fixed
    assert "console.log(" not in fixed


def test_dispatcher_is_idempotent_across_full_pipeline():
    """Running the dispatcher twice on the same input must produce the
    same TSX both times. The rewrite fixers detect already-fixed code
    and bail.
    """
    fixed_once, fixes_once = _run()
    fixed_twice, fixes_twice = apply_auto_fixes(fixed_once, **_FIXTURE_CONTEXT)

    assert fixed_once == fixed_twice, (
        "Dispatcher is not output-idempotent. Diff first 200 chars:\n"
        f"  pass1: {fixed_once[:200]!r}\n"
        f"  pass2: {fixed_twice[:200]!r}"
    )
    # On the second pass NO rewrite fixers should find anything to do.
    assert fixes_twice == [], f"second pass emitted unexpected fixes: {fixes_twice}"


def test_dispatcher_rewrites_window_location_and_then_auto_imports_navigate():
    """Pins the dispatcher ordering: ``component_forbidden_apis`` MUST run
    before ``component_imports`` so the freshly-introduced ``navigate(``
    usage triggers the SDK import injector.
    """
    tsx = """\
import { React, LightDOMContainer } from "@exepad/sdk";
function HomeContent() {
  function handleHome() {
    window.location.href = '/';
  }
  return <LightDOMContainer><button onClick={handleHome}>Go</button></LightDOMContainer>;
}
export default HomeContent;
"""
    fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, page_slugs=["/"])

    # The forbidden-API rewrite ran.
    assert "navigate('/')" in fixed
    assert "window.location.href" not in fixed
    assert any("Rewrote forbidden window.location" in f for f in fixes)

    # The imports fixer picked up the new ``navigate(`` usage.
    sdk_import_lines = [
        line
        for line in fixed.splitlines()
        if "from '@exepad/sdk'" in line or 'from "@exepad/sdk"' in line
    ]
    navigate_in_import = any("navigate" in line for line in sdk_import_lines)
    navigate_added_via_fix = any(
        "Added missing SDK imports" in f and "navigate" in f for f in fixes
    )
    assert (
        navigate_in_import or navigate_added_via_fix
    ), f"navigate not added to SDK import. import lines: {sdk_import_lines!r}, fixes: {fixes!r}"


def test_dispatcher_strips_inline_console_log_via_paren_balanced_scanner():
    """Onix Studio MainFooter regression: an inline ``console.log`` at
    column > 0 inside an arrow body must be stripped. The line-anchored
    regex previously living in component_polishing missed this; the
    paren-balanced scanner in component_forbidden_apis catches it.
    """
    tsx = """\
import { React, LightDOMContainer } from "@exepad/sdk";
function MainFooter() {
  const onScroll = (e) => { console.log(e.target.scrollTop); };
  return <LightDOMContainer><div onScroll={onScroll}>foot</div></LightDOMContainer>;
}
export default MainFooter;
"""
    fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
    assert "console.log(" not in fixed
    assert any("Stripped console.log()" in f for f in fixes)


def test_apply_auto_fixes_keeps_url_when_no_stock_provider():
    """The stock_provider_configured flag must reach the URL fixer via the
    apply_auto_fixes → FixContext hand-off (not just the fixer-function level)."""
    tsx = '<img src="https://images.unsplash.com/photo-x" alt="hero" />'

    kept, _ = apply_auto_fixes(tsx, [], {}, {}, stock_provider_configured=False)
    assert "images.unsplash.com/photo-x" in kept
    assert "__PLACEHOLDER__" not in kept

    # With a provider, the URL is stripped (the raw <img> is then converted
    # to <ExepadImage>, so a literal __PLACEHOLDER__ doesn't survive) — what
    # matters is the hallucinated URL is gone.
    stripped, _ = apply_auto_fixes(tsx, [], {}, {}, stock_provider_configured=True)
    assert "images.unsplash.com" not in stripped


def test_apply_auto_fixes_keep_is_idempotent_without_provider():
    """A kept URL must survive a second fixer pass (edit-pass safety)."""
    tsx = '<img src="https://images.unsplash.com/photo-y" alt="h" />'
    once, _ = apply_auto_fixes(tsx, [], {}, {}, stock_provider_configured=False)
    twice, _ = apply_auto_fixes(once, [], {}, {}, stock_provider_configured=False)
    assert once == twice
    assert "images.unsplash.com/photo-y" in twice
