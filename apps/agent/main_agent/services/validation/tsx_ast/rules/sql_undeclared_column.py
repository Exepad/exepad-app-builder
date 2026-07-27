"""``handler.sql.undeclared_column`` — advisory column-reference check.

For each ``.prepare()`` SQL literal we already know the set of tables
the query touches. This rule walks the column references inside that
SQL and warns whenever a qualified reference points at a table that is
declared but whose target column is NOT declared on that table.

Qualified ``table.column`` references are always checked. Bare column
names are checked too, but ONLY when the statement touches exactly one
declared table — then there is no alias ambiguity. This catches the
common single-table aggregation / filter case (e.g.
``SELECT status, COUNT(*) FROM loans GROUP BY status``). Multi-table
statements still skip bare columns to avoid alias false positives.

Impossible to do with a regex: the connection between a table in
``FROM`` / ``JOIN`` and a column in ``SELECT`` / ``WHERE`` requires the
AST-plus-SQL walk this rule relies on.
"""

from __future__ import annotations

from typing import Iterator

from ..catalog import PLATFORM_SYSTEM_COLUMNS
from ..sql import parse_sql
from ..walker import (
    find_calls,
    has_template_substitution,
    string_literal_value,
    template_string_static_value,
)
from .base import AstContext, Finding


class SqlUndeclaredColumnRule:
    """Warn when a qualified SQL column reference targets an undeclared column."""

    id = "handler.sql.undeclared_column"
    # error (blocking): a column not in the model's schema fails at runtime with
    # D1_ERROR. Promoted from warning 2026-05-20 after single-table bare-column
    # resolution landed (qualified + single-table bare refs are now reliable).
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf

        columns_by_table = _declared_columns_by_table(ctx.models)
        if not columns_by_table:
            return

        seen: set[tuple[str, str]] = set()

        for call in find_calls(root):
            callee = call.child_by_field_name("function")
            if callee is None or callee.type != "member_expression":
                continue
            prop = callee.child_by_field_name("property")
            if prop is None or _text(prop, buf) != "prepare":
                continue
            args = call.child_by_field_name("arguments")
            if args is None or args.named_child_count == 0:
                continue
            arg0 = args.named_children[0]

            sql: str | None = None
            if arg0.type == "string":
                sql = string_literal_value(arg0, buf)
            elif arg0.type == "template_string":
                if has_template_substitution(arg0):
                    continue
                sql = template_string_static_value(arg0, buf)
            else:
                continue
            if not sql:
                continue

            analysis = parse_sql(sql)
            if not analysis.column_refs and not analysis.bare_columns:
                continue

            # Build the set of tables referenced in this statement. Table
            # aliases (``guests g``) are a future extension — for now we
            # only resolve direct table names.
            statement_tables = analysis.tables()
            line = arg0.start_point[0] + 1
            col = arg0.start_point[1]

            def _check(table: str, column: str) -> Finding | None:
                """Return a Finding if ``table.column`` is a declared table with
                a known column surface that lacks ``column`` — else None."""
                if (table, column) in seen:
                    return None
                declared_cols = columns_by_table.get(table)
                # None = unknown table (undeclared_table rule's job); empty =
                # known table, unknown column surface (string-list model shape).
                if not declared_cols:
                    return None
                if column in declared_cols or column in PLATFORM_SYSTEM_COLUMNS:
                    return None
                seen.add((table, column))
                return Finding(
                    rule_id=self.id,
                    severity=self.severity,
                    message=(
                        f"SQL references column '{table}.{column}' but '{column}' "
                        f"is not declared on model '{table}'. Either add the "
                        f"column to app_backend_plan.models, or use an "
                        f"existing column name. Declared columns: "
                        f"{sorted(declared_cols) if len(declared_cols) <= 8 else sorted(declared_cols)[:8] + ['...']}."
                    ),
                    line=line,
                    col=col,
                )

            # Qualified ``table.column`` refs — only for tables in this statement.
            for table, column in analysis.column_refs:
                if table not in statement_tables:
                    continue
                finding = _check(table, column)
                if finding is not None:
                    yield finding

            # Bare columns — resolvable only when exactly one table is in scope.
            if len(statement_tables) == 1:
                (only_table,) = tuple(statement_tables)
                for column in analysis.bare_columns:
                    finding = _check(only_table, column)
                    if finding is not None:
                        yield finding


def _declared_columns_by_table(models) -> dict[str, set[str]]:
    """Build ``{table_name: {col, col, ...}}`` from the models list.

    Accepts ``[{name, columns: [{name}, ...]}, ...]``. String-list model
    shapes from ``validate_and_save_handler_artifact`` carry no column
    info and contribute nothing — the rule skips tables with an unknown
    column surface so this disables the check for those callers, which
    is the correct behaviour.
    """
    out: dict[str, set[str]] = {}
    for m in models or []:
        if isinstance(m, dict):
            name = (m.get("name") or "").lower()
            if not name:
                continue
            cols = m.get("columns") or []
            col_set: set[str] = set()
            for c in cols:
                if isinstance(c, dict):
                    cname = c.get("name") or ""
                    if cname:
                        col_set.add(cname.lower())
                elif isinstance(c, str):
                    col_set.add(c.lower())
            out[name] = col_set
        elif isinstance(m, str):
            # No column info available — skip.
            continue
    return out


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")
