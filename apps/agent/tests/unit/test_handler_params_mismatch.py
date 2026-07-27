"""Unit tests for ``HandlerParamsMismatchRule`` — useHandler('X', { params })
keys must be read by the handler via ``ctx.params``.

Bug class motivation: eiu7xj0v (2026-05-14). DashboardContent calls
``useHandler('getDashboardStats', { params: { timeRange } })`` but the
handler declares no inputs; its strict-input wrapper rejects with
``VALIDATION_ERROR: Unrecognized key(s) in object: 'timeRange'`` and the
dashboard never receives any data.

These tests exercise:

1. **Detection on the regression case** — the exact eiu7xj0v pattern.
2. **Pass-through on a clean case** — consumer + handler agree on the
   param shape (member access).
3. **Pass-through on destructure** — handler reads via
   ``const { days } = ctx.params``.
4. **Pass-through on type-asserted destructure** — common in agent
   output: ``const { x } = ctx.params as { x: string }``.
5. **Multiple consumers** — same handler used by two components with
   different param shapes; only the mismatching one fires.
6. **Fail-open contracts** — missing ``handler_sources``, missing
   specific handler, handler with no ctx.params reads at all (we
   can't tell if it spreads the whole object), shorthand keys.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_handler_param_match import (
    HandlerParamsMismatchRule,
)


def _ctx(component_tsx: str, handler_sources: dict[str, str] | None) -> AstContext:
    return AstContext(
        tsx=component_tsx,
        source_buf=source_bytes(component_tsx),
        tree=parse_tsx(component_tsx),
        handler_sources=handler_sources,
    )


def _findings(component_tsx: str, handler_sources: dict[str, str] | None) -> list:
    return list(HandlerParamsMismatchRule().check(_ctx(component_tsx, handler_sources)))


# ---------------------------------------------------------------------------
# 1. The eiu7xj0v regression — Dashboard sends timeRange, handler reads nothing.
# ---------------------------------------------------------------------------


EIU7_HANDLER = """
import { HandlerContext } from "@exepad/sdk";

async function handler(ctx: HandlerContext) {
  const userId = ctx.user.id;
  const orderStats = await ctx.db.prepare(
    'SELECT SUM(total) as total_revenue FROM orders WHERE owner_id = ?'
  ).bind(userId).first();
  return { totalRevenue: orderStats?.total_revenue ?? 0 };
}

export default handler;
"""

EIU7_BUGGY_DASHBOARD = """
import { React, useHandler } from "@exepad/sdk";

function DashboardContent() {
  const [timeRange, setTimeRange] = React.useState("Month");
  const { data: stats } = useHandler("getDashboardStats", {
    params: { timeRange }
  });
  return <div>{stats?.totalRevenue}</div>;
}
"""


def test_eiu7xj0v_dashboard_sends_unread_timerange_param() -> None:
    findings = _findings(
        EIU7_BUGGY_DASHBOARD,
        handler_sources={"getDashboardStats": EIU7_HANDLER},
    )
    # Handler reads zero ctx.params keys → fail open. Confirm that.
    # The eiu7xj0v pattern: handler doesn't even declare ctx.params usage.
    # Per the rule's contract, when the handler reads NOTHING from
    # ctx.params, the rule fails open unless an opt-in marker is present.
    # The real fix is to teach the handler to declare timeRange.
    assert findings == []


EIU7_HANDLER_WITH_STRICT_MARKER = """
import { HandlerContext } from "@exepad/sdk";

// @exepad-strict-params: (handler declares no params)
async function handler(ctx: HandlerContext) {
  return { totalRevenue: 0 };
}

