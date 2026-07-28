"""Unit tests for stock-image providers + routing in image_generation_utils.

All providers here are FREE (Pexels / Pixabay / Unsplash keyed; Openverse and
Picsum keyless). Freepik was removed. Covers:
- ``stock_provider_configured()`` keyed-provider detection
- Lorem Picsum keyless fallback (``get_image_from_picsum`` / ``_picsum_seed``)
- Unsplash / Pixabay / Openverse providers (+ helpers) incl. mocked HTTP
  success paths and their by-id fetchers
- ``process_one_image_prop`` routing: keyless → Openverse then Picsum; keyed →
  each configured provider in turn (IMAGE_PROVIDER first), Openverse last resort

HTTP is never hit: the no-key paths return before any request, and the success
tests inject a fake ``aiohttp.ClientSession``.
"""

from __future__ import annotations

import os

import pytest

import main_agent.agents.utils.image_generation_utils as ig

pytestmark = pytest.mark.unit


@pytest.fixture(autouse=True)
def _clear_provider_env(monkeypatch):
    """Every test starts with no provider keys; opt back in per test."""
    for key in ("PEXELS_API_KEY", "PIXABAY_API_KEY", "UNSPLASH_API_KEY"):
        monkeypatch.delenv(key, raising=False)


def _prop(keywords="city street", importance=5, width=None, height=None):
    asset = {"keywords": keywords, "importance": importance}
    if width is not None:
        asset["requested_width"] = width
    if height is not None:
        asset["requested_height"] = height
    return {"asset": asset}


# =============================================================================
# stock_provider_configured()
# =============================================================================


class TestStockProviderConfigured:
    def test_false_when_no_keys(self):
        assert ig.stock_provider_configured() is False

    @pytest.mark.parametrize("key", ["PEXELS_API_KEY", "PIXABAY_API_KEY", "UNSPLASH_API_KEY"])
    def test_true_for_each_keyed_provider(self, monkeypatch, key):
        monkeypatch.setenv(key, "secret")
        assert ig.stock_provider_configured() is True

    def test_whitespace_only_key_is_not_configured(self, monkeypatch):
        monkeypatch.setenv("PEXELS_API_KEY", "   ")
        assert ig.stock_provider_configured() is False

    def test_keyless_providers_are_not_keyed(self):
        # Picsum AND Openverse are keyless and must NOT count toward the gate
        # (else they would defeat "keep the LLM URL when no keyword-search
        # keyed provider exists").
        joined = " ".join(ig.STOCK_PROVIDER_ENV_KEYS)
        assert "PICSUM" not in joined
        assert "OPENVERSE" not in joined


# =============================================================================
# keep_llm_image_urls() / should_strip_llm_image_urls() — operator toggle
# =============================================================================


class TestKeepLlmImageUrls:
    @pytest.fixture(autouse=True)
    def _clear_toggle_env(self, monkeypatch):
        monkeypatch.delenv("KEEP_LLM_IMAGE_URLS", raising=False)

    def test_default_is_keep(self):
        assert ig.keep_llm_image_urls() is True

    @pytest.mark.parametrize("truthy", ["true", "1", "yes", "on", "", "anything"])
    def test_truthy_and_unrecognized_values_keep(self, monkeypatch, truthy):
        monkeypatch.setenv("KEEP_LLM_IMAGE_URLS", truthy)
        assert ig.keep_llm_image_urls() is True

    @pytest.mark.parametrize("falsey", ["false", "0", "no", "off", "FALSE", " Off "])
    def test_falsey_values_disable(self, monkeypatch, falsey):
        monkeypatch.setenv("KEEP_LLM_IMAGE_URLS", falsey)
        assert ig.keep_llm_image_urls() is False


