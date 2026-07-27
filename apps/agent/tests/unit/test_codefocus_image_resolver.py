"""Unit tests for CodeFocus image resolver.

Tests cover:
- Image slot extraction (placeholders, hallucinated URLs, allowed URLs)
- Context extraction from TSX headings
- Orientation detection (portrait/landscape)
- Image prop building with orientation
- Fallback div replacement for unresolved images
- Keyword preprocessing compound term preservation
"""

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver import (
    _extract_context_from_tsx,
    _extract_image_slots,
    _build_image_prop,
    _needs_resolution,
    _inject_or_replace_src,
    _inject_or_replace_alt,
    _ARRAY_OBJ_PLACEHOLDER_PATTERN,
    _ARRAY_ALT_EXTRACT,
    _resolve_array_placeholders,
    _EXEPAD_IMAGE_PATTERN,
    _parse_exepad_image_props,
    _exepad_image_orientation,
    _inject_src_into_exepad_image,
    _ARRAY_EXEPAD_IMAGE_OBJ_PATTERN,
    _resolve_exepad_image_arrays,
)
from main_agent.agents.utils.image_generation_utils import (
    _preprocess_keywords,
    _strip_query_params,
)

# Mark all tests in this module as unit tests
pytestmark = pytest.mark.unit


# =============================================================================
# SLOT EXTRACTION TESTS
# =============================================================================


class TestExtractImageSlots:
    """Tests for _extract_image_slots().

    These exercise hallucinated-URL DETECTION, which only routes to
    resolution when a keyword-search stock provider is configured — so the
    class forces that on. The no-provider keep path is covered separately in
    ``TestNoProviderKeepGate``.
    """

    @pytest.fixture(autouse=True)
    def _provider_configured(self, monkeypatch):
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        monkeypatch.setattr(resolver_mod, "stock_provider_configured", lambda: True)

    def test_finds_placeholder_src(self):
        """Should detect __PLACEHOLDER__ src."""
        tsx = '<img src="__PLACEHOLDER__" alt="modern office" />'
        slots = _extract_image_slots(tsx)
        assert len(slots) == 1
        assert slots[0]["src"] == "__PLACEHOLDER__"
        assert slots[0]["alt"] == "modern office"

    def test_finds_hallucinated_url(self):
        """Should detect hallucinated domain URLs."""
        tsx = '<img src="https://images.unsplash.com/photo-123.jpg" alt="building" />'
        slots = _extract_image_slots(tsx)
        assert len(slots) == 1
        assert "unsplash.com" in slots[0]["src"]

    def test_finds_empty_src(self):
        """Should detect empty src."""
        tsx = '<img src="" alt="empty" />'
        slots = _extract_image_slots(tsx)
        assert len(slots) == 1

    def test_finds_data_uri(self):
        """Should detect data: URIs."""
        tsx = '<img src="data:image/svg+xml;base64,abc" alt="svg" />'
        slots = _extract_image_slots(tsx)
        assert len(slots) == 1

    def test_skips_allowed_urls(self):
        """Should NOT flag allowed domain URLs (e.g., GCS)."""
        tsx = '<img src="https://storage.googleapis.com/bucket/image.jpg" alt="real" />'
        slots = _extract_image_slots(tsx)
        assert len(slots) == 0

    def test_finds_multiple_slots(self):
        """Should extract multiple image slots."""
        tsx = """
        <img src="__PLACEHOLDER__" alt="first image" />
        <img src="https://unsplash.com/photo.jpg" alt="second image" />
        <img src="https://storage.googleapis.com/ok.jpg" alt="allowed" />
        """
        slots = _extract_image_slots(tsx)
        assert len(slots) == 2  # placeholder + unsplash, NOT gcs

    def test_multiline_img_tag(self):
        """Should handle img tags split across lines."""
        tsx = """<img
            src="__PLACEHOLDER__"
            alt="multiline test"
            className="w-full"
        />"""
        slots = _extract_image_slots(tsx)
        assert len(slots) == 1
        assert slots[0]["alt"] == "multiline test"

    def test_various_hallucinated_domains(self):
        """Should detect various known hallucinated domains."""
        # NB: picsum.photos is intentionally NOT here — it is now allowlisted
        # as the keyless fallback provider (see catalog.ALLOWED_IMAGE_DOMAINS).
        domains = [
            "https://unsplash.com/photo.jpg",
            "https://images.unsplash.com/photo.jpg",
            "https://via.placeholder.com/400",
            "https://img.freepik.com/photo.jpg",
            "https://images.pexels.com/photo.jpg",
        ]
        for domain_url in domains:
            tsx = f'<img src="{domain_url}" alt="test" />'
            slots = _extract_image_slots(tsx)
            assert len(slots) == 1, f"Should flag: {domain_url}"

    def test_picsum_now_allowlisted_not_flagged(self):
        """picsum.photos is the keyless fallback provider — never flagged."""
        tsx = '<img src="https://picsum.photos/seed/x/400/300" alt="test" />'
        assert len(_extract_image_slots(tsx)) == 0

    def test_skips_resolved_urls(self):
        """Should NOT flag stock API URLs that are in resolved_urls."""
        url = "https://images.unsplash.com/photo-456-office.jpg"
        tsx = f'<img src="{url}" alt="modern office" />'
        slots = _extract_image_slots(tsx, resolved_urls={url})
        assert len(slots) == 0

    def test_still_flags_unresolved_hallucinated(self):
        """Should still flag hallucinated URLs not in resolved_urls."""
        url = "https://images.unsplash.com/photo-789.jpg"
        tsx = f'<img src="{url}" alt="test" />'
        slots = _extract_image_slots(tsx, resolved_urls=set())
        assert len(slots) == 1

    def test_stock_cdn_flagged_without_resolved_urls(self):
        """Stock CDN domains should be flagged when not in resolved_urls."""
        cdn_urls = [
            "https://img.b2bpic.net/premium-photo/some-image.jpg",
            "https://img.freepik.com/free-photo/office.jpg",
            "https://images.pexels.com/photos/123/pexels-photo.jpeg",
        ]
        for url in cdn_urls:
            tsx = f'<img src="{url}" alt="test" />'
            slots = _extract_image_slots(tsx)
            assert len(slots) == 1, f"Should flag without resolved_urls: {url}"

    def test_stock_cdn_bypassed_via_resolved_urls(self):
        """Stock CDN domains should pass when present in resolved_urls (API-fetched)."""
        cdn_urls = [
            "https://img.b2bpic.net/premium-photo/some-image.jpg?w=1920",
            "https://img.freepik.com/free-photo/office.jpg?w=1920",
            "https://images.pexels.com/photos/123/pexels-photo.jpeg",
        ]
        for url in cdn_urls:
            tsx = f'<img src="{url}" alt="test" />'
            slots = _extract_image_slots(tsx, resolved_urls={url})
            assert len(slots) == 0, f"Should bypass via resolved_urls: {url}"

    def test_skips_dynamic_src_expression(self):
        """Should NOT extract <img> tags with dynamic src={...} expressions."""
        tsx = '<img src={item.image} alt={item.alt} className="w-full" />'
        slots = _extract_image_slots(tsx)
        assert len(slots) == 0

    def test_skips_dynamic_src_in_map_loop(self):
        """Should NOT extract <img> tags inside .map() with dynamic src={param.image}."""
        tsx = """{photos.map((photo, i) => (
          <div key={i}>
            <img src={photo.image} alt={photo.alt} className="w-full" />
          </div>
        ))}"""
        slots = _extract_image_slots(tsx)
        assert len(slots) == 0


