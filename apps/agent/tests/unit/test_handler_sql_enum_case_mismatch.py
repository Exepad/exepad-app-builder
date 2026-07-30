"""Tests for the handler SQL enum-literal rule + fixer.

The rule emits two findings via one walker:
- ``handler.sql.enum_case_mismatch`` — literal near-matches declared
  ``enum_values`` but with different casing. Paired with a fixer.
- ``handler.sql.enum_value_unknown`` — literal isn't in ``enum_values``
  at all (fabricated by the handler builder). Warning only, no rewrite.
"""

from main_agent.services.validation.fixers import apply_handler_enum_case_fixes
from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.handler_sql_enum_case import (
    HandlerSqlEnumCaseRule,
)

RESERVATIONS_MODEL = {
    "name": "reservations",
    "columns": [
        {"name": "id", "type": "integer"},
        {
            "name": "status",
            "type": "text",
            "enum_values": ["pending", "confirmed", "cancelled", "checked-in"],
        },
    ],
}

BILLINGS_MODEL = {
    "name": "billings",
    "columns": [
        {"name": "id", "type": "integer"},
        {
            "name": "status",
            "type": "text",
            "enum_values": ["UNPAID", "PAID", "PARTIAL"],
        },
    ],
}


def _run_rule(tsx: str, models: list[dict]) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=models)
    return [f.message for f in HandlerSqlEnumCaseRule().check(ctx)]


def _run_rule_full(tsx: str, models: list[dict]):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=models)
    return list(HandlerSqlEnumCaseRule().check(ctx))


# ---------------------------------------------------------------------------
# Rule
# ---------------------------------------------------------------------------


class TestRule:
    def test_warns_on_uppercase_against_lowercase_enum(self):
        tsx = """
        async function handler(ctx) {
          const r = await ctx.db.prepare(
            "SELECT * FROM reservations WHERE status = 'CHECKED-IN'"
          ).all();
          return r;
        }
        export default handler;
        """
        msgs = _run_rule(tsx, [RESERVATIONS_MODEL])
        assert len(msgs) == 1
        assert "checked-in" in msgs[0]

    def test_no_warn_when_byte_match(self):
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare("SELECT * FROM reservations WHERE status = 'cancelled'").all();
        }
        export default handler;
        """
        assert _run_rule(tsx, [RESERVATIONS_MODEL]) == []

    def test_warns_when_unrelated_literal_not_in_enum(self):
        # Literal isn't in declared enum_values and isn't a near-match —
        # fabricated value (LLM hallucination). Membership check fires
        # ``handler.sql.enum_value_unknown``.
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare("SELECT * FROM reservations WHERE status = 'archived'").all();
        }
        export default handler;
        """
        findings = _run_rule_full(tsx, [RESERVATIONS_MODEL])
        assert len(findings) == 1
        assert findings[0].rule_id == "handler.sql.enum_value_unknown"
        assert "'archived'" in findings[0].message
        # Message lists the declared enum values for the LLM to pick from.
        assert "'pending'" in findings[0].message
        assert findings[0].fix_hint is None  # no safe rewrite

    def test_warns_on_in_list_literal(self):
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare(
            "SELECT * FROM reservations WHERE status IN ('confirmed', 'PENDING')"
          ).all();
        }
        export default handler;
        """
        msgs = _run_rule(tsx, [RESERVATIONS_MODEL])
        assert len(msgs) == 1
        assert "pending" in msgs[0]

    def test_skips_multi_table_queries(self):
        # JOINs: rule can't reliably attribute columns to tables, so skip.
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare(
            "SELECT * FROM reservations r JOIN guests g ON r.guest_id = g.id WHERE r.status = 'CANCELLED'"
          ).all();
        }
        export default handler;
        """
        assert _run_rule(tsx, [RESERVATIONS_MODEL]) == []


# ---------------------------------------------------------------------------
# Rule — membership check (handler.sql.enum_value_unknown)
# ---------------------------------------------------------------------------


