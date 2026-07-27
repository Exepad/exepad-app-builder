"""E2E tests for the Code Focus editing workflow via /r endpoint.

Tests exercise the full editing pipeline against a realistic Code Focus
app config. The editor agent, component builder, validation pipeline,
and assembly service all run with real LLM calls against a running server.

Source rehydration is bypassed by sending an empty app_uuid, so no GCS
is needed. The dependency map will be empty (no TSX sources to scan),
but the editor can still reason about the app structure from app_config.

Usage:
    # Start server in terminal 1:
    python agent_api.py

    # Run tests in terminal 2:
    pytest tests/e2e/test_editing_workflow.py -v

    # Run a single test:
    pytest tests/e2e/test_editing_workflow.py::TestEditorGenericEdits::test_modify_component_text -v
"""

import json

import httpx
import pytest
import pytest_asyncio

from .fixtures import load_app_config

# Mark all tests in this module as e2e and async
pytestmark = [
    pytest.mark.e2e,
    pytest.mark.asyncio,
    pytest.mark.filterwarnings("ignore::DeprecationWarning"),
]


# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def codefocus_app_config():
    """Load the Code Focus webapp fixture config."""
    return load_app_config("codefocus_webapp")


@pytest_asyncio.fixture
async def editing_client():
    """Create an async client that connects to the running local server.

    Requires a server running at localhost:8080 (start with: python agent_api.py).
    The server process holds the Vertex AI / Gemini credentials, so we
    connect to it externally rather than creating an in-process ASGI app.
    """
    import os

    server_url = os.getenv("E2E_SERVER_URL", "http://localhost:8080")
    async with httpx.AsyncClient(
        base_url=server_url,
        timeout=httpx.Timeout(connect=10.0, read=None, write=30.0, pool=10.0),
    ) as client:
        # Verify server is running
        try:
            resp = await client.get("/health", timeout=5.0)
            resp.raise_for_status()
        except (httpx.ConnectError, httpx.HTTPStatusError) as e:
            pytest.skip(f"Server not running at {server_url}: {e}")
        yield client


@pytest.fixture
def make_edit_payload():
    """Factory for creating edit payloads against any Code Focus config.

    Returns a callable:
        payload = make_edit_payload(config, "Change the heading to say Hello")
    """
    import uuid as uuid_mod

    def _create(app_config, prompt, **kwargs):
        uid = uuid_mod.uuid4().hex[:12]
        payload_data = {
            "app_config": json.dumps(app_config, separators=(",", ":"), ensure_ascii=False),
            # Empty app_uuid so rehydration is skipped (no GCS in local tests).
            # The rehydrate_sources function returns early with empty stats,
            # leaving 0 missing components so the fast-fail guard doesn't trigger.
            # The dependency map will be empty (no TSX sources to scan), but the
            # editor can still reason about the app structure from app_config.
            "app_uuid": "",
            "app_name": app_config.get("name", "Test App"),
            "app_language_code": "en",
            "current_prompt": prompt,
            "chat_history": [],
            "is_test": True,
            **kwargs,
        }
        return {
            "operation_mode": "edit",
            "user_id": f"test-user-{uid}",
            "session_id": f"test-session-{uid}",
            "payload": json.dumps(payload_data),
        }

    return _create


# ============================================================================
# SSE HELPERS — parse streaming response from in-process ASGI client
# ============================================================================


async def parse_sse_response(response) -> list[dict]:
    """Parse SSE events from an httpx streaming response."""
    events = []
    buffer = ""
    async for chunk in response.aiter_text():
        buffer += chunk
        while "\n\n" in buffer:
            block, buffer = buffer.split("\n\n", 1)
            for line in block.split("\n"):
                if line.startswith("data: "):
                    try:
                        events.append(json.loads(line[6:]))
                    except json.JSONDecodeError:
                        pass
    return events


def get_events_by_type(events: list[dict], event_type: str) -> list[dict]:
    """Filter events by type."""
    return [e for e in events if e.get("type") == event_type]


def get_final_app_config(events: list[dict]) -> dict | None:
    """Extract the final app_config from events."""
    # Check app_config_updated events
    config_events = get_events_by_type(events, "app_config_updated")
    if config_events:
        return config_events[-1].get("app_config")
    # Check backend_response events
    backend_events = get_events_by_type(events, "backend_response")
    for be in reversed(backend_events):
        callback = be.get("callback_data", {})
        state = callback.get("session_state", {})
        config_str = state.get("app_config")
        if config_str:
            try:
                return json.loads(config_str) if isinstance(config_str, str) else config_str
            except (json.JSONDecodeError, TypeError):
                pass
    return None


