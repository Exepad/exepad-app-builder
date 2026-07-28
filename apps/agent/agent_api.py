import os
import sys
import time
import logging
import hashlib
import hmac
import uuid as uuid_mod
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path
from google.genai.types import Content, Part
import asyncio
import json
from typing import List

_schemas_py = (
    Path(__file__).resolve().parent.parent.parent / "packages" / "schemas" / "scripts" / "py"
)
if _schemas_py.is_dir():
    sys.path.insert(0, str(_schemas_py))

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.routing import APIRoute
from google.adk.cli.fast_api import get_fast_api_app
from google.adk.events import Event, EventActions
from google.cloud import logging as google_cloud_logging
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import StreamingResponse, JSONResponse
from google.adk.sessions import DatabaseSessionService
from google.adk.artifacts import InMemoryArtifactService
from main_agent.agents.utils.rate_limit_handler import get_error_type, is_transient_error
from config import apply_runtime_settings

# Load environment variables from .env file
# Preserve ENVIRONMENT if already set (e.g., for testing)
load_dotenv()
load_dotenv(".env.local", override=True)


def get_allowed_origins() -> List[str]:
    """Get CORS allowed origins based on environment."""
    environment = os.getenv("ENVIRONMENT", "development")

    if environment == "production":
        # Production: require explicit allowed origins. Previously this
        # defaulted to a hardcoded cloud host (https://backend.exepad.com)
        # when ALLOWED_ORIGINS was unset, silently baking the cloud
        # deployment's origin into any production-flagged instance. Require
        # the operator to set it instead.
        custom_origins = os.getenv("ALLOWED_ORIGINS", "")
        allowed = [o.strip() for o in custom_origins.split(",") if o.strip()]
        if not allowed:
            raise RuntimeError(
                "ALLOWED_ORIGINS must be set (comma-separated) when "
                "ENVIRONMENT=production. Set it to your backend origin(s), "
                "or use ENVIRONMENT=selfhost/development for a non-cloud deploy."
            )
        return allowed
    else:
        # Development / self-host: allow all for easier local testing.
        return ["*"]


# Initialize logger based on environment
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
IS_PRODUCTION = ENVIRONMENT == "production"

# Lazy initialization for services (avoid async init at import time for testing)
_SESSION_SERVICE = None
_ARTIFACT_SERVICE = None

if IS_PRODUCTION:
    # Production: Use Cloud Logging
    logging_client = google_cloud_logging.Client()
    logging_client.setup_logging()  # This integrates Cloud Logging with standard logging
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    logger.info("Production mode")
else:
    # Development: Local logging
    load_dotenv(".env.local", override=True)
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger(__name__)
    logger.info("Development mode")


# Suppress harmless ADK warning about dynamically-added sub_agents.
# parallel_initial_builders.py intentionally mutates sub_agents at runtime,
# causing ADK's runner to emit "Event from an unknown agent" warnings.
class _ADKUnknownAgentFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "Event from an unknown agent" not in record.getMessage()


logging.getLogger("google_adk.google.adk.runners").addFilter(_ADKUnknownAgentFilter())


# Suppress the noisy "Failed to detach context" ERROR tracebacks from
# OpenTelemetry. They come from LiteLLM spans whose attach/detach cross asyncio
# task boundaries (a contextvars Token reset in a different Context). OTel itself
# catches and logs them — the LLM call is unaffected — but at ERROR level with a
# full traceback they bury real failures in the logs. Harmless to drop.
class _OTelDetachFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return "Failed to detach context" not in record.getMessage()


logging.getLogger("opentelemetry.context").addFilter(_OTelDetachFilter())


def get_session_service():
    """Get or create the session service (lazy initialization).

    This defers DatabaseSessionService initialization until first use,
    avoiding async initialization issues during module import (e.g., in tests).

    In test mode, always uses InMemorySessionService to avoid database dependencies.
    """
    global _SESSION_SERVICE
    if _SESSION_SERVICE is None:
        from google.adk.sessions import InMemorySessionService

        # In test mode, always use in-memory session service
        if IS_TEST:
            logger.info("Test mode: Using InMemorySessionService")
            _SESSION_SERVICE = InMemorySessionService()
        else:
            db_url = os.getenv("SESSION_SERVICE_URI")
            if db_url:
                logger.info(f"Initializing DatabaseSessionService with URI: {db_url[:20]}...")
                _SESSION_SERVICE = DatabaseSessionService(db_url=db_url)
            else:
                logger.warning("SESSION_SERVICE_URI not set. Using in-memory sessions.")
                _SESSION_SERVICE = InMemorySessionService()
    return _SESSION_SERVICE


def get_artifact_service():
    """Get or create the artifact service (lazy initialization).

    The self-host single container keeps ADK artifacts in process memory for the
    life of a build; the runtime worker pulls them via GET /artifacts/{session}
    before the session is cleaned up. (The cloud topology used a GCS-backed
    artifact store, removed with the rest of the GCS coupling.)
    """
    global _ARTIFACT_SERVICE
    if _ARTIFACT_SERVICE is None:
        logger.info("Initializing InMemoryArtifactService")
        _ARTIFACT_SERVICE = InMemoryArtifactService()
    return _ARTIFACT_SERVICE


# Log environment configuration
logger.info(f"Environment: {os.getenv('ENVIRONMENT', 'development')}")
logger.info(f"CORS allowed origins: {get_allowed_origins()}")

# Initialize ADK FastAPI app
AGENT_DIR = os.path.dirname(os.path.abspath(__file__))
session_uri = os.getenv("SESSION_SERVICE_URI")
IS_TEST = os.getenv("IS_TEST", "false").lower() == "true"

# ---------------------------------------------------------------------------
# G1: Idempotency -- track in-flight correlation IDs to reject duplicates
# LIMITATION: Process-local only. Does not work across multiple Cloud Run
# instances or survive restarts. For multi-instance deployments, migrate to
# Redis/Cloud Memorystore or a DB-backed idempotency table.
# ---------------------------------------------------------------------------
_INFLIGHT_CORRELATION_IDS: OrderedDict[str, float] = OrderedDict()
_IDEMPOTENCY_WINDOW_SECS = int(
    os.getenv("IDEMPOTENCY_WINDOW_SECS", "3600")
)  # reject duplicates within this window
_IDEMPOTENCY_MAX_ENTRIES = 500  # cap memory usage


def _prune_inflight() -> None:
    """Remove expired entries from the in-flight set."""
    now = time.time()
    while _INFLIGHT_CORRELATION_IDS:
        key, ts = next(iter(_INFLIGHT_CORRELATION_IDS.items()))
        if now - ts > _IDEMPOTENCY_WINDOW_SECS:
            _INFLIGHT_CORRELATION_IDS.pop(key)
        else:
            break


