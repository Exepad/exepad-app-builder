"""``component.useModel.enum_case_mismatch`` — flag filter literals that
near-match a column's declared ``enum_values`` (case or punctuation).

Catches the StayNexus failure mode:

    useModel("housekeeping_tasks", { filters: { task_type: "full_clean" } })

against ``enum_values=["Full Clean", "Deep Clean", ...]`` — the filter
silently returns zero rows because SQLite string equality is byte-exact.
The auto-fixer rewrites the literal to the declared form.

A literal is a "near-match" when normalising both sides (lowercase and
strip non-alphanumeric characters) produces the same string. So
``"full_clean"``, ``"Full Clean"``, and ``"full clean"`` all normalise
to ``"fullclean"`` and resolve to the declared form. Wholly unrelated
literals (``"polishing"`` against ``["Full Clean", "Deep Clean"]``)
don't trip — they're out of scope for this rule.

Scoped to ``useModel(NAME, OPTS)`` calls. Walks ``filters: {...}``
properties; other prop names aren't covered (not on the SDK surface).
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import find_calls, string_literal_value
from .base import AstContext, Finding


def _normalise(value: str) -> str:
    """Lowercase + strip non-alphanumeric. Empty if nothing alphanumeric remains."""
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _resolve_useModel_filter_target(call_node, buf: bytes):
    """Return ``(model_name, filters_object_node)`` for a ``useModel(NAME, OPTS)``
    call where OPTS contains a ``filters: {...}`` property. ``None`` if the
    call doesn't match the shape.

    Shared by ``FilterEnumCaseMismatchRule`` and the matching fixer so the
    call-shape check stays in one place.
    """
    callee = call_node.child_by_field_name("function")
    if callee is None or callee.type != "identifier":
        return None
    if _text(callee, buf) != "useModel":
        return None
    args = call_node.child_by_field_name("arguments")
    if args is None or args.named_child_count < 2:
        return None
    model_arg = args.named_children[0]
    options_arg = args.named_children[1]
    if model_arg.type != "string":
        return None
    model_name = string_literal_value(model_arg, buf)
    if not model_name:
        return None
    if options_arg.type != "object":
        return None
    filters_obj = _find_property_object(options_arg, "filters", buf)
    if filters_obj is None:
        return None
    return model_name, filters_obj


def _resolve_filter_pair_rewrite(pair_node, model_name: str, enum_lookup, buf: bytes):
    """Return ``(value_node, literal, declared)`` if this filter pair is a
    near-match rewrite target. ``None`` if no rewrite applies (column
    isn't in the enum lookup, literal is already byte-correct, or no
    unique near-match exists)."""
    col = _pair_key_name(pair_node, buf)
    if not col:
        return None
    values = enum_lookup.get((model_name.lower(), col.lower()))
    if not values:
        return None
    value_node = pair_node.child_by_field_name("value")
    if value_node is None or value_node.type != "string":
        return None
    literal = string_literal_value(value_node, buf)
    if literal is None or literal in values:
        return None
    norm = _normalise(literal)
    if not norm:
        return None
    near = [v for v in values if _normalise(v) == norm]
    if len(near) != 1:
        return None
    return value_node, literal, near[0], col


def _collect_enum_columns(models) -> list[tuple[str, str, list[str]]]:
    """Inline copy of ``semantic_validator._collect_enum_columns`` to avoid
    a circular import (``semantic_validator`` itself imports
    ``default_set`` which imports this module). Accepts both camelCase
    (``enumValues``) and snake_case (``enum_values``)."""
    out: list[tuple[str, str, list[str]]] = []
    for model in models or []:
        if not isinstance(model, dict):
            continue
        model_name = model.get("name") or ""
        if not model_name:
            continue
        for col in model.get("columns", []) or []:
            if not isinstance(col, dict):
                continue
            col_name = col.get("name")
            if not col_name:
                continue
            raw = col.get("enum_values") or col.get("enumValues")
            if not isinstance(raw, list) or not raw:
                continue
            values = [str(v) for v in raw if v is not None]
            if values:
                out.append((model_name, col_name, values))
    return out


class FilterEnumCaseMismatchRule:
    id = "component.useModel.enum_case_mismatch"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not ctx.models:
            return
        enum_lookup = {
            (model.lower(), col.lower()): values
            for model, col, values in _collect_enum_columns(ctx.models)
        }
        if not enum_lookup:
            return

        for call in find_calls(ctx.tree.root_node):
            target = _resolve_useModel_filter_target(call, ctx.source_buf)
            if target is None:
                continue
            model_name, filters_obj = target
            for pair in _iter_object_pairs(filters_obj):
                rewrite = _resolve_filter_pair_rewrite(
                    pair, model_name, enum_lookup, ctx.source_buf
                )
                if rewrite is None:
                    continue
                value_node, literal, declared, col = rewrite
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    message=(
                        f'useModel("{model_name}") filter '
                        f'`{col}: "{literal}"` does not byte-match the column\'s '
                        f'declared enum_values. Expected `"{declared}"`. '
                        f"SQLite filter comparisons are byte-exact, so this "
                        f"query returns zero rows."
                    ),
                    line=value_node.start_point[0] + 1,
                    col=value_node.start_point[1],
                    fix_hint=f'rewrite to "{declared}"',
                )


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")


def _find_property_object(obj_node, name: str, buf: bytes):
    """Return the value node of a ``name: {...}`` pair within an object literal."""
    for pair in _iter_object_pairs(obj_node):
        key_name = _pair_key_name(pair, buf)
        if key_name == name:
            value = pair.child_by_field_name("value")
            if value is not None and value.type == "object":
                return value
    return None


def _iter_object_pairs(obj_node):
    """Yield every ``pair`` child of an object literal (skip spreads, methods)."""
    if obj_node.type != "object":
        return
    for child in obj_node.named_children:
        if child.type == "pair":
            yield child


def _pair_key_name(pair_node, buf: bytes) -> str | None:
    """Return the key name of a ``pair`` node — works for identifier and string keys."""
    key = pair_node.child_by_field_name("key")
    if key is None:
        return None
    if key.type == "property_identifier":
        return _text(key, buf)
    if key.type == "string":
        return string_literal_value(key, buf)
    return None
