"""Unit tests for the design-import FrontendBuildAction wiring-hint injection.

When the DesignImportWorkflow synthesizes the compliance pass, each
entry's prompt should explicitly mention ``useModel('X')`` for every
backend model whose name semantically maps to the component. Without
this, ComponentBuilderMultiple may finish a pure-translation pass
without ever wiring real data.

Surfaced 2026-05-15 on app ``alo48zsn``: BookingCalendar finished CBM
in 84s with 0 ``useModel`` calls; ResourceManagement in 79s with 0.
Both names clearly map to ``bookings`` / ``resources`` models that
existed in the schema.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.workflows.design_import_workflow import (
    DesignImportWorkflow,
    _models_related_to_component,
)

pytestmark = [pytest.mark.unit]


class TestModelsRelatedToComponent:
    """Fuzzy-match the PascalCase entry name against backend model names."""

    def test_booking_calendar_maps_to_bookings(self):
        assert _models_related_to_component(
            "BookingCalendar", ["bookings", "resources"]
        ) == ["bookings"]

    def test_resource_management_maps_to_resources(self):
        assert _models_related_to_component(
            "ResourceManagement", ["resources", "plans"]
        ) == ["resources"]

    def test_billing_invoices_maps_to_invoices(self):
        assert _models_related_to_component(
            "BillingInvoices", ["invoices", "members"]
        ) == ["invoices"]

    def test_member_directory_maps_to_members(self):
        assert _models_related_to_component(
            "MemberDirectory", ["members", "resources"]
        ) == ["members"]

    def test_dashboard_header_with_no_overlap_returns_empty(self):
        # "Header" isn't a model name, "Dashboard" doesn't overlap any
        # of the named models. No hint should fire.
        assert _models_related_to_component(
            "DashboardHeader", ["bookings", "resources"]
        ) == []

    def test_empty_inputs_return_empty(self):
        assert _models_related_to_component("", ["bookings"]) == []
        assert _models_related_to_component("Foo", []) == []

    def test_multiple_matches_returned(self):
        # A page that maps to multiple models gets all of them.
        result = _models_related_to_component(
            "BookingsAndResourcesView", ["bookings", "resources", "plans"]
        )
        assert "bookings" in result
        assert "resources" in result
        assert "plans" not in result


class TestCompliancePromptWiringHint:
    """The compliance prompt's softer hint semantics (RC#2 fix).

    Before Track 3 / Fix 3.3 (2026-05-16), the prompt told the LLM:
    *"Do NOT leave hardcoded names, dates, prices, or quantities from
    the translated HTML in place — replace them with the `useModel(...)`
    results."* That wording caused RC#2 in app `w4hov6ht`: the home page's
    own product literals ("Pasture-Raised Heirloom Eggs $8") were
    silently swapped for the seed-CSV products extracted from a DIFFERENT
    page ("Fresh Farm Eggs"). The seed CSV was inferred from only one
    page's literals; rewiring the other pages dropped their canonical copy.

    Post-fix semantics:
      * **Explicit wiring** (data_extractor confirmed `const X = [...]` +
        `.map()` consumer): prompt asks for USEMODEL-WIRING in a specific
        consumer module, with strict JSX-shape preservation.
      * **Model hints** (fuzzy entry-name → model-name match, NO
        confirmed array consumer): prompt mentions the model exists but
        gates the wiring action behind "only if the source TSX of THIS
        component already contains a top-level `const X = [{...}]`...".
        It does NOT instruct the LLM to invent the wiring.

    These tests pin the new wording so a future regression that
    re-introduces the unconditional rewrite hint is caught.
    """

    def test_prompt_mentions_model_existence_but_gates_wiring(self):
        """When only a fuzzy model_hint is provided (no confirmed wiring),
        the prompt should NOT emit an unconditional `useModel('X')` instruction.
        It should declare the model exists and gate the wiring behind an
        explicit "only if source has a `.map()` array" precondition."""
        prompt = DesignImportWorkflow._build_compliance_prompt(
            entry_name="BookingCalendar",
            modules=[],
            wiring=[],
            model_hints=["bookings"],
        )
        # Acknowledges the model exists.
        assert "bookings" in prompt
        # But DOES NOT issue the unconditional rewrite instruction that
        # caused RC#2.
        assert "useModel('bookings')" not in prompt
        # The gate must be present (the "only if" precondition).
        assert "only act on the hints" in prompt.lower()
        assert "leave the literals" in prompt.lower()

    def test_prompt_omits_hint_when_model_hints_empty(self):
        prompt = DesignImportWorkflow._build_compliance_prompt(
            entry_name="MainHeader",
            modules=[],
            wiring=[],
            model_hints=[],
        )
        # No model-existence mention, no wiring instruction.
        assert "useModel(" not in prompt
        assert "heuristic model-name match" not in prompt.lower()

    def test_explicit_wiring_emits_strict_usemodel_instruction(self):
        """When the data extractor CONFIRMED a wiring (array literal +
        consumer), the prompt should emit a strict `useModel('X').data`
        instruction with JSX-shape preservation guidance — the agent
        SHOULD replace this specific array because the extractor proved
        it exists in the source and is consumed by `.map()`."""
        prompt = DesignImportWorkflow._build_compliance_prompt(
            entry_name="BookingCalendar",
            modules=["mod_calendar"],
            wiring=[
                {
                    "consumer_module": "mod_calendar",
                    "data_symbol": "BOOKINGS",
                    "model_name": "bookings",
                }
            ],
            model_hints=["resources"],
        )
        # Confirmed-wiring path: strict instruction.
        assert "useModel('bookings').data" in prompt
        assert "USEMODEL-WIRING" in prompt
        assert "EXACTLY the same JSX shape" in prompt
        # Soft model_hint path for the unrelated "resources" model:
        # acknowledges existence but does NOT issue a wiring instruction.
        assert "resources" in prompt
        assert "useModel('resources')" not in prompt
