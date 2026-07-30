"""Tests for ``handler.sql.dynamic_query`` — non-literal ``.prepare()`` arg gate.

The rule fires whenever ``.prepare()`` is called with anything OTHER than
a static string or static template literal. Static strings are the
undeclared-table rule's territory; interpolated templates belong to
``handler.sql.param_injection``. Anything else (identifier reference,
binary concat, function call) lands here.

Severity is ``warning`` — non-blocking advisory feedback.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.sql_dynamic_query import (
    SqlDynamicQueryRule,
)

pytestmark = [pytest.mark.unit]


def _run(tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=[])
    return [f.message for f in run_rules(ctx, [SqlDynamicQueryRule()]) if f.severity == "warning"]


def _wrap(prepare_arg: str) -> str:
    return (
        'import { HandlerContext } from "@exepad/sdk";\n'
        "export default async function h(ctx: HandlerContext) {\n"
        f"  return ctx.db.prepare({prepare_arg}).all();\n"
        "}\n"
    )


class TestDynamicArgsFlagged:
    def test_identifier_reference_flagged(self):
        # SQL stashed in a variable and passed to .prepare() — can't validate.
        tsx = (
            'import { HandlerContext } from "@exepad/sdk";\n'
            "export default async function h(ctx: HandlerContext) {\n"
            '  const sql = "SELECT * FROM users";\n'
            "  return ctx.db.prepare(sql).all();\n"
            "}\n"
        )
        warnings = _run(tsx)
        assert len(warnings) == 1
        assert "non-literal argument" in warnings[0]

    def test_string_concatenation_flagged(self):
        tsx = _wrap('"SELECT * FROM " + tableName')
        warnings = _run(tsx)
        assert len(warnings) == 1
        assert "non-literal argument" in warnings[0]

    def test_function_call_argument_flagged(self):
        tsx = _wrap("buildSql(filters)")
        warnings = _run(tsx)
        assert len(warnings) == 1
        assert "non-literal argument" in warnings[0]


class TestSafeArgsNotFlagged:
    def test_static_string_not_flagged(self):
        tsx = _wrap('"SELECT * FROM users"')
        assert _run(tsx) == []

    def test_static_template_string_not_flagged(self):
        tsx = _wrap("`SELECT * FROM users`")
        assert _run(tsx) == []

    def test_interpolated_template_owned_by_param_injection_rule(self):
        # When this rule meets an interpolated template, it bows out — the
        # ``handler.sql.param_injection`` rule covers that case.
        tsx = _wrap("`SELECT * FROM users WHERE id = ${id}`")
        assert _run(tsx) == []
