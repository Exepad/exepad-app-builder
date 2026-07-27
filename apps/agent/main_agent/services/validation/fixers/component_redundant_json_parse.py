"""Auto-fixer that removes redundant ``JSON.parse`` on auto-parsed JSON columns.

Background
----------

The app-backend auto-parses columns declared ``type: "json"`` before
returning rows to the frontend (see ``apps/app-backend/src/crud/read.ts``
and ``list.ts``). The ``useModel(...)`` hook therefore yields rows whose
``json``-typed fields are already JS values — usually an ``Array``, an
``Object``, or ``null``. They are **never** raw strings on the frontend.

Despite this, ComponentBuilder routinely emits the defensive pattern::

    const features = Array.isArray(plan.features)
      ? plan.features
      : JSON.parse(plan.features || "[]");

When the seed CSV stored the field as a JSON object (rather than an
array), ``plan.features`` arrives as an object. ``Array.isArray`` returns
``false``, the second branch runs, ``JSON.parse`` coerces the object to
the string ``"[object Object]"``, and the whole component render fails
with ``SyntaxError: "[object Object]" is not valid JSON``. The page
shows the runtime's "This section isn't available right now." gate.

First surfaced on app ``alo48zsn`` (2026-05-15) where the entire
``/plans-subscriptions`` page broke this way.

What this fixer does
--------------------

For every ``Array.isArray(<expr>) ? <expr> : JSON.parse(<expr> || "[]")``
ternary where the FINAL identifier in ``<expr>`` matches a column name of
``type: "json"`` in the per-app model schema, rewrite the second branch
to a defensive object-aware fallback::

    const features = Array.isArray(plan.features)
      ? plan.features
      : plan.features && typeof plan.features === "object"
        ? Object.values(plan.features)
        : [];

Gating on a json-typed column from ``ctx.models`` is what makes the fix
safe — we don't touch components that legitimately parse a text-typed
JSON-looking string.

The fixer is regex-based (not tree-sitter) because the pattern is
specific and unambiguous; an AST pass here would be more code for no
extra robustness. The match span is narrow (single ternary expression),
the replacement is local, and there's no risk of byte-offset cascade
across multiple matches in the same file.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext

# Match: Array.isArray(<EXPR>) ? <EXPR> : JSON.parse(<EXPR> || "[]")
# where <EXPR> is captured once and back-referenced. Allows arbitrary
# whitespace (incl. newlines) between tokens. The expression body is a
# moderately permissive ``[\w\.\?\[\]'"]+`` — enough for ``plan.features``,
# ``row?.features``, ``items[0].features``, but not arbitrary subexpressions
# with parens or calls (which would be unusual here).
_PATTERN = re.compile(
    r"""
    Array\.isArray\(\s*
    (?P<expr>[\w.\?\[\]'"]+)
    \s*\)
    \s*\?\s*
    (?P=expr)
    \s*:\s*
    JSON\.parse\(\s*
    (?P=expr)
    \s*\|\|\s*
    "\[\]"
    \s*\)
    """,
    re.VERBOSE | re.DOTALL,
)


def _json_typed_columns(models: list[dict]) -> set[str]:
    """Return the set of column names declared ``type: "json"`` across all models."""
    out: set[str] = set()
    for m in models or []:
        if not isinstance(m, dict):
            continue
        for col in m.get("columns") or []:
            if not isinstance(col, dict):
                continue
            if col.get("type") == "json":
                name = col.get("name")
                if isinstance(name, str) and name:
                    out.add(name)
    return out


def _final_identifier(expr: str) -> str | None:
    """Return the last identifier segment in a member-access expression.

    ``"plan.features"`` -> ``"features"``;
    ``"row?.features"`` -> ``"features"``;
    ``"items[0].features"`` -> ``"features"``.
    Returns ``None`` if no identifier can be extracted.
    """
    # Strip trailing whitespace and optional chaining.
    s = expr.strip()
    # Take the final ``.<ident>`` after the last dot (handles ``?.`` too).
    if "." in s:
        tail = s.rsplit(".", 1)[-1]
    else:
        tail = s
    # Strip any leftover punctuation / brackets.
    m = re.match(r"^([A-Za-z_$][\w$]*)", tail)
    return m.group(1) if m else None


def apply_component_redundant_json_parse_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Rewrite ``JSON.parse`` ternaries on json-typed columns.

    No-op when the file has no matching pattern, when ``ctx.models``
    declares no json-typed columns, or when the matched expression's
    final identifier isn't a json column.
    """
    if "JSON.parse" not in tsx:
        return tsx

    json_cols = _json_typed_columns(ctx.models)
    if not json_cols:
        return tsx

    rewrites_done = 0

    def _replace(match: re.Match[str]) -> str:
        nonlocal rewrites_done
        expr = match.group("expr")
        ident = _final_identifier(expr)
        if ident is None or ident not in json_cols:
            return match.group(0)
        rewrites_done += 1
        # Defensive replacement: array stays as-is; object collapses to
        # its values for .map; null/undefined falls back to [].
        return (
            f"Array.isArray({expr})\n"
            f"      ? {expr}\n"
            f"      : {expr} && typeof {expr} === \"object\"\n"
            f"        ? Object.values({expr})\n"
            f"        : []"
        )

    out = _PATTERN.sub(_replace, tsx)
    if rewrites_done > 0:
        fixes_applied.append(
            f"Removed redundant JSON.parse on {rewrites_done} json-typed "
            "column reference(s); replaced with defensive Array/typeof check"
        )
    return out
