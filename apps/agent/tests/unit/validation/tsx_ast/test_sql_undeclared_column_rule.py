"""Tests for ``handler.sql.undeclared_column`` — qualified-column AST rule.

The rule walks SQL passed to ``.prepare()`` and flags when a qualified
``table.column`` reference targets a known table whose column set does
NOT include the referenced column. Bare column references are also
checked, but ONLY when the statement touches exactly one declared table
(no alias ambiguity) — e.g. ``SELECT status FROM loans GROUP BY status``.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.sql_undeclared_column import (
    SqlUndeclaredColumnRule,
)

pytestmark = [pytest.mark.unit]


def _run(tsx: str, models: list[dict]) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=models)
    # Severity-agnostic: only this rule runs, so every finding is its own.
    # (Survives the warning→error promotion.)
    return [f.message for f in run_rules(ctx, [SqlUndeclaredColumnRule()])]


def _wrap(sql: str) -> str:
    return (
        'import { HandlerContext } from "@exepad/sdk";\n'
        "export default async function h(ctx: HandlerContext) {\n"
        f"  return ctx.db.prepare({sql}).all();\n"
        "}\n"
    )


_GUESTS_MODEL = {
    "name": "guests",
    "columns": [{"name": "id"}, {"name": "name"}, {"name": "rsvp"}],
}


class TestUndeclaredColumns:
    def test_qualified_undeclared_column_flagged(self):
        tsx = _wrap('"SELECT guests.email FROM guests"')
        warnings = _run(tsx, [_GUESTS_MODEL])
        assert len(warnings) == 1
        assert "guests.email" in warnings[0]
        assert "guests" in warnings[0]

    def test_qualified_declared_column_not_flagged(self):
        tsx = _wrap('"SELECT guests.name FROM guests"')
        assert _run(tsx, [_GUESTS_MODEL]) == []

    def test_select_star_not_flagged(self):
        tsx = _wrap('"SELECT * FROM guests"')
        assert _run(tsx, [_GUESTS_MODEL]) == []

    def test_bare_declared_column_not_flagged(self):
        # ``name`` is declared on guests — single-table bare ref resolves and
        # passes (no SELECT-list extraction either, so it never fires here).
        tsx = _wrap('"SELECT name FROM guests"')
        assert _run(tsx, [_GUESTS_MODEL]) == []

    def test_undeclared_column_in_where_clause_flagged(self):
        tsx = _wrap('"SELECT guests.id FROM guests WHERE guests.email = ?"')
        warnings = _run(tsx, [_GUESTS_MODEL])
        assert len(warnings) == 1
        assert "guests.email" in warnings[0]


_LOANS_MODEL = {
    "name": "loans",
    "columns": [
        {"name": "id"},
        {"name": "book_id"},
        {"name": "member_id"},
        {"name": "loan_date"},
        {"name": "due_date"},
        {"name": "return_date"},
    ],
}


class TestBareColumnsSingleTable:
    """Regression for mw4h37zf (2026-05-20): a bare column on a single-table
    statement that doesn't exist on that table must be flagged."""

    def test_bare_group_by_undeclared_flagged(self):
        # The exact bug: loans has no `status`, but the handler did
        # `SELECT status, COUNT(*) ... FROM loans GROUP BY status`.
        tsx = _wrap('"SELECT status, COUNT(*) as count FROM loans GROUP BY status"')
        warnings = _run(tsx, [_LOANS_MODEL])
        assert len(warnings) == 1
        assert "loans.status" in warnings[0]

    def test_bare_predicate_lhs_undeclared_flagged(self):
        tsx = _wrap('"SELECT id FROM loans WHERE status = ?"')
        warnings = _run(tsx, [_LOANS_MODEL])
        assert len(warnings) == 1
        assert "loans.status" in warnings[0]

    def test_bare_declared_predicate_not_flagged(self):
        # return_date IS declared — the correct query must not fire.
        tsx = _wrap('"SELECT COUNT(*) as count FROM loans WHERE return_date >= ?"')
        assert _run(tsx, [_LOANS_MODEL]) == []

    def test_bare_function_call_in_group_by_not_flagged(self):
        # date(...) is a function, not a column — must not be extracted.
        tsx = _wrap('"SELECT COUNT(*) FROM loans GROUP BY date(loan_date)"')
        assert _run(tsx, [_LOANS_MODEL]) == []

    def test_bare_column_multi_table_not_flagged(self):
        # Two tables in scope → bare `status` is ambiguous, must be skipped to
        # avoid alias false positives (only qualified refs checked here).
        tsx = _wrap(
            '"SELECT l.id FROM loans l JOIN members m ON l.member_id = m.id '
            'GROUP BY status"'
        )
        assert _run(tsx, [_LOANS_MODEL, _GUESTS_MODEL]) == []

    def test_bare_column_other_table_has_it(self):
        # `status` exists on members but not loans; a single-table loans query
        # referencing bare `status` must flag (per-table resolution).
        members = {"name": "members", "columns": [{"name": "id"}, {"name": "status"}]}
        ok = _wrap('"SELECT COUNT(*) FROM members WHERE status = ?"')
        assert _run(ok, [_LOANS_MODEL, members]) == []
        bad = _wrap('"SELECT COUNT(*) FROM loans WHERE status = ?"')
        assert len(_run(bad, [_LOANS_MODEL, members])) == 1


class TestSystemColumns:
    def test_created_at_not_flagged(self):
        # PLATFORM_SYSTEM_COLUMNS includes the implicit timestamp/id columns
        # every table receives. Referencing them must not trigger a warning
        # even when not declared in the model.
        tsx = _wrap('"SELECT guests.created_at FROM guests"')
        assert _run(tsx, [_GUESTS_MODEL]) == []


class TestModelShapes:
    def test_string_list_model_shape_disables_check(self):
        # When ``models`` is a string list (legacy shape), there's no column
        # surface to compare against — the rule must skip the check.
        tsx = _wrap('"SELECT guests.email FROM guests"')
        assert _run(tsx, [{"name": "guests"}]) == []

    def test_empty_models_list_disables_check(self):
        tsx = _wrap('"SELECT guests.email FROM guests"')
        assert _run(tsx, []) == []

    def test_unknown_table_skipped(self):
        # The rule cares about declared tables only — undeclared tables are
        # the ``handler.sql.undeclared_table`` rule's job. A column on an
        # unknown table must not fire here.
        tsx = _wrap('"SELECT activity_logs.action FROM activity_logs"')
        assert _run(tsx, [_GUESTS_MODEL]) == []


class TestTemplateStrings:
    def test_static_template_string_validated(self):
        tsx = _wrap("`SELECT guests.email FROM guests`")
        warnings = _run(tsx, [_GUESTS_MODEL])
        assert len(warnings) == 1
        assert "guests.email" in warnings[0]

    def test_interpolated_template_skipped(self):
        # Interpolated SQL is owned by the param-injection rule, not this one.
        tsx = (
            'import { HandlerContext } from "@exepad/sdk";\n'
            "export default async function h(ctx: HandlerContext) {\n"
            '  const id = "1";\n'
            "  return ctx.db.prepare(`SELECT guests.email FROM guests WHERE id = ${id}`).all();\n"
            "}\n"
        )
        assert _run(tsx, [_GUESTS_MODEL]) == []
