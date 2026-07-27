"""Additional contract tests for deterministic style coverage validators."""

import pytest

from main_agent.services.validation.style_coverage import (
    _contrast_ratio,
    _hex_to_rgb,
    _rgb_to_hex,
    auto_fix_contrast_pairs,
    auto_fix_missing_m3_colors,
    compute_m3_palette,
    extract_css_theme_color_values,
    extract_custom_color_refs,
    extract_root_hsl_values,
    parse_css_theme,
    parse_tailwind_config,
    validate_contrast_pairs,
    validate_style_coverage,
)

pytestmark = [pytest.mark.unit]


def test_parse_css_theme_extracts_tokens():
    css = """
@theme {
  --color-primary: #0f766e;
  --color-outline-variant: #d7c3ae;
  --font-display: "Outfit", sans-serif;
  --radius-xl: 1rem;
}
"""

    result = parse_css_theme(css)

    assert result["colors"] == {"primary", "outline-variant"}
    assert result["fontFamily"] == {"display"}
    assert result["borderRadius"] == {"xl"}
    assert result["color_values"]["primary"] == "#0f766e"


def test_parse_tailwind_config_returns_empty_sets_without_theme_block():
    result = parse_tailwind_config(".page { color: red; }")

    assert result == {
        "colors": set(),
        "color_values": {},
        "fontFamily": set(),
        "font_values": {},
        "borderRadius": set(),
        "boxShadow": set(),
    }


def test_extract_custom_color_refs_skips_builtin_non_color_and_arbitrary_classes():
    tsx = """
<div
  className="
    bg-primary
    text-brand-accent
    shadow-soft
    shadow-custom-glow
    border-2
    bg-gradient-to-r
    text-white
    bg-[var(--hero)]
    text-primary/80
  "
/>
"""

    refs = extract_custom_color_refs(tsx)

    assert ("bg-primary", "primary") in refs
    assert ("text-brand-accent", "brand-accent") in refs
    assert ("shadow-custom-glow", "custom-glow") in refs
    assert all(name != "soft" for _, name in refs)
    assert all(name != "white" for _, name in refs)
    assert all(name != "2" for _, name in refs)


def test_extract_custom_color_refs_skips_opacity_utilities_and_gradient_tokens():
    refs = extract_custom_color_refs(
        '<div className="bg-opacity-50 text-gradient-accent bg-primary" />'
    )

    assert refs == [("bg-primary", "primary")]


def test_extract_custom_color_refs_ignores_svg_kebab_attrs_in_dangerouslySetInnerHTML():
    """Issue #2b regression: SVG kebab attributes inside dangerouslySetInnerHTML
    must NOT be flagged as missing Tailwind colors.

    Killed the GameContent build on Super Pixel Plumber (2026-05-02) — the
    LLM emitted ``<text text-anchor="middle" stroke-width="2">`` inside
    a string literal, the regex matched ``text-anchor`` / ``stroke-width``
    as ``text-{color}`` / ``stroke-{color}`` patterns and complained that
    "anchor" / "width" weren't in the theme.
    """
    tsx = """
const SVG_ICON = `<svg viewBox="0 0 24 24">
  <text text-anchor="middle" text-rendering="optimizeLegibility">x</text>
  <line stroke-width="2" stroke-linecap="round" stroke-dasharray="5,5" />
  <rect fill-opacity="0.5" fill-rule="evenodd" />
</svg>`;
<div className="bg-primary" dangerouslySetInnerHTML={{__html: SVG_ICON}} />
"""

    refs = extract_custom_color_refs(tsx)

    # Only the real className entry survives.
    assert refs == [("bg-primary", "primary")]
    # And NONE of the SVG attribute names sneak through.
    flagged = {name for _, name in refs}
    assert "anchor" not in flagged
    assert "width" not in flagged
    assert "rendering" not in flagged
    assert "linecap" not in flagged
    assert "dasharray" not in flagged
    assert "opacity" not in flagged
    assert "rule" not in flagged


def test_extract_custom_color_refs_ignores_classnames_in_comments_and_strings():
    """Class-shaped words in JSDoc / string literals / inline comments
    should NOT be flagged. Only static className positions count."""
    tsx = """
// Use bg-secondary for hover (this comment must NOT trigger a flag)
const errorMsg = "User must wear bg-foo-500 to log in";
<div className="bg-primary" />
"""

    refs = extract_custom_color_refs(tsx)

    # Only the real className entry — comment and string literal don't count.
    assert refs == [("bg-primary", "primary")]


