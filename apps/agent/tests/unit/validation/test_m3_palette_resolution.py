"""The M3 palette contract: writer and reader must agree, and must be readable.

Regression cover for a real terminal failure. A model wrote a 7 KB theme.css
that passed every write-time check and saved as "validated"; the deploy step
then parsed the same file, found ZERO of the 30 required colour tokens, and
killed the workflow:

    Theme palette resolution failed: theme.css is missing required resolved
    color tokens: background, error, error-container, ..., and 24 more

Three separate defects made that possible, one test class each below.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.style_coverage import (
    M3_REQUIRED_PALETTE_TOKENS,
    extract_css_theme_color_values,
    parse_css_color_to_hex,
    resolve_m3_palette,
)


def _theme(body: str) -> str:
    return "@theme {\n" + body + "\n}"


def _full_palette_css(value_for: str = "#1B5E20") -> str:
    body = "\n".join(f"  --color-{t}: {value_for};" for t in sorted(M3_REQUIRED_PALETTE_TOKENS))
    return _theme(body)


class TestColourNotations:
    """The extractor accepted ONLY literal hex.

    Tailwind v4 ships its own palette in oklch, so that is the notation a model
    drifts to even when the prompt says hex — and every such value was dropped,
    yielding an empty palette from a perfectly coherent stylesheet.
    """

    def test_hex_is_accepted(self):
        assert extract_css_theme_color_values(_theme("  --color-primary: #1B5E20;")) == {
            "primary": "#1B5E20"
        }

    def test_oklch_is_accepted(self):
        got = extract_css_theme_color_values(_theme("  --color-primary: oklch(0.55 0.2 250);"))
        assert "primary" in got, "oklch dropped — this is the notation that broke the build"
        assert got["primary"].startswith("#")

    def test_oklch_white_and_black_round_trip(self):
        assert parse_css_color_to_hex("oklch(1 0 0)") == "#ffffff"
        assert parse_css_color_to_hex("oklch(0 0 0)") == "#000000"

    def test_oklch_percentage_lightness_and_alpha(self):
        # `oklch(55% 0.2 250 / 0.8)` is valid CSS; alpha is dropped, not fatal.
        assert parse_css_color_to_hex("oklch(55% 0.2 250 / 0.8)") == parse_css_color_to_hex(
            "oklch(0.55 0.2 250)"
        )

    def test_rgb_matches_the_equivalent_hex(self):
        # Cross-check the conversion against a known-good hex rather than a
        # hand-computed constant.
        assert parse_css_color_to_hex("rgb(27 94 32)") == "#1b5e20"
        assert parse_css_color_to_hex("rgba(27, 94, 32, 0.5)") == "#1b5e20"

    def test_hsl_function_is_accepted(self):
        assert parse_css_color_to_hex("hsl(0 100% 50%)") == "#ff0000"

    @pytest.mark.parametrize("value", ["var(--brand)", "inherit", "", "not-a-colour"])
    def test_unresolvable_values_are_omitted_not_guessed(self, value):
        # A var() reference cannot be resolved without the cascade; inventing a
        # value would put a non-colour in the palette.
        assert parse_css_color_to_hex(value) is None


class TestThemeBlockBraceMatching:
    """The block was matched with ``@theme\\s*\\{(.*?)\\}`` — non-greedy.

    It stopped at the FIRST ``}``, so a comment containing one, or any nested
    block, silently truncated the palette.
    """

    def test_comment_containing_a_brace_does_not_truncate(self):
        css = _theme("  /* palette } end */\n  --color-primary: #1B5E20;\n  --color-surface: #FFF;")
        got = extract_css_theme_color_values(css)
        assert got == {"primary": "#1B5E20", "surface": "#FFF"}

    def test_nested_block_does_not_truncate(self):
        css = _theme("  --color-primary: #1B5E20;\n  .x { color: red }\n  --color-surface: #ABCDEF;")
        assert "surface" in extract_css_theme_color_values(css)

    def test_string_containing_a_brace_does_not_truncate(self):
        css = _theme("  --font-x: \"a}b\";\n  --color-primary: #1B5E20;")
        assert extract_css_theme_color_values(css) == {"primary": "#1B5E20"}

    def test_header_comment_mentioning_at_theme_is_not_mistaken_for_the_block(self):
        # Caught by the contrast fixture, whose header comment says
        # "M3 @theme on-primary / primary also fails WCAG AA". Searching the raw
        # source matched THAT, ran forward to the next `{` (an unrelated empty
        # `@layer exepad-app {}`) and returned an empty body — every token
        # "missing" from a file that had all thirty.
        css = (
            "/* the M3 @theme on-primary pair is documented here */\n"
            "@layer exepad-app {}\n" + _theme("  --color-primary: #1B5E20;")
        )
        assert extract_css_theme_color_values(css) == {"primary": "#1B5E20"}

    def test_no_theme_block_yields_empty(self):
        assert extract_css_theme_color_values(":root { --color-primary: #fff; }") == {}

    def test_unterminated_block_still_yields_what_is_there(self):
        # A truncated file should not throw away declarations that are present.
        assert extract_css_theme_color_values("@theme {\n --color-primary: #1B5E20;") == {
            "primary": "#1B5E20"
        }


class TestResolveM3Palette:
    """`resolve_m3_palette` is the single shared definition of a usable palette.

    Both the write-time rule and the deploy-time reader call it, so they cannot
    disagree — which is precisely what let the broken theme through.
    """

    def test_complete_palette_reports_nothing_missing(self):
        palette, missing = resolve_m3_palette(_full_palette_css())
        assert missing == []
        assert set(palette) >= M3_REQUIRED_PALETTE_TOKENS

    def test_background_is_derived_from_surface(self):
        body = "\n".join(
            f"  --color-{t}: #1B5E20;"
            for t in sorted(M3_REQUIRED_PALETTE_TOKENS - {"background", "on-background"})
        )
        palette, missing = resolve_m3_palette(_theme(body))
        assert missing == [], "background/on-background should alias to surface/on-surface"
        assert palette["background"] == palette["surface"]
        assert palette["on-background"] == palette["on-surface"]

    def test_empty_theme_reports_every_token_missing(self):
        palette, missing = resolve_m3_palette(_theme("  --color-primary: var(--x);"))
        assert palette == {}
        assert len(missing) == len(M3_REQUIRED_PALETTE_TOKENS)

    def test_oklch_palette_now_resolves_completely(self):
        # The exact shape that produced the terminal failure.
        body = "\n".join(
            f"  --color-{t}: oklch(0.55 0.12 250);" for t in sorted(M3_REQUIRED_PALETTE_TOKENS)
        )
        _, missing = resolve_m3_palette(_theme(body))
        assert missing == []