def _release_inflight(correlation_id: str | None) -> None:
    """Remove a correlation_id from the in-flight set. Idempotent — safe
    to call many times and safe to call with ``None``. Always safe to call
    from cancellation-sensitive contexts (e.g. generator ``finally``)
    because the underlying ``dict.pop`` is synchronous.
    """
    if correlation_id:
        _INFLIGHT_CORRELATION_IDS.pop(correlation_id, None)


# ---------------------------------------------------------------------------
# Per-session locks to prevent concurrent processing of the same session
# within a single process. Cross-instance protection relies on the
# correlation_id idempotency check above.
# LIMITATION: Process-local only (same caveat as idempotency store).
# ---------------------------------------------------------------------------
_session_locks: OrderedDict[str, asyncio.Lock] = OrderedDict()
_SESSION_LOCKS_MAX = 1000  # cap memory


def _release_session(session_id: str):
    """Release session lock and remove from tracking."""
    lock = _session_locks.pop(session_id, None)
    if lock and lock.locked():
        lock.release()


def _normalize_chat_history_entries(history: list) -> list[str]:
    """Coerce chat_history turns to strings for the downstream routing models.

    Clients (the runtime worker, the e2e harness) send turns as
    ``{"role": ..., "content": ...}`` dicts, but the two consumers that read
    ``chat_history`` from session state — ``AppHelpDeskInput`` and
    ``SurveyorInput`` — both declare ``chat_history: list[str]``. Left as dicts,
    those entries raise a Pydantic ``string_type`` ValidationError at model
    construction and abort the entire SSE run (e.g. a plain "hi" turn).

    Flatten each turn to ``"role: text"`` (or just the text when no role is
    present), tolerating the ``content``/``text``/``message`` key variants seen
    across clients and tests. Entries that are already strings pass through
    unchanged, so this is safe to apply unconditionally at the boundary.
    """
    normalized: list[str] = []
    for entry in history:
        if isinstance(entry, str):
            normalized.append(entry)
        elif isinstance(entry, dict):
            text = entry.get("content") or entry.get("text") or entry.get("message") or ""
            if not isinstance(text, str):
                text = json.dumps(text, ensure_ascii=False)
            role = entry.get("role")
            normalized.append(f"{role}: {text}" if isinstance(role, str) and role else text)
        else:
            normalized.append(str(entry))
    return normalized


def _get_session_lock(session_id: str) -> asyncio.Lock:
    """Get or create a lock for a session_id, with LRU eviction."""
    if session_id in _session_locks:
        _session_locks.move_to_end(session_id)
        return _session_locks[session_id]
    # Evict least-recently-used entries, skipping actively locked sessions
    while len(_session_locks) >= _SESSION_LOCKS_MAX:
        oldest_key, oldest_lock = next(iter(_session_locks.items()))
        if oldest_lock.locked():
            _session_locks.move_to_end(oldest_key)
            if all(lock.locked() for lock in _session_locks.values()):
                break  # all slots active — allow temporary overflow
            continue
        _session_locks.pop(oldest_key)
    _session_locks[session_id] = asyncio.Lock()
    return _session_locks[session_id]


# The ADK developer web UI (/dev-ui and its companion /list-apps, session and
# artifact browsing routes) is a local debugging console. It is only useful in
# development; the self-host container and production deployments only need the
# /r orchestration endpoint, so disable it outside `ENVIRONMENT=development`.
# Operators can force it back on with `ADK_WEB_UI=true`.
ENABLE_ADK_WEB = os.getenv("ADK_WEB_UI", str(ENVIRONMENT == "development")).lower() == "true"

app_args = {
    "agents_dir": AGENT_DIR,
    "web": ENABLE_ADK_WEB,
    # Only enable cloud tracing in production (requires GCP credentials)
    "trace_to_cloud": IS_PRODUCTION,
    "allow_origins": get_allowed_origins(),  # Use dynamic function
}

# Session service is always lazily initialized via get_session_service().
# Both the ADK dev UI routes and the /r endpoint share the same instance,
# avoiding duplicate DatabaseSessionService connection pools.
if IS_TEST:
    logger.info("Test mode: Using lazy-init InMemorySessionService")
elif session_uri:
    logger.info(f"Session DB configured (URI: {session_uri[:30]}...)")
else:
    logger.warning(
        "SESSION_SERVICE_URI not set. Using in-memory sessions (data will be lost on restart)."
    )

web_app: FastAPI = get_fast_api_app(**app_args)
logger.info(f"ADK developer web UI: {'enabled' if ENABLE_ADK_WEB else 'disabled'}")

# App metadata
web_app.title = "Exepad Agent API"
web_app.description = "Agent API for Exepad application creation and management"


# ---------------------------------------------------------------------------
# G4: Simple per-IP rate limiting middleware for /r endpoint
# LIMITATION: Process-local only. Each Cloud Run instance maintains its own
# counter, so effective limits are N * num_instances. For global rate
# limiting, migrate to Redis or use Cloud Armor / API Gateway.
# ---------------------------------------------------------------------------
_RATE_LIMIT_REQUESTS = int(os.getenv("RATE_LIMIT_REQUESTS", "10"))  # max requests
_RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))  # per N seconds
_rate_limit_store: dict[str, list[float]] = {}

