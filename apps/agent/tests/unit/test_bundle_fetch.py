"""Tests for the agent-side DesignBundle manifest fetcher.

`fetch_bundle_manifest` is the thin async helper that calls the Django
internal endpoint `GET /api/agent/design-bundles/<uuid>/manifest/` so the
DesignImporter can access its bundle manifest across the service boundary.

The helper MUST return `None` (not raise) on every failure mode so that a
transient backend hiccup doesn't break the entire creation workflow. These
tests lock that contract in.
"""

from __future__ import annotations

import os
from unittest.mock import MagicMock, patch

import httpx
import pytest

from main_agent.agents.orchestrator.importers.bundle_fetch import (
    fetch_bundle_manifest,
)

pytestmark = [pytest.mark.unit]


# ── Helpers ───────────────────────────────────────────────────────────────


def _mock_response(status_code: int = 200, json_value=None):
    """Build a minimal stand-in for an httpx.Response returned by .get()."""
    mock = MagicMock(spec=httpx.Response)
    mock.status_code = status_code
    if json_value is not None:
        mock.json.return_value = json_value
    else:
        mock.json.side_effect = ValueError("no json")
    return mock


class _FakeAsyncClient:
    """Minimal async-context-manager that mimics httpx.AsyncClient.

    Returns the response we inject per-test. We don't need every method on
    httpx.AsyncClient — only `get()` is called by fetch_bundle_manifest.
    """

    def __init__(self, response):
        self._response = response
        self.last_url = None
        self.last_headers = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def get(self, url, headers=None):
        self.last_url = url
        self.last_headers = headers or {}
        if isinstance(self._response, Exception):
            raise self._response
        return self._response


# ── Happy path ────────────────────────────────────────────────────────────


class TestHappyPath:
    @pytest.mark.asyncio
    async def test_returns_payload_dict_on_200(self):
        payload = {
            "uuid": "abc",
            "source": "stitch",
            "storage_prefix": "design-bundles/abc/",
            "manifest": {
                "schema_version": 1,
                "source": "stitch",
                "html_files": [],
                "css_files": [],
                "js_files": [],
                "other_helpers": [],
                "asset_refs": {},
                "metadata": {},
            },
            "created_at": "2026-04-22T00:00:00+00:00",
        }
        response = _mock_response(200, payload)
        fake = _FakeAsyncClient(response)

        with (
            patch.dict(os.environ, {"DJANGO_BACKEND_URL": "https://backend.example"}),
            patch(
                "main_agent.agents.orchestrator.importers.bundle_fetch.httpx.AsyncClient",
                return_value=fake,
            ),
        ):
            result = await fetch_bundle_manifest("abc")

        assert result is not None
        assert result["uuid"] == "abc"
        assert result["source"] == "stitch"
        assert "manifest" in result and isinstance(result["manifest"], dict)
        # URL was constructed correctly.
        assert fake.last_url == "https://backend.example/api/agent/design-bundles/abc/manifest/"


# ── Failure modes ─────────────────────────────────────────────────────────