class TestEnumValueUnknownFinding:
    """``handler.sql.enum_value_unknown`` — literal not in declared
    ``enum_values`` and not a near-match. The handler builder invented it.
    """

    ORDERS_MODEL = {
        "name": "orders",
        "columns": [
            {"name": "id", "type": "integer"},
            {
                "name": "status",
                "type": "text",
                "enum_values": [
                    "pending",
                    "confirmed",
                    "shipped",
                    "delivered",
                    "canceled",
                ],
            },
        ],
    }

    def test_in_clause_with_paid_fires(self):
        # Real regression from app fhx5x8rj: getDashboardStats handler
        # filtered ``status IN ('paid', 'shipped')`` against an orders
        # table whose enum is pending/confirmed/shipped/delivered/canceled.
        # ``'paid'`` doesn't exist anywhere, so revenue stayed $0.
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare(
            "SELECT SUM(total) FROM orders WHERE status IN ('paid', 'shipped')"
          ).all();
        }
        export default handler;
        """
        findings = _run_rule_full(tsx, [self.ORDERS_MODEL])
        # Only 'paid' is unknown; 'shipped' is valid → exactly one finding.
        assert len(findings) == 1
        assert findings[0].rule_id == "handler.sql.enum_value_unknown"
        assert "'paid'" in findings[0].message
        assert "IN-literal" in findings[0].message

    def test_equality_with_invented_status_fires(self):
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare(
            "SELECT * FROM orders WHERE status = 'refunded'"
          ).all();
        }
        export default handler;
        """
        findings = _run_rule_full(tsx, [self.ORDERS_MODEL])
        assert len(findings) == 1
        assert findings[0].rule_id == "handler.sql.enum_value_unknown"
        assert "'refunded'" in findings[0].message

    def test_case_mismatch_still_takes_precedence(self):
        # 'PENDING' is a near-match for 'pending' — should fire
        # ``enum_case_mismatch``, NOT ``enum_value_unknown``.
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare(
            "SELECT * FROM orders WHERE status = 'PENDING'"
          ).all();
        }
        export default handler;
        """
        findings = _run_rule_full(tsx, [self.ORDERS_MODEL])
        assert len(findings) == 1
        assert findings[0].rule_id == "handler.sql.enum_case_mismatch"

    def test_byte_exact_match_no_finding(self):
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare(
            "SELECT * FROM orders WHERE status = 'shipped'"
          ).all();
        }
        export default handler;
        """
        assert _run_rule_full(tsx, [self.ORDERS_MODEL]) == []

    def test_multiple_invented_in_clause_literals(self):
        # ``'paid'`` AND ``'refunded'`` both unknown — two findings.
        tsx = """
        async function handler(ctx) {
          await ctx.db.prepare(
            "SELECT * FROM orders WHERE status IN ('paid', 'refunded')"
          ).all();
        }
        export default handler;
        """
        findings = _run_rule_full(tsx, [self.ORDERS_MODEL])
        assert len(findings) == 2
        assert all(f.rule_id == "handler.sql.enum_value_unknown" for f in findings)


# ---------------------------------------------------------------------------
# Fixer
# ---------------------------------------------------------------------------


class TestFixer:
    def test_rewrites_static_string(self):
        tsx = """async function handler(ctx) {
  await ctx.db.prepare("SELECT * FROM reservations WHERE status = 'CANCELLED'").all();
}
export default handler;
"""
        out, fixes = apply_handler_enum_case_fixes(tsx, [RESERVATIONS_MODEL])
        assert "'cancelled'" in out
        assert "'CANCELLED'" not in out
        assert any("enum case match" in f for f in fixes), fixes

    def test_rewrites_template_string(self):
        tsx = """async function handler(ctx) {
  await ctx.db.prepare(`SELECT * FROM reservations WHERE status = 'CANCELLED'`).all();
}
export default handler;
"""
        out, fixes = apply_handler_enum_case_fixes(tsx, [RESERVATIONS_MODEL])
        assert "'cancelled'" in out
        assert any("enum case match" in f for f in fixes)

    def test_skips_template_string_with_substitution(self):
        # Dynamic SQL — left to the dynamic-query rule, fixer skips.
        tsx = """async function handler(ctx) {
  const s = "CANCELLED";
  await ctx.db.prepare(`SELECT * FROM reservations WHERE status = '${s}'`).all();
}
export default handler;
"""
        out, fixes = apply_handler_enum_case_fixes(tsx, [RESERVATIONS_MODEL])
        assert out == tsx
        assert fixes == []

    def test_rewrites_in_list_literals(self):
        tsx = """async function handler(ctx) {
  await ctx.db.prepare("SELECT * FROM billings WHERE status IN ('paid', 'unpaid')").all();
}
export default handler;
"""
        out, fixes = apply_handler_enum_case_fixes(tsx, [BILLINGS_MODEL])
        # Both literals should be uppercased.
        assert "'PAID'" in out
        assert "'UNPAID'" in out
        assert "'paid'" not in out
        assert "'unpaid'" not in out
        assert len(fixes) == 2

    def test_no_change_when_already_correct(self):
        tsx = """async function handler(ctx) {
  await ctx.db.prepare("SELECT * FROM reservations WHERE status = 'cancelled'").all();
}
export default handler;
"""
        out, fixes = apply_handler_enum_case_fixes(tsx, [RESERVATIONS_MODEL])
        assert out == tsx
        assert fixes == []

    def test_skips_join_queries(self):
        tsx = """async function handler(ctx) {
  await ctx.db.prepare("SELECT * FROM reservations r JOIN guests g ON r.guest_id = g.id WHERE r.status = 'CANCELLED'").all();
}
export default handler;
"""
        out, fixes = apply_handler_enum_case_fixes(tsx, [RESERVATIONS_MODEL])
        assert out == tsx
        assert fixes == []

    def test_no_change_when_models_empty(self):
        tsx = """async function handler(ctx) {
  await ctx.db.prepare("SELECT * FROM reservations WHERE status = 'CANCELLED'").all();
}
export default handler;
"""
        out, fixes = apply_handler_enum_case_fixes(tsx, [])
        assert out == tsx
        assert fixes == []
