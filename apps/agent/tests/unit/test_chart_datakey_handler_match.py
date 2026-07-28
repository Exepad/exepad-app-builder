"""Unit tests for ``ChartFieldMismatchRule`` — chart ``dataKey`` /
``nameKey`` must reference a key the producer handler emits.

Bug class motivation: ky3clhzb (2026-05-08). The agent rewrote a
``<Charts.BarChart>`` to a ``<Charts.PieChart>`` per a "make pie chart"
edit and preserved the BarChart's ``dataKey="appointments"`` and
``nameKey="name"`` verbatim — but the handler emits ``vetName`` /
``appointmentCount``. The pie rendered as legend swatches with no slices.

These tests exercise:

1. **Detection on the regression case** — exact ky3clhzb fixture: pie
   chart with mismatched dataKey/nameKey vs the producer's emitted keys.
2. **Pass-through on a clean case** — chart fields exactly match the
   producer's emitted keys.
3. **Multiple producers** — two charts in one component, each consuming
   a different handler. Mismatch on chart A but not chart B.
4. **Aliased destructure** — ``const { data: trend } = useHandler('X')``
   should attribute correctly even with renaming.
5. **Fail-open contract** — missing ``handler_sources``, missing handler,
   handler with no static literals → no findings.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_chart_field_match import (
    ChartFieldMismatchRule,
)


def _ctx(component_tsx: str, handler_sources: dict[str, str] | None) -> AstContext:
    return AstContext(
        tsx=component_tsx,
        source_buf=source_bytes(component_tsx),
        tree=parse_tsx(component_tsx),
        handler_sources=handler_sources,
    )


def _findings(component_tsx: str, handler_sources: dict[str, str] | None) -> list:
    return list(ChartFieldMismatchRule().check(_ctx(component_tsx, handler_sources)))


# ---------------------------------------------------------------------------
# 1. The ky3clhzb regression — pie chart consumes wrong handler fields.
# ---------------------------------------------------------------------------


KY3CLHZB_HANDLER = """
async function handler(ctx) {
  const result = await ctx.db.prepare(`
    SELECT v.name AS vetName, COUNT(a.id) AS appointmentCount
    FROM vets v LEFT JOIN appointments a ON a.vet_id = v.id
    GROUP BY v.id ORDER BY appointmentCount DESC
  `).all();
  return { chartData: result.results };
}
export default handler;
"""

KY3CLHZB_BUGGY_PIE = """
import { React, Charts, useHandler } from "@exepad/sdk";

function DashboardContent() {
  const { data: caseload } = useHandler("getCaseloadChart");
  return (
    <Charts.PieChart>
      <Charts.Pie
        data={caseload?.chartData ?? []}
        dataKey="appointments"
        nameKey="name"
      />
    </Charts.PieChart>
  );
}
"""


def test_ky3clhzb_pie_with_wrong_datakey_and_namekey_flagged():
    findings = _findings(
        KY3CLHZB_BUGGY_PIE,
        handler_sources={"getCaseloadChart": KY3CLHZB_HANDLER},
    )
    # Both dataKey and nameKey are wrong → 2 findings on the same series.
    assert len(findings) == 2
    messages = " ".join(f.formatted_message() for f in findings)
    assert "dataKey=\"appointments\"" in messages
    assert "nameKey=\"name\"" in messages
    assert "getCaseloadChart" in messages
    # Available keys must be surfaced so the agent can fix on retry.
    for f in findings:
        msg = f.formatted_message()
        assert "vetName" in msg
        assert "appointmentCount" in msg
    # Severity is error — empty charts block save.
    assert all(f.severity == "error" for f in findings)


# ---------------------------------------------------------------------------
# 2. Clean case — chart fields match handler exactly.
# ---------------------------------------------------------------------------


CLEAN_PIE = """
import { React, Charts, useHandler } from "@exepad/sdk";

function DashboardContent() {
  const { data: caseload } = useHandler("getCaseloadChart");
  return (
    <Charts.PieChart>
      <Charts.Pie
        data={caseload?.chartData ?? []}
        dataKey="appointmentCount"
        nameKey="vetName"
      />
    </Charts.PieChart>
  );
}
"""


def test_clean_pie_chart_no_findings():
    findings = _findings(CLEAN_PIE, handler_sources={"getCaseloadChart": KY3CLHZB_HANDLER})
    assert findings == []


# ---------------------------------------------------------------------------
# 3. Multiple producers — each chart has its own handler.
# ---------------------------------------------------------------------------


HANDLER_TREND = """
async function handler(ctx) {
  const out = [];
  for (let i = 0; i < 7; i++) {
    out.push({ date: '2026-01-01', rate: 0.5 });
  }
  return { trendData: out };
}
"""


MULTI_CHART_ONE_BAD = """
import { React, Charts, useHandler } from "@exepad/sdk";