class TestShouldStripLlmImageUrls:
    @pytest.fixture(autouse=True)
    def _clear_toggle_env(self, monkeypatch):
        monkeypatch.delenv("KEEP_LLM_IMAGE_URLS", raising=False)

    def test_keep_on_no_keyed_provider_keeps(self):
        # Default (keep on) + no keyed provider → identical to the prior behavior.
        assert ig.should_strip_llm_image_urls() is False

    def test_keep_on_with_keyed_provider_strips(self, monkeypatch):
        monkeypatch.setenv("PEXELS_API_KEY", "secret")
        assert ig.should_strip_llm_image_urls() is True

    def test_keep_off_forces_strip_without_any_key(self, monkeypatch):
        monkeypatch.setenv("KEEP_LLM_IMAGE_URLS", "false")
        assert ig.should_strip_llm_image_urls() is True

    def test_keep_off_strips_with_keyed_provider_too(self, monkeypatch):
        monkeypatch.setenv("KEEP_LLM_IMAGE_URLS", "off")
        monkeypatch.setenv("UNSPLASH_API_KEY", "secret")
        assert ig.should_strip_llm_image_urls() is True


# =============================================================================
# Lorem Picsum
# =============================================================================


class TestPicsumSeed:
    @pytest.mark.parametrize(
        "raw,expected_ok",
        [
            ("mountain sunrise", "mountain-sunrise"),
            ("  Blue, Ocean!  ", "blue-ocean"),
            ("", "image"),
            ("!!!___!!!", "image"),
            ("café münchen", "caf-m-nchen"),
        ],
    )
    def test_seed_is_url_safe(self, raw, expected_ok):
        seed = ig._picsum_seed(raw)
        assert seed == expected_ok
        # URL-safe: only [a-z0-9-], no leading/trailing dash, <=40 chars.
        assert all(c.isalnum() or c == "-" for c in seed)
        assert not seed.startswith("-") and not seed.endswith("-")
        assert 1 <= len(seed) <= 40

    def test_seed_truncated_to_40(self):
        seed = ig._picsum_seed("a" * 100)
        assert len(seed) == 40


class TestGetImageFromPicsum:
    async def test_basic_seeded_sized_url(self):
        out = await ig.get_image_from_picsum(_prop("mountain", width=800, height=600))
        assert out["src"] == "https://picsum.photos/seed/mountain/800/600"
        assert out["asset"]["provider"] == "Picsum"
        assert out["asset"]["isProcessed"] is True
        assert out["asset"]["providerImgId"] == "mountain"

    async def test_defaults_when_dims_missing(self):
        out = await ig.get_image_from_picsum(_prop("forest"))
        assert out["src"] == "https://picsum.photos/seed/forest/800/600"

    async def test_dims_capped_at_1600(self):
        out = await ig.get_image_from_picsum(_prop("hero", width=5000, height=4000))
        assert out["src"].endswith("/1600/1600")

    async def test_zero_dims_fall_back_to_default(self):
        out = await ig.get_image_from_picsum(_prop("x", width=0, height=0))
        assert out["src"].endswith("/800/600")

    async def test_list_keywords_joined(self):
        out = await ig.get_image_from_picsum({"asset": {"keywords": ["blue", "sky"]}})
        assert "blue-sky" in out["src"]

    async def test_deterministic(self):
        a = await ig.get_image_from_picsum(_prop("blue ocean"))
        b = await ig.get_image_from_picsum(_prop("blue ocean"))
        assert a["src"] == b["src"]

    async def test_empty_keywords_use_image_seed(self):
        out = await ig.get_image_from_picsum({"asset": {"keywords": ""}})
        assert "/seed/image/" in out["src"]


# =============================================================================
# Unsplash helpers
# =============================================================================


class TestUnsplashHelpers:
    @pytest.mark.parametrize(
        "w,h,expected",
        [(1600, 900, "landscape"), (600, 800, "portrait"), (500, 500, "squarish")],
    )
    def test_orientation(self, w, h, expected):
        assert ig._unsplash_orientation(w, h) == expected

    def test_image_url_prefers_raw_with_sizing(self):
        url = ig._unsplash_image_url({"raw": "https://images.unsplash.com/photo-1"}, 800)
        assert url.startswith("https://images.unsplash.com/photo-1?")
        assert "w=800" in url and "q=80" in url and "fit=crop" in url

    def test_image_url_appends_with_amp_when_query_present(self):
        url = ig._unsplash_image_url({"raw": "https://images.unsplash.com/p?ixid=abc"}, 400)
        assert "?ixid=abc&w=400" in url

    def test_image_url_caps_width_at_1600(self):
        url = ig._unsplash_image_url({"raw": "https://images.unsplash.com/p"}, 9999)
        assert "w=1600" in url

    def test_image_url_falls_back_to_regular(self):
        url = ig._unsplash_image_url({"regular": "https://images.unsplash.com/reg"}, 800)
        assert url == "https://images.unsplash.com/reg"

    def test_image_url_empty_when_no_urls(self):
        assert ig._unsplash_image_url({}, 800) == ""


