"""Tests for the schema-level field validators on DecompositionPlan models."""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    PageMapping,
)

pytestmark = [pytest.mark.unit]


def test_page_route_strips_leading_whitespace():
    """LLMs sometimes emit ``" /"`` (leading space). The validator strips
    whitespace at the schema boundary so logs and downstream consumers
    see the canonical value."""
    pm = PageMapping(
        bundle_artifact="bundle:html:index.html",
        output_artifact="content::page.html",
        page_slug="",
        page_route=" /",
        page_title="Dashboard",
    )
    assert pm.page_route == "/"


def test_page_route_strips_trailing_whitespace():
    pm = PageMapping(
        bundle_artifact="bundle:html:about.html",
        output_artifact="content:about:page.html",
        page_slug="about",
        page_route="/about \n",
        page_title="About",
    )
    assert pm.page_route == "/about"


def test_page_slug_strips_whitespace():
    pm = PageMapping(
        bundle_artifact="bundle:html:about.html",
        output_artifact="content:about:page.html",
        page_slug=" about ",
        page_route="/about",
        page_title="About",
    )
    assert pm.page_slug == "about"


def test_page_route_canonical_passes_through():
    pm = PageMapping(
        bundle_artifact="bundle:html:index.html",
        output_artifact="content::page.html",
        page_slug="",
        page_route="/",
        page_title="Home",
    )
    assert pm.page_route == "/"
