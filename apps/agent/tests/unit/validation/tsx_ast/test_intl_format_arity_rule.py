"""Tests for ``IntlNumberFormatExtraArgRule``.

``new Intl.NumberFormat(...).format(x)`` takes exactly one argument
per ECMA-402. The LLM commonly passes a per-row currency as a phantom
second argument; the formatter silently drops it and the output
renders in the constructor's currency.

Regression: app ``r3hfcgx5`` (2026-05-14) DashboardContent rendered
order totals as
``new Intl.NumberFormat("en-US", { style:"currency", currency:"USD" })
  .format(order.total, order.currency)``.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_intl_format_arity import (
    IntlNumberFormatExtraArgRule,
)


def _run(tsx: str) -> list:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return list(run_rules(ctx, [IntlNumberFormatExtraArgRule()]))


class TestIntlNumberFormatExtraArgRule:
    def test_r3hfcgx5_two_args_flagged(self):
        tsx = """
function Row({ order }) {
  return <td>{new Intl.NumberFormat("en-US",
    { style: "currency", currency: "USD" }).format(order.total, order.currency)}</td>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1
        assert findings[0].severity == "warning"
        assert "one argument" in findings[0].message

    def test_three_args_flagged(self):
        tsx = """
function X({ amount, locale, opts }) {
  return new Intl.NumberFormat(locale).format(amount, opts, "extra");
}
"""
        findings = _run(tsx)
        assert len(findings) == 1
        assert "3" in findings[0].message

    def test_single_arg_silent(self):
        tsx = """
function X({ total }) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(total);
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_no_format_call_silent(self):
        tsx = """
function X() {
  const fmt = new Intl.NumberFormat("en-US");
  return fmt;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_nested_call_args_not_miscounted(self):
        """A single comma inside a nested function call is NOT a top-level arg."""
        tsx = """
function X({ value }) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 })
    .format(Math.max(value, 0));
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_options_object_with_internal_commas_silent(self):
        """Constructor's options bag has many commas — must not confuse the parser."""
        tsx = """
function X({ amount }) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
"""
        findings = _run(tsx)
        assert findings == []
