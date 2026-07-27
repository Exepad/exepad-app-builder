"""Auto-fix for FK-column header drift in handler SQL.

The SeedDataBuilder and BackendHandlerBuilder both work from the Creator's
PLAN, which names a relation by its bare field (``project``, ``assignee``).
The BackendModelBuilder — running in parallel — materializes that relation as
a ``<name>_id`` FK column (``project_id``, ``assignee_id``). So a generated
handler routinely emits SQL like::

    FROM tasks t LEFT JOIN projects p ON t.project = p.id

against a table whose column is actually ``project_id`` — failing at runtime
with ``no such column: t.project`` and 500-ing the handler. (The seed side of
the same drift is reconciled in deploy-utils' r2-seeder.)

This deterministic pass rewrites a QUALIFIED reference ``alias.col`` →
``alias.col_id`` when — and only when — the alias resolves to a declared model
whose schema HAS a ``col_id`` FK column but NOT a ``col`` column. Bare column
names are never touched (alias ambiguity), declared columns are never touched,
and only true FK columns drive a rename, so a legitimate ``t.status`` or
``p.name`` is left exactly as-is. Runs before handler semantic validation so
the model's single save attempt lands correct SQL without depending on the LLM
self-correcting.
"""

from __future__ import annotations

from main_agent.services.validation.fixers.component_enum_case import _apply_byte_edits
from main_agent.services.validation.tsx_ast.catalog import PLATFORM_SYSTEM_COLUMNS
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.sql import (
    _QUALIFIED_REF_RE,
    _extract_table_aliases,
)
from main_agent.services.validation.tsx_ast.walker import (
    find_calls,
    has_template_substitution,
    string_literal_value,
    template_string_static_value,
)


def _iter_prepare_sql(tree, buf: bytes):
    """Yield ``(sql, content_offset)`` for every static ``.prepare()`` /
    ``.exec()`` SQL literal — INCLUDING multi-table (JOIN) queries, which the
    enum-case iterator deliberately skips. ``content_offset`` is the absolute
    byte offset of the string's first content byte (past the opening quote)."""
    for call in find_calls(tree.root_node):
        callee = call.child_by_field_name("function")
        if callee is None or callee.type != "member_expression":
            continue
        prop = callee.child_by_field_name("property")
        if prop is None:
            continue
        method = buf[prop.start_byte : prop.end_byte].decode("utf-8")
        if method not in ("prepare", "exec"):
            continue
        args = call.child_by_field_name("arguments")
        if args is None or args.named_child_count == 0:
            continue
        arg0 = args.named_children[0]
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
        yield sql, arg0.start_byte + 1


def _blank_string_literals(sql: str) -> str:
    """Replace string-literal characters with spaces, preserving every
    character position, so qualified refs inside a literal (``'t.project'``)
    are never matched or rewritten."""
    import re

    out = list(sql)
    for pat in (r"'(?:[^'\\]|\\.)*'", r'"(?:[^"\\]|\\.)*"'):
        for m in re.finditer(pat, sql):
            for k in range(m.start(), m.end()):
                out[k] = " "
    return "".join(out)


def _build_schema(models: list[dict]) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    """Return ``(authored_cols, fk_cols)`` keyed by lowercase table name.

    ``authored_cols`` = every declared column; ``fk_cols`` = only columns that
    declare a ``references`` (the ``<name>_id`` FK columns)."""
    authored: dict[str, set[str]] = {}
    fk: dict[str, set[str]] = {}
    for m in models or []:
        if not isinstance(m, dict):
            continue
        name = (m.get("name") or "").lower()
        if not name:
            continue
        cols = m.get("columns") or []
        acols: set[str] = set()
        fcols: set[str] = set()
        for c in cols:
            if not isinstance(c, dict):
                continue
            cname = (c.get("name") or "").lower()
            if not cname:
                continue
            acols.add(cname)
            if c.get("references"):
                fcols.add(cname)
        authored[name] = acols
        fk[name] = fcols
    return authored, fk


def apply_handler_fk_column_fixes(
    tsx: str,
    models: list[dict],
) -> tuple[str, list[str]]:
    """Rewrite drifted FK column references in handler SQL. ``(fixed, fixes)``."""
    fixes: list[str] = []
    if not models:
        return tsx, fixes
    authored, fk_cols = _build_schema(models)
    if not any(fk_cols.values()):
        return tsx, fixes  # no relational models → nothing can drift

    tree = parse_tsx(tsx)
    if tree is None:
        return tsx, fixes
    buf = source_bytes(tsx)

    edits: list[tuple[int, int, str]] = []
    for sql, content_offset in _iter_prepare_sql(tree, buf):
        aliases = _extract_table_aliases(sql)
        blanked = _blank_string_literals(sql)
        for m in _QUALIFIED_REF_RE.finditer(blanked):
            ref_tab = m.group(1).lower()
            col = m.group(2).lower()
            table = aliases.get(ref_tab, ref_tab)
            table_cols = authored.get(table)
            if table_cols is None:
                continue  # not a declared model (or unknown column surface)
            if col in table_cols or col in PLATFORM_SYSTEM_COLUMNS:
                continue  # already a real column — never touch
            id_col = f"{col}_id"
            if id_col not in fk_cols.get(table, set()):
                continue  # not a `<col>_id` FK drift — leave it for the validator
            # Rewrite the column token `col` → `col_id`. Byte offsets computed by
            # encoding the SQL prefix so multi-byte content elsewhere can't shift them.
            b_start = content_offset + len(sql[: m.start(2)].encode("utf-8"))
            b_end = content_offset + len(sql[: m.end(2)].encode("utf-8"))
            edits.append((b_start, b_end, id_col))
            fixes.append(
                f"Rewrote handler SQL `{ref_tab}.{col}` → `{ref_tab}.{id_col}` "
                f"(FK column on {table}; the bare relation name has no column)"
            )

    if not edits:
        return tsx, fixes
    return _apply_byte_edits(buf, edits), fixes
