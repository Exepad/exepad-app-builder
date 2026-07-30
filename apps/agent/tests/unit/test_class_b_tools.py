"""Tests for the 5 Class B Surveyor tool wrappers.

Each tool delegates to ``RuntimeProbeClient`` and appends one record to
``runtime_probe_log`` in session state. These tests stub the client to
exercise the wrapper code (app_id resolution, telemetry recording,
error short-circuit) without making any network call.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from main_agent.constants import StateKeys


def _stub_tool_context(
    state: dict | None = None, session_id: str = "sess-1"
) -> MagicMock:
    ctx = MagicMock()
    ctx.state = state if state is not None else {}
    ctx.session = MagicMock()
    ctx.session.id = session_id
    return ctx


@pytest.fixture
def fake_client():
    """Patch RuntimeProbeClient where the tool wrappers import it."""
    with patch(
        "main_agent.services.runtime_probe_client.RuntimeProbeClient"
    ) as cls:
        instance = MagicMock()
        instance.execute_handler = AsyncMock()
        instance.query_db = AsyncMock()
        instance.sample_table = AsyncMock()
        instance.inspect = AsyncMock()
        cls.return_value = instance
        yield instance


@pytest.mark.asyncio
async def test_execute_handler_records_probe(fake_client):
    from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor_tools import (
        execute_handler_tool_impl,
    )

    fake_client.execute_handler.return_value = {
        "status": 200,
        "duration_ms": 87,
        "response": {"ok": True},
    }
    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})

    result = await execute_handler_tool_impl(
        ctx, handler_name="getOccupancyTrend", params={"days": 30}
    )

    assert result["status"] == 200
    fake_client.execute_handler.assert_called_once_with(
        "appA", handler_name="getOccupancyTrend", params={"days": 30}, as_user=None
    )
    log = ctx.state["runtime_probe_log"]
    assert len(log) == 1
    assert log[0]["tool"] == "execute_handler_tool"
    assert log[0]["duration_ms"] == 87
    assert "error" not in log[0]


@pytest.mark.asyncio
async def test_execute_handler_records_error(fake_client):
    from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor_tools import (
        execute_handler_tool_impl,
    )

    fake_client.execute_handler.return_value = {
        "error": "http_500",
        "message": "boom",
    }
    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})

    result = await execute_handler_tool_impl(ctx, handler_name="x")
    assert result["error"] == "http_500"
    log = ctx.state["runtime_probe_log"]
    assert log[0]["error"] == "http_500"


@pytest.mark.asyncio
async def test_no_app_uuid_short_circuits(fake_client):
    """Short-circuit on missing app_id MUST NOT make a probe call AND MUST
    NOT record a telemetry entry — the LLM made a tool call that didn't
    cost anything, so the cost log stays empty for it."""
    from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor_tools import (
        execute_handler_tool_impl,
        query_db_tool_impl,
        sample_table_tool_impl,
        screenshot_preview_tool_impl,
        read_browser_state_tool_impl,
    )

    ctx = _stub_tool_context({})  # no APP_UUID
    for impl in [
        lambda c: execute_handler_tool_impl(c, handler_name="x"),
        lambda c: query_db_tool_impl(c, sql="SELECT 1"),
        lambda c: sample_table_tool_impl(c, name="t"),
        lambda c: screenshot_preview_tool_impl(c),
        lambda c: read_browser_state_tool_impl(c),
    ]:
        result = await impl(ctx)
        assert result == {"error": "no_app_uuid_in_state"}
    fake_client.execute_handler.assert_not_called()
    fake_client.query_db.assert_not_called()
    fake_client.sample_table.assert_not_called()
    fake_client.inspect.assert_not_called()
    assert "runtime_probe_log" not in ctx.state


@pytest.mark.asyncio
async def test_query_db_records_probe(fake_client):
    from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor_tools import (
        query_db_tool_impl,
    )

    fake_client.query_db.return_value = {
        "rows": [{"n": 42}],
        "row_count": 1,
        "duration_ms": 12,
    }
    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})

    result = await query_db_tool_impl(ctx, sql="SELECT COUNT(*) AS n FROM t")
    assert result["row_count"] == 1
    log = ctx.state["runtime_probe_log"]
    assert log[0]["tool"] == "query_db_tool"
    assert log[0]["duration_ms"] == 12


@pytest.mark.asyncio
async def test_read_browser_state_flattens_dom(fake_client):
    from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor_tools import (
        read_browser_state_tool_impl,
    )

    fake_client.inspect.return_value = {
        "dom": {
            "text_content": "Hello",
            "computed_styles": {"color": "rgb(0,0,0)"},
            "attributes": {"id": "x"},
        },
        "page_errors": ["TypeError: foo"],
        "failed_requests": [{"url": "/api/missing", "status": 404}],
        "duration_ms": 800,
    }
    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})

    result = await read_browser_state_tool_impl(ctx, path="/dashboard", selector="#root")
    assert result["text_content"] == "Hello"
    assert result["computed_styles"]["color"] == "rgb(0,0,0)"
    assert result["attributes"]["id"] == "x"
    assert result["page_errors"] == ["TypeError: foo"]

    fake_client.inspect.assert_called_once()
    kwargs = fake_client.inspect.call_args.kwargs
    assert kwargs["path"] == "/dashboard"
    assert kwargs["selector"] == "#root"
    assert kwargs["want_screenshot"] is False

    log = ctx.state["runtime_probe_log"]
    assert log[0]["tool"] == "read_browser_state_tool"
    assert log[0]["duration_ms"] == 800


@pytest.mark.asyncio
async def test_screenshot_capture_succeeds_but_storage_unavailable(fake_client):
    """Self-host has no object store to host the PNG in (the GCS upload +
    signed-URL path was removed), so even a successful capture returns a
    ``screenshot_storage_unavailable`` result with capture metadata."""
    import base64

    from main_agent.agents.orchestrator.app_types.webapp.subagents import surveyor_tools

    png_bytes = b"\x89PNG\r\n\x1a\nfake"
    inspect_response = {
        "png_b64": base64.b64encode(png_bytes).decode("ascii"),
        "page_errors": [],
        "failed_requests": [],
        "duration_ms": 900,
    }

    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"}, session_id="sess-1")

    with patch.object(
        surveyor_tools, "_capture_browser_state", AsyncMock(return_value=inspect_response)
    ):
        result = await surveyor_tools.screenshot_preview_tool_impl(
            ctx, path="/", viewport={"width": 800, "height": 600}
        )

    assert result["error"] == "screenshot_storage_unavailable"
    assert result["byte_size"] == len(png_bytes)
    assert "url" not in result
    log = ctx.state["runtime_probe_log"]
    assert log[0]["tool"] == "screenshot_preview_tool"
    assert log[0]["byte_size"] == len(png_bytes)


@pytest.mark.asyncio
async def test_screenshot_records_probe_error(fake_client):
    """An inspect-level error MUST be recorded (a probe was attempted) —
    contrast with no_app_uuid which records nothing."""
    from main_agent.agents.orchestrator.app_types.webapp.subagents import surveyor_tools

    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})
    err = {"error": "browser_busy", "retry_after_ms": 5000}

    with patch.object(
        surveyor_tools, "_capture_browser_state", AsyncMock(return_value=err)
    ):
        result = await surveyor_tools.screenshot_preview_tool_impl(ctx)

    assert result == err
    log = ctx.state["runtime_probe_log"]
    assert log[0]["tool"] == "screenshot_preview_tool"
    assert log[0]["error"] == "browser_busy"


@pytest.mark.asyncio
async def test_screenshot_handles_missing_png_in_response(fake_client):
    """If the worker returned 200 but no png_b64 (e.g. browser ran but
    screenshot failed), record a structured error and don't crash."""
    from main_agent.agents.orchestrator.app_types.webapp.subagents import surveyor_tools

    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})
    response_without_png = {
        "png_b64": None,
        "duration_ms": 700,
        "page_errors": [],
        "failed_requests": [],
    }

    with patch.object(
        surveyor_tools, "_capture_browser_state",
        AsyncMock(return_value=response_without_png),
    ):
        result = await surveyor_tools.screenshot_preview_tool_impl(ctx)

    assert result["error"] == "no_screenshot_returned"
    assert result["duration_ms"] == 700
    log = ctx.state["runtime_probe_log"]
    assert log[0]["tool"] == "screenshot_preview_tool"
    assert log[0]["error"] == "no_screenshot_returned"


@pytest.mark.asyncio
async def test_telemetry_log_grows_across_multiple_probes(fake_client):
    """Verify several probes accumulate in the same session log — the
    timing_tracker reads this in aggregate."""
    from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor_tools import (
        execute_handler_tool_impl,
        query_db_tool_impl,
    )

    fake_client.execute_handler.return_value = {"status": 200, "duration_ms": 50}
    fake_client.query_db.return_value = {"rows": [], "row_count": 0, "duration_ms": 8}
    ctx = _stub_tool_context({StateKeys.APP_UUID: "appA"})

    await execute_handler_tool_impl(ctx, handler_name="h1")
    await query_db_tool_impl(ctx, sql="SELECT 1")
    await execute_handler_tool_impl(ctx, handler_name="h2")

    log = ctx.state["runtime_probe_log"]
    assert len(log) == 3
    tools = [e["tool"] for e in log]
    assert tools == [
        "execute_handler_tool",
        "query_db_tool",
        "execute_handler_tool",
    ]