WORKFLOW_TIMEOUT = int(os.getenv("WORKFLOW_TIMEOUT_SECONDS", "1800"))  # 30 minutes


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Lightweight sliding-window rate limiter for the /r endpoint."""

    async def dispatch(self, request: Request, call_next):
        if request.url.path != "/r":
            return await call_next(request)

        # Behind the runtime worker's reverse proxy, request.client.host is always
        # the loopback address, so keying on it collapses every caller into one
        # shared bucket. Prefer the original client IP from X-Forwarded-For
        # (left-most entry = the real client; the worker/Caddy chain appends
        # trusted hops). A direct, un-proxied caller can spoof this header, but
        # such callers can no longer reach /r at all — authenticate_caller now
        # requires the internal token — so per-IP fairness among legitimate,
        # proxied builds is what matters here.
        forwarded_for = request.headers.get("x-forwarded-for", "")
        client_ip = ""
        if forwarded_for:
            client_ip = forwarded_for.split(",")[0].strip()
        if not client_ip:
            client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window_start = now - _RATE_LIMIT_WINDOW

        # Prune old entries
        hits = _rate_limit_store.get(client_ip, [])
        hits = [t for t in hits if t > window_start]

        if len(hits) >= _RATE_LIMIT_REQUESTS:
            logger.warning(f"Rate limit exceeded for {client_ip}")
            return JSONResponse(
                status_code=429,
                content={"error": "Rate limit exceeded. Please try again later."},
            )

        hits.append(now)
        _rate_limit_store[client_ip] = hits

        if len(_rate_limit_store) > 10000:
            stale_ips = [
                ip
                for ip, ip_hits in _rate_limit_store.items()
                if not ip_hits or ip_hits[-1] <= window_start
            ]
            for ip in stale_ips:
                del _rate_limit_store[ip]

        return await call_next(request)


web_app.add_middleware(RateLimitMiddleware)


from google.adk.runners import Runner
from main_agent.agent import app as agent_app

if IS_TEST:
    from main_agent.testing import export_test_run_data
else:
    export_test_run_data = None  # not needed in production

AGENT_APP_NAME = os.getenv("AGENT_APP_NAME")


def create_workflow_failure_payload(
    error: Exception,
    session_id: str,
    state_delta: dict,
) -> dict:
    """
    Create a failure payload for backend notification when workflow crashes.

    This ensures the backend is notified even when the workflow fails completely,
    with status="failed" so the backend can handle it appropriately.

    Args:
        error: The exception that caused the failure
        session_id: The session ID
        state_delta: The initial state delta containing correlation_id, app_uuid, etc.

    Returns:
        A dict formatted as a backend_response event with status="failed"
    """
    current_time = datetime.now(timezone.utc).isoformat()

    # Classify the error using existing rate_limit_handler logic
    error_classification = get_error_type(error)
    if error_classification == "rate_limit":
        agent_error_type = "rate_limit_exhausted"
    elif error_classification == "transient":
        agent_error_type = "llm_unavailable"
    else:
        error_name = type(error).__name__
        if error_name in ("JSONDecodeError", "ValidationError"):
            agent_error_type = "validation_error"
        elif "timeout" in error_name.lower() or "timeout" in str(error).lower():
            agent_error_type = "timeout_error"
        else:
            agent_error_type = "workflow_error"

    return {
        "type": "backend_response",
        "timestamp": current_time,
        "callback_data": {
            "status": "failed",
            "session_id": session_id,
            "correlation_id": state_delta.get("correlation_id"),
            "app_uuid": state_delta.get("app_uuid"),
            "workflow_type": state_delta.get("operation_mode", "unknown"),
            "error": {
                "type": type(error).__name__,
                "message": str(error)[:1000],
                "timestamp": current_time,
            },
            "agent_errors": [
                {
                    "error_type": agent_error_type,
                    "agent_name": "Workflow",
                    "timestamp": current_time,
                    "summary": f"Workflow failed with unhandled exception: {type(error).__name__}",
                    "error_class": type(error).__name__,
                    "error_message": str(error)[:500],
                    "retry_attempts": 0,
                    "is_transient": is_transient_error(error),
                    "components_affected": [],
                }
            ],
            "execution_context": {
                "agent_version": os.getenv("AGENT_VERSION", "unknown"),
                "environment": ENVIRONMENT,
                "completed_at": current_time,
            },
        },
    }


def _get_failure_auth_headers(backend_url: str) -> dict:
    """Build auth headers for failure callback.

    Mirrors BackendNotificationService._get_auth_headers — IAM token in
    production, API key otherwise.
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
        except Exception as e:
            logger.error(f"Failed to generate IAM token for failure callback: {e}")
            if api_key:
                headers["Authorization"] = f"Api-Key {api_key}"
    else:
        if api_key:
            headers["Authorization"] = f"Api-Key {api_key}"

    return headers


async def _notify_backend_failure(
    state_delta: dict,
    error: Exception,
    session_id: str,
) -> bool:
    """POST failure callback to Django backend's execution-complete endpoint.

    Called from event_generator's except block when the agent workflow crashes.
    This ensures the backend always knows about failures, even when the normal
    completion path (BackendNotificationService) was never reached.

    Must complete BEFORE the SSE generator ends so the Cloud Tasks handler
    sees the updated execution status in the DB.

    Returns True on success, False if all retries exhausted.
    """
    import httpx

    backend_url = os.getenv("DJANGO_BACKEND_URL")
    app_uuid = state_delta.get("app_uuid")
    # Use public_id for backend callback URL; falls back to app_uuid
    app_public_id = state_delta.get("app_public_id") or app_uuid
    correlation_id = state_delta.get("correlation_id")
    is_test = state_delta.get("is_test", False)

    if is_test:
        logger.info("Test mode: skipping failure backend notification")
        return True

    if not backend_url:
        logger.info("No DJANGO_BACKEND_URL configured, skipping failure notification")
        return True

    if not app_uuid or not correlation_id:
        logger.error(
            f"Cannot notify backend of failure: "
            f"app_uuid={app_uuid}, correlation_id={correlation_id}"
        )
        return False

    current_time = datetime.now(timezone.utc).isoformat()
    callback_data = {
        "correlation_id": correlation_id,
        "session_id": session_id,
        "status": "failed",
        "workflow_type": state_delta.get("operation_mode", "unknown"),
        "error_message": f"{type(error).__name__}: {str(error)[:500]}",
        "metrics": {},
        "execution_context": {
            "agent_version": os.getenv("AGENT_VERSION", "unknown"),
            "environment": ENVIRONMENT,
            "completed_at": current_time,
        },
        "agent_errors": [
            {
                "error_type": "workflow_crash",
                "agent_name": "Workflow",
                "timestamp": current_time,
                "summary": f"Unhandled exception: {type(error).__name__}",
                "error_class": type(error).__name__,
                "error_message": str(error)[:500],
            }
        ],
    }

    max_retries = 2
    base_delay = 1.0

    async with httpx.AsyncClient(timeout=30.0) as client:
        for attempt in range(max_retries + 1):
            headers = _get_failure_auth_headers(backend_url)
            try:
                response = await client.post(
                    f"{backend_url}/api/agent/apps/{app_public_id}/execution-complete/",
                    json=callback_data,
                    headers=headers,
                )
                response.raise_for_status()
                logger.info(
                    f"Successfully notified backend of failure for "
                    f"correlation_id={correlation_id}"
                )
                return True
            except Exception as e:
                if attempt < max_retries:
                    delay = base_delay * (2**attempt)
                    logger.warning(
                        f"Failure notification attempt {attempt + 1}/{max_retries + 1} "
                        f"failed: {e}. Retrying in {delay:.1f}s..."
                    )
                    await asyncio.sleep(delay)
                else:
                    logger.error(
                        f"Failed to notify backend of failure after "
                        f"{max_retries + 1} attempts: {e}",
                        exc_info=True,
                    )

    return False


