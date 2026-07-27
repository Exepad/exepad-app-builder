"""Tests for the per-page chrome override support (Fix 2.1 / RC#7).

Before Fix 2.1 (2026-05-16), `DecompositionPlan.chrome` carried one
`ChromeRegion` per role (header/sidebar/footer). The runner extracted
that single source and rendered it on every page. When the source
design had page-specific chrome (e.g. chick_farm had 4 different
footers across home/products/about/contact), all pages collapsed to
whichever one the importer picked as canonical.

Fix 2.1 added `ChromeRegion.page_scope` (default `"all"`, falsey set to
a page slug for per-page overrides). The runner already iterates the
list, so multiple `ChromeRegion` entries for the same role now emit
multiple artifacts.

Runtime rendering of per-page overrides (looking up
`content:{slug}:{role}.html` and rendering it INSTEAD of the canonical
chrome) is tracked separately — these tests pin the agent-side
schema + runner contract.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    ChromeRegion,
)

pytestmark = [pytest.mark.unit]


class TestChromeRegionPageScope:
    def test_page_scope_defaults_to_all(self):
        region = ChromeRegion(
            role="footer",
            output_artifact="content:main:footer.html",
            source_artifact="bundle:html:home_xyz/code.html",
            selector="footer",
        )
        assert region.page_scope == "all"

    def test_page_scope_accepts_slug(self):
        region = ChromeRegion(
            role="footer",
            output_artifact="content:products:footer.html",
            source_artifact="bundle:html:our_products_xyz/code.html",
            selector="footer",
            page_scope="products",
        )
        assert region.page_scope == "products"

    def test_page_scope_accepts_home_root(self):
        region = ChromeRegion(
            role="footer",
            output_artifact="content::footer.html",
            source_artifact="bundle:html:home_xyz/code.html",
            selector="footer",
            page_scope="/",
        )
        assert region.page_scope == "/"

    def test_multiple_chrome_entries_for_same_role_validate(self):
        """The DecompositionPlan should accept multiple ChromeRegions for
        the same role — that's the whole point of per-page overrides."""
        canonical = ChromeRegion(
            role="footer",
            output_artifact="content:main:footer.html",
            source_artifact="bundle:html:home_xyz/code.html",
            selector="footer",
        )
        per_page_products = ChromeRegion(
            role="footer",
            output_artifact="content:products:footer.html",
            source_artifact="bundle:html:our_products_xyz/code.html",
            selector="footer",
            page_scope="products",
        )
        per_page_contact = ChromeRegion(
            role="footer",
            output_artifact="content:contact-us:footer.html",
            source_artifact="bundle:html:contact_us_xyz/code.html",
            selector="footer",
            page_scope="contact-us",
        )
        # No exception, all three coexist.
        chrome = [canonical, per_page_products, per_page_contact]
        assert sum(1 for c in chrome if c.role == "footer") == 3
        # Distinct page_scopes — canonical "all" + two slug-scoped overrides.
        scopes = [c.page_scope for c in chrome]
        assert "all" in scopes
        assert "products" in scopes
        assert "contact-us" in scopes
