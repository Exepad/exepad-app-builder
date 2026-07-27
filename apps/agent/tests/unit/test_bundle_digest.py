"""Tests for the design-bundle digest helper.

The digest turns a set of design-import artifacts (theme + per-page HTML
+ header) into a short, LLM-readable summary that PreCreator and Creator
use to anchor their classification / planning in the bundle's actual
content — not in a name-based guess.

Key behaviors under test:
  * Pure helpers (strip_tags, extract_headlines, etc.) work on the
    HappyDoods-style markup produced by the importer.
  * The public ``digest_bundle_artifacts`` returns ``None`` when no
    content artifacts exist.
  * When content artifacts exist, the digest carries brand name, page
    slugs (canonicalized), nav labels, headlines, image alts, and a
    bounded body sample.
  * ``bundle_domain_hints`` is a single string the LLM can consume as
    one input field.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from main_agent.agents.orchestrator.importers.bundle_digest import (
    _canonical_slug_from_artifact_key,
    _extract_brand_name,
    _extract_headlines,
    _extract_image_alts,
    _extract_nav_labels,
    _render_digest_text,
    _strip_tags,
    digest_bundle_artifacts,
)

pytestmark = [pytest.mark.unit]


# ── Pure helpers ──────────────────────────────────────────────────────────


class TestStripTags:
    def test_drops_every_tag_and_collapses_whitespace(self):
        assert _strip_tags("<h1>Hello <em>world</em></h1>") == "Hello world"
        assert _strip_tags("  <p>x</p>  ") == "x"
        assert _strip_tags("<div>\n  <span>a</span>\n  <span>b</span>\n</div>") == "a b"


class TestExtractHeadlines:
    def test_h1_and_h2_in_document_order_deduped(self):
        html = (
            "<h1>HappyDoods</h1>"
            "<h2>Our Story</h2>"
            "<h1>HappyDoods</h1>"  # dup
            "<h2>Latest Products</h2>"
        )
        out = _extract_headlines(html)
        assert out == ["HappyDoods", "Our Story", "Latest Products"]

    def test_strips_inner_tags(self):
        html = '<h1 class="display"><span class="brand">Happy</span>' "<em>Doods</em></h1>"
        assert _extract_headlines(html) == ["Happy Doods"]

    def test_returns_empty_when_no_headings(self):
        assert _extract_headlines("<p>just body text</p>") == []

    def test_caps_per_page(self):
        many = "".join(f"<h2>Section {i}</h2>" for i in range(20))
        out = _extract_headlines(many)
        assert 0 < len(out) <= 5


class TestExtractImageAlts:
    def test_collects_alt_attributes_in_order(self):
        html = (
            '<img alt="chickens in field" src="a.jpg">'
            '<img src="b.jpg" alt="eggs basket">'
            '<img alt="chickens in field" src="c.jpg">'  # dup
        )
        assert _extract_image_alts(html) == ["chickens in field", "eggs basket"]

    def test_no_alts_returns_empty(self):
        assert _extract_image_alts('<img src="a.jpg">') == []


class TestExtractNavLabels:
    def test_prefers_nav_region_when_present(self):
        header = (
            '<header><nav><a href="/">Home</a> <a href="/about">About</a></nav>'
            '<a href="/extra">Header-only anchor</a></header>'
        )
        assert _extract_nav_labels(header) == ["Home", "About"]

    def test_falls_back_to_full_header_when_no_nav(self):
        header = '<header><a href="/">Home</a> <a href="/about">About</a></header>'
        assert _extract_nav_labels(header) == ["Home", "About"]

    def test_empty_header_returns_empty(self):
        assert _extract_nav_labels("") == []

    def test_dedupes_identical_labels(self):
        header = "<nav><a>Home</a><a>Home</a></nav>"
        assert _extract_nav_labels(header) == ["Home"]


class TestExtractBrandName:
    def test_prefers_header_h1(self):
        assert _extract_brand_name("<header><h1>HappyDoods</h1></header>", "") == "HappyDoods"

    def test_skips_generic_nav_labels_when_picking_anchor_brand(self):
        header = (
            '<header><a href="/">Home</a>'
            '<a href="/shop">HappyDoods</a>'
            '<a href="/about">About</a></header>'
        )
        assert _extract_brand_name(header, "") == "HappyDoods"

    def test_falls_back_to_title_before_separator(self):
        assert _extract_brand_name("", "HappyDoods - Organic Chicken Farm") == "HappyDoods"
        assert _extract_brand_name("", "HappyDoods | Pasture-Raised Eggs") == "HappyDoods"

    def test_returns_empty_when_no_signal(self):
        assert _extract_brand_name("", "") == ""


class TestCanonicalSlugFromArtifactKey:
    @pytest.mark.parametrize(
        "key,expected",
        [
            ("content::page.html", ""),
            ("content:about-us:page.html", "about-us"),
            ("content:our-products:page.html", "our-products"),
            ("content:main:header.html", ""),  # singleton — caller filters
            ("codefocus_style:theme.css", ""),  # non-page — empty
            ("random.html", ""),
        ],
    )
    def test_parses_slug_segment(self, key: str, expected: str):
        assert _canonical_slug_from_artifact_key(key) == expected


class TestRenderDigestText:
    def test_renders_every_section(self):
        out = _render_digest_text(
            brand_name="HappyDoods",
            page_slugs=["", "about-us", "our-products"],
            nav_labels=["Home", "About", "Products"],
            headlines=["The Soul of the Homestead", "Our Story"],
            image_alts=["chickens in pasture", "eggs basket"],
            sample_copy="Pasture-raised eggs from happy birds on 40 acres.",
        )
        assert "Brand: HappyDoods" in out
        assert "(home)" in out  # empty slug rendered as (home)
        assert "about-us" in out
        assert "Nav: Home | About | Products" in out
        assert "The Soul of the Homestead" in out
        assert "chickens in pasture" in out
        assert "Pasture-raised eggs" in out

    def test_skips_empty_sections(self):
        out = _render_digest_text(
            brand_name="",
            page_slugs=[],
            nav_labels=[],
            headlines=[],
            image_alts=[],
            sample_copy="",
        )
        assert out == ""


# ── Integration: digest_bundle_artifacts ──────────────────────────────────


def _fake_ctx_with_artifacts(artifact_map: dict[str, str]):
    """Fake ctx whose list_artifact_keys / load_artifact return the given map."""

    artifact_service = SimpleNamespace()
    artifact_service.list_artifact_keys = AsyncMock(return_value=list(artifact_map.keys()))

    async def _load(session_id, user_id, app_name, filename, version=None):
        content = artifact_map.get(filename)
        if content is None:
            return None
        inline = SimpleNamespace(data=content.encode("utf-8"), mime_type="text/html")
        return SimpleNamespace(inline_data=inline)

    artifact_service.load_artifact = _load
    return SimpleNamespace(
        artifact_service=artifact_service,
        session=SimpleNamespace(id="s", user_id="u", app_name="a"),
    )


@pytest.mark.asyncio
class TestDigestBundleArtifacts:
    async def test_returns_none_when_no_content_pages(self):
        ctx = _fake_ctx_with_artifacts(
            {
                "codefocus_style:theme.css": "@theme {}",
                "content:main:header.html": "<header>…</header>",  # header alone, no pages
            }
        )
        result = await digest_bundle_artifacts(ctx)
        assert result is None

    async def test_builds_full_digest_for_happydoods_like_bundle(self):
        # Simulates what the DesignImporter would have saved for the
        # HappyDoods fixture.
        ctx = _fake_ctx_with_artifacts(
            {
                "codefocus_style:theme.css": "@theme {}",
                "content:main:header.html": (
                    "<header><nav>"
                    '<a href="/">Home</a>'
                    '<a href="/about-us">About Us</a>'
                    '<a href="/our-products">Products</a>'
                    '<a href="/contact-us">Contact</a>'
                    "</nav>"
                    "<h1>HappyDoods</h1>"
                    "</header>"
                ),
                "content::page.html": (
                    "<title>HappyDoods - Organic Chicken Farm</title>"
                    "<h1>The Soul of the Homestead</h1>"
                    "<h2>Our Story</h2>"
                    '<img alt="chickens grazing in pasture" src="x">'
                    "<p>Pasture-raised eggs from 40 acres of organic farm.</p>"
                ),
                "content:about-us:page.html": (
                    "<h1>Born from the Earth, Driven by Heart</h1>"
                    "<h2>Our Philosophy</h2>"
                    '<img alt="golden sunrise over farm field" src="y">'
                    "<p>HappyDoods Farm began with a simple belief.</p>"
                ),
                "content:our-products:page.html": (
                    "<h1>Latest Products</h1>"
                    "<h2>Pasture-Raised Heirloom Eggs</h2>"
                    "<h2>Whole Heritage Poultry</h2>"
                    '<img alt="basket of farm fresh eggs" src="z">'
                ),
                "content:contact-us:page.html": (
                    "<h1>Get in Touch</h1>" "<p>1234 Heritage Lane, Golden Valley, CA.</p>"
                ),
            }
        )

        digest = await digest_bundle_artifacts(ctx)
        assert digest is not None

        assert digest["brand_name"] == "HappyDoods"
        assert set(digest["page_slugs"]) == {"", "about-us", "our-products", "contact-us"}
        assert set(digest["nav_labels"]) == {"Home", "About Us", "Products", "Contact"}

        # Key headlines surface
        headlines_blob = " ".join(digest["headlines"]).lower()
        assert "homestead" in headlines_blob
        assert "heirloom eggs" in headlines_blob

        # Image alts surface — farm / chicken / eggs domain language
        alts_blob = " ".join(digest["image_alts"]).lower()
        assert "chicken" in alts_blob or "eggs" in alts_blob
        assert "pasture" in alts_blob or "farm" in alts_blob

        # Sample copy contains page bodies
        assert (
            "happydoods farm" in digest["sample_copy"].lower()
            or "pasture" in digest["sample_copy"].lower()
        )
        assert len(digest["sample_copy"]) <= 2000

        # Single-blob summary is the field PreCreator/Creator consume
        hints = digest["domain_hints"]
        assert "Brand: HappyDoods" in hints
        assert "(home)" in hints  # empty slug rendered
        assert "about-us" in hints
        # The bundle's domain is clearly farm — the digest should carry
        # enough of that signal to anchor a future LLM classification.
        assert "farm" in hints.lower() or "eggs" in hints.lower() or "pasture" in hints.lower()

    async def test_bounds_total_sample_copy(self):
        # Even with a wall-of-text page, the digest's sample_copy never
        # exceeds the ~2000-char cap.
        ctx = _fake_ctx_with_artifacts(
            {
                "content::page.html": "<p>" + ("x " * 5000) + "</p>",
            }
        )
        digest = await digest_bundle_artifacts(ctx)
        assert digest is not None
        assert len(digest["sample_copy"]) <= 2000
