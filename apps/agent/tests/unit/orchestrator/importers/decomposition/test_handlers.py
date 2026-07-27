"""Tests for handler dispatch + the Stitch handler's tailwind-config parse.

The async parts of each handler (artifact loading) are covered by the
runner integration test. Here we verify dispatch correctness, single-
canvas rejection, and the Stitch tailwind-config flatten.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
    HandlerError,
    select_handler,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.stitch import (
    _flatten_colors,
)


def test_select_handler_claude_design_multi_page():
    handler = select_handler({"skill_name": "claude-design-importer", "mode": "multi_page"})
    assert handler.format == "claude_design"


def test_select_handler_claude_design_default_mode_ok():
    """When mode is missing, dispatcher accepts (multi-page is the only mode)."""
    handler = select_handler({"skill_name": "claude-design-importer"})
    assert handler.format == "claude_design"


def test_select_handler_claude_design_single_canvas_rejected():
    with pytest.raises(HandlerError, match="single-canvas.*obsolete"):
        select_handler({"skill_name": "claude-design-importer", "mode": "single_canvas"})


def test_select_handler_stitch():
    handler = select_handler({"skill_name": "stitch-importer"})
    assert handler.format == "stitch"


def test_select_handler_unknown_rejected():
    with pytest.raises(HandlerError, match="Unknown"):
        select_handler({"skill_name": "something_made_up"})


def test_select_handler_empty_context_rejected():
    with pytest.raises(HandlerError):
        select_handler({})


# ── Stitch helper: flatten colors ─────────────────────────────────────────


def test_flatten_colors_flat():
    out = _flatten_colors({"primary": "#aa0000", "surface": "#fff"})
    assert out == {"primary": "#aa0000", "surface": "#fff"}


def test_flatten_colors_nested():
    out = _flatten_colors({"surface": {"container": {"low": "#f0f0f0", "high": "#222"}}})
    assert out == {"surface-container-low": "#f0f0f0", "surface-container-high": "#222"}


def test_flatten_colors_mixed():
    out = _flatten_colors({"primary": "#aaa", "surface": {"container": "#bbb"}})
    assert out == {"primary": "#aaa", "surface-container": "#bbb"}


# ── Stitch tailwind-config parse on real fixture ──────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[7]
STITCH_HOME = (
    REPO_ROOT
    / "packages"
    / "design-tools-fixtures"
    / "stitch"
    / "stitch_contact_us_happydoods_farm"
    / "home_happydoods_farm"
    / "code.html"
)


@pytest.mark.skipif(
    not STITCH_HOME.exists(),
    reason=f"fixture missing: {STITCH_HOME}",
)
def test_stitch_handler_parse_tailwind_config_against_real_fixture():
    """Verify the Stitch handler's parse_tailwind_config + flatten path
    surfaces real tokens from the fixture as ``--color-*`` entries."""
    from main_agent.agents.orchestrator.importers.tools.html_utils import (
        parse_tailwind_config,
    )

    html = STITCH_HOME.read_text()
    config = parse_tailwind_config(html)
    assert config is not None, "tailwind-config not parseable"
    colors = ((config.get("theme") or {}).get("extend") or {}).get("colors") or {}
    flat = _flatten_colors(colors)
    # Real tokens we expect in the happydoods Stitch fixture:
    assert "primary" in flat or "primary-container" in flat
    assert "surface" in flat
    # Every value is a hex color string — sanity check.
    for name, value in flat.items():
        assert isinstance(value, str), f"non-string color value for {name}"
        assert value.startswith("#"), f"unexpected color format for {name}: {value}"