def test_validate_style_coverage_flags_missing_custom_colors():
    """Color coverage is the only check that ships warnings; missing
    fonts are not flagged because Tailwind v4 fonts work via
    ``var(--font-X)`` even when the token isn't declared in @theme.
    """
    warnings = validate_style_coverage(
        {
            "Hero": '<section className="bg-brand-accent text-on-surface font-display" />',
            "Footer": '<footer className="font-editorial text-brand-muted" />',
        },
        """
@theme {
  --color-on-surface: #1c1b1f;
}
""",
    )

    assert any("brand-accent" in warning for warning in warnings)
    assert any("brand-muted" in warning for warning in warnings)
    # Font references no longer produce warnings — they're not
    # load-bearing in v4 and the check was removed.
    assert not any("font" in warning.lower() for warning in warnings)


def test_extract_css_theme_color_values_and_root_hsl_values_parse_both_layers():
    css = """
@theme {
  --color-primary: #0f766e;
  --color-on-primary: #ffffff;
}
:root {
  --primary: 170 78% 26%;
  --primary-foreground: 0 0% 100%;
  --background: #fafaf9;
}
"""

    color_values = extract_css_theme_color_values(css)
    root_values = extract_root_hsl_values(css)

    assert color_values == {"primary": "#0f766e", "on-primary": "#ffffff"}
    assert root_values["primary"].startswith("#")
    assert root_values["primary-foreground"] == "#ffffff"
    assert root_values["background"] == "#fafaf9"


def test_compute_m3_palette_supports_light_primary_with_dark_on_primary():
    palette = compute_m3_palette(
        primary="#7dd3fc",
        secondary="#d97706",
        surface="#f8fafc",
        error="#dc2626",
    )

    assert palette["on-primary"] == "#1C1B1F"
    assert _contrast_ratio(palette["on-primary"], palette["primary"]) >= 4.5
    assert _contrast_ratio(palette["on-surface"], palette["surface"]) >= 4.5
    assert _contrast_ratio(palette["inverse-on-surface"], palette["inverse-surface"]) >= 4.5


def test_compute_m3_palette_supports_dark_primary_with_light_on_primary():
    palette = compute_m3_palette(
        primary="#115e59",
        secondary="#1d4ed8",
        surface="#ffffff",
        error="#991b1b",
    )

    assert palette["on-primary"] == "#FFFFFF"
    assert _contrast_ratio(palette["on-primary"], palette["primary"]) >= 4.5


def test_compute_m3_palette_includes_tertiary_and_fixed_families():
    """The full M3 palette must include the tertiary + fixed-tone families.

    Regression: the previous palette only covered primary/secondary/surface/
    error/inverse, which left tertiary_fixed-style tokens (named in
    Creator's design_style[]) undefined when DesignSystemBuilder echoed
    only the seed families into theme.css. Apps shipped with broken
    badges because Tailwind compiled the undefined classes to nothing.
    """
    palette = compute_m3_palette(
        primary="#1b4332",
        secondary="#47664b",
        surface="#fcf9f3",
        error="#ba1a1a",
    )

    # Tertiary family — derived from primary/secondary blend
    for token in ("tertiary", "on-tertiary", "tertiary-container", "on-tertiary-container"):
        assert token in palette, f"missing {token}"

    # Fixed family — pinned to container shade for primary/secondary/tertiary
    for role in ("primary", "secondary", "tertiary"):
        for suffix in ("-fixed", "-fixed-dim", "on-{role}-fixed", "on-{role}-fixed-variant"):
            token = f"{role}{suffix}" if not suffix.startswith("on-") else suffix.format(role=role)
            assert token in palette, f"missing {token}"

    # Total token count: 30 (legacy) + 16 new = 46
    assert len(palette) == 46


def test_compute_m3_palette_fixed_family_meets_contrast():
    """on-{role}-fixed pairs must meet WCAG AA against {role}-fixed."""
    palette = compute_m3_palette(
        primary="#1b4332",
        secondary="#47664b",
        surface="#fcf9f3",
        error="#ba1a1a",
    )

    for role in ("primary", "secondary", "tertiary"):
        bg = palette[f"{role}-fixed"]
        fg = palette[f"on-{role}-fixed"]
        ratio = _contrast_ratio(fg, bg)
        assert ratio >= 4.5, f"on-{role}-fixed/{role}-fixed = {ratio:.2f}:1"


