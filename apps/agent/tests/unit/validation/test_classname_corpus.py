"""Tests for the className-context AST helpers used by validators / fixers.

Locks the contract that detection/mutation passes scoped via these helpers
NEVER touch source bytes outside JSX className attribute values — SVG
kebab attrs in ``dangerouslySetInnerHTML`` strings, JSX comments, string
literals containing class-shaped words, and code prose all pass through
unchanged.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast import (
    collect_static_classnames,
    iter_classname_value_spans,
    rewrite_classname_text,
)

pytestmark = [pytest.mark.unit]


# =============================================================================
# collect_static_classnames
# =============================================================================


class TestCollectStaticClassnames:
    def test_simple_string_attribute(self):
        tsx = '<div className="bg-primary text-white" />'
        assert collect_static_classnames(tsx) == ["bg-primary text-white"]

    def test_braced_string_attribute(self):
        tsx = '<div className={"bg-primary text-white"} />'
        assert collect_static_classnames(tsx) == ["bg-primary text-white"]

    def test_template_string_no_substitution(self):
        tsx = "<div className={`bg-primary text-white`} />"
        assert collect_static_classnames(tsx) == ["bg-primary text-white"]

    def test_template_substitution_stripped(self):
        tsx = "<div className={`bg-primary ${variant} text-white`} />"
        # ${...} replaced with single space, matching legacy regex behavior.
        result = collect_static_classnames(tsx)
        assert len(result) == 1
        assert "bg-primary" in result[0]
        assert "text-white" in result[0]
        assert "${" not in result[0] and "variant" not in result[0]

    def test_opaque_dynamic_classname_skipped(self):
        tsx = "<div className={getClassName()} />"
        assert collect_static_classnames(tsx) == []

    def test_no_classname_attribute(self):
        tsx = "<div onClick={handler} />"
        assert collect_static_classnames(tsx) == []

    def test_multiple_elements(self):
        tsx = """
        <div className="a">
          <span className="b" />
          <p className="c">x</p>
        </div>
        """
        assert sorted(collect_static_classnames(tsx)) == ["a", "b", "c"]

    def test_self_closing_element(self):
        tsx = '<img className="rounded" src="x.png" />'
        assert collect_static_classnames(tsx) == ["rounded"]

    def test_svg_kebab_attrs_in_dangerously_set_html_NOT_collected(self):
        """Load-bearing test — Issue #2b regression. SVG kebab attributes
        inside ``dangerouslySetInnerHTML`` strings must NOT appear as
        classNames."""
        tsx = """
        const SVG = `<svg><text text-anchor="middle" stroke-width="2" fill-opacity="0.5">x</text></svg>`;
        <div className="real-class" dangerouslySetInnerHTML={{__html: SVG}} />
        """
        result = collect_static_classnames(tsx)
        joined = " ".join(result)
        assert "text-anchor" not in joined
        assert "stroke-width" not in joined
        assert "fill-opacity" not in joined
        assert "real-class" in joined

    def test_classnames_in_comments_NOT_collected(self):
        tsx = """
        // Use bg-secondary on hover
        /* text-blue-500 was the old style */
        <div className="actual-class" />
        """
        result = collect_static_classnames(tsx)
        assert result == ["actual-class"]

    def test_classnames_in_string_literals_NOT_collected(self):
        tsx = """
        const msg = "Try the bg-primary variant";
        <div className="real-class" />
        """
        result = collect_static_classnames(tsx)
        assert result == ["real-class"]

    def test_unparseable_tsx_returns_empty(self):
        # tree-sitter is error-tolerant; even garbage shouldn't crash.
        assert collect_static_classnames("###@@@%%%") == []

    def test_empty_input(self):
        assert collect_static_classnames("") == []


# =============================================================================
# iter_classname_value_spans
# =============================================================================


class TestIterClassnameValueSpans:
    def test_simple_string_span_excludes_quotes(self):
        tsx = '<div className="abc" />'
        spans = iter_classname_value_spans(tsx)
        assert len(spans) == 1
        s, e = spans[0]
        # Inner text must be exactly "abc" — no surrounding quotes.
        assert tsx.encode("utf-8")[s:e].decode("utf-8") == "abc"

    def test_braced_string_span(self):
        tsx = '<div className={"xyz"} />'
        spans = iter_classname_value_spans(tsx)
        s, e = spans[0]
        assert tsx.encode("utf-8")[s:e].decode("utf-8") == "xyz"

    def test_static_template_span(self):
        tsx = "<div className={`xyz`} />"
        spans = iter_classname_value_spans(tsx)
        s, e = spans[0]
        assert tsx.encode("utf-8")[s:e].decode("utf-8") == "xyz"

    def test_template_with_substitution_skipped(self):
        # Spans MUST skip templates with ${...} — splicing inside them
        # would also affect the substitution braces.
        tsx = "<div className={`a ${x} b`} />"
        spans = iter_classname_value_spans(tsx)
        assert spans == []

    def test_opaque_classname_skipped(self):
        tsx = "<div className={fn()} />"
        assert iter_classname_value_spans(tsx) == []

    def test_no_classname_skipped(self):
        tsx = "<div onClick={x} />"
        assert iter_classname_value_spans(tsx) == []

    def test_multiple_elements_yield_multiple_spans(self):
        tsx = '<div className="a"><span className="b" /></div>'
        spans = iter_classname_value_spans(tsx)
        assert len(spans) == 2
        buf = tsx.encode("utf-8")
        texts = sorted(buf[s:e].decode("utf-8") for s, e in spans)
        assert texts == ["a", "b"]

    def test_spans_dont_cover_svg_kebab_attrs(self):
        """Issue #2b regression: spans must NOT cover bytes inside
        ``dangerouslySetInnerHTML`` strings."""
        tsx = """const SVG = `<text text-anchor="middle">`;\n<div className="real" />"""
        spans = iter_classname_value_spans(tsx)
        buf = tsx.encode("utf-8")
        for s, e in spans:
            inner = buf[s:e].decode("utf-8")
            assert "text-anchor" not in inner
            assert inner == "real"


# =============================================================================
# rewrite_classname_text
# =============================================================================


class TestRewriteClassnameText:
    def test_rewrites_only_inside_classnames(self):
        tsx = '<div className="bg-primary/10" />'
        out = rewrite_classname_text(tsx, lambda t: t.replace("bg-primary/10", "bg-primary/30"))
        assert out == '<div className="bg-primary/30" />'

    def test_preserves_text_outside_classnames(self):
        # The "fixer" replaces "/10" with "/30" — must apply only inside
        # className. The same string in a comment / SVG / string literal
        # must pass through unchanged.
        tsx = """
        // bg-foo/10 mentioned in comment
        const SVG = `<rect fill-opacity="/10" />`;
        <div className="bg-primary/10" />
        """
        rewriter = lambda t: t.replace("/10", "/30")  # noqa: E731
        out = rewrite_classname_text(tsx, rewriter)
        # Comment unchanged
        assert "bg-foo/10 mentioned in comment" in out
        # SVG fill-opacity unchanged
        assert 'fill-opacity="/10"' in out
        # className rewritten
        assert 'className="bg-primary/30"' in out

    def test_rewriter_receives_inner_text_without_quotes(self):
        captured: list[str] = []

        def capture(t: str) -> str:
            captured.append(t)
            return t

        tsx = '<div className="abc def" />'
        rewrite_classname_text(tsx, capture)
        assert captured == ["abc def"]

    def test_no_classnames_returns_original(self):
        tsx = "const x = 1;"
        assert rewrite_classname_text(tsx, lambda t: "REPLACED") == tsx

    def test_multiple_elements_each_rewritten_independently(self):
        tsx = '<div className="a"><span className="b" /></div>'
        out = rewrite_classname_text(tsx, lambda t: t.upper())
        assert 'className="A"' in out
        assert 'className="B"' in out

    def test_template_with_substitution_preserved_verbatim(self):
        # rewrite_classname_text skips templates with ${...} — the inner
        # span helper returns no span for them, so the rewriter is never
        # called and the source survives byte-for-byte.
        tsx = "<div className={`bg-${x}-500 hover:bg-blue-600`} />"
        out = rewrite_classname_text(tsx, lambda t: "REPLACED")
        assert out == tsx