# =============================================================================
# NEEDS RESOLUTION TESTS
# =============================================================================


class TestNeedsResolution:
    """Tests for _needs_resolution() with a stock provider configured.

    The no-provider keep path (hallucinated URL kept verbatim) is covered in
    ``TestNoProviderKeepGate``.
    """

    @pytest.fixture(autouse=True)
    def _provider_configured(self, monkeypatch):
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        monkeypatch.setattr(resolver_mod, "stock_provider_configured", lambda: True)

    def test_empty_src(self):
        assert _needs_resolution("") is True

    def test_placeholder_sentinel(self):
        assert _needs_resolution("__PLACEHOLDER__") is True

    def test_data_uri(self):
        assert _needs_resolution("data:image/png;base64,abc") is True

    def test_hallucinated_url(self):
        assert _needs_resolution("https://images.unsplash.com/photo.jpg") is True

    def test_allowed_url(self):
        assert _needs_resolution("https://storage.googleapis.com/bucket/img.jpg") is False

    def test_exepad_url(self):
        assert _needs_resolution("https://exepad.com/assets/logo.png") is False

    def test_stock_cdn_needs_resolution(self):
        """Stock CDN domains should need resolution (hallucinated by default)."""
        assert _needs_resolution("https://img.b2bpic.net/photo.jpg") is True
        assert _needs_resolution("https://img.freepik.com/photo.jpg") is True
        assert _needs_resolution("https://images.pexels.com/photo.jpg") is True

    def test_stock_cdn_bypassed_via_resolved_urls(self):
        """Stock CDN domains should NOT need resolution when in resolved_urls."""
        urls = [
            "https://img.b2bpic.net/photo.jpg?w=1920",
            "https://img.freepik.com/photo.jpg?w=800",
            "https://images.pexels.com/photo.jpg",
        ]
        for url in urls:
            assert _needs_resolution(url, resolved_urls={url}) is False

    def test_resolved_url_skipped(self):
        """Hallucinated domain URL should pass if it's in resolved_urls."""
        url = "https://images.unsplash.com/photo-office.jpg"
        assert _needs_resolution(url) is True
        assert _needs_resolution(url, resolved_urls={url}) is False

    def test_resolved_urls_none_default(self):
        """With resolved_urls=None, behavior is unchanged."""
        assert (
            _needs_resolution("https://images.unsplash.com/photo.jpg", resolved_urls=None) is True
        )


# =============================================================================
# CONTEXT EXTRACTION TESTS
# =============================================================================


class TestExtractContextFromTsx:
    """Tests for _extract_context_from_tsx()."""

    def test_extracts_heading_text(self):
        tsx = '<h2>Our Team Members</h2><div><img src="__PLACEHOLDER__" />'
        img_pos = tsx.index("<img")
        context_kw, orientation = _extract_context_from_tsx(tsx, img_pos)
        assert "our team members" in context_kw.lower()

    def test_detects_portrait_context(self):
        tsx = '<section class="team"><h2>Team</h2><div class="member"><img src="__PLACEHOLDER__" />'
        img_pos = tsx.index("<img")
        _, orientation = _extract_context_from_tsx(tsx, img_pos)
        assert orientation == "portrait"

    def test_detects_landscape_context(self):
        tsx = '<section class="hero"><h1>Welcome</h1><img src="__PLACEHOLDER__" />'
        img_pos = tsx.index("<img")
        _, orientation = _extract_context_from_tsx(tsx, img_pos)
        assert orientation == "landscape"

    def test_defaults_to_landscape(self):
        tsx = '<div><p>Some text</p><img src="__PLACEHOLDER__" />'
        img_pos = tsx.index("<img")
        _, orientation = _extract_context_from_tsx(tsx, img_pos)
        assert orientation == "landscape"

    def test_empty_context(self):
        tsx = '<img src="__PLACEHOLDER__" />'
        context_kw, orientation = _extract_context_from_tsx(tsx, 0)
        assert context_kw == ""
        assert orientation == "landscape"


# =============================================================================
# BUILD IMAGE PROP TESTS
# =============================================================================


class TestBuildImageProp:
    """Tests for _build_image_prop()."""

    def test_landscape_dimensions(self):
        # Mobile-first defaults — see codefocus_image_resolver._build_image_prop docstring
        prop = _build_image_prop("office building", "landscape")
        assert prop["asset"]["requested_width"] == 800
        assert prop["asset"]["requested_height"] == 500

    def test_portrait_dimensions(self):
        prop = _build_image_prop("team portrait", "portrait")
        assert prop["asset"]["requested_width"] == 600
        assert prop["asset"]["requested_height"] == 800

    def test_square_dimensions(self):
        prop = _build_image_prop("logo", "square")
        assert prop["asset"]["requested_width"] == 600
        assert prop["asset"]["requested_height"] == 600

    def test_default_landscape(self):
        prop = _build_image_prop("some image")
        assert prop["asset"]["requested_width"] == 800
        assert prop["asset"]["requested_height"] == 500

    def test_explicit_width_height_override(self):
        # When the caller passes explicit dimensions (e.g. from an
        # ExepadImage tag's width/height props), they override the
        # orientation-based defaults and get capped at 1200.
        prop = _build_image_prop("card image", "landscape", width=400, height=500)
        assert prop["asset"]["requested_width"] == 400
        assert prop["asset"]["requested_height"] == 500

    def test_explicit_dimensions_capped_at_1200(self):
        prop = _build_image_prop("hero", "landscape", width=1920, height=1080)
        assert prop["asset"]["requested_width"] == 1200
        assert prop["asset"]["requested_height"] == 1080

    def test_keywords_passed_through(self):
        prop = _build_image_prop("modern architecture studio")
        assert prop["asset"]["keywords"] == "modern architecture studio"