def get_progress_messages(events: list[dict]) -> list[str]:
    """Extract human-readable progress messages."""
    return [
        e.get("message", e.get("internal_message", ""))
        for e in get_events_by_type(events, "progress")
        if e.get("message") or e.get("internal_message")
    ]


def get_error_messages(events: list[dict]) -> list[str]:
    """Extract error messages from progress events."""
    return [
        e.get("message", e.get("internal_message", ""))
        for e in events
        if e.get("action") == "error" or e.get("type") == "error"
    ]


# ============================================================================
# APP CONFIG ASSERTION HELPERS
# ============================================================================


def get_page_count(config: dict) -> int:
    """Count pages in the config."""
    return len(config.get("frontend", {}).get("pages", []))


def get_page_by_slug(config: dict, slug: str) -> dict | None:
    """Find a page by slug."""
    for page in config.get("frontend", {}).get("pages", []):
        if page.get("slug") == slug:
            return page
    return None


def get_repo_component_names(config: dict) -> set[str]:
    """Return component names from repo.frontend.components."""
    repo = config.get("repo", {}) or {}
    return set((repo.get("frontend", {}) or {}).get("components", {}).keys())


def get_handler_names(config: dict) -> list[str]:
    """Return handler names from backend.handlers."""
    return [
        h.get("name", "")
        for h in (config.get("backend", {}) or {}).get("handlers", [])
        if isinstance(h, dict) and h.get("name")
    ]


def has_model(config: dict, model_name: str) -> bool:
    """Check if a model exists in backend.models."""
    for m in (config.get("backend", {}) or {}).get("models", []):
        if isinstance(m, dict) and m.get("name") == model_name:
            return True
    return False


# ============================================================================
# CORE TEST HELPER
# ============================================================================


async def run_edit(client, payload, timeout=300) -> tuple[list[dict], dict | None]:
    """Send an edit request and return (events, app_config).

    app_config is None if the workflow produced no config update.
    """
    async with client.stream("POST", "/r", json=payload, timeout=timeout) as response:
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        events = await parse_sse_response(response)

    app_config = get_final_app_config(events)
    return events, app_config


# ============================================================================
# TESTS — Generic editor requests (full planning pipeline)
# ============================================================================


