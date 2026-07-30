"""``handler.sql.undeclared_table`` — reject SQL against undeclared tables.

Walks every ``call_expression`` whose callee is a ``member_expression``
ending in ``.prepare``. For each string-literal argument the rule
parses the SQL via ``tsx_ast.sql.parse_sql`` and checks every referenced
table against the declared model list and the platform table allow /
deny lists. Template-string arguments are also analysed when they have
no substitutions; interpolated templates are left to
``handler.sql.dynamic_query``.

Error messages are self-contained and actionable so the LLM can repair
the handler without needing a second round trip.
"""

from __future__ import annotations

from typing import Iterator

from ..sql import parse_sql
from ..walker import (
    find_calls,
    has_template_substitution,
    string_literal_value,
    template_string_static_value,
)
from .base import AstContext, Finding

from ..catalog import PLATFORM_TABLES_HELPER_ONLY, PLATFORM_TABLES_RAW_ALLOWED


class SqlUndeclaredTableRule:
    """Flag every SQL table reference that isn't declared in ``ctx.models``."""

    id = "handler.sql.undeclared_table"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if ctx.models is None:
            return
        declared = _declared_model_names(ctx.models)

        seen: set[str] = set()  # dedupe by (category, table) error key

        for call in find_calls(ctx.tree.root_node):
            callee = call.child_by_field_name("function")
            if callee is None or callee.type != "member_expression":
                continue
            prop = callee.child_by_field_name("property")
            if prop is None or _text(prop, ctx.source_buf) != "prepare":
                continue
            args = call.child_by_field_name("arguments")
            if args is None or args.named_child_count == 0:
                continue
            arg0 = args.named_children[0]

            sql: str | None
            if arg0.type == "string":
                sql = string_literal_value(arg0, ctx.source_buf)
            elif arg0.type == "template_string":
                if has_template_substitution(arg0):
                    # Interpolated template → handled by the dynamic-query
                    # rule (future). Skip here.
                    continue
                sql = template_string_static_value(arg0, ctx.source_buf)
            else:
                # Non-literal argument (variable, binary expression, etc.) —
                # also outside this rule's scope.
                continue

            if not sql:
                continue

            analysis = parse_sql(sql)
            for ref in analysis.refs:
                name = ref.table
                lower = name.lower()
                # Keep the tree-sitter position on the argument node so the
                # LLM feedback message points at the SQL literal, not the
                # top of the file.
                line = arg0.start_point[0] + 1
                col = arg0.start_point[1]

                # 1. Helper-only platform tables (forbidden via raw SQL).
                if lower in PLATFORM_TABLES_HELPER_ONLY:
                    key = f"helper_only:{lower}"
                    if key not in seen:
                        helper = PLATFORM_TABLES_HELPER_ONLY[lower]
                        yield Finding(
                            rule_id=self.id,
                            severity="error",
                            message=(
                                f"Raw SQL access to platform table '{name}' "
                                f"is forbidden — use '{helper}' instead. See "
                                f"BACKEND_HANDLERS_CONFIG.md for the "
                                f"canonical helper API."
                            ),
                            line=line,
                            col=col,
                        )
                        seen.add(key)
                    continue

                # 2. Other platform-owned tables — allowed via raw SQL.
                if lower in PLATFORM_TABLES_RAW_ALLOWED:
                    continue

                # 3. Any other ``_``-prefixed name is reserved.
                if name.startswith("_"):
                    key = f"reserved:{lower}"
                    if key not in seen:
                        yield Finding(
                            rule_id=self.id,
                            severity="error",
                            message=(
                                f"SQL reference '{name}' uses the reserved "
                                f"'_' prefix — only platform-owned tables "
                                f"may start with '_' and this handler must "
                                f"not access them directly."
                            ),
                            line=line,
                            col=col,
                        )
                        seen.add(key)
                    continue

                # 4. User-declared models must appear in model_plans.
                if lower not in declared:
                    key = f"undeclared:{lower}"
                    if key not in seen:
                        yield Finding(
                            rule_id=self.id,
                            severity="error",
                            message=(
                                f"Handler references table '{name}' which "
                                f"is not declared in model_plans. Either "
                                f"(a) add a '{name}' model to "
                                f"app_backend_plan.models, or (b) use an "
                                f"existing declared model. User settings / "
                                f"preferences / profile must also be a "
                                f"declared model (see "
                                f"BACKEND_HANDLERS_CONFIG.md)."
                            ),
                            line=line,
                            col=col,
                        )
                        seen.add(key)


def _declared_model_names(models) -> set[str]:
    """Normalise a list of model dicts / strings to a lowercase name set.

    Accepts either ``[{name: ...}, ...]`` or ``["foo", "bar"]``; the
    string-list shape matches the tool-state cache format used by
    ``validate_and_save_handler_artifact``.
    """
    out: set[str] = set()
    for m in models or []:
        if isinstance(m, str):
            if m:
                out.add(m.lower())
        elif isinstance(m, dict):
            name = m.get("name") or ""
            if name:
                out.add(name.lower())
    return out


def _text(node, buf: bytes) -> str:
    """Decode a node's byte slice from the encoded source buffer."""
    return buf[node.start_byte : node.end_byte].decode("utf-8")