# =============================================================================
# KEYWORD PREPROCESSING TESTS
# =============================================================================


class TestPreprocessKeywords:
    """Tests for _preprocess_keywords() in image_generation_utils."""

    def test_removes_stop_words(self):
        result = _preprocess_keywords("a photo of the building in the city")
        assert "a" not in result.split()
        assert "the" not in result.split()
        assert "of" not in result.split()
        assert "building" in result

    def test_preserves_compound_terms(self):
        result = _preprocess_keywords("modern architecture studio with natural light")
        assert "architecture studio" in result

    def test_limits_to_five_terms(self):
        result = _preprocess_keywords("one two three four five six seven eight")
        words = result.split()
        assert len(words) <= 5

    def test_deduplicates(self):
        result = _preprocess_keywords("building, building, office")
        assert result.count("building") == 1

    def test_fallback_to_abstract_background(self):
        result = _preprocess_keywords("")
        assert result == "abstract background"

    def test_comma_separated_input(self):
        result = _preprocess_keywords("modern office, bright lighting, glass walls")
        assert "modern" in result
        assert "office" in result

    def test_preserves_natural_light_compound(self):
        result = _preprocess_keywords("workspace with natural light and plants")
        assert "natural light" in result


# =============================================================================
# ATTRIBUTE INJECTION TESTS
# =============================================================================


class TestInjectOrReplaceAttr:
    """Tests for _inject_or_replace_src and _inject_or_replace_alt."""

    def test_inject_src(self):
        url = "https://example.com/img.jpg"
        # Injects when missing
        assert (
            _inject_or_replace_src('<img alt="test" />', url) == f'<img src="{url}" alt="test" />'
        )
        # Replaces empty
        assert (
            _inject_or_replace_src('<img src="" alt="test" />', url)
            == f'<img src="{url}" alt="test" />'
        )
        # Replaces existing
        assert _inject_or_replace_src('<img src="foo" />', url) == f'<img src="{url}" />'
        # Preserves dynamic JSX src (e.g., src={item.image} in .map() loops)
        assert (
            _inject_or_replace_src('<img src={dynamic} alt="test" />', url)
            == '<img src={dynamic} alt="test" />'
        )
        # Handles multiline
        assert (
            _inject_or_replace_src('<img\nclassName="w-full" />', url)
            == f'<img src="{url}"\nclassName="w-full" />'
        )

    def test_inject_alt(self):
        alt = "test alt"
        # Injects when missing
        assert (
            _inject_or_replace_alt('<img src="url" />', alt) == '<img alt="test alt" src="url" />'
        )
        # Replaces empty
        assert (
            _inject_or_replace_alt('<img alt="" src="url" />', alt)
            == '<img alt="test alt" src="url" />'
        )
        # Replaces existing string alt
        assert (
            _inject_or_replace_alt('<img alt="foo" src="url" />', alt)
            == '<img alt="test alt" src="url" />'
        )
        # Leaves dynamic JSX alt alone
        assert (
            _inject_or_replace_alt('<img alt={dynamic} src="url" />', alt)
            == '<img alt={dynamic} src="url" />'
        )
        # Handles multiline
        assert (
            _inject_or_replace_alt('<img\nsrc="url" />', alt) == '<img alt="test alt"\nsrc="url" />'
        )


# =============================================================================
# URL DEDUP HELPER TESTS
# =============================================================================


class TestStripQueryParams:
    """Tests for _strip_query_params() used in dedup."""

    def test_strips_single_param(self):
        assert _strip_query_params("https://images.pexels.com/photo.jpg?w=1920") == (
            "https://images.pexels.com/photo.jpg"
        )

    def test_strips_multiple_params(self):
        assert _strip_query_params("https://pixabay.com/get/photo.jpg?w=1920&q=80") == (
            "https://pixabay.com/get/photo.jpg"
        )

    def test_no_params_unchanged(self):
        url = "https://images.pexels.com/photo.jpg"
        assert _strip_query_params(url) == url

    def test_empty_string(self):
        assert _strip_query_params("") == ""


# =============================================================================
# ARRAY PLACEHOLDER PATTERN TESTS
# =============================================================================


class TestArrayObjPlaceholderPattern:
    """Tests for _ARRAY_OBJ_PLACEHOLDER_PATTERN regex."""

    def test_finds_image_placeholder_in_object(self):
        tsx = '{ name: "Alice", image: "__PLACEHOLDER__", alt: "portrait of female CEO" }'
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 1

    def test_finds_src_placeholder(self):
        tsx = '{ title: "Card", src: "__PLACEHOLDER__", alt: "sunset" }'
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 1

    def test_finds_avatar_placeholder(self):
        tsx = '{ name: "Bob", avatar: "__PLACEHOLDER__", alt: "headshot" }'
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 1

    def test_finds_thumbnail_placeholder(self):
        tsx = '{ title: "Post", thumbnail: "__PLACEHOLDER__", alt: "blog hero" }'
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 1

    def test_finds_cover_placeholder(self):
        tsx = '{ title: "Album", cover: "__PLACEHOLDER__", alt: "album cover" }'
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 1

    def test_finds_multiple_in_array(self):
        tsx = """const items = [
          { name: "A", image: "__PLACEHOLDER__", alt: "landscape sunset golden hour" },
          { name: "B", image: "__PLACEHOLDER__", alt: "wedding couple dancing" },
          { name: "C", image: "__PLACEHOLDER__", alt: "portrait studio lighting" },
        ];"""
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 3

    def test_ignores_real_urls(self):
        tsx = '{ name: "A", image: "https://example.com/img.jpg", alt: "test" }'
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 0

    def test_ignores_non_image_keys(self):
        tsx = '{ name: "__PLACEHOLDER__", role: "CEO" }'
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 0

    def test_single_quoted_placeholder(self):
        tsx = "{ name: 'A', image: '__PLACEHOLDER__', alt: 'test image' }"
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 1


