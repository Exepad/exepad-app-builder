"""Fetch a DesignBundle manifest from the Django backend.

The agent runs in a separate Cloud Run service from the Django backend, so
it cannot query the DB directly. Instead it calls the internal endpoint
`GET /api/agent/design-bundles/<uuid>/manifest/`, authenticated with the
same IAM/API-key pattern already used by `BackendNotificationService`.

Usage:

    from main_agent.agents.orchestrator.importers.bundle_fetch import fetch_bundle_manifest

    manifest = await fetch_bundle_manifest(bundle_uuid)
    if manifest is None:
        # No bundle (design_bundle_id missing, backend down, 404, etc.).
        # DesignImporter falls back to the legacy description-only path.
        pass
    else:
        pages = manifest["manifest"]["html_files"]
        ...

The helper returns `None` on any non-200 response or network error. Callers
are expected to fall back to a legacy path rather than propagating the
error — we don't want a transient backend hiccup to kill the whole
creation workflow.
"""

from __future__ import annotations

import os
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger(__name__)


# Tight timeout — this is a single small-JSON GET; callers retry the whole
# creation turn on failure via the existing idempotency layer, so there's
# no point doing long in-process retries here.
_REQUEST_TIMEOUT: float = float(os.environ.get("BUNDLE_FETCH_TIMEOUT", "10"))


def _backend_url() -> Optional[str]:
    """Return the configured DJANGO_BACKEND_URL, or None if unset.

    Matches the env-var convention used by BackendNotificationService.
    """
    url = os.environ.get("DJANGO_BACKEND_URL", "").rstrip("/")
    return url or None


def _auth_headers(backend_url: str) -> dict:
    """Build auth headers matching BackendNotificationService._get_auth_headers.

    - Production: IAM ID token via google.oauth2.id_token.
    - Other envs: AGENT_SERVICE_API_KEY as `Api-Key` in Authorization.
    """
    environment = os.getenv("ENVIRONMENT", "development")
    api_key = os.getenv("AGENT_SERVICE_API_KEY", "")
    headers: dict[str, str] = {}

    if environment == "production":
        try:
            import google.auth.transport.requests
            import google.oauth2.id_token

            auth_req = google.auth.transport.requests.Request()
            token = google.oauth2.id_token.fetch_id_token(auth_req, backend_url)
            headers["Authorization"] = f"Bearer {token}"
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "bundle_fetch_iam_token_failed",
                error=str(exc),
            )
            if api_key:
                headers["Authorization"] = f"Api-Key {api_key}"
    else:
        if api_key:
            headers["Authorization"] = f"Api-Key {api_key}"

    return headers


async def fetch_bundle_manifest(bundle_uuid: str) -> Optional[dict]:
    """Fetch a DesignBundle manifest.

    Args:
        bundle_uuid: UUID string of the DesignBundle row.

    Returns:
        The full response dict from the backend when the bundle exists:

            {
                "uuid": str,
                "source": "stitch" | "claude-design",
                "storage_prefix": str,
                "manifest": { ... },
                "created_at": str,
            }

        Or `None` when the bundle doesn't exist, the backend URL is
        unconfigured (dev without DJANGO_BACKEND_URL), or any network /
        auth failure occurred. Callers treat `None` as "no bundle."
    """
    if not bundle_uuid:
        return None

    backend_url = _backend_url()
    if backend_url is None:
        logger.warning(
            "bundle_fetch_skipped_no_backend_url",
            bundle_uuid=bundle_uuid,
        )
        return None

    url = f"{backend_url}/api/agent/design-bundles/{bundle_uuid}/manifest/"
    headers = _auth_headers(backend_url)

    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning(
            "bundle_fetch_http_error",
            bundle_uuid=bundle_uuid,
            error=str(exc),
        )
        return None

    if response.status_code != 200:
        logger.warning(
            "bundle_fetch_non_200",
            bundle_uuid=bundle_uuid,
            status=response.status_code,
        )
        return None

    try:
        payload = response.json()
    except ValueError as exc:
        logger.warning(
            "bundle_fetch_invalid_json",
            bundle_uuid=bundle_uuid,
            error=str(exc),
        )
        return None

    # Minimal shape check — a well-formed manifest response always has
    # "manifest" as a dict. Anything else means the backend drifted and
    # the importer shouldn't trust the data.
    if not isinstance(payload, dict) or not isinstance(payload.get("manifest"), dict):
        logger.warning(
            "bundle_fetch_shape_error",
            bundle_uuid=bundle_uuid,
            keys=list(payload.keys()) if isinstance(payload, dict) else None,
        )
        return None

    logger.info(
        "bundle_fetch_ok",
        bundle_uuid=bundle_uuid,
        source=payload.get("source"),
    )
    return payload
