"""Prompt contract tests for the design system builder."""

from unittest.mock import MagicMock, patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.design_system_builder import (
    design_system_builder_instruction_provider,
)

pytestmark = [pytest.mark.unit]


def test_prompt_requires_tailwind_directives_above_exepad_layer():
    with patch(
        "main_agent.agents.orchestrator.app_types.webapp.subagents.design_system_builder.load_agent_doc",
        return_value="",
    ):
        prompt = design_system_builder_instruction_provider(MagicMock())

    # The prompt MUST teach the canonical pattern: bootstrap directives at
    # the top of the file, OUTSIDE `@layer exepad-app`. Wrapping `@import
    # "tw-animate-css"` inside the layer causes `@utility cannot be nested.`
    # because Tailwind inlines the package at the import site.
    assert "OUTSIDE any `@layer` block" in prompt or "OUTSIDE any @layer" in prompt
    # First `@import "tailwindcss"` appears BEFORE the first `@layer exepad-app {` —
    # the canonical structural ordering.
    assert prompt.find('@import "tailwindcss";') < prompt.find("@layer exepad-app {")
