"""``handler.sql.param_injection`` — reject string-interpolated prepared SQL.

Flags any ``.prepare(`...${x}...`)`` call whose argument is a template
string containing at least one substitution expression. The recommended
fix is a parameterized query with ``?`` placeholders and ``.bind(...)``.

Only the first argument to ``.prepare()`` is inspected; other backtick
literals in the handler body are ignored.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_calls, has_template_substitution
from .base import AstContext, Finding


class SqlParamInjectionRule:
    """Detect template-literal interpolation inside ``.prepare()`` calls."""

    id = "handler.sql.param_injection"
    severity = "error"

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
            if arg0.type != "template_string":
                continue
            if not has_template_substitution(arg0):
                continue

            # Pull up to the first three substitution expressions for the
            # error message — keeps the finding short while still naming
            # enough of the offending variables for the LLM to recognise.
            subs: list[str] = []
            for child in arg0.children:
                if child.type != "template_substitution":
                    continue
                # A template_substitution wraps the expression nodes between
                # ``${`` and ``}`` — the named children are the expressions.
                for inner in child.named_children:
                    subs.append(_text(inner, buf))
                    break
                if len(subs) >= 3:
                    break
            vars_str = ", ".join(subs[:3])

            yield Finding(
                rule_id=self.id,
                severity="error",
                message=(
                    "SQL injection risk: template literal interpolation in "
                    ".prepare() — use parameterized queries with ? "
                    f"placeholders and .bind(). Found: ${{{vars_str}}}"
                ),
                line=arg0.start_point[0] + 1,
                col=arg0.start_point[1],
            )


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")
