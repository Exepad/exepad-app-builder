"""``handler.sql.dynamic_query`` — advisory: warn on non-literal ``.prepare()`` args.

When the argument to ``.prepare()`` is anything other than a static
string / static template string, we can't validate the SQL — we can't
know the tables, columns, or parameter shape. The handler might still
be correct (a library wrapper or a carefully built query), but most of
the time this pattern signals string-built SQL which is either (a)
unsafe, or (b) an injection risk that the param-injection rule didn't
catch because the interpolation happens outside the ``.prepare()``
argument.

Ships at ``warning`` severity — warnings do not trigger a handler
builder retry, they land on the successful response as advisory
feedback. Promote to ``error`` if usage patterns show the false-positive
rate is low enough.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_calls, has_template_substitution
from .base import AstContext, Finding


class SqlDynamicQueryRule:
    """Warn on any ``.prepare(<non-literal>)`` call."""

    id = "handler.sql.dynamic_query"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf

        for call in find_calls(root):
            callee = call.child_by_field_name("function")
            if callee is None or callee.type != "member_expression":
                continue
            prop = callee.child_by_field_name("property")
            if prop is None or _text(prop, buf) != "prepare":
                continue

            args = call.child_by_field_name("arguments")
            if args is None or args.named_child_count == 0:
                continue
            arg0 = args.named_children[0]

            # Literal string — validated by the undeclared-table rule.
            if arg0.type == "string":
                continue
            # Static template string (no interpolation) — also a literal.
            if arg0.type == "template_string" and not has_template_substitution(arg0):
                continue
            # Interpolated template — owned by ``handler.sql.param_injection``.
            if arg0.type == "template_string" and has_template_substitution(arg0):
                continue

            # Anything else — identifier, call expression, binary concat, etc.
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=(
                    "ctx.db.prepare() was called with a non-literal argument — "
                    "the query string cannot be statically validated. If this "
                    "is intentional (e.g. a parameterised wrapper), document "
                    "it; otherwise inline the SQL as a string literal with "
                    "? placeholders and .bind()."
                ),
                line=arg0.start_point[0] + 1,
                col=arg0.start_point[1],
            )


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")
