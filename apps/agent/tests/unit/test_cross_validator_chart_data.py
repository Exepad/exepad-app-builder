"""Unit tests for CrossValidator chart data source checks and auto-fixes."""

import pytest

from main_agent.agents.orchestrator.app_types.shared.services.cross_validator import (
    CrossValidator,
)


def _make_config(
    *,
    chart_data="state.dashboardData.items",
    chart_type="ChartProps",
    actions=None,
    handlers=None,
    state=None,
    button_action=None,
):
    """Build a minimal app_config for testing chart data source validation."""
    if actions is None:
        actions = {
            "loadDashboard": [
                {"set": "isLoading", "to": True},
                {
                    "api": {
                        "type": "handler",
                        "handler": "getDashboard",
                        "resultField": "dashboardData",
                    }
                },
                {"set": "isLoading", "to": False},
            ]
        }
    if handlers is None:
        handlers = [{"name": "getDashboard", "method": "getDashboard"}]
    if state is None:
        state = {"dashboardData": None, "isLoading": False}

    page_content = [
        {
            "componentType": chart_type,
            "uuid": "chart-1",
            "data": chart_data,
            "type": "bar",
        }
    ]

    if button_action:
        page_content.append(
            {
                "componentType": "ButtonProps",
                "uuid": "btn-1",
                "text": "Load",
                "action": button_action,
            }
        )

    return {
        "frontend": {
            "logic": {
                "state": state,
                "actions": actions,
                "computed": {},
            },
            "pages": [
                {
                    "slug": "/",
                    "title": "Dashboard",
                    "sections": [{"content": page_content}],
                }
            ],
        },
        "backend": {
            "models": [],
            "handlers": handlers,
        },
    }


class TestChartStateDataSources:
    """Tests for _check_chart_state_data_sources and related checks."""

    @pytest.mark.unit
    def test_detects_chart_with_untriggered_state_data(self):
        """Chart using state.X from an untriggered action should produce warnings."""
        config = _make_config()
        validator = CrossValidator()
        warnings = validator.validate_and_fix(config)

        chart_warnings = [w for w in warnings if "data='state.dashboardData.items'" in w]
        assert len(chart_warnings) >= 1, f"Expected chart data warning, got: {warnings}"
        assert "never triggered" in chart_warnings[0]

    @pytest.mark.unit
    def test_no_false_positive_when_action_triggered(self):
        """Chart using state.X where the action IS triggered should not warn about data."""
        config = _make_config(button_action="loadDashboard")
        validator = CrossValidator()
        warnings = validator.validate_and_fix(config)

        chart_data_warnings = [
            w for w in warnings if "state.dashboardData" in w and "never triggered" in w
        ]
        assert (
            len(chart_data_warnings) == 0
        ), f"Should not flag triggered action, got: {chart_data_warnings}"

    @pytest.mark.unit
    def test_no_false_positive_for_dataset_or_handler_data(self):
        """Charts using dataset.X or handler.X should produce zero data-source warnings."""
        for data_ref in ("dataset.stats", "handler.getStats"):
            config = _make_config(chart_data=data_ref, actions={}, state={}, handlers=[])
            validator = CrossValidator()
            warnings = validator.validate_and_fix(config)

            data_warnings = [
                w for w in warnings if "data=" in w and ("state." in w or "never triggered" in w)
            ]
            assert (
                len(data_warnings) == 0
            ), f"data='{data_ref}' should not produce warnings, got: {data_warnings}"


