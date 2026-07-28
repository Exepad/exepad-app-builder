"""HTTP client for the runtime worker's ``/api/{appId}/_diag/*`` endpoints.

Surveyor Phase 2 — Class B runtime probes. Wraps every probe round-trip
in a single ``httpx.AsyncClient`` invocation, returns structured-error
dicts (never raises), and authenticates via ``X-Diagnostic-Secret``.

Pattern follows ``backend_notification_service`` — context-manager
client, fail-soft errors, no exceptions to the caller. Tool wrappers in
``surveyor_tools.py`` pass error dicts through to the LLM as Evidence;
``{error: 'http_500'}`` from a handler IS the bug for the runtime-error
class, so a structured failure is informative, not noise.

The ``PLATFORM_DIAGNOSTIC_SECRET`` env var must be set in production
(provisioned via GCP Secret Manager and surfaced to Cloud Run via
``--set-secrets``). The client refuses to call without it — silent
``X-Diagnostic-Secret: `` would 401 every probe.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
import structlog

logger = structlog.get_logger(__name__)


# Cloud prod points at the hosted runtime; everything else (self-host, dev)
# targets the in-container runtime worker on localhost. Overridable via
# EXEPAD_RUNTIME_BASE.
_DEFAULT_RUNTIME_BASE = (
    "https://p1.exepad.com" if os.getenv("ENVIRONMENT") == "production" else "http://localhost:8080"
)
# 5s server cap on every probe + 1s margin for transport latency.
_TIMEOUT_SECONDS = 6.0


class RuntimeProbeClient:
    """Thin async client for diagnostic probes against the runtime worker."""

    def __init__(self, *, secret: str | None = None, base_url: str | None = None):
        # PLATFORM_DIAGNOSTIC_SECRET is provisioned via GCP Secret Manager
        # and read here at construction time. The agent doesn't have a
        # generic get_secret() helper today — env var matches the existing
        # pattern (e.g. AGENT_SERVICE_API_KEY in bundle_fetch.py).
        self._secret = secret if secret is not None else os.environ.get(
            "PLATFORM_DIAGNOSTIC_SECRET", ""
        )
        # Read at construction time (not module import) so tests and
        # local-dev setups that set EXEPAD_RUNTIME_BASE post-import are
        # honored.
        self._base_url = base_url or os.environ.get(
            "EXEPAD_RUNTIME_BASE", _DEFAULT_RUNTIME_BASE
        )

    def _headers(self) -> dict[str, str]:
        return {
            "X-Diagnostic-Secret": self._secret,
            "Content-Type": "application/json",
        }

    # ── Public probe API ─────────────────────────────────────────────────

    async def execute_handler(
        self,
        app_id: str,
        handler_name: str,
        params: dict[str, Any] | None = None,
        as_user: str | None = None,
    ) -> dict[str, Any]:
        return await self._post(
            app_id,
            "execute_handler",
            {"handler_name": handler_name, "params": params or {}, "as_user": as_user},
        )

    async def query_db(self, app_id: str, sql: str) -> dict[str, Any]:
        return await self._post(app_id, "query_db", {"sql": sql})

    async def sample_table(
        self, app_id: str, name: str, limit: int = 10
    ) -> dict[str, Any]:
        return await self._get(app_id, f"sample_table?name={name}&limit={limit}")

    async def inspect(
        self,
        app_id: str,
        path: str = "/",
        selector: str | None = None,
        viewport: dict[str, int] | None = None,
        want_screenshot: bool = False,
        wait_for_selector: str | None = None,
        as_user: str | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {
            "path": path,
            "wantScreenshot": want_screenshot,
        }
        if selector is not None:
            body["selector"] = selector
        if viewport is not None:
            body["viewport"] = viewport
        if wait_for_selector is not None:
            body["waitForSelector"] = wait_for_selector
        if as_user is not None:
            body["as_user"] = as_user
        return await self._post(app_id, "inspect", body)

    # ── Internals ────────────────────────────────────────────────────────

    async def _post(self, app_id: str, route: str, body: dict[str, Any]) -> dict[str, Any]:
        return await self._call("POST", app_id, route, json_body=body)

    async def _get(self, app_id: str, route_with_qs: str) -> dict[str, Any]:
        return await self._call("GET", app_id, route_with_qs)

    async def _call(
        self,
        method: str,
        app_id: str,
        route: str,
        *,
        json_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self._secret:
            return {
                "error": "no_diagnostic_secret",
                "message": "PLATFORM_DIAGNOSTIC_SECRET env var is unset on the agent",
            }
        url = f"{self._base_url}/api/{app_id}/_diag/{route}"
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
                response = await client.request(
                    method, url, headers=self._headers(), json=json_body
                )
                if response.status_code >= 400:
                    return {
                        "error": f"http_{response.status_code}",
                        "message": response.text[:500],
                    }
                try:
                    return response.json()
                except ValueError as e:
                    return {
                        "error": "invalid_response_json",
                        "message": str(e),
                        "raw_excerpt": response.text[:500],
                    }
        except httpx.TimeoutException:
            return {"error": "timeout"}
        except httpx.HTTPError as e:
            return {"error": "network", "message": str(e)}
        except Exception as e:  # noqa: BLE001 — surface unknown failures as evidence
            logger.warning(
                "runtime_probe_unexpected_error",
                method=method,
                route=route,
                app_id=app_id,
                error=str(e),
            )
            return {"error": "unexpected", "message": str(e)}
