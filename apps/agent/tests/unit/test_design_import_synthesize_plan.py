"""Unit tests for ``DesignImportWorkflow._synthesize_frontend_compliance_edit_plan``.

Verifies that the synthesized ``EditorOutput`` correctly reflects the
imported design's component layout + extracted-wiring metadata, AND
that backend / theme / logic / handler action lists are deliberately
empty (those resources are handled outside the EditPlan via direct
BackendBuilder calls).
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.editor import (
    EditorOutput,
)
from main_agent.agents.orchestrator.app_types.webapp.workflows.design_import_workflow import (
    DesignImportWorkflow,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Stubs
# --------------------------------------------------------------------------- #


class _StubSession:
    def __init__(self, state):
        self.state = dict(state)
        self.id = "session-1"
        self.user_id = "user-1"
        self.app_name = "test-app"


def _make_workflow() -> DesignImportWorkflow:
    return DesignImportWorkflow(
        editing_workflow=MagicMock(),
        backend_builder=MagicMock(),
        design_importer_agent=MagicMock(),
        validation_service=SimpleNamespace(),
    )


def _ctx(creator_plan: dict):
    return SimpleNamespace(session=_StubSession({StateKeys.CREATOR_PLAN: creator_plan}))


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


def test_emits_one_action_per_entry_with_wiring():
    workflow = _make_workflow()
    creator_plan = {
        "component_plans": [
            {
                "name": "HomeContent",
                "role": "content",
                "page_slug": "/",
                "supporting_modules": ["Hero", "Card"],
            },
            {
                "name": "DashboardContent",
                "role": "content",
                "page_slug": "/dashboard",
                "supporting_modules": ["Charts"],
            },
            {"name": "MainHeader", "role": "header"},  # chrome — not entry
        ],
        "design_import_meta": {
            "extracted_wiring": [
                {
                    "entry_component": "DashboardContent",
                    "consumer_module": "Charts",
                    "data_symbol": "products",
                    "model_name": "products",
                },
            ],
        },
    }

    plan = workflow._synthesize_frontend_compliance_edit_plan(_ctx(creator_plan))
    assert isinstance(plan, EditorOutput)
    assert len(plan.frontend_build_actions) == 2

    by_name = {
        # crude — match prompt by entry name
        "HomeContent": [
            a for a in plan.frontend_build_actions if "HomeContent" in a.prompt
        ],
        "DashboardContent": [
            a for a in plan.frontend_build_actions if "DashboardContent" in a.prompt
        ],
    }
    assert len(by_name["HomeContent"]) == 1
    assert len(by_name["DashboardContent"]) == 1

    # Wiring shows up only on the DashboardContent prompt
    dashboard_prompt = by_name["DashboardContent"][0].prompt
    assert "useModel('products')" in dashboard_prompt
    assert "discover_dependencies" in dashboard_prompt
    assert "Charts" in dashboard_prompt

    # HomeContent has supporting modules but no wiring
    home_prompt = by_name["HomeContent"][0].prompt
    assert "Hero" in home_prompt
    assert "Card" in home_prompt
    assert "useModel" not in home_prompt


def test_chrome_components_excluded():
    """header / sidebar / footer are NOT translated through the
    Babel-shell pipeline; they don't need the cleanup pass."""
    workflow = _make_workflow()
    creator_plan = {
        "component_plans": [
            {"name": "MainHeader", "role": "header"},
            {"name": "MainSidebar", "role": "sidebar"},
            {"name": "MainFooter", "role": "footer"},
            {
                "name": "HomeContent",
                "role": "content",
                "page_slug": "/",
                "supporting_modules": [],
            },
        ],
    }
    plan = workflow._synthesize_frontend_compliance_edit_plan(_ctx(creator_plan))
    assert len(plan.frontend_build_actions) == 1
    assert "HomeContent" in plan.frontend_build_actions[0].prompt
    assert "MainHeader" not in plan.frontend_build_actions[0].prompt


def test_other_action_lists_are_empty():
    """Backend / theme / logic / handler / page actions are handled
    outside the EditPlan. The synthesis must NOT populate them."""
    workflow = _make_workflow()
    creator_plan = {
        "component_plans": [
            {
                "name": "HomeContent",
                "role": "content",
                "page_slug": "/",
                "supporting_modules": ["Hero"],
            }
        ],
        "app_backend_plan": {
            "backend_type": "dynamic",
            "models": [{"name": "products"}],
            "handlers": [{"name": "exportCsv"}],
        },
    }
    plan = workflow._synthesize_frontend_compliance_edit_plan(_ctx(creator_plan))
    assert plan.modify_styles_actions == []
    assert plan.change_backend_models_actions == []
    assert plan.modify_logic_actions == []
    assert plan.add_handler_actions == []
    assert plan.modify_handler_actions == []
    assert plan.remove_handler_actions == []
    assert plan.rename_page_title_actions == []


def test_empty_creator_plan_yields_empty_plan():
    workflow = _make_workflow()
    plan = workflow._synthesize_frontend_compliance_edit_plan(_ctx({}))
    assert isinstance(plan, EditorOutput)
    assert plan.frontend_build_actions == []


def test_plan_round_trips_through_model_validate():
    """The synthesized plan must survive ``model_dump → model_validate``
    round-trip (the production path EditingWorkflow takes via
    ``_plan_edits`` skip block)."""
    workflow = _make_workflow()
    creator_plan = {
        "component_plans": [
            {
                "name": "HomeContent",
                "role": "content",
                "page_slug": "/",
                "supporting_modules": ["Hero"],
            }
        ],
    }
    plan = workflow._synthesize_frontend_compliance_edit_plan(_ctx(creator_plan))
    dumped = plan.model_dump()
    restored = EditorOutput.model_validate(dumped)
    assert len(restored.frontend_build_actions) == 1
    assert "HomeContent" in restored.frontend_build_actions[0].prompt
