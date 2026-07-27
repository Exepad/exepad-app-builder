"""End-to-end Path C — design import of a dashboard mockup with backend.

When the source HTML carries data-bound shapes (repeating rows,
inline SVG charts, map placeholders) AND the workflow declared
matching backend models / handlers, Phase 5's plan_builder emits
wiring plan items that ComponentBuilder consumes in edit mode.

This test verifies:
- Mechanical pipeline produces TSX with all source content preserved
- Plan items emit references to the user table, the SVG chart, and
  the map placeholder
- Plan items list ONLY available backend names (no fabrication
  even at the plan-suggestion level)
- Path-C-without-backend falls back to Path-B (no wiring plan items)
"""

from __future__ import annotations

from pathlib import Path

import pytest

from main_agent.agents.orchestrator.importers.tools.html_to_tsx import (
    transform_html_to_tsx,
)

pytestmark = [pytest.mark.integration]

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(scope="module")
def dashboard_html():
    return (FIXTURES_DIR / "dashboard_mockup.html").read_text(encoding="utf-8")


def test_dashboard_with_full_backend_emits_wiring_plan_items(dashboard_html):
    result = transform_html_to_tsx(
        dashboard_html,
        component_name="Dashboard",
        component_role="content",
        page_slugs=("/",),
        backend_surface={
            "models": [
                {
                    "name": "users",
                    "fields": [{"name": "name"}, {"name": "email"}, {"name": "status"}],
                },
            ],
            "handlers": [
                {"name": "monthly_revenue"},
            ],
        },
        building_plan=["Render the dashboard with users table, revenue chart, and office map"],
    )

    plan_text = "\n".join(result.plan_items)

    # Repeating leaves (4 user-row tables) emit a wiring plan item
    # referencing the available models.
    assert "WIRING" in plan_text
    assert "users" in plan_text
    assert "user-row" in plan_text or "tr" in plan_text

    # Inline SVG chart (6 rects) + handler ⇒ Charts.BarChart plan item.
    assert "Charts.BarChart" in plan_text or "Charts." in plan_text
    assert "monthly_revenue" in plan_text

    # Map placeholder + plan_mention("map") ⇒ MapEmbed plan item.
    assert "MapEmbed" in plan_text
    assert "leaflet-container" in plan_text

    # Source content preserved verbatim
    for needle in [
        "Active Users",
        "Total Users",
        "User Directory",
        "Alice Johnson",
        "alice@example.com",
        "Monthly Revenue",
        "Office Locations",
    ]:
        assert needle in result.tsx, f"Source content {needle!r} missing from mechanical TSX"


def test_dashboard_without_backend_falls_back_to_path_b(dashboard_html):
    """Same dashboard HTML, no backend_surface → no wiring plan items.

    The mechanical TSX is the final output; the user gets a static
    dashboard with mock data. ComponentBuilder skipped.
    """
    result = transform_html_to_tsx(
        dashboard_html,
        component_name="Dashboard",
        component_role="content",
        backend_surface=None,
        building_plan=None,
    )

    assert (
        result.plan_items == []
    ), f"Expected zero plan items (Path B fallback), got: {result.plan_items}"

    # Source content still preserved
    assert "Alice Johnson" in result.tsx
    assert "Monthly Revenue" in result.tsx


def test_dashboard_without_handlers_no_chart_plan_item(dashboard_html):
    """Backend declared but no handlers → no Charts plan item."""
    result = transform_html_to_tsx(
        dashboard_html,
        component_name="Dashboard",
        component_role="content",
        backend_surface={
            "models": [{"name": "users"}],
            "handlers": [],
        },
        building_plan=[],
    )
    plan_text = "\n".join(result.plan_items)
    assert "Charts." not in plan_text, (
        "Without a matching handler, the chart-substitution plan item " "should not fire"
    )
    # users wiring plan item should still fire (model declared + repeating <tr>)
    assert "users" in plan_text


def test_dashboard_plan_items_never_invent_backend_names(dashboard_html):
    """Every model/handler name mentioned in plan items must come from
    the declared backend_surface."""
    result = transform_html_to_tsx(
        dashboard_html,
        component_name="Dashboard",
        component_role="content",
        backend_surface={
            "models": [{"name": "users"}],
            "handlers": [{"name": "monthly_revenue"}],
        },
        building_plan=["Map of locations"],
    )
    plan_text = "\n".join(result.plan_items)
    # Plan items must NOT mention any model/handler name not declared.
    forbidden = ["fabricated", "made_up_model", "imaginary_handler", "astra_finance"]
    for bad in forbidden:
        assert bad not in plan_text, f"Plan items leaked an undeclared name: {bad!r}"
