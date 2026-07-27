"""Tests for ``services/theme/theme_view.ThemeView``.

The view is the single read API consumed by both
``build_design_system_context`` (what the model is told) and
``style_coverage`` (what the validator demands). Two consumers, one
truth — without ThemeView the two ran independent regex passes and
could disagree about what tokens existed.
"""

from __future__ import annotations

import pytest

from main_agent.services.theme.theme_view import ThemeView

pytestmark = [pytest.mark.unit]


THEME_BOTH_FONTS = """\
@import "tailwindcss";

@theme {
  --color-primary: #0F766E;
  --color-on-primary: #FFFFFF;
  --color-surface: #FFFFFF;
  --font-heading: "Outfit", sans-serif;
  --font-headline: "Outfit", sans-serif;
  --font-body: "Inter", sans-serif;
  --font-sans: "Inter", sans-serif;
  --radius-lg: 0.75rem;
}
"""

THEME_HEADING_ONLY = """\
@theme {
  --color-primary: #A8472A;
  --font-heading: "Fraunces", serif;
  --font-sans: "Inter", sans-serif;
}
"""

THEME_EMPTY = ""

THEME_NO_AT_THEME = "html { color: red; }"


# ──────────────────────────────────────────────────────────────────────
# from_css construction
# ──────────────────────────────────────────────────────────────────────


def test_from_css_parses_full_theme():
    view = ThemeView.from_css(THEME_BOTH_FONTS)
    assert view.has_color("primary")
    assert view.has_color("surface")
    assert view.has_font("heading")
    assert view.has_font("headline")
    assert view.has_radius("lg")


def test_from_css_returns_empty_view_for_empty_input():
    view = ThemeView.from_css(THEME_EMPTY)
    assert view.colors == {}
    assert view.fonts == {}
    assert view.available_color_tokens() == ()
    assert view.available_font_tokens() == ()


def test_from_css_returns_empty_view_when_no_at_theme_block():
    view = ThemeView.from_css(THEME_NO_AT_THEME)
    assert view.colors == {}
    assert view.available_color_tokens() == ()


def test_view_is_immutable():
    """Frozen dataclass — consumers can pass it without copy guards."""
    view = ThemeView.from_css(THEME_BOTH_FONTS)
    with pytest.raises(Exception):  # FrozenInstanceError or AttributeError
        view.colors = {"x": "y"}  # type: ignore[misc]


# ──────────────────────────────────────────────────────────────────────
# Alias-aware queries — the Onix Studio scenario
# ──────────────────────────────────────────────────────────────────────


def test_has_font_returns_true_for_alias_when_only_one_side_declared():
    """REGRESSION: Pre-fix style_coverage would report
    ``font-headline not in tailwind.config.fontFamily`` even when the
    canonical alias ``--font-heading`` was declared. ThemeView's
    alias-aware lookup makes both names resolve.
    """
    view = ThemeView.from_css(THEME_HEADING_ONLY)
    # Direct: --font-heading is declared
    assert view.has_font("heading")
    # Alias: --font-headline isn't in @theme but resolves through the
    # canonical pair.
    assert view.has_font("headline")
    # Same for body ↔ sans
    assert view.has_font("sans")
    assert view.has_font("body")


def test_has_font_returns_false_for_unrelated_name():
    view = ThemeView.from_css(THEME_HEADING_ONLY)
    assert not view.has_font("display")
    assert not view.has_font("handwritten")


def test_get_font_returns_value_through_alias():
    view = ThemeView.from_css(THEME_HEADING_ONLY)
    val = view.get_font("headline")
    assert val is not None
    assert "Fraunces" in val


def test_get_font_returns_direct_value_when_both_present():
    view = ThemeView.from_css(THEME_BOTH_FONTS)
    direct = view.get_font("headline")
    assert direct is not None
    assert "Outfit" in direct


# ──────────────────────────────────────────────────────────────────────
# available_*_tokens — what the model sees
# ──────────────────────────────────────────────────────────────────────


def test_available_color_tokens_lists_actual_declared_names():
    view = ThemeView.from_css(THEME_BOTH_FONTS)
    colors = view.available_color_tokens()
    assert "primary" in colors
    assert "on-primary" in colors
    assert "surface" in colors
    assert all(isinstance(n, str) for n in colors)


def test_available_font_tokens_lists_only_explicit_declarations():
    """The available list reflects what the THEME has, not what aliases
    would resolve. Custom or domain tokens (display, handwritten) flow
    through unchanged. After Pattern B's symmetric derivation, both
    halves of a canonical pair will be present in production themes —
    but the view only shows what the @theme block actually declares.
    """
    view = ThemeView.from_css(THEME_HEADING_ONLY)
    fonts = view.available_font_tokens()
    assert "heading" in fonts
    assert "sans" in fonts
    # In the pre-aliased input: only the raw declarations are listed.
    assert "headline" not in fonts
    assert "body" not in fonts


def test_available_color_tokens_returns_sorted_tuple():
    """Stable order helps deterministic prompt generation."""
    view = ThemeView.from_css(THEME_BOTH_FONTS)
    tokens = view.available_color_tokens()
    assert tokens == tuple(sorted(tokens))


def test_color_value_lookup():
    view = ThemeView.from_css(THEME_BOTH_FONTS)
    assert view.color_value("primary") == "#0F766E"
    assert view.color_value("nonexistent") is None
