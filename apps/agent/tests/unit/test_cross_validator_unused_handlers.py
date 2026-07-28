"""
Regression test: CrossValidator._check_unused_handlers must NOT fire for
Code Focus apps.

Code Focus components call handlers directly via `useHandler(name)` in TSX,
not through `frontend.logic.actions`. Running the legacy action-based
unused-handler check against a Code Focus app produces false positives for
every single handler. Fix 4 skips the check when a Code Focus repo is
present.
"""

import pytest

from main_agent.agents.orchestrator.app_types.shared.services.cross_validator import (
    CrossValidator,
)

pytestmark = [pytest.mark.unit]


def _base_config_with_handler() -> dict:
    return {
        "frontend": {
            "logic": {
                "state": {},
                "actions": {},  # no actions — legacy check would fire
                "computed": {},
            },
            "pages": [],
        },
        "backend": {
            "models": [{"name": "walkers"}],
            "handlers": [{"name": "getDashboardStats", "method": "getDashboardStats"}],
        },
    }


def test_code_focus_app_skips_unused_handler_warning():
    config = _base_config_with_handler()
    # Code Focus apps populate the repo block with generated component TSX.
    config["repo"] = {
        "frontend": {
            "components": {
                "DashboardContent": {"source": "/* TSX that calls useHandler */"},
            },
        },
    }

    warnings = CrossValidator().validate_and_fix(config)
    unused = [w for w in warnings if "defined but never called by any action" in w]
    assert unused == [], f"expected no unused-handler warnings for Code Focus, got: {unused}"


def test_legacy_app_still_flags_unused_handler():
    config = _base_config_with_handler()
    # No repo.frontend.components → legacy action-based app. The existing
    # check should still fire.
    warnings = CrossValidator().validate_and_fix(config)
    unused = [w for w in warnings if "defined but never called by any action" in w]
    assert len(unused) == 1
    assert "getDashboardStats" in unused[0]
