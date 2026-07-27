"""Unit tests for the SDK ``format``-method AST rule + companion fixer.

The rule catches hallucinated member access on the SDK's ``format``
export (which is ``date-fns.format`` — a callable, NOT an object).
The fixer auto-rewrites the most common hallucination
(``format.currency(N)``) to the canonical ``Intl.NumberFormat`` API.
"""

from __future__ import annotations

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_sdk_format_method import (
    apply_component_sdk_format_method_fixes,
)
from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_sdk_format_method import (
    SdkFormatMethodRule,
)


def _run_rule(tsx: str):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return list(run_rules(ctx, [SdkFormatMethodRule()]))


def _run_fixer(tsx: str):
    fixes: list[str] = []
    out = apply_component_sdk_format_method_fixes(tsx, FixContext(), fixes)
    return out, fixes


# ---------------------------------------------------------------------------
# Rule: SdkFormatMethodRule
# ---------------------------------------------------------------------------


class TestSdkFormatMethodRule:
    def test_format_currency_flagged(self):
        tsx = "const x = <span>{format.currency(stats.totalRevenue)}</span>"
        findings = _run_rule(tsx)
        assert len(findings) == 1
        f = findings[0]
        assert f.rule_id == "component.sdk.format_method_invalid"
        assert f.severity == "error"
        assert "format.currency" in f.message
        assert "Intl.NumberFormat" in f.message

    def test_format_number_flagged(self):
        tsx = "const x = <span>{format.number(123)}</span>"
        findings = _run_rule(tsx)
        assert len(findings) == 1
        assert "format.number" in findings[0].message

    def test_format_percent_flagged(self):
        tsx = "const x = <span>{format.percent(0.42)}</span>"
        findings = _run_rule(tsx)
        assert len(findings) == 1

    def test_format_date_flagged(self):
        # ``format.date`` is also a hallucination — date-fns is just
        # ``format(date, pattern)``.
        tsx = "const x = <span>{format.date(d)}</span>"
        findings = _run_rule(tsx)
        assert len(findings) == 1

    def test_format_call_expression_not_flagged(self):
        # Legitimate date-fns usage: ``format(date, pattern)``. This is a
        # call expression, NOT a member expression — must not false-positive.
        tsx = (
            "import { format } from '@exepad/sdk';\n"
            "const x = format(new Date(), 'yyyy-MM-dd');\n"
        )
        assert _run_rule(tsx) == []

    def test_format_bind_call_apply_not_flagged(self):
        # Standard Function.prototype methods are exempt — accessing them
        # on a callable like ``format`` is safe and sometimes useful.
        tsx = (
            "const bound = format.bind(null, new Date());\n"
            "const named = format.name;\n"
            "const arity = format.length;\n"
        )
        assert _run_rule(tsx) == []

    def test_unrelated_member_access_not_flagged(self):
        # Only the literal ``format`` identifier is gated — other names
        # are out of scope (those go to ``component.refs.unknown_icon``,
        # ``component.sdk.required_prop_missing``, etc.).
        tsx = "const x = <span>{stats.totalRevenue}</span>"
        assert _run_rule(tsx) == []

    def test_multiple_format_hallucinations_each_flagged(self):
        tsx = (
            "<div>"
            "<span>{format.currency(a)}</span>"
            "<span>{format.number(b)}</span>"
            "</div>"
        )
        findings = _run_rule(tsx)
        assert len(findings) == 2


# ---------------------------------------------------------------------------
# Fixer: apply_component_sdk_format_method_fixes
# ---------------------------------------------------------------------------


class TestSdkFormatMethodFixer:
    def test_format_currency_expression_rewritten(self):
        tsx = "<span>{format.currency(stats.totalRevenue)}</span>"
        out, fixes = _run_fixer(tsx)
        assert "format.currency" not in out
        assert 'new Intl.NumberFormat("en-US"' in out
        assert "stats.totalRevenue" in out
        assert len(fixes) == 1
        assert "format.currency" in fixes[0]

    def test_format_currency_optional_chain_rewritten(self):
        tsx = "<span>{format.currency(stats?.totalRevenue ?? 0)}</span>"
        out, fixes = _run_fixer(tsx)
        assert "format.currency" not in out
        assert "stats?.totalRevenue ?? 0" in out
        assert len(fixes) == 1

    def test_format_currency_string_literal_rewritten(self):
        tsx = '<span>{format.currency(product.price)}</span>'
        out, fixes = _run_fixer(tsx)
        assert "product.price" in out
        assert 'style: "currency"' in out

    def test_multiple_currency_calls_all_rewritten(self):
        tsx = (
            "<div>"
            "<span>{format.currency(a)}</span>"
            "<span>{format.currency(b)}</span>"
            "</div>"
        )
        out, fixes = _run_fixer(tsx)
        assert out.count("Intl.NumberFormat") == 2
        assert "format.currency" not in out
        assert len(fixes) == 2

    def test_format_number_not_rewritten(self):
        # Only ``.currency`` is auto-rewritten (only one with a single
        # safe canonical replacement). ``.number`` stays — the rule
        # then fires loud so the LLM regenerates.
        tsx = "<span>{format.number(123)}</span>"
        out, fixes = _run_fixer(tsx)
        assert out == tsx
        assert fixes == []

    def test_chained_format_not_falsely_rewritten(self):
        # ``foo.format.currency(...)`` — ``format`` here is a property
        # of ``foo``, not the SDK import. Don't false-rewrite.
        tsx = "const x = obj.format.currency(v);"
        out, fixes = _run_fixer(tsx)
        assert out == tsx
        assert fixes == []

    def test_legitimate_format_call_untouched(self):
        tsx = "format(new Date(order.order_date), 'MMM dd, yyyy')"
        out, fixes = _run_fixer(tsx)
        assert out == tsx
        assert fixes == []

    def test_fixer_then_rule_clean(self):
        # End-to-end: fixer corrects, rule should now pass.
        tsx_bad = "<span>{format.currency(x)}</span>"
        tsx_fixed, _ = _run_fixer(tsx_bad)
        findings = _run_rule(tsx_fixed)
        assert findings == []
