"""``handler.auth.reads_gated_model`` — a handler must not be callable at a
weaker auth level than the read gate on a model its SQL SELECTs from.

The bug this catches
--------------------

Model-level ``crudPolicy`` only gates the auto-CRUD surface (``sys_list`` /
``sys_read`` / …). A custom handler runs raw SQL, and its access is governed
SOLELY by its own ``authLevel``
(``app-backend/src/rpc/router.ts`` → ``checkAuth(handler.authLevel, …)``) — the
platform never cross-checks that level against the models the SQL touches. So a
public read handler that JOINs a ``read: 'role:admin'`` model hands that model's
rows to anyone who can call the handler, silently defeating its read gate.

Found live (2026-07-25, Meridian pentest): ``clients.crudPolicy.read =
'role:admin'`` but ``getDashboardStats`` (``authLevel: 'public'``,
``handlerType: 'read'``) selected ``client_name`` through a JOIN, so an
ANONYMOUS caller read client names out of the admin-gated table. Same class as
the self-signup role escalation — two individually-reasonable AI decisions
(protect the table; expose an aggregate) that combine into a leak, with nothing
cross-checking them.

Why here (BackendBuilder), not a save-time TSX rule or the cross-validator
--------------------------------------------------------------------------

The check needs three facts with REAL values at once: the handler SQL, the
handler ``authLevel``, and each model's computed ``crudPolicy``. No single
earlier stage has all three — at handler-save time ``ctx.models`` are
``ModelPlan`` objects that carry no ``crudPolicy`` (it is derived later), and by
config-finalization the handler ``source`` is a path, not code. They only
coexist inside the BackendBuilder right after handler code is generated: the
models carry crudPolicy, the handler metadata carries authLevel, and the handler
TSX is still in the artifact store.

Design
------

Conservative by construction: fires only when the caller's auth TIER is strictly
below the model's read tier, on the lattice the router itself enforces —
``public(0) < authenticated/owner(1) < role:*/admin(2) < none(3)``. Two
role-specific levels (a ``role:editor`` handler reading a ``role:admin`` model)
are the SAME tier and are NOT flagged, because ``role:`` levels cannot be
totally ordered without the role hierarchy — the runtime's
``enforceSharedScopeReadGate`` makes exactly this choice. Owner-scope cross-user
exposure is a separate axis handled by the ``handler_owner_scope`` rule.

Advisory only (a warning, never a hard block): a deliberately-public dashboard
that aggregates over a role-gated detail table is a legitimate design, and
auto-raising the handler's authLevel would silently gate it behind login. The
message tells the author the three options: raise the handler authLevel, stop
selecting from the gated model, or accept the exposure.
"""

from __future__ import annotations

import re

from main_agent.services.validation.tsx_ast.sql import parse_sql

# SQL literal passed to ``db.prepare(...)`` in any of the three JS string forms.
# Non-greedy to the first matching quote; ``${…}`` template interpolation inside
# is tolerated (parse_sql is lenient). Mirrors where the handler-SQL FK fixer
# reads queries from.
_PREPARE_SQL_RE = re.compile(r"\.prepare\s*\(\s*([`'\"])(?P<sql>.*?)\1", re.DOTALL)


def _policy_tier(level: object) -> int | None:
    """Map an auth level to its tier, or None when unset.

    Lattice mirrors ``app-backend/src/rpc/router.ts`` ``checkAuth``:
    ``public(0) < authenticated/owner(1) < role:*/admin(2) < none(3)``. An unset
    level returns None (no gate to compare). An unrecognised non-empty string is
    treated as requiring authentication (tier 1), matching the router's
    fall-through (any non-special level requires a signed-in user).
    """
    if level is None or level == "" or not isinstance(level, str):
        return None
    lv = level.strip()
    if lv == "public":
        return 0
    if lv == "none":
        return 3
    if lv in ("authenticated", "owner"):
        return 1
    if lv == "admin" or lv.startswith("role:"):
        return 2
    return 1


def _handler_caller_tier(handler: dict) -> int:
    """Minimum auth tier required to CALL this handler, per the router.

    ``checkAuth`` resolves an unset/empty ``authLevel`` to ``'authenticated'``
    (``requiredLevel || 'authenticated'``), so an undefined level is tier 1, NOT
    public — only an explicit ``authLevel: 'public'`` is tier 0. A non-read
    handler additionally forces authentication (the H8 write guard), so its
    effective floor is tier 1 regardless of its declared level.
    """
    tier = _policy_tier(handler.get("authLevel"))
    if tier is None:  # unset → router default 'authenticated'
        tier = 1
    if handler.get("handlerType") != "read":
        tier = max(tier, 1)
    return tier


