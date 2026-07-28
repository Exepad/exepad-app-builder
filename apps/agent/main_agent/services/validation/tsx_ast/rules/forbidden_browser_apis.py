"""``handler.forbidden.browser_api`` — reject browser-only globals.

Cloudflare Workers do not expose browser globals: ``document``, ``window``,
``alert``, ``confirm``, ``prompt``, ``setTimeout``, ``setInterval`` are
runtime-undefined. The rule walks real ``identifier`` and
``member_expression`` nodes so string-literal mentions of the same names
never trip a false positive.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_by_type, find_calls
from .base import AstContext, Finding

_BROWSER_OBJECT_ERRORS: dict[str, str] = {
    "document": (
        "document.* is unavailable in Workers runtime — "
        "handlers run on Cloudflare Workers, not in a browser"
    ),
    "window": (
        "window.* is unavailable in Workers runtime — "
        "handlers run on Cloudflare Workers, not in a browser"
    ),
}

_BROWSER_DIALOG_CALLS: frozenset[str] = frozenset({"alert", "confirm", "prompt"})

_BROWSER_TIMER_CALLS: frozenset[str] = frozenset({"setTimeout", "setInterval"})


class ForbiddenBrowserApiRule:
    """Flag browser-only identifiers that don't exist in the Workers runtime."""

    id = "handler.forbidden.browser_api"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf
        seen: set[str] = set()

        # 1. document.* / window.* as member_expression roots. We match
        # only when followed by a property access — ``document`` / ``window``
        # alone never appears as a legitimate identifier reference in
        # Worker handler code.
        for member in find_by_type(root, "member_expression"):
            obj = member.child_by_field_name("object")
            if obj is None or obj.type != "identifier":
                continue
            obj_name = _text(obj, buf)
            if obj_name in _BROWSER_OBJECT_ERRORS:
                key = f"object:{obj_name}"
                if key in seen:
                    continue
                seen.add(key)
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=_BROWSER_OBJECT_ERRORS[obj_name],
                    line=member.start_point[0] + 1,
                    col=member.start_point[1],
                )

        # 2. alert() / confirm() / prompt() and setTimeout/setInterval as
        # direct call expressions — no object, just a callee identifier.
        for call in find_calls(root):
            callee = call.child_by_field_name("function")
            if callee is None or callee.type != "identifier":
                continue
            name = _text(callee, buf)

            if name in _BROWSER_DIALOG_CALLS and "dialog" not in seen:
                seen.add("dialog")
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message="alert/confirm/prompt are browser-only APIs — unavailable in Workers",
                    line=call.start_point[0] + 1,
                    col=call.start_point[1],
                )
            elif name in _BROWSER_TIMER_CALLS and "timer" not in seen:
                seen.add("timer")
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=(
                        "setTimeout/setInterval are discouraged in Workers — "
                        "handlers should complete synchronously within the "
                        "request lifecycle"
                    ),
                    line=call.start_point[0] + 1,
                    col=call.start_point[1],
                )


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")
