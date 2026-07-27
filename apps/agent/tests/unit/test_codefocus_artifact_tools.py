from types import SimpleNamespace

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.artifact_tools import (
    _apply_post_fix_syntax_gate,
    _apply_unconditional_icon_rescue,
    validate_and_save_tsx_component_artifact,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
    component_save_guardrail,
    sanitize_save_response,
)
from main_agent.constants import StateKeys


class _DummyToolContext:
    def __init__(self, state: dict | None = None):
        self.state = state or {}
        self.actions = SimpleNamespace(escalate=False)
        self.agent_name = "ComponentBuilder"

    async def save_artifact(self, **_: object) -> int:
        raise AssertionError("save_artifact should not be called in these guardrail tests")


class _DummyTool:
    name = "validate_and_save_tsx_component_artifact"


pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Post-auto-fix syntax gate tests (Change 1)
#
# We mock ``validate_tsx_syntax`` so the test exercises the gate's logic
# regardless of whether ``esbuild`` is on PATH. Production runs against a
# container that has the binary installed; local dev environments often
# don't, and the helper fails open (returns True, []) in that case.
# --------------------------------------------------------------------------- #

_CLEAN_TSX = """\
import { React, LightDOMContainer } from "@exepad/sdk";
function HomeContent() {
  return (<LightDOMContainer><div>Hello</div></LightDOMContainer>);
}
export default HomeContent;
"""

_CORRUPTED_TSX = """// pretend this fails esbuild parse"""


def _patch_syntax(monkeypatch, fixed_valid: bool, original_valid: bool) -> None:
    """Patch validate_tsx_syntax to return scripted (valid, errors) tuples.

    The helper is called once for ``fixed_code`` then (if invalid) once for
    ``code``. We script both calls in order.
    """
    calls = iter(
        [
            (fixed_valid, [] if fixed_valid else ["fixed: mismatched tag"]),
            (original_valid, [] if original_valid else ["original: mismatched tag"]),
        ]
    )

    def fake_validate(_source: str):
        return next(calls)

    monkeypatch.setattr(
        "main_agent.services.validation.syntax_validator.validate_tsx_syntax",
        fake_validate,
    )


def test_post_fix_gate_tier_a_clean_passes_through(monkeypatch):
    """Tier A: fixed code parses → return (fixed_code, fixes) unchanged."""
    _patch_syntax(monkeypatch, fixed_valid=True, original_valid=True)
    ctx = _DummyToolContext()
    out_code, out_fixes = _apply_post_fix_syntax_gate(
        tool_context=ctx,
        component_name="HomeContent",
        code=_CLEAN_TSX,
        fixed_code=_CLEAN_TSX,
        fixes=["Some fix message"],
    )
    assert out_code == _CLEAN_TSX
    assert out_fixes == ["Some fix message"]
    assert StateKeys.UNRESOLVED_COMPONENTS not in ctx.state
    assert StateKeys.COMPONENT_FAILURE_DETAILS not in ctx.state


def test_post_fix_gate_tier_b_falls_back_to_original(monkeypatch):
    """Tier B: fixed corrupted, original parses → return (code, [])."""
    _patch_syntax(monkeypatch, fixed_valid=False, original_valid=True)
    ctx = _DummyToolContext()
    out_code, out_fixes = _apply_post_fix_syntax_gate(
        tool_context=ctx,
        component_name="HomeContent",
        code=_CLEAN_TSX,
        fixed_code=_CORRUPTED_TSX,
        fixes=["Animation: rewrote 32 className(s)"],
    )
    assert out_code == _CLEAN_TSX  # fell back to original
    assert out_fixes == []
    # No placeholder side-effects on Tier B.
    assert StateKeys.UNRESOLVED_COMPONENTS not in ctx.state


_TSX_WITH_HALLUCINATED_ICONS = """\
import { React, Icons, LightDOMContainer } from "@exepad/sdk";
function GameContent() {
  return (
    <LightDOMContainer>
      <div>
        <Icons.CircleZeebraflux className="w-6 h-6" />
        <span>Coins</span>
      </div>
    </LightDOMContainer>
  );
}
export default GameContent;
"""