class TestArrayAltExtract:
    """Tests for _ARRAY_ALT_EXTRACT regex."""

    def test_extracts_alt(self):
        obj = '{ image: "__PLACEHOLDER__", alt: "modern office lobby" }'
        m = _ARRAY_ALT_EXTRACT.search(obj)
        assert m is not None
        assert m.group(1) == "modern office lobby"

    def test_extracts_altText(self):
        obj = '{ image: "__PLACEHOLDER__", altText: "sunset landscape" }'
        m = _ARRAY_ALT_EXTRACT.search(obj)
        assert m is not None
        assert m.group(1) == "sunset landscape"

    def test_extracts_description(self):
        obj = '{ image: "__PLACEHOLDER__", description: "team working together" }'
        m = _ARRAY_ALT_EXTRACT.search(obj)
        assert m is not None
        assert m.group(1) == "team working together"

    def test_extracts_imageAlt(self):
        obj = '{ image: "__PLACEHOLDER__", imageAlt: "cinematic wedding couple" }'
        m = _ARRAY_ALT_EXTRACT.search(obj)
        assert m is not None
        assert m.group(1) == "cinematic wedding couple"

    def test_no_alt_returns_none(self):
        obj = '{ image: "__PLACEHOLDER__", name: "Alice" }'
        m = _ARRAY_ALT_EXTRACT.search(obj)
        assert m is None


# =============================================================================
# ARRAY PLACEHOLDER RESOLUTION (ASYNC) TESTS
# =============================================================================


class TestResolveArrayPlaceholders:
    """Tests for _resolve_array_placeholders() async function."""

    async def test_finds_and_marks_placeholders(self):
        """Should find __PLACEHOLDER__ in array objects and prepare them for resolution."""
        tsx = """const team = [
          { name: "Alice", image: "__PLACEHOLDER__", alt: "portrait of female CEO" },
          { name: "Bob", image: "__PLACEHOLDER__", alt: "portrait of male CTO" },
        ];"""
        # With no API keys, placeholders won't be replaced (no stock images fetched)
        # but the function should still detect them
        matches = list(_ARRAY_OBJ_PLACEHOLDER_PATTERN.finditer(tsx))
        assert len(matches) == 2

    async def test_preserves_non_placeholder_code(self):
        """Code without __PLACEHOLDER__ in arrays should be unchanged."""
        tsx = """const data = [
          { name: "Alice", role: "CEO" },
          { name: "Bob", role: "CTO" },
        ];
        <img src="__PLACEHOLDER__" alt="hero image" />"""
        updated, count, urls = await _resolve_array_placeholders(tsx, [], set(), set())
        # No array image placeholders to resolve
        assert count == 0
        # The <img> placeholder is handled by the main resolver, not this function
        assert "__PLACEHOLDER__" in updated

    async def test_handles_empty_tsx(self):
        updated, count, urls = await _resolve_array_placeholders("", [], set(), set())
        assert count == 0
        assert updated == ""

    async def test_uses_sibling_keywords_over_alt_fallback(self, monkeypatch):
        """Sibling ``keywords:`` literal must drive search, not 'abstract background'.

        Regresses the L'Anima edit-run bug: the dish array preserved
        ``keywords: "italian pasta dish gourmet plating"`` but the resolver
        ignored it and searched with the generic fallback.
        """
        captured: dict = {}

        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        async def fake_process(image_prop, **kwargs):
            captured["asset"] = image_prop.get("asset", {})
            return {"src": "https://stable.example/pasta.jpg"}

        monkeypatch.setattr(resolver_mod, "process_one_image_prop", fake_process)

        tsx = """const dishes = [
            { name: "Cacio e Pepe", image: "__PLACEHOLDER__", keywords: "authentic italian cacio e pepe pasta dish close up" }
        ];"""
        updated, count, urls = await _resolve_array_placeholders(tsx, [], set(), set())
        assert count == 1
        assert "https://stable.example/pasta.jpg" in updated
        assert "authentic italian cacio e pepe pasta dish close up" in captured["asset"]["keywords"]
        assert "abstract background" not in captured["asset"]["keywords"]

    async def test_uses_sibling_dimensions_for_orientation(self, monkeypatch):
        """Sibling ``width`` / ``height`` literals must drive the requested
        dimensions and orientation, not the legacy 800x500 default."""
        captured: dict = {}

        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        async def fake_process(image_prop, **kwargs):
            captured["asset"] = image_prop.get("asset", {})
            return {"src": "https://stable.example/portrait.jpg"}

        monkeypatch.setattr(resolver_mod, "process_one_image_prop", fake_process)

        tsx = """const team = [
            { id: "1", image: "__PLACEHOLDER__", keywords: "professional headshot business attire", width: 600, height: 900 }
        ];"""
        await _resolve_array_placeholders(tsx, [], set(), set())
        assert captured["asset"]["requested_width"] == 600
        assert captured["asset"]["requested_height"] == 900

    async def test_pexels_by_id_refetch_when_assetid_present(self, monkeypatch):
        """When ``vendor: "pexels"`` + ``assetId`` are preserved, the resolver
        must re-fetch by id — not re-search by keywords. Otherwise edits
        silently swap images. Regresses the L'Anima edit-run bug."""
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        by_id_calls: list[str] = []
        search_calls: list = []

        async def fake_by_id(image_prop, photo_id, **kwargs):
            by_id_calls.append(photo_id)
            image_prop["src"] = f"https://stable.example/pexels-{photo_id}.jpg"
            return image_prop

        async def fake_search(image_prop, **kwargs):
            search_calls.append(image_prop)
            image_prop["src"] = "https://stable.example/SHOULD_NOT_HAPPEN.jpg"
            return image_prop

        monkeypatch.setattr(resolver_mod, "get_pexels_photo_by_id", fake_by_id)
        monkeypatch.setattr(resolver_mod, "process_one_image_prop", fake_search)

        tsx = """const dishes = [
            { name: "Cacio e Pepe", image: "__PLACEHOLDER__", keywords: "italian pasta", vendor: "pexels", assetId: "36720347" }
        ];"""
        updated, count, urls = await _resolve_array_placeholders(tsx, [], set(), set())
        assert count == 1
        assert by_id_calls == ["36720347"]
        assert search_calls == []
        assert "pexels-36720347.jpg" in updated

    async def test_pexels_by_id_falls_back_to_search_on_failure(self, monkeypatch):
        """If the by-id refetch returns no src (404 / network error), the
        resolver must fall through to a keyword search."""
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        async def fake_by_id(image_prop, photo_id, **kwargs):
            # Simulate 404 — leave src empty
            return image_prop

        async def fake_search(image_prop, **kwargs):
            image_prop["src"] = "https://stable.example/fallback.jpg"
            return image_prop

        monkeypatch.setattr(resolver_mod, "get_pexels_photo_by_id", fake_by_id)
        monkeypatch.setattr(resolver_mod, "process_one_image_prop", fake_search)

        tsx = """const dishes = [
            { image: "__PLACEHOLDER__", keywords: "italian pasta dish gourmet", vendor: "pexels", assetId: "999999" }
        ];"""
        updated, count, urls = await _resolve_array_placeholders(tsx, [], set(), set())
        assert count == 1
        assert "fallback.jpg" in updated

    async def test_pixabay_by_id_refetch_when_assetid_present(self, monkeypatch):
        """Mirror the Pexels by-id assertion for the Pixabay path."""
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        by_id_calls: list[tuple[str, str]] = []

        async def fake_by_id(image_prop, resource_id, app_uuid=""):
            by_id_calls.append((resource_id, app_uuid))
            image_prop["src"] = f"https://pixabay.com/get/g{resource_id}_640.jpg"
            return image_prop

        monkeypatch.setattr(resolver_mod, "get_pixabay_photo_by_id", fake_by_id)

        tsx = """const heroes = [
            { image: "__PLACEHOLDER__", keywords: "luxury italian restaurant interior", vendor: "pixabay", assetId: "44912622" }
        ];"""
        updated, count, urls = await _resolve_array_placeholders(
            tsx, [], set(), set(), app_uuid="abc-123"
        )
        assert count == 1
        assert by_id_calls == [("44912622", "abc-123")]
        assert "https://pixabay.com/get/g44912622_640.jpg" in updated

    async def test_openverse_by_id_refetch_when_assetid_present(self, monkeypatch):
        """A preserved vendor="openverse" + assetId re-resolves by id."""
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        by_id_calls: list[tuple[str, str]] = []

        async def fake_by_id(image_prop, image_id, app_uuid=""):
            by_id_calls.append((image_id, app_uuid))
            image_prop["src"] = f"https://api.openverse.org/v1/images/{image_id}/thumb/"
            return image_prop

        monkeypatch.setattr(resolver_mod, "get_openverse_image_by_id", fake_by_id)

        tsx = """const heroes = [
            { image: "__PLACEHOLDER__", keywords: "mountain lake sunrise", vendor: "openverse", assetId: "ov-77" }
        ];"""
        updated, count, urls = await _resolve_array_placeholders(
            tsx, [], set(), set(), app_uuid="abc-123"
        )
        assert count == 1
        assert by_id_calls == [("ov-77", "abc-123")]
        assert "https://api.openverse.org/v1/images/ov-77/thumb/" in updated