def test_compute_m3_palette_harmonizes_all_pairs_for_industrial_dark_theme():
    """
    The industrial dark palette from the gym-app debug report used to produce
    1.00:1 contrast on several pairs. Every M3 pair in the computed palette
    must meet WCAG AA — the harmonization pass guarantees it by adjusting
    bg and on-* tokens together when _pick_on_color alone isn't enough.
    """
    from main_agent.services.validation.style_coverage import M3_CONTRAST_PAIRS

    palette = compute_m3_palette(
        primary="#C2410C",
        secondary="#64748B",
        surface="#0F172A",
        error="#DC2626",
    )

    for fg_name, bg_name in M3_CONTRAST_PAIRS.items():
        fg = palette[fg_name]
        bg = palette[bg_name]
        ratio = _contrast_ratio(fg, bg)
        assert ratio >= 4.5, f"{fg_name}/{bg_name} = {ratio:.2f}:1 ({fg} on {bg})"


def test_auto_fix_missing_m3_colors_recovers_tertiary_fixed_via_canonical_palette():
    """Regression: when TSX references `bg-tertiary-fixed` and theme.css
    has only primary/secondary/surface/error families, the auto-fix must
    derive the missing token from the canonical M3 palette computed
    from the seeds — not give up.
    """
    css = """
@theme {
  --color-primary: #1b4332;
  --color-secondary: #47664b;
  --color-surface: #fcf9f3;
  --color-error: #ba1a1a;
}
"""
    fixed = auto_fix_missing_m3_colors(
        css,
        missing_colors={"tertiary-fixed", "on-tertiary-fixed-variant"},
    )
    assert fixed is not None, "Auto-fix must recover canonical M3 tokens"
    assert "--color-tertiary-fixed:" in fixed
    assert "--color-on-tertiary-fixed-variant:" in fixed


def test_auto_fix_missing_m3_colors_returns_none_when_no_seeds_and_no_heuristic():
    """When seeds are absent and the missing token isn't in M3_DERIVABLE_COLORS,
    auto-fix correctly returns None.
    """
    css = "@theme {\n  --color-foo: #abcdef;\n}\n"
    assert auto_fix_missing_m3_colors(css, {"completely-invented-name"}) is None


def test_validate_contrast_pairs_reports_m3_and_sdk_failures():
    css = """
@theme {
  --color-primary: #dbeafe;
  --color-on-primary: #ffffff;
}
:root {
  --primary: 214 95% 93%;
  --primary-foreground: 0 0% 100%;
}
"""

    warnings = validate_contrast_pairs(css)

    assert any('Contrast fail: "on-primary"' in warning for warning in warnings)
    assert any('Contrast fail: SDK "primary-foreground"' in warning for warning in warnings)


def test_auto_fix_contrast_pairs_returns_none_when_pairs_are_already_readable():
    css = """
@theme {
  --color-primary: #0f766e;
  --color-on-primary: #ffffff;
}
:root {
  --primary: 170 78% 26%;
  --primary-foreground: 0 0% 100%;
}
"""

    assert auto_fix_contrast_pairs(css) is None


def test_auto_fix_contrast_pairs_returns_none_when_no_theme_tokens_exist():
    assert auto_fix_contrast_pairs(".page { color: red; }") is None


def test_auto_fix_contrast_pairs_nudges_midtone_bg_when_neither_extreme_passes():
    """OnboardFlow regression — teal #0C8A7F where white (4.24) AND dark (4.04)
    both fail 4.5:1. The previous implementation called _pick_on_color which
    returned #FFFFFF (same as current fg) and skipped the replacement, leaving
    the failing pair untouched. The fix uses _ensure_pair_contrast to nudge
    the bg until a passing pair exists.
    """
    css = """
@theme {
  --color-primary: #0C8A7F;
  --color-on-primary: #FFFFFF;
  --color-secondary: #0891B2;
  --color-on-secondary: #FFFFFF;
}
"""
    fixed = auto_fix_contrast_pairs(css)
    assert fixed is not None, "Auto-fix must produce a result for failing mid-tone pairs"

    # The resulting pair for primary/on-primary MUST meet 4.5:1.
    new_values = extract_css_theme_color_values(fixed)
    primary_pair_ratio = _contrast_ratio(new_values["on-primary"], new_values["primary"])
    secondary_pair_ratio = _contrast_ratio(new_values["on-secondary"], new_values["secondary"])
    assert (
        primary_pair_ratio >= 4.5
    ), f"on-primary still fails contrast after auto-fix: {primary_pair_ratio:.2f}:1"
    assert (
        secondary_pair_ratio >= 4.5
    ), f"on-secondary still fails contrast after auto-fix: {secondary_pair_ratio:.2f}:1"

    # And the fix should be idempotent — running again returns None.
    assert auto_fix_contrast_pairs(fixed) is None