class TestGetImageFromUnsplashNoKey:
    async def test_no_key_returns_placeholder(self):
        out = await ig.get_image_from_unsplash(_prop("dog"))
        asset = out["asset"]
        # Mirrors the Pexels/Pixabay no-key contract: providerImgUrl '#',
        # provider set, isProcessed False (the 'reason' is logged, not stored
        # as providerImgId, which stays the default 'placeholder').
        assert asset["providerImgUrl"] == "#"
        assert asset["provider"] == "Unsplash"
        assert asset["isProcessed"] is False
        assert out.get("src") != asset["providerImgUrl"]


# --- Mocked aiohttp for the Unsplash success path ----------------------------


class _FakeResp:
    def __init__(self, status=200, json_data=None, text_data=""):
        self.status = status
        self._json = json_data or {}
        self._text = text_data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def json(self):
        return self._json

    async def text(self):
        return self._text

    async def read(self):
        return b""


class _FakeSession:
    """Async-context-manager session returning queued responses in order."""

    def __init__(self, responses):
        self._responses = list(responses)
        self.requests: list[dict] = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def get(self, url, headers=None, params=None, timeout=None):
        self.requests.append({"url": url, "headers": headers, "params": params})
        return self._responses.pop(0)


class TestGetImageFromUnsplashSuccess:
    async def test_success_parses_url_attribution_and_pings_download(self, monkeypatch):
        monkeypatch.setenv("UNSPLASH_API_KEY", "client-id-xyz")
        search = _FakeResp(
            status=200,
            json_data={
                "results": [
                    {
                        "id": "abc123",
                        "urls": {"raw": "https://images.unsplash.com/photo-99"},
                        "links": {
                            "html": "https://unsplash.com/photos/abc123",
                            "download_location": "https://api.unsplash.com/photos/abc123/download",
                        },
                        "user": {
                            "name": "Jane Doe",
                            "links": {"html": "https://unsplash.com/@jane"},
                        },
                    }
                ]
            },
        )
        download_ping = _FakeResp(status=200)
        fake = _FakeSession([search, download_ping])
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)

        out = await ig.get_image_from_unsplash(_prop("happy dog", width=800, height=600))
        asset = out["asset"]

        assert out["src"].startswith("https://images.unsplash.com/photo-99?")
        assert "w=800" in out["src"]
        assert asset["isProcessed"] is True
        assert asset["provider"] == "Unsplash"
        assert asset["providerImgId"] == "abc123"
        assert asset["attribution"]["photographer"] == "Jane Doe"
        assert asset["attribution"]["source"] == "Unsplash"
        # Two requests fired: the search + the mandatory download ping.
        assert len(fake.requests) == 2
        assert fake.requests[1]["url"].endswith("/download")
        # Search used the landscape orientation filter.
        assert fake.requests[0]["params"]["orientation"] == "landscape"

    async def test_no_results_sets_placeholder(self, monkeypatch):
        monkeypatch.setenv("UNSPLASH_API_KEY", "k")
        # _build_query_variants("abstract background") -> a couple of variants;
        # supply enough empty responses to exhaust them.
        empties = [_FakeResp(status=200, json_data={"results": []}) for _ in range(5)]
        fake = _FakeSession(empties)
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)
        out = await ig.get_image_from_unsplash(_prop("abstract background"))
        assert out["asset"]["providerImgId"] == "no_results"

    async def test_rate_limited_sets_placeholder(self, monkeypatch):
        monkeypatch.setenv("UNSPLASH_API_KEY", "k")
        fake = _FakeSession([_FakeResp(status=429)])
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)
        out = await ig.get_image_from_unsplash(_prop("dog"))
        assert out["asset"]["providerImgId"] == "rate_limited"

    async def test_http_error_sets_error_placeholder(self, monkeypatch):
        monkeypatch.setenv("UNSPLASH_API_KEY", "k")
        fake = _FakeSession([_FakeResp(status=500, text_data="boom")])
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)
        out = await ig.get_image_from_unsplash(_prop("dog"))
        assert out["asset"]["providerImgId"] == "error_500"

    async def test_exception_sets_placeholder(self, monkeypatch):
        monkeypatch.setenv("UNSPLASH_API_KEY", "k")

        class _BoomSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            def get(self, *a, **k):
                raise RuntimeError("network down")

        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: _BoomSession())
        out = await ig.get_image_from_unsplash(_prop("dog"))
        assert out["asset"]["providerImgId"] == "exception"

    async def test_excluded_urls_are_skipped(self, monkeypatch):
        monkeypatch.setenv("UNSPLASH_API_KEY", "k")
        results = {
            "results": [
                {"id": "dup", "urls": {"raw": "https://images.unsplash.com/dup"}, "links": {}},
                {"id": "novel", "urls": {"raw": "https://images.unsplash.com/novel"}, "links": {}},
            ]
        }
        fake = _FakeSession([_FakeResp(status=200, json_data=results)])
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)
        # Exclude the sized form of the first candidate.
        excluded = {ig._unsplash_image_url({"raw": "https://images.unsplash.com/dup"}, 1920)}
        out = await ig.get_image_from_unsplash(_prop("dog"), exclude_urls=excluded)
        assert "/novel" in out["src"]