# =============================================================================
# EXEPAD IMAGE PATTERN TESTS
# =============================================================================


class TestExepadImagePattern:
    """Tests for _EXEPAD_IMAGE_PATTERN regex."""

    def test_finds_basic_exepad_image(self):
        tsx = '<ExepadImage keywords="modern office" importance={8} />'
        matches = list(_EXEPAD_IMAGE_PATTERN.finditer(tsx))
        assert len(matches) == 1

    def test_finds_multiple(self):
        tsx = """
        <ExepadImage keywords="hero banner" importance={9} width={1920} height={1080} />
        <ExepadImage keywords="team portrait" importance={6} width={800} height={1200} />
        """
        matches = list(_EXEPAD_IMAGE_PATTERN.finditer(tsx))
        assert len(matches) == 2

    def test_finds_multiline_tag(self):
        tsx = """<ExepadImage
            keywords="luxury wedding venue"
            importance={9}
            width={1920}
            height={1080}
            className="w-full h-[500px]"
        />"""
        matches = list(_EXEPAD_IMAGE_PATTERN.finditer(tsx))
        assert len(matches) == 1

    def test_ignores_regular_img(self):
        tsx = '<img src="__PLACEHOLDER__" alt="test" />'
        matches = list(_EXEPAD_IMAGE_PATTERN.finditer(tsx))
        assert len(matches) == 0


class TestParseExepadImageProps:
    """Tests for _parse_exepad_image_props()."""

    def test_parses_all_props(self):
        body = ' keywords="modern office lobby" width={1920} height={1080} importance={8} '
        props = _parse_exepad_image_props(body)
        assert props["keywords"] == "modern office lobby"
        assert props["width"] == 1920
        assert props["height"] == 1080
        assert props["importance"] == 8

    def test_defaults_without_optional(self):
        body = ' keywords="sunset landscape" '
        props = _parse_exepad_image_props(body)
        assert props["keywords"] == "sunset landscape"
        assert props["width"] is None
        assert props["height"] is None
        assert props["importance"] == 5  # default

    def test_empty_body(self):
        props = _parse_exepad_image_props("")
        assert props["keywords"] == ""
        assert props["importance"] == 5

    def test_detects_existing_src(self):
        body = ' keywords="test" src="https://example.com/img.jpg" importance={7} '
        props = _parse_exepad_image_props(body)
        assert props["src"] == "https://example.com/img.jpg"

    def test_single_quoted_keywords(self):
        body = " keywords='night sky with stars' importance={4} "
        props = _parse_exepad_image_props(body)
        assert props["keywords"] == "night sky with stars"

    def test_parses_vendor_and_asset_id(self):
        body = ' keywords="test" importance={7} vendor="pixabay" assetId="12345" '
        props = _parse_exepad_image_props(body)
        assert props["vendor"] == "pixabay"
        assert props["assetId"] == "12345"

    def test_defaults_vendor_and_asset_id_empty(self):
        body = ' keywords="test" importance={5} '
        props = _parse_exepad_image_props(body)
        assert props["vendor"] == ""
        assert props["assetId"] == ""

    def test_jsx_expression_keywords_double_quote(self):
        body = ' keywords={"night sky with stars"} importance={4} '
        props = _parse_exepad_image_props(body)
        assert props["keywords"] == "night sky with stars"

    def test_jsx_expression_keywords_single_quote(self):
        body = " keywords={'sunset over mountains'} importance={6} "
        props = _parse_exepad_image_props(body)
        assert props["keywords"] == "sunset over mountains"