def test_post_fix_gate_tier_b_rescues_hallucinated_icons(monkeypatch):
    """Tier B regression: when fall-back fires, hallucinated ``Icons.X``
    in the LLM original must be scrubbed before save.

    Without the rescue, names like ``Icons.CircleZeebraflux`` ship in the
    saved TSX and crash the page at render time with React error #130
    ("element type is invalid: got undefined"). Reproduces the live
    failure mode behind app ``ze1ltmf9`` ("Super Mushroom Quest").
    """
    _patch_syntax(monkeypatch, fixed_valid=False, original_valid=True)
    ctx = _DummyToolContext()
    out_code, out_fixes = _apply_post_fix_syntax_gate(
        tool_context=ctx,
        component_name="GameContent",
        code=_TSX_WITH_HALLUCINATED_ICONS,
        fixed_code=_CORRUPTED_TSX,
        fixes=["Injected aria-label on 24 icon-only button(s)"],
    )
    # Hallucinated icon must NOT survive in the saved code.
    assert "Icons.CircleZeebraflux" not in out_code, (
        "Tier B did not rescue hallucinated icon — would crash at render"
    )
    # It must be replaced with a known fallback (close-match or Circle).
    assert ("Icons.DollarSign" in out_code or "Icons.Circle" in out_code), (
        "Tier B rescue did not emit a known icon fallback"
    )
    # The rescue surfaces in the returned fixes list so it appears in the
    # save-tool's structured response, not silently swallowed.
    assert any("Icons.CircleZeebraflux" in f for f in out_fixes), (
        f"rescue fix not reported in output: {out_fixes}"
    )


_TSX_CLEAN_NO_ICONS = """\
import { React, LightDOMContainer } from "@exepad/sdk";
function HomeContent() {
  return (<LightDOMContainer><div>Hello</div></LightDOMContainer>);
}
export default HomeContent;
"""


_TSX_FIXED_BUT_HAS_HALLUCINATED_ICON = """\
import { React, Icons, LightDOMContainer, Card, CardContent } from "@exepad/sdk";
function GameContent() {
  return (
    <LightDOMContainer>
      <Card><CardContent>
        <Icons.CircleZeebraflux className="w-6 h-6" />
        <Icons.AtomZeebra className="w-4 h-4" />
        <span>Hi</span>
      </CardContent></Card>
    </LightDOMContainer>
  );
}
export default GameContent;
"""


def test_unconditional_icon_rescue_scrubs_hallucinated_icons():
    """The save-tool rescue pass replaces unknown ``Icons.X`` references.

    This runs on every save (not just on Tier B fallback). It guards
    against the case where Change A rolled back the urls_images fixer —
    meaning the in-pipeline icon fallback was discarded along with
    whatever else corrupted in that category. The unconditional rescue
    catches that case before the saved component ships React #130.
    """
    out_code, out_fixes = _apply_unconditional_icon_rescue(
        component_name="GameContent",
        fixed_code=_TSX_FIXED_BUT_HAS_HALLUCINATED_ICON,
        fixes=["[earlier_fixer] earlier message"],
    )
    # Hallucinated icons must NOT survive in the rescued code.
    assert "Icons.CircleZeebraflux" not in out_code
    assert "Icons.AtomZeebra" not in out_code
    # Replaced with valid lucide names (close-match where possible).
    assert "Icons.DollarSign" in out_code or "Icons.Circle" in out_code
    # Earlier fixer's message survives + rescue messages are tagged.
    assert "[earlier_fixer] earlier message" in out_fixes
    rescue_msgs = [f for f in out_fixes if f.startswith("[icon_rescue]")]
    assert len(rescue_msgs) >= 2, (
        f"Expected ≥2 rescue messages for 2 hallucinated icons; got {rescue_msgs}"
    )
    assert any("CircleZeebraflux" in f for f in rescue_msgs)
    assert any("Atom" in f for f in rescue_msgs)


def test_unconditional_icon_rescue_noop_on_clean_code():
    """No icons to rescue → fixed_code and fixes unchanged."""
    fixes = ["[some_fixer] previous"]
    out_code, out_fixes = _apply_unconditional_icon_rescue(
        component_name="HomeContent",
        fixed_code=_TSX_CLEAN_NO_ICONS,
        fixes=fixes,
    )
    assert out_code == _TSX_CLEAN_NO_ICONS
    assert out_fixes == fixes