# =============================================================================
# Pixabay (free provider)
# =============================================================================


class TestGetImageFromPixabay:
    async def test_no_key_returns_placeholder(self):
        out = await ig.get_image_from_pixabay(_prop("dog"))
        asset = out["asset"]
        assert asset["providerImgUrl"] == "#"
        assert asset["provider"] == "Pixabay"
        assert asset["isProcessed"] is False

    async def test_success_parses_hit(self, monkeypatch):
        monkeypatch.setenv("PIXABAY_API_KEY", "pk")
        search = _FakeResp(
            status=200,
            json_data={
                "hits": [
                    {
                        "id": 42,
                        "user": "someuser",
                        "webformatURL": "https://pixabay.com/get/g42_640.jpg",
                        "largeImageURL": "https://pixabay.com/get/g42_1280.jpg",
                    }
                ]
            },
        )
        fake = _FakeSession([search])
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)

        out = await ig.get_image_from_pixabay(_prop("happy dog", width=800, height=600))
        asset = out["asset"]
        # 800px budget < 1000 → webformatURL preferred.
        assert out["src"] == "https://pixabay.com/get/g42_640.jpg"
        assert asset["provider"] == "Pixabay"
        assert asset["providerImgId"] == "42"
        assert asset["isProcessed"] is True
        # No Authorization header; key rides in params.
        assert fake.requests[0]["params"]["key"] == "pk"
        assert fake.requests[0]["params"]["orientation"] == "horizontal"

    async def test_large_budget_prefers_large_url(self, monkeypatch):
        monkeypatch.setenv("PIXABAY_API_KEY", "pk")
        search = _FakeResp(
            status=200,
            json_data={
                "hits": [
                    {
                        "id": 7,
                        "webformatURL": "https://pixabay.com/get/g7_640.jpg",
                        "largeImageURL": "https://pixabay.com/get/g7_1280.jpg",
                    }
                ]
            },
        )
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: _FakeSession([search]))
        out = await ig.get_image_from_pixabay(_prop("hero", width=1600, height=900))
        assert out["src"] == "https://pixabay.com/get/g7_1280.jpg"

    async def test_no_results_sets_placeholder(self, monkeypatch):
        monkeypatch.setenv("PIXABAY_API_KEY", "pk")
        empties = [_FakeResp(status=200, json_data={"hits": []}) for _ in range(6)]
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: _FakeSession(empties))
        out = await ig.get_image_from_pixabay(_prop("abstract background"))
        assert out["asset"]["providerImgId"] == "no_results"

    async def test_rate_limited_sets_placeholder(self, monkeypatch):
        monkeypatch.setenv("PIXABAY_API_KEY", "pk")
        monkeypatch.setattr(
            ig.aiohttp, "ClientSession", lambda: _FakeSession([_FakeResp(status=429)])
        )
        out = await ig.get_image_from_pixabay(_prop("dog"))
        assert out["asset"]["providerImgId"] == "rate_limited"

    async def test_by_id_success(self, monkeypatch):
        monkeypatch.setenv("PIXABAY_API_KEY", "pk")
        resp = _FakeResp(
            status=200,
            json_data={"hits": [{"id": 99, "webformatURL": "https://pixabay.com/get/g99_640.jpg"}]},
        )
        fake = _FakeSession([resp])
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)
        out = await ig.get_pixabay_photo_by_id(_prop("dog"), "99")
        assert out["src"] == "https://pixabay.com/get/g99_640.jpg"
        assert out["asset"]["providerImgId"] == "99"
        assert fake.requests[0]["params"]["id"] == "99"

    async def test_by_id_not_found(self, monkeypatch):
        monkeypatch.setenv("PIXABAY_API_KEY", "pk")
        fake = _FakeSession([_FakeResp(status=200, json_data={"hits": []})])
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)
        out = await ig.get_pixabay_photo_by_id(_prop("dog"), "12345")
        assert out["asset"]["providerImgId"] == "12345"
        assert out["asset"]["providerImgUrl"] == "#"


