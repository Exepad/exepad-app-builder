"""``component.data.hardcoded_activity_dates`` — JSX text content
matching relative-time or short-form date strings (``"2h ago"``,
``"Yesterday"``, ``"Sep 24"``) usually signals an agent-imagined
activity feed rather than data bound from a handler.

The bug this catches
--------------------

App ``coje33ih`` DashboardContent (2026-05-12) renders a "Recent
Updates" feed with three hardcoded entries::

    <UpdateItem title="AWS Alternative updated" date="2h ago"   type="update" />
    <UpdateItem title="Labor rates adjusted"    date="Yesterday" type="config" />
    <UpdateItem title="Baseline snapshot created" date="Sep 24" type="milestone" />

There is no handler producing those rows. The dashboard looks
populated but the data is fictional — same pattern as static KPI
literals, which we already catch via ``HardcodedKpiLiteralRule``.

This rule extends the same idea to short-form dates and relative time
phrases, which are very rarely legitimate static UI copy (legal
boilerplate, marketing taglines etc. don't use ``"2h ago"``).

Resolution shape
----------------

Walk every JSX attribute string value and every JSX text node. If the
trimmed value matches one of the date/time patterns, emit a warning
suggesting the data should come from a handler. Stop at first hit per
attribute / text node to keep finding count manageable.

Severity
--------

Warning. False-positive risk on legit static copy (e.g. blog post
"Published Jan 4"), but the trade is worth it — the typical false
positive is easy for the agent to dismiss in iteration, and the
typical true positive is a fictional activity feed.
"""

from __future__ import annotations

import re
from typing import Iterator

from tree_sitter import Node

from ..walker import iter_jsx_opening_elements
from .base import AstContext, Finding


# Patterns that strongly suggest a date/time string baked into the UI.
# Match against the *trimmed* string; case-insensitive.
_RELATIVE_TIME_RE = re.compile(
    r"""
    ^(?:
        # Word-based relative times
        yesterday | today | now | tomorrow | just\s+now
        # Numeric relative times: "2h ago", "30m ago", "5 days ago", etc.
        | \d+\s*(?:[hdmsy]|min|mins|hr|hrs|day|days|week|weeks|month|months|year|years)\s*ago
        # Short month-name dates: "Sep 24", "Jan 3, 2024"
        | (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s*\d{4})?
        # ISO-ish dates: "2025-01-15", "2025/01/15"
        | \d{4}[-/]\d{1,2}[-/]\d{1,2}
    )$
    """,
    re.IGNORECASE | re.VERBOSE,
)

# Attribute names that carry display-text content. We don't audit
# ``key=``, ``id=``, ``className=``, etc.
_TEXT_LIKE_ATTRS: frozenset[str] = frozenset(
    {
        "date",
        "time",
        "timestamp",
        "label",
        "title",
        "subtitle",
        "value",
        "text",
        "caption",
        "description",
    }
)


class HardcodedActivityDateRule:
    """Flag JSX text / props matching date-like literal patterns."""

    id = "component.data.hardcoded_activity_dates"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        seen_lines: set[int] = set()
        for opening in iter_jsx_opening_elements(ctx.tree.root_node):
            for attr in opening.named_children:
                if attr.type != "jsx_attribute":
                    continue
                name_node = next(iter(attr.named_children), None)
                if name_node is None:
                    continue
                attr_name = ctx.source_buf[
                    name_node.start_byte : name_node.end_byte
                ].decode("utf-8")
                if attr_name not in _TEXT_LIKE_ATTRS:
                    continue
                value_node = _attr_string_literal(attr, ctx.source_buf)
                if value_node is None:
                    continue
                raw, line = value_node
                trimmed = raw.strip()
                if not trimmed:
                    continue
                if _RELATIVE_TIME_RE.match(trimmed):
                    if line in seen_lines:
                        continue
                    seen_lines.add(line)
                    yield Finding(
                        rule_id=self.id,
                        severity="warning",
                        message=(
                            f'JSX attribute {attr_name}="{trimmed}" reads like '
                            f"a hardcoded date or relative-time string. The "
                            f"agent appears to be inventing activity-feed data "
                            f"rather than binding from a handler. Either bind "
                            f"the value via useHandler/useModel, or remove the "
                            f"feed entirely if no data source exists."
                        ),
                        line=line,
                        col=0,
                        fix_hint=(
                            "replace the literal with a value derived from a "
                            "handler's emitted row, or drop the section"
                        ),
                    )


# ── helpers ──────────────────────────────────────────────────────────


def _attr_string_literal(attr_node: Node, buf: bytes) -> tuple[str, int] | None:
    """Return (value, line) when the attribute's value is a string literal.

    Returns ``None`` for non-literal attribute values (expressions,
    template strings with substitutions, absent values).
    """
    value_node: Node | None = None
    for child in attr_node.named_children:
        if child.type == "string":
            value_node = child
            break
        if child.type == "jsx_expression":
            # ``date={"Sep 24"}`` — single string inside an expression.
            inner = next(iter(child.named_children), None)
            if inner is not None and inner.type == "string":
                value_node = inner
                break
    if value_node is None:
        return None
    raw = buf[value_node.start_byte : value_node.end_byte].decode("utf-8")
    if len(raw) >= 2 and raw[0] in "'\"" and raw[-1] in "'\"":
        return raw[1:-1], value_node.start_point[0] + 1
    return raw, value_node.start_point[0] + 1
