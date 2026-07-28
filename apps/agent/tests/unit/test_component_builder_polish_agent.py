"""Wiring tests for the design-import polish-mode variant of
ComponentBuilderMultiple.

The polish agent is the architectural backbone of the design-import
drift fix (Track 3 in ~/.claude/plans/create-a-full-fix-modular-horizon.md).
Its only legitimate divergence from the full agent is at the **tool**
and **skill toolset** layer — input schema, output key, validation
chain, and model are shared.

These tests pin the toolset shape so a future "let's add write_artifact
back to the polish agent" regression is caught at import-time test load.
"""

from __future__ import annotations

import pytest
from google.adk.tools.skill_toolset import SkillToolset

from config import AgentName
from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder_multiple import (
    ComponentBuilderMultipleInput,
    component_builder_multiple_agent,
    component_builder_polish_agent,
)
from main_agent.agents.utils.skills import (
    _POLISH_MODE_SKILL_ALLOWLIST,
    load_frontend_polish_skills,
    load_frontend_skills,
)

pytestmark = [pytest.mark.unit]


class TestPolishSkillsAllowlist:
    """The narrow skill catalogue gates which skills the LLM can `load_skill`."""

    def test_allowlist_contains_three_skills(self):
        assert _POLISH_MODE_SKILL_ALLOWLIST == frozenset(
            {"component-editing", "state-hooks", "theme-token-migration"}
        )

    def test_polish_loader_returns_only_allowlisted_skills(self):
        skills = load_frontend_polish_skills()
        skill_names = {getattr(s, "name", "") for s in skills}
        assert skill_names == _POLISH_MODE_SKILL_ALLOWLIST

    def test_polish_loader_excludes_marketing_template_skills(self):
        """The skills that biased the LLM toward regeneration (RC#3, RC#9):
        landing-page-marketing, scratch-creation, etc.
        must NOT be in the polish set."""
        skills = load_frontend_polish_skills()
        skill_names = {getattr(s, "name", "") for s in skills}
        forbidden = {
            "landing-page-marketing",
            "scratch-creation",
            "responsive-mobile-first",
            "a11y-keyboard-aria",
            "modal-dialog-patterns",
            "animation-motion",
        }
        assert not (skill_names & forbidden), (
            f"Polish-mode skill set MUST NOT include marketing/template "
            f"skills; found: {skill_names & forbidden}"
        )

    def test_polish_loader_is_strict_subset_of_full_loader(self):
        polish_names = {getattr(s, "name", "") for s in load_frontend_polish_skills()}
        full_names = {getattr(s, "name", "") for s in load_frontend_skills()}
        assert polish_names.issubset(full_names), (
            "Polish allowlist must reference real on-disk skills the full " "loader can find."
        )
        # Strict subset, not equal.
        assert polish_names < full_names


class TestPolishAgentToolset:
    """The polish agent's `tools=[]` is the architectural guardrail.

    `edit_artifact_tool` (string-replace) is the only write path. Removing
    `validate_and_save_*` tools means the LLM **cannot rewrite a file
    end-to-end** — every change is a named, surgical edit against the
    existing source. This is what prevents RC#9 (ContactContent rewritten
    wholesale) and RC#12 (mixed icon system across components).
    """

    def test_agent_name_matches_constant(self):
        assert component_builder_polish_agent.name == AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH

    def test_agent_shares_input_schema_with_full_agent(self):
        # Same input schema → workflow can dispatch either without
        # building a separate input adapter. Prompt-cache reuse depends
        # on schema identity too.
        assert component_builder_polish_agent.input_schema is ComponentBuilderMultipleInput
        assert component_builder_multiple_agent.input_schema is ComponentBuilderMultipleInput

    def test_polish_toolset_excludes_full_file_writes(self):
        """`validate_and_save_tsx_component_artifact_tool` +
        `validate_and_save_tsx_module_artifact_tool` are full-file writes.
        Their absence is the architectural difference."""
        tool_names = {_tool_identity(t) for t in component_builder_polish_agent.tools}
        assert "validate_and_save_tsx_component_artifact" not in tool_names
        assert "validate_and_save_tsx_module_artifact" not in tool_names

    def test_polish_toolset_excludes_destructive_and_authoring_tools(self):
        """delete_artifact + add_theme_tokens are out of scope for polish:
        polish cannot drop sections, and theme is the translator's
        responsibility."""
        tool_names = {_tool_identity(t) for t in component_builder_polish_agent.tools}
        assert "delete_artifact" not in tool_names
        assert "add_theme_tokens" not in tool_names

    def test_polish_toolset_includes_edit_artifact(self):
        """The only legitimate write path."""
        tool_names = {_tool_identity(t) for t in component_builder_polish_agent.tools}
        assert "edit_artifact" in tool_names

    def test_polish_toolset_includes_read_and_discovery_tools(self):
        """The agent still needs full discovery to find the right edit sites."""
        tool_names = {_tool_identity(t) for t in component_builder_polish_agent.tools}
        for required in (
            "list_artifacts",
            "search_artifacts",
            "describe_artifact",
            "discover_dependencies",
            "find_symbol_references",
            "inspect_app_state",
        ):
            assert required in tool_names, f"polish agent missing read tool {required!r}"

    def test_polish_skill_toolset_is_the_narrow_one(self):
        """The SkillToolset in the agent's tools list must be the polish
        (3-skill) variant, NOT the full 27-skill catalogue used by the
        non-polish ComponentBuilderMultiple."""
        skill_toolsets = [
            t for t in component_builder_polish_agent.tools if isinstance(t, SkillToolset)
        ]
        assert len(skill_toolsets) == 1
        # ADK SkillToolset stores skills as a dict (name → Skill).
        skill_names = set(skill_toolsets[0]._skills.keys())  # noqa: SLF001
        assert skill_names == _POLISH_MODE_SKILL_ALLOWLIST

    def test_full_agent_keeps_full_skill_toolset(self):
        """Regression guard: the original ComponentBuilderMultiple must NOT
        be narrowed as a side effect of adding the polish variant. User-
        driven edit dispatches still need the full catalogue."""
        skill_toolsets = [
            t for t in component_builder_multiple_agent.tools if isinstance(t, SkillToolset)
        ]
        assert len(skill_toolsets) == 1
        skill_names = set(skill_toolsets[0]._skills.keys())  # noqa: SLF001
        full_count = len(skill_names)
        polish_count = len(_POLISH_MODE_SKILL_ALLOWLIST)
        # Sanity check: full catalogue is materially larger than polish.
        assert full_count > polish_count * 3


def _tool_identity(tool) -> str:
    """Best-effort name extractor for a heterogeneous tool list.

    ADK FunctionTool exposes `.name`; bare callables expose `.__name__`;
    SkillToolset exposes `.name`. Some artifact tools are decorated
    wrappers whose name carries a `_tool_impl` suffix; strip that so
    test assertions can refer to the bare function name.
    """
    for attr in ("name", "__name__"):
        val = getattr(tool, attr, None)
        if isinstance(val, str) and val:
            name = val
            for suffix in ("_tool_impl", "_tool"):
                if name.endswith(suffix):
                    name = name[: -len(suffix)]
                    break
            return name
    return type(tool).__name__
