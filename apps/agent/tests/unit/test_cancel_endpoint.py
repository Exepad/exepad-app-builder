"""Tests for agent_api's /cancel endpoint + the cancel-marker helpers
(`_write_cancel_marker`, `_cancel_marker_exists`, `_clear_cancel_marker`,
`_cancel_marker_key`).

The /cancel POST is the out-of-band Stop signal: it drops a marker keyed by
session_id that the in-flight /r watchdog polls. The self-host container is a
single instance, so the marker is a process-local dict (the cloud topology
shared it across instances via GCS; that path was removed). These tests
exercise the endpoint contract (auth, validation, round-trip) and the marker
helpers — all network I/O is mocked, no real calls.

Harness copied from tests/unit/test_agent_api.py (FastAPI TestClient via the
`test_client` conftest fixture + unittest.mock patching of agent_api).
The existing test_iter_with_cancel.py covers `_iter_with_cancel`; this file
covers the endpoint + marker store.
"""

import json
from unittest.mock import patch

import pytest

import agent_api


@pytest.fixture(autouse=True)
def _clean_local_markers():
    """Each test starts with an empty in-memory marker store and restores it."""
    agent_api._cancel_markers_local.clear()
    yield
    agent_api._cancel_markers_local.clear()


# =============================================================================
# _cancel_marker_key — sanitization (path-traversal / injection vector)
# =============================================================================


class TestCancelMarkerKey:
    @pytest.mark.unit
    def test_alphanumeric_dash_underscore_preserved(self):
        assert agent_api._cancel_marker_key("abc-123_XYZ") == "abc-123_XYZ"

    @pytest.mark.unit
    def test_strips_path_separators_and_dots(self):
        """A session_id like '../../etc/passwd' must not yield a key that can
        escape the marker prefix — slashes and dots are stripped."""
        key = agent_api._cancel_marker_key("../../etc/passwd")
        assert "/" not in key
        assert "." not in key
        assert key == "etcpasswd"

    @pytest.mark.unit
    def test_strips_special_characters(self):
        key = agent_api._cancel_marker_key("a b!@#$%^&*()c")
        assert key == "abc"

    @pytest.mark.unit
    def test_coerces_non_string_session_id(self):
        """Non-str session_id is coerced via str() before filtering."""
        assert agent_api._cancel_marker_key(12345) == "12345"


# =============================================================================
# Marker write/read/clear round-trip (in-memory store)
# =============================================================================


class TestLocalMarkerRoundTrip:
    @pytest.mark.unit
    async def test_write_then_exists_round_trips(self):
        wrote = await agent_api._write_cancel_marker("sess-A")
        assert wrote is True
        assert await agent_api._cancel_marker_exists("sess-A") is True

    @pytest.mark.unit
    async def test_unwritten_session_does_not_exist(self):
        assert await agent_api._cancel_marker_exists("never-written") is False

    @pytest.mark.unit
    async def test_clear_removes_marker(self):
        await agent_api._write_cancel_marker("sess-B")
        assert await agent_api._cancel_marker_exists("sess-B") is True
        await agent_api._clear_cancel_marker("sess-B")
        assert await agent_api._cancel_marker_exists("sess-B") is False

    @pytest.mark.unit
    async def test_clear_unknown_session_is_noop(self):
        """Clearing a session that was never written must not raise (stale-marker
        cleanup at run start runs unconditionally)."""
        await agent_api._clear_cancel_marker("ghost")  # no error
        assert await agent_api._cancel_marker_exists("ghost") is False

    @pytest.mark.unit
    async def test_marker_keyed_by_sanitized_id(self):
        """exists() and write() agree on the sanitized key, so an id with junk
        characters still round-trips."""
        await agent_api._write_cancel_marker("sess/../X!")
        assert await agent_api._cancel_marker_exists("sess/../X!") is True
        # The raw key is the sanitized form.
        assert agent_api._cancel_marker_key("sess/../X!") in agent_api._cancel_markers_local

    @pytest.mark.unit
    async def test_empty_session_id_never_exists(self):
        """An empty session_id short-circuits to False (no marker)."""
        assert await agent_api._cancel_marker_exists("") is False

    @pytest.mark.unit
    async def test_write_empty_session_id_returns_false(self):
        assert await agent_api._write_cancel_marker("") is False
        assert agent_api._cancel_markers_local == {}

    @pytest.mark.unit
    async def test_clear_empty_session_id_is_noop(self):
        await agent_api._clear_cancel_marker("")  # no error


# =============================================================================
# POST /cancel — endpoint contract
# =============================================================================