function DashboardContent() {
  const { data: caseload } = useHandler("getCaseloadChart");
  const { data: trend } = useHandler("getTrend");
  return (
    <div>
      <Charts.PieChart>
        <Charts.Pie
          data={caseload?.chartData ?? []}
          dataKey="appointmentCount"
          nameKey="vetName"
        />
      </Charts.PieChart>
      <Charts.AreaChart data={trend?.trendData ?? []}>
        <Charts.Area dataKey="percentage" />
      </Charts.AreaChart>
    </div>
  );
}
"""


def test_multi_chart_only_bad_one_flagged():
    findings = _findings(
        MULTI_CHART_ONE_BAD,
        handler_sources={
            "getCaseloadChart": KY3CLHZB_HANDLER,
            "getTrend": HANDLER_TREND,
        },
    )
    assert len(findings) == 1
    msg = findings[0].formatted_message()
    assert "dataKey=\"percentage\"" in msg
    assert "getTrend" in msg
    # Expected available keys for trend handler:
    assert "rate" in msg
    assert "date" in msg


# ---------------------------------------------------------------------------
# 4. Aliased destructure — ``const { data: customAlias } = ...``
# ---------------------------------------------------------------------------


ALIASED = """
import { React, Charts, useHandler } from "@exepad/sdk";

