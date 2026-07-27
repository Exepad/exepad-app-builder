"""Unit tests for ``handler.sql.undeclared_table`` — the AST table-reference rule."""

from __future__ import annotations

from typing import Iterable

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.sql_model_references import (
    SqlUndeclaredTableRule,
)


def _run_rule(tsx: str, models: list[dict]) -> list[str]:
    """Run the AST rule and return its error messages (without the trailing
    ``(rule_id at line:col)`` suffix — just the prose)."""
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=models)
    return [f.message for f in run_rules(ctx, [SqlUndeclaredTableRule()]) if f.severity == "error"]


def _tables_in_errors(errors: Iterable[str]) -> set[str]:
    """Pull ``'<name>'`` tokens out of error prose for set comparison."""
    import re

    out: set[str] = set()
    for err in errors:
        for m in re.finditer(r"(?:table|reference)\s+'([^']+)'", err):
            out.add(m.group(1).lower())
    return out


def _wrap(body: str) -> str:
    """Wrap a SQL string in a minimal valid handler."""
    return (
        'import { HandlerContext } from "@exepad/sdk";\n'
        "export default async function h(ctx: HandlerContext) {\n"
        f"  return ctx.db.prepare({body}).all();\n"
        "}\n"
    )


class TestUndeclaredTableAstRule:
    def test_happy_path_single_table(self):
        tsx = _wrap('"SELECT * FROM guests WHERE rsvp = ?"')
        assert _run_rule(tsx, [{"name": "guests"}]) == []

    def test_undeclared_table_flagged(self):
        tsx = _wrap('"SELECT * FROM activity_logs"')
        errors = _run_rule(tsx, [{"name": "walkers"}])
        assert len(errors) == 1
        assert "activity_logs" in errors[0]

    def test_join_undeclared_table_flagged(self):
        tsx = _wrap(
            '"SELECT * FROM events JOIN activity_logs ' 'ON activity_logs.event_id = events.id"'
        )
        errors = _run_rule(tsx, [{"name": "events"}])
        assert _tables_in_errors(errors) == {"activity_logs"}

    def test_insert_into_reserved_word_table(self):
        """events-is-a-keyword regression at the rule layer."""
        tsx = _wrap('"INSERT INTO events (name, date) VALUES (?, ?)"')
        assert _run_rule(tsx, [{"name": "events"}]) == []
        # Undeclared case
        assert _tables_in_errors(_run_rule(tsx, [{"name": "guests"}])) == {"events"}

    def test_update_flagged_when_undeclared(self):
        tsx = _wrap('"UPDATE missing SET x = 1"')
        assert _tables_in_errors(_run_rule(tsx, [{"name": "guests"}])) == {"missing"}

    def test_delete_from_flagged_when_undeclared(self):
        tsx = _wrap('"DELETE FROM missing WHERE id = ?"')
        assert _tables_in_errors(_run_rule(tsx, [{"name": "guests"}])) == {"missing"}

    def test_platform_table_allowed(self):
        tsx = _wrap('"SELECT id FROM _auth_users"')
        assert _run_rule(tsx, [{"name": "guests"}]) == []

    def test_user_settings_table_flagged_as_reserved(self):
        # The platform no longer ships a settings service; ``_user_settings``
        # is just a reserved ``_``-prefixed name now — handlers must declare
        # their own table for app settings.
        tsx = _wrap('"UPDATE _user_settings SET v = ?"')
        errors = _run_rule(tsx, [{"name": "guests"}])
        assert len(errors) == 1
        assert "_user_settings" in errors[0]
        assert "reserved" in errors[0]

    def test_reserved_underscore_prefix_flagged(self):
        tsx = _wrap('"SELECT * FROM _mystery"')
        errors = _run_rule(tsx, [{"name": "guests"}])
        assert len(errors) == 1
        assert "_mystery" in errors[0]
        assert "reserved" in errors[0]

    def test_template_string_static_is_validated(self):
        tsx = _wrap("`SELECT * FROM missing_table`")
        assert _tables_in_errors(_run_rule(tsx, [{"name": "guests"}])) == {"missing_table"}

    def test_template_string_with_substitution_is_skipped(self):
        """Interpolated templates are outside this rule's scope and are left
        for ``handler.sql.dynamic_query`` (not shipped in Phase 1)."""
        tsx = (
            'import { HandlerContext } from "@exepad/sdk";\n'
            "export default async function h(ctx: HandlerContext) {\n"
            "  const t = 'foo';\n"
            "  return ctx.db.prepare(`SELECT * FROM ${t}`).all();\n"
            "}\n"
        )
        assert _run_rule(tsx, [{"name": "guests"}]) == []

    def test_dedupe_same_table_multiple_references(self):
        tsx = (
            'import { HandlerContext } from "@exepad/sdk";\n'
            "export default async function h(ctx: HandlerContext) {\n"
            '  const a = ctx.db.prepare("SELECT * FROM missing").all();\n'
            '  const b = ctx.db.prepare("SELECT COUNT(*) FROM missing").first();\n'
            "  return { a, b };\n"
            "}\n"
        )
        errors = _run_rule(tsx, [{"name": "guests"}])
        assert len(errors) == 1
        assert "missing" in errors[0]

    def test_empty_models_list_still_flags_user_tables(self):
        tsx = _wrap('"SELECT * FROM foo"')
        assert _tables_in_errors(_run_rule(tsx, [])) == {"foo"}

    def test_models_as_string_list_shape(self):
        """The legacy tool stashes models as a string list in tool state —
        the AST rule must accept that shape too."""
        tsx = _wrap('"SELECT * FROM guests"')
        tree = parse_tsx(tsx)
        ctx = AstContext(
            tsx=tsx,
            source_buf=source_bytes(tsx),
            tree=tree,
            models=["guests"],  # type: ignore[list-item]
        )
        findings = run_rules(ctx, [SqlUndeclaredTableRule()])
        assert [f for f in findings if f.severity == "error"] == []
