"""``component.codegen.hardcoded_kpi_literal`` — flag KPI cards whose
visible value is a hardcoded literal instead of computed-from-data.

Catches the StayNexus BillingContent failure mode:

    <Card>
      <CardContent>
        <p>Outstanding</p>
        <p>$12,450</p>          ← hardcoded
      </CardContent>
    </Card>

The LLM substitutes plausible-looking numbers when it doesn't have a
clear handler to pull them from.

This rule is heuristic and FP-prone — severity stays ``warning``,
never ``error``. The dampener is "if the enclosing ``<Card>`` subtree
already contains ANY JSX expression (``{...}``), trust the LLM and
skip — they're at least pulling SOME data from somewhere." That's
weak, but pure-literal cards are exactly the bug class we care about.

Out of scope (for v1): hardcoded inline staff / user / role lists like
``[{name:"Sarah", role:"Admin"}, ...]``. The agent docs ban them in
prose; a future rule can detect them via array-literal walking when
the false-positive risk has been characterised.
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import iter_jsx_opening_elements, jsx_tag_name, walk
from .base import AstContext, Finding

_RULE_ID = "component.codegen.hardcoded_kpi_literal"


# A "KPI literal" is text that looks like a money amount, percent, or
# multi-digit count. We accept:
#   ``$12,450``, ``94.2%``, ``1,234``, ``$1.23``, ``42%``
# Total length (after stripping whitespace) must be ≥ 3 chars to filter
# tokens like ``$5`` / ``5%`` that are usually fine. We deliberately
# keep this narrow — false positives hurt this rule's signal.
_KPI_LITERAL_RE = re.compile(r"^[$€£¥]?\d+(?:,\d{3})*(?:\.\d+)?%?$")

# Tags that hold KPI value text. Matching a literal inside `<p>` /
# heading / `<span>` whose enclosing ancestor is a ``<Card>``.
_VALUE_TAGS: frozenset[str] = frozenset({"p", "span", "div", "h1", "h2", "h3", "h4", "h5", "h6"})

# Card-shape ancestor tags. Anything in this set marks a region the
# rule treats as a KPI surface.
_CARD_TAGS: frozenset[str] = frozenset({"Card", "CardContent"})


class HardcodedKpiLiteralRule:
    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        # Walk every Card subtree, deduping by the offending literal's
        # start byte — a literal nested inside
        # ``<Card><CardContent>...</CardContent></Card>`` is reported
        # once, not once per ancestor card-tag.
        emitted_bytes: set[int] = set()
        seen_card: set[int] = set()
        for opening in iter_jsx_opening_elements(ctx.tree.root_node):
            tag = jsx_tag_name(opening, ctx.source_buf)
            if tag not in _CARD_TAGS:
                continue
            card_element = opening.parent  # the surrounding jsx_element
            if card_element is None or card_element.start_byte in seen_card:
                continue
            seen_card.add(card_element.start_byte)
            if _has_any_jsx_expression(card_element):
                # Dampener — this card already pulls from somewhere,
                # don't second-guess.
                continue
            for literal_node, cleaned in _iter_literal_text_nodes(card_element, ctx):
                if literal_node.start_byte in emitted_bytes:
                    continue
                emitted_bytes.add(literal_node.start_byte)
                yield Finding(
                    rule_id=_RULE_ID,
                    severity="warning",
                    message=(
                        f"<Card> renders a hardcoded KPI value `{cleaned}`. "
                        f"Compute this from data via `useHandler` (server-side "
                        f"aggregate) or `useModel` (client-side reduce). "
                        f"Hardcoded numbers in KPI surfaces drift from reality "
                        f"as soon as data changes."
                    ),
                    line=literal_node.start_point[0] + 1,
                    col=literal_node.start_point[1],
                    fix_hint="replace literal with `useHandler`/`useModel` value",
                )


def _has_any_jsx_expression(card_element) -> bool:
    """Return True if any descendant of ``card_element`` is a
    ``jsx_expression`` (a curly-brace expression in JSX).
    Comment / string-literal expressions still count — pure-literal
    cards are what we're after."""
    for n in walk(card_element):
        if n.type == "jsx_expression":
            return True
    return False


def _iter_literal_text_nodes(card_element, ctx: AstContext):
    """Yield ``(jsx_text_node, cleaned_text)`` pairs for every KPI-shaped
    text literal inside the card subtree."""
    for n in walk(card_element):
        if n.type != "jsx_text":
            continue
        cleaned = ctx.source_buf[n.start_byte : n.end_byte].decode("utf-8").strip()
        if len(cleaned) < 3:
            continue
        if not _KPI_LITERAL_RE.match(cleaned):
            continue
        # Confirm the immediate parent JSX element is a value-tag —
        # avoid matching whitespace / formatting text in odd places.
        parent_tag = _enclosing_jsx_tag_name(n, ctx.source_buf)
        if parent_tag is not None and parent_tag not in _VALUE_TAGS:
            continue
        yield n, cleaned


def _enclosing_jsx_tag_name(node, buf: bytes) -> str | None:
    """Walk up to the nearest enclosing ``jsx_element`` and return its
    opening tag name."""
    cur = node.parent
    while cur is not None:
        if cur.type == "jsx_element":
            for child in cur.children:
                if child.type == "jsx_opening_element":
                    for c in child.children:
                        if c.type in ("identifier", "nested_identifier", "member_expression"):
                            return buf[c.start_byte : c.end_byte].decode("utf-8")
            return None
        cur = cur.parent
    return None
