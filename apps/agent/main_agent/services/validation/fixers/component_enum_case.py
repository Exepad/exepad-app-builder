"""Auto-fix for ``component.useModel.enum_case_mismatch``.

Walks ``useModel(NAME, OPTS)`` calls. For each
``filters: { col: "literal" }`` pair, if the column declares
``enum_values`` and the literal normalises (lowercase + strip
non-alphanumeric) to exactly one declared value while differing in
bytes, the literal is rewritten in-place to the declared form. This
covers case-only drift (``"Paid"`` vs ``"paid"``) and the more common
case + punctuation drift (``"full_clean"`` vs ``"Full Clean"``).

Same matching semantics as ``FilterEnumCaseMismatchRule`` — both reuse
``_normalise`` from the rule module so changes stay in lockstep.

Mutations are queued by byte range and applied right-to-left so
multiple edits in one file don't shift each other's offsets.
"""

from __future__ import annotations

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_filter_enum_case import (
    _collect_enum_columns,
    _iter_object_pairs,
    _resolve_filter_pair_rewrite,
    _resolve_useModel_filter_target,
)
from main_agent.services.validation.tsx_ast.walker import find_calls


def _apply_byte_edits(buf: bytes, edits: list[tuple[int, int, str]]) -> str:
    """Apply ``(start, end, replacement)`` byte edits right-to-left so
    earlier edits don't shift later edits' offsets. Replacement is
    encoded as UTF-8 before splicing."""
    edits.sort(key=lambda e: e[0], reverse=True)
    out = buf
    for start, end, repl in edits:
        out = out[:start] + repl.encode("utf-8") + out[end:]
    return out.decode("utf-8")


def apply_component_enum_case_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    if not ctx.models:
        return tsx
    enum_lookup = {
        (model.lower(), col.lower()): values
        for model, col, values in _collect_enum_columns(ctx.models)
    }
    if not enum_lookup:
        return tsx

    tree = parse_tsx(tsx)
    if tree is None:
        return tsx
    buf = source_bytes(tsx)

    edits: list[tuple[int, int, str]] = []
    for call in find_calls(tree.root_node):
        target = _resolve_useModel_filter_target(call, buf)
        if target is None:
            continue
        model_name, filters_obj = target
        for pair in _iter_object_pairs(filters_obj):
            rewrite = _resolve_filter_pair_rewrite(pair, model_name, enum_lookup, buf)
            if rewrite is None:
                continue
            value_node, literal, declared, col = rewrite
            # Replace the entire string node (quotes and all). Tree-sitter
            # spans cover the full quoted form so this is a clean swap.
            edits.append((value_node.start_byte, value_node.end_byte, f'"{declared}"'))
            fixes_applied.append(
                f'Rewrote useModel("{model_name}") filter '
                f'`{col}: "{literal}"` → `"{declared}"` (enum case match)'
            )

    if not edits:
        return tsx
    return _apply_byte_edits(buf, edits)
