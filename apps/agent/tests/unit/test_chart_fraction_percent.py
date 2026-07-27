"""Tests for ``component.charts.fraction_percent_mismatch`` — warns when
a chart Y-axis appends ``%`` to a 0..1 fraction dataKey.
"""

from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_chart_units import (
    FractionPercentMismatchRule,
)


def _run(tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return [f.message for f in FractionPercentMismatchRule().check(ctx)]


class TestFires:
    def test_yaxis_percent_with_rate_dataKey(self):
        # The StayNexus DashboardContent pattern.
        tsx = """function C() {
  return (
    <Charts.AreaChart>
      <Charts.YAxis tickFormatter={(val) => `${val}%`} />
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        msgs = _run(tsx)
        assert len(msgs) == 1
        assert "rate" in msgs[0]

    def test_yaxis_percent_with_pct_suffix_dataKey(self):
        tsx = """function C() {
  return (
    <Charts.LineChart>
      <Charts.YAxis tickFormatter={(v) => `${v}%`} />
      <Charts.Line dataKey="completion_pct" />
    </Charts.LineChart>
  );
}
"""
        assert len(_run(tsx)) == 1

    def test_yaxis_percent_with_percentage_dataKey(self):
        tsx = """function C() {
  return (
    <Charts.BarChart>
      <Charts.YAxis tickFormatter={(v) => `${v}%`} />
      <Charts.Bar dataKey="percentage" />
    </Charts.BarChart>
  );
}
"""
        assert len(_run(tsx)) == 1


class TestDoesNotFire:
    def test_correct_multiply_by_hundred(self):
        # Caller already multiplies by 100 — they understood the unit.
        tsx = """function C() {
  return (
    <Charts.AreaChart>
      <Charts.YAxis tickFormatter={(val) => `${(val * 100).toFixed(0)}%`} />
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        assert _run(tsx) == []

    def test_dataKey_not_fraction_shaped(self):
        # `temperature` isn't a fraction; raw `${val}%` is fine (or
        # silly, but not this rule's problem).
        tsx = """function C() {
  return (
    <Charts.LineChart>
      <Charts.YAxis tickFormatter={(v) => `${v}%`} />
      <Charts.Line dataKey="temperature" />
    </Charts.LineChart>
  );
}
"""
        assert _run(tsx) == []

    def test_no_yaxis_no_warn(self):
        tsx = """function C() {
  return (
    <Charts.AreaChart>
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        assert _run(tsx) == []

    def test_yaxis_without_tickFormatter_no_warn(self):
        tsx = """function C() {
  return (
    <Charts.AreaChart>
      <Charts.YAxis />
      <Charts.Area dataKey="rate" />
    </Charts.AreaChart>
  );
}
"""
        assert _run(tsx) == []

    def test_yaxis_kg_unit_no_warn(self):
        # Other units like `kg` don't trip the rule.
        tsx = """function C() {
  return (
    <Charts.BarChart>
      <Charts.YAxis tickFormatter={(v) => `${v}kg`} />
      <Charts.Bar dataKey="rate" />
    </Charts.BarChart>
  );
}
"""
        assert _run(tsx) == []
