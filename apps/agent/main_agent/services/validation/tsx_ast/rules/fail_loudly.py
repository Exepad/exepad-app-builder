"""``handler.plan.fail_loudly`` — catch Hard Rule #5 escalation throws.

When the builder LLM can't reconcile a handler plan with the declared
models, the prompt tells it to ``throw new Error('handler_plan references
undeclared ...')``. That signal must never ship as runtime code — the
handler has to be regenerated against an existing declared model.

Walks ``throw_statement`` → ``new_expression`` with constructor
``Error`` and inspects the first string-ish argument. No risk of
tripping on a comment that happens to contain the same phrase because
only real AST ``throw`` statements are examined.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_by_type, string_literal_value, template_string_static_value
from .base import AstContext, Finding

_ESCALATION_MARKER = "handler_plan references undeclared"


class PlanFailLoudlyRule:
    """Reject handlers that emit the Hard Rule #5 escalation throw."""

    id = "handler.plan.fail_loudly"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf

        for throw in find_by_type(root, "throw_statement"):
            new_expr = None
            for child in throw.named_children:
                if child.type == "new_expression":
                    new_expr = child
                    break
            if new_expr is None:
                continue
            ctor = new_expr.child_by_field_name("constructor")
            if ctor is None or _text(ctor, buf) != "Error":
                continue

            args = new_expr.child_by_field_name("arguments")
            if args is None or args.named_child_count == 0:
                continue
            msg_node = args.named_children[0]

            text: str | None = None
            if msg_node.type == "string":
                text = string_literal_value(msg_node, buf)
            elif msg_node.type == "template_string":
                text = template_string_static_value(msg_node, buf)

            if not text:
                continue
            if _ESCALATION_MARKER not in text.lower():
                continue

            yield Finding(
                rule_id=self.id,
                severity="error",
                message=(
                    "Handler throws 'handler_plan references undeclared ...' "
                    "— this is a Hard Rule #5 escalation that must not ship "
                    "as runtime code. Regenerate the handler using an "
                    "existing declared model."
                ),
                line=throw.start_point[0] + 1,
                col=throw.start_point[1],
            )
            return


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")