# ---------------------------------------------------------------------------
# IAM caller verification -- ensures only the trusted Django backend service
# account can invoke the /r endpoint.  Cloud Run IAM (--no-allow-unauthenticated)
# provides the first gate; this is a defense-in-depth application-level check.
#
# Credit/subscription checks are handled by the Django backend BEFORE it calls
# the agent — the agent trusts the backend after verifying its IAM identity.
# ---------------------------------------------------------------------------
EXPECTED_BACKEND_SERVICE_ACCOUNT = os.getenv("EXPECTED_BACKEND_SERVICE_ACCOUNT", "")
AGENT_SERVICE_URL = os.getenv("AGENT_SERVICE_URL", "")  # This agent's own URL (used as audience)

# IAM audience validation is a production (GCP Cloud Run) concern only. Self-host
# runs the agent on a private loopback port behind the runtime worker, so neither
# IAM nor an AGENT_SERVICE_URL audience applies.
if IS_PRODUCTION and not AGENT_SERVICE_URL:
    raise RuntimeError(
        "AGENT_SERVICE_URL must be set in production to enforce IAM audience validation."
    )


def verify_iam_caller(auth_header: str) -> tuple[bool, str]:
    """
    Verify that the caller is the trusted Django backend service account.

    Validates the GCP IAM ID token from the Authorization header against:
    1. Google's token signing keys (signature + expiry)
    2. Expected audience (this agent's own URL)
    3. Expected service account email

    Args:
        auth_header: The Authorization header value (e.g. "Bearer <token>")

    Returns:
        Tuple of (is_valid, error_message)
    """
    try:
        token = auth_header.split(" ", 1)[1] if " " in auth_header else auth_header
    except (IndexError, AttributeError):
        return False, "Malformed Authorization header"

    try:
        import google.auth.transport.requests
        import google.oauth2.id_token

        request = google.auth.transport.requests.Request()

        # Verify token signature, expiry, and audience
        audience = AGENT_SERVICE_URL or None
        claims = google.oauth2.id_token.verify_oauth2_token(token, request, audience=audience)

        # Verify the caller is the expected backend service account
        caller_email = claims.get("email", "")
        if EXPECTED_BACKEND_SERVICE_ACCOUNT and caller_email != EXPECTED_BACKEND_SERVICE_ACCOUNT:
            logger.warning(
                f"IAM verification failed: unexpected service account '{caller_email}' "
                f"(expected '{EXPECTED_BACKEND_SERVICE_ACCOUNT}')"
            )
            return False, f"Unauthorized service account: {caller_email}"

        logger.debug(f"IAM caller verified: {caller_email}")
        return True, ""

    except ValueError as e:
        # Token is invalid, expired, or audience mismatch
        logger.warning(f"IAM token verification failed: {e}")
        return False, f"Invalid IAM token: {e}"
    except Exception as e:
        logger.error(f"IAM verification error: {e}")
        return False, f"IAM verification error: {e}"


# ---------------------------------------------------------------------------
# Internal shared-secret verification (self-host / non-production).
#
# In the self-hosted container there is no Cloud Run IAM: the agent runs on a
# private loopback port and the runtime worker reverse-proxies /agent/* to it.
# Without a check, ANY internet visitor hitting the worker's /agent/r could
# trigger unlimited LLM builds (denial-of-wallet) or exfiltrate build output via
# /artifacts. We therefore require a shared internal token that the trusted
# worker injects on EVERY proxied call, enforced in all non-production
# environments (not gated on IS_PRODUCTION).
#
# Contract with the runtime worker / orchestrator (names MUST match the worker's
# /agent/* proxy in apps/runtime/worker/src/index.ts, which stamps this header
# from this env var):
#   env var : EXEPAD_AGENT_INTERNAL_SECRET  (set for BOTH the agent and the
#             worker process; the container entrypoint generates + persists it)
#   header  : X-Exepad-Internal-Secret      (worker adds it to every /agent/*
#             proxied request)
# For a standalone local dev run without the worker, set
# EXEPAD_ALLOW_UNAUTHENTICATED_AGENT=1 to opt out explicitly.
# ---------------------------------------------------------------------------
INTERNAL_TOKEN_HEADER = "X-Exepad-Internal-Secret"
INTERNAL_AGENT_TOKEN = os.getenv("EXEPAD_AGENT_INTERNAL_SECRET", "").strip()
ALLOW_UNAUTHENTICATED_AGENT = os.getenv("EXEPAD_ALLOW_UNAUTHENTICATED_AGENT", "").strip().lower() in (
    "1",
    "true",
    "yes",
)

if not IS_PRODUCTION and not IS_TEST and not INTERNAL_AGENT_TOKEN and not ALLOW_UNAUTHENTICATED_AGENT:
    logger.warning(
        "EXEPAD_AGENT_INTERNAL_SECRET is not set: the agent will REJECT all /r, "
        "/cancel and /artifacts calls until the runtime worker and agent share a "
        "secret. Set EXEPAD_AGENT_INTERNAL_SECRET (both processes) or "
        "EXEPAD_ALLOW_UNAUTHENTICATED_AGENT=1 for standalone local dev."
    )


def verify_internal_caller(request: Request) -> tuple[bool, str]:
    """Verify a self-host/dev caller via the shared internal token.

    Uses a constant-time comparison. Returns (is_valid, error_message).
    """
    if not INTERNAL_AGENT_TOKEN:
        if ALLOW_UNAUTHENTICATED_AGENT:
            return True, ""
        return False, "Agent internal token not configured"
    provided = request.headers.get(INTERNAL_TOKEN_HEADER, "")
    if provided and hmac.compare_digest(provided, INTERNAL_AGENT_TOKEN):
        return True, ""
    return False, "Missing or invalid internal token"


def authenticate_caller(request: Request) -> tuple[bool, int, str]:
    """Unified caller auth for the operator-facing endpoints (/r, /cancel,
    /artifacts). Returns (ok, http_status_on_failure, message).

    - Production: GCP IAM ID-token verification (Cloud Run is the first gate).
    - Non-production test runs bypass the internal token (``IS_TEST``) so the
      test client does not have to carry it.
    - Non-production (self-host/dev): shared internal token, enforced
      unconditionally so the worker's unauthenticated /agent/* proxy cannot be
      abused by internet visitors.
    """
    if IS_PRODUCTION:
        auth_header = request.headers.get("Authorization")
        if not auth_header:
            return False, 401, "Authorization header required"
        ok, message = verify_iam_caller(auth_header)
        return (True, 0, "") if ok else (False, 403, message)
    if IS_TEST:
        return True, 0, ""
    ok, message = verify_internal_caller(request)
    if ok:
        return True, 0, ""
    status = 401 if "not configured" in message else 403
    return False, status, message


