"""Prefix-allowlist guardrail tests.

The plan deliberately replaces the legacy scalar-name guard with a
prefix-allowlist that enforces:

- Write tools (``edit_artifact_tool``, ``validate_and_save_tsx_*``) accept
  ONLY ``codefocus_component:``, ``codefocus_module:``, ``codefocus_style:``.
- Delete tool (``delete_artifact_tool``) accepts ONLY
  ``codefocus_component:``, ``codefocus_module:``.
- Backend prefixes (``handler_code:*``, ``backend.json``, ``seed:*``) are
  REJECTED with a message redirecting the LLM to the dedicated action.

These guards are the only safety surface the agent has — the prompt is
the constraint, but a hallucinated filename must never silently leak into
the backend namespace. Regression-critical.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
    _FRONTEND_DELETE_PREFIXES,
    _FRONTEND_WRITE_PREFIXES,
    _is_frontend_delete_target,
    _is_frontend_write_target,
    delete_artifact_tool_impl,
    edit_artifact_tool_impl,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Mock ToolContext
# --------------------------------------------------------------------------- #


class _Inline:
    def __init__(self, body: str) -> None:
        self.data = body.encode("utf-8")


class _Artifact:
    def __init__(self, body: str) -> None:
        self.inline_data = _Inline(body)


class _MockToolContext:
    def __init__(self, artifacts: dict[str, str] | None = None, state: dict | None = None):
        self._store: dict[str, str] = dict(artifacts or {})
        self.state = state or {}
        self.actions = SimpleNamespace(escalate=False)
        self.agent_name = "ComponentBuilderMultiple"

    async def list_artifacts(self) -> list[str]:
        return sorted(self._store.keys())

    async def load_artifact(self, filename: str):
        body = self._store.get(filename)
        if body is None:
            return None
        return _Artifact(body)

    async def save_artifact(self, *, filename: str, artifact) -> int:
        self._store[filename] = artifact.inline_data.data.decode("utf-8")
        return 1

    async def delete_artifact(self, *, filename: str) -> None:
        self._store.pop(filename, None)


# --------------------------------------------------------------------------- #
# Allowlist constants are canonical
# --------------------------------------------------------------------------- #


class TestAllowlistConstants:
    def test_write_prefixes_are_canonical(self):
        # Plan §2b: the write surface includes theme.css; the delete
        # surface explicitly excludes it (theme edits go through
        # ModifyStylesAction / add_theme_tokens).
        assert _FRONTEND_WRITE_PREFIXES == (
            "codefocus_component:",
            "codefocus_module:",
            "codefocus_style:",
        )

    def test_delete_prefixes_exclude_styles(self):
        assert _FRONTEND_DELETE_PREFIXES == (
            "codefocus_component:",
            "codefocus_module:",
        )

    def test_helpers_match_constants(self):
        for prefix in _FRONTEND_WRITE_PREFIXES:
            assert _is_frontend_write_target(prefix + "Foo.tsx")
        for prefix in _FRONTEND_DELETE_PREFIXES:
            assert _is_frontend_delete_target(prefix + "Foo.tsx")
        # Theme is writeable but not deletable
        assert _is_frontend_write_target("codefocus_style:theme.css")
        assert not _is_frontend_delete_target("codefocus_style:theme.css")

    def test_helpers_reject_backend_prefixes(self):
        for backend in (
            "handler_code:do_thing.tsx",
            "backend.json",
            "logic.json",
            "seed:students.csv",
            "skeleton.json",
            "page:home.json",
            "section_1.json",
            "content:home:hero.md",
        ):
            assert not _is_frontend_write_target(backend), backend
            assert not _is_frontend_delete_target(backend), backend


# --------------------------------------------------------------------------- #
# edit_artifact_tool_impl — write-side prefix guard
# --------------------------------------------------------------------------- #


class TestEditArtifactPrefixGuard:
    @pytest.mark.parametrize(
        "filename",
        [
            "handler_code:do_thing.tsx",
            "backend.json",
            "logic.json",
            "seed:students.csv",
            "skeleton.json",
            "page:home.json",
            "Hero.tsx",  # no prefix at all
        ],
    )
    async def test_rejects_non_frontend_filenames(self, filename):
        ctx = _MockToolContext(artifacts={filename: "anything"})
        result = await edit_artifact_tool_impl(
            ctx, filename=filename, old_string="anything", new_string="x"
        )
        assert result["ok"] is False
        assert result["edits_applied"] == 0
        # Error message must redirect the LLM at the correct domain action
        assert "AddHandlerAction" in result["error"] or "frontend artifacts" in result["error"]

    async def test_theme_css_routes_to_add_theme_tokens_action(self):
        # theme.css is in the WRITE allowlist but ``edit_artifact`` cannot
        # touch it directly — narrow rewrites go through add_theme_tokens
        # / ModifyStylesAction. Plan §2e.
        ctx = _MockToolContext(
            artifacts={"codefocus_style:theme.css": "@theme { --color-primary: #000; }"}
        )
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_style:theme.css",
            old_string="--color-primary",
            new_string="--color-secondary",
        )
        assert result["ok"] is False
        assert "add_theme_tokens" in result["error"] or "ModifyStylesAction" in result["error"]


# --------------------------------------------------------------------------- #
# delete_artifact_tool_impl — delete-side prefix guard
# --------------------------------------------------------------------------- #


class TestDeleteArtifactPrefixGuard:
    @pytest.mark.parametrize(
        "filename",
        [
            "handler_code:do_thing.tsx",
            "backend.json",
            "logic.json",
            "seed:students.csv",
            "skeleton.json",
            "page:home.json",
            "section_1.json",
            "codefocus_style:theme.css",  # deletable surface excludes theme
            "Hero.tsx",
        ],
    )
    async def test_rejects_non_deletable_filenames(self, filename):
        ctx = _MockToolContext(artifacts={filename: "anything"})
        result = await delete_artifact_tool_impl(ctx, filename=filename)
        assert result["deleted"] is False
        # Redirect message points at the correct dedicated action.
        assert (
            "RemoveHandlerAction" in result["error"]
            or "ModifyStylesAction" in result["error"]
            or "codefocus_component" in result["error"]
        )


# --------------------------------------------------------------------------- #
# Allowlisted prefixes are never silently rejected by the prefix guard
# --------------------------------------------------------------------------- #


class TestAllowlistedHappyPath:
    async def test_edit_artifact_does_not_reject_codefocus_component(self):
        # Even when we don't pre-stage the artifact (so the actual splice
        # will fail with "not found"), the PREFIX GUARD must not be the
        # rejection reason — the error should be artifact-not-found, not
        # a prefix violation.
        ctx = _MockToolContext(artifacts={})
        result = await edit_artifact_tool_impl(
            ctx,
            filename="codefocus_component:Hero.tsx",
            old_string="x",
            new_string="y",
        )
        assert result["ok"] is False
        # The error must be the not-found error, NOT the redirect message.
        assert "not found" in result["error"].lower()
        assert "AddHandlerAction" not in result["error"]

    async def test_delete_artifact_does_not_reject_codefocus_module(self):
        ctx = _MockToolContext(artifacts={})
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Charts.tsx"
        )
        assert result["deleted"] is False
        # Reason should be artifact-not-found (or similar), NOT prefix.
        assert "RemoveHandlerAction" not in result["error"]
        assert "ModifyStylesAction" not in result["error"]


# --------------------------------------------------------------------------- #
# Importer pre-check on delete (regression — Plan §2d)
# --------------------------------------------------------------------------- #


class TestDeleteImporterPreCheck:
    async def test_blocks_delete_when_importer_remains(self):
        # Card is imported by Page; deleting Card alone would orphan Page.
        ctx = _MockToolContext(
            artifacts={
                "codefocus_module:Card.tsx": (
                    'import { React } from "@exepad/sdk";\n'
                    "export function Card(){return null}\n"
                ),
                "codefocus_component:Page.tsx": (
                    'import { React } from "@exepad/sdk";\n'
                    'import { Card } from "./Card";\n'
                    "export default function Page(){return <Card/>}\n"
                ),
            }
        )
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Card.tsx"
        )
        assert result["deleted"] is False
        assert "still imported by" in result["error"]
        # Importer is in the rejection payload so the LLM can fix it next.
        assert any("Page" in i for i in result.get("importers", []))

    async def test_allows_delete_when_importer_is_also_in_same_turn_set(self):
        ctx = _MockToolContext(
            artifacts={
                "codefocus_module:Card.tsx": (
                    'import { React } from "@exepad/sdk";\n'
                    "export function Card(){return null}\n"
                ),
                "codefocus_component:Page.tsx": (
                    'import { React } from "@exepad/sdk";\n'
                    'import { Card } from "./Card";\n'
                    "export default function Page(){return <Card/>}\n"
                ),
            },
            state={"_files_deleted_this_turn": ["codefocus_component:Page.tsx"]},
        )
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Card.tsx"
        )
        assert result["deleted"] is True
        assert ctx.state["_files_deleted_this_turn"] == [
            "codefocus_component:Page.tsx",
            "codefocus_module:Card.tsx",
        ]

    async def test_unimported_artifact_deletes_cleanly(self):
        ctx = _MockToolContext(
            artifacts={
                "codefocus_module:Orphan.tsx": (
                    'import { React } from "@exepad/sdk";\n'
                    "export function Orphan(){return null}\n"
                ),
            }
        )
        result = await delete_artifact_tool_impl(
            ctx, filename="codefocus_module:Orphan.tsx"
        )
        assert result["deleted"] is True