def test_post_fix_gate_tier_c_both_fail_returns_placeholder(monkeypatch):
    """Tier C: both fail → return placeholder TSX + populate UNRESOLVED_COMPONENTS."""
    _patch_syntax(monkeypatch, fixed_valid=False, original_valid=False)
    ctx = _DummyToolContext()
    out_code, out_fixes = _apply_post_fix_syntax_gate(
        tool_context=ctx,
        component_name="HomeContent",
        code=_CORRUPTED_TSX,
        fixed_code=_CORRUPTED_TSX,
        fixes=["Some fix"],
    )
    assert out_fixes == []
    # Placeholder TSX always renders the "needs your attention" card.
    assert "needs your attention" in out_code
    assert "HomeContent" in out_code
    # UNRESOLVED_COMPONENTS populated so editor flow surfaces it next turn.
    unresolved = ctx.state.get(StateKeys.UNRESOLVED_COMPONENTS, {})
    assert "HomeContent" in unresolved
    # Failure details recorded with the post-fix class.
    details = ctx.state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {})
    assert details.get("HomeContent", {}).get("failure_class") == "jsx_syntax_error_post_fix"


# --------------------------------------------------------------------------- #
# ComponentBuilder output-token cap (Change 3)
# --------------------------------------------------------------------------- #


def test_component_builder_has_output_token_cap():
    """ComponentBuilder's GenerateContentConfig must include max_output_tokens.

    Stops degenerate-repetition loops at the inference layer (see
    ``xdk89qba`` MainHeader: 32× duplicated, ~40,000 output tokens). The
    cap value is the env-overridable ``COMPONENT_BUILDER_MAX_OUTPUT_TOKENS``,
    default 12,000 — a generous upper bound for any single component.
    """
    from config import COMPONENT_BUILDER_MAX_OUTPUT_TOKENS
    from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder import (
        component_builder_agent,
    )

    cfg = component_builder_agent.generate_content_config
    assert cfg is not None, "ComponentBuilder must declare a generate_content_config"
    assert cfg.max_output_tokens is not None, (
        "ComponentBuilder must set max_output_tokens to bound degenerate-loop output. "
        "See plan/work-in-planning-mode-harmonic-prism.md, Change 3."
    )
    assert cfg.max_output_tokens == COMPONENT_BUILDER_MAX_OUTPUT_TOKENS, (
        f"max_output_tokens ({cfg.max_output_tokens}) must equal "
        f"COMPONENT_BUILDER_MAX_OUTPUT_TOKENS ({COMPONENT_BUILDER_MAX_OUTPUT_TOKENS})"
    )
    # Sanity-check the default isn't accidentally lowered to a value that
    # would clip legitimate components on every run.
    assert cfg.max_output_tokens >= 8000, (
        "max_output_tokens too low — would truncate legitimate components"
    )


def test_component_save_guardrail_short_circuits_latched_component():
    ctx = _DummyToolContext(
        {
            "_expected_component_name": "HomeContent",
            StateKeys.TERMINAL_COMPONENT_SAVE_LATCHES: {
                "HomeContent": "STOP — already terminal for HomeContent."
            },
        }
    )

    result = component_save_guardrail(
        _DummyTool(),
        {"component_name": "HomeContent"},
        ctx,
    )

    assert result is not None
    assert result["terminal"] is True
    assert "already terminal" in result["error"]


def test_sanitize_save_response_mentions_non_blocking_advisories():
    response = sanitize_save_response(
        _DummyTool(),
        {},
        _DummyToolContext(),
        {
            "success": True,
            "artifact_filename": "codefocus_component:HomeContent.tsx",
            "version": 1,
            "advisory_count": 2,
        },
    )

    assert response is not None
    assert "do not retry solely" in response["message"]


# --------------------------------------------------------------------------- #
# Phase 4 — module save tool guard recognition
# --------------------------------------------------------------------------- #


class _ModuleTool:
    name = "validate_and_save_tsx_module_artifact"


def test_save_guardrail_blocks_bleed_on_module_tool():
    """Bleed guard fires for module-tool calls too — both save tools share state."""
    ctx = _DummyToolContext({"_expected_component_name": "Charts"})
    result = component_save_guardrail(
        _ModuleTool(),
        {"module_name": "Sidebar"},  # wrong target — should block
        ctx,
    )
    assert result is not None
    assert result["success"] is False
    assert "Charts" in result["error"]
    assert "Sidebar" in result["error"]


