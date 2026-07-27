"""Tests for ``HandlerOutputUnknownFieldRule`` — warning-severity check
that catches member access on a ``useHandler('X').data`` binding when
the producer handler doesn't emit that field.

Regression for app ``n1aloggh``: ``ReportsContent`` read
``opt.totalTco`` against ``getProjectComparison``'s output, which only
emitted ``{label, categories, oneTime, annualRecurring}``. Every option
card rendered ``$NaN``. The chart-dataKey rule missed it because the
read site wasn't a chart ``dataKey=`` literal.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_handler_output_unknown_field import (
    HandlerOutputUnknownFieldRule,
)

pytestmark = [pytest.mark.unit]


def _ctx(tsx: str, handler_sources: dict[str, str]) -> AstContext:
    return AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=parse_tsx(tsx),
        handler_sources=handler_sources,
    )


class TestHandlerOutputUnknownFieldRule:
    def test_flags_unknown_field_via_member_access(self):
        component = """
import { useHandler } from '@exepad/sdk';
function StatsCard() {
  const stats = useHandler('getDashboardStats');
  return <div>{stats.data.totalSavings}</div>;
}
"""
        handler = """
async function handler(ctx) {
  return {
    totalProjects: 0,
    pendingEvaluations: 0,
    avgSavings: 0,
    chartData: [],
  };
}
"""
        findings = list(HandlerOutputUnknownFieldRule().check(
            _ctx(component, {"getDashboardStats": handler})
        ))
        # The rule sees `stats.data.totalSavings` (member access on a
        # useHandler binding). `totalSavings` is NOT in the emitted-keys
        # set → warning.
        flagged_fields = {f.message for f in findings}
        assert any("totalSavings" in m for m in flagged_fields), (
            f"expected a finding for 'totalSavings'; got: {flagged_fields}"
        )

    def test_does_not_flag_existing_field(self):
        component = """
import { useHandler } from '@exepad/sdk';
function StatsCard() {
  const { data: stats } = useHandler('getDashboardStats');
  return <div>{stats?.totalProjects}</div>;
}
"""
        handler = """
async function handler(ctx) {
  return { totalProjects: 0, pendingEvaluations: 0, avgSavings: 0, chartData: [] };
}
"""
        findings = list(HandlerOutputUnknownFieldRule().check(
            _ctx(component, {"getDashboardStats": handler})
        ))
        # ``totalProjects`` IS emitted; no warning.
        for f in findings:
            assert "totalProjects" not in f.message

    def test_fails_open_without_handler_sources(self):
        component = """
import { useHandler } from '@exepad/sdk';
function X() {
  const { data: s } = useHandler('getStats');
  return <div>{s?.bogus}</div>;
}
"""
        findings = list(HandlerOutputUnknownFieldRule().check(_ctx(component, {})))
        assert findings == []

    def test_ignores_hook_api_members(self):
        component = """
import { useHandler } from '@exepad/sdk';
function X() {
  const result = useHandler('getStats');
  if (result.loading) return null;
  if (result.error) return null;
  return <div>{result.data}</div>;
}
"""
        handler = "async function handler(ctx) { return { count: 0 }; }"
        findings = list(HandlerOutputUnknownFieldRule().check(
            _ctx(component, {"getStats": handler})
        ))
        # ``loading``, ``error``, ``data`` are hook surface, not producer fields.
        for f in findings:
            assert "loading" not in f.message
            assert "error" not in f.message
            assert "data" not in f.message

    def test_severity_is_warning(self):
        assert HandlerOutputUnknownFieldRule().severity == "warning"
