"""Unit tests for the save-tool style-coverage gate (B.1).

The gate sits between semantic validation and `tool_context.save_artifact`
in `validate_and_save_tsx_component_artifact`. It runs
`validate_style_coverage` against the current theme.css and returns a
retry error when the TSX uses Tailwind classes whose `@theme` token
doesn't exist.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
    _THEME_CSS_ARTIFACT,
    _check_style_coverage,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Test fixtures
# --------------------------------------------------------------------------- #

# A minimal but valid theme — primary/secondary/surface/error families only,
# matching the `1r4s4zhj` shape that produced today's bug.
_THEME_CSS = """\
@import "tailwindcss";

@layer exepad-app {
  @theme {
    --color-primary: #1b4332;
    --color-on-primary: #ffffff;
    --color-secondary: #47664b;
    --color-on-secondary: #ffffff;
    --color-surface: #fcf9f3;
    --color-on-surface: #1c1c18;
    --color-error: #ba1a1a;
    --color-on-error: #ffffff;
    --font-heading: "Noto Serif", serif;
    --font-body: "Plus Jakarta Sans", sans-serif;
  }
  :root {
    --background: 48 40% 97%;
    --foreground: 60 6% 10%;
    --primary: 153 42% 18%;
    --primary-foreground: 0 0% 100%;
    --secondary: 127 18% 34%;
    --secondary-foreground: 0 0% 100%;
    --destructive: 0 75% 42%;
    --destructive-foreground: 0 0% 100%;
    --muted: 45 10% 88%;
    --muted-foreground: 39 21% 26%;
    --accent: 121 44% 86%;
    --accent-foreground: 127 18% 36%;
    --card: 45 25% 95%;
    --card-foreground: 60 6% 10%;
    --border: 37 31% 75%;
    --input: 37 31% 75%;
    --ring: 153 42% 18%;
    --radius: 0.5rem;
    --popover: 48 40% 97%;
    --popover-foreground: 60 6% 10%;
  }
}
"""


_VALID_TSX = """\
import { React, LightDOMContainer } from "@exepad/sdk";
function HomeContent() {
  return (
    <LightDOMContainer>
      <div className="bg-surface text-on-surface p-8">
        <h1 className="bg-primary text-on-primary">Hello</h1>
      </div>
    </LightDOMContainer>
  );
}
export default HomeContent;
"""


_TSX_WITH_UNDEFINED_TOKEN = """\
import { React, LightDOMContainer } from "@exepad/sdk";
function HomeContent() {
  return (
    <LightDOMContainer>
      <span className="bg-tertiary-fixed text-on-tertiary-fixed-variant px-4 py-1 rounded-full">
        Harvest Badge
      </span>
    </LightDOMContainer>
  );
}
export default HomeContent;
"""


_TSX_WITH_BUILTINS_AND_ARBITRARY = """\
import { React, LightDOMContainer } from "@exepad/sdk";
function HomeContent() {
  return (
    <LightDOMContainer>
      <div className="bg-white bg-blue-500 bg-[#abcdef] bg-primary/50 bg-gradient-to-r p-8">
        Built-in palette + arbitrary value + opacity modifier + gradient
      </div>
    </LightDOMContainer>
  );
}
export default HomeContent;
"""


# --------------------------------------------------------------------------- #
# Stubs
# --------------------------------------------------------------------------- #


class _StubInline:
    def __init__(self, data: bytes):
        self.data = data


class _StubArtifact:
    def __init__(self, data: bytes):
        self.inline_data = _StubInline(data)


class _StateLikeMapping:
    """Mimic ADK's `State` wrapper.

    Production State supports __getitem__ / __setitem__ / __contains__ / get /
    setdefault / update / to_dict — but **NOT** `pop` or `__delitem__`. Tests
    must catch any reliance on dict-only methods (the original gate used
    `state.pop()` and crashed in production while passing local tests that
    used a plain dict).
    """

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


class _DummyToolContext:
    """Minimal ADK ToolContext stand-in for the gate.

    Uses ``_StateLikeMapping`` to mirror the real ADK ``State`` API surface
    (no ``pop``, no ``__delitem__``). A previous version of this stub used a
    plain ``dict`` and let a ``state.pop(...)`` regression slip into prod.
    """

    def __init__(self, theme_css: Optional[str]):
        self.state = _StateLikeMapping()
        self.actions = SimpleNamespace(escalate=False)
        self.agent_name = "ComponentBuilder"
        self._artifacts: dict[str, bytes] = {}
        if theme_css is not None:
            self._artifacts[_THEME_CSS_ARTIFACT] = theme_css.encode("utf-8")

    async def load_artifact(self, *, filename: str, version: Optional[int] = None):
        data = self._artifacts.get(filename)
        return _StubArtifact(data) if data is not None else None

    async def save_artifact(self, *, filename: str, artifact) -> int:  # pragma: no cover
        raise AssertionError("Save should not be called by the gate")


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_gate_passes_when_all_tokens_defined():
    ctx = _DummyToolContext(_THEME_CSS)
    retry, warnings = await _check_style_coverage(
        ctx, "HomeContent", "codefocus_component:HomeContent.tsx", _VALID_TSX
    )
    assert retry is None
    assert warnings == []


@pytest.mark.asyncio
async def test_gate_returns_retry_dict_on_first_undefined_token():
    """First failure surfaces a retry dict so the LLM can call
    ``add_theme_tokens`` or rewrite the offending classes.
    """
    ctx = _DummyToolContext(_THEME_CSS)
    retry, warnings = await _check_style_coverage(
        ctx, "HomeContent", "codefocus_component:HomeContent.tsx", _TSX_WITH_UNDEFINED_TOKEN
    )
    assert retry is not None
    assert retry["success"] is False
    assert "bg-tertiary-fixed" in retry["error"]
    assert "on-tertiary-fixed-variant" in retry["error"]
    assert "add_theme_tokens" in retry["error"]
    assert "design_system_context.palette" in retry["error"]
    # No terminal/escalate under the always-ship contract.
    assert "terminal" not in retry
    assert ctx.actions.escalate is False
    # No warnings yet — they only surface when the cap is exceeded.
    assert warnings == []


@pytest.mark.asyncio
async def test_gate_surfaces_warnings_at_retry_cap():
    """At the cap, the gate returns warnings so the caller can append
    them to the response and save the auto-fixed TSX anyway."""
    ctx = _DummyToolContext(_THEME_CSS)
    # Simulate one prior failure already recorded
    ctx.state["_component_style_coverage_failures:HomeContent"] = 1
    retry, warnings = await _check_style_coverage(
        ctx, "HomeContent", "codefocus_component:HomeContent.tsx", _TSX_WITH_UNDEFINED_TOKEN
    )
    assert retry is None
    assert len(warnings) > 0
    assert any("bg-tertiary-fixed" in w for w in warnings)
    assert all(w.startswith("unresolved style-coverage:") for w in warnings)


@pytest.mark.asyncio
async def test_gate_skips_gracefully_when_theme_artifact_missing():
    ctx = _DummyToolContext(theme_css=None)
    retry, warnings = await _check_style_coverage(
        ctx, "HomeContent", "codefocus_component:HomeContent.tsx", _TSX_WITH_UNDEFINED_TOKEN
    )
    # No theme.css → graceful skip; save proceeds.
    assert retry is None
    assert warnings == []


@pytest.mark.asyncio
async def test_gate_does_not_false_positive_on_tailwind_builtins_or_arbitrary():
    """`extract_custom_color_refs` already filters built-ins, arbitrary
    values, opacity modifiers, and gradient utilities. The gate must
    never block on those.
    """
    ctx = _DummyToolContext(_THEME_CSS)
    retry, warnings = await _check_style_coverage(
        ctx, "HomeContent", "codefocus_component:HomeContent.tsx", _TSX_WITH_BUILTINS_AND_ARBITRARY
    )
    assert retry is None
    assert warnings == []


@pytest.mark.asyncio
async def test_full_save_path_after_gate_passes_does_not_use_dict_only_state_methods():
    """Regression: after the gate passes, the save path must use only the
    ADK ``State`` API (no ``pop`` / ``__delitem__``). A previous
    implementation called ``state.pop(...)`` and crashed in production
    with ``'State' object has no attribute 'pop'`` while local tests
    using a plain dict for state silently passed.

    This test runs the FULL save tool with a State-like substrate that
    refuses dict-only methods, asserting save_artifact is reached
    successfully.
    """
    from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
        validate_and_save_tsx_component_artifact,
    )

    saved_filenames: list[str] = []

    class _SaveCapturingCtx(_DummyToolContext):
        async def save_artifact(self, *, filename: str, artifact) -> int:
            saved_filenames.append(filename)
            return 1

    ctx = _SaveCapturingCtx(_THEME_CSS)
    # Pre-populate the expected component name (the save guardrail reads it
    # from state — we set _expected_component_name not via the guardrail
    # itself, since this test bypasses the FunctionTool wrapper).
    ctx.state["_expected_component_name"] = "HomeContent"

    result = await validate_and_save_tsx_component_artifact(ctx, _VALID_TSX, "HomeContent")

    assert result["success"] is True, f"save failed: {result.get('error')}"
    assert saved_filenames == ["codefocus_component:HomeContent.tsx"]
    # The retry counter must be reset to 0 (not deleted, since State has no pop).
    assert ctx.state.get("_component_style_coverage_failures:HomeContent") == 0
