"""Per-slot edit-ownership tests for the parallel polish pool.

Production app b9kwhxdv (10-page Claude-Design import) had three polish
slots all writing ``MessagesContent.tsx`` within seconds — last-writer-
wins silently dropped two slots' edits. The v2 fix adds a hard whitelist
in ``edit_artifact_tool_impl``: when the caller is a polish slot
(``tool_context.agent_name`` starts with the polish-slot prefix), edits
to any file outside the slot's ``_polish_owned_files__<slot>`` list are
rejected before the source is loaded.

These tests pin that gate against the four observable behaviours:

* (a) polish slot writing its owned entry file — ownership check PASSES;
* (b) polish slot writing an unowned file — REJECTED with terminal=True;
* (c) non-polish caller (creation flow, single-action edit) — ownership
       check SKIPPED entirely (gate is polish-slot-only);
* (d) polish slot with empty owned list — REJECTED (fail-closed).
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
    edit_artifact_tool_impl,
)

pytestmark = [pytest.mark.unit]


class _InlineData:
    def __init__(self, body: str) -> None:
        self.data = body.encode("utf-8")


class _Artifact:
    def __init__(self, body: str) -> None:
        self.inline_data = _InlineData(body)


class _MockToolContext:
    """Minimal ToolContext stand-in covering only the methods the
    ownership gate (and the early not-found path it falls through to)
    touches. The validation pipeline below the gate is NOT invoked by
    these tests — the gate fires before source load."""

    def __init__(
        self,
        *,
        artifacts: dict[str, str] | None = None,
        state: dict | None = None,
        agent_name: str = "ComponentBuilderMultiple",
    ) -> None:
        self._store: dict[str, str] = dict(artifacts or {})
        self.state: dict = state if state is not None else {}
        self.actions = SimpleNamespace(escalate=False)
        self.agent_name = agent_name

    async def list_artifacts(self) -> list[str]:
        return sorted(self._store.keys())

    async def load_artifact(self, filename: str):
        body = self._store.get(filename)
        if body is None:
            return None
        return _Artifact(body)


class TestPolishSlotEditOwnership:
    async def test_polish_slot_unowned_file_rejected_with_terminal(self):
        """(b) Polish slot edits a file outside its owned set →
        rejected with ``terminal: True`` so the slot agent loop ends."""
        slot = "component_builder_multiple_polish_slot_1"
        ctx = _MockToolContext(
            agent_name=slot,
            state={
                "_polish_owned_files__component_builder_multiple_polish_slot_1": [
                    "codefocus_component:MyEntry.tsx"
                ]
            },
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_component:SharedShell.tsx",
            old_string="foo",
            new_string="bar",
        )
        assert result["ok"] is False
        assert result["edits_applied"] == 0
        assert result.get("terminal") is True
        # Error message references the canonical owned-files list.
        assert "codefocus_component:SharedShell.tsx" in result["error"]
        assert "codefocus_component:MyEntry.tsx" in result["error"]

    async def test_polish_slot_owned_file_passes_ownership_check(self):
        """(a) Polish slot edits its owned file → ownership check
        PASSES. We don't run the full validator chain, so the call
        falls through to the next gate (artifact not found in the
        in-memory store), proving the ownership check returned None."""
        slot = "component_builder_multiple_polish_slot_2"
        ctx = _MockToolContext(
            agent_name=slot,
            state={
                "_polish_owned_files__component_builder_multiple_polish_slot_2": [
                    "codefocus_component:MyEntry.tsx"
                ]
            },
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_component:MyEntry.tsx",
            old_string="foo",
            new_string="bar",
        )
        # If ownership had rejected, we'd see a "not permitted from this
        # polish slot" error. Instead we see the not-found path (since
        # the in-memory store is empty), proving the gate let us pass.
        assert result["ok"] is False
        assert "not permitted from this polish slot" not in result.get(
            "error", ""
        )
        assert "not found in session storage" in result["error"]

    async def test_non_polish_caller_skips_ownership_check(self):
        """(c) Non-polish caller (creation flow, single-action edit) →
        the gate is polish-slot-only; the ownership state is absent and
        the call falls through unchanged."""
        ctx = _MockToolContext(
            agent_name="ComponentBuilderMultiple",  # non-polish
            state={},  # no _polish_owned_files__* keys
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_component:AnyFile.tsx",
            old_string="foo",
            new_string="bar",
        )
        # The polish-slot rejection branch must NOT trigger; the call
        # proceeds and hits the not-found path.
        assert "not permitted from this polish slot" not in result.get(
            "error", ""
        )
        assert "not found in session storage" in result["error"]

    async def test_polish_slot_empty_owned_list_rejects(self):
        """(d) Polish slot with empty / missing owned-files list →
        rejected. Fail-closed: better to block the write than to leak a
        cross-slot collision when round-setup forgot to seed the list."""
        slot = "component_builder_multiple_polish_slot_3"
        ctx = _MockToolContext(
            agent_name=slot,
            state={},  # _polish_owned_files__slot_3 absent entirely
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_component:AnyFile.tsx",
            old_string="foo",
            new_string="bar",
        )
        assert result["ok"] is False
        assert result["edits_applied"] == 0
        assert result.get("terminal") is True
        assert "not permitted from this polish slot" in result["error"]

    async def test_polish_slot_theme_css_blocked_before_ownership(self):
        """Theme.css guard runs BEFORE the ownership gate, so the
        existing add_theme_tokens-only contract still wins for polish
        slots. We assert the theme-specific error fires, not the
        ownership error."""
        slot = "component_builder_multiple_polish_slot_1"
        ctx = _MockToolContext(
            agent_name=slot,
            state={
                "_polish_owned_files__component_builder_multiple_polish_slot_1": [
                    "codefocus_style:theme.css"
                ]
            },
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_style:theme.css",
            old_string="foo",
            new_string="bar",
        )
        assert result["ok"] is False
        assert "add_theme_tokens" in result["error"]
