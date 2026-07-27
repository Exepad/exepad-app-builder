"""Tests for ``component.codegen.hardcoded_overrides_usemodel`` — blocks
components that import ``useModel('X')`` but render a hardcoded data
array whose keys overlap with model X's columns.

Surfaced 2026-05-16 on app ``i9bm2ti4``: PlansContent had
``useModel('members')`` plus a 3-tier hardcoded ``plans`` array
whose object keys (``name``, ``price``, ``features``) shadowed what
the proper ``plans`` model would have carried. Three of six pages
shipped this evasion pattern.
"""

from main_agent.services.validation.semantic_validator import run_semantic_checks
from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_hardcoded_overrides_usemodel import (
    HardcodedOverridesUseModelRule,
)

PLANS_MODEL = {
    "name": "plans",
    "columns": [
        {"name": "id", "type": "integer"},
        {"name": "name", "type": "text"},
        {"name": "price", "type": "real"},
        {"name": "features", "type": "json"},
        {"name": "period", "type": "text"},
    ],
}

INVOICES_MODEL = {
    "name": "invoices",
    "columns": [
        {"name": "id", "type": "integer"},
        {"name": "amount", "type": "real"},
        {"name": "date", "type": "text"},
        {"name": "status", "type": "text"},
        {"name": "client", "type": "text"},
    ],
}

BOOKINGS_MODEL = {
    "name": "bookings",
    "columns": [
        {"name": "id", "type": "integer"},
        {"name": "member_id", "type": "integer"},
        {"name": "resource_id", "type": "integer"},
        {"name": "start_time", "type": "text"},
        {"name": "end_time", "type": "text"},
    ],
}

MEMBERS_MODEL = {
    "name": "members",
    "columns": [
        {"name": "id", "type": "integer"},
        {"name": "full_name", "type": "text"},
        {"name": "plan_type", "type": "text"},
        {"name": "status", "type": "text"},
    ],
}


def _run(tsx: str, models: list[dict]) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree, models=models)
    return [f.message for f in HardcodedOverridesUseModelRule().check(ctx)]


class TestFires:
    def test_plans_shadowed_by_hardcoded_array(self):
        # The i9bm2ti4 PlansContent shape.
        tsx = """
        import {useModel} from '@exepad/sdk';
        function PlansContent() {
          const { data: members } = useModel("plans");
          const plans = [
            { id: 1, name: "Part-time", price: 199, features: ["a", "b"] },
            { id: 2, name: "Dedicated Desk", price: 499, features: ["c"] },
            { id: 3, name: "Private Office", price: 1200, features: ["d"] },
          ];
          return plans;
        }
        """
        msgs = _run(tsx, [PLANS_MODEL])
        assert len(msgs) == 1
        assert "plans" in msgs[0]
        assert "useModel('plans')" in msgs[0]

    def test_invoices_shadowed_with_base_invoices_constant(self):
        # The i9bm2ti4 BillingContent shape — even uses ``baseInvoices`` as
        # the var name. Keys overlap: amount, date, status, id.
        tsx = """
        import {useModel} from '@exepad/sdk';
        function BillingContent() {
          const { data: members } = useModel("invoices");
          const baseInvoices = [
            { id: "#INV-2039", amount: 4500.0, date: "Oct 01", status: "paid" },
            { id: "#INV-2040", amount: 8250.0, date: "Oct 15", status: "Unpaid" },
            { id: "#INV-2041", amount: 1200.0, date: "Oct 22", status: "Void" },
            { id: "#INV-2042", amount: 3400.0, date: "Nov 02", status: "paid" },
          ];
          return baseInvoices;
        }
        """
        msgs = _run(tsx, [INVOICES_MODEL])
        assert len(msgs) == 1
        assert "baseInvoices" in msgs[0]
        assert "useModel('invoices')" in msgs[0]


class TestDoesNotFire:
    def test_weekday_string_array_passes(self):
        # CalendarContent uses ``weekDays`` as UI scaffolding — strings,
        # not objects. The rule only considers object-literal arrays.
        tsx = """
        import {useModel} from '@exepad/sdk';
        function CalendarContent() {
          const { data: bookings } = useModel("bookings");
          const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri"];
          return weekDays;
        }
        """
        assert _run(tsx, [BOOKINGS_MODEL]) == []

    def test_time_slot_array_passes(self):
        tsx = """
        import {useModel} from '@exepad/sdk';
        function CalendarContent() {
          const { data: bookings } = useModel("bookings");
          const timeSlots = ["08:00", "10:00", "12:00", "14:00"];
          return timeSlots;
        }
        """
        assert _run(tsx, [BOOKINGS_MODEL]) == []

    def test_low_overlap_constant_passes(self):
        # ``planTiers`` shares only ``name`` with the members model
        # (which has full_name, plan_type, status, id). Jaccard < 0.5.
        tsx = """
        import {useModel} from '@exepad/sdk';
        function MembersContent() {
          const { data: members } = useModel("members");
          const planTiers = [
            { tier: "starter", price: 99 },
            { tier: "growth", price: 299 },
            { tier: "enterprise", price: 999 },
          ];
          return planTiers;
        }
        """
        assert _run(tsx, [MEMBERS_MODEL]) == []

    def test_no_usemodel_call_passes(self):
        # Out of scope when no useModel call — KPI rule + others handle
        # the "hardcoded data without any useModel" case separately.
        tsx = """
        import {React} from '@exepad/sdk';
        function StaticPage() {
          const items = [
            { name: "a", price: 1 },
            { name: "b", price: 2 },
            { name: "c", price: 3 },
          ];
          return items;
        }
        """
        assert _run(tsx, [PLANS_MODEL]) == []

    def test_two_entry_array_passes(self):
        # ≥3-entry minimum avoids flagging tiny default/fallback constants.
        tsx = """
        import {useModel} from '@exepad/sdk';
        function PlansContent() {
          const { data } = useModel("plans");
          const placeholder = [
            { name: "Free", price: 0 },
            { name: "Pro", price: 99 },
          ];
          return placeholder;
        }
        """
        assert _run(tsx, [PLANS_MODEL]) == []


class TestIntegration:
    def test_rule_runs_through_run_semantic_checks(self):
        # Regression guard for default_set.py registration.
        tsx = """import {useModel} from '@exepad/sdk';
function PlansContent() {
  const { data } = useModel("plans");
  const plans = [
    { id: 1, name: "Free", price: 0, features: [] },
    { id: 2, name: "Pro", price: 99, features: [] },
    { id: 3, name: "Enterprise", price: 999, features: [] },
  ];
  return plans;
}
"""
        result = run_semantic_checks(tsx, [PLANS_MODEL], {}, [])
        all_msgs = result.errors + result.warnings
        assert any(
            "shadows" in m and "useModel('plans')" in m for m in all_msgs
        ), all_msgs