# ---------------------------------------------------------------------------
# Out-of-band cancellation (editor "Stop")
# ---------------------------------------------------------------------------
# A long-lived /r request may not observe the client's disconnect, so cancel is
# signalled out-of-band: the /cancel endpoint drops a marker keyed by session_id
# that the in-flight /r run polls and aborts on within a few seconds — even
# mid-phase, where no SSE events are yielded. The self-host container is a single
# instance, so the marker is a process-local dict. (The cloud topology shared it
# across instances via a GCS object; that path was removed with the GCS coupling.)
_CANCEL_POLL_SECONDS = 3.0

# session_id (sanitized) → write timestamp.
_cancel_markers_local: "dict[str, float]" = {}


def _cancel_marker_key(session_id: str) -> str:
    return "".join(c for c in str(session_id) if c.isalnum() or c in ("-", "_"))


async def _cancel_marker_exists(session_id: str) -> bool:
    """True if a cancel marker exists for this session."""
    if not session_id:
        return False
    return _cancel_marker_key(session_id) in _cancel_markers_local


async def _write_cancel_marker(session_id: str) -> bool:
    if not session_id:
        return False
    _cancel_markers_local[_cancel_marker_key(session_id)] = time.time()
    return True


async def _clear_cancel_marker(session_id: str) -> None:
    """Delete any stale marker at run start so a marker left by a previous
    cancelled run reusing this session_id can't abort the new run."""
    if not session_id:
        return
    _cancel_markers_local.pop(_cancel_marker_key(session_id), None)


async def _iter_with_cancel(agen, cancel_event: "asyncio.Event"):
    """Yield items from async generator ``agen``, aborting promptly if
    ``cancel_event`` is set — even while awaiting the next item (which during a
    long build phase can be tens of seconds with no yields). Always closes
    ``agen`` on exit. This is the interruptibility a plain ``async for`` lacks.

    If ``cancel_event`` is never set, behaviour is identical to iterating the
    generator directly.
    """
    try:
        while True:
            anext_task = asyncio.ensure_future(agen.__anext__())
            cancel_task = asyncio.ensure_future(cancel_event.wait())
            try:
                await asyncio.wait({anext_task, cancel_task}, return_when=asyncio.FIRST_COMPLETED)
            finally:
                if not cancel_task.done():
                    cancel_task.cancel()

            if cancel_event.is_set():
                anext_task.cancel()
                try:
                    await anext_task
                except (asyncio.CancelledError, StopAsyncIteration):
                    pass
                except Exception:
                    pass
                return

            try:
                item = anext_task.result()
            except StopAsyncIteration:
                return
            yield item
    finally:
        try:
            await agen.aclose()
        except Exception:
            pass


@web_app.post("/cancel")
async def cancel_endpoint(request: Request):
    """Out-of-band cancellation signal from the Django backend.

    The backend cannot reach the in-flight /r run directly (it may be on a
    different Cloud Run instance), so it POSTs here with the session_id; we drop
    a GCS marker the /r watchdog polls. Auth mirrors /r: Cloud Run IAM +
    backend-SA check in production, shared internal token in self-host/dev."""
    ok, status, message = authenticate_caller(request)
    if not ok:
        return JSONResponse(status_code=status, content={"error": "Forbidden", "message": message})
    try:
        data = await request.json()
    except Exception:
        data = {}
    session_id = data.get("session_id")
    if not session_id:
        return JSONResponse(status_code=400, content={"error": "session_id is required"})
    wrote = await _write_cancel_marker(session_id)
    logger.info(f"Cancel marker {'written' if wrote else 'FAILED'} for session {session_id}")
    return JSONResponse(status_code=200, content={"status": "cancel_requested", "written": wrote})


# Custom Endpoints
async def _save_app_config_artifact(
    runner, artifact_service, user_id: str, session_id: str
) -> None:
    """Persist the assembled app_config as an ADK artifact (self-host).

    The self-hosted orchestrator pulls build output via GET /artifacts/{session}
    AFTER the /r run completes — but the run's ``cleanup()`` deletes the ADK
    session (and its in-memory state, where the assembled ``app_config`` lives).
    Artifacts are NOT deleted by delete_session, so we snapshot the config into
    the artifact store here, on the success path, before cleanup runs. In the
    cloud topology GcsOutputService uploaded the config to GCS instead; this is
    the local equivalent.
    """
    session = await runner.session_service.get_session(
        app_name="orchestrator", user_id=user_id, session_id=session_id
    )
    if session is None:
        return
    app_config = session.state.get("app_config")
    if app_config is None:
        return
    if not isinstance(app_config, str):
        app_config = json.dumps(app_config, separators=(",", ":"), ensure_ascii=False)
    await artifact_service.save_artifact(
        app_name="orchestrator",
        user_id=user_id,
        session_id=session_id,
        filename="app_config.json",
        artifact=Part(text=app_config),
    )


