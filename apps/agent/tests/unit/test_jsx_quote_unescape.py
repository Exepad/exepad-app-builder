"""Tests for the stringified-JSX healer.

Production trace evidence: Onix Studio runs 4 and 5 hit
``Expected "{" but found "\\""`` esbuild syntax errors because the
ComponentBuilder LLM emitted JSX attributes with ``\\"`` instead of
``"``. The healer detects the systematic bug shape and unescapes the
whole file when it fires.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.jsx_quote_unescape import unescape_jsx_quotes

pytestmark = [pytest.mark.unit]


class TestSystematicBugFires:
    def test_repairs_broken_jsx_attribute(self):
        # The exact production failure pattern from Onix Studio run 5.
        broken = '<section className=\\"hero\\" id=\\"top\\">'
        out, count = unescape_jsx_quotes(broken)
        assert out == '<section className="hero" id="top">'
        assert count == 4  # 4 instances of \"

    def test_repairs_full_component(self):
        broken = (
            'import { React } from "@exepad/sdk";\n'
            "function Hero() {\n"
            "  return (\n"
            '    <section className=\\"hero\\" id=\\"top\\">\n'
            '      <h1 className=\\"title\\">Hello</h1>\n'
            "    </section>\n"
            "  );\n"
            "}\n"
        )
        out, count = unescape_jsx_quotes(broken)
        assert '\\"' not in out
        assert 'className="hero"' in out
        assert 'className="title"' in out
        # The clean ``"@exepad/sdk"`` import was already correct, no \"
        # there to begin with — no double-rewrite.
        assert 'from "@exepad/sdk"' in out
        assert count == 6  # 3 attrs × 2 quotes each


class TestCleanInputUnchanged:
    def test_clean_jsx_unchanged(self):
        clean = '<div className="hero" id="top">Hello</div>'
        out, count = unescape_jsx_quotes(clean)
        assert out == clean
        assert count == 0

    def test_legitimate_string_escape_left_alone(self):
        # When NO broken JSX pattern is detected, the healer must not
        # touch ``\\"`` inside JS string literals (legitimate escapes).
        legit = """
const msg = "say \\"hi\\"";
const greeting = `welcome \\"friend\\"`;
return <div>{msg}</div>;
"""
        out, count = unescape_jsx_quotes(legit)
        assert out == legit
        assert count == 0

    def test_empty_string(self):
        out, count = unescape_jsx_quotes("")
        assert out == ""
        assert count == 0


class TestBugDetectionAnchors:
    def test_attr_followed_by_whitespace_triggers(self):
        # ``=\\"foo\\"<space>`` — typical when there's a next attribute.
        broken = '<a href=\\"/about\\" target=\\"_blank\\">'
        out, count = unescape_jsx_quotes(broken)
        assert '\\"' not in out
        assert count == 4

    def test_attr_followed_by_gt_triggers(self):
        # ``=\\"foo\\">`` — last attribute before tag close.
        broken = '<input value=\\"hi\\">'
        out, count = unescape_jsx_quotes(broken)
        assert '\\"' not in out
        assert count == 2

    def test_value_with_spaces_and_dashes(self):
        # CSS classnames have spaces and hyphens.
        broken = '<div className=\\"flex items-center gap-2 text-sm\\">'
        out, count = unescape_jsx_quotes(broken)
        assert 'className="flex items-center gap-2 text-sm"' in out

    def test_value_with_hash_and_url_chars(self):
        # ``href=\\"#section\\"`` and ``src=\\"./img.png\\"``.
        broken = '<a href=\\"#contact\\"><img src=\\"./logo.png\\" /></a>'
        out, count = unescape_jsx_quotes(broken)
        assert 'href="#contact"' in out
        assert 'src="./logo.png"' in out


class TestNoOverreach:
    def test_isolated_string_escape_does_not_trigger(self):
        # A single ``"\\""`` in a JS string literal but no JSX attr-shape
        # bug should NOT trigger the systemic rewrite.
        ok = """
function f() {
  const msg = "she said \\"hi\\"";
  return <div>{msg}</div>;
}
"""
        out, count = unescape_jsx_quotes(ok)
        # Healer doesn't fire — count is 0, output unchanged.
        assert out == ok
        assert count == 0

    def test_template_literal_with_escaped_quote_unchanged(self):
        ok = """
const greeting = `say \\"hello\\"`;
return <div>{greeting}</div>;
"""
        out, count = unescape_jsx_quotes(ok)
        assert out == ok
        assert count == 0
