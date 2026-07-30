"""R6 regression — ``<Icons.X className="text-Nxl ...">`` should get
``w-N h-N`` sizing translated from the font-size class.

Lucide SVGs ignore ``text-*`` font sizing; without explicit ``w-/h-``
they render at the default 24×24. App ``9vvnqllg`` (chick-farm4017,
2026-05-16): hero decorative icons (Egg 30rem, Leaf 160px, MapPin 6xl,
Heart unsized) all rendered tiny.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_icons import (
    _apply_lucide_sizing_translation,
    apply_component_icons_fixes,
    _is_lucide_size_token,
    _has_explicit_sizing,
)

pytestmark = [pytest.mark.unit]


# ---------------------------------------------------------------------------
# Token classifier — distinguish font-size from color
# ---------------------------------------------------------------------------


class TestIsLucideSizeToken:
    def test_named_scale_resolves(self):
        assert _is_lucide_size_token("text-6xl") == "w-16 h-16"
        assert _is_lucide_size_token("text-xl") == "w-6 h-6"
        assert _is_lucide_size_token("text-base") == "w-4 h-4"

    def test_arbitrary_rem(self):
        assert _is_lucide_size_token("text-[30rem]") == "w-[30rem] h-[30rem]"

    def test_arbitrary_px(self):
        assert _is_lucide_size_token("text-[160px]") == "w-[160px] h-[160px]"

    def test_color_token_returns_none(self):
        # These are COLOR not SIZE — must not be treated as sizing.
        assert _is_lucide_size_token("text-primary") is None
        assert _is_lucide_size_token("text-on-surface") is None
        assert _is_lucide_size_token("text-white") is None
        assert _is_lucide_size_token("text-red-500") is None
        assert _is_lucide_size_token("text-on-tertiary-container") is None


class TestHasExplicitSizing:
    def test_w_or_h_class_counts(self):
        assert _has_explicit_sizing(["w-6", "text-primary"])
        assert _has_explicit_sizing(["h-6", "text-primary"])
        assert _has_explicit_sizing(["size-6"])

    def test_variant_prefix_still_counts(self):
        assert _has_explicit_sizing(["md:w-8"])
        assert _has_explicit_sizing(["hover:h-12"])

    def test_no_sizing_returns_false(self):
        assert not _has_explicit_sizing(["text-6xl", "absolute", "opacity-10"])


# ---------------------------------------------------------------------------
# Translation — the four chick-farm cases
# ---------------------------------------------------------------------------


def _fixes() -> list[str]:
    return []


class TestApplySizingTranslation:
    def test_home_content_egg_arbitrary_size(self):
        tsx = '<Icons.Egg className="text-[30rem] leading-none" />'
        out = _apply_lucide_sizing_translation(tsx, _fixes())
        assert 'w-[30rem] h-[30rem]' in out
        assert 'text-[30rem]' not in out
        assert 'leading-none' in out

    def test_contact_us_map_pin_text_6xl(self):
        tsx = (
            '<Icons.MapPin className="text-6xl absolute -bottom-4 -right-4 '
            'opacity-10 group-hover:scale-110 transition-transform" />'
        )
        out = _apply_lucide_sizing_translation(tsx, _fixes())
        assert 'w-16 h-16' in out
        assert 'text-6xl' not in out
        assert 'absolute' in out
        assert 'opacity-10' in out

    def test_our_products_leaf_arbitrary_px(self):
        tsx = '<Icons.Leaf className="text-[160px] text-secondary" />'
        out = _apply_lucide_sizing_translation(tsx, _fixes())
        assert 'w-[160px] h-[160px]' in out
        assert 'text-[160px]' not in out
        # Color token preserved.
        assert 'text-secondary' in out

    def test_about_us_heart_color_only_left_alone(self):
        # No font-size class at all — fixer no-ops (the icon stays at
        # lucide's 24×24 default). This case needs a separate fix:
        # warn the agent in the polish prompt, not auto-fix.
        tsx = '<Icons.Heart className="text-on-tertiary-container" />'
        out = _apply_lucide_sizing_translation(tsx, _fixes())
        assert out == tsx

    def test_explicit_w_h_preserved(self):
        # The agent already sized it — do not overwrite.
        tsx = '<Icons.Menu className="w-6 h-6 text-xl" />'
        out = _apply_lucide_sizing_translation(tsx, _fixes())
        assert out == tsx

    def test_size_shorthand_preserved(self):
        tsx = '<Icons.X className="size-8 text-2xl" />'
        out = _apply_lucide_sizing_translation(tsx, _fixes())
        assert out == tsx

    def test_records_fix_message(self):
        fixes: list[str] = []
        tsx = '<Icons.Egg className="text-6xl" />'
        _apply_lucide_sizing_translation(tsx, fixes)
        assert len(fixes) == 1
        assert "w-16 h-16" in fixes[0]


# ---------------------------------------------------------------------------
# End-to-end: dispatcher pass applies sizing alongside glyph rewrite
# ---------------------------------------------------------------------------


def _ctx():
    return FixContext(
        expected_component_name="X",
        models=[],
        handlers=[],
        state_keys={},
        page_slugs=[],
        theme_palette={},
    )


class TestApplyComponentIconsFixesEndToEnd:
    def test_glyph_rewrite_carries_sizing_translation(self):
        # Source: a Material Symbols span sized with text-6xl. After the
        # full fixer pass we expect (a) <Icons.Egg>, (b) sized w-16 h-16.
        tsx = (
            'import { React, Icons } from "@exepad/sdk";\n'
            "function X(){return <span "
            'className="material-symbols-outlined text-6xl text-primary">'
            "egg</span>;}\n"
        )
        fixes: list[str] = []
        out = apply_component_icons_fixes(tsx, _ctx(), fixes)
        assert "<Icons.Egg" in out
        assert "w-16 h-16" in out
        assert "text-6xl" not in out
        # Color preserved.
        assert "text-primary" in out