def test_auto_fix_missing_m3_colors_inserts_derived_tokens():
    css = """
@theme {
  --color-surface: #f8fafc;
  --color-on-surface: #1c1b1f;
  --color-outline: #94a3b8;
}
"""

    fixed = auto_fix_missing_m3_colors(
        css,
        {"surface-container", "surface-container-high", "outline-variant"},
    )

    assert fixed is not None
    assert "--color-surface-container:" in fixed
    assert "--color-surface-container-high:" in fixed
    assert "--color-outline-variant:" in fixed


def test_auto_fix_missing_m3_colors_returns_none_without_derivable_sources():
    css = """
@theme {
  --color-primary: #0f766e;
}
"""

    assert auto_fix_missing_m3_colors(css, {"surface-container", "outline-variant"}) is None


def test_auto_fix_missing_m3_colors_skips_existing_unknown_and_invalid_hex_inputs():
    css = """
@theme {
  --color-surface: #nothex;
  --color-surface-container: #ffffff;
}
"""

    assert (
        auto_fix_missing_m3_colors(
            css,
            {"surface-container", "surface-container-high", "made-up-color"},
        )
        is None
    )


def test_pick_on_color_falls_back_to_stronger_of_white_or_dark_when_threshold_is_unreachable():
    from main_agent.services.validation.style_coverage import _pick_on_color

    chosen = _pick_on_color("#777777", min_ratio=20.0)

    assert chosen in {"#FFFFFF", "#1C1B1F"}


# ---------------------------------------------------------------------------
# Color-math primitives — direct tests for _contrast_ratio, _hex_to_rgb,
# _rgb_to_hex. These have only been exercised through pipeline-level
# contrast tests; the unit checks below pin the boundary cases so a future
# refactor of the math helpers can't drift silently.
# ---------------------------------------------------------------------------


class TestColorMathPrimitives:
    def test_contrast_ratio_white_on_black_is_max(self):
        assert _contrast_ratio("#ffffff", "#000000") == pytest.approx(21.0)

    def test_contrast_ratio_is_symmetric(self):
        # The ratio is independent of which color is foreground.
        assert _contrast_ratio("#000000", "#ffffff") == pytest.approx(
            _contrast_ratio("#ffffff", "#000000")
        )

    def test_contrast_ratio_same_color_is_one(self):
        assert _contrast_ratio("#808080", "#808080") == pytest.approx(1.0)

    def test_contrast_ratio_meets_wcag_aa_for_known_pair(self):
        # Material slate (#1C1B1F) on white must clear the 4.5:1 AA threshold
        # by a wide margin — this is the canonical text/surface pair.
        assert _contrast_ratio("#1C1B1F", "#FFFFFF") > 15.0

    def test_hex_to_rgb_white_returns_unit_floats(self):
        # Helper returns floats in [0, 1] range, NOT [0, 255].
        r, g, b = _hex_to_rgb("#ffffff")
        assert (r, g, b) == pytest.approx((1.0, 1.0, 1.0))

    def test_hex_to_rgb_three_char_shorthand_expands(self):
        # `#abc` expands to `#aabbcc` per the helper's documented behaviour.
        r, g, b = _hex_to_rgb("#abc")
        assert r == pytest.approx(170 / 255)
        assert g == pytest.approx(187 / 255)
        assert b == pytest.approx(204 / 255)

    def test_hex_to_rgb_uppercase_parity(self):
        # Hex parsing is case-insensitive.
        assert _hex_to_rgb("#FFFFFF") == pytest.approx(_hex_to_rgb("#ffffff"))

    def test_rgb_to_hex_black(self):
        assert _rgb_to_hex(0.0, 0.0, 0.0) == "#000000"

    def test_rgb_to_hex_round_trips_through_hex_to_rgb(self):
        r, g, b = _hex_to_rgb("#aabbcc")
        assert _rgb_to_hex(r, g, b) == "#aabbcc"

    def test_rgb_to_hex_clamps_out_of_range_floats(self):
        # The helper clamps via max(0, min(1, ...)) so values above 1 or
        # below 0 still produce a valid 6-digit hex.
        assert _rgb_to_hex(2.0, -0.5, 0.5) == "#ff0080"
