"""Integration tests for ``build_design_system_context``.

Pattern B added the optional ``theme_view`` parameter that surfaces the
FULL set of declared theme tokens to the model — not just the curated
2-key fonts dict. These tests pin the contract so the model receives
``available_color_tokens`` / ``available_font_tokens`` arrays whenever
a ``ThemeView`` is supplied, and they don't leak into the legacy
no-view call sites.
"""

from __future__ import annotations

import json

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.design_system_context import (
    build_design_system_context,
)
from main_agent.services.theme.theme_view import ThemeView

pytestmark = [pytest.mark.unit]


THEME_HEADING_ONLY = """\
@theme {
  --color-primary: #A8472A;
  --color-on-primary: #FFFFFF;
  --color-coordinate-text: #112233;
  --font-heading: "Fraunces", serif;
  --font-sans: "Inter", sans-serif;
}
"""


def test_legacy_call_without_theme_view_omits_available_tokens():
    """Backward compat: a call site that doesn't pass theme_view must
    still produce a usable context. The new fields are optional."""
    out = build_design_system_context(
        palette={"primary": "#A8472A", "on-primary": "#FFFFFF"},
        fonts={"heading": '"Fraunces", serif'},
    )
    parsed = json.loads(out)
    assert "available_color_tokens" not in parsed
    assert "available_font_tokens" not in parsed
    assert "available_token_usage_rule" not in parsed


def test_theme_view_surfaces_full_color_token_list():
    """The Onix Studio model invented `border-color` because the
    curated dict didn't show it the available colors. With ThemeView
    wired in, it sees every declared --color-X — including custom
    domain tokens like coordinate-text added via add_theme_tokens.
    """
    view = ThemeView.from_css(THEME_HEADING_ONLY)
    out = build_design_system_context(
        palette={"primary": "#A8472A"},
        fonts={"heading": '"Fraunces", serif'},
        theme_view=view,
    )
    parsed = json.loads(out)
    colors = parsed["available_color_tokens"]
    assert "primary" in colors
    assert "on-primary" in colors
    assert "coordinate-text" in colors  # custom token, flows through


def test_theme_view_surfaces_full_font_token_list():
    view = ThemeView.from_css(THEME_HEADING_ONLY)
    out = build_design_system_context(
        palette={},
        fonts={"heading": '"Fraunces", serif'},
        theme_view=view,
    )
    parsed = json.loads(out)
    fonts = parsed["available_font_tokens"]
    # Theme declared --font-heading and --font-sans (raw bundle names).
    # The Pattern B alias filler in the runner adds --font-headline and
    # --font-body alongside these — but ThemeView reports what theme.css
    # ACTUALLY declares, not what aliases would resolve.
    assert "heading" in fonts
    assert "sans" in fonts


def test_theme_view_includes_usage_rule_for_the_model():
    """The model needs to know the contract — use only listed tokens or
    call add_theme_tokens. Pin the rule string so doc and code stay
    aligned (10_COLOR_AND_LAYOUT.md describes the same contract)."""
    view = ThemeView.from_css(THEME_HEADING_ONLY)
    out = build_design_system_context(
        palette={"primary": "#A8472A"},
        theme_view=view,
    )
    parsed = json.loads(out)
    rule = parsed["available_token_usage_rule"]
    assert "available_color_tokens" in rule
    assert "available_font_tokens" in rule
    assert "add_theme_tokens" in rule


def test_theme_view_with_empty_theme_returns_empty_lists():
    """Edge case: a workflow that fed a ThemeView constructed from
    ``""`` (theme.css missing) shouldn't emit garbage. Empty arrays
    are the explicit "no tokens declared" signal — better than falling
    back silently to no contract surfaced.
    """
    view = ThemeView.from_css("")
    out = build_design_system_context(palette={}, theme_view=view)
    parsed = json.loads(out)
    assert parsed["available_color_tokens"] == []
    assert parsed["available_font_tokens"] == []
    assert "available_token_usage_rule" in parsed


def test_palette_and_fonts_keys_coexist_with_available_tokens():
    """Backward compat for existing prompt sections (pairing_rules,
    palette, fonts dicts) — ThemeView additions don't replace them."""
    view = ThemeView.from_css(THEME_HEADING_ONLY)
    out = build_design_system_context(
        palette={"primary": "#A8472A"},
        fonts={"heading": '"Fraunces", serif'},
        theme_view=view,
    )
    parsed = json.loads(out)
    assert parsed["palette"] == {"primary": "#A8472A"}
    assert parsed["fonts"]["headline"] == '"Fraunces", serif'
    assert "pairing_rules" in parsed
    assert "available_color_tokens" in parsed
