"""Lock down the canonical_page_slug helper used by the design-bundle binder.

Home synonyms must fold to the empty string so binding succeeds whether
the Creator emits ``"/"`` and the importer emits ``"home"`` (or vice versa).
Multi-word slugs must keep their structure — ``our_products`` must not
truncate to ``our`` (the regression that broke the HappyDoods fixture).
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow import (
    canonical_page_slug,
)

pytestmark = [pytest.mark.unit]


class TestHomeFoldsToEmpty:
    @pytest.mark.parametrize(
        "raw",
        ["/", "", "home", "Home", "HOME", "/home", "/home/", " home ", "index", "/index/"],
    )
    def test_every_home_synonym_folds_to_empty(self, raw: str):
        assert canonical_page_slug(raw) == ""


class TestKebabCase:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("about", "about"),
            ("/about", "about"),
            ("About", "about"),
            ("about_us", "about-us"),
            ("About_Us", "about-us"),
            ("/About-Us/", "about-us"),
            ("about us", "about-us"),
            ("our_products", "our-products"),
            ("our-products", "our-products"),
            ("contact_us", "contact-us"),
            ("/contact-us", "contact-us"),
        ],
    )
    def test_non_home_slugs_kebab_case(self, raw: str, expected: str):
        assert canonical_page_slug(raw) == expected


class TestEdgeCases:
    def test_none_returns_empty(self):
        assert canonical_page_slug(None) == ""  # type: ignore[arg-type]

    def test_non_string_returns_empty(self):
        assert canonical_page_slug(123) == ""  # type: ignore[arg-type]

    def test_collapses_run_of_separators(self):
        assert canonical_page_slug("about__us") == "about-us"
        assert canonical_page_slug("about   us") == "about-us"

    def test_strips_surrounding_whitespace_and_slashes(self):
        assert canonical_page_slug("  /products/  ") == "products"

    def test_truncation_bug_regression(self):
        # The legacy stitch_reader truncated "our_products" to "our" — ensure
        # the canonicalizer preserves the whole suffix.
        assert canonical_page_slug("our_products") != "our"
        assert canonical_page_slug("our_products") == "our-products"
