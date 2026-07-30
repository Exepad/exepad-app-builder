"""Tests for Creator's bundle-awareness fields.

Phase 2 adds two fields to ``CreatorInput``:
  * ``bundle_domain_hints`` — same digest PreCreator receives.
  * ``bundle_page_slugs`` — canonical slugs; drives strict page-set.

These tests lock down the schema defaults + that the instruction carries
explicit guidance about treating the bundle as authoritative and NOT
inventing extra pages.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.creator import (
    CreatorInput,
    creator_instruction_provider,
)

pytestmark = [pytest.mark.unit]


class TestCreatorInputSchema:
    def test_default_fields_unchanged(self):
        d = CreatorInput(app_name="X", app_description="y")
        assert d.app_name == "X"
        assert d.app_description == "y"
        # Content-aware defaults
        assert d.image_catalog_summary == "No images available."
        assert d.document_artifact_list == []
        assert d.user_referenced_images == []

    def test_bundle_fields_default_to_empty(self):
        d = CreatorInput(app_name="X", app_description="y")
        assert d.bundle_domain_hints == ""
        assert d.bundle_page_slugs == []

    def test_bundle_fields_accept_values(self):
        d = CreatorInput(
            app_name="HappyDoods",
            app_description="",
            bundle_domain_hints="Brand: HappyDoods. Pages: home, about-us.",
            bundle_page_slugs=["", "about-us"],
        )
        assert d.bundle_domain_hints.startswith("Brand: HappyDoods")
        assert d.bundle_page_slugs == ["", "about-us"]


class TestCreatorInstructionBundleAuthority:
    def _build_instruction(self, pre_classified_type: str = "website") -> str:
        """Invoke the instruction provider with a mock ReadonlyContext."""
        ctx = MagicMock()
        ctx.state = {"pre_classified_app_type": pre_classified_type}
        return creator_instruction_provider(ctx)

    def test_has_design_bundle_authority_section(self):
        text = self._build_instruction()
        assert "Design Bundle Authority" in text

    def test_says_bundle_is_source_of_truth(self):
        text = self._build_instruction()
        assert "single source of truth" in text.lower()

    def test_calls_out_strict_page_set(self):
        text = self._build_instruction()
        # Must explicitly warn against inventing FAQ/Privacy/Terms pages.
        assert "FAQ" in text
        assert "Privacy" in text

    def test_tells_llm_not_to_invent_backend_models(self):
        text = self._build_instruction()
        # The guidance that "a contact form is a platform form, not a CRM" must land.
        assert "platform form" in text.lower() or "is not a CRM" in text

    def test_respects_legacy_output_contract(self):
        # Existing Creator rules must still be present.
        text = self._build_instruction()
        assert "component_plans" in text
        assert "navigation_type" in text