# =============================================================================
# Openverse (keyless Creative-Commons fallback)
# =============================================================================


class TestGetImageFromOpenverse:
    async def test_success_uses_thumbnail_and_attribution(self, monkeypatch):
        search = _FakeResp(
            status=200,
            json_data={
                "results": [
                    {
                        "id": "ov-1",
                        "thumbnail": "https://api.openverse.org/v1/images/ov-1/thumb/",
                        "url": "https://live.staticflickr.com/x/full.jpg",
                        "creator": "Ada L",
                        "creator_url": "https://example.org/ada",
                        "license": "by",
                        "license_url": "https://creativecommons.org/licenses/by/4.0/",
                        "foreign_landing_url": "https://flickr.com/photos/ada/1",
                    }
                ]
            },
        )
        fake = _FakeSession([search])
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: fake)

        out = await ig.get_image_from_openverse(_prop("mountain lake", width=800, height=600))
        asset = out["asset"]
        # Embeds the api.openverse.org thumbnail, NOT the arbitrary upstream host.
        assert out["src"] == "https://api.openverse.org/v1/images/ov-1/thumb/"
        assert asset["provider"] == "Openverse"
        assert asset["providerImgId"] == "ov-1"
        assert asset["attribution"]["photographer"] == "Ada L"
        assert asset["attribution"]["license"] == "by"
        # Commercial-license filter + wide aspect ratio applied.
        assert fake.requests[0]["params"]["license_type"] == "commercial"
        assert fake.requests[0]["params"]["aspect_ratio"] == "wide"

    async def test_no_results_sets_placeholder(self, monkeypatch):
        empties = [_FakeResp(status=200, json_data={"results": []}) for _ in range(6)]
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: _FakeSession(empties))
        out = await ig.get_image_from_openverse(_prop("abstract background"))
        assert out["asset"]["providerImgId"] == "no_results"
        assert out["asset"]["provider"] == "Openverse"

    async def test_rate_limited_sets_placeholder(self, monkeypatch):
        monkeypatch.setattr(
            ig.aiohttp, "ClientSession", lambda: _FakeSession([_FakeResp(status=429)])
        )
        out = await ig.get_image_from_openverse(_prop("dog"))
        assert out["asset"]["providerImgId"] == "rate_limited"

    async def test_by_id_success(self, monkeypatch):
        detail = _FakeResp(
            status=200,
            json_data={
                "id": "ov-9",
                "thumbnail": "https://api.openverse.org/v1/images/ov-9/thumb/",
                "creator": "Bob",
                "license": "cc0",
            },
        )
        monkeypatch.setattr(ig.aiohttp, "ClientSession", lambda: _FakeSession([detail]))
        out = await ig.get_openverse_image_by_id(_prop("dog"), "ov-9")
        assert out["src"] == "https://api.openverse.org/v1/images/ov-9/thumb/"
        assert out["asset"]["providerImgId"] == "ov-9"


# =============================================================================
# process_one_image_prop routing
# =============================================================================


