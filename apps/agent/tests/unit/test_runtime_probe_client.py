"""Tests for ``RuntimeProbeClient``.

Verifies the agent-side wrapper around ``/api/{appId}/_diag/*``:
* PLATFORM_DIAGNOSTIC_SECRET is required (no silent 401)
* HTTP status codes are surfaced as ``{error: 'http_NNN'}``
* Network/timeout errors return structured dicts (never raise)
* Each public method hits the right endpoint with the right body
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest


@pytest.fixture
def fake_secret(monkeypatch):
    """Provide a stable PLATFORM_DIAGNOSTIC_SECRET for the test session."""
    monkeypatch.setenv("PLATFORM_DIAGNOSTIC_SECRET", "test-secret")
    monkeypatch.setenv("EXEPAD_RUNTIME_BASE", "https://example.test")
    yield "test-secret"


def _mock_async_client(response_status: int, response_json=None, response_text=""):
    """Build a context-manager AsyncClient mock whose request() returns
    a stub Response."""
    response = MagicMock(spec=httpx.Response)
    response.status_code = response_status
    response.text = response_text
    if response_json is not None:
        response.json = MagicMock(return_value=response_json)
    else:
        response.json = MagicMock(side_effect=ValueError("no body"))

    client_mock = MagicMock()
    client_mock.request = AsyncMock(return_value=response)

    @asynccontextmanager
    async def fake_ctx(*args, **kwargs):
        yield client_mock

    return fake_ctx, client_mock


def _import_client():
    """Defer import so monkeypatched env vars are visible at module load."""
    from main_agent.services.runtime_probe_client import RuntimeProbeClient

    return RuntimeProbeClient


@pytest.mark.asyncio
async def test_refuses_to_call_without_secret(monkeypatch):
    """No PLATFORM_DIAGNOSTIC_SECRET → no probe attempt; structured error."""
    monkeypatch.delenv("PLATFORM_DIAGNOSTIC_SECRET", raising=False)
    RuntimeProbeClient = _import_client()
    client = RuntimeProbeClient(secret="")  # explicitly empty
    result = await client.execute_handler("app1", "myHandler")
    assert result["error"] == "no_diagnostic_secret"


@pytest.mark.asyncio
async def test_execute_handler_success(fake_secret):
    RuntimeProbeClient = _import_client()
    fake_ctx, client_mock = _mock_async_client(
        200, response_json={"status": 200, "duration_ms": 87, "response": {"ok": True}}
    )
    with patch("httpx.AsyncClient", side_effect=fake_ctx):
        client = RuntimeProbeClient()
        result = await client.execute_handler(
            "app1", "myHandler", params={"days": 30}, as_user="user-42"
        )

    assert result["status"] == 200
    assert result["response"]["ok"] is True
    # Verify URL + headers + body composition
    call_args = client_mock.request.call_args
    assert call_args.args[0] == "POST"
    assert call_args.args[1] == "https://example.test/api/app1/_diag/execute_handler"
    assert call_args.kwargs["headers"]["X-Diagnostic-Secret"] == "test-secret"
    body = call_args.kwargs["json"]
    assert body["handler_name"] == "myHandler"
    assert body["params"] == {"days": 30}
    assert body["as_user"] == "user-42"


@pytest.mark.asyncio
async def test_query_db_success(fake_secret):
    RuntimeProbeClient = _import_client()
    fake_ctx, client_mock = _mock_async_client(
        200, response_json={"rows": [{"n": 42}], "row_count": 1, "duration_ms": 12}
    )
    with patch("httpx.AsyncClient", side_effect=fake_ctx):
        client = RuntimeProbeClient()
        result = await client.query_db("app1", sql="SELECT COUNT(*) AS n FROM t")
    assert result["row_count"] == 1
    body = client_mock.request.call_args.kwargs["json"]
    assert body == {"sql": "SELECT COUNT(*) AS n FROM t"}


@pytest.mark.asyncio
async def test_sample_table_uses_get(fake_secret):
    RuntimeProbeClient = _import_client()
    fake_ctx, client_mock = _mock_async_client(
        200, response_json={"rows": [], "row_count": 0, "duration_ms": 5}
    )
    with patch("httpx.AsyncClient", side_effect=fake_ctx):
        client = RuntimeProbeClient()
        await client.sample_table("app1", name="users", limit=5)
    call = client_mock.request.call_args
    assert call.args[0] == "GET"
    assert call.args[1] == "https://example.test/api/app1/_diag/sample_table?name=users&limit=5"
    assert call.kwargs.get("json") is None


@pytest.mark.asyncio
async def test_inspect_omits_optional_fields_when_none(fake_secret):
    """``inspect`` should send only the fields the caller actually set —
    sending ``selector: null`` would force the worker to skip DOM
    capture even when the caller didn't intend that."""
    RuntimeProbeClient = _import_client()
    fake_ctx, client_mock = _mock_async_client(
        200, response_json={"png_b64": None, "dom": {}, "duration_ms": 100}
    )
    with patch("httpx.AsyncClient", side_effect=fake_ctx):
        client = RuntimeProbeClient()
        await client.inspect("app1", path="/dashboard", want_screenshot=True)
    body = client_mock.request.call_args.kwargs["json"]
    assert body["path"] == "/dashboard"
    assert body["wantScreenshot"] is True
    assert "selector" not in body
    assert "viewport" not in body


@pytest.mark.asyncio
async def test_http_500_returns_structured_error(fake_secret):
    RuntimeProbeClient = _import_client()
    fake_ctx, _ = _mock_async_client(500, response_text="server crash")
    with patch("httpx.AsyncClient", side_effect=fake_ctx):
        client = RuntimeProbeClient()
        result = await client.query_db("app1", "SELECT 1")
    assert result["error"] == "http_500"
    assert "server crash" in result["message"]


@pytest.mark.asyncio
async def test_timeout_returns_structured_error(fake_secret):
    RuntimeProbeClient = _import_client()

    @asynccontextmanager
    async def fake_ctx(*args, **kwargs):
        client_mock = MagicMock()
        client_mock.request = AsyncMock(side_effect=httpx.TimeoutException("slow"))
        yield client_mock

    with patch("httpx.AsyncClient", side_effect=fake_ctx):
        client = RuntimeProbeClient()
        result = await client.query_db("app1", "SELECT 1")
    assert result == {"error": "timeout"}


@pytest.mark.asyncio
async def test_network_error_returns_structured_error(fake_secret):
    RuntimeProbeClient = _import_client()

    @asynccontextmanager
    async def fake_ctx(*args, **kwargs):
        client_mock = MagicMock()
        client_mock.request = AsyncMock(
            side_effect=httpx.ConnectError("DNS failure")
        )
        yield client_mock

    with patch("httpx.AsyncClient", side_effect=fake_ctx):
        client = RuntimeProbeClient()
        result = await client.query_db("app1", "SELECT 1")
    assert result["error"] == "network"
    assert "DNS failure" in result["message"]


@pytest.mark.asyncio
async def test_invalid_json_response(fake_secret):
    RuntimeProbeClient = _import_client()
    fake_ctx, _ = _mock_async_client(200, response_json=None, response_text="not json")
    with patch("httpx.AsyncClient", side_effect=fake_ctx):
        client = RuntimeProbeClient()
        result = await client.query_db("app1", "SELECT 1")
    assert result["error"] == "invalid_response_json"