def _model_read_tier(model: dict) -> int:
    """The tier a direct read of this model's row values would require.

    A handler SELECT is a bulk read, so compare against the stricter of the
    model's ``read`` and ``list`` policies (``list`` defaults to ``read`` when
    unset).

    An UNSET read/list is NOT ungated: the router resolves it to
    ``'authenticated'`` (``requiredLevel || 'authenticated'``), so a direct
    anonymous read of a model with no ``crudPolicy.read`` is rejected — the type
    contract documents ``read?`` with ``@default 'authenticated'``. We therefore
    coerce an unset gate to tier 1, exactly as :func:`_handler_caller_tier` does
    for an unset ``authLevel``. Only an EXPLICIT ``read: 'public'`` is tier 0.
    """
    crud = model.get("crudPolicy")
    if not isinstance(crud, dict):
        crud = {}
    read = crud.get("read")
    lst = crud.get("list", read)
    read_tier = _policy_tier(read)
    list_tier = _policy_tier(lst)
    return max(1 if read_tier is None else read_tier, 1 if list_tier is None else list_tier)


# A ``FROM``/``JOIN`` source table at ANY nesting depth. Deliberately flat (not
# structural) so a gated table read inside a subquery, a ``WHERE … IN (SELECT …)``,
# a ``WITH`` CTE body, or a derived table is caught — parse_sql's walker only
# iterates top-level tokens and misses those. Over-matching a CTE/derived-table
# alias or a stray ``FROM`` in a string literal is harmless: the name is only
# acted on when it matches a gated MODEL.
_FROM_JOIN_RE = re.compile(r"\b(?:FROM|JOIN)\s+[`\"']?([A-Za-z_]\w*)", re.IGNORECASE)


def _handler_read_tables(source: str) -> set[str]:
    """Lowercased table names a handler's SQL READS (FROM / JOIN sources).

    INSERT/UPDATE/DELETE targets are writes, gated on a different axis, so they
    are excluded — but a ``FROM`` inside an ``INSERT … SELECT`` is still a read
    and is captured. Uses parse_sql for the alias-aware top-level refs plus a
    flat regex so nested reads (subquery / CTE / WHERE-IN / derived table) are
    caught too. Best-effort: unparseable SQL yields nothing.
    """
    tables: set[str] = set()
    for m in _PREPARE_SQL_RE.finditer(source or ""):
        sql = m.group("sql")
        for ref in parse_sql(sql).refs:
            if ref.verb in ("FROM", "JOIN"):
                tables.add(ref.table.lower())
        for tm in _FROM_JOIN_RE.finditer(sql):
            tables.add(tm.group(1).lower())
    return tables


def _gated_models(models: list[dict]) -> dict[str, tuple[int, str]]:
    """``{model_name_lower: (read_tier, display_read_level)}`` for models whose
    read gate requires auth (tier ≥ 1). Public / ungated models are excluded —
    there is nothing to bypass on them."""
    gated: dict[str, tuple[int, str]] = {}
    for model in models:
        if not isinstance(model, dict) or not model.get("name"):
            continue
        tier = _model_read_tier(model)
        if tier <= 0:
            continue  # explicit public read — nothing to bypass
        crud = model.get("crudPolicy") or {}
        shown = crud.get("read") or crud.get("list") or "authenticated (default)"
        gated[str(model["name"]).lower()] = (tier, str(shown))
    return gated


def check_handler_read_gate(
    models: list[dict],
    handlers: list[dict],
    handler_sources: dict[str, str],
) -> list[str]:
    """Return one warning per (handler, gated-model) where the handler's caller
    tier is strictly below the model's read tier.

    Args:
        models: built model configs, each with ``name`` + ``crudPolicy``.
        handlers: handler metadata, each with ``name``/``method`` + ``authLevel``
            + ``handlerType``.
        handler_sources: ``{handler_name: tsx}`` — the handler SQL bodies.
    """
    if not models or not handlers or not handler_sources:
        return []

    gated = _gated_models(models)
    if not gated:
        return []

    warnings: list[str] = []
    for handler in handlers:
        if not isinstance(handler, dict):
            continue
        name = handler.get("name") or handler.get("method")
        if not name:
            continue
        source = handler_sources.get(name)
        if not source:
            continue
        caller_tier = _handler_caller_tier(handler)
        for table in sorted(_handler_read_tables(source)):
            info = gated.get(table)
            if info is None:
                continue
            read_tier, read_level = info
            if read_tier > caller_tier:
                shown_auth = handler.get("authLevel") or "authenticated (default)"
                warnings.append(
                    f"Handler '{name}' (authLevel '{shown_auth}') reads model "
                    f"'{table}', whose crudPolicy gates reads at '{read_level}' — a "
                    f"stricter level. The model read gate is bypassed: anyone who can "
                    f"call this handler can read '{table}' data through it. Raise the "
                    f"handler's authLevel to match, stop selecting from '{table}', or "
                    f"accept the exposure."
                )
    return warnings
