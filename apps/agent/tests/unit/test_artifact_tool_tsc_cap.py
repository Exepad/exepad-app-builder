"""Unit tests for the save-tool tsc retry cap.

Phase 2.5 (per-module ComponentBuilder cleanup) exposed a failure mode
where Babel-shell sibling-aware tsc would surface a real cross-file
mismatch — e.g. ``<Card title="…">`` calling a sibling's
``Card({label, children})`` declaration. The single-file ComponentBuilder
can only edit one side at a time, so retrying the same file never
resolves the disagreement and the workflow loops forever, burning
~$0.07/component.

The fix mirrors the existing ``_MAX_SEMANTIC_RETRIES`` /
``_MAX_STYLE_COVERAGE_RETRIES`` contract: one retry, then ship the file
with the type errors rebranded as warnings so the workflow can move on.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
    _MAX_TSC_RETRIES,
    _THEME_CSS_ARTIFACT,
    validate_and_save_tsx_component_artifact,
)
from main_agent.services.validation.finding import Finding

pytestmark = [pytest.mark.unit]


_VALID_TSX = """\
import { React, LightDOMContainer } from "@exepad/sdk";
function HomeContent() {
  return (<LightDOMContainer><div>Hello</div></LightDOMContainer>);
}
export default HomeContent;
"""


# --------------------------------------------------------------------------- #
# State + ctx stubs (mirror test_artifact_tool_style_gate.py)
# --------------------------------------------------------------------------- #


class _StubInline:
    def __init__(self, data: bytes):
        self.data = data


class _StubArtifact:
    def __init__(self, data: bytes):
        self.inline_data = _StubInline(data)


class _StateLikeMapping:
    """Mimic ADK's State wrapper — no pop/del support."""

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


class _SaveCapturingCtx:
    def __init__(self) -> None:
        self.state = _StateLikeMapping()
        self.actions = SimpleNamespace(escalate=False)
        self.agent_name = "ComponentBuilder"
        self._artifacts: dict[str, bytes] = {}
        self.saved_filenames: list[str] = []

    async def load_artifact(self, *, filename: str, version: Optional[int] = None):
        data = self._artifacts.get(filename)
        return _StubArtifact(data) if data is not None else None

    async def save_artifact(self, *, filename: str, artifact) -> int:
        self.saved_filenames.append(filename)
        return 1


def _ts2307(name: str) -> Finding:
    return Finding(
        rule_id="tsc.TS2322",
        severity="error",
        message=f"Type 'string' is not assignable to type 'number' for prop '{name}'",
        line=12,
        col=4,
    )


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


def test_max_tsc_retries_constant_is_one() -> None:
    """Lock the contract: the LLM gets exactly one retry before we cap.

    The Phase 2.5 production loops we observed went 8+ iterations
    before the workflow's outer step bailed. With cap=1 the second
    failure ships with warnings and the per-component spend is bounded
    at ~2 model calls.
    """
    assert _MAX_TSC_RETRIES == 1


@pytest.mark.asyncio
async def test_tsc_first_failure_returns_retry(monkeypatch) -> None:
    """First tsc failure returns a retry dict so the LLM can attempt a fix."""

    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_syntax",
        lambda _src: (True, []),
    )
    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_with_tsc",
        lambda **_: [_ts2307("title")],
    )

    ctx = _SaveCapturingCtx()
    result = await validate_and_save_tsx_component_artifact(ctx, _VALID_TSX, "HomeContent")

    assert result["success"] is False
    assert "TypeScript errors" in result["error"]
    assert "Type 'string' is not assignable" in result["error"]
    # Counter recorded so the next attempt knows it's the second failure.
    assert ctx.state.get("_component_tsc_failures:HomeContent") == 1
    # Nothing saved.
    assert ctx.saved_filenames == []


@pytest.mark.asyncio
async def test_tsc_second_failure_ships_with_warnings(monkeypatch) -> None:
    """Past the cap, the file saves and tsc errors become warnings.

    This is the lever that breaks the Phase 2.5 Shell loop: retrying
    can't resolve a cross-file mismatch, so we accept the imperfect
    file and let the editor flow handle the residual error.
    """

    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_syntax",
        lambda _src: (True, []),
    )
    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_with_tsc",
        lambda **_: [_ts2307("title")],
    )

    ctx = _SaveCapturingCtx()
    # Pre-populate one prior failure — simulate the first retry already happened.
    ctx.state["_component_tsc_failures:HomeContent"] = 1

    result = await validate_and_save_tsx_component_artifact(ctx, _VALID_TSX, "HomeContent")

    assert result["success"] is True, f"save should ship at cap: {result}"
    assert ctx.saved_filenames == ["codefocus_component:HomeContent.tsx"]
    warnings = result.get("warnings") or []
    assert any(w.startswith("unresolved tsc:") for w in warnings), (
        f"expected at least one 'unresolved tsc:' warning, got {warnings}"
    )


@pytest.mark.asyncio
async def test_tsc_counter_resets_on_clean_save(monkeypatch) -> None:
    """A successful save resets the per-component tsc counter to 0.

    Same contract as the style-coverage gate — the counter is set to 0
    rather than deleted because ADK's State wrapper has no pop/del.
    """

    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_syntax",
        lambda _src: (True, []),
    )
    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_with_tsc",
        lambda **_: [],  # tsc clean
    )

    ctx = _SaveCapturingCtx()
    # Stale counter from a previous component's edit cycle.
    ctx.state["_component_tsc_failures:HomeContent"] = 1

    result = await validate_and_save_tsx_component_artifact(ctx, _VALID_TSX, "HomeContent")

    assert result["success"] is True
    assert ctx.state.get("_component_tsc_failures:HomeContent") == 0