class TestCancelEndpoint:
    @pytest.mark.unit
    def test_cancel_writes_marker_and_returns_200(self, test_client):
        """Happy path (dev): POST /cancel writes the marker for the session and
        returns status=cancel_requested with written=True."""
        response = test_client.post("/cancel", json={"session_id": "sess-cancel"})
        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "cancel_requested"
        assert body["written"] is True
        # The marker is now observable by the watchdog path.
        key = agent_api._cancel_marker_key("sess-cancel")
        assert key in agent_api._cancel_markers_local

    @pytest.mark.unit
    def test_cancel_missing_session_id_returns_400(self, test_client):
        """No session_id in body → 400, and nothing is written."""
        response = test_client.post("/cancel", json={})
        assert response.status_code == 400
        assert "session_id" in response.json()["error"]
        assert agent_api._cancel_markers_local == {}

    @pytest.mark.unit
    def test_cancel_empty_session_id_returns_400(self, test_client):
        """Empty-string session_id is falsy → 400."""
        response = test_client.post("/cancel", json={"session_id": ""})
        assert response.status_code == 400

    @pytest.mark.unit
    def test_cancel_invalid_json_treated_as_empty_then_400(self, test_client):
        """Malformed JSON body → treated as {} → 400 (session_id required),
        NOT a 500."""
        response = test_client.post(
            "/cancel",
            content=b"not-json{{{",
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 400
        assert "session_id" in response.json()["error"]

    @pytest.mark.unit
    def test_cancel_unknown_session_still_200(self, test_client):
        """Cancelling a session with no in-flight run is handled gracefully —
        the marker is written, 200 returned, no 500. (A later run reusing the
        id clears the stale marker at start.)"""
        response = test_client.post("/cancel", json={"session_id": "no-such-run-in-flight"})
        assert response.status_code == 200
        assert response.json()["status"] == "cancel_requested"

    @pytest.mark.unit
    def test_cancel_marker_observable_by_watchdog_read(self, test_client):
        """End-to-end round-trip: a /cancel POST makes _cancel_marker_exists()
        — the function the in-flight watchdog calls — return True for that
        session. This is the contract that lets an in-flight run abort."""
        import asyncio

        test_client.post("/cancel", json={"session_id": "sess-watch"})

        async def _read():
            return await agent_api._cancel_marker_exists("sess-watch")

        assert asyncio.run(_read()) is True


# =============================================================================
# POST /cancel — production IAM gating (mirrors /r)
# =============================================================================


class TestCancelEndpointAuth:
    @pytest.mark.unit
    def test_production_missing_auth_returns_401(self, test_client):
        with patch("agent_api.IS_PRODUCTION", True):
            response = test_client.post("/cancel", json={"session_id": "s1"})
        assert response.status_code == 401
        # authenticate_caller() returns a generic `error` label with the
        # specific reason in `message` — one uniform shape across /r, /cancel
        # and /artifacts. Mirrors
        # test_agent_api.py::test_production_rejects_missing_auth.
        assert response.json()["error"] == "Forbidden"
        assert response.json()["message"] == "Authorization header required"

    @pytest.mark.unit
    def test_production_invalid_iam_returns_403(self, test_client):
        with (
            patch("agent_api.IS_PRODUCTION", True),
            patch("agent_api.verify_iam_caller", return_value=(False, "Unauthorized service account")),
        ):
            response = test_client.post(
                "/cancel",
                json={"session_id": "s1"},
                headers={"Authorization": "Bearer fake-token"},
            )
        assert response.status_code == 403
        assert response.json()["error"] == "Forbidden"

    @pytest.mark.unit
    def test_production_valid_iam_writes_marker(self, test_client):
        """A valid backend SA in production passes auth and writes the marker."""
        with (
            patch("agent_api.IS_PRODUCTION", True),
            patch("agent_api.verify_iam_caller", return_value=(True, "")),
        ):
            response = test_client.post(
                "/cancel",
                json={"session_id": "s-prod"},
                headers={"Authorization": "Bearer valid-token"},
            )
        assert response.status_code == 200
        assert response.json()["written"] is True

    @pytest.mark.unit
    def test_production_unauthenticated_does_not_write_marker(self, test_client):
        """An unauthenticated cancel must NOT drop a marker (a marker would let
        an unauthenticated caller abort someone else's build)."""
        with patch("agent_api.IS_PRODUCTION", True):
            test_client.post(
                "/cancel",
                content=json.dumps({"session_id": "victim-sess"}),
                headers={"Content-Type": "application/json"},
            )
        assert agent_api._cancel_markers_local == {}