def _fake_provider(name, *, succeed, url=None):
    """Build a fake provider coroutine that records calls and sets asset state."""
    calls = []

    async def fake(processed_prop, *args, **kwargs):
        calls.append(processed_prop)
        asset = processed_prop.setdefault("asset", {})
        if succeed:
            asset["provider"] = name
            asset["providerImgId"] = f"{name}-1"
            asset["isProcessed"] = True
            processed_prop["src"] = url or f"https://{name}.example/img.jpg"
        else:
            asset["provider"] = name
            asset["providerImgId"] = "no_api_key"
            asset["isProcessed"] = False
            asset["providerImgUrl"] = "#"
        return processed_prop

    fake.calls = calls  # type: ignore[attr-defined]
    return fake


class TestProcessOneImagePropRouting:
    async def test_no_keys_tries_openverse_then_picsum(self, monkeypatch):
        # Keyless install: Openverse (keyword-searchable, no key) is tried FIRST;
        # Picsum only fills in if Openverse comes up empty.
        openverse = _fake_provider(
            "openverse", succeed=True, url="https://api.openverse.org/v1/images/x/thumb/"
        )
        picsum = _fake_provider("picsum", succeed=True, url="https://picsum.photos/seed/x/800/600")
        pexels = _fake_provider("pexels", succeed=True)
        monkeypatch.setattr(ig, "get_image_from_openverse", openverse)
        monkeypatch.setattr(ig, "get_image_from_picsum", picsum)
        monkeypatch.setattr(ig, "get_image_from_pexels", pexels)

        out = await ig.process_one_image_prop(_prop("dog", importance=5))
        assert out["src"].startswith("https://api.openverse.org/")
        assert len(openverse.calls) == 1  # type: ignore[attr-defined]
        assert len(picsum.calls) == 0  # type: ignore[attr-defined]
        assert len(pexels.calls) == 0  # type: ignore[attr-defined]

    async def test_no_keys_openverse_empty_falls_back_to_picsum(self, monkeypatch):
        openverse = _fake_provider("openverse", succeed=False)  # no usable src ('#')
        picsum = _fake_provider("picsum", succeed=True, url="https://picsum.photos/seed/x/800/600")
        monkeypatch.setattr(ig, "get_image_from_openverse", openverse)
        monkeypatch.setattr(ig, "get_image_from_picsum", picsum)

        out = await ig.process_one_image_prop(_prop("dog", importance=5))
        assert out["src"].startswith("https://picsum.photos/")
        assert len(openverse.calls) == 1  # type: ignore[attr-defined]
        assert len(picsum.calls) == 1  # type: ignore[attr-defined]

    async def test_importance_does_not_change_provider(self, monkeypatch):
        # Provider selection no longer keys off importance — high-importance
        # still routes to the configured keyed provider (Pexels), not a premium.
        monkeypatch.setenv("PEXELS_API_KEY", "p")
        pexels = _fake_provider("pexels", succeed=True, url="https://images.pexels.com/hero")
        monkeypatch.setattr(ig, "get_image_from_pexels", pexels)

        out = await ig.process_one_image_prop(_prop("hero", importance=9))
        assert out["src"] == "https://images.pexels.com/hero"
        assert len(pexels.calls) == 1  # type: ignore[attr-defined]

    async def test_only_unsplash_routes_to_unsplash(self, monkeypatch):
        monkeypatch.setenv("UNSPLASH_API_KEY", "k")
        unsplash = _fake_provider("unsplash", succeed=True, url="https://images.unsplash.com/u1")
        picsum = _fake_provider("picsum", succeed=True)
        monkeypatch.setattr(ig, "get_image_from_unsplash", unsplash)
        monkeypatch.setattr(ig, "get_image_from_picsum", picsum)

        out = await ig.process_one_image_prop(_prop("dog", importance=3))
        assert out["src"] == "https://images.unsplash.com/u1"
        assert len(unsplash.calls) == 1  # type: ignore[attr-defined]
        assert len(picsum.calls) == 0  # type: ignore[attr-defined]  # not short-circuited

    async def test_pexels_preferred_over_others_when_all_set(self, monkeypatch):
        monkeypatch.setenv("PEXELS_API_KEY", "p")
        monkeypatch.setenv("PIXABAY_API_KEY", "pb")
        monkeypatch.setenv("UNSPLASH_API_KEY", "u")
        pexels = _fake_provider("pexels", succeed=True, url="https://images.pexels.com/p1")
        pixabay = _fake_provider("pixabay", succeed=True)
        unsplash = _fake_provider("unsplash", succeed=True)
        monkeypatch.setattr(ig, "get_image_from_pexels", pexels)
        monkeypatch.setattr(ig, "get_image_from_pixabay", pixabay)
        monkeypatch.setattr(ig, "get_image_from_unsplash", unsplash)

        out = await ig.process_one_image_prop(_prop("dog", importance=3))
        assert out["src"] == "https://images.pexels.com/p1"
        assert len(pixabay.calls) == 0  # type: ignore[attr-defined]  # not needed
        assert len(unsplash.calls) == 0  # type: ignore[attr-defined]

    async def test_image_provider_env_reorders_primary(self, monkeypatch):
        # IMAGE_PROVIDER=pixabay makes Pixabay the first attempt even when
        # Pexels is also configured.
        monkeypatch.setenv("PEXELS_API_KEY", "p")
        monkeypatch.setenv("PIXABAY_API_KEY", "pb")
        monkeypatch.setattr(ig, "IMAGE_PROVIDER", "pixabay")
        pexels = _fake_provider("pexels", succeed=True, url="https://images.pexels.com/p1")
        pixabay = _fake_provider("pixabay", succeed=True, url="https://pixabay.com/get/pb1_640.jpg")
        monkeypatch.setattr(ig, "get_image_from_pexels", pexels)
        monkeypatch.setattr(ig, "get_image_from_pixabay", pixabay)

        out = await ig.process_one_image_prop(_prop("dog"))
        assert out["src"] == "https://pixabay.com/get/pb1_640.jpg"
        assert len(pixabay.calls) == 1  # type: ignore[attr-defined]
        assert len(pexels.calls) == 0  # type: ignore[attr-defined]

    async def test_pexels_no_results_falls_through_to_pixabay(self, monkeypatch):
        # Pexels keyed but returns nothing usable → Pixabay fills the slot.
        monkeypatch.setenv("PEXELS_API_KEY", "p")
        monkeypatch.setenv("PIXABAY_API_KEY", "pb")
        pexels = _fake_provider("pexels", succeed=False)  # isProcessed False, no src
        pixabay = _fake_provider("pixabay", succeed=True, url="https://pixabay.com/get/pbX_640.jpg")
        monkeypatch.setattr(ig, "get_image_from_pexels", pexels)
        monkeypatch.setattr(ig, "get_image_from_pixabay", pixabay)

        out = await ig.process_one_image_prop(_prop("dog", importance=3))
        assert out["src"] == "https://pixabay.com/get/pbX_640.jpg"
        assert len(pixabay.calls) == 1  # type: ignore[attr-defined]

    async def test_all_keyed_empty_falls_back_to_openverse(self, monkeypatch):
        # Every keyed provider comes up empty → keyless Openverse last resort.
        monkeypatch.setenv("PEXELS_API_KEY", "p")
        monkeypatch.setenv("PIXABAY_API_KEY", "pb")
        pexels = _fake_provider("pexels", succeed=False)
        pixabay = _fake_provider("pixabay", succeed=False)
        openverse = _fake_provider(
            "openverse", succeed=True, url="https://api.openverse.org/v1/images/y/thumb/"
        )
        monkeypatch.setattr(ig, "get_image_from_pexels", pexels)
        monkeypatch.setattr(ig, "get_image_from_pixabay", pixabay)
        monkeypatch.setattr(ig, "get_image_from_openverse", openverse)

        out = await ig.process_one_image_prop(_prop("dog"))
        assert out["src"].startswith("https://api.openverse.org/")
        assert len(pexels.calls) == 1  # type: ignore[attr-defined]
        assert len(pixabay.calls) == 1  # type: ignore[attr-defined]
        assert len(openverse.calls) == 1  # type: ignore[attr-defined]

    async def test_successful_provider_not_clobbered_by_fallback(self, monkeypatch):
        # A provider that returns a real src ends the chain — no later provider
        # (or the Openverse last resort) overwrites it.
        monkeypatch.setenv("PEXELS_API_KEY", "p")
        monkeypatch.setenv("PIXABAY_API_KEY", "pb")
        pexels = _fake_provider("pexels", succeed=True, url="https://images.pexels.com/keep")
        pixabay = _fake_provider("pixabay", succeed=True)
        openverse = _fake_provider("openverse", succeed=True)
        monkeypatch.setattr(ig, "get_image_from_pexels", pexels)
        monkeypatch.setattr(ig, "get_image_from_pixabay", pixabay)
        monkeypatch.setattr(ig, "get_image_from_openverse", openverse)

        out = await ig.process_one_image_prop(_prop("barber", importance=8))
        assert out["src"] == "https://images.pexels.com/keep"
        assert len(pixabay.calls) == 0  # type: ignore[attr-defined]
        assert len(openverse.calls) == 0  # type: ignore[attr-defined]


