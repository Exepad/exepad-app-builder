"""Tests for the JSX-text unicode-escape decoder (app ``mr5czdwj``).

The ComponentBuilder emitted typographic characters as backslash-u escape
sequences inside JSX *text* children, where they render verbatim instead
of decoding. The fixer decodes them — but ONLY inside ``jsx_text`` nodes,
never inside JS string / template literals (whose escapes are correct).

The literal escape sequence is built from ``chr(92)`` (a backslash) so the
test source is unambiguous regardless of how the editor handles ``\\u``.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_jsx_text_escapes import (
    apply_component_jsx_text_escape_fixes,
)

pytestmark = [pytest.mark.unit]

BS = chr(92)  # backslash
LDQUO_ESC = BS + "u201C"  # literal 6-char escape for “
RDQUO_ESC = BS + "u201D"  # literal 6-char escape for ”
EMDASH_ESC = BS + "u2014"  # literal 6-char escape for —
LDQUO = chr(0x201C)
RDQUO = chr(0x201D)
EMDASH = chr(0x2014)


def _run(tsx: str) -> tuple[str, list[str]]:
    fixes: list[str] = []
    out = apply_component_jsx_text_escape_fixes(tsx, FixContext(), fixes)
    return out, fixes


class TestDecodesJsxText:
    def test_curly_quotes_in_paragraph(self):
        tsx = f"function C(){{return <p>{LDQUO_ESC}Best bakery{RDQUO_ESC}</p>;}}"
        out, fixes = _run(tsx)
        assert LDQUO_ESC not in out
        assert f"<p>{LDQUO}Best bakery{RDQUO}</p>" in out
        assert len(fixes) == 1
        assert "Decoded" in fixes[0]

    def test_em_dash_in_span(self):
        tsx = f"function C(){{return <span>Open 7 AM {EMDASH_ESC} 4 PM</span>;}}"
        out, _ = _run(tsx)
        assert EMDASH_ESC not in out
        assert f"7 AM {EMDASH} 4 PM" in out


class TestLeavesLiteralsAlone:
    def test_string_literal_escape_untouched(self):
        # The escape inside a JS string literal is CORRECT — must not change.
        tsx = "function C(){" f'const msg = "{LDQUO_ESC}hi{RDQUO_ESC}";' "return <div>{msg}</div>;}"
        out, fixes = _run(tsx)
        assert out == tsx
        assert fixes == []

    def test_no_escapes_is_noop(self):
        tsx = "function C(){return <p>Plain text</p>;}"
        out, fixes = _run(tsx)
        assert out == tsx
        assert fixes == []

    def test_attribute_value_untouched(self):
        # Escapes in attribute string values decode at runtime — leave them.
        tsx = f'function C(){{return <div title="{LDQUO_ESC}x{RDQUO_ESC}" />;}}'
        out, fixes = _run(tsx)
        assert out == tsx
        assert fixes == []
