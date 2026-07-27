"""Unit tests for the design-import jsx_to_tsx dispatcher.

Covers the HTML-fallback path: a component_plan that carries only
``source_html_artifact`` (no ``source_jsx_modules``) — the dominant
shape for Stitch bundles and chrome regions on any source — must
flow through ``transform_html_to_tsx`` and produce a saved
``codefocus_component:<Name>.tsx`` artifact.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from main_agent.agents.orchestrator.importers.tools.jsx_to_tsx.dispatcher import (
    translate_design_import_components,
)

pytestmark = [pytest.mark.unit, pytest.mark.asyncio]


def _fake_ctx():
    artifact_service = SimpleNamespace(save_artifact=AsyncMock(return_value=1))
    session = SimpleNamespace(id="s1", user_id="u1", app_name="test-app", state={})
    return SimpleNamespace(
        artifact_service=artifact_service,
        session=session,
    )


@pytest.fixture(autouse=True)
def _stub_push_session_state_update(monkeypatch):
    """push_session_state_update writes via session_service.append_event,
    which we don't have in unit tests. Replace it with a direct
    ctx.session.state update so callers still observe the merged
    payload."""

    async def _direct(ctx_, payload):
        ctx_.session.state.update(payload)

    monkeypatch.setattr(
        "main_agent.agents.orchestrator.importers.tools.jsx_to_tsx."
        "dispatcher.push_session_state_update",
        _direct,
    )


_STITCH_PAGE_HTML = """\
<div class="flex flex-col gap-4 p-6">
  <h1 class="text-2xl font-bold">Dashboard</h1>
  <p class="text-sm text-gray-600">Welcome back.</p>
</div>
"""


async def test_html_fallback_translates_stitch_content_page(monkeypatch):
    """A Stitch content entry with only `source_html_artifact` should
    flow through transform_html_to_tsx and save a TSX artifact."""
    ctx = _fake_ctx()

    monkeypatch.setattr(
        "main_agent.agents.orchestrator.importers.tools.jsx_to_tsx."
        "dispatcher.ArtifactManager.load_artifact_as_string",
        AsyncMock(return_value=_STITCH_PAGE_HTML),
    )

    creator_plan = {
        "component_plans": [
            {
                "name": "DashboardOverview",
                "role": "content",
                "page_slug": "/",
                "source_html_artifact": "content_dashboard_page.html",
            }
        ]
    }

    out = await translate_design_import_components(ctx, creator_plan)

    assert len(out) == 1
    translated = out[0]
    assert translated.name == "DashboardOverview"
    assert translated.role == "content"
    assert translated.entry_tsx, "HTML fallback should produce non-empty TSX"

    # Saved as codefocus_component:<Name>.tsx
    saved = ctx.artifact_service.save_artifact.call_args_list
    assert len(saved) == 1
    assert saved[0].kwargs["filename"] == "codefocus_component:DashboardOverview.tsx"
    assert saved[0].kwargs["session_id"] == "s1"
    assert saved[0].kwargs["user_id"] == "u1"
    assert saved[0].kwargs["app_name"] == "test-app"


async def test_html_fallback_translates_chrome_region(monkeypatch):
    """Chrome regions (header/sidebar/footer) hit the same path."""
    ctx = _fake_ctx()

    monkeypatch.setattr(
        "main_agent.agents.orchestrator.importers.tools.jsx_to_tsx."
        "dispatcher.ArtifactManager.load_artifact_as_string",
        AsyncMock(return_value="<nav class='flex'><a href='/'>Home</a></nav>"),
    )

    creator_plan = {
        "component_plans": [
            {
                "name": "MainSidebar",
                "role": "sidebar",
                "page_slug": None,
                "source_html_artifact": "content_main_sidebar.html",
            }
        ]
    }

    out = await translate_design_import_components(ctx, creator_plan)

    assert len(out) == 1
    assert out[0].role == "sidebar"
    assert out[0].entry_tsx
    assert (
        ctx.artifact_service.save_artifact.call_args.kwargs["filename"]
        == "codefocus_component:MainSidebar.tsx"
    )


async def test_no_jsx_modules_and_no_html_artifact_returns_empty(monkeypatch):
    """When neither path applies, return an empty entry and log a warning."""
    ctx = _fake_ctx()

    creator_plan = {
        "component_plans": [
            {
                "name": "Mystery",
                "role": "content",
                "page_slug": "/x",
                # no source_jsx_modules, no source_html_artifact
            }
        ]
    }

    out = await translate_design_import_components(ctx, creator_plan)

    assert len(out) == 1
    assert out[0].entry_tsx == ""
    ctx.artifact_service.save_artifact.assert_not_called()


async def test_sibling_modules_state_merged(monkeypatch):
    """The HTML-fallback TSX must be merged into _codefocus_sibling_modules
    so the downstream tsc gate sees the new component."""
    ctx = _fake_ctx()

    monkeypatch.setattr(
        "main_agent.agents.orchestrator.importers.tools.jsx_to_tsx."
        "dispatcher.ArtifactManager.load_artifact_as_string",
        AsyncMock(return_value=_STITCH_PAGE_HTML),
    )

    creator_plan = {
        "component_plans": [
            {
                "name": "DashboardOverview",
                "role": "content",
                "page_slug": "/",
                "source_html_artifact": "content_dashboard_page.html",
            }
        ]
    }

    await translate_design_import_components(ctx, creator_plan)

    siblings = ctx.session.state.get("_codefocus_sibling_modules") or {}
    assert "DashboardOverview" in siblings
    assert siblings["DashboardOverview"].strip(), "merged TSX must be non-empty"