class TestFailureModes:
    @pytest.mark.asyncio
    async def test_no_backend_url_returns_none(self):
        with patch.dict(os.environ, {}, clear=False):
            # Ensure DJANGO_BACKEND_URL is unset.
            os.environ.pop("DJANGO_BACKEND_URL", None)
            result = await fetch_bundle_manifest("abc")
        assert result is None

    @pytest.mark.asyncio
    async def test_empty_bundle_uuid_returns_none(self):
        result = await fetch_bundle_manifest("")
        assert result is None

    @pytest.mark.asyncio
    async def test_404_returns_none(self):
        response = _mock_response(404, {"error": "not found"})
        fake = _FakeAsyncClient(response)
        with (
            patch.dict(os.environ, {"DJANGO_BACKEND_URL": "https://x"}),
            patch(
                "main_agent.agents.orchestrator.importers.bundle_fetch.httpx.AsyncClient",
                return_value=fake,
            ),
        ):
            result = await fetch_bundle_manifest("abc")
        assert result is None

    @pytest.mark.asyncio
    async def test_500_returns_none(self):
        response = _mock_response(500, {"error": "boom"})
        fake = _FakeAsyncClient(response)
        with (
            patch.dict(os.environ, {"DJANGO_BACKEND_URL": "https://x"}),
            patch(
                "main_agent.agents.orchestrator.importers.bundle_fetch.httpx.AsyncClient",
                return_value=fake,
            ),
        ):
            result = await fetch_bundle_manifest("abc")
        assert result is None

    @pytest.mark.asyncio
    async def test_http_error_returns_none(self):
        """Transport errors (connection refused, DNS, etc.) degrade gracefully."""
        fake = _FakeAsyncClient(httpx.ConnectError("connection refused"))
        with (
            patch.dict(os.environ, {"DJANGO_BACKEND_URL": "https://x"}),
            patch(
                "main_agent.agents.orchestrator.importers.bundle_fetch.httpx.AsyncClient",
                return_value=fake,
            ),
        ):
            result = await fetch_bundle_manifest("abc")
        assert result is None

    @pytest.mark.asyncio
    async def test_invalid_json_returns_none(self):
        response = _mock_response(200, None)  # json() raises ValueError
        fake = _FakeAsyncClient(response)
        with (
            patch.dict(os.environ, {"DJANGO_BACKEND_URL": "https://x"}),
            patch(
                "main_agent.agents.orchestrator.importers.bundle_fetch.httpx.AsyncClient",
                return_value=fake,
            ),
        ):
            result = await fetch_bundle_manifest("abc")
        assert result is None

    @pytest.mark.asyncio
    async def test_missing_manifest_key_returns_none(self):
        """Shape drift — response is valid JSON but missing required keys."""
        response = _mock_response(200, {"uuid": "abc"})
        fake = _FakeAsyncClient(response)
        with (
            patch.dict(os.environ, {"DJANGO_BACKEND_URL": "https://x"}),
            patch(
                "main_agent.agents.orchestrator.importers.bundle_fetch.httpx.AsyncClient",
                return_value=fake,
            ),
        ):
            result = await fetch_bundle_manifest("abc")
        assert result is None


# ── Auth headers ──────────────────────────────────────────────────────────


class TestAuthHeaders:
    @pytest.mark.asyncio
    async def test_dev_uses_api_key(self):
        response = _mock_response(200, {"manifest": {}, "uuid": "abc", "source": "stitch"})
        fake = _FakeAsyncClient(response)
        with (
            patch.dict(
                os.environ,
                {
                    "DJANGO_BACKEND_URL": "https://x",
                    "AGENT_SERVICE_API_KEY": "dev-key-123",
                    "ENVIRONMENT": "development",
                },
            ),
            patch(
                "main_agent.agents.orchestrator.importers.bundle_fetch.httpx.AsyncClient",
                return_value=fake,
            ),
        ):
            await fetch_bundle_manifest("abc")

        assert fake.last_headers.get("Authorization") == "Api-Key dev-key-123"

    @pytest.mark.asyncio
    async def test_no_api_key_sends_no_auth(self):
        response = _mock_response(200, {"manifest": {}, "uuid": "abc", "source": "stitch"})
        fake = _FakeAsyncClient(response)
        with patch.dict(
            os.environ,
            {"DJANGO_BACKEND_URL": "https://x", "ENVIRONMENT": "development"},
            clear=False,
        ):
            os.environ.pop("AGENT_SERVICE_API_KEY", None)
            with patch(
                "main_agent.agents.orchestrator.importers.bundle_fetch.httpx.AsyncClient",
                return_value=fake,
            ):
                await fetch_bundle_manifest("abc")
        assert "Authorization" not in fake.last_headers