def test_save_guardrail_allows_correct_module_tool_call():
    """Correct target + matching expected tool kind — guardrail returns None.

    After C2: workflows that target a module set `_expected_save_tool_name`
    to the module tool's name. Without this hint the guard defaults to
    expecting the component tool (so a stray module-tool call elsewhere
    gets blocked).
    """
    ctx = _DummyToolContext(
        {
            "_expected_component_name": "Charts",
            "_expected_save_tool_name": "validate_and_save_tsx_module_artifact",
        }
    )
    result = component_save_guardrail(
        _ModuleTool(),
        {"module_name": "Charts"},
        ctx,
    )
    assert result is None


def test_save_guardrail_ignores_non_save_tools():
    """Tools we don't recognise pass through (return None)."""

    class _OtherTool:
        name = "load_artifacts"

    result = component_save_guardrail(
        _OtherTool(),
        {"filenames": ["x"]},
        _DummyToolContext(),
    )
    assert result is None


def test_sanitize_save_response_handles_module_tool():
    """The sanitiser also fires for module saves so the LLM doesn't loop."""
    response = sanitize_save_response(
        _ModuleTool(),
        {},
        _DummyToolContext(),
        {
            "success": True,
            "artifact_filename": "codefocus_module:Charts.tsx",
            "version": 1,
        },
    )
    assert response is not None
    assert "saved successfully" in response["message"]


# --------------------------------------------------------------------------- #
# C2 regression: wrong-save-tool guard
#
# When the workflow expects a module save (target_artifact_kind="module"),
# the LLM must NOT call the component save tool — even with the right name.
# Otherwise the file lands at codefocus_component:<name>.tsx instead of
# codefocus_module:<name>.tsx and the post-save loader silently misses.
# --------------------------------------------------------------------------- #


def test_save_guardrail_blocks_wrong_tool_when_module_expected():
    """LLM calls component tool with right name but wrong KIND → rejected."""
    ctx = _DummyToolContext(
        {
            "_expected_component_name": "Charts",
            "_expected_save_tool_name": "validate_and_save_tsx_module_artifact",
        }
    )
    result = component_save_guardrail(
        _DummyTool(),  # name = validate_and_save_tsx_component_artifact
        {"component_name": "Charts"},  # name matches but tool is wrong
        ctx,
    )
    assert result is not None
    assert result["success"] is False
    assert "Wrong save tool" in result["error"]
    assert "validate_and_save_tsx_module_artifact" in result["error"]


def test_save_guardrail_blocks_wrong_tool_when_component_expected():
    """Symmetric: LLM calls module tool when component expected → rejected.

    Default behavior when `_expected_save_tool_name` is unset is to expect
    the component tool — so any save during creation / entry edit that
    accidentally calls the module tool gets blocked too.
    """
    ctx = _DummyToolContext({"_expected_component_name": "Header"})
    result = component_save_guardrail(
        _ModuleTool(),
        {"module_name": "Header"},
        ctx,
    )
    assert result is not None
    assert result["success"] is False
    assert "Wrong save tool" in result["error"]


def test_save_guardrail_allows_correct_tool_when_module_expected():
    """Module tool + module name + module-expected → guard passes."""
    ctx = _DummyToolContext(
        {
            "_expected_component_name": "Charts",
            "_expected_save_tool_name": "validate_and_save_tsx_module_artifact",
        }
    )
    result = component_save_guardrail(
        _ModuleTool(),
        {"module_name": "Charts"},
        ctx,
    )
    assert result is None


def test_save_guardrail_default_expects_component_tool():
    """Backwards-compat: workflows that don't set `_expected_save_tool_name`
    keep the component-tool default (so a stray module-tool call during
    creation gets blocked)."""
    ctx = _DummyToolContext({"_expected_component_name": "Hero"})
    # Component tool with right name → allowed.
    assert (
        component_save_guardrail(_DummyTool(), {"component_name": "Hero"}, ctx)
        is None
    )
    # Module tool with right name → blocked because default expectation
    # is component tool.
    blocked = component_save_guardrail(
        _ModuleTool(), {"module_name": "Hero"}, ctx
    )
    assert blocked is not None
    assert "Wrong save tool" in blocked["error"]