function DashboardContent() {
  const { data: somethingElse } = useHandler("getCaseloadChart");
  return (
    <Charts.PieChart>
      <Charts.Pie
        data={somethingElse?.chartData ?? []}
        dataKey="totallyMadeUp"
      />
    </Charts.PieChart>
  );
}
"""


def test_aliased_destructure_still_attributes_to_handler():
    findings = _findings(ALIASED, handler_sources={"getCaseloadChart": KY3CLHZB_HANDLER})
    assert len(findings) == 1
    assert "getCaseloadChart" in findings[0].formatted_message()
    assert "totallyMadeUp" in findings[0].formatted_message()


# ---------------------------------------------------------------------------
# 5. Fail-open contract.
# ---------------------------------------------------------------------------


def test_no_handler_sources_yields_no_findings():
    # When the validation context can't reach handler source — e.g. early
    # creation flow before rehydration — the rule must not fire.
    findings = _findings(KY3CLHZB_BUGGY_PIE, handler_sources=None)
    assert findings == []


def test_handler_source_missing_for_referenced_handler_yields_no_findings():
    # Component references useHandler('X') but ctx.handler_sources['X'] is
    # absent — rule fails open rather than guessing.
    findings = _findings(KY3CLHZB_BUGGY_PIE, handler_sources={})
    assert findings == []


def test_handler_emits_no_object_literals_yields_no_findings():
    # Handler that returns an opaque expression (no static keys to compare
    # against) — rule fails open.
    OPAQUE_HANDLER = """
    async function handler(ctx) {
      return await ctx.someOpaqueCall();
    }
    """
    findings = _findings(
        KY3CLHZB_BUGGY_PIE, handler_sources={"getCaseloadChart": OPAQUE_HANDLER}
    )
    assert findings == []


# ---------------------------------------------------------------------------
# 6. Bonus — same bug class on different chart types.
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "wrapper,series",
    [
        ("Charts.BarChart", "Charts.Bar"),
        ("Charts.AreaChart", "Charts.Area"),
        ("Charts.LineChart", "Charts.Line"),
    ],
)
def test_each_chart_type_audits_datakey(wrapper: str, series: str):
    component = f"""
    import {{ React, Charts, useHandler }} from "@exepad/sdk";

    function DashboardContent() {{
      const {{ data: caseload }} = useHandler("getCaseloadChart");
      return (
        <{wrapper} data={{caseload?.chartData ?? []}}>
          <{series} dataKey="ghostField" />
        </{wrapper}>
      );
    }}
    """
    findings = _findings(component, handler_sources={"getCaseloadChart": KY3CLHZB_HANDLER})
    assert len(findings) == 1
    assert "ghostField" in findings[0].formatted_message()


# ---------------------------------------------------------------------------
# A1: trace one hop through local intermediates — coje33ih regression class.
# ---------------------------------------------------------------------------
#
# DashboardContent assembled an intermediate ``const metrics = { ... }``
# object from a ``useHandler`` binding, then passed ``metrics.chartData``
# to the chart. The previous root-identifier-only resolver couldn't
# attribute a producer for that data prop, so the rule failed open and
# the wrong dataKeys ``existingCost``/``proposedCost`` shipped against a
# handler that actually emits ``existing``/``proposed``.

COJE33IH_HANDLER = """
async function handler(ctx) {
  return {
    existingTco: 0,
    proposedTco: 0,
    savings: 0,
    payback: 0,
    chartData: [{ year: 2025, existing: 100, proposed: 80 }],
  };
}
"""


def test_coje33ih_derived_metrics_object_with_wrong_datakey_is_flagged():
    component = """
    import { React, Charts, useHandler } from "@exepad/sdk";

    function DashboardContent() {
      const { data: stats } = useHandler("getDashboardStats");
      const metrics = {
        existingTco: stats?.existingTco ?? 0,
        chartData: stats?.chartData ?? [],
      };
      return (
        <Charts.AreaChart data={metrics.chartData}>
          <Charts.Area dataKey="existingCost" />
        </Charts.AreaChart>
      );
    }
    """
    findings = _findings(component, handler_sources={"getDashboardStats": COJE33IH_HANDLER})
    assert len(findings) == 1
    msg = findings[0].formatted_message()
    assert "existingCost" in msg
    # Valid keys from the handler's literal must be surfaced in the hint.
    assert "existing" in msg


def test_coje33ih_derived_metrics_correct_datakey_passes():
    component = """
    import { React, Charts, useHandler } from "@exepad/sdk";

    function DashboardContent() {
      const { data: stats } = useHandler("getDashboardStats");
      const metrics = { chartData: stats?.chartData ?? [] };
      return (
        <Charts.AreaChart data={metrics.chartData}>
          <Charts.Area dataKey="existing" />
        </Charts.AreaChart>
      );
    }
    """
    findings = _findings(component, handler_sources={"getDashboardStats": COJE33IH_HANDLER})
    assert findings == []


def test_alias_binding_traces_to_handler():
    # ``const m = stats`` makes ``m`` interchangeable with ``stats``.
    component = """
    import { React, Charts, useHandler } from "@exepad/sdk";

    function C() {
      const { data: stats } = useHandler("getDashboardStats");
      const m = stats;
      return (
        <Charts.AreaChart data={m?.chartData}>
          <Charts.Area dataKey="wrong" />
        </Charts.AreaChart>
      );
    }
    """
    findings = _findings(component, handler_sources={"getDashboardStats": COJE33IH_HANDLER})
    assert len(findings) == 1
    assert "wrong" in findings[0].formatted_message()


def test_as_cast_alias_traces_to_handler():
    # ``const cast = stats as any`` should still alias correctly.
    component = """
    import { React, Charts, useHandler } from "@exepad/sdk";

    function C() {
      const { data: stats } = useHandler("getDashboardStats");
      const cast = (stats as any);
      return (
        <Charts.AreaChart data={cast?.chartData}>
          <Charts.Area dataKey="wrong" />
        </Charts.AreaChart>
      );
    }
    """
    findings = _findings(component, handler_sources={"getDashboardStats": COJE33IH_HANDLER})
    assert len(findings) == 1


def test_derived_binding_with_unrelated_local_does_not_overreach():
    # ``metrics`` is built from local constants, not from any handler — the
    # rule must NOT attribute a producer (fail-open).
    component = """
    import { React, Charts, useHandler } from "@exepad/sdk";

    function C() {
      const { data: _unused } = useHandler("getDashboardStats");
      const seed = [{ year: 2025, x: 1 }];
      const metrics = { chartData: seed };
      return (
        <Charts.AreaChart data={metrics.chartData}>
          <Charts.Area dataKey="anything" />
        </Charts.AreaChart>
      );
    }
    """
    # No producer attributable → no findings (the rule is strictly opt-in
    # to known-producer evidence).
    findings = _findings(component, handler_sources={"getDashboardStats": COJE33IH_HANDLER})
    assert findings == []
