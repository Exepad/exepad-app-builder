"""Tests for the BackendHandlerBuilder agent's tool registration.

Regression pin for the 2026-05-20 ``mw4h37zf`` bug: the agent's
``build_mode="edit"`` instruction tells the LLM to load the existing handler
source via ``load_artifacts``, but ``load_artifacts`` was not in the agent's
``tools`` list. When the LLM obeyed, ADK raised ``Tool 'load_artifacts' not
found`` and (with ``ReflectAndRetryToolPlugin``) aborted the SSE stream, so any
"fix this handler" / handler-edit turn could crash with a generic
"Something went wrong during generation".
"""

from __future__ import annotations

import pytest

pytestmark = [pytest.mark.unit]


def _tool_names(agent) -> set[str]:
    return {getattr(t, "name", type(t).__name__) for t in agent.tools}


def test_handler_builder_registers_load_artifacts():
    """Edit mode depends on load_artifacts — it MUST be registered."""
    from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_handler_builder import (  # noqa: E501
        backend_handler_builder_agent,
    )

    names = _tool_names(backend_handler_builder_agent)
    assert "load_artifacts" in names, (
        "load_artifacts missing — the build_mode='edit' instruction calls it; "
        "without registration the handler-edit/fix flow crashes."
    )


def test_handler_builder_keeps_save_tool_and_skill_toolset():
    """The save tool + shared skill toolset stay registered alongside load_artifacts."""
    from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_handler_builder import (  # noqa: E501
        backend_handler_builder_agent,
    )

    names = _tool_names(backend_handler_builder_agent)
    assert "validate_and_save_handler_artifact" in names
    assert "SkillToolset" in names


def test_handler_builder_prompt_has_terminal_save_mandate():
    """Lever A: the prompt must hard-mandate ending the turn on the save call —
    a no-save handler turn is the root cause of the build-aborting failure."""
    from unittest.mock import MagicMock

    from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_handler_builder import (  # noqa: E501
        backend_handler_builder_instruction_provider,
    )

    instruction = backend_handler_builder_instruction_provider(MagicMock())
    assert "TERMINAL SAVE MANDATE" in instruction
    assert "MUST" in instruction
    assert "validate_and_save_handler_artifact" in instruction
    # "no artifact" may wrap across a line in the rendered prompt.
    assert "artifact" in instruction and "fails the build" in instruction