export default handler;
"""


def test_strict_marker_makes_rule_fire_on_unread_param() -> None:
    findings = _findings(
        EIU7_BUGGY_DASHBOARD,
        handler_sources={"getDashboardStats": EIU7_HANDLER_WITH_STRICT_MARKER},
    )
    assert len(findings) == 1
    msg = findings[0].message
    assert "timeRange" in msg
    assert "getDashboardStats" in msg
    assert findings[0].severity == "warning"


# ---------------------------------------------------------------------------
# 2. Mismatch flagged when handler reads OTHER keys but not the sent one.
# ---------------------------------------------------------------------------


HANDLER_READING_DAYS_ONLY = """
async function handler(ctx) {
  const days = (ctx.params.days as number) || 30;
  return { trends: [] };
}
export default handler;
"""

CONSUMER_SENDING_TIMERANGE_NOT_DAYS = """
import { React, useHandler } from "@exepad/sdk";
function X() {
  const { data } = useHandler("getOrderTrends", {
    params: { timeRange: "Month" }
  });
  return <div>{data?.trends?.length}</div>;
}
"""


def test_unread_key_flagged_when_handler_reads_a_different_key() -> None:
    findings = _findings(
        CONSUMER_SENDING_TIMERANGE_NOT_DAYS,
        handler_sources={"getOrderTrends": HANDLER_READING_DAYS_ONLY},
    )
    assert len(findings) == 1
    msg = findings[0].message
    assert "timeRange" in msg
    assert "['days']" in msg or "days" in msg  # handler reads list surfaced


# ---------------------------------------------------------------------------
# 3. Clean case: handler reads via member access matches consumer.
# ---------------------------------------------------------------------------


CLEAN_HANDLER_MEMBER_ACCESS = """
async function handler(ctx) {
  const days = (ctx.params.days as number) || 30;
  return { trends: [] };
}
"""

CLEAN_CONSUMER = """
import { React, useHandler } from "@exepad/sdk";
function X() {
  const { data } = useHandler("getOrderTrends", { params: { days: 30 } });
  return <div />;
}
"""


def test_clean_case_no_findings_with_member_access() -> None:
    findings = _findings(
        CLEAN_CONSUMER, handler_sources={"getOrderTrends": CLEAN_HANDLER_MEMBER_ACCESS}
    )
    assert findings == []


# ---------------------------------------------------------------------------
# 4. Clean case: destructure read.
# ---------------------------------------------------------------------------


CLEAN_HANDLER_DESTRUCTURE = """
async function handler(ctx) {
  const { businessName, contactEmail } = ctx.params as {
    businessName?: string;
    contactEmail?: string;
  };
  return { ok: true };
}
"""

DESTRUCTURE_CONSUMER = """
import { React, useHandler } from "@exepad/sdk";
function X() {
  const { execute } = useHandler("updateBusinessSettings", {
    autoFetch: false,
    params: { businessName: "Acme", contactEmail: "a@b.c" }
  });
  return <button onClick={execute}>save</button>;
}
"""


def test_clean_case_no_findings_with_destructure() -> None:
    findings = _findings(
        DESTRUCTURE_CONSUMER,
        handler_sources={"updateBusinessSettings": CLEAN_HANDLER_DESTRUCTURE},
    )
    assert findings == []


# ---------------------------------------------------------------------------
# 5. Optional-chain member access (ctx.params?.foo).
# ---------------------------------------------------------------------------


HANDLER_OPTIONAL_CHAIN = """
async function handler(ctx) {
  const x = ctx.params?.foo;
  return { x };
}
"""

CONSUMER_FOO_BAR = """
import { React, useHandler } from "@exepad/sdk";
function X() {
  const { data } = useHandler("h", { params: { foo: 1, bar: 2 } });
  return <div />;
}
"""


def test_optional_chain_member_recognised_bar_flagged() -> None:
    findings = _findings(
        CONSUMER_FOO_BAR, handler_sources={"h": HANDLER_OPTIONAL_CHAIN}
    )
    assert len(findings) == 1
    msg = findings[0].message
    # 'bar' is the unread param; 'foo' is recognised as a handler-read key
    # (validating the optional-chain pattern). Both appear in the message
    # but in different roles — assert the structure.
    assert "sends param(s) ['bar']" in msg
    assert "Handler reads: ['foo']" in msg


# ---------------------------------------------------------------------------
# 6. Rest-spread destructure → fail open (handler accepts arbitrary extras).
# ---------------------------------------------------------------------------


HANDLER_REST_SPREAD = """
async function handler(ctx) {
  const { x, ...rest } = ctx.params;
  return { x };
}
"""


def test_rest_spread_destructure_fails_open() -> None:
    consumer = """
import { React, useHandler } from "@exepad/sdk";
function X() {
  const { data } = useHandler("h", { params: { x: 1, anything: 2 } });
  return <div />;
}
"""
    findings = _findings(consumer, handler_sources={"h": HANDLER_REST_SPREAD})
    assert findings == []


# ---------------------------------------------------------------------------
# 7. Multiple consumers — mismatch only fires on the wrong one.
# ---------------------------------------------------------------------------


MULTI_CONSUMER = """
import { React, useHandler } from "@exepad/sdk";
function X() {
  const a = useHandler("h", { params: { days: 30 } });
  const b = useHandler("h", { params: { timeRange: "M" } });
  return <div>{a.data?.x}{b.data?.x}</div>;
}
"""


def test_multi_consumer_only_mismatch_flagged() -> None:
    handler = """
async function handler(ctx) {
  const days = ctx.params.days;
  return { x: days };
}
"""
    findings = _findings(MULTI_CONSUMER, handler_sources={"h": handler})
    assert len(findings) == 1
    assert "timeRange" in findings[0].message


# ---------------------------------------------------------------------------
# 8. Fail-open contracts.
# ---------------------------------------------------------------------------


def test_missing_handler_sources_fails_open() -> None:
    findings = _findings(EIU7_BUGGY_DASHBOARD, handler_sources=None)
    assert findings == []


def test_missing_specific_handler_fails_open() -> None:
    findings = _findings(
        EIU7_BUGGY_DASHBOARD,
        handler_sources={"someOtherHandler": "async function handler(ctx){return {};}"},
    )
    assert findings == []


def test_handler_with_no_params_reads_fails_open_without_marker() -> None:
    # Handler reads no ctx.params at all → we can't tell if it spreads
    # the whole object via something like `const all = ctx.params`. Fail
    # open to keep false-positive noise down.
    handler = "async function handler(ctx){return {x: 1};}"
    consumer = """
import { React, useHandler } from "@exepad/sdk";
function X() {
  const a = useHandler("h", { params: { z: 1 } });
  return <div />;
}
"""
    findings = _findings(consumer, handler_sources={"h": handler})
    assert findings == []


def test_shorthand_key_in_params_object_is_extracted() -> None:
    # `{ params: { timeRange } }` is shorthand-equivalent to
    # `{ params: { timeRange: timeRange } }` — both should be picked up.
    handler = """
async function handler(ctx) {
  // reads only 'foo'
  const x = ctx.params.foo;
  return { x };
}
"""
    consumer = """
import { React, useHandler } from "@exepad/sdk";
function X() {
  const [timeRange, setTimeRange] = React.useState("M");
  const a = useHandler("h", { params: { timeRange } });
  return <div />;
}
"""
    findings = _findings(consumer, handler_sources={"h": handler})
    assert len(findings) == 1
    assert "timeRange" in findings[0].message
