"""Tests for the stitch handler's `tailwind.config.theme.extend.*` lifting.

The Stitch design tool inlines a full Tailwind v3 `theme.extend` block in
each page's `<script id="tailwind-config">` tag. Before the Fix 1.5 change
(RC#11), the importer only lifted `colors` — `borderRadius`, `spacing`,
`fontSize`, `fontFamily`, `boxShadow` were silently dropped, causing
generated apps to use Tailwind v4 defaults (e.g. `rounded-xl: 0.75rem`)
instead of the source design's custom scale (e.g. `xl: "1.25rem"`).

These tests verify the helpers (`_lift_token_section`,
`_stringify_token_value`) write the right CSS var names + values for the
six supported sections. End-to-end coverage that the vars actually land
in the emitted `theme.css` comes from the chick_farm e2e replay.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.stitch import (
    _lift_token_section,
    _stringify_token_value,
)

pytestmark = [pytest.mark.unit]


class TestStringifyTokenValue:
    def test_plain_string_passthrough(self):
        assert _stringify_token_value("1.25rem") == "1.25rem"
        assert _stringify_token_value("#7a5900") == "#7a5900"

    def test_numeric_coerced_to_string(self):
        assert _stringify_token_value(0) == "0"
        assert _stringify_token_value(1.5) == "1.5"

    def test_font_family_list_quoted_when_has_spaces(self):
        # ["Noto Serif"] → '"Noto Serif"'
        assert _stringify_token_value(["Noto Serif"]) == '"Noto Serif"'
        # ["Noto Serif", "serif"] → '"Noto Serif", serif'
        # (single-word names don't get quoted — they're CSS keywords or
        # generic families.)
        assert _stringify_token_value(["Noto Serif", "serif"]) == '"Noto Serif", serif'

    def test_font_size_tuple_keeps_size_only(self):
        # Tailwind fontSize values can be tuples: [size, {lineHeight: ...}]
        # We only need the size — line-height isn't a CSS-var-friendly shape.
        assert _stringify_token_value(["1rem", {"lineHeight": "1.5"}]) == "1rem"

    def test_unrecognised_shape_returns_none(self):
        assert _stringify_token_value({"unexpected": "dict"}) is None
        assert _stringify_token_value(None) is None
        assert _stringify_token_value([]) is None


class TestLiftTokenSection:
    def test_border_radius_lifted_to_radius_vars(self):
        section = {"DEFAULT": "0.25rem", "lg": "1rem", "xl": "1.25rem", "full": "9999px"}
        dest: dict[str, str] = {}
        _lift_token_section(section, "radius", dest)
        # DEFAULT becomes unprefixed `--radius`
        assert dest["--radius"] == "0.25rem"
        assert dest["--radius-lg"] == "1rem"
        assert dest["--radius-xl"] == "1.25rem"
        assert dest["--radius-full"] == "9999px"

    def test_spacing_lifted_to_spacing_vars(self):
        section = {"sm": "0.5rem", "md": "1rem"}
        dest: dict[str, str] = {}
        _lift_token_section(section, "spacing", dest)
        assert dest == {"--spacing-sm": "0.5rem", "--spacing-md": "1rem"}

    def test_font_family_lifted_to_font_vars(self):
        section = {"headline": ["Noto Serif"], "body": ["Plus Jakarta Sans"]}
        dest: dict[str, str] = {}
        _lift_token_section(section, "font", dest)
        assert dest["--font-headline"] == '"Noto Serif"'
        assert dest["--font-body"] == '"Plus Jakarta Sans"'

    def test_font_size_tuple_handled(self):
        section = {"lg": ["1rem", {"lineHeight": "1.5"}], "xl": ["1.25rem"]}
        dest: dict[str, str] = {}
        _lift_token_section(section, "text", dest)
        assert dest["--text-lg"] == "1rem"
        assert dest["--text-xl"] == "1.25rem"

    def test_box_shadow_lifted(self):
        section = {"sm": "0 1px 2px rgba(0,0,0,0.1)"}
        dest: dict[str, str] = {}
        _lift_token_section(section, "shadow", dest)
        assert dest["--shadow-sm"] == "0 1px 2px rgba(0,0,0,0.1)"

    def test_empty_section_is_noop(self):
        dest: dict[str, str] = {}
        _lift_token_section(None, "radius", dest)
        _lift_token_section({}, "radius", dest)
        _lift_token_section("not-a-dict", "radius", dest)  # type: ignore[arg-type]
        assert dest == {}

    def test_destination_preserved_across_calls(self):
        """Each section call appends; nothing pre-existing is touched."""
        dest: dict[str, str] = {"--color-primary": "#000"}
        _lift_token_section({"xl": "1.25rem"}, "radius", dest)
        assert dest == {"--color-primary": "#000", "--radius-xl": "1.25rem"}

    def test_chick_farm_fixture_shape(self):
        """The chick_farm fixture's borderRadius scale (RC#11 reproducer).

        Before Fix 1.5, this was silently dropped; after, it surfaces as
        --radius-* CSS vars that Tailwind v4's `rounded-*` utilities
        resolve against."""
        section = {"DEFAULT": "0.25rem", "lg": "1rem", "xl": "1.25rem", "full": "9999px"}
        dest: dict[str, str] = {}
        _lift_token_section(section, "radius", dest)
        assert dest["--radius-xl"] == "1.25rem"
        # NOT 0.75rem (the Tailwind v4 default) — fidelity preserved.
