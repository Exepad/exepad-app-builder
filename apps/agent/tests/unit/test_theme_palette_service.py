"""Tests for authoritative theme palette resolution."""

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.theme_palette_service import (
    ThemePaletteResolutionError,
    render_fallback_theme_css,
    resolve_theme_palette_snapshot,
)

pytestmark = [pytest.mark.unit]


VALID_THEME_CSS = """
@layer exepad-app { @import "tailwindcss"; }
@theme {
  --color-primary: #0f766e;
  --color-on-primary: #ffffff;
  --color-primary-container: #7ee7df;
  --color-on-primary-container: #1c1b1f;
  --color-secondary: #d97706;
  --color-on-secondary: #1c1b1f;
  --color-secondary-container: #fed7aa;
  --color-on-secondary-container: #1c1b1f;
  --color-surface: #fffbeb;
  --color-on-surface: #1c1b1f;
  --color-surface-variant: #fef3c7;
  --color-on-surface-variant: #1c1b1f;
  --color-surface-dim: #f5e7b8;
  --color-surface-bright: #fffdf3;
  --color-surface-container-lowest: #fffef8;
  --color-surface-container-low: #fff8dc;
  --color-surface-container: #fef3c7;
  --color-surface-container-high: #f9e7b0;
  --color-surface-container-highest: #f3dd9f;
  --color-error: #dc2626;
  --color-on-error: #ffffff;
  --color-error-container: #fecaca;
  --color-on-error-container: #1c1b1f;
  --color-outline: #9ca3af;
  --color-outline-variant: #d1d5db;
  --color-background: #fffbeb;
  --color-on-background: #1c1b1f;
  --color-inverse-surface: #1c1b1f;
  --color-inverse-on-surface: #ffffff;
  --color-inverse-primary: #99f6e4;
  --font-heading: "Outfit", sans-serif;
  --font-body: "Inter", sans-serif;
}
"""


def test_render_fallback_theme_css_has_real_m3_tokens():
    """When DesignSystemBuilder no-saves theme.css, the seed fallback must render
    a real M3 palette (not the tokenless bootstrap) so the app ships styled and
    its theme.css can be parsed back into a valid palette."""
    css = render_fallback_theme_css()
    assert "@theme {" in css
    # Real M3 tokens present with values (not just the Tailwind bootstrap).
    for token in ("--color-primary", "--color-on-surface", "--color-error"):
        assert f"{token}:" in css, token
    # Round-trips through the palette resolver (proves it's a usable theme.css).
    snapshot = resolve_theme_palette_snapshot(css, fallback_to_seed=False)
    assert snapshot.palette.get("primary")
    assert snapshot.palette.get("on-surface")


def test_theme_palette_resolution_uses_theme_css_values():
    """theme.css is the source of truth — there is no longer a `design_system`
    parameter to compete with it."""
    snapshot = resolve_theme_palette_snapshot(VALID_THEME_CSS, fallback_to_seed=True)

    assert snapshot.source == "theme_css"
    assert snapshot.palette["primary"] == "#0f766e"
    assert snapshot.palette["on-primary"] == "#ffffff"
    assert snapshot.source_hash


def test_theme_palette_resolution_extracts_fonts_from_theme_css():
    """Snapshot now carries fonts parsed from `--font-*` declarations."""
    snapshot = resolve_theme_palette_snapshot(VALID_THEME_CSS, fallback_to_seed=True)
    assert snapshot.fonts.get("heading") == '"Outfit", sans-serif'
    assert snapshot.fonts.get("body") == '"Inter", sans-serif'


def test_theme_palette_resolution_raises_when_required_tokens_missing():
    with pytest.raises(ThemePaletteResolutionError) as exc:
        resolve_theme_palette_snapshot("@theme { --color-primary: #0f766e; }")

    assert "missing required resolved color tokens" in str(exc.value)


def test_theme_palette_resolution_falls_back_to_static_seeds_when_theme_css_missing():
    """No design_system param to feed seeds anymore — fallback uses static
    defaults (#0F766E / #D97706 / #FFFBEB / #DC2626)."""
    snapshot = resolve_theme_palette_snapshot(None, fallback_to_seed=True)

    assert snapshot.source == "seed_fallback"
    # Computed from the static fallback seeds.
    assert snapshot.palette["primary"] == "#0F766E"
    assert snapshot.palette["on-primary"]
    assert snapshot.fonts == {}


def test_theme_palette_derives_background_from_surface_when_missing():
    """Regression: design-import theme.css that omits ``--color-background``
    derives it from --color-surface (M3 alias rule).
    """
    theme_without_bg = VALID_THEME_CSS.replace("--color-background: #fffbeb;\n", "").replace(
        "--color-on-background: #1c1b1f;\n", ""
    )
    assert "--color-background" not in theme_without_bg
    assert "--color-on-background" not in theme_without_bg

    snapshot = resolve_theme_palette_snapshot(theme_without_bg, fallback_to_seed=True)
    assert snapshot.source == "theme_css"
    assert snapshot.palette["background"] == "#fffbeb"  # = surface
    assert snapshot.palette["on-background"] == "#1c1b1f"  # = on-surface


def test_theme_palette_keeps_explicit_background_when_present():
    """If theme.css DOES emit background/on-background, the explicit values win."""
    theme_with_distinct_bg = VALID_THEME_CSS.replace(
        "--color-background: #fffbeb;",
        "--color-background: #000000;",
    )
    snapshot = resolve_theme_palette_snapshot(theme_with_distinct_bg, fallback_to_seed=True)
    assert snapshot.palette["background"] == "#000000"
    assert snapshot.palette["surface"] == "#fffbeb"
    assert snapshot.palette["on-background"] == "#1c1b1f"


def test_theme_palette_still_raises_when_surface_also_missing():
    """If BOTH background and its surface alias are missing, no derivation is
    possible and the original error surfaces."""
    theme_no_bg_no_surface = (
        VALID_THEME_CSS.replace("--color-background: #fffbeb;\n", "")
        .replace("--color-on-background: #1c1b1f;\n", "")
        .replace("--color-surface: #fffbeb;\n", "")
    )
    with pytest.raises(ThemePaletteResolutionError) as exc:
        resolve_theme_palette_snapshot(theme_no_bg_no_surface, fallback_to_seed=True)
    assert "background" in str(exc.value) or "surface" in str(exc.value)