class TestAutoFixChartHandlerData:
    """Tests for _fix_chart_handler_data_source auto-fix."""

    @pytest.mark.unit
    def test_auto_fix_rewrites_state_to_handler(self):
        """state.X.field should be rewritten to handler.Y.field when mapping exists."""
        config = _make_config(
            chart_data="state.revenueTrendData.trend_data",
            actions={
                "loadRevenue": [
                    {
                        "api": {
                            "type": "handler",
                            "handler": "getRevenueTrends",
                            "resultField": "revenueTrendData",
                        }
                    }
                ]
            },
            state={"revenueTrendData": None},
            handlers=[{"name": "getRevenueTrends", "method": "getRevenueTrends"}],
        )
        validator = CrossValidator()
        warnings = validator.validate_and_fix(config)

        chart = config["frontend"]["pages"][0]["sections"][0]["content"][0]
        assert chart["data"] == "handler.getRevenueTrends.trend_data"

        fix_warnings = [w for w in warnings if "Auto-fix" in w and "handler.getRevenueTrends" in w]
        assert len(fix_warnings) >= 1

    @pytest.mark.unit
    def test_auto_fix_with_run_9_pattern(self):
        """Reproduce the run_9 pattern: two charts with state.X, both auto-fixed."""
        config = _make_config(
            chart_data="state.revenueTrendData.trend_data",
            actions={
                "loadRevenueTrends": [
                    {
                        "api": {
                            "type": "handler",
                            "handler": "getRevenueTrends",
                            "resultField": "revenueTrendData",
                        }
                    }
                ],
                "loadProductPerformance": [
                    {
                        "api": {
                            "type": "handler",
                            "handler": "getProductPerformance",
                            "resultField": "productPerformanceData",
                        }
                    }
                ],
            },
            state={"revenueTrendData": None, "productPerformanceData": None},
            handlers=[
                {"name": "getRevenueTrends", "method": "getRevenueTrends"},
                {"name": "getProductPerformance", "method": "getProductPerformance"},
            ],
        )

        second_chart = {
            "componentType": "ChartProps",
            "uuid": "chart-2",
            "data": "state.productPerformanceData.performance_data",
            "type": "donut",
        }
        config["frontend"]["pages"][0]["sections"][0]["content"].append(second_chart)

        validator = CrossValidator()
        validator.validate_and_fix(config)

        charts = config["frontend"]["pages"][0]["sections"][0]["content"]
        assert charts[0]["data"] == "handler.getRevenueTrends.trend_data"
        assert charts[1]["data"] == "handler.getProductPerformance.performance_data"


class TestUntriggeredHandlerActions:
    """Tests for _check_untriggered_handler_actions."""

    @pytest.mark.unit
    def test_detects_untriggered_handler_action(self):
        """Action calling a handler but never triggered should produce a warning."""
        config = _make_config(chart_data="dataset.stats")
        config["frontend"]["logic"]["actions"] = {
            "fetchReport": [
                {
                    "api": {
                        "type": "handler",
                        "handler": "generateReport",
                    }
                }
            ]
        }
        config["backend"]["handlers"] = [{"name": "generateReport"}]

        validator = CrossValidator()
        warnings = validator.validate_and_fix(config)

        untriggered = [w for w in warnings if "fetchReport" in w and "never triggered" in w]
        assert len(untriggered) >= 1, f"Expected untriggered warning, got: {warnings}"

    @pytest.mark.unit
    def test_transitively_triggered_actions_not_flagged(self):
        """Action dispatched by another triggered action should NOT be flagged."""
        config = _make_config(
            chart_data="dataset.stats",
            button_action="updateFilter",
        )
        config["frontend"]["logic"]["actions"] = {
            "updateFilter": [
                {"set": "filter", "to": "$payload"},
                {"action": "loadRevenueData"},
            ],
            "loadRevenueData": [
                {
                    "api": {
                        "type": "handler",
                        "handler": "getRevenueTrends",
                        "resultField": "revenueTrends",
                    }
                }
            ],
        }
        config["frontend"]["logic"]["state"] = {"filter": "all", "revenueTrends": []}
        config["backend"]["handlers"] = [{"name": "getRevenueTrends"}]

        validator = CrossValidator()
        warnings = validator.validate_and_fix(config)

        flagged = [w for w in warnings if "loadRevenueData" in w and "never triggered" in w]
        assert (
            len(flagged) == 0
        ), f"Transitively triggered action should not be flagged, got: {flagged}"
