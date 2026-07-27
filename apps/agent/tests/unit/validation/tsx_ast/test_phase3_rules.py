"""Phase 3 AST rule tests — new advisory rules (warning severity).

These rules have no regex equivalent — they are new capabilities
enabled by the AST + SQL walk. Tests verify the happy path, the
advisory fire, and a few edge cases to make sure they ship at
warning severity without false positives on realistic handler code.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.sql_dynamic_query import (
    SqlDynamicQueryRule,
)
from main_agent.services.validation.tsx_ast.rules.sql_undeclared_column import (
    SqlUndeclaredColumnRule,
)


def _run(rule, tsx, models=None, plan=None):
    tree = parse_tsx(tsx)
    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        models=models or [],
        handler_plan=plan,
    )
    return run_rules(ctx, [rule])


def _warnings(rule, tsx, **kw):
    return [f.message for f in _run(rule, tsx, **kw) if f.severity == "warning"]


def _errors(rule, tsx, **kw):
    return [f.message for f in _run(rule, tsx, **kw) if f.severity == "error"]


class TestSqlDynamicQuery:
    def test_literal_argument_ok(self):
        tsx = 'export default async function h(ctx){ return ctx.db.prepare("SELECT 1").all(); }'
        assert _warnings(SqlDynamicQueryRule(), tsx) == []

    def test_static_template_ok(self):
        tsx = "export default async function h(ctx){ return ctx.db.prepare(`SELECT 1`).all(); }"
        assert _warnings(SqlDynamicQueryRule(), tsx) == []

    def test_identifier_argument_warns(self):
        tsx = (
            "export default async function h(ctx){ "
            'const q = "SELECT 1"; return ctx.db.prepare(q).all(); }'
        )
        warnings = _warnings(SqlDynamicQueryRule(), tsx)
        assert len(warnings) == 1
        assert "non-literal argument" in warnings[0]

    def test_function_call_argument_warns(self):
        tsx = (
            "export default async function h(ctx){ " "return ctx.db.prepare(buildQuery()).all(); }"
        )
        assert len(_warnings(SqlDynamicQueryRule(), tsx)) == 1

    def test_interpolated_template_handled_by_other_rule(self):
        tsx = (
            "export default async function h(ctx){ "
            "const t = 'x'; return ctx.db.prepare(`SELECT * FROM ${t}`).all(); }"
        )
        assert _warnings(SqlDynamicQueryRule(), tsx) == []

    def test_severity_is_warning_not_error(self):
        tsx = (
            "export default async function h(ctx){ "
            'const q = "SELECT 1"; return ctx.db.prepare(q).all(); }'
        )
        assert _errors(SqlDynamicQueryRule(), tsx) == []
        assert _warnings(SqlDynamicQueryRule(), tsx)


class TestSqlUndeclaredColumn:
    @staticmethod
    def _models():
        return [
            {
                "name": "guests",
                "columns": [
                    {"name": "id"},
                    {"name": "name"},
                    {"name": "rsvp"},
                    {"name": "event_id"},
                ],
            },
            {
                "name": "events",
                "columns": [{"name": "id"}, {"name": "date"}, {"name": "title"}],
            },
        ]

    def test_all_columns_declared(self):
        tsx = (
            "export default async function h(ctx){ "
            'return ctx.db.prepare("SELECT guests.name, events.date FROM guests JOIN events ON events.id = guests.event_id").all(); }'
        )
        assert _warnings(SqlUndeclaredColumnRule(), tsx, models=self._models()) == []

    def test_typo_column_errors(self):
        # Promoted to error 2026-05-20: an undeclared column fails at runtime.
        tsx = (
            "export default async function h(ctx){ "
            'return ctx.db.prepare("SELECT guests.emial FROM guests").all(); }'
        )
        errors = _errors(SqlUndeclaredColumnRule(), tsx, models=self._models())
        assert len(errors) == 1
        assert "'guests.emial'" in errors[0]

    def test_bare_select_list_column_ignored(self):
        """Bare columns in the SELECT list are not extracted (aliases /
        expressions make them ambiguous) — only GROUP BY / ORDER BY / predicate
        positions are checked. A SELECT-list-only bare typo stays unflagged."""
        tsx = (
            "export default async function h(ctx){ "
            'return ctx.db.prepare("SELECT emial FROM guests").all(); }'
        )
        assert _errors(SqlUndeclaredColumnRule(), tsx, models=self._models()) == []

    def test_system_columns_allowed(self):
        """Every table implicitly has id/created_at/updated_at/owner_id."""
        tsx = (
            "export default async function h(ctx){ "
            'return ctx.db.prepare("SELECT guests.id, guests.created_at FROM guests").all(); }'
        )
        assert _warnings(SqlUndeclaredColumnRule(), tsx, models=self._models()) == []

    def test_models_without_columns_disables_check(self):
        """A models list without column info (e.g. tool-state string list)
        is a no-op for this rule — we cannot know what exists."""
        tsx = (
            "export default async function h(ctx){ "
            'return ctx.db.prepare("SELECT guests.whatever FROM guests").all(); }'
        )
        assert _warnings(SqlUndeclaredColumnRule(), tsx, models=[{"name": "guests"}]) == []
