"""Tests for PreCreator's bundle-awareness fields.

Phase 2 adds two optional fields to ``PreCreatorInput``:
  * ``bundle_domain_hints`` — single-blob digest of the uploaded design
    bundle (brand, nav, headlines, image alts, body sample).
  * ``bundle_page_slugs`` — canonical slugs of bundle pages.

These tests lock down the schema defaults + that the instruction
prioritizes bundle signal above name-based heuristics.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.pre_creator import (
    PRE_CREATOR_INSTRUCTION,
    PreCreatorInput,
)

pytestmark = [pytest.mark.unit]


class TestPreCreatorInputSchema:
    def test_existing_fields_unchanged(self):
        d = PreCreatorInput(app_name="X", app_description="y")
        assert d.app_name == "X"
        assert d.app_description == "y"
        assert d.app_language_code == "en"
        assert d.creation_source == ""

    def test_bundle_fields_default_to_empty(self):
        d = PreCreatorInput(app_name="X", app_description="y")
        assert d.bundle_domain_hints == ""
        assert d.bundle_page_slugs == []

    def test_bundle_fields_accept_values(self):
        d = PreCreatorInput(
            app_name="HappyDoods",
            app_description="",
            bundle_domain_hints="Brand: HappyDoods. Pages: home, products. Headlines: Pasture-raised eggs.",
            bundle_page_slugs=["", "products"],
        )
        assert "HappyDoods" in d.bundle_domain_hints
        assert d.bundle_page_slugs == ["", "products"]


class TestPreCreatorInstructionBundleWeighting:
    def test_instruction_mentions_bundle_as_authoritative_signal(self):
        # The instruction must tell the LLM to trust bundle_domain_hints
        # above app_name. Without this, the HappyDoods-style regression
        # (name-based pet-essentials guess) can re-surface.
        assert "bundle_domain_hints" in PRE_CREATOR_INSTRUCTION
        assert (
            "Trust this above" in PRE_CREATOR_INSTRUCTION
            or "trust this above" in PRE_CREATOR_INSTRUCTION.lower()
        )

    def test_instruction_calls_out_name_based_heuristic_regression(self):
        # Guard against reverting to a name-based heuristic prompt.
        text = PRE_CREATOR_INSTRUCTION
        # Should explicitly mention that name-based puns are the
        # anti-pattern.
        assert "HappyDoods" in text or "name-based" in text.lower()

    def test_instruction_still_covers_classification_rules(self):
        # Legacy rules must still be present (website/form/dataapp).
        assert "website" in PRE_CREATOR_INSTRUCTION
        assert "form" in PRE_CREATOR_INSTRUCTION
        assert "dataapp" in PRE_CREATOR_INSTRUCTION

    def test_instruction_reserves_app_description_as_second_priority(self):
        text = PRE_CREATOR_INSTRUCTION.lower()
        # Some mention of priority order between bundle and description.
        assert "app_description" in text and "bundle" in text
