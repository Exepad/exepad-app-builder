"""Tests for ``component.codegen.hardcoded_kpi_literal`` — warns when a
``<Card>`` subtree renders hardcoded KPI numbers instead of pulling
from ``useHandler`` / ``useModel``.
"""

from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_hardcoded_data import (
    HardcodedKpiLiteralRule,
)


def _run(tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return [f.message for f in HardcodedKpiLiteralRule().check(ctx)]


class TestFires:
    def test_dollar_amount_in_card(self):
        # The StayNexus BillingContent pattern: hardcoded "Outstanding $12,450".
        tsx = """function C() {
  return (
    <Card>
      <CardContent>
        <p>Outstanding</p>
        <p>$12,450</p>
      </CardContent>
    </Card>
  );
}
"""
        msgs = _run(tsx)
        assert any("$12,450" in m for m in msgs)

    def test_percent_in_card(self):
        # Collection Rate 94.2% — also from StayNexus BillingContent.
        tsx = """function C() {
  return (
    <Card>
      <CardContent>
        <p>Collection Rate</p>
        <p>94.2%</p>
      </CardContent>
    </Card>
  );
}
"""
        msgs = _run(tsx)
        assert any("94.2%" in m for m in msgs)

    def test_plain_count_in_card(self):
        tsx = """function C() {
  return (
    <Card>
      <span>Total Visitors</span>
      <h2>1,234</h2>
    </Card>
  );
}
"""
        assert len(_run(tsx)) == 1


class TestDoesNotFire:
    def test_card_with_any_expression_dampens(self):
        # Sibling `{stats?.outstanding}` exists — trust the LLM; skip the card.
        tsx = """function C() {
  return (
    <Card>
      <CardContent>
        <p>Outstanding</p>
        <p>$12,450</p>
        <p>{stats?.note}</p>
      </CardContent>
    </Card>
  );
}
"""
        assert _run(tsx) == []

    def test_small_number_not_kpi_shaped(self):
        # `5` is too short to be a hardcoded KPI candidate.
        tsx = """function C() {
  return (
    <Card>
      <p>Items</p>
      <p>5</p>
    </Card>
  );
}
"""
        assert _run(tsx) == []

    def test_no_card_ancestor(self):
        # Hardcoded number in a non-card surface — out of scope.
        tsx = """function C() {
  return (<div><p>$12,450</p></div>);
}
"""
        assert _run(tsx) == []

    def test_card_with_hook_data(self):
        tsx = """function C() {
  return (
    <Card>
      <CardContent>
        <p>Outstanding</p>
        <p>${stats?.outstanding?.toLocaleString() ?? '0'}</p>
      </CardContent>
    </Card>
  );
}
"""
        assert _run(tsx) == []
