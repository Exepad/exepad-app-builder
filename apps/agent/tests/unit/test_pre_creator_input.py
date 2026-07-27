"""PreCreator input schema and hint-forwarding regression tests.

The ``creation_source`` field carries the onboarding landing-page slug
(e.g. ``convert-excel-to-crm``) from the Django backend through the
agent's ``/r`` payload into PreCreator's classification context. The
instruction section uses it as a soft tie-breaker when the prompt text
is ambiguous. These tests guard the schema contract; live classification
behavior is covered by eval suites, not unit tests.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.pre_creator import (
    PRE_CREATOR_INSTRUCTION,
    PreCreatorInput,
    pre_creator_agent,
)


class TestPreCreatorInputCreationSource:
    def test_default_is_empty_string(self):
        """Non-onboarding paths (dashboard create, dev_service) don't carry a
        slug — the field must default to empty string, not None."""
        pre_input = PreCreatorInput(
            app_name="My App",
            app_description="A to-do list",
        )
        assert pre_input.creation_source == ""

    def test_accepts_convert_slug(self):
        pre_input = PreCreatorInput(
            app_name="Excel CRM",
            app_description="Make it nice",
            creation_source="convert-excel-to-crm",
        )
        assert pre_input.creation_source == "convert-excel-to-crm"

    def test_creation_source_serialized_in_model_dump(self):
        """The field must appear in model_dump_json so it reaches the LLM as
        part of the PreCreator input JSON."""
        pre_input = PreCreatorInput(
            app_name="X",
            app_description="Y",
            creation_source="convert-pdf-to-website",
        )
        dumped = pre_input.model_dump()
        assert "creation_source" in dumped
        assert dumped["creation_source"] == "convert-pdf-to-website"


class TestPreCreatorInstruction:
    def test_instruction_references_creation_source(self):
        """The LLM instruction must teach the model how to use the hint —
        otherwise the field is dead weight in the input."""
        assert "creation_source" in PRE_CREATOR_INSTRUCTION

    def test_instruction_marks_prompt_as_authoritative(self):
        """Regression guard: the hint must never override an explicit prompt
        signal, or a mis-labelled landing page would poison classification."""
        text = PRE_CREATOR_INSTRUCTION.lower()
        assert "prompt" in text and ("wins" in text or "authoritative" in text)


class TestPreCreatorAgentRegistration:
    def test_input_schema_is_pre_creator_input(self):
        assert pre_creator_agent.input_schema is PreCreatorInput


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
