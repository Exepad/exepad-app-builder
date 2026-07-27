"""Handler SQL enum-literal rules.

Two findings emitted by the single ``HandlerSqlEnumCaseRule`` walker:

- ``handler.sql.enum_case_mismatch`` — literal near-matches a declared
  enum value but with different casing (``'Active'`` vs ``'active'``).
  The companion fixer ``fixers/handler_enum_case.py`` rewrites these
  deterministically; the rule still warns so the LLM gets feedback.
- ``handler.sql.enum_value_unknown`` — literal isn't in the declared
  ``enum_values`` at all, even case-folded. This is a fabricated value
  the handler builder invented (e.g. ``WHERE status IN ('paid')`` when
  the column's enum is ``['pending', 'shipped', ...]``). No safe
  rewrite — warning only; the LLM must regenerate.

Mirrors ``component.useModel.enum_case_mismatch`` but operates on
handler SQL inside ``ctx.db.prepare(...)`` / ``ctx.db.exec(...)`` calls.

The regex constants and SQL-call iteration helper are exported so the
fixer can reuse them — same surface, no duplication.
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import (
    find_calls,
    has_template_substitution,
    string_literal_value,
    template_string_static_value,
)
from .base import AstContext, Finding
from .component_filter_enum_case import _collect_enum_columns, _normalise

# Match `FROM table` / `UPDATE table` / `INTO table` (the first table
# named in a statement). Subsequent tables matched by ``_JOIN_RE`` flag
# multi-table queries which we conservatively skip — ambiguous table
# attribution risks rewriting the wrong column.
_FROM_RE = re.compile(
    r"\b(?:FROM|UPDATE|INTO)\s+([A-Za-z_][A-Za-z0-9_]*)",
    re.IGNORECASE,
)
_JOIN_RE = re.compile(r"\bJOIN\s+([A-Za-z_][A-Za-z0-9_]*)", re.IGNORECASE)

# WHERE / AND clauses of shape ``col = 'literal'`` / ``col != 'literal'`` /
# ``col LIKE 'literal'``. Captures column name, operator, and literal.
# Single-quoted only — double-quoted identifiers aren't string literals
# in standard SQL/SQLite.
_PRED_RE = re.compile(
    r"\b([A-Za-z_][A-Za-z0-9_]*)\s*" r"(=|!=|<>|LIKE)\s*" r"'([^'\\]*(?:\\.[^'\\]*)*)'",
    re.IGNORECASE,
)
_IN_RE = re.compile(
    r"\b([A-Za-z_][A-Za-z0-9_]*)\s*IN\s*\(\s*([^)]+?)\s*\)",
    re.IGNORECASE,
)
_IN_LITERAL_RE = re.compile(r"'([^'\\]*(?:\\.[^'\\]*)*)'")


def find_near_match(literal: str, values: list[str]) -> str | None:
    """Return the unique declared value that ``literal`` near-matches
    (normalised lowercase + alphanumeric-only), or ``None``.

    A near-match exists when normalising both sides produces the same
    string. Already-correct literals (byte-equal to a declared value)
    return ``None`` — callers should treat that as "no rewrite needed".
    """
    if literal in values:
        return None
    norm = _normalise(literal)
    if not norm:
        return None
    near = [v for v in values if _normalise(v) == norm]
    if len(near) != 1:
        return None
    return near[0]


def iter_handler_sql_calls(tree, source_buf: bytes):
    """Yield ``(arg0_node, sql, content_offset, target_table)`` tuples for
    every ``ctx.db.prepare(SQL)`` / ``.exec(SQL)`` call that the
    enum-case rule and fixer want to inspect.

    ``content_offset`` is the absolute byte offset where the SQL
    string's contents begin inside the source buffer (i.e., one past
    the leading quote / backtick) — callers translate regex match
    offsets back to source byte offsets via ``content_offset + m.start(...)``.

    Multi-table queries (any ``JOIN``) and dynamic templates are
    filtered out at this layer so consumers don't need to repeat the
    guard logic.
    """
    for call in find_calls(tree.root_node):
        callee = call.child_by_field_name("function")
        if callee is None or callee.type != "member_expression":
            continue
        prop = callee.child_by_field_name("property")
        if prop is None:
            continue
        method = source_buf[prop.start_byte : prop.end_byte].decode("utf-8")
        if method not in ("prepare", "exec"):
            continue
        args = call.child_by_field_name("arguments")
        if args is None or args.named_child_count == 0:
            continue
        arg0 = args.named_children[0]

        if arg0.type == "string":
            sql = string_literal_value(arg0, source_buf)
        elif arg0.type == "template_string":
            if has_template_substitution(arg0):
                continue
            sql = template_string_static_value(arg0, source_buf)
        else:
            continue
        if not sql:
            continue

        # ``+1`` skips the leading quote / backtick — both are 1 byte.
        content_offset = arg0.start_byte + 1

        from_match = _FROM_RE.search(sql)
        if from_match is None:
            continue
        if _JOIN_RE.search(sql) is not None:
            continue
        target_table = from_match.group(1).lower()

        yield arg0, sql, content_offset, target_table


def _classify_enum_literal(
    literal: str, values: list[str]
) -> tuple[str, str | None]:
    """Classify a SQL string literal against declared enum_values.

    Returns one of:
    - ``("ok", None)`` — literal is byte-exact in ``values``; no finding.
    - ``("case_mismatch", declared)`` — literal near-matches ``declared``
      (same after case-folding + alphanumeric strip).
    - ``("unknown", None)`` — literal isn't in ``values`` even case-folded;
      the handler builder invented it.
    """
    if literal in values:
        return ("ok", None)
    declared = find_near_match(literal, values)
    if declared is not None:
        return ("case_mismatch", declared)
    return ("unknown", None)


class HandlerSqlEnumCaseRule:
    """Two-finding rule for handler SQL enum literals.

    Emits ``handler.sql.enum_case_mismatch`` for near-matches (fixable)
    and ``handler.sql.enum_value_unknown`` for fabricated literals
    (LLM must regenerate). Both severities are ``warning`` — the
    case-mismatch one is paired with a deterministic fixer, the
    unknown-value one has no safe rewrite.
    """

    id = "handler.sql.enum_case_mismatch"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not ctx.models:
            return
        enum_lookup = {
            (model.lower(), col.lower()): values
            for model, col, values in _collect_enum_columns(ctx.models)
        }
        if not enum_lookup:
            return

        for arg0, sql, _content_offset, target_table in iter_handler_sql_calls(
            ctx.tree, ctx.source_buf
        ):
            line = arg0.start_point[0] + 1
            col_pos = arg0.start_point[1]

            for m in _PRED_RE.finditer(sql):
                col = m.group(1).lower()
                literal = m.group(3)
                values = enum_lookup.get((target_table, col))
                if not values:
                    continue
                kind, declared = _classify_enum_literal(literal, values)
                if kind == "case_mismatch" and declared is not None:
                    yield Finding(
                        rule_id="handler.sql.enum_case_mismatch",
                        severity="warning",
                        message=(
                            f"Handler SQL on '{target_table}' uses "
                            f"`{col} = '{literal}'`; declared enum_values for this "
                            f"column expect '{declared}'. SQLite is byte-exact, so "
                            f"this predicate matches zero rows."
                        ),
                        line=line,
                        col=col_pos,
                        fix_hint=f"replace with '{declared}'",
                    )
                elif kind == "unknown":
                    yield Finding(
                        rule_id="handler.sql.enum_value_unknown",
                        severity="warning",
                        message=(
                            f"Handler SQL on '{target_table}' uses "
                            f"`{col} = '{literal}'` but '{literal}' is not in "
                            f"the declared enum_values "
                            f"({', '.join(repr(v) for v in values)}). "
                            f"This predicate will match zero rows."
                        ),
                        line=line,
                        col=col_pos,
                    )

            for m in _IN_RE.finditer(sql):
                col = m.group(1).lower()
                values = enum_lookup.get((target_table, col))
                if not values:
                    continue
                for lit_m in _IN_LITERAL_RE.finditer(m.group(2)):
                    literal = lit_m.group(1)
                    kind, declared = _classify_enum_literal(literal, values)
                    if kind == "case_mismatch" and declared is not None:
                        yield Finding(
                            rule_id="handler.sql.enum_case_mismatch",
                            severity="warning",
                            message=(
                                f"Handler SQL on '{target_table}' uses IN-literal "
                                f"`'{literal}'` for column `{col}`; declared "
                                f"enum_values expect '{declared}'."
                            ),
                            line=line,
                            col=col_pos,
                            fix_hint=f"replace with '{declared}'",
                        )
                    elif kind == "unknown":
                        yield Finding(
                            rule_id="handler.sql.enum_value_unknown",
                            severity="warning",
                            message=(
                                f"Handler SQL on '{target_table}' uses IN-literal "
                                f"`'{literal}'` for column `{col}` but it is "
                                f"not in declared enum_values "
                                f"({', '.join(repr(v) for v in values)}). "
                                f"This IN-clause will not include it."
                            ),
                            line=line,
                            col=col_pos,
                        )
