"""Regression tests for app ``mr5czdwj`` icon-chain + CSS-url fixes.

- Fix A: ``apply_icon_fallback_only`` collapses chained ``Icons.<A>.<B>``
  to the leaf icon (a chain is a guaranteed React #130 crash).
- Fix B: the fuzzy matcher no longer collapses ``Icons.Icons`` → ``Icons.X``
  (the ``*Icon`` alias forms are excluded from the difflib pool).
- Fix E: ``apply_component_urls_images_fixes`` no longer ships a dangling
  ``bg-[url('__PLACEHOLDER__')]`` arbitrary class (CSS url() has no
  downstream resolver, unlike ``<img>`` / data-array placeholders).
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_urls_images import (
    apply_component_urls_images_fixes,
    apply_icon_fallback_only,
)

pytestmark = [pytest.mark.unit]


class TestIconChainCollapse:
    def test_double_namespace_chain_collapsed(self):
        # The exact production shape before the deterministic fixer ran.
        out, fixes = apply_icon_fallback_only("<Icons.Icons.Pinterest />")
        assert "Icons.Icons" not in out
        assert ".Pinterest" not in out  # leaf resolved away (Pinterest∉lucide)
        assert "Icons.X.Pinterest" not in out
        assert any("Chained icon access" in f for f in fixes)

    def test_valid_base_chain_collapsed(self):
        # The exact shipped shape (post-fuzzy-corruption) must also heal.
        out, _ = apply_icon_fallback_only("<Icons.X.Pinterest />")
        assert ".Pinterest" not in out
        assert "Icons.X." not in out

    def test_single_segment_valid_icon_untouched(self):
        out, fixes = apply_icon_fallback_only("<Icons.Menu />")
        assert out == "<Icons.Menu />"
        assert fixes == []


class TestFuzzyNoSingleLetterCollapse:
    def test_icons_icons_does_not_become_icons_x(self):
        # Bare ``Icons.Icons`` (no chain) must fall through to the safe
        # fallback, never the single-letter ``Icons.X``.
        out, _ = apply_icon_fallback_only("<Icons.Icons />")
        assert "Icons.X" not in out
        assert "Icons.Circle" in out


class TestCssUrlPlaceholder:
    def _ctx(self) -> FixContext:
        return FixContext()

    def test_bg_url_arbitrary_class_dropped(self):
        tsx = (
            "function C(){return ("
            '<div className="absolute inset-0 opacity-[0.03] '
            "bg-[url('https://www.transparenttextures.com/p/foo.png')]\" />"
            ");}"
        )
        fixes: list[str] = []
        out = apply_component_urls_images_fixes(tsx, self._ctx(), fixes)
        assert "__PLACEHOLDER__" not in out
        assert "transparenttextures" not in out
        # The other utility classes survive.
        assert "opacity-[0.03]" in out

    def test_inline_style_url_neutralized_to_none(self):
        tsx = (
            "function C(){return ("
            "<div style={{ backgroundImage: "
            "\"url('https://example.com/x.png')\" }} />"
            ");}"
        )
        fixes: list[str] = []
        out = apply_component_urls_images_fixes(tsx, self._ctx(), fixes)
        assert "__PLACEHOLDER__" not in out
        assert "url(none)" in out or "none" in out
