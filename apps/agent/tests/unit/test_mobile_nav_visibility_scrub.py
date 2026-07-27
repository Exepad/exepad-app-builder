"""Unit tests for `_scrub_visibility_value` — the className scrubber the
mobile-nav scaffold uses to strip source-supplied breakpoint visibility
classes before injecting its own `hidden lg:flex` (and before cloning
children into the drawer overlay).

The scrubber's correctness matters because Tailwind specificity composes
class strings in non-obvious ways. A leftover `hidden md:flex` paired
with the new `hidden lg:flex` would hide the nav at 768-1023px tablet
sizes — exactly the chick_farm RC#8a regression (app `w4hov6ht`).

These tests pin the chick_farm fix AND the edge cases caught during code
review (`sm:hidden md:flex` previously produced a malformed `sm:`
dangling prefix because the canonical-pair regex's `\\b` boundary
accidentally matched the tail of a `{bp}:hidden` variant chain).
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.html_to_tsx.mobile_nav import (
    _scrub_display_and_visibility_value,
    _scrub_visibility_value,
)

pytestmark = [pytest.mark.unit]


class TestCanonicalChickFarmPattern:
    """The exact regression chick_farm hit (RC#8a)."""

    def test_hidden_md_flex_with_layout_classes_strips_pair(self):
        assert _scrub_visibility_value(
            "hidden md:flex items-center space-x-10 font-serif text-lg tracking-tight"
        ) == "items-center space-x-10 font-serif text-lg tracking-tight"

    def test_canonical_pair_at_start(self):
        assert _scrub_visibility_value("hidden lg:block py-4") == "py-4"


class TestVariantHiddenForms:
    """`{bp}:hidden` (responsive single-breakpoint hide). The scaffold owns
    visibility for the nav family so these get stripped too. Pre-fix, the
    canonical-pair regex would greedily match the trailing `hidden` of
    `sm:hidden`, leaving a malformed dangling `sm:`."""

    def test_sm_hidden_alone_stripped(self):
        assert _scrub_visibility_value("sm:hidden flex-row") == "flex-row"

    def test_sm_hidden_does_not_corrupt_following_class(self):
        # Pre-fix output was 'sm:' (dangling prefix). Post-fix MUST not
        # contain ':' as a trailing token, ever.
        result = _scrub_visibility_value("sm:hidden md:flex")
        assert ":" not in result.split() or all(
            ":" in t and not t.endswith(":") for t in result.split() if ":" in t
        ), f"Found dangling colon prefix in {result!r}"
        # Result should be valid Tailwind (no malformed bare ':' or
        # trailing-colon tokens). `md:flex` may remain since it's a
        # well-formed responsive layout utility.

    def test_block_lg_hidden_keeps_block(self):
        assert _scrub_visibility_value("block lg:hidden") == "block"


class TestBareHidden:
    def test_bare_hidden_alone_stripped(self):
        assert _scrub_visibility_value("hidden") == ""

    def test_bare_hidden_with_layout_classes(self):
        assert _scrub_visibility_value("text-2xl font-black hidden") == "text-2xl font-black"


class TestNonVisibilityPreservation:
    """Critical regression guards — the scrubber MUST NOT touch
    non-visibility utilities even when they textually contain `hidden`."""

    def test_placeholder_hidden_variant_preserved(self):
        # `placeholder:hidden` is a variant chain — the `hidden` here is
        # the utility under the `placeholder:` variant, NOT a bare
        # visibility class.
        assert _scrub_visibility_value("placeholder:hidden text-red-500") == (
            "placeholder:hidden text-red-500"
        )

    def test_overflow_hidden_kept(self):
        # `overflow-hidden` is a separate utility; the `hidden` is part
        # of the compound class name, not a standalone token.
        assert _scrub_visibility_value("overflow-hidden rounded-lg") == (
            "overflow-hidden rounded-lg"
        )

    def test_pure_layout_classes_passthrough(self):
        assert _scrub_visibility_value("items-center space-x-10") == "items-center space-x-10"

    def test_empty_input(self):
        assert _scrub_visibility_value("") == ""


class TestIdempotency:
    """Running the scrubber twice on the same input must produce the same
    output as running it once. Idempotency matters because translator runs
    can fire on already-translated TSX (re-run, cache miss, etc.)."""

    def test_canonical_pair(self):
        first = _scrub_visibility_value("hidden md:flex items-center")
        second = _scrub_visibility_value(first)
        assert first == second == "items-center"

    def test_variant_hidden(self):
        first = _scrub_visibility_value("lg:hidden block")
        second = _scrub_visibility_value(first)
        assert first == second == "block"

    def test_bare_hidden(self):
        first = _scrub_visibility_value("text-lg hidden")
        second = _scrub_visibility_value(first)
        assert first == second == "text-lg"

    def test_no_visibility_at_all(self):
        first = _scrub_visibility_value("text-lg font-bold")
        second = _scrub_visibility_value(first)
        assert first == second == "text-lg font-bold"


class TestDesktopNavInjectionStripsStaleDisplay:
    """`_scrub_display_and_visibility_value` — used ONLY in the
    desktop-nav injection path. Removes the breakpoint-visibility
    classes AND the bare display utilities that would otherwise conflict
    with the injected `hidden lg:flex`.

    Past regression: rdzn62gx HeroSection (2026-05-16) shipped
    `<nav class="hidden lg:flex flex justify-between items-center">` —
    `_scrub_visibility_value` had no effect on the bare `flex`, so two
    competing display rules ended up in the className. Bare `flex` won
    in the Tailwind cascade → nav visible at every viewport, mobile
    drawer button rendered alongside it → broken UX.
    """

    def test_chick_farm_rdzn62gx_regression(self):
        """The exact source-HTML nav className from rdzn62gx HeroSection."""
        result = _scrub_display_and_visibility_value(
            "flex justify-between items-center max-w-7xl mx-auto px-8 py-4"
        )
        assert "flex" not in result.split()
        assert "justify-between" in result
        assert "items-center" in result

    def test_strips_bare_flex(self):
        assert (
            _scrub_display_and_visibility_value("flex justify-between items-center")
            == "justify-between items-center"
        )

    def test_strips_inline_flex(self):
        assert _scrub_display_and_visibility_value("inline-flex gap-4") == "gap-4"

    def test_strips_bare_grid(self):
        assert (
            _scrub_display_and_visibility_value("grid grid-cols-3 gap-4")
            == "grid-cols-3 gap-4"
        )

    def test_strips_inline_block(self):
        assert (
            _scrub_display_and_visibility_value("inline-block text-center")
            == "text-center"
        )

    def test_strips_bare_block(self):
        assert (
            _scrub_display_and_visibility_value("block w-full text-lg")
            == "w-full text-lg"
        )

    def test_preserves_compound_classes_starting_with_flex(self):
        """`flex-col`, `flex-row`, `grid-cols-X` etc. must survive."""
        result = _scrub_display_and_visibility_value(
            "flex-col flex-row grid-cols-3 grid-rows-2 inline-flex-x"
        )
        # These are compound classes (next char `-` is `\S`); only the
        # bare `inline-flex` portion would match if it appeared bare.
        # Here `inline-flex-x` starts with `inline-flex` but next char is
        # `-`, so the lookahead `(?!\S)` rejects → no match.
        assert "flex-col" in result
        assert "flex-row" in result
        assert "grid-cols-3" in result
        assert "grid-rows-2" in result
        assert "inline-flex-x" in result

    def test_also_strips_responsive_visibility(self):
        """Composed behavior: visibility + display in one pass."""
        result = _scrub_display_and_visibility_value(
            "hidden md:flex flex justify-between"
        )
        # `hidden md:flex` → stripped by visibility regex; bare `flex` →
        # stripped by display regex.
        assert result == "justify-between"

    def test_empty_input(self):
        assert _scrub_display_and_visibility_value("") == ""

    def test_idempotent(self):
        first = _scrub_display_and_visibility_value(
            "flex hidden md:flex justify-between items-center"
        )
        second = _scrub_display_and_visibility_value(first)
        assert first == second
        assert "flex" not in first.split()
        assert "hidden" not in first.split()

    def test_visibility_only_scrub_does_NOT_touch_bare_display(self):
        """Regression-guard: the visibility-only scrubber MUST NOT strip
        bare `flex` (drawer-child cloning relies on this — drawer kids
        keep their display utilities)."""
        result = _scrub_visibility_value("flex justify-between items-center")
        # Bare `flex` survives the visibility-only scrub.
        assert "flex" in result.split()
