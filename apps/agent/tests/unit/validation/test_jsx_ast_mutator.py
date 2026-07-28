"""Tests for the ``JsxAstMutator`` helper (Change H.1).

The mutator's contract:

* ``iter_classnames`` enumerates static className sites with byte ranges
  bracketing the inner text (no quotes/backticks).
* ``iter_jsx_attributes`` enumerates any attribute by name and classifies
  its value shape (flag / string / static template / opaque expression).
* ``queue_replace`` queues byte-range edits; ``build`` applies them
  right-to-left, refusing to splice overlapping edits.
* Mutating only inside known JSX value spans never crosses a JSX
  boundary, so SVG strings, JSX prose, and template substitutions are
  structurally untouchable.

These tests are also documentation: they pin the behaviours migrated
fixers (``component_polishing``, …) rely on, plus the contracts future
Change J migrations will depend on (kebab-case attributes, source-order
iteration across nested self-closing elements, etc.).
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast.mutator import (
    ClassNameSite,
    JsxAstMutator,
    JsxAttributeSite,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Construction / parsability
# --------------------------------------------------------------------------- #


def test_mutator_parses_well_formed_tsx():
    src = "const x = <div className=\"a\">hi</div>;"
    m = JsxAstMutator(src)
    assert m.parsed is True
    assert m.source == src


def test_mutator_handles_unparseable_source_gracefully():
    """Even garbage parses in tree-sitter (it produces an ERROR tree),
    so the harness must not raise. Iterators may yield nothing on such
    inputs; ``build`` returns the source unchanged when no edits queued.
    """
    src = "this is not(((( valid TSX"
    m = JsxAstMutator(src)
    # parser doesn't actually fail on garbage — tree-sitter recovers.
    # Important contract: no exception escapes the constructor and
    # build() returns the source unchanged with no edits queued.
    assert m.build() == src


def test_mutator_build_with_no_edits_returns_source_unchanged():
    src = "<div />"
    assert JsxAstMutator(src).build() == src


# --------------------------------------------------------------------------- #
# iter_classnames
# --------------------------------------------------------------------------- #


def test_iter_classnames_yields_static_string_value():
    src = '<div className="a b c">hi</div>'
    sites = list(JsxAstMutator(src).iter_classnames())
    assert len(sites) == 1
    site = sites[0]
    assert isinstance(site, ClassNameSite)
    assert site.class_text == "a b c"
    assert src.encode("utf-8")[site.inner_start : site.inner_end].decode("utf-8") == "a b c"


def test_iter_classnames_yields_braced_string_value():
    src = '<div className={"x y"} />'
    sites = list(JsxAstMutator(src).iter_classnames())
    assert len(sites) == 1
    assert sites[0].class_text == "x y"


def test_iter_classnames_strips_template_substitutions():
    src = "<div className={`base ${dynamic} more`} />"
    sites = list(JsxAstMutator(src).iter_classnames())
    # Static template with substitutions should NOT yield a span — we'd
    # rewrite the substitution body.
    assert sites == []


def test_iter_classnames_skips_opaque_dynamic_classnames():
    src = "<div className={cn('x', y)} />"
    sites = list(JsxAstMutator(src).iter_classnames())
    assert sites == []


def test_iter_classnames_yields_each_jsx_element():
    src = '<div className="a"><span className="b" /></div>'
    sites = list(JsxAstMutator(src).iter_classnames())
    assert sorted(s.class_text for s in sites) == ["a", "b"]


# --------------------------------------------------------------------------- #
# iter_jsx_attributes
# --------------------------------------------------------------------------- #


def test_iter_jsx_attributes_string_value():
    src = '<img alt="a cat" src="x.png" />'
    sites = list(JsxAstMutator(src).iter_jsx_attributes("alt"))
    assert len(sites) == 1
    site = sites[0]
    assert isinstance(site, JsxAttributeSite)
    assert site.value_kind == "string"
    assert site.value_text == "a cat"


def test_iter_jsx_attributes_flag_attribute():
    src = "<input disabled />"
    sites = list(JsxAstMutator(src).iter_jsx_attributes("disabled"))
    assert len(sites) == 1
    assert sites[0].value_kind == "flag"
    assert sites[0].value_text is None
    assert sites[0].inner_start is None


def test_iter_jsx_attributes_static_template():
    src = "<div title={`hello world`} />"
    sites = list(JsxAstMutator(src).iter_jsx_attributes("title"))
    assert len(sites) == 1
    assert sites[0].value_kind == "template"
    assert sites[0].value_text == "hello world"


def test_iter_jsx_attributes_dynamic_template_classified_as_expression():
    src = "<div title={`hi ${name}`} />"
    sites = list(JsxAstMutator(src).iter_jsx_attributes("title"))
    assert len(sites) == 1
    assert sites[0].value_kind == "expression"
    assert sites[0].value_text is None


def test_iter_jsx_attributes_opaque_expression():
    src = "<div onClick={() => fn()} />"
    sites = list(JsxAstMutator(src).iter_jsx_attributes("onClick"))
    assert len(sites) == 1
    assert sites[0].value_kind == "expression"


def test_iter_jsx_attributes_returns_nothing_for_missing_name():
    src = "<div />"
    assert list(JsxAstMutator(src).iter_jsx_attributes("alt")) == []


def test_iter_jsx_attributes_handles_kebab_case_names():
    """The a11y fixer needs to mutate ``aria-label``, ``data-state``, etc.
    Tree-sitter parses kebab-case attribute names as a single property
    identifier — the mutator must match the literal string.
    """
    src = '<button aria-label="Close" data-state="open" />'
    m = JsxAstMutator(src)
    aria = list(m.iter_jsx_attributes("aria-label"))
    state = list(m.iter_jsx_attributes("data-state"))
    assert len(aria) == 1 and aria[0].value_text == "Close"
    assert len(state) == 1 and state[0].value_text == "open"


def test_iter_jsx_attributes_yields_each_occurrence_in_source_order():
    """Each JSX element with the named attribute is yielded once, in
    source-order. Useful for fixers that walk multiple icon-only buttons.
    """
    src = (
        '<div>'
        '<button aria-label="A" />'
        '<button aria-label="B" />'
        '<button aria-label="C" />'
        '</div>'
    )
    sites = list(JsxAstMutator(src).iter_jsx_attributes("aria-label"))
    assert [s.value_text for s in sites] == ["A", "B", "C"]


# --------------------------------------------------------------------------- #
# queue_replace + build
# --------------------------------------------------------------------------- #


def test_queue_replace_inside_classname_inner_span_rewrites_text():
    src = '<div className="bg-primary/80 text-on-primary">hi</div>'
    m = JsxAstMutator(src)
    site = next(m.iter_classnames())
    new_text = site.class_text.replace("bg-primary/80", "bg-primary/30")
    m.queue_replace(site.inner_start, site.inner_end, new_text)
    out = m.build()
    assert "bg-primary/30" in out
    assert "bg-primary/80" not in out
    # Surrounding JSX intact.
    assert out.startswith('<div className="')
    assert out.endswith("</div>")


def test_build_applies_multiple_edits_in_source_order():
    src = '<div><span className="x" /><span className="y" /></div>'
    m = JsxAstMutator(src)
    for site in m.iter_classnames():
        m.queue_replace(site.inner_start, site.inner_end, site.class_text + "-rewritten")
    out = m.build()
    assert 'className="x-rewritten"' in out
    assert 'className="y-rewritten"' in out


def test_build_is_idempotent_on_repeated_calls():
    src = '<div className="a" />'
    m = JsxAstMutator(src)
    site = next(m.iter_classnames())
    m.queue_replace(site.inner_start, site.inner_end, "b")
    first = m.build()
    second = m.build()
    assert first == second
    assert first == '<div className="b" />'


def test_queue_replace_after_build_raises():
    src = '<div className="a" />'
    m = JsxAstMutator(src)
    m.build()
    site_inner = m.source.index('"') + 1
    with pytest.raises(RuntimeError, match="after build"):
        m.queue_replace(site_inner, site_inner + 1, "z")


def test_queue_replace_rejects_negative_or_oob_offsets():
    src = "<div />"
    m = JsxAstMutator(src)
    with pytest.raises(ValueError):
        m.queue_replace(-1, 0, "")
    with pytest.raises(ValueError):
        m.queue_replace(0, len(src) + 5, "")


def test_queue_replace_rejects_inverted_range():
    src = "<div />"
    m = JsxAstMutator(src)
    with pytest.raises(ValueError):
        m.queue_replace(3, 1, "")


def test_build_rejects_overlapping_edits():
    src = '<div className="abcdefghij" />'
    m = JsxAstMutator(src)
    site = next(m.iter_classnames())
    # Two edits that overlap on the className inner span.
    m.queue_replace(site.inner_start, site.inner_start + 5, "X")
    m.queue_replace(site.inner_start + 3, site.inner_end, "Y")
    with pytest.raises(ValueError, match="overlapping"):
        m.build()


def test_build_allows_adjacent_non_overlapping_edits():
    src = '<div className="abcdefghij" />'
    m = JsxAstMutator(src)
    site = next(m.iter_classnames())
    # Adjacent splices: [0,5) and [5,10).
    m.queue_replace(site.inner_start, site.inner_start + 5, "X")
    m.queue_replace(site.inner_start + 5, site.inner_end, "Y")
    out = m.build()
    assert 'className="XY"' in out


# --------------------------------------------------------------------------- #
# Structural-safety property: edits to className inner spans never break JSX.
# --------------------------------------------------------------------------- #


def test_classname_mutation_preserves_jsx_structure_with_quoted_svg_string():
    """The classic regex-on-raw-TSX corruption: a raw regex over
    ``className="[^"]*"`` happily matches inside SVG ``d="..."`` strings
    or comment text. The mutator only emits edits inside its own
    classname spans, so SVG path data is untouchable.
    """
    src = (
        "<svg>\n"
        "  <path d=\"M10 10 L20 20 className=\\\"fake\\\"\" />\n"
        '  <g className="real-class" />\n'
        "</svg>"
    )
    m = JsxAstMutator(src)
    sites = list(m.iter_classnames())
    # Only the real className on <g> matches; the SVG d= attribute is a
    # different attribute name, so iter_classnames cannot see it.
    assert len(sites) == 1
    assert sites[0].class_text == "real-class"
    # Mutate it.
    m.queue_replace(sites[0].inner_start, sites[0].inner_end, "rewritten")
    out = m.build()
    # SVG d= attribute survives untouched.
    assert "M10 10 L20 20" in out
    assert 'className="rewritten"' in out


def test_template_substitution_is_not_mutated_even_when_yielded():
    """Static-template attribute values are eligible for mutation, but
    dynamic templates with ``${...}`` are NOT yielded — so a fixer that
    rewrites the inner span can't accidentally splice over a substitution.
    """
    src = "<div className={`x-${dyn}-y`} />"
    sites = list(JsxAstMutator(src).iter_classnames())
    assert sites == []  # dynamic template — not exposed to fixers


def test_build_preserves_surrounding_text_outside_edits():
    src = (
        "import React from \"react\";\n"
        "const C = () => <div className=\"a\">prose</div>;\n"
        "export default C;\n"
    )
    m = JsxAstMutator(src)
    site = next(m.iter_classnames())
    m.queue_replace(site.inner_start, site.inner_end, "b")
    out = m.build()
    assert out == (
        "import React from \"react\";\n"
        "const C = () => <div className=\"b\">prose</div>;\n"
        "export default C;\n"
    )


# --------------------------------------------------------------------------- #
# Multi-byte safety: byte offsets must align with UTF-8.
# --------------------------------------------------------------------------- #


def test_classname_mutation_handles_multibyte_prose():
    """Tree-sitter byte offsets are into UTF-8. The harness encodes the
    source once, splices in bytes, then decodes — non-ASCII content
    elsewhere in the source does not skew the mutation site.
    """
    src = '<div className="bg-primary">Hëllo, wörld 🌍</div>'
    m = JsxAstMutator(src)
    site = next(m.iter_classnames())
    m.queue_replace(site.inner_start, site.inner_end, "bg-secondary")
    out = m.build()
    assert 'className="bg-secondary"' in out
    assert "Hëllo, wörld 🌍" in out


def test_queued_edit_count_tracks_queue_size():
    src = '<div className="a"><span className="b" /></div>'
    m = JsxAstMutator(src)
    assert m.queued_edit_count == 0
    for site in m.iter_classnames():
        m.queue_replace(site.inner_start, site.inner_end, "z")
    assert m.queued_edit_count == 2


def test_iter_classnames_yields_in_source_order_for_nested_self_closing():
    """Regression guard for the ``iter_jsx_opening_elements`` ordering bug.

    The historical implementation grouped all opening elements first, then
    all self-closing elements. When a self-closing JSX element with a
    static className was nested INSIDE an opening one, and a sibling
    outer opening element with a className came after, the iterator
    yielded spans out of source order — and ``rewrite_classname_text``
    spliced them left-to-right, dropping prose and re-emitting earlier
    bytes. Result: a self-closing duplicate of one button got injected
    between siblings (regression-corpus fixture 10's ze1ltmf9 corruption).

    This test pins the source-order contract: classNames must be yielded
    in increasing ``inner_start`` byte order regardless of element kind.
    """
    src = (
        '<div>'
        '<button className="first">'
        '<Trash2 className="icon-1" />'
        '</button>'
        '<button className="second">'
        '<Pencil className="icon-2" />'
        '</button>'
        '</div>'
    )
    sites = list(JsxAstMutator(src).iter_classnames())
    starts = [s.inner_start for s in sites]
    assert starts == sorted(starts), (
        f"iter_classnames must yield in source order; got {starts}"
    )
    assert [s.class_text for s in sites] == [
        "first",
        "icon-1",
        "second",
        "icon-2",
    ]


def test_classname_rewrite_does_not_corrupt_with_nested_self_closing():
    """End-to-end: rewriting every className via the mutator must
    preserve JSX structure when self-closing elements are nested inside
    opening ones with classNames.
    """
    src = (
        '<div>'
        '<button className="first">'
        '<Trash2 className="icon-1" />'
        '</button>'
        '<button className="second">'
        '<Pencil className="icon-2" />'
        '</button>'
        '</div>'
    )
    m = JsxAstMutator(src)
    for site in m.iter_classnames():
        m.queue_replace(site.inner_start, site.inner_end, site.class_text + "-x")
    out = m.build()
    assert out == (
        '<div>'
        '<button className="first-x">'
        '<Trash2 className="icon-1-x" />'
        '</button>'
        '<button className="second-x">'
        '<Pencil className="icon-2-x" />'
        '</button>'
        '</div>'
    )
