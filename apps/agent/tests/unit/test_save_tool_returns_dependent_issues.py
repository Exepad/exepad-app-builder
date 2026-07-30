"""Save tool returns Tier-1 ``dependent_issues`` for staged importers.

When ComponentBuilderMultiple saves a module that other staged peer
components import, the save tool's response gains a
``dependent_issues`` array describing AST/semantic problems in those
importers. The save itself still succeeds; the issues are advisory.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
    validate_and_save_tsx_module_artifact,
)

pytestmark = [pytest.mark.unit]


_DATALIB_TSX = (
    'export const LABELS = ["a", "b", "c"];\n'
)


# Page imports DataLib AND contains a placeholder-div pattern that
# the semantic engine flags as an error. Auto-fixers do NOT rewrite
# this pattern, so the issue surfaces on the Tier-1 importer sweep.
_PAGE_TSX_BROKEN = (
    'import { React } from "@exepad/sdk";\n'
    'import { LABELS } from "./DataLib";\n'
    'export default function Page() {\n'
    '  return (<div>{LABELS[0]}'
    '<div className="bg-gray-200 flex items-center justify-center">'
    '<span className="text-gray-500">Map placeholder</span></div></div>);\n'
    '}\n'
)


class _StubInline:
    def __init__(self, data: bytes):
        self.data = data


class _StubArtifact:
    def __init__(self, data: bytes):
        self.inline_data = _StubInline(data)


class _StateLikeMapping:
    def __init__(self) -> None:
        self._d: dict = {}

    def __getitem__(self, key):
        return self._d[key]

    def __setitem__(self, key, value):
        self._d[key] = value

    def __contains__(self, key):
        return key in self._d

    def get(self, key, default=None):
        return self._d.get(key, default)

    def setdefault(self, key, default=None):
        return self._d.setdefault(key, default)

    def update(self, other):
        self._d.update(other)


class _CtxWithImporters:
    def __init__(self) -> None:
        self.state = _StateLikeMapping()
        self.actions = SimpleNamespace(escalate=False)
        self.agent_name = "ComponentBuilderMultiple"
        self._artifacts: dict[str, bytes] = {
            "codefocus_component:Page.tsx": _PAGE_TSX_BROKEN.encode("utf-8"),
        }
        self.saved_filenames: list[str] = []

    async def list_artifacts(self) -> list[str]:
        return list(self._artifacts.keys())

    async def load_artifact(self, *, filename: str, version: Optional[int] = None):
        data = self._artifacts.get(filename)
        return _StubArtifact(data) if data is not None else None

    async def save_artifact(self, *, filename: str, artifact) -> int:
        self.saved_filenames.append(filename)
        # Mirror the save behaviour: stash the bytes so the next
        # gather sees the freshest source.
        self._artifacts[filename] = artifact.inline_data.data
        return 1

    async def delete_artifact(self, *, filename: str) -> None:
        self._artifacts.pop(filename, None)


async def test_save_module_emits_dependent_issues_for_broken_importer(
    monkeypatch,
) -> None:
    """Saving DataLib with a broken Page importer surfaces Tier-1 issues."""

    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_syntax",
        lambda _src: (True, []),
    )
    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_with_tsc",
        lambda **_: [],
    )

    ctx = _CtxWithImporters()
    result = await validate_and_save_tsx_module_artifact(
        ctx, _DATALIB_TSX, "DataLib"
    )

    assert result.get("success") is True, f"unexpected save failure: {result}"
    assert ctx.saved_filenames == ["codefocus_module:DataLib.tsx"]

    issues = result.get("dependent_issues") or []
    assert issues, f"expected dependent_issues, got: {result}"
    files = {issue["filename"] for issue in issues}
    assert "codefocus_component:Page.tsx" in files
    assert any("placeholder div" in issue["message"] for issue in issues), (
        f"expected placeholder-div diagnostic, got: {issues}"
    )


async def test_save_records_modified_this_turn(monkeypatch) -> None:
    """The save tool tracks modified files for the Tier-2 sweep."""

    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_syntax",
        lambda _src: (True, []),
    )
    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_with_tsc",
        lambda **_: [],
    )

    ctx = _CtxWithImporters()
    result = await validate_and_save_tsx_module_artifact(
        ctx, _DATALIB_TSX, "DataLib"
    )
    assert result.get("success") is True

    modified = ctx.state.get("_files_modified_this_turn") or []
    assert "codefocus_module:DataLib.tsx" in modified
