"""Tests for ``_prefix_theme_custom_properties``.

Tailwind v4 rejects ``@theme { font-mono: ...; }`` with
``@theme blocks must only contain custom properties or @keyframes``.
The DesignImporter occasionally drops the ``--`` prefix on tokens it
introduces from the source design (font-mono is the recurring offender).
The healer scans every ``@theme {...}`` block and prefixes any bare
property declaration.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.final_compile_gate import (
    _prefix_theme_custom_properties,
    _rewrite_theme_block_body,
)

pytestmark = [pytest.mark.unit]


class TestSingleBlock:
    def test_bare_font_mono_gets_prefixed(self):
        # Production failure pattern from the Onix run.
        css = """\
@theme {
  --color-primary: #4DA3FF;
  font-mono: "JetBrains Mono", ui-monospace, monospace;
  --font-sans: "Inter", sans-serif;
}
"""
        out, fixes = _prefix_theme_custom_properties(css)
        assert "--font-mono:" in out
        assert "  font-mono:" not in out  # bare form gone
        assert any("font-mono" in f for f in fixes)
        # Already-prefixed lines untouched.
        assert "--color-primary: #4DA3FF;" in out
        assert "--font-sans:" in out

    def test_already_prefixed_unchanged(self):
        css = """\
@theme {
  --color-primary: #4DA3FF;
  --font-mono: "JetBrains Mono", monospace;
}
"""
        out, fixes = _prefix_theme_custom_properties(css)
        assert out == css
        assert fixes == []

    def test_multiple_bare_properties(self):
        css = """\
@theme {
  font-mono: monospace;
  font-sans: sans-serif;
  color-brand: #ff0000;
}
"""
        out, fixes = _prefix_theme_custom_properties(css)
        assert "--font-mono:" in out
        assert "--font-sans:" in out
        assert "--color-brand:" in out
        assert len(fixes) == 3


class TestNestedKeyframes:
    def test_keyframes_inside_theme_left_alone(self):
        # Tailwind v4 explicitly allows @keyframes inside @theme. The
        # healer must NOT prefix bare names inside the keyframes body
        # (``transform: ...`` would be wrong as ``--transform: ...``).
        css = """\
@theme {
  font-mono: monospace;
  @keyframes spin {
    0% {
      transform: rotate(0deg);
      opacity: 0.5;
    }
    100% {
      transform: rotate(360deg);
      opacity: 1;
    }
  }
}
"""
        out, fixes = _prefix_theme_custom_properties(css)
        # The bare ``font-mono`` at the top got prefixed.
        assert "--font-mono:" in out
        # The bare names INSIDE @keyframes did NOT get prefixed.
        assert "transform: rotate(0deg)" in out
        assert "transform: rotate(360deg)" in out
        assert "--transform:" not in out
        assert "--opacity:" not in out


class TestMultipleBlocks:
    def test_multiple_theme_blocks_all_processed(self):
        # Some apps use a separate @theme block for dark-mode tokens.
        css = """\
@theme {
  font-mono: monospace;
}

@theme {
  color-extra: red;
}
"""
        out, fixes = _prefix_theme_custom_properties(css)
        assert "--font-mono:" in out
        assert "--color-extra:" in out
        assert len(fixes) == 2


class TestPreservesNonThemeContent:
    def test_only_theme_blocks_touched(self):
        # A bare ``font-mono:`` outside @theme is a regular CSS
        # property declaration (whether it has any meaning depends on
        # context). The healer must NOT modify it.
        css = """\
:root {
  font-mono: ignored;
}

@theme {
  font-mono: monospace;
}

@media (prefers-color-scheme: dark) {
  body {
    background: black;
  }
}
"""
        out, fixes = _prefix_theme_custom_properties(css)
        # Only the @theme one is rewritten.
        assert "--font-mono: monospace;" in out
        # The :root entry stays bare.
        assert ":root {\n  font-mono: ignored;" in out
        assert "background: black;" in out
        assert len(fixes) == 1


class TestComments:
    def test_comments_in_theme_left_alone(self):
        css = """\
@theme {
  /* color tokens */
  --color-primary: blue;
  /* fonts */
  font-mono: monospace;
}
"""
        out, fixes = _prefix_theme_custom_properties(css)
        assert "/* color tokens */" in out
        assert "/* fonts */" in out
        assert "--font-mono: monospace;" in out


class TestEdgeCases:
    def test_empty_theme_block(self):
        css = "@theme { }"
        out, fixes = _prefix_theme_custom_properties(css)
        assert out == css
        assert fixes == []

    def test_no_theme_blocks(self):
        css = ":root { --color: red; } body { margin: 0; }"
        out, fixes = _prefix_theme_custom_properties(css)
        assert out == css
        assert fixes == []

    def test_unbalanced_braces_does_not_crash(self):
        # Defensive: malformed CSS shouldn't blow up; healer should
        # emit what it can and bail.
        css = "@theme { font-mono: monospace;"  # missing close brace
        out, fixes = _prefix_theme_custom_properties(css)
        # Should not raise.
        assert isinstance(out, str)
        assert isinstance(fixes, list)


class TestRewriteBlockBody:
    def test_indentation_preserved(self):
        body = "    font-mono: monospace;\n    --color-primary: blue;\n"
        out, fixes = _rewrite_theme_block_body(body)
        assert "    --font-mono: monospace;\n" in out
        assert "    --color-primary: blue;\n" in out
        assert len(fixes) == 1
