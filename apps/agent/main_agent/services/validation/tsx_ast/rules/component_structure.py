"""``component.export.name_match`` — default export name must match the file.

The component save tool is given an ``expected_name`` (derived from the
file path or the plan) and passes it through ``AstContext.expected_export_name``.
This rule walks the default export statement and flags a mismatch. When
the export is not a named function declaration (e.g. ``export default SomeVar``
or an arrow-function form), the rule stays silent because the pattern
is no longer a certain mismatch.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_by_type
from .base import AstContext, Finding


class ComponentExportNameRule:
    """Flag a default export whose function name differs from the expected one."""

    id = "component.export.name_match"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        expected = ctx.expected_export_name
        if not expected:
            return
        buf = ctx.source_buf

        for exp in find_by_type(ctx.tree.root_node, "export_statement"):
            # ``export default function Foo(...) {}`` — the ``default`` is an
            # unnamed keyword child, the declaration is a child field called
            # ``declaration`` in most tree-sitter TS grammars. We fall back
            # to scanning for a ``function_declaration`` child when the
            # field isn't named on the grammar version we ship with.
            if not _has_default_keyword(exp, buf):
                continue

            func = _find_default_function(exp)
            if func is None:
                continue

            name_node = func.child_by_field_name("name")
            if name_node is None:
                continue

            actual = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
            if actual == expected:
                continue

            yield Finding(
                rule_id=self.id,
                severity="error",
                message=(
                    f"Export name mismatch: code exports '{actual}' " f"but expected '{expected}'"
                ),
                line=name_node.start_point[0] + 1,
                col=name_node.start_point[1],
            )


def _has_default_keyword(export_node, buf: bytes) -> bool:
    for child in export_node.children:
        if child.type == "default" or (
            child.is_named is False
            and buf[child.start_byte : child.end_byte].decode("utf-8") == "default"
        ):
            return True
    return False


def _find_default_function(export_node):
    """Return the ``function_declaration`` child of a default-export statement."""
    # Try the ``declaration`` field first (tree-sitter-typescript modern grammar).
    decl = export_node.child_by_field_name("declaration")
    if decl is not None and decl.type == "function_declaration":
        return decl
    # Fall back to a linear scan over children.
    for child in export_node.children:
        if child.type == "function_declaration":
            return child
    return None