class TestEditorGenericEdits:
    """Tests for the full editing workflow with Code Focus apps.

    Each test sends a real edit request through the in-process FastAPI app.
    Flow: /r endpoint → ADK Runner → PipelineOrchestrator → AppHelpDesk →
    Editor agent → phase runners → validation → assembly.

    Source rehydration is patched to inject local TSX sources so the
    dependency map builder and editor have real component code to analyze.
    """

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_modify_component_text(
        self, editing_client, codefocus_app_config, make_edit_payload
    ):
        """Edit: change text in an existing component.

        Expected: Editor emits FrontendBuildAction for DashboardContent,
        component builder rewrites the TSX, validation passes, assembly
        produces a valid config.
        """
        payload = make_edit_payload(
            codefocus_app_config,
            "Change the Dashboard heading from 'Dashboard' to 'My Task Overview'",
        )

        events, app_config = await run_edit(editing_client, payload)

        progress = get_progress_messages(events)
        errors = get_error_messages(events)
        assert app_config is not None, (
            f"Workflow did not produce an app_config.\n"
            f"Progress: {progress}\n"
            f"Errors: {errors}"
        )
        # Original structure preserved
        assert get_page_count(app_config) >= 2
        assert get_page_by_slug(app_config, "/") is not None
        assert get_page_by_slug(app_config, "/tasks") is not None
        assert "DashboardContent" in get_repo_component_names(app_config)
        assert "AppHeader" in get_repo_component_names(app_config)

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_add_page(self, editing_client, codefocus_app_config, make_edit_payload):
        """Edit: add a new page to the app.

        Expected: Editor emits FrontendBuildAction(page_creates=[...]) describing the new page + nav link cascade,
        new page appears in config, header gets a nav link.
        """
        payload = make_edit_payload(
            codefocus_app_config,
            "Add a Settings page at /settings where users can update their profile name and email",
        )

        events, app_config = await run_edit(editing_client, payload)

        errors = get_error_messages(events)
        assert app_config is not None, (
            f"Workflow did not produce an app_config.\n" f"Errors: {errors}"
        )
        # New page should exist
        assert (
            get_page_count(app_config) >= 3
        ), f"Expected at least 3 pages (home + tasks + settings), got {get_page_count(app_config)}"
        assert get_page_by_slug(app_config, "/settings") is not None
        # Original pages preserved
        assert get_page_by_slug(app_config, "/") is not None
        assert get_page_by_slug(app_config, "/tasks") is not None

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_modify_styles(self, editing_client, codefocus_app_config, make_edit_payload):
        """Edit: change the app's color scheme.

        Expected: Editor emits ModifyStylesAction, design system builder
        regenerates theme.css.
        """
        payload = make_edit_payload(
            codefocus_app_config,
            "Change the primary color to dark blue (#1E3A5F) and the surface color to light gray (#F5F5F5)",
        )

        events, app_config = await run_edit(editing_client, payload)

        errors = get_error_messages(events)
        assert app_config is not None, (
            f"Workflow did not produce an app_config.\n" f"Errors: {errors}"
        )
        # App structure should be unchanged
        assert get_page_count(app_config) == 2
        assert "DashboardContent" in get_repo_component_names(app_config)
        assert "TaskListContent" in get_repo_component_names(app_config)

        # A successful edit MUST emit app_config_updated with reload_app=True
        # so the iframe auto-refreshes. Regression for TC-002 in
        # session-20260428T103349 where the preview required a manual reload.
        config_events = get_events_by_type(events, "app_config_updated")
        assert config_events, (
            "Successful theme edit did not emit any app_config_updated event "
            "— the preview iframe will not refresh."
        )
        assert config_events[-1].get("reload_app") is True, (
            f"app_config_updated emitted with reload_app="
            f"{config_events[-1].get('reload_app')}, expected True. "
            f"Without reload_app=True the frontend will not bump the iframe src."
        )

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_add_backend_column_with_cascade(
        self, editing_client, codefocus_app_config, make_edit_payload
    ):
        """Edit: add a column to a model — triggers cascade to handlers + components.

        Expected: Editor emits ChangeBackendModelsAction + ModifyHandlerAction
        for getTasks + paired FrontendBuildAction targeting DashboardContent and
        TaskListContent (per dependency_map cascade).
        """
        payload = make_edit_payload(
            codefocus_app_config,
            "Add a 'priority' column to the tasks model (text, required, default 'medium'). "
            "Show priority as a colored badge in both the task list and the dashboard.",
        )

        events, app_config = await run_edit(editing_client, payload)

        errors = get_error_messages(events)
        assert app_config is not None, (
            f"Workflow did not produce an app_config.\n" f"Errors: {errors}"
        )
        # Backend should still have the tasks model
        assert has_model(app_config, "tasks"), "Tasks model should still exist"
        # Both pages should still work
        assert get_page_by_slug(app_config, "/") is not None
        assert get_page_by_slug(app_config, "/tasks") is not None

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_add_handler(self, editing_client, codefocus_app_config, make_edit_payload):
        """Edit: add a new handler and wire it to a component.

        Expected: Editor emits AddHandlerAction + paired FrontendBuildAction.
        """
        payload = make_edit_payload(
            codefocus_app_config,
            "Add a new handler called 'getTaskStats' that returns the count of "
            "tasks grouped by status (pending, completed, in_progress). "
            "Use it in the Dashboard to show a status breakdown.",
        )

        events, app_config = await run_edit(editing_client, payload)

        errors = get_error_messages(events)
        assert app_config is not None, (
            f"Workflow did not produce an app_config.\n" f"Errors: {errors}"
        )
        handlers = get_handler_names(app_config)
        assert len(handlers) >= 3, (
            f"Expected at least 3 handlers (getTasks + createTask + getTaskStats), "
            f"got {len(handlers)}: {handlers}"
        )

    @pytest.mark.e2e
    @pytest.mark.slow
    async def test_remove_page(self, editing_client, codefocus_app_config, make_edit_payload):
        """Edit: remove a page from the app.

        Expected: Editor emits FrontendBuildAction(page_removes=[...]) describing the page removal + nav cleanup cascade
        to remove the nav link.
        """
        payload = make_edit_payload(
            codefocus_app_config,
            "Remove the Tasks page entirely",
        )

        events, app_config = await run_edit(editing_client, payload)

        errors = get_error_messages(events)
        assert app_config is not None, (
            f"Workflow did not produce an app_config.\n" f"Errors: {errors}"
        )
        # Tasks page should be gone, home page must remain
        assert get_page_by_slug(app_config, "/") is not None, "Home page must still exist"
        assert (
            get_page_count(app_config) < 3
        ), f"Expected fewer than 3 pages after removal, got {get_page_count(app_config)}"