class TestExepadImageMissingKeywordsFallback:
    """Tests for missing keywords fallback in the resolver.

    When ExepadImage lacks keywords, the resolver derives them from
    alt prop or nearby heading context before skipping.
    """

    def test_parse_returns_empty_keywords_when_missing(self):
        body = ' importance={8} className="w-full h-64" '
        props = _parse_exepad_image_props(body)
        assert props["keywords"] == ""

    def test_alt_prop_available_for_fallback(self):
        """Alt text on a no-keywords tag can be extracted via regex."""
        import re

        tag = '<ExepadImage alt="freshly baked sourdough loaf" importance={8} />'
        alt_m = re.search(r"""alt=\{?["']([^"']+)["']\}?""", tag)
        assert alt_m is not None
        assert alt_m.group(1) == "freshly baked sourdough loaf"

    def test_heading_context_fallback(self):
        """_extract_context_from_tsx derives keywords from nearby headings."""
        tsx = "<h2>Our Bakery Story</h2>\n<ExepadImage importance={7} />"
        pos = tsx.index("<ExepadImage")
        context_kw, _ = _extract_context_from_tsx(tsx, pos)
        assert "bakery" in context_kw.lower()


class TestExepadImageOrientation:
    """Tests for _exepad_image_orientation()."""

    def test_landscape(self):
        assert _exepad_image_orientation(1920, 1080) == "landscape"

    def test_portrait(self):
        assert _exepad_image_orientation(800, 1200) == "portrait"

    def test_square(self):
        assert _exepad_image_orientation(1080, 1080) == "square"

    def test_none_defaults_landscape(self):
        assert _exepad_image_orientation(None, None) == "landscape"

    def test_width_only_defaults_landscape(self):
        assert _exepad_image_orientation(1920, None) == "landscape"


class TestInjectSrcIntoExepadImage:
    """Tests for _inject_src_into_exepad_image()."""

    def test_injects_src(self):
        tag = '<ExepadImage keywords="test" importance={8} />'
        result = _inject_src_into_exepad_image(tag, "https://example.com/img.jpg")
        assert 'src="https://example.com/img.jpg"' in result
        assert 'keywords="test"' in result

    def test_replaces_existing_src(self):
        tag = '<ExepadImage keywords="test" src="old.jpg" importance={8} />'
        result = _inject_src_into_exepad_image(tag, "https://new.com/img.jpg")
        assert 'src="https://new.com/img.jpg"' in result
        assert "old.jpg" not in result

    def test_preserves_other_props(self):
        tag = '<ExepadImage keywords="test" importance={8} className="w-full" />'
        result = _inject_src_into_exepad_image(tag, "https://example.com/img.jpg")
        assert 'className="w-full"' in result
        assert "importance={8}" in result

    def test_injects_vendor_and_asset_id(self):
        tag = '<ExepadImage keywords="test" importance={8} />'
        result = _inject_src_into_exepad_image(
            tag, "https://example.com/img.jpg", vendor="pixabay", asset_id="99"
        )
        assert 'src="https://example.com/img.jpg"' in result
        assert 'vendor="pixabay"' in result
        assert 'assetId="99"' in result

    def test_replaces_existing_vendor(self):
        tag = '<ExepadImage keywords="test" vendor="old" importance={8} />'
        result = _inject_src_into_exepad_image(
            tag, "https://example.com/img.jpg", vendor="pexels", asset_id="42"
        )
        assert 'vendor="pexels"' in result
        assert "old" not in result

    def test_skips_empty_vendor_asset_id(self):
        tag = '<ExepadImage keywords="test" importance={8} />'
        result = _inject_src_into_exepad_image(tag, "https://example.com/img.jpg")
        assert "vendor" not in result
        assert "assetId" not in result

    def test_does_not_append_to_dynamic_src(self):
        # 3h9jgqt5 BeerMenuContent (2026-05-22): a per-row ExepadImage with a
        # dynamic src={beer.image} must NOT get a second static src= appended
        # (JSX last-wins → every .map() row renders the same static image).
        tag = '<ExepadImage src={beer.image} keywords="craft beer" importance={7} />'
        result = _inject_src_into_exepad_image(
            tag, "__ASSET_IMG:assets/images/bottle.jpg__", vendor="pixabay", asset_id="34389370"
        )
        # Tag is returned unchanged — data-driven src is respected.
        assert result == tag
        assert result.count("src=") == 1
        assert "src={beer.image}" in result

    def test_dynamic_src_guard_never_yields_duplicate_src(self):
        # Even with a template-literal dynamic src, exactly one src= survives.
        tag = '<ExepadImage src={`/img/${row.id}.jpg`} keywords="x" importance={5} />'
        result = _inject_src_into_exepad_image(tag, "https://cdn/x.jpg", vendor="pexels")
        assert result.count("src=") == 1
        assert "vendor=" not in result  # untouched: no injection on dynamic-src tags


# =============================================================================
# EXEPAD IMAGE ARRAY PATTERN TESTS
# =============================================================================


