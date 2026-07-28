"""SDK ``format`` member-access rule.

The SDK re-exports ``format`` from ``date-fns``
(``packages/exepad-sdk/src/utilities.ts:1``) — it is a callable function,
``format(date, pattern)``, **not** an object with methods. The LLM
regularly hallucinates currency-style member access like
``format.currency(stats.totalRevenue)`` (observed three times in one
generated app), which crashes the component at first render with
``TypeError: format.currency is not a function``.

The agent's tsc gate at ``agent_sdk_gate.d.ts`` types every SDK export
as ``any``, so this can't be caught by the type checker. This AST rule
flags any ``format.X`` member access in component TSX, with ``X``
restricted to standard ``Function`` introspection methods that wouldn't
crash if called — the rest are hallucinations.

The companion fixer ``component_sdk_format_method`` auto-rewrites the
single most common hallucination (``format.currency(N)``) to
``new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(N)``.
Under normal save flow, this rule only fires for hallucinated method
names the fixer doesn't recognise (``.number``, ``.percent``, ``.date``,
etc.).

Severity is ``error`` — the failure mode is a guaranteed render crash,
not a degradation.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_member_expressions
from .base import AstContext, Finding


# Standard ``Function.prototype`` properties that are safe to access on
# a callable like ``format``. Any property OUTSIDE this set on
# ``format.X`` is a hallucination.
_FUNCTION_PROTO_PROPS: frozenset[str] = frozenset(
    {"bind", "call", "apply", "length", "name", "toString", "prototype"}
)


class SdkFormatMethodRule:
    """Flag invalid ``format.X`` member access.

    ``format`` is ``date-fns.format`` — a function, not a namespace. The
    correct usage is ``format(new Date(), "yyyy-MM-dd")``. Member access
    like ``format.currency`` is a hallucination and crashes at runtime.
    """

    id = "component.sdk.format_method_invalid"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf
        for member in find_member_expressions(ctx.tree.root_node):
            obj = member.child_by_field_name("object")
            prop = member.child_by_field_name("property")
            if (
                obj is None
                or prop is None
                or obj.type != "identifier"
                or prop.type != "property_identifier"
            ):
                continue
            if buf[obj.start_byte : obj.end_byte].decode("utf-8") != "format":
                continue
            name = buf[prop.start_byte : prop.end_byte].decode("utf-8")
            if not name or name in _FUNCTION_PROTO_PROPS:
                continue
            yield Finding(
                rule_id=self.id,
                severity="error",
                message=(
                    f"Invalid SDK API: `format.{name}` does not exist. "
                    f"`format` is `date-fns.format` (a function) — call it as "
                    f"`format(date, pattern)`. For currency use "
                    f'`new Intl.NumberFormat("en-US", {{ style: "currency", currency: "USD" }}).format(value)`.'
                ),
                line=prop.start_point[0] + 1,
                col=prop.start_point[1],
            )
