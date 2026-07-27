"""``handler.return.missing_field`` — AST return-object key diff.

Extracts the top-level key names from every ``return <object-literal>``
statement in the handler body and diffs them against the expected
outputs list from ``handler_plan.outputs``. The walker sees real
``object`` / ``pair`` / ``shorthand_property_identifier`` nodes, so
spread elements and nested object literals are handled naturally —
only direct ``pair`` / ``shorthand_property_identifier`` children of
the top-level ``object`` node count as declared keys.

Input contract: ``ctx.handler_plan`` is optional. When set, it may
carry an ``expected_outputs`` list (shape ``[{name, type}, ...]``).
When not set, the rule yields nothing.
"""

from __future__ import annotations

from difflib import get_close_matches
from typing import Iterator

from ..walker import find_by_type, string_literal_value
from .base import AstContext, Finding


class ReturnMissingFieldRule:
    """Diff actual return-object keys against ``handler_plan.outputs``."""

    id = "handler.return.missing_field"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        plan = ctx.handler_plan or {}
        expected_outputs = plan.get("expected_outputs") if isinstance(plan, dict) else None
        if not expected_outputs:
            return

        expected_names = set()
        for out in expected_outputs:
            if isinstance(out, dict):
                name = out.get("name")
                if name:
                    expected_names.add(name)
        if not expected_names:
            return

        actual_keys = _collect_return_object_keys(ctx)
        if not actual_keys:
            # Can't find a return-object literal — skip validation. Bare
            # ``return identifier`` forms would need symbol resolution
            # to validate, which is out of scope.
            return

        # Stable order so truncation at _format_errors is deterministic.
        for expected in sorted(expected_names):
            if expected in actual_keys:
                continue
            matches = get_close_matches(expected, sorted(actual_keys), n=1, cutoff=0.6)
            if matches:
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=(
                        f"Handler return field mismatch: expected "
                        f"'{expected}' but found '{matches[0]}' — use the "
                        f"exact field name from handler_plan.outputs"
                    ),
                    line=1,
                    col=0,
                )
            else:
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=(
                        f"Handler missing return field '{expected}' — "
                        f"handler_plan.outputs declares this field but the "
                        f"return statement does not include it"
                    ),
                    line=1,
                    col=0,
                )


def _collect_return_object_keys(ctx: AstContext) -> set[str]:
    """Return the union of top-level keys from every ``return {...}`` statement."""
    buf = ctx.source_buf
    keys: set[str] = set()

    for ret in find_by_type(ctx.tree.root_node, "return_statement"):
        # ``return_statement`` children: [``return``, <expression>]. We only
        # care about the case where the returned expression is an ``object``
        # literal.
        obj: "object | None" = None
        for child in ret.named_children:
            if child.type == "object":
                obj = child
                break
            # ``return ({ ... })`` wraps the literal in a parenthesized_expression.
            if child.type == "parenthesized_expression":
                for inner in child.named_children:
                    if inner.type == "object":
                        obj = inner
                        break
                if obj is not None:
                    break
        if obj is None:
            continue

        for direct in obj.named_children:
            if direct.type == "pair":
                key_node = direct.child_by_field_name("key")
                if key_node is not None and key_node.type in (
                    "property_identifier",
                    "identifier",
                ):
                    keys.add(_text(key_node, buf))
                elif key_node is not None and key_node.type == "string":
                    val = string_literal_value(key_node, buf)
                    if val:
                        keys.add(val)
            elif direct.type == "shorthand_property_identifier":
                keys.add(_text(direct, buf))
            # spread_element and computed_property_name are intentionally
            # ignored — we can't statically know what they contribute.

    return keys


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")


def check_return_fields_ast(tsx: str, expected_outputs: list[dict]) -> list[str]:
    """Convenience entry point used by the handler save tool.

    Accepts a ``[{name, type}, ...]`` list and returns raw error prose
    strings (without the ``(rule_id at line:col)`` suffix the full rule
    runner appends). Returns an empty list when ``expected_outputs`` is
    empty — same semantics as running the rule with no handler plan.
    """
    from ..parser import parse_tsx, source_bytes
    from .base import AstContext

    if not expected_outputs:
        return []

    tree = parse_tsx(tsx)
    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        models=[],
        handler_plan={"expected_outputs": expected_outputs},
    )
    findings = list(ReturnMissingFieldRule().check(ctx))
    return [f.message for f in findings]
