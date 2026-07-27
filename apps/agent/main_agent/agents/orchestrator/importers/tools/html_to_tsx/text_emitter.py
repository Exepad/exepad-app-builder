"""JSX-safe text node emission.

BeautifulSoup gives us text content as Python strings with HTML entities
already decoded to their Unicode equivalents (``&nbsp;`` → U+00A0,
``&amp;`` → ``&``). When we emit those strings inside a JSX tree, three
characters need attention:

* ``{`` and ``}`` are JSX expression delimiters. A literal ``{`` in
  text must be wrapped in a JSX expression: ``{'{'}``.
* ``<`` is an element-start. BS4 already encodes safe text-vs-tag
  boundaries during parsing, so a literal ``<`` only appears in
  attribute values or pre-formatted blocks. Wrap as ``{'<'}`` for
  defensive correctness.
* ``>`` is allowed inside JSX text (HTML/JSX tolerate it), but some
  linters flag it. Wrap defensively.

The U+00A0 non-breaking space renders identically to ``&nbsp;`` in JSX
and the React DOM, so we keep it as a literal U+00A0 character. No
re-encoding needed.

We also collapse adjacent whitespace-only text nodes between block
elements so the emitted JSX doesn't carry meaningless newlines from the
source HTML formatting. Whitespace BETWEEN inline siblings (anything
that wasn't already collapsed at parse time) survives so the rendered
single-space gaps are preserved.

Public entry: :func:`emit_text`.
"""

from __future__ import annotations

import re

# Characters that need escaping when they appear inside a JSX text node.
# We don't escape ``"`` and ``'`` here — those are JSX attribute concerns
# handled by ``attribute_map.py``.
_JSX_TEXT_ESCAPES: dict[str, str] = {
    "{": "{'{'}",
    "}": "{'}'}",
    "<": "{'<'}",
    ">": "{'>'}",
}

# Match any of the chars above. Used to bypass the loop when text is
# already safe — the common case.
_NEEDS_ESCAPE_RE = re.compile(r"[{}<>]")

# Whitespace-only text nodes between block-level siblings collapse to
# nothing. Between inline siblings they collapse to a single space.
_WHITESPACE_ONLY_RE = re.compile(r"^\s+$")


def emit_text(text: str, *, in_block_context: bool = False) -> str:
    """Return the JSX-safe form of a text node.

    Args:
        text: Raw text from BeautifulSoup (entities already decoded).
        in_block_context: Pass True when the text node sits between two
            block-level siblings (``<div>``, ``<section>``, ``<p>``,
            etc.). Whitespace-only nodes in that position emit empty
            string — the source HTML used them only for formatting.
            Default ``False`` preserves whitespace, matching React's
            inline-flow behavior.

    Returns:
        A string ready to splice into a JSX tree as a child node.
        Empty string when the input is whitespace-only in a block
        context.
    """
    if not text:
        return ""

    # Drop block-context whitespace-only text nodes — they came from
    # source HTML's pretty-printing and would otherwise become awkward
    # whitespace in the JSX output.
    if in_block_context and _WHITESPACE_ONLY_RE.match(text):
        return ""

    # Fast path: nothing to escape.
    if not _NEEDS_ESCAPE_RE.search(text):
        return text

    # Escape every JSX-significant character.
    out: list[str] = []
    for ch in text:
        out.append(_JSX_TEXT_ESCAPES.get(ch, ch))
    return "".join(out)


def is_block_element(tag_name: str) -> bool:
    """Return True for HTML block-level tag names.

    The walker uses this to decide whether to suppress whitespace-only
    text nodes between siblings. The list is the HTML5 block-flow
    default — non-exhaustive but sufficient for the source HTML the
    decomposition runner produces.
    """
    return tag_name.lower() in _BLOCK_ELEMENTS


_BLOCK_ELEMENTS: frozenset[str] = frozenset(
    {
        "address",
        "article",
        "aside",
        "blockquote",
        "body",
        "br",  # line-break — treat as block boundary for whitespace
        "canvas",
        "dd",
        "details",
        "dialog",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "head",
        "header",
        "hr",
        "html",
        "iframe",
        "li",
        "main",
        "nav",
        "noscript",
        "ol",
        "p",
        "picture",
        "pre",
        "section",
        "summary",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "tr",
        "ul",
        "video",
    }
)