class TestExepadImageArrayPattern:
    """Tests for _ARRAY_EXEPAD_IMAGE_OBJ_PATTERN regex."""

    def test_finds_image_object_with_keywords(self):
        tsx = '{ name: "Alice", image: { keywords: "portrait female CEO", importance: 7 } }'
        matches = list(_ARRAY_EXEPAD_IMAGE_OBJ_PATTERN.finditer(tsx))
        assert len(matches) == 1

    def test_finds_multiple_in_array(self):
        tsx = """const team = [
          { name: "A", image: { keywords: "portrait A", importance: 7 } },
          { name: "B", image: { keywords: "portrait B", importance: 6 } },
        ];"""
        matches = list(_ARRAY_EXEPAD_IMAGE_OBJ_PATTERN.finditer(tsx))
        assert len(matches) == 2

    def test_ignores_non_image_objects(self):
        tsx = '{ name: "Alice", role: { title: "CEO", level: 1 } }'
        matches = list(_ARRAY_EXEPAD_IMAGE_OBJ_PATTERN.finditer(tsx))
        assert len(matches) == 0

    def test_ignores_legacy_placeholder(self):
        """Legacy __PLACEHOLDER__ pattern should NOT match the ExepadImage pattern."""
        tsx = '{ name: "A", image: "__PLACEHOLDER__", alt: "test" }'
        matches = list(_ARRAY_EXEPAD_IMAGE_OBJ_PATTERN.finditer(tsx))
        assert len(matches) == 0


# =============================================================================
# EXEPAD IMAGE ARRAY INJECTION TESTS
# =============================================================================


class TestExepadImageArrayInjection:
    """Tests for _resolve_exepad_image_arrays property injection into JS objects."""

    async def test_trailing_comma_does_not_produce_double_comma(self):
        """LLMs often emit trailing commas; injection must not produce ',,'."""
        tsx = """const items = [
  {
    title: "Item",
    image: {
      keywords: "test image",
      importance: 7,
    }
  }
];"""
        # Run with empty catalog so no actual fetches happen
        updated, count, _ = await _resolve_exepad_image_arrays(
            tsx,
            image_catalog=[],
            used_uuids=set(),
            used_urls=set(),
            app_uuid="",
        )
        # No images fetched (empty catalog, no provider) so TSX unchanged
        assert ",," not in updated

    async def test_no_trailing_comma_injection_is_clean(self):
        """Object without trailing comma should produce clean injection."""
        tsx = 'const x = [{ title: "A", image: { keywords: "dog", importance: 5 } }];'
        updated, count, _ = await _resolve_exepad_image_arrays(
            tsx,
            image_catalog=[],
            used_uuids=set(),
            used_urls=set(),
            app_uuid="",
        )
        assert ",," not in updated


# =============================================================================
# IMPORTANCE-BASED BUILD IMAGE PROP TESTS
# =============================================================================


class TestBuildImagePropWithImportance:
    """Tests for _build_image_prop() with importance parameter."""

    def test_default_importance(self):
        prop = _build_image_prop("test keywords")
        assert prop["asset"]["importance"] == 5

    def test_high_importance(self):
        prop = _build_image_prop("hero image", "landscape", 9)
        assert prop["asset"]["importance"] == 9
        # Mobile-first landscape default
        assert prop["asset"]["requested_width"] == 800

    def test_low_importance(self):
        prop = _build_image_prop("thumbnail", "square", 2)
        assert prop["asset"]["importance"] == 2
        # Mobile-first square default
        assert prop["asset"]["requested_width"] == 600


class TestCatalogMatchTransparency:
    """Layer 5: ``_try_catalog_match`` logo-slot preference + variant URLs.

    The resolver should prefer transparent-background candidates for logo
    slots (keywords contain ``logo``/``brand``/``wordmark``/``mark``) and
    emit ``transparent_variant_url`` when present so the component builder
    renders the rembg-cleaned sibling, not the baked-background original.
    """

    @staticmethod
    def _match(keywords, catalog, used=None):
        from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver import (
            _try_catalog_match,
        )

        return _try_catalog_match(keywords, catalog, used or set())

    def test_logo_slot_prefers_transparent_candidate(self):
        catalog = [
            {
                "uuid": "opaque-uuid",
                "url": "https://backend.example/api/media/app/i/opaque/",
                "description": "retailflux logo brand",
                "is_logo": True,
                "has_transparent_bg": False,
                "has_baked_bg": True,
            },
            {
                "uuid": "clean-uuid",
                "url": "https://backend.example/api/media/app/i/clean/",
                "description": "retailflux logo brand",
                "is_logo": True,
                "has_transparent_bg": True,
                "transparent_variant_url": (
                    "https://backend.example/api/media/app/i/clean/?variant=transparent"
                ),
            },
        ]
        url = self._match("retailflux logo brand", catalog)
        # Should pick the clean candidate AND return its variant URL.
        assert url == ("https://backend.example/api/media/app/i/clean/?variant=transparent")

    def test_logo_slot_falls_back_when_no_transparent_candidate(self):
        catalog = [
            {
                "uuid": "opaque-uuid",
                "url": "https://backend.example/api/media/app/i/opaque/",
                "description": "retailflux logo brand",
                "is_logo": True,
                "has_transparent_bg": False,
                "has_baked_bg": True,
            },
        ]
        url = self._match("retailflux logo brand", catalog)
        assert url == "https://backend.example/api/media/app/i/opaque/"

    def test_non_logo_slot_ignores_transparency(self):
        # For hero/product slots the transparency flag is not a ranker —
        # keyword overlap still wins. Both candidates qualify; the one
        # with more matching tokens should win.
        catalog = [
            {
                "uuid": "hero-transparent",
                "url": "https://backend.example/api/media/app/i/hero1/",
                "description": "retail store shelf",
                "has_transparent_bg": True,
            },
            {
                "uuid": "hero-baked",
                "url": "https://backend.example/api/media/app/i/hero2/",
                "description": "retail store shelf checkout",
                "has_transparent_bg": False,
            },
        ]
        url = self._match("retail store shelf checkout", catalog)
        assert url.endswith("/hero2/")

    def test_logo_slot_without_any_candidate_returns_none(self):
        # No keyword overlap → resolver returns None even with transparent
        # candidates present.
        catalog = [
            {
                "uuid": "x",
                "url": "https://backend.example/api/media/app/i/x/",
                "description": "unrelated subject",
                "is_logo": True,
                "has_transparent_bg": True,
                "transparent_variant_url": (
                    "https://backend.example/api/media/app/i/x/?variant=transparent"
                ),
            },
        ]
        assert self._match("retailflux brand logo", catalog) is None

    def test_used_uuids_excludes_candidate(self):
        # Once a UUID is marked used, the resolver must not pick it again
        # even if it's the only transparent candidate. Falls back to
        # non-transparent when possible.
        catalog = [
            {
                "uuid": "clean",
                "url": "https://backend.example/api/media/app/i/clean/",
                "description": "retailflux logo brand",
                "is_logo": True,
                "has_transparent_bg": True,
                "transparent_variant_url": (
                    "https://backend.example/api/media/app/i/clean/?variant=transparent"
                ),
            },
            {
                "uuid": "opaque",
                "url": "https://backend.example/api/media/app/i/opaque/",
                "description": "retailflux logo brand",
                "is_logo": True,
                "has_transparent_bg": False,
            },
        ]
        used = {"clean"}
        url = self._match("retailflux logo brand", catalog, used=used)
        assert url == "https://backend.example/api/media/app/i/opaque/"


