"""Unit tests for the inline-style auto-fixer.

Covers the kebab→camel rewrite for both bare and quoted JSX object keys
inside ``style={{...}}``, plus conversion of HTML-attribute-form
``style="..."`` strings to JSX objects. Idempotence and scope-discipline
(don't touch non-style object literals) are also asserted.
"""

from __future__ import annotations

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_inline_styles import (
    _kebab_to_camel,
    apply_component_inline_styles_fixes,
)


def _apply(tsx: str) -> tuple[str, list[str]]:
    fixes: list[str] = []
    out = apply_component_inline_styles_fixes(tsx, FixContext(), fixes)
    return out, fixes


# ---------------------------------------------------------------------------
# kebab→camel primitive
# ---------------------------------------------------------------------------


def test_kebab_to_camel_simple():
    assert _kebab_to_camel("letter-spacing") == "letterSpacing"
    assert _kebab_to_camel("text-transform") == "textTransform"
    assert _kebab_to_camel("font-size") == "fontSize"


def test_kebab_to_camel_vendor_prefix():
    assert _kebab_to_camel("-webkit-transform") == "WebkitTransform"
    assert _kebab_to_camel("-moz-user-select") == "MozUserSelect"


def test_kebab_to_camel_already_camel_passes_through():
    # No hyphen — falls through unchanged.
    assert _kebab_to_camel("fontSize") == "fontSize"


# ---------------------------------------------------------------------------
# Bare-key kebab inside style={{...}} (the actual bug from the build log)
# ---------------------------------------------------------------------------


def test_bare_kebab_key_in_style_object_rewritten():
    tsx = (
        "function F() { return ("
        '<div style={{ fontFamily: "var(--mono)", letter-spacing: "0.1em", '
        "opacity: 0.6 }}>x</div>"
        "); }"
    )
    out, fixes = _apply(tsx)
    assert "letter-spacing:" not in out
    assert 'letterSpacing: "0.1em"' in out
    assert any("kebab-case" in f for f in fixes)


def test_multiple_bare_kebab_keys_in_one_object():
    tsx = (
        '<div style={{ font-size: "11px", letter-spacing: "0.1em", '
        'text-transform: "uppercase" }}>x</div>'
    )
    out, _ = _apply(tsx)
    assert 'fontSize: "11px"' in out
    assert 'letterSpacing: "0.1em"' in out
    assert 'textTransform: "uppercase"' in out


def test_quoted_kebab_key_in_style_object_rewritten():
    tsx = '<div style={{ "letter-spacing": "0.1em" }}>x</div>'
    out, fixes = _apply(tsx)
    # Once converted the key is a plain identifier (no surrounding quotes).
    assert 'letterSpacing: "0.1em"' in out
    assert '"letter-spacing"' not in out
    assert any("kebab-case" in f for f in fixes)


def test_already_camelcase_object_passes_through_unchanged():
    tsx = '<div style={{ fontSize: "11px", letterSpacing: "0.1em", ' "opacity: 0.6 }}>x</div>"
    out, fixes = _apply(tsx)
    assert out == tsx
    assert fixes == []


def test_mixed_camel_and_kebab_keys_only_kebab_rewritten():
    tsx = '<div style={{ fontSize: 14, "letter-spacing": "0.1em", color: "red" }}' ">x</div>"
    out, _ = _apply(tsx)
    assert "fontSize: 14" in out
    assert 'letterSpacing: "0.1em"' in out
    assert 'color: "red"' in out


# ---------------------------------------------------------------------------
# HTML-attribute-form style="..." → JSX object
# ---------------------------------------------------------------------------


def test_html_form_style_string_converted_to_jsx_object():
    tsx = '<div style="font-size:11px; letter-spacing:0.1em; opacity:0.6">x</div>'
    out, fixes = _apply(tsx)
    # The converted form uses single-quoted string values for px sizes and
    # bare numeric for opacity — see the docstring.
    assert "style={{ " in out
    assert "fontSize: '11px'" in out
    assert "letterSpacing: '0.1em'" in out
    assert "opacity: 0.6" in out
    assert any("HTML-form" in f for f in fixes)


def test_html_form_style_string_with_var_kept_as_string():
    tsx = '<div style="font-family:var(--mono); color:red">x</div>'
    out, _ = _apply(tsx)
    assert "fontFamily: 'var(--mono)'" in out
    assert "color: 'red'" in out


def test_html_form_style_with_template_literal_left_alone():
    # ``${...}`` syntax means the LLM is constructing a template — we
    # can't safely split on ``;`` so the fixer must bail.
    tsx = '<div style="color:${color}; font-size:12px">x</div>'
    out, _ = _apply(tsx)
    assert out == tsx  # untouched


def test_empty_html_form_style_becomes_empty_object():
    tsx = '<div style="">x</div>'
    out, _ = _apply(tsx)
    assert "style={{}}" in out


# ---------------------------------------------------------------------------
# Scope discipline + idempotence
# ---------------------------------------------------------------------------


def test_non_style_object_literal_untouched():
    # A function call argument with a kebab-key in a non-style position
    # MUST NOT be rewritten (the regex anchors on ``style={{``).
    tsx = 'const opts = { "letter-spacing": "0.1em" }; ' '<div className="foo">x</div>'
    out, fixes = _apply(tsx)
    assert out == tsx
    assert fixes == []


def test_idempotent_on_second_call():
    tsx = '<div style={{ letter-spacing: "0.1em" }}>x</div>'
    once, _ = _apply(tsx)
    twice, fixes_twice = _apply(once)
    assert twice == once
    assert fixes_twice == []


def test_unbalanced_style_brace_does_not_corrupt_tail():
    # Defensive: malformed input should not eat trailing source.
    tsx = '<div style={{ letter-spacing: "0.1em" >x</div>'
    out, _ = _apply(tsx)
    # Our scanner should bail and leave the rest intact.
    assert "<div " in out and "x</div>" in out


# ---------------------------------------------------------------------------
# End-to-end: the exact MainFooter syntax error from the build log
# ---------------------------------------------------------------------------


def test_main_footer_real_world_failure_recoverable():
    """The actual TSX that broke esbuild during the Happy Doods build."""
    tsx = (
        "function MainFooter() {\n"
        "  return (\n"
        "    <div style={{\n"
        '      fontFamily: "var(--mono)",\n'
        '      fontSize: "11px",\n'
        '      letter-spacing: "0.1em",\n'
        "      opacity: 0.6,\n"
        '      textTransform: "uppercase",\n'
        "    }}>\n"
        "      438 Willow Creek Rd\n"
        "    </div>\n"
        "  );\n"
        "}\n"
    )
    out, _ = _apply(tsx)
    assert "letter-spacing:" not in out
    assert "letterSpacing:" in out
