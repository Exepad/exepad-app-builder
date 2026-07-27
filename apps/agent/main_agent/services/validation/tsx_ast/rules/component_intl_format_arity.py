"""``component.intl.format_extra_arg`` — ``Intl.NumberFormat(...).format(x)``
takes exactly one argument; extras are silently dropped.

The bug this catches
--------------------

App ``r3hfcgx5`` (2026-05-14): DashboardContent rendered order totals as

::

    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
      .format(order.total, order.currency)

The intent is "format ``order.total`` in the row's own currency", but
the row currency is passed as a SECOND argument to ``.format(...)``
where it is silently ignored. Every row renders in USD regardless of
its ``currency`` field. No console warning, no runtime error — just
quietly wrong numbers.

Per ECMA-402, ``NumberFormat.prototype.format`` accepts exactly one
argument (the numeric value). Currency is set in the constructor's
options bag (``{ style: "currency", currency: "USD" }``). To format
per-row in the row's currency you must construct the formatter
per-call, threading the row's currency through the options:

::

    new Intl.NumberFormat("en-US",
      { style: "currency", currency: order.currency }
    ).format(order.total)

Why warning, not error
----------------------

The output renders fine (just in the wrong currency for some rows) —
no crash, no broken UI. Demoting to ``warning`` keeps the build green
while still surfacing the bug to the LLM. A future escalation could
upgrade to ``error`` once we observe LLM compliance on retries.

Fail-open contract
------------------

We only flag literal ``.format(a, b, ...)`` calls on an inline
``new Intl.NumberFormat(...)`` chain. ``NumberFormat`` instances
stored in a variable and later called with two args slip through —
the false-positive cost of trying to track that across the AST
outweighs the catch rate. The r3hfcgx5 pattern (and the broader LLM
habit) is the inline form, which this rule catches.
"""

from __future__ import annotations

import re
from typing import Iterator

from .base import AstContext, Finding


_RULE_ID = "component.intl.format_extra_arg"


# Inline pattern: ``new Intl.NumberFormat(...).format(arg1, arg2, ...)``.
# Top-level ``\.format\(`` follows the formatter constructor. The match
# group captures everything inside the format(...) parens up to the
# matching close. We then count top-level commas to determine arity.
#
# The constructor body can contain newlines and nested parens
# (``{ style: 'currency', currency: 'USD' }``), so we scan with a tiny
# paren-balanced state machine rather than a single regex.

_INTL_PREFIX_RE = re.compile(r"new\s+Intl\.NumberFormat\s*\(")
_FORMAT_TAIL_RE = re.compile(r"\)\s*\.format\s*\(")


def _find_balanced_close(tsx: str, open_paren_pos: int) -> int | None:
    """Return the index of the ``)`` matching the ``(`` at ``open_paren_pos``.

    Skips quoted strings (single/double/back), regex literals,
    template-string interpolations are tracked as nested braces.
    Returns ``None`` when the source is malformed.
    """
    depth = 1
    i = open_paren_pos + 1
    n = len(tsx)
    while i < n and depth > 0:
        ch = tsx[i]
        if ch == "'" or ch == '"':
            quote = ch
            i += 1
            while i < n and tsx[i] != quote:
                if tsx[i] == "\\":
                    i += 2
                    continue
                i += 1
            i += 1
            continue
        if ch == "`":
            i += 1
            while i < n and tsx[i] != "`":
                if tsx[i] == "\\":
                    i += 2
                    continue
                if tsx[i] == "$" and i + 1 < n and tsx[i + 1] == "{":
                    # Skip past template interpolation, tracking braces.
                    i += 2
                    brace = 1
                    while i < n and brace > 0:
                        if tsx[i] == "{":
                            brace += 1
                        elif tsx[i] == "}":
                            brace -= 1
                        i += 1
                    continue
                i += 1
            i += 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def _count_top_level_args(args_src: str) -> int:
    """Count comma-separated args in a parenthesized list source.

    Tracks paren/brace/bracket depth and quoted strings (single, double,
    back-tick). Returns 0 when the source is empty/whitespace.
    """
    if not args_src.strip():
        return 0
    depth_p = depth_c = depth_b = 0
    count = 1
    i = 0
    n = len(args_src)
    while i < n:
        ch = args_src[i]
        if ch == "'" or ch == '"':
            q = ch
            i += 1
            while i < n and args_src[i] != q:
                if args_src[i] == "\\":
                    i += 2
                    continue
                i += 1
        elif ch == "`":
            i += 1
            while i < n and args_src[i] != "`":
                if args_src[i] == "\\":
                    i += 2
                    continue
                i += 1
        elif ch in "([{":
            if ch == "(":
                depth_p += 1
            elif ch == "[":
                depth_b += 1
            else:
                depth_c += 1
        elif ch in ")]}":
            if ch == ")":
                depth_p -= 1
            elif ch == "]":
                depth_b -= 1
            else:
                depth_c -= 1
        elif ch == "," and depth_p == 0 and depth_c == 0 and depth_b == 0:
            count += 1
        i += 1
    return count


class IntlNumberFormatExtraArgRule:
    """``Intl.NumberFormat(...).format(x)`` accepts exactly one argument.

    Flag any inline call with >1 argument to ``.format(...)``. The
    LLM commonly mistakes the constructor's options for a per-call
    second argument and writes ``.format(amount, currency)`` — extras
    are silently dropped.
    """

    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        tsx = ctx.tsx
        for ctor in _INTL_PREFIX_RE.finditer(tsx):
            ctor_close = _find_balanced_close(tsx, ctor.end() - 1)
            if ctor_close is None:
                continue
            # Look for ``.format(`` immediately after the constructor close.
            tail = _FORMAT_TAIL_RE.match(tsx, ctor_close)
            if tail is None:
                continue
            format_open = tail.end() - 1
            format_close = _find_balanced_close(tsx, format_open)
            if format_close is None:
                continue
            args_src = tsx[format_open + 1 : format_close]
            arity = _count_top_level_args(args_src)
            if arity <= 1:
                continue
            line = tsx[: tail.start()].count("\n") + 1
            yield Finding(
                rule_id=_RULE_ID,
                severity="warning",
                line=line,
                col=0,
                message=(
                    f"`Intl.NumberFormat(...).format(...)` accepts exactly "
                    f"one argument; this call passes {arity}. Extras are "
                    f"silently dropped. If you intended to format in a "
                    f"row-specific currency, put it in the constructor: "
                    f"`new Intl.NumberFormat('en-US', "
                    f"{{ style: 'currency', currency: row.currency }})"
                    f".format(row.amount)`."
                ),
                fix_hint=(
                    "Remove the extra argument(s) from `.format(...)`. "
                    "If a row-specific currency is needed, construct the "
                    "formatter per-call with `currency: row.<field>` in "
                    "the options bag."
                ),
            )
