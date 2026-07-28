"""``handler.export.missing_default`` + ``handler.signature.missing_ctx``.

These two rules share a walk: both need to locate the handler's
``export default`` declaration and inspect its argument list. Packaging
them together keeps the tree walk cheap — one pass yields both findings.

- ``missing_default`` is an error: no export-default means nothing to call.
- ``missing_ctx`` is a warning: the handler runs, but without the ``ctx``
  parameter it can't access the DB, user info, or platform services.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_by_type
from .base import AstContext, Finding


class HandlerExportRule:
    """Require ``export default`` in the handler TSX."""

    id = "handler.export.missing_default"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node

        # tree-sitter-typescript exposes top-level ``export_statement`` nodes
        # for both ``export default ...`` and regular ``export { ... }``.
        # Walk only the program-level children; ``export default`` nested
        # inside a function body would not satisfy the handler contract.
        for child in root.children:
            if child.type != "export_statement":
                continue
            # The ``default`` keyword appears as an unnamed ``default`` child
            # on ``export default <expr|decl>``. Named children hold the
            # exported expression.
            if any(c.type == "default" for c in child.children):
                return
            # ``export default function …`` is parsed as
            # export_statement > function_declaration with a leading
            # ``default`` keyword too, so the check above already covers it.
        yield Finding(
            rule_id=self.id,
            severity="error",
            message=(
                "Missing 'export default' — handler must use "
                "'export default function handler(ctx)' or "
                "'export default handler'"
            ),
            line=1,
            col=0,
        )


class HandlerSignatureRule:
    """Warn when the exported function doesn't take a ``ctx`` parameter.

    Only walks top-level ``export default async? function …`` declarations
    — bare ``export default someLocal`` (where the function is defined
    elsewhere) is skipped because inspecting the parameter list would
    require symbol resolution we don't do.
    """

    id = "handler.signature.missing_ctx"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf

        for export in find_by_type(root, "export_statement"):
            if not any(c.type == "default" for c in export.children):
                continue
            # Inline declaration path: export default [async] function name(...) { ... }
            func = _find_function_declaration(export)
            if func is None:
                continue

            params = func.child_by_field_name("parameters")
            if params is None:
                continue

            if params.named_child_count == 0:
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    message=(
                        "Handler function has no parameters — should accept "
                        "(ctx: HandlerContext) for database access, params, "
                        "and user info"
                    ),
                    line=func.start_point[0] + 1,
                    col=func.start_point[1],
                )
                return

            # Permissive substring match: the parameter text before the
            # first ``:``/``,`` must contain the literal string ``"ctx"``.
            # That means ``_ctx`` or ``myCtx`` pass — a ``ctx`` substring
            # is enough. ``context`` fails because ``c-o-n-t-e-x-t`` does
            # not contain the three consecutive chars c-t-x.
            first_param = params.named_children[0]
            first_param_text = _text(first_param, buf)
            first_name_portion = first_param_text.split(":")[0].split(",")[0].strip()
            if "ctx" not in first_name_portion:
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    message=(
                        "Handler parameter name is not 'ctx' — convention "
                        "is 'async function handler(ctx: HandlerContext)'"
                    ),
                    line=func.start_point[0] + 1,
                    col=func.start_point[1],
                )
            return


def _find_function_declaration(export_node) -> "object | None":
    """Return the inline function_declaration inside an ``export default``, or None.

    Handles both ``export default function h(ctx) {}`` (function_declaration
    child) and ``export default async function h(ctx) {}`` (also
    function_declaration). Does not walk into expressions because the
    legacy regex only matched the inline-declaration form.
    """
    for child in export_node.children:
        if child.type == "function_declaration":
            return child
    return None


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")
