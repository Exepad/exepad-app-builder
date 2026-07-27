"""Unit tests for the handler read-gate cross-check.

Regression target: Meridian pentest (2026-07-25). ``clients.crudPolicy.read =
'role:admin'`` but the public ``getDashboardStats`` read handler JOINed
``clients`` and returned ``client_name``, leaking admin-gated data to anonymous
callers. The tier lattice mirrors ``app-backend/src/rpc/router.ts`` checkAuth.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.handler_read_gate import (
    _handler_caller_tier,
    _handler_read_tables,
    _model_read_tier,
    _policy_tier,
    check_handler_read_gate,
)

pytestmark = [pytest.mark.unit]

# The real getDashboardStats-shaped SQL (JOIN of a gated table).
_DASHBOARD_SQL = (
    "const stmt = env.DB.prepare("
    "`SELECT p.title, c.name AS client_name, SUM(t.hours) AS total_hours "
    "FROM time_entries t JOIN projects p ON p.id = t.project_id "
    "JOIN clients c ON c.id = p.client_id GROUP BY p.id`);"
)


def _model(name, read=None, list_=None, ownerScope="shared"):
    crud = {}
    if read is not None:
        crud["read"] = read
    if list_ is not None:
        crud["list"] = list_
    return {"name": name, "ownerScope": ownerScope, "crudPolicy": crud}


def _handler(name, authLevel, handlerType="read"):
    return {"name": name, "authLevel": authLevel, "handlerType": handlerType}


# ── tier lattice (must match the router) ─────────────────────────────────────
def test_policy_tiers():
    assert _policy_tier("public") == 0
    assert _policy_tier("authenticated") == 1
    assert _policy_tier("owner") == 1
    assert _policy_tier("role:admin") == 2
    assert _policy_tier("admin") == 2
    assert _policy_tier("role:editor") == 2
    assert _policy_tier("none") == 3
    assert _policy_tier(None) is None
    assert _policy_tier("") is None
    assert _policy_tier("weird") == 1  # router: any non-special level requires auth


def test_undefined_handler_authlevel_is_authenticated_not_public():
    # router: `requiredLevel || 'authenticated'` — undefined is tier 1, NOT 0.
    assert _handler_caller_tier({"name": "h", "handlerType": "read"}) == 1
    assert _handler_caller_tier(_handler("h", "public")) == 0


def test_write_handler_floor_is_authenticated_even_if_public():
    # A non-read handler forces auth at runtime (H8 write guard).
    assert _handler_caller_tier(_handler("h", "public", handlerType="write")) == 1


def test_model_read_tier_uses_stricter_of_read_and_list():
    assert _model_read_tier(_model("m", read="public", list_="role:admin")) == 2
    assert _model_read_tier(_model("m", read="role:admin", list_="public")) == 2
    assert _model_read_tier(_model("m", read="public")) == 0


def test_unset_read_defaults_to_authenticated_tier_not_ungated():
    # Router: `model.crudPolicy?.read ?? undefined` → checkAuth → 'authenticated'.
    # An unset read is a gate (tier 1), NOT ungated — mirror that, exactly as the
    # handler side coerces an unset authLevel. (Review finding, 2026-07-25.)
    assert _model_read_tier({"name": "m"}) == 1  # no crudPolicy at all
    assert _model_read_tier(_model("m")) == 1  # crudPolicy {} (no read key)
    assert _model_read_tier(_model("m", list_="public")) == 1  # read unset, list public


# ── table extraction ─────────────────────────────────────────────────────────
def test_read_tables_from_join():
    tables = _handler_read_tables(_DASHBOARD_SQL)
    assert tables == {"time_entries", "projects", "clients"}


def test_read_tables_ignores_write_targets():
    sql = 'env.DB.prepare("INSERT INTO audit_log (msg) VALUES (?)").run(m);'
    # INSERT target is a write, not a read — not captured.
    assert _handler_read_tables(sql) == set()


def test_read_tables_captures_from_inside_insert_select():
    sql = 'env.DB.prepare("INSERT INTO cache SELECT * FROM clients").run();'
    assert "clients" in _handler_read_tables(sql)


# ── the core check ───────────────────────────────────────────────────────────
def test_meridian_regression_public_handler_reads_admin_model():
    models = [
        _model("clients", read="role:admin"),
        _model("projects", read="public"),
        _model("time_entries", read="public"),
    ]
    handlers = [_handler("getDashboardStats", "public", handlerType="read")]
    sources = {"getDashboardStats": _DASHBOARD_SQL}

    warns = check_handler_read_gate(models, handlers, sources)
    assert len(warns) == 1
    assert "getDashboardStats" in warns[0]
    assert "clients" in warns[0]
    assert "role:admin" in warns[0]


def test_authenticated_handler_reading_admin_model_still_flagged():
    models = [_model("clients", read="role:admin")]
    handlers = [_handler("h", "authenticated", handlerType="read")]
    sources = {"h": 'env.DB.prepare("SELECT * FROM clients").all();'}
    assert len(check_handler_read_gate(models, handlers, sources)) == 1


def test_public_handler_reading_public_model_not_flagged():
    models = [_model("projects", read="public")]
    handlers = [_handler("h", "public", handlerType="read")]
    sources = {"h": 'env.DB.prepare("SELECT * FROM projects").all();'}
    assert check_handler_read_gate(models, handlers, sources) == []


def test_matching_authlevel_not_flagged():
    models = [_model("clients", read="role:admin")]
    handlers = [_handler("adminReport", "role:admin", handlerType="read")]
    sources = {"adminReport": 'env.DB.prepare("SELECT * FROM clients").all();'}
    assert check_handler_read_gate(models, handlers, sources) == []


def test_two_role_levels_same_tier_not_flagged():
    # role:editor handler reading a role:admin model — same tier, cannot order
    # role names without the hierarchy, so conservatively NOT flagged.
    models = [_model("clients", read="role:admin")]
    handlers = [_handler("h", "role:editor", handlerType="read")]
    sources = {"h": 'env.DB.prepare("SELECT * FROM clients").all();'}
    assert check_handler_read_gate(models, handlers, sources) == []


def test_handler_not_reading_the_gated_model_not_flagged():
    models = [_model("clients", read="role:admin"), _model("projects", read="public")]
    handlers = [_handler("h", "public", handlerType="read")]
    sources = {"h": 'env.DB.prepare("SELECT * FROM projects").all();'}
    assert check_handler_read_gate(models, handlers, sources) == []


def test_public_handler_reading_owner_scoped_model_flagged():
    # read:'owner' requires auth (tier 1); a public handler (tier 0) exposes it.
    models = [_model("notes", read="owner", ownerScope="user")]
    handlers = [_handler("h", "public", handlerType="read")]
    sources = {"h": 'env.DB.prepare("SELECT * FROM notes").all();'}
    assert len(check_handler_read_gate(models, handlers, sources)) == 1


def test_undefined_handler_authlevel_reading_admin_model_flagged():
    # undefined authLevel = 'authenticated' (tier 1) < role:admin (tier 2).
    models = [_model("clients", read="role:admin")]
    handlers = [{"name": "h", "handlerType": "read"}]  # no authLevel
    sources = {"h": 'env.DB.prepare("SELECT * FROM clients").all();'}
    warns = check_handler_read_gate(models, handlers, sources)
    assert len(warns) == 1
    assert "authenticated (default)" in warns[0]


def test_none_source_and_empty_inputs_are_safe():
    assert check_handler_read_gate([], [], {}) == []
    models = [_model("clients", read="role:admin")]
    handlers = [_handler("h", "public")]
    assert check_handler_read_gate(models, handlers, {}) == []  # no source → skip
    assert check_handler_read_gate(models, handlers, {"h": ""}) == []


def test_multiple_gated_models_one_handler_multiple_warnings():
    models = [_model("clients", read="role:admin"), _model("salaries", read="role:admin")]
    handlers = [_handler("h", "public", handlerType="read")]
    sources = {
        "h": 'env.DB.prepare("SELECT * FROM clients c JOIN salaries s ON s.cid=c.id").all();'
    }
    warns = check_handler_read_gate(models, handlers, sources)
    assert len(warns) == 2
    assert {"clients" in w for w in warns} == {True} or any("clients" in w for w in warns)
    assert any("salaries" in w for w in warns)


# ── nested reads must be caught (review finding #2, 2026-07-25) ──────────────
# parse_sql's walker iterates only top-level tokens, so a gated table read inside
# a subquery / CTE / WHERE-IN / derived table was invisible. A flat FROM/JOIN
# scan now supplements it.
def test_read_tables_catches_where_in_subquery():
    sql = 'env.DB.prepare("SELECT id FROM projects WHERE client_id IN (SELECT id FROM clients)").all();'
    assert "clients" in _handler_read_tables(sql)


def test_read_tables_catches_correlated_subquery_in_select():
    sql = (
        'env.DB.prepare("SELECT p.id, (SELECT name FROM clients c WHERE c.id=p.client_id) '
        'AS cn FROM projects p").all();'
    )
    assert "clients" in _handler_read_tables(sql)


def test_read_tables_catches_cte_body():
    sql = 'env.DB.prepare("WITH secret AS (SELECT * FROM clients) ' 'SELECT * FROM secret").all();'
    assert "clients" in _handler_read_tables(sql)


def test_read_tables_catches_derived_table_in_from():
    sql = 'env.DB.prepare("SELECT * FROM (SELECT name FROM clients) t").all();'
    assert "clients" in _handler_read_tables(sql)


def test_meridian_leak_via_subquery_is_flagged():
    # The exact leak, rewritten so the gated read hides in a subquery.
    models = [_model("clients", read="role:admin"), _model("projects", read="public")]
    handlers = [_handler("getDashboardStats", "public", handlerType="read")]
    sources = {
        "getDashboardStats": (
            'env.DB.prepare("SELECT p.title, '
            "(SELECT name FROM clients WHERE id = p.client_id) AS client_name "
            'FROM projects p").all();'
        )
    }
    warns = check_handler_read_gate(models, handlers, sources)
    assert any("clients" in w for w in warns)


# ── unset-read model exposed by a public handler (review finding #1) ─────────
def test_public_handler_reading_unset_read_model_is_flagged():
    # Model with no explicit read gate → runtime default 'authenticated' (tier 1);
    # a public handler (tier 0) reading it exposes authenticated-gated rows to anon.
    models = [{"name": "invoices", "ownerScope": "user", "crudPolicy": {}}]
    handlers = [_handler("getInvoiceFeed", "public", handlerType="read")]
    sources = {"getInvoiceFeed": 'env.DB.prepare("SELECT * FROM invoices").all();'}
    warns = check_handler_read_gate(models, handlers, sources)
    assert len(warns) == 1
    assert "authenticated (default)" in warns[0]


def test_public_handler_reading_no_crudpolicy_model_is_flagged():
    models = [{"name": "invoices", "ownerScope": "user"}]  # no crudPolicy key at all
    handlers = [_handler("f", "public", handlerType="read")]
    sources = {"f": 'env.DB.prepare("SELECT * FROM invoices").all();'}
    assert len(check_handler_read_gate(models, handlers, sources)) == 1


def test_explicit_public_read_model_still_not_flagged():
    # The fix must not make explicit read:'public' models noisy.
    models = [{"name": "posts", "crudPolicy": {"read": "public"}}]
    handlers = [_handler("f", "public", handlerType="read")]
    sources = {"f": 'env.DB.prepare("SELECT * FROM posts").all();'}
    assert check_handler_read_gate(models, handlers, sources) == []
