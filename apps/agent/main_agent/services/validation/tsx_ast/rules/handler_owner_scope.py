"""``handler.sql.owner_filter_scope_mismatch`` — handler SQL must
respect each table's declared ``ownerScope``.

The bug this catches
--------------------

App ``eiu7xj0v`` (2026-05-14): all 9 models were ``ownerScope: "shared"``
(xlsx-ingested data app — the platform's CreationWorkflow auto-flips
xlsx models via ``_flip_ingested_models_to_shared``). But the agent
emitted handler SQL like:

    `SELECT SUM(total) FROM orders WHERE owner_id = ?`

bound to ``ctx.user.id``. Auto-CRUD's ``sys_list`` honours
``ownerScope`` (``apps/app-backend/src/crud/list.ts:123``) and bypasses
the filter for shared models, returning all 250 seeded rows. The
handler does not — its raw SQL filters against an owner that doesn't
match the synthetic seed owner (``preview-owner-{appId}``), so the
dashboard rendered ``$0`` for every KPI.

The handler-patterns-rpc skill (``packages/schemas/data/agent_docs/
backend/skills/handler-patterns-rpc/SKILL.md``) now documents the
two-branch rule. This validator is the backstop: if the LLM regresses,
the build catches it before the dashboard ships empty.

What the rule covers
--------------------

For each handler ``ctx.db.prepare(SQL)`` / ``ctx.db.exec(SQL)`` call:

1. Extract the target table from ``FROM`` / ``UPDATE`` / ``INTO``.
2. If the SQL contains a ``JOIN``, **skip** — multi-table SQL needs
   alias-aware resolution to attribute the ``owner_id`` clause to a
   specific table. The agent docs cover JOINs manually; future
   tightening can add alias resolution.
3. Scan for ``WHERE owner_id ...`` predicates (any operator).
4. Look up ``target_table`` in ``ctx.models``. If the model's
   ``ownerScope`` is ``"shared"``, the predicate is wrong — emit a
   warning. If ``"user"``, the predicate is correct (skip). Unknown
   table or missing scope → fail open (no finding).

Severity
--------

Started at ``warning`` (post-eiu7xj0v ship, 2026-05-14). Escalated to
``error`` after r3hfcgx5 (2026-05-14) confirmed the same dashboard-zeros
regression — and revealed that the warning was crashing silently in
the BackendBuilder save path anyway, so the LLM never saw the signal.
``iter_handler_sql_calls`` already filters multi-table JOINs (the only
realistic false-positive vector), and the fix-hint tells the LLM
exactly what to drop, so an ``error``-level block forces a corrective
retry rather than shipping empty handlers. Pairs with the prompt
documentation in the handler-patterns-rpc skill (lines 201+).
"""

from __future__ import annotations

import re
from typing import Iterator

from .base import AstContext, Finding
from .handler_sql_enum_case import iter_handler_sql_calls


_RULE_ID = "handler.sql.owner_filter_scope_mismatch"


# Match ``owner_id`` referenced in a WHERE / AND / OR predicate (any
# operator). We only need to know the predicate exists — the rule's
# verdict depends on the table's declared scope, not the operator. The
# trailing ``\b`` after the operator is intentionally omitted because
# ``=``, ``!=``, ``<>`` are non-word chars and ``\b`` would fail to
# match against an adjacent space (``owner_id = ?``).
_OWNER_ID_PRED_RE = re.compile(
    r"\bowner_id\s*(?:=|!=|<>|\bIS\b|\bIN\b)",
    re.IGNORECASE,
)


def _owner_scope_for(ctx_models: list[dict], table: str) -> str | None:
    """Look up the ``ownerScope`` of a model by name (case-insensitive).

    Accepts both ``ownerScope`` (camelCase, runtime/config) and
    ``owner_scope`` (snake_case, backend surface).

    Fails open on non-dict entries. ``_validation_context_models`` is
    populated as a list of model-name strings during BackendBuilder
    handler-save (``backend_builder.py:797, 870``;
    ``handler_code_generator.py:120``) and as a list of full model dicts
    during the workflow-end replay pass (``creation_workflow.py:1554``;
    ``editing_workflow.py:682, 2760``). Without this guard the rule
    crashes on the handler-save path with
    ``AttributeError: 'str' object has no attribute 'get'``, and the
    real finding is lost under a ``{rule_id}.crash`` warning — exactly
    the regression seen on r3hfcgx5 (2026-05-14).
    """
    if not ctx_models:
        return None
    needle = table.lower()
    for m in ctx_models:
        if not isinstance(m, dict):
            # String entry (model name only) — can't resolve scope.
            continue
        name = (m.get("name") or "").lower()
        if name != needle:
            continue
        scope = m.get("ownerScope") or m.get("owner_scope")
        if isinstance(scope, str):
            return scope.lower()
    return None


class HandlerOwnerFilterScopeMismatchRule:
    """Handler SQL must respect ``model.ownerScope``."""

    id = _RULE_ID
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not ctx.models:
            return  # fail open — no model catalogue to cross-check

        for arg0, sql, _content_offset, target_table in iter_handler_sql_calls(
            ctx.tree, ctx.source_buf
        ):
            # iter_handler_sql_calls already filters out multi-table JOIN
            # queries — we'd need alias-aware attribution to be safe.
            if not _OWNER_ID_PRED_RE.search(sql):
                continue
            scope = _owner_scope_for(ctx.models, target_table)
            if scope is None:
                continue  # unknown table — fail open
            if scope == "user":
                continue  # correct — user-scoped models need the filter
            if scope == "shared":
                yield Finding(
                    rule_id=_RULE_ID,
                    severity="error",
                    line=arg0.start_point[0] + 1,
                    col=arg0.start_point[1],
                    message=(
                        f"Handler SQL filters `WHERE owner_id` on '{target_table}', "
                        f"but that model has ownerScope='shared' — the filter "
                        f"will match zero rows (seed rows are owned by the "
                        f"deploy-time synthetic owner, not the request user). "
                        f"Drop the owner_id predicate; shared-scoped data is "
                        f"visible to all users."
                    ),
                    fix_hint=(
                        f"remove `WHERE owner_id = ?` from this query on "
                        f"'{target_table}' (ownerScope='shared'). Keep "
                        f"owner_id filters only for ownerScope='user' tables."
                    ),
                )
            # Any other scope value → fail open (unknown enum, future
            # extension like "team" / "role" without a defined semantic).
