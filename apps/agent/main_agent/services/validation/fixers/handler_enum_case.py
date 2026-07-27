"""Auto-fix for ``handler.sql.enum_case_mismatch``.

Rewrites string literals in handler SQL ``WHERE col = 'literal'`` (or
``IN``, ``!=``, ``LIKE``) clauses to match a column's declared
``enum_values`` casing. Mirrors the component-side
``apply_component_enum_case_fixes`` semantics — case AND punctuation
near-matches are normalised to the declared form; wholly unrelated
literals are left alone.

Scoping: ``iter_handler_sql_calls`` (in the matching rule module)
parses the FROM/UPDATE/INSERT INTO target and skips JOIN queries plus
dynamic templates. Single-table static SQL only.
"""

from __future__ import annotations

from main_agent.services.validation.fixers.component_enum_case import _apply_byte_edits
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_filter_enum_case import (
    _collect_enum_columns,
)
from main_agent.services.validation.tsx_ast.rules.handler_sql_enum_case import (
    _IN_LITERAL_RE,
    _IN_RE,
    _PRED_RE,
    find_near_match,
    iter_handler_sql_calls,
)


def _collect_predicate_edits(
    sql: str,
    target_table: str,
    content_offset: int,
    enum_lookup,
    edits: list[tuple[int, int, str]],
    fixes_applied: list[str],
) -> None:
    """Append rewrites for ``col = 'literal'`` / ``!=`` / ``LIKE`` predicates."""
    for m in _PRED_RE.finditer(sql):
        col = m.group(1).lower()
        literal = m.group(3)
        values = enum_lookup.get((target_table, col))
        if not values:
            continue
        declared = find_near_match(literal, values)
        if declared is None:
            continue
        edits.append((content_offset + m.start(3), content_offset + m.end(3), declared))
        fixes_applied.append(
            f"Rewrote handler SQL `{col} = '{literal}'` → `'{declared}'` "
            f"(enum case match on {target_table}.{col})"
        )


def _collect_in_list_edits(
    sql: str,
    target_table: str,
    content_offset: int,
    enum_lookup,
    edits: list[tuple[int, int, str]],
    fixes_applied: list[str],
) -> None:
    """Append rewrites for ``col IN ('a', 'b', ...)`` clauses, one per literal."""
    for m in _IN_RE.finditer(sql):
        col = m.group(1).lower()
        values = enum_lookup.get((target_table, col))
        if not values:
            continue
        list_start_in_sql = m.start(2)
        for lit_m in _IN_LITERAL_RE.finditer(m.group(2)):
            literal = lit_m.group(1)
            declared = find_near_match(literal, values)
            if declared is None:
                continue
            edits.append(
                (
                    content_offset + list_start_in_sql + lit_m.start(1),
                    content_offset + list_start_in_sql + lit_m.end(1),
                    declared,
                )
            )
            fixes_applied.append(
                f"Rewrote handler SQL IN-literal `'{literal}'` → "
                f"`'{declared}'` (enum case match on {target_table}.{col})"
            )


def apply_handler_enum_case_fixes(
    tsx: str,
    models: list[dict],
) -> tuple[str, list[str]]:
    """Apply enum-case rewrites to handler TSX. Returns ``(fixed, fixes)``."""
    fixes_applied: list[str] = []
    if not models:
        return tsx, fixes_applied
    enum_lookup = {
        (model.lower(), col.lower()): values for model, col, values in _collect_enum_columns(models)
    }
    if not enum_lookup:
        return tsx, fixes_applied

    tree = parse_tsx(tsx)
    if tree is None:
        return tsx, fixes_applied
    buf = source_bytes(tsx)

    edits: list[tuple[int, int, str]] = []
    for _arg0, sql, content_offset, target_table in iter_handler_sql_calls(tree, buf):
        _collect_predicate_edits(
            sql, target_table, content_offset, enum_lookup, edits, fixes_applied
        )
        _collect_in_list_edits(sql, target_table, content_offset, enum_lookup, edits, fixes_applied)

    if not edits:
        return tsx, fixes_applied
    return _apply_byte_edits(buf, edits), fixes_applied