# =============================================================================
# NO-PROVIDER KEEP GATE + PICSUM KEYLESS FALLBACK
# =============================================================================


class TestNoProviderKeepGate:
    """When no keyword-search stock provider is configured, a working LLM
    image URL must be KEPT — not routed to resolution / a gray fallback div."""

    def test_needs_resolution_keeps_hallucinated_url_without_provider(self, monkeypatch):
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        monkeypatch.setattr(resolver_mod, "stock_provider_configured", lambda: False)
        assert _needs_resolution("https://images.unsplash.com/photo-1") is False

    def test_needs_resolution_flags_hallucinated_url_with_provider(self, monkeypatch):
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        monkeypatch.setattr(resolver_mod, "stock_provider_configured", lambda: True)
        assert _needs_resolution("https://images.unsplash.com/photo-1") is True

    def test_keep_off_forces_resolution_without_provider(self, monkeypatch):
        # Operator disabled LLM-suggested URLs → strip even a working-looking URL
        # and re-source it (keyless Openverse/Picsum), no keyed provider required.
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        monkeypatch.setattr(resolver_mod, "stock_provider_configured", lambda: False)
        monkeypatch.setattr(resolver_mod, "keep_llm_image_urls", lambda: False)
        assert _needs_resolution("https://images.unsplash.com/photo-1") is True

    def test_genuine_placeholders_still_resolve_without_provider(self, monkeypatch):
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        # Empty / __PLACEHOLDER__ / data: still need resolution (→ Picsum keyless).
        monkeypatch.setattr(resolver_mod, "stock_provider_configured", lambda: False)
        assert _needs_resolution("__PLACEHOLDER__") is True
        assert _needs_resolution("") is True
        assert _needs_resolution("data:image/png;base64,AAAA") is True

    async def test_resolve_keeps_working_url_without_provider(self, monkeypatch):
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        monkeypatch.setattr(resolver_mod, "stock_provider_configured", lambda: False)
        tsx = (
            "export default function Hero(){return (<section>"
            '<img src="https://images.unsplash.com/photo-keepme" alt="hero" />'
            "</section>);}"
        )
        sources, _total = await resolver_mod.resolve_placeholder_images({"Hero": tsx}, [])
        assert "https://images.unsplash.com/photo-keepme" in sources["Hero"]
        assert "data-exepad-fallback" not in sources["Hero"]

    async def test_kept_url_survives_while_genuine_placeholder_grayboxed(self, monkeypatch):
        """A kept LLM URL must survive AND a genuine unfilled __PLACEHOLDER__
        in the same component must still become a gray fallback div."""
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            codefocus_image_resolver as resolver_mod,
        )

        monkeypatch.setattr(resolver_mod, "stock_provider_configured", lambda: False)

        async def fake_unresolvable(image_prop, **kwargs):
            # Simulate a slot nothing can fill (returns the '#' sentinel).
            return {"src": "#", "asset": {}}

        monkeypatch.setattr(resolver_mod, "process_one_image_prop", fake_unresolvable)

        tsx = (
            "export default function P(){return (<div>"
            '<img src="https://images.unsplash.com/keepme" alt="hero" />'
            '<img src="__PLACEHOLDER__" alt="team portrait" />'
            "</div>);}"
        )
        sources, _ = await resolver_mod.resolve_placeholder_images({"P": tsx}, [])
        out = sources["P"]
        assert "https://images.unsplash.com/keepme" in out  # kept
        assert out.count("data-exepad-fallback") == 1  # only the placeholder
        assert "__PLACEHOLDER__" not in out


class TestPicsumKeylessFallback:
    """Keyless installs fill genuine placeholders with deterministic Picsum URLs."""

    async def test_picsum_builds_seeded_sized_url(self):
        from main_agent.agents.utils.image_generation_utils import get_image_from_picsum

        prop = {
            "asset": {
                "keywords": "mountain sunrise",
                "requested_width": 800,
                "requested_height": 600,
            }
        }
        out = await get_image_from_picsum(prop)
        assert out["src"].startswith("https://picsum.photos/seed/")
        assert out["src"].endswith("/800/600")
        assert out["asset"]["provider"] == "Picsum"
        assert out["asset"]["isProcessed"] is True

    async def test_picsum_is_deterministic_for_same_keywords(self):
        from main_agent.agents.utils.image_generation_utils import get_image_from_picsum

        a = await get_image_from_picsum({"asset": {"keywords": "blue ocean"}})
        b = await get_image_from_picsum({"asset": {"keywords": "blue ocean"}})
        assert a["src"] == b["src"]

    async def test_process_one_image_prop_routes_to_picsum_without_keys(self, monkeypatch):
        import main_agent.agents.utils.image_generation_utils as ig

        for k in ig.STOCK_PROVIDER_ENV_KEYS:
            monkeypatch.delenv(k, raising=False)

        # Keyless install tries Openverse first; stub it to "no result" (no
        # network) so the deterministic Picsum fallback fills the placeholder.
        async def openverse_empty(processed_prop, *a, **k):
            asset = processed_prop.setdefault("asset", {})
            asset["providerImgUrl"] = "#"
            processed_prop["src"] = "#"
            return processed_prop

        monkeypatch.setattr(ig, "get_image_from_openverse", openverse_empty)
        out = await ig.process_one_image_prop(
            {"asset": {"keywords": "city street", "importance": 8}}
        )
        assert out["src"].startswith("https://picsum.photos/seed/")
