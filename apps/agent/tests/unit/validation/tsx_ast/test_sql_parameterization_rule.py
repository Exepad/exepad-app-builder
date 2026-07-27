"""Tests for ``handler.sql.param_injection`` — SQL injection gate.

The rule fires when ``.prepare()`` is called with a template literal
containing at least one ``${...}`` substitution. Static strings, static
backtick literals (no substitutions), and parameterized queries with
``?`` placeholders all pass. The complementary rule
``handler.sql.dynamic_query`` covers identifier / concat-built SQL.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.sql_parameterization import (
    SqlParamInjectionRule,
)

pytestmark = [pytest.mark.unit]


def _run(tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=[])
    return [f.message for f in run_rules(ctx, [SqlParamInjectionRule()]) if f.severity == "error"]


def _wrap(prepare_arg: str) -> str:
    return (
        'import { HandlerContext } from "@exepad/sdk";\n'
        "export default async function h(ctx: HandlerContext) {\n"
        f"  return ctx.db.prepare({prepare_arg}).all();\n"
        "}\n"
    )


class TestInterpolationFlagged:
    def test_single_interpolation_flagged(self):
        tsx = _wrap("`SELECT * FROM users WHERE id = ${id}`")
        errors = _run(tsx)
        assert len(errors) == 1
        assert "template literal interpolation" in errors[0]
        assert "${id}" in errors[0]

    def test_multiple_interpolations_listed(self):
        tsx = _wrap("`UPDATE x SET a = ${a} WHERE b = ${b}`")
        errors = _run(tsx)
        assert len(errors) == 1
        assert "${a, b}" in errors[0]

    def test_interpolation_caps_at_three_variables(self):
        tsx = _wrap("`SELECT ${a}, ${b}, ${c}, ${d} FROM x`")
        errors = _run(tsx)
        assert len(errors) == 1
        # Exactly three variables listed — the rule trims the rest to keep
        # the error message short.
        assert "${a, b, c}" in errors[0]
        assert "${a, b, c, d}" not in errors[0]

    def test_dynamic_column_name_flagged(self):
        tsx = _wrap("`SELECT ${col} FROM users WHERE id = ?`")
        errors = _run(tsx)
        assert len(errors) == 1


class TestSafePatterns:
    def test_parameterized_query_not_flagged(self):
        tsx = (
            'import { HandlerContext } from "@exepad/sdk";\n'
            "export default async function h(ctx: HandlerContext) {\n"
            '  return ctx.db.prepare("SELECT * FROM users WHERE id = ?").bind(id).all();\n'
            "}\n"
        )
        assert _run(tsx) == []

    def test_static_template_string_not_flagged(self):
        # Backticks but NO ``${...}`` — same shape as a regular string.
        tsx = _wrap("`SELECT * FROM users`")
        assert _run(tsx) == []

    def test_plain_string_literal_not_flagged(self):
        tsx = _wrap('"SELECT * FROM users"')
        assert _run(tsx) == []

    def test_template_outside_prepare_not_flagged(self):
        # The rule is scoped to ``.prepare()`` calls — backticks elsewhere
        # in the handler body are not its concern.
        tsx = (
            'import { HandlerContext } from "@exepad/sdk";\n'
            "export default async function h(ctx: HandlerContext) {\n"
            "  const label = `User ${id}`;\n"
            '  return ctx.db.prepare("SELECT 1").all();\n'
            "}\n"
        )
        assert _run(tsx) == []
