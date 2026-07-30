"""Tests for ``code_revision_diff_tool`` (Class A — always on).

Cross-revision history lived in the cloud object store (versioned blobs per
upload). Self-host has no durable revision store — the agent receives only the
current sources inline each edit turn — so the tool reports no prior revisions.
The Surveyor treats ``has_revisions: False`` as "nothing to diff" and proceeds.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from main_agent.constants import StateKeys
from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor_tools import (
    code_revision_diff_tool_impl,
)


def _stub_tool_context(state: dict) -> MagicMock:
    ctx = MagicMock()
    ctx.state = state
    return ctx


@pytest.mark.asyncio
async def test_unknown_kind_returns_error():
    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})
    result = await code_revision_diff_tool_impl(ctx, kind="invalid", name="foo")
    assert result["has_revisions"] is False
    assert "unknown_kind" in result["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["handler", "component", "seed"])
async def test_known_kind_reports_no_revisions_in_selfhost(kind):
    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})
    result = await code_revision_diff_tool_impl(ctx, kind=kind, name="foo")
    assert result["has_revisions"] is False
    assert result["name"] == "foo"
    assert result["file_kind"] == kind
    assert result["note"] == "revision_history_unavailable_selfhost"


@pytest.mark.asyncio
async def test_max_revisions_back_param_is_accepted():
    """The param is kept for signature compatibility; it must not error."""
    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})
    result = await code_revision_diff_tool_impl(ctx, kind="handler", name="h", max_revisions_back=3)
    assert result["has_revisions"] is False
