"""Integration test — Tier-2 fix-up retry loop convergence.

Exercises ``EditingWorkflow._run_tier2_fix_up_loop`` with a mocked
``ComponentBuilderMultiple`` runner. First invocation leaves a broken
Page (placeholder div); the simulated retry rewrites Page to a clean
version. The loop must:

  1. Run the sweep, see the error,
  2. Re-invoke the agent (one mock call),
  3. Re-run the sweep, see no errors, and exit.

The test does NOT spin up the real LLM or ADK runner; it stubs
``_run_agent_with_metrics`` to drive the staged sources.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytestmark = [pytest.mark.integration]


_BROKEN_PAGE = (
    'import { React } from "@exepad/sdk";\n'
    'import { LABELS } from "./DataLib";\n'
    'export default function Page() {\n'
    '  return (<div>{LABELS[0]}'
    '<div className="bg-gray-200 flex items-center justify-center">'
    '<span className="text-gray-500">Map placeholder</span></div></div>);\n'
    '}\n'
)
_CLEAN_PAGE = (
    'import { React } from "@exepad/sdk";\n'
    'import { LABELS } from "./DataLib";\n'
    'export default function Page() {\n'
    '  return <div>{LABELS[0]}</div>;\n'
    '}\n'
)
_DATALIB = 'export const LABELS = ["a", "b"];\n'


class _StubInline:
    def __init__(self, data: bytes):
        self.data = data


class _StubArtifact:
    def __init__(self, data: bytes):
        self.inline_data = _StubInline(data)


class _StubArtifactService:
    def __init__(self, store: dict[str, bytes]):
        self.store = store

    async def list_artifact_keys(self, **_):
        return list(self.store.keys())

    async def load_artifact(self, *, filename: str, **_):
        data = self.store.get(filename)
        return _StubArtifact(data) if data is not None else None


class _StubSession:
    def __init__(self, store: dict[str, bytes]):
        self.id = "sess"
        self.user_id = "u"
        self.app_name = "app"
        self.state: dict = {
            "_files_modified_this_turn": [
                "codefocus_module:DataLib.tsx",
                "codefocus_component:Page.tsx",
            ],
            "_files_created_this_turn": [],
            "_validation_context_models": [],
            "_validation_context_handlers": [],
            "_validation_context_logic": {},
            "_validation_context_page_slugs": [],
            "_validation_context_theme_palette": {},
        }
        self._store = store


class _StubCtx:
    def __init__(self, store: dict[str, bytes]):
        self.session = _StubSession(store)
        self.artifact_service = _StubArtifactService(store)
        self.invocation_id = "inv-1"


async def _empty_async_iter() -> AsyncGenerator[Any, None]:
    if False:  # pragma: no cover
        yield None


async def test_fix_up_loop_converges_after_one_retry(monkeypatch) -> None:
    """First sweep finds errors; one mock retry fixes them; loop exits clean."""

    from main_agent.agents.orchestrator.app_types.webapp.workflows import (
        editing_workflow as ew,
    )

    store: dict[str, bytes] = {
        "codefocus_module:DataLib.tsx": _DATALIB.encode(),
        "codefocus_component:Page.tsx": _BROKEN_PAGE.encode(),
    }

    # Patch ``collect_frontend_artifact_sources`` to read from our stub store.
    async def fake_collect(_ctx):
        return {fname: data.decode("utf-8") for fname, data in store.items()}

    monkeypatch.setattr(
        ew, "collect_frontend_artifact_sources", fake_collect
    )

    # Patch ``push_session_state_update`` to write straight into state dict.
    async def fake_push_state(ctx, updates):
        ctx.session.state.update(updates)

    monkeypatch.setattr(ew, "push_session_state_update", fake_push_state)

    # Patch ``push_prompt_to_next_agent`` to a no-op.
    async def fake_push_prompt(_ctx, _payload):
        pass

    monkeypatch.setattr(ew, "push_prompt_to_next_agent", fake_push_prompt)

    # Build a minimal workflow stub. We only invoke the Tier-2 helper.
    workflow = ew.EditingWorkflow.__new__(ew.EditingWorkflow)
    workflow.component_builder_multiple_agent = MagicMock()

    # Stub ``_run_agent_with_metrics`` — when invoked, simulate the agent
    # rewriting Page to the clean variant.
    invocation_counter = {"n": 0}

    async def fake_run_agent(_ctx, _agent, _name, _metrics):
        invocation_counter["n"] += 1
        # The mock "agent" replaces Page with the clean version.
        store["codefocus_component:Page.tsx"] = _CLEAN_PAGE.encode()
        if False:  # pragma: no cover - keep generator
            yield None
        return

    workflow._run_agent_with_metrics = fake_run_agent  # type: ignore

    # Build a minimal state-like object.
    state = SimpleNamespace(
        design_system_context="",
        backend_surface_for_builder=lambda: "{}",
        logic_surface="",
        app_context_json=lambda: "{}",
        image_urls_json=lambda: "{}",
        app_language_code="en",
        metrics_tracker=None,
    )

    ctx = _StubCtx(store)

    # Run the loop.
    events = []
    async for ev in workflow._run_tier2_fix_up_loop(
        ctx, state, action=None, original_prompt="Build the page."
    ):
        events.append(ev)

    # Mock agent should have been invoked exactly once (the retry).
    assert invocation_counter["n"] == 1, (
        f"expected 1 retry invocation, got {invocation_counter['n']}"
    )
    # No agent_errors should be set: the loop converged.
    from main_agent.constants import StateKeys

    assert not ctx.session.state.get(StateKeys.AGENT_ERRORS), (
        f"unexpected agent_errors: {ctx.session.state.get(StateKeys.AGENT_ERRORS)}"
    )


async def test_fix_up_loop_records_terminal_failure_when_unfixed(
    monkeypatch,
) -> None:
    """If the retry doesn't fix the issue, the loop appends a phase-level error."""

    from main_agent.agents.orchestrator.app_types.webapp.workflows import (
        editing_workflow as ew,
    )

    store: dict[str, bytes] = {
        "codefocus_module:DataLib.tsx": _DATALIB.encode(),
        "codefocus_component:Page.tsx": _BROKEN_PAGE.encode(),
    }

    async def fake_collect(_ctx):
        return {fname: data.decode("utf-8") for fname, data in store.items()}

    monkeypatch.setattr(
        ew, "collect_frontend_artifact_sources", fake_collect
    )

    async def fake_push_state(ctx, updates):
        ctx.session.state.update(updates)

    monkeypatch.setattr(ew, "push_session_state_update", fake_push_state)

    async def fake_push_prompt(_ctx, _payload):
        pass

    monkeypatch.setattr(ew, "push_prompt_to_next_agent", fake_push_prompt)

    workflow = ew.EditingWorkflow.__new__(ew.EditingWorkflow)
    workflow.component_builder_multiple_agent = MagicMock()

    async def fake_run_agent_no_op(_ctx, _agent, _name, _metrics):
        # Mock agent does nothing — broken page stays broken.
        if False:  # pragma: no cover
            yield None
        return

    workflow._run_agent_with_metrics = fake_run_agent_no_op  # type: ignore

    state = SimpleNamespace(
        design_system_context="",
        backend_surface_for_builder=lambda: "{}",
        logic_surface="",
        app_context_json=lambda: "{}",
        image_urls_json=lambda: "{}",
        app_language_code="en",
        metrics_tracker=None,
    )

    ctx = _StubCtx(store)

    async for _ in workflow._run_tier2_fix_up_loop(
        ctx, state, action=None, original_prompt="Build the page."
    ):
        pass

    from main_agent.constants import StateKeys

    errors = ctx.session.state.get(StateKeys.AGENT_ERRORS, []) or []
    assert any("Tier-2 fix-up exhausted" in e for e in errors), (
        f"expected terminal failure marker, got: {errors}"
    )