@web_app.post("/r")
async def run_endpoint(request: Request):
    """SSE endpoint for agent to client communication"""

    # Parse JSON with error handling
    try:
        data = await request.json()
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in request body: {e}")
        return JSONResponse(
            status_code=400, content={"error": "Invalid JSON in request body", "detail": str(e)}
        )

    # Validate required fields
    user_id = data.get("user_id")
    session_id = data.get("session_id")
    operation_mode = data.get("operation_mode")
    payload = data.get("payload")

    missing_fields = []
    if not user_id:
        missing_fields.append("user_id")
    if not session_id:
        missing_fields.append("session_id")
    if not operation_mode:
        missing_fields.append("operation_mode")

    if missing_fields:
        logger.error(f"Missing required fields: {missing_fields}")
        return JSONResponse(
            status_code=422, content={"error": "Missing required fields", "missing": missing_fields}
        )

    VALID_OPERATION_MODES = {"create", "edit"}
    if operation_mode not in VALID_OPERATION_MODES:
        logger.error(f"Invalid operation_mode: {operation_mode}")
        return JSONResponse(
            status_code=422,
            content={
                "error": f"Invalid operation_mode: {operation_mode}",
                "valid": list(VALID_OPERATION_MODES),
            },
        )

    # Apply operator-configured runtime settings (LLM provider/key/model, image
    # keys) sent by the self-hosted runtime. No-op when absent (e.g. env-only or
    # production deployments), so the LLM falls back to the process environment.
    try:
        apply_runtime_settings(data.get("runtime_settings"))
    except Exception as e:  # never let settings application break a build
        logger.warning(f"Failed to apply runtime_settings: {e}")

    # ---------------------------------------------------------------------------
    # Caller verification.
    # Production: Cloud Run IAM is the first gate (--no-allow-unauthenticated);
    #   the IAM ID-token check here is application-level defense-in-depth.
    # Self-host/dev: a shared internal token, enforced UNCONDITIONALLY. The
    #   runtime worker's /agent/* reverse proxy authenticates nobody, so without
    #   this any internet visitor could POST /agent/r and burn the operator's
    #   LLM key. Credit/subscription checks are the caller's responsibility.
    # ---------------------------------------------------------------------------
    ok, status, error_message = authenticate_caller(request)
    if not ok:
        logger.warning(
            f"Caller verification failed: {error_message}",
            extra={"user_id": user_id, "operation_mode": operation_mode},
        )
        return JSONResponse(
            status_code=status, content={"error": "Forbidden", "message": error_message}
        )

    logger.info(f"request_accepted, operation_mode={operation_mode}")
    logger.info(f"User ID: {user_id}")
    logger.info(f"Session ID: {session_id}")

    # Concurrent session guard -- reject if the same session is already being
    # processed in this process (e.g., client retry before previous completes).
    # Atomic check-and-acquire: locked() + immediate acquire() with no await
    # in between prevents TOCTOU races (asyncio is single-threaded).
    session_lock = _get_session_lock(session_id)
    if session_lock.locked():
        logger.warning(f"Concurrent request rejected for session {session_id}")
        return JSONResponse(
            status_code=409,
            content={"error": "Session already being processed", "session_id": session_id},
        )
    await session_lock.acquire()

    # run agent - use lazy initialization for services
    session_service = get_session_service()
    artifact_service = get_artifact_service()

    runner = Runner(
        app=agent_app, session_service=session_service, artifact_service=artifact_service
    )

    # Get or create session (handle retries gracefully)
    try:
        session = await runner.session_service.get_session(
            app_name="orchestrator", user_id=user_id, session_id=session_id
        )
        if session is None:
            raise KeyError("session not found")
        logger.info(f"Reusing existing session: {session_id}")
    except (KeyError, ValueError):
        # Session doesn't exist, create it
        logger.info(f"Creating new session: {session_id}")
        session = await runner.session_service.create_session(
            app_name="orchestrator", user_id=user_id, session_id=session_id
        )

    # load payload data
    try:
        payload_data = json.loads(payload) if isinstance(payload, str) else payload
    except (json.JSONDecodeError, TypeError) as e:
        logger.error(f"Invalid JSON in payload field: {e}")
        _release_session(session_id)
        return JSONResponse(
            status_code=400, content={"error": "Invalid JSON in payload field", "detail": str(e)}
        )

    if not isinstance(payload_data, dict):
        logger.error(f"Payload must be a JSON object, got {type(payload_data).__name__}")
        _release_session(session_id)
        return JSONResponse(status_code=400, content={"error": "Payload must be a JSON object"})

    state_delta = {
        "operation_mode": operation_mode,
        "is_test": IS_TEST,  # Pass test mode flag to agent for backend notification bypass
    }
    for key, value in payload_data.items():
        state_delta[key] = value

    # Description-key compatibility shim. The creation/edit workflows read the
    # user's prompt from session state keys ``initial_description`` (primary) and
    # ``user_prompt`` (fallback) — the original Django backend's payload contract.
    # A client that sends only ``app_description`` (as the self-host orchestrate
    # route historically did) would leave both unset, so the Creator planned from
    # ``app_name`` alone and silently ignored the prompt. Backfill the canonical
    # keys from whichever description field the client provided so the prompt
    # always reaches the planner regardless of the sender's key choice.
    _desc = (
        state_delta.get("initial_description")
        or state_delta.get("app_description")
        or state_delta.get("user_prompt")
        or ""
    )
    if isinstance(_desc, str) and _desc.strip():
        if not state_delta.get("initial_description"):
            state_delta["initial_description"] = _desc
        if not state_delta.get("user_prompt"):
            state_delta["user_prompt"] = _desc
        # The EDIT-mode orchestrator (PipelineOrchestrator._handle_edit) routes on
        # ``state["current_prompt"]`` (StateKeys.CURRENT_PROMPT) — it becomes the
        # AppHelpDesk router's ``user_request``. The worker's edit payload sends the
        # turn prompt as app_description/initial_description/user_prompt but NEVER
        # current_prompt, so user_request arrived EMPTY: the router then limps by
        # inferring from chat_history and intermittently gives up ("no new user
        # request in this turn"), silently mis-routing a clear edit to help_desk
        # (observed live on deepseek). Backfill it from the same description field
        # so every edit turn reaches the router with its actual request.
        if not state_delta.get("current_prompt"):
            state_delta["current_prompt"] = _desc

    # Enforce chat_history bounds to prevent LLM context bloat and token waste.
    # A malicious or buggy client could send an unbounded list.
    MAX_CHAT_HISTORY_ENTRIES = int(os.getenv("MAX_CHAT_HISTORY_ENTRIES", "20"))
    chat_history = state_delta.get("chat_history")
    if isinstance(chat_history, list):
        # Coerce {role, content} turns to strings before anything else so the
        # downstream list[str] models (AppHelpDeskInput / SurveyorInput) can't
        # ValidationError mid-stream. Dedup below then compares clean strings.
        chat_history = _normalize_chat_history_entries(chat_history)
        # Remove consecutive duplicate messages (client retry artifacts)
        if len(chat_history) > 1:
            deduped: list = [chat_history[0]]
            for entry in chat_history[1:]:
                if entry != deduped[-1]:
                    deduped.append(entry)
            if len(deduped) < len(chat_history):
                logger.info(
                    f"Deduplicated chat_history from {len(chat_history)} "
                    f"to {len(deduped)} entries"
                )
                chat_history = deduped

        if len(chat_history) > MAX_CHAT_HISTORY_ENTRIES:
            original_count = len(chat_history)
            logger.info(
                f"Truncating chat_history from {original_count} "
                f"to {MAX_CHAT_HISTORY_ENTRIES} entries"
            )
            chat_history = chat_history[-MAX_CHAT_HISTORY_ENTRIES:]
            state_delta["_chat_history_truncated"] = True
            state_delta["_chat_history_original_count"] = original_count

        state_delta["chat_history"] = chat_history

    # --- G1: Idempotency check on correlation_id --------------------------
    correlation_id = state_delta.get("correlation_id")
    if correlation_id:
        _prune_inflight()
        if correlation_id in _INFLIGHT_CORRELATION_IDS:
            logger.warning(f"Duplicate request blocked: correlation_id={correlation_id}")
            _release_session(session_id)
            return JSONResponse(
                status_code=409,
                content={"error": "Duplicate request", "correlation_id": correlation_id},
            )
        _INFLIGHT_CORRELATION_IDS[correlation_id] = time.time()
        # Cap memory
        while len(_INFLIGHT_CORRELATION_IDS) > _IDEMPOTENCY_MAX_ENTRIES:
            _INFLIGHT_CORRELATION_IDS.popitem(last=False)

    # push to session state. If this await fails, we MUST release the
    # idempotency lock + session lock before returning, otherwise the
    # client's correlation_id stays stuck in ``_INFLIGHT_CORRELATION_IDS``
    # for the full TTL (default 1h) and every retry returns 409 until it
    # expires — the exact symptom reported by production logs on
    # 2026-04-21 (Cloud Tasks redelivery path).
    system_event = Event(
        author="TaskRunner",
        actions=EventActions(state_delta=state_delta),
        timestamp=time.time(),
    )
    try:
        await runner.session_service.append_event(session, system_event)
    except Exception as e:
        logger.error(
            f"append_event failed for session {session_id}, "
            f"correlation_id={correlation_id}: {e}",
            exc_info=True,
        )
        _release_inflight(correlation_id)
        _release_session(session_id)
        return JSONResponse(
            status_code=500,
            content={
                "error": "Failed to initialize agent workflow",
                "detail": str(e),
            },
        )

    # --- Per-turn session cleanup -------------------------------------------
    # ADK sessions are per-turn state and should be deleted after completion so
    # events and ephemeral state do not accumulate. ADK artifacts are not
    # per-turn scratch: builders, importers, replay/debug flows, and later turns
    # may need to reload them by app/user/session path. ADK delete_session does
    # not cascade to artifact storage, and that is intentional here.
    #
    # `workflow_failed` is retained in the signature for logging/metrics but no
    # longer changes control flow.
    async def cleanup(workflow_failed: bool = False):
        # INVARIANT: ``_release_inflight`` runs first and is purely
        # synchronous, so even if this coroutine is cancelled partway
        # through (client disconnect, asyncio cancellation, timeout) the
        # pop has already happened and the client can retry without
        # hitting the 409 duplicate-request guard.
        _release_inflight(correlation_id)

        try:
            await runner.session_service.delete_session(
                app_name="orchestrator", user_id=user_id, session_id=session_id
            )
        except Exception as del_err:
            logger.warning(f"Session delete failed for {session_id}: {del_err}")

        _release_session(session_id)

        if workflow_failed:
            logger.info(f"Session {session_id} cleaned up after failure (user {user_id})")
        else:
            logger.info(f"Session {session_id} cleaned up (user {user_id})")

    request_id = str(uuid_mod.uuid4())
    logger.info(
        f"Request {request_id}: Starting workflow for user={user_id} session={session_id} mode={operation_mode}"
    )

    async def event_generator():
        seen_event_ids = set()
        workflow_failed = False
        captured_events: list[dict] = []
        workflow_start = time.time()

        # Out-of-band cancellation (editor "Stop"). Clear any stale marker from a
        # prior run with this session_id, then run a watchdog that polls the
        # backend's cancel marker (+ is_disconnected as a best-effort fallback)
        # and trips cancel_event. _iter_with_cancel then aborts the run within a
        # few seconds even mid-phase. See the /cancel endpoint + _iter_with_cancel.
        await _clear_cancel_marker(session_id)
        cancel_event = asyncio.Event()

        async def _cancel_watchdog():
            while not cancel_event.is_set():
                try:
                    disconnected = await request.is_disconnected()
                except Exception:
                    disconnected = False
                if disconnected or await _cancel_marker_exists(session_id):
                    logger.warning(
                        f"Request {request_id}: cancel signal received — "
                        f"aborting in-flight workflow run"
                    )
                    cancel_event.set()
                    return
                try:
                    await asyncio.wait_for(cancel_event.wait(), timeout=_CANCEL_POLL_SECONDS)
                except asyncio.TimeoutError:
                    pass

        watchdog_task = asyncio.create_task(_cancel_watchdog())

        # Lock already held from the atomic check-and-acquire above.
        try:
            # run agent — wrapped so a Stop aborts promptly even during a long
            # phase that yields no events (plain `async for` can't be interrupted
            # mid-await).
            agen = runner.run_async(
                user_id=session.user_id,
                session_id=session.id,
                new_message=Content(role="user", parts=[Part(text="")]),
            )
            async for event in _iter_with_cancel(agen, cancel_event):
                if time.time() - workflow_start > WORKFLOW_TIMEOUT:
                    raise TimeoutError(f"Workflow exceeded {WORKFLOW_TIMEOUT}s timeout")
                try:
                    # Check if event has valid content structure
                    if event.content and event.content.parts and len(event.content.parts) > 0:

                        part = event.content.parts[0]

                        # Skip function calls and other non-text parts
                        if not hasattr(part, "text") or part.text is None:
                            logger.debug(f"Skipping non-text event (likely function call)")
                            continue

                        # Skip empty text
                        if not part.text or not part.text.strip():
                            logger.debug(f"Skipping empty text event")
                            continue

                        text = json.loads(part.text)

                        # Deduplication check using content hash
                        event_id = text.get("event_id") or (
                            f"{text.get('timestamp')}-{text.get('type')}-{text.get('action')}-"
                            f"{hashlib.sha256(part.text.encode()).hexdigest()[:16]}"
                        )
                        if event_id in seen_event_ids:
                            continue
                        seen_event_ids.add(event_id)

                        if text.get("type") in [
                            "progress",
                            "chat_message",
                            "page_reload",
                            "app_config_updated",
                            "backend_response",
                        ]:
                            captured_events.append(text)
                            yield f"event: message\n"
                            yield f"data: {json.dumps(text)}\n\n"

                except json.JSONDecodeError:
                    event_author = getattr(event, "author", "unknown")
                    logger.debug(f"Skipping non-JSON event from {event_author}")
                except (IndexError, AttributeError, TypeError) as e:
                    event_author = getattr(event, "author", "unknown")
                    text_preview = ""
                    try:
                        text_preview = getattr(part, "text", "")[:200]
                    except Exception:
                        pass
                    logger.error(
                        f"Unexpected error processing event from {event_author}: {e} | "
                        f"text_preview={text_preview!r}",
                        exc_info=True,
                    )

            # User pressed Stop: the run was aborted mid-flight by
            # _iter_with_cancel, so no app_config_updated/backend_response was
            # emitted — treat as failed so nothing partial is promoted/saved.
            if cancel_event.is_set():
                workflow_failed = True
                logger.warning(
                    f"Request {request_id}: workflow cancelled by user — "
                    f"partial build discarded (not saved)"
                )

            # Self-host: snapshot the assembled app_config to an artifact so the
            # local orchestrator can pull it via /artifacts after the run. Harmless
            # in cloud mode (the orchestrator simply never calls /artifacts there).
            if not workflow_failed and not cancel_event.is_set():
                try:
                    await _save_app_config_artifact(runner, artifact_service, user_id, session_id)
                except Exception as cfg_err:
                    logger.warning(
                        f"Failed to persist app_config artifact for "
                        f"session {session_id}: {cfg_err}"
                    )

        except Exception as e:
            workflow_failed = True
            logger.error(f"Error in SSE stream: {e}", exc_info=True)

            # Create and send failure notification to backend via SSE
            # This ensures the backend knows the workflow failed with status="failed"
            # 1. Send failure payload via SSE (for bridge to convert to error event)
            try:
                failure_payload = create_workflow_failure_payload(
                    error=e,
                    session_id=session_id,
                    state_delta=state_delta,
                )
                logger.info(f"Sending workflow failure notification: status=failed")
                captured_events.append(failure_payload)
                yield f"event: message\n"
                yield f"data: {json.dumps(failure_payload)}\n\n"
            except Exception as notify_error:
                logger.error(f"Failed to send failure notification via SSE: {notify_error}")

            # 2. Notify backend via HTTP callback (primary failure notification)
            # This MUST complete before the generator ends so the Cloud Tasks
            # handler sees the updated execution status in the DB.
            try:
                await _notify_backend_failure(
                    state_delta=state_delta,
                    error=e,
                    session_id=session_id,
                )
            except Exception as callback_error:
                logger.error(
                    f"Failed to notify backend of failure via HTTP: {callback_error}",
                    exc_info=True,
                )

        finally:
            # Stop the cancellation watchdog.
            cancel_event.set()
            if not watchdog_task.done():
                watchdog_task.cancel()

            # Belt-and-suspenders: release the idempotency lock as the
            # FIRST thing we do in the generator's finally. ``cleanup()``
            # does this too, but the test-export branch below awaits
            # ``export_test_run_data`` which could itself be cancelled
            # before cleanup runs — releasing here makes the guarantee
            # unconditional: once the generator starts exiting, the
            # correlation_id is free for retries even if every
            # subsequent ``await`` in this finally is cancelled.
            _release_inflight(correlation_id)

            if workflow_failed:
                logger.warning(f"Workflow failed for session {session_id}")
            if state_delta.get("is_test", False):
                try:
                    # Re-fetch session to get the latest state after the workflow.
                    # The original `session` variable is a deep copy from create_session()
                    # and does NOT reflect state updates made during the workflow (e.g. app_config).
                    export_session = (
                        await runner.session_service.get_session(
                            app_name="orchestrator", user_id=user_id, session_id=session_id
                        )
                        or session
                    )
                    await export_test_run_data(
                        runner=runner,
                        session=export_session,
                        request_data=data,
                        payload_data=payload_data,
                        request_id=request_id,
                        captured_events=captured_events,
                        workflow_failed=workflow_failed,
                    )
                except Exception as export_error:
                    logger.error(f"Failed to export test run data: {export_error}", exc_info=True)
            await cleanup(workflow_failed=workflow_failed)

    # G3: Let CORSMiddleware handle CORS uniformly — no manual headers here
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )


# Health check endpoint for E2E tests and load balancers
# Remove any existing /health GET route registered by upstream ADK app so this
# enriched health endpoint is the one clients/tests receive.
web_app.router.routes = [
    route
    for route in web_app.router.routes
    if not (isinstance(route, APIRoute) and route.path == "/health" and "GET" in route.methods)
]


@web_app.get("/artifacts/{session_id}")
async def list_session_artifacts(
    request: Request, session_id: str, user_id: str, app_name: str = "orchestrator"
):
    """Return the final artifact map for a session.

    The self-hosted orchestrator (runtime worker) calls this after a successful
    `/r` run to pull the build output (app config + compiled component JS +
    handler JS + theme/css) and write it to storage for deploy — replacing the
    GCS→backend push that the cloud build used. Text artifacts return as strings;
    binary artifacts return `{mime_type, base64}`.

    This endpoint returns the app's complete generated source, so it is
    authenticated like /r and /cancel (IAM in production, shared internal token
    in self-host/dev) — a session_id + user_id are otherwise guessable and were
    previously reachable unauthenticated through the worker's /agent/* proxy.
    """
    ok, status, message = authenticate_caller(request)
    if not ok:
        return JSONResponse(status_code=status, content={"error": "Forbidden", "message": message})
    svc = get_artifact_service()
    try:
        keys = await svc.list_artifact_keys(
            app_name=app_name, user_id=user_id, session_id=session_id
        )
    except Exception as e:  # noqa: BLE001
        return JSONResponse(status_code=500, content={"error": f"list_artifact_keys failed: {e}"})

    artifacts: dict[str, object] = {}
    for key in keys:
        try:
            part = await svc.load_artifact(
                app_name=app_name, user_id=user_id, session_id=session_id, filename=key
            )
        except Exception:  # noqa: BLE001
            continue
        if part is None:
            continue
        text = getattr(part, "text", None)
        if text is not None:
            artifacts[key] = text
            continue
        inline = getattr(part, "inline_data", None)
        if inline is not None and getattr(inline, "data", None) is not None:
            try:
                artifacts[key] = inline.data.decode("utf-8")
            except Exception:  # noqa: BLE001
                import base64

                artifacts[key] = {
                    "mime_type": getattr(inline, "mime_type", None),
                    "base64": base64.b64encode(inline.data).decode("ascii"),
                }

    return {
        "session_id": session_id,
        "user_id": user_id,
        "app_name": app_name,
        "artifacts": artifacts,
    }


@web_app.get("/health")
async def health_check():
    """Health check endpoint for server readiness."""
    checks = {"environment": ENVIRONMENT}

    # Check session service availability
    try:
        session_service = get_session_service()
        checks["session_service"] = "ok" if session_service is not None else "unavailable"
    except Exception:
        checks["session_service"] = "unavailable"

    # Check artifact service availability
    try:
        artifact_service = get_artifact_service()
        checks["artifact_service"] = "ok" if artifact_service is not None else "unavailable"
    except Exception:
        checks["artifact_service"] = "unavailable"

    all_ok = all(v == "ok" for k, v in checks.items() if k != "environment")
    checks["status"] = "ok" if all_ok else "degraded"

    return checks


# Export the FastAPI app for uvicorn
app = web_app

# Main execution
if __name__ == "__main__":
    import uvicorn

    # Self-hosted single-container: the agent runs on an INTERNAL port (default
    # 8081); the Node runtime fronts the public port and reverse-proxies /agent/*.
    uvicorn.run(web_app, host="127.0.0.1", port=int(os.getenv("PORT", "8081")))
