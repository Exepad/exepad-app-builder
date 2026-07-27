"""Lock down the runtime route-literal coercion + homepage promotion.

Production traces (Run 5 / IronPulse) revealed two LLM-side patterns
breaking the AppRoutes union:

1. The Creator omitted ``page_slug == "/"`` from every content
   component, so the dts AppRoutes union had no ``/`` literal and
   sidebar components resorted to ``"/#dashboard"`` hash anchors.
2. The Creator occasionally emitted bare slugs (``"dashboard"`` instead
   of ``"/dashboard"``); the previous normalizer only stripped
   whitespace and didn't auto-prefix.

These tests exercise the two helpers added to ``creation_workflow``:
``_route_literal_for_slug`` (coerces one value) and
``_ensure_homepage_content_slug`` (mutates a list of component plans).
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow import (
    _check_content_components_have_building_plans,
    _ensure_homepage_content_slug,
    _route_literal_for_slug,
)
from main_agent.errors import PipelineError

pytestmark = [pytest.mark.unit]


class TestRouteLiteralForSlug:
    @pytest.mark.parametrize(
        "raw",
        [None, "", "  ", "/", "home", "Home", "HOME", "/home", "index", "/index"],
    )
    def test_home_synonyms_fold_to_root(self, raw):
        assert _route_literal_for_slug(raw) == "/"

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("/about", "/about"),
            ("/posts", "/posts"),
            ("/posts/:id", "/posts/:id"),
        ],
    )
    def test_already_canonical_paths_pass_through(self, raw: str, expected: str):
        assert _route_literal_for_slug(raw) == expected

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("about", "/about"),
            ("dashboard", "/dashboard"),
            ("members", "/members"),
            ("our-products", "/our-products"),
        ],
    )
    def test_bare_slug_gets_leading_slash(self, raw: str, expected: str):
        assert _route_literal_for_slug(raw) == expected

    def test_whitespace_padding_stripped(self):
        assert _route_literal_for_slug(" /about ") == "/about"
        assert _route_literal_for_slug(" / ") == "/"

    def test_non_string_input_returns_root(self):
        assert _route_literal_for_slug(None) == "/"
        assert _route_literal_for_slug(123) == "/"


def _content(name: str, slug):
    return {"name": name, "role": "content", "page_slug": slug}


class TestEnsureHomepageContentSlug:
    def test_existing_root_slug_left_alone(self):
        plans = [
            _content("HomeContent", "/"),
            _content("AboutContent", "/about"),
        ]
        _ensure_homepage_content_slug(plans)
        assert plans[0]["page_slug"] == "/"
        assert plans[1]["page_slug"] == "/about"

    def test_promotes_dashboard_when_no_root(self):
        plans = [
            _content("MembersContent", "/members"),
            _content("DashboardContent", "/dashboard"),
            _content("SettingsContent", "/settings"),
        ]
        _ensure_homepage_content_slug(plans)
        # Dashboard wins on name pattern.
        promoted = next(cp for cp in plans if cp["name"] == "DashboardContent")
        assert promoted["page_slug"] == "/"
        # Other slugs untouched.
        assert plans[0]["page_slug"] == "/members"
        assert plans[2]["page_slug"] == "/settings"

    def test_promotes_first_when_no_name_hint_matches(self):
        plans = [
            _content("MembersContent", "/members"),
            _content("ScheduleContent", "/schedule"),
        ]
        _ensure_homepage_content_slug(plans)
        # Falls back to the first content plan.
        assert plans[0]["page_slug"] == "/"
        assert plans[1]["page_slug"] == "/schedule"

    def test_bare_slug_normalized_in_place(self):
        plans = [
            _content("DashboardContent", "dashboard"),  # missing leading slash
            _content("MembersContent", "members"),
        ]
        _ensure_homepage_content_slug(plans)
        # Auto-prefix happens before homepage promotion. Then the dashboard
        # promotes to ``/`` because no plan has the root.
        assert plans[0]["page_slug"] == "/"
        assert plans[1]["page_slug"] == "/members"

    def test_home_synonym_normalized_then_kept_as_root(self):
        plans = [
            _content("HomeContent", "home"),
            _content("AboutContent", "/about"),
        ]
        _ensure_homepage_content_slug(plans)
        assert plans[0]["page_slug"] == "/"  # home → /
        assert plans[1]["page_slug"] == "/about"

    def test_non_content_plans_untouched(self):
        plans = [
            {"name": "MainSidebar", "role": "sidebar", "page_slug": None},
            _content("DashboardContent", "/dashboard"),
        ]
        _ensure_homepage_content_slug(plans)
        # Sidebar's page_slug stays None — not normalized, not promoted.
        assert plans[0]["page_slug"] is None
        # Dashboard promoted because no other content plan has /.
        assert plans[1]["page_slug"] == "/"

    def test_empty_plans_does_nothing(self):
        plans = []
        _ensure_homepage_content_slug(plans)  # should not raise
        assert plans == []

    def test_only_non_content_plans_does_nothing(self):
        plans = [
            {"name": "MainSidebar", "role": "sidebar", "page_slug": None},
            {"name": "MainHeader", "role": "header", "page_slug": None},
        ]
        _ensure_homepage_content_slug(plans)
        assert plans[0]["page_slug"] is None
        assert plans[1]["page_slug"] is None


class TestCheckContentComponentsHaveBuildingPlans:
    """Validates the post-materialization sanity check that every content
    component has actionable bullets. An empty plan after materialization
    means Creator violated the artifact contract OR the artifact body
    failed to load — either way, fail loudly to surface the regression."""

    def test_passes_when_every_content_component_has_bullets(self):
        plan = {
            "component_plans": [
                {"name": "HomeContent", "role": "content", "building_plan": ["a", "b"]},
                {"name": "AboutContent", "role": "content", "building_plan": ["c"]},
            ]
        }
        _check_content_components_have_building_plans(plan)  # no raise

    def test_raises_when_any_content_component_has_empty_plan(self):
        plan = {
            "component_plans": [
                {"name": "HomeContent", "role": "content", "building_plan": ["a"]},
                {"name": "GameContent", "role": "content", "building_plan": []},
            ]
        }
        with pytest.raises(PipelineError) as exc_info:
            _check_content_components_have_building_plans(plan)
        assert "GameContent" in str(exc_info.value)
        assert "HomeContent" not in str(exc_info.value)  # only flags the empty one

    def test_raises_when_building_plan_missing_entirely(self):
        plan = {
            "component_plans": [
                {"name": "Foo", "role": "content"},  # no building_plan key at all
            ]
        }
        with pytest.raises(PipelineError) as exc_info:
            _check_content_components_have_building_plans(plan)
        assert "Foo" in str(exc_info.value)

    def test_ignores_non_content_components(self):
        """Header / sidebar / footer don't need a building_plan — they're
        synthesized inline by Creator and design-import alike."""
        plan = {
            "component_plans": [
                {"name": "MainSidebar", "role": "sidebar", "building_plan": []},
                {"name": "MainFooter", "role": "footer", "building_plan": []},
                {"name": "HomeContent", "role": "content", "building_plan": ["a"]},
            ]
        }
        _check_content_components_have_building_plans(plan)  # no raise

    def test_ignores_non_dict_entries(self):
        plan = {
            "component_plans": [
                None,
                "garbage",
                {"name": "Real", "role": "content", "building_plan": ["x"]},
            ]
        }
        _check_content_components_have_building_plans(plan)  # no raise

    def test_uses_unnamed_placeholder_for_anonymous_empty_plan(self):
        plan = {"component_plans": [{"role": "content", "building_plan": []}]}
        with pytest.raises(PipelineError) as exc_info:
            _check_content_components_have_building_plans(plan)
        assert "<unnamed>" in str(exc_info.value)

    def test_lists_all_offending_components(self):
        plan = {
            "component_plans": [
                {"name": "A", "role": "content", "building_plan": []},
                {"name": "B", "role": "content", "building_plan": ["bullet"]},
                {"name": "C", "role": "content", "building_plan": []},
            ]
        }
        with pytest.raises(PipelineError) as exc_info:
            _check_content_components_have_building_plans(plan)
        msg = str(exc_info.value)
        assert "A" in msg
        assert "C" in msg

    def test_empty_component_plans_passes(self):
        """No components at all is caught by an earlier check; this helper
        treats empty as "nothing to validate" and returns cleanly."""
        plan = {"component_plans": []}
        _check_content_components_have_building_plans(plan)  # no raise

    def test_missing_component_plans_key_passes(self):
        plan = {}
        _check_content_components_have_building_plans(plan)  # no raise

    def test_rejects_empty_webpage_content_plan(self):
        """A content code page with empty bullets must be flagged."""
        plan = {
            "component_plans": [
                {
                    "name": "AboutContent",
                    "role": "content",
                    "page_type": "WebPageProps",
                    "building_plan": ["About copy"],
                },
                {
                    "name": "HomeContent",
                    "role": "content",
                    "page_type": "WebPageProps",
                    "building_plan": [],
                },
            ]
        }
        with pytest.raises(PipelineError) as exc_info:
            _check_content_components_have_building_plans(plan)
        assert "HomeContent" in str(exc_info.value)
        assert "BlogContent" not in str(exc_info.value)
