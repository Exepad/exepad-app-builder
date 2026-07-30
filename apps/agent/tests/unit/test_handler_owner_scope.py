"""Unit tests for ``HandlerOwnerFilterScopeMismatchRule`` — handler SQL
must respect each table's declared ``ownerScope``.

Bug motivation: eiu7xj0v (2026-05-14). All 9 xlsx-ingested models were
auto-flipped to ``ownerScope: "shared"``, but the handler SQL emitted
``WHERE owner_id = ?`` blindly. Auto-CRUD bypassed the owner filter
correctly (per ``crud/list.ts:123``); handler did not — dashboard showed
``$0`` everything.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.handler_owner_scope import (
    HandlerOwnerFilterScopeMismatchRule,
)


def _ctx(handler_tsx: str, models: list[dict]) -> AstContext:
    return AstContext(
        tsx=handler_tsx,
        source_buf=source_bytes(handler_tsx),
        tree=parse_tsx(handler_tsx),
        models=models,
    )


def _findings(handler_tsx: str, models: list[dict]) -> list:
    return list(
        HandlerOwnerFilterScopeMismatchRule().check(_ctx(handler_tsx, models))
    )


# ---------------------------------------------------------------------------
# 1. The eiu7xj0v regression — shared-scope handler has owner_id filter.
# ---------------------------------------------------------------------------


EIU7_HANDLER = """
async function handler(ctx) {
  const userId = ctx.user.id;
  const stats = await ctx.db.prepare(
    'SELECT SUM(total) as total_revenue FROM orders WHERE owner_id = ?'
  ).bind(userId).first();
  return { totalRevenue: stats?.total_revenue ?? 0 };
}
export default handler;
"""

EIU7_MODELS_SHARED = [
    {"name": "orders", "ownerScope": "shared", "columns": []}
]


def test_eiu7xj0v_shared_model_with_owner_filter_flagged() -> None:
    findings = _findings(EIU7_HANDLER, EIU7_MODELS_SHARED)
    assert len(findings) == 1
    f = findings[0]
    assert "orders" in f.message
    assert "shared" in f.message
    # Escalated to ``error`` post-r3hfcgx5 (2026-05-14): the warning was
    # crashing silently in the BackendBuilder save path AND the LLM
    # routinely ignored advisory findings even when emitted. Blocking
    # save forces a corrective retry.
    assert f.severity == "error"


# ---------------------------------------------------------------------------
# 2. User-scoped model with owner filter → no finding (correct).
# ---------------------------------------------------------------------------


def test_user_scoped_with_owner_filter_no_finding() -> None:
    models = [{"name": "orders", "ownerScope": "user", "columns": []}]
    assert _findings(EIU7_HANDLER, models) == []


# ---------------------------------------------------------------------------
# 3. Shared-scope WITHOUT owner filter → no finding (correct).
# ---------------------------------------------------------------------------


def test_shared_without_owner_filter_no_finding() -> None:
    handler = """
async function handler(ctx) {
  const stats = await ctx.db.prepare(
    'SELECT SUM(total) as total_revenue FROM orders'
  ).first();
  return { totalRevenue: stats?.total_revenue ?? 0 };
}
"""
    assert _findings(handler, EIU7_MODELS_SHARED) == []


# ---------------------------------------------------------------------------
# 4. snake_case `owner_scope` (backend surface) recognised.
# ---------------------------------------------------------------------------


def test_snake_case_owner_scope_field_recognised() -> None:
    models = [{"name": "orders", "owner_scope": "shared", "columns": []}]
    assert len(_findings(EIU7_HANDLER, models)) == 1


# ---------------------------------------------------------------------------
# 5. JOIN queries are skipped (multi-table — alias resolution out of scope).
# ---------------------------------------------------------------------------


def test_join_query_skipped() -> None:
    handler = """
async function handler(ctx) {
  const rows = await ctx.db.prepare(`
    SELECT i.*, p.name AS product_name
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    WHERE i.owner_id = ?
  `).bind(ctx.user.id).all();
  return { rows: rows.results };
}
"""
    models = [
        {"name": "inventory", "ownerScope": "shared", "columns": []},
        {"name": "products", "ownerScope": "shared", "columns": []},
    ]
    # iter_handler_sql_calls filters JOIN queries — we don't flag them
    # to avoid mis-attributing alias-bound owner_id columns.
    assert _findings(handler, models) == []


# ---------------------------------------------------------------------------
# 6. ctx.db.exec calls covered (not just ctx.db.prepare).
# ---------------------------------------------------------------------------


def test_ctx_db_exec_covered() -> None:
    handler = """
async function handler(ctx) {
  const stats = await ctx.db.exec(
    'SELECT * FROM orders WHERE owner_id = ?', [ctx.user.id]
  );
  return { stats };
}
"""
    assert len(_findings(handler, EIU7_MODELS_SHARED)) == 1


# ---------------------------------------------------------------------------
# 7. Various predicate shapes recognised (= / IN / IS).
# ---------------------------------------------------------------------------


def test_owner_id_in_clause_flagged() -> None:
    handler = """
async function handler(ctx) {
  const rows = await ctx.db.prepare(
    "SELECT * FROM orders WHERE owner_id IN ('a','b')"
  ).all();
  return rows;
}
"""
    assert len(_findings(handler, EIU7_MODELS_SHARED)) == 1


def test_owner_id_is_null_flagged() -> None:
    handler = """
async function handler(ctx) {
  const rows = await ctx.db.prepare(
    'SELECT * FROM orders WHERE owner_id IS NULL'
  ).all();
  return rows;
}
"""
    assert len(_findings(handler, EIU7_MODELS_SHARED)) == 1


# ---------------------------------------------------------------------------
# 8. Fail-open contracts.
# ---------------------------------------------------------------------------


def test_no_models_fails_open() -> None:
    assert _findings(EIU7_HANDLER, []) == []


def test_unknown_table_fails_open() -> None:
    models = [{"name": "different_table", "ownerScope": "shared", "columns": []}]
    assert _findings(EIU7_HANDLER, models) == []


def test_missing_owner_scope_field_fails_open() -> None:
    models = [{"name": "orders", "columns": []}]  # no ownerScope at all
    assert _findings(EIU7_HANDLER, models) == []


# ---------------------------------------------------------------------------
# 9. r3hfcgx5 regression — _validation_context_models populated as bare
# name-strings (BackendBuilder save path) instead of full dicts (replay
# path). Without the isinstance(dict) guard the rule crashes with
# ``AttributeError: 'str' object has no attribute 'get'`` and the real
# finding is swallowed under ``{rule_id}.crash``.
# ---------------------------------------------------------------------------


def test_string_only_models_does_not_crash() -> None:
    """All-string list (BackendBuilder save path) → no crash, no finding."""
    models = ["orders", "customers", "products"]
    # type: ignore[arg-type]  — runtime shape mismatch is the bug we're guarding against.
    findings = _findings(EIU7_HANDLER, models)  # type: ignore[arg-type]
    assert findings == []


def test_mixed_shape_models_resolves_dict_entry() -> None:
    """Mixed list — bare names skipped, dict entry consulted."""
    # type: ignore[list-item] — heterogeneous list is the exact regression.
    models = [
        "orders",  # string entry — must be skipped, not crashed on
        {"name": "orders", "ownerScope": "shared", "columns": []},
        "customers",
    ]
    findings = _findings(EIU7_HANDLER, models)  # type: ignore[arg-type]
    assert len(findings) == 1
    assert "orders" in findings[0].message