# =============================================================================
# config.apply_runtime_settings — Settings-UI stock keys → os.environ
# =============================================================================


class TestApplyRuntimeSettingsStockKeys:
    @pytest.fixture(autouse=True)
    def _restore_env(self):
        keys = ["PEXELS_API_KEY", "UNSPLASH_API_KEY", "PIXABAY_API_KEY", "IMAGE_PROVIDER"]
        saved = {k: os.environ.get(k) for k in keys}
        for k in keys:
            os.environ.pop(k, None)
        yield
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    # ── Legacy path: no explicit image_provider → set whatever keys arrive ──────
    def test_maps_all_three_provider_keys(self):
        import config

        config.apply_runtime_settings(
            {"pexels_api_key": "px", "unsplash_api_key": "un", "pixabay_api_key": "pb"}
        )
        assert os.environ["PEXELS_API_KEY"] == "px"
        assert os.environ["UNSPLASH_API_KEY"] == "un"
        assert os.environ["PIXABAY_API_KEY"] == "pb"

    def test_empty_value_does_not_clobber(self):
        import config

        os.environ["PEXELS_API_KEY"] = "keep"
        config.apply_runtime_settings({"pexels_api_key": "   "})
        assert os.environ["PEXELS_API_KEY"] == "keep"

    def test_strips_whitespace(self):
        import config

        config.apply_runtime_settings({"unsplash_api_key": "  un  "})
        assert os.environ["UNSPLASH_API_KEY"] == "un"

    # ── Single-provider model: image_provider is authoritative ──────────────────
    def test_provider_pick_activates_only_selected_and_clears_others(self):
        import config

        # Stale keys from a prior provider must not survive the switch.
        os.environ["UNSPLASH_API_KEY"] = "stale-unsplash"
        os.environ["PIXABAY_API_KEY"] = "stale-pixabay"
        config.apply_runtime_settings({"image_provider": "pexels", "pexels_api_key": "px-live"})
        assert os.environ["IMAGE_PROVIDER"] == "pexels"
        assert os.environ["PEXELS_API_KEY"] == "px-live"
        assert "UNSPLASH_API_KEY" not in os.environ
        assert "PIXABAY_API_KEY" not in os.environ

    def test_openverse_pick_clears_all_keyed_providers(self):
        import config

        os.environ["PEXELS_API_KEY"] = "stale-pexels"
        config.apply_runtime_settings({"image_provider": "openverse"})
        assert os.environ["IMAGE_PROVIDER"] == "openverse"
        assert "PEXELS_API_KEY" not in os.environ
        assert "UNSPLASH_API_KEY" not in os.environ
        assert "PIXABAY_API_KEY" not in os.environ

    def test_selected_provider_without_new_key_keeps_existing_env(self):
        import config

        # Operator re-selected Unsplash but didn't re-enter the key: its seed env
        # value survives, while the de-selected provider is cleared.
        os.environ["UNSPLASH_API_KEY"] = "seed-unsplash"
        os.environ["PEXELS_API_KEY"] = "stale-pexels"
        config.apply_runtime_settings({"image_provider": "unsplash"})
        assert os.environ["IMAGE_PROVIDER"] == "unsplash"
        assert os.environ["UNSPLASH_API_KEY"] == "seed-unsplash"
        assert "PEXELS_API_KEY" not in os.environ
