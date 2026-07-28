"""Tests for the Pexels recovery hook in ``_materialize_one_img``.

The Claude-Design importer leaves Unsplash URLs in the staged HTML; many
go 404 by the time the materializer runs. The recovery hook calls Pexels
Search API for an alt-text-driven replacement, retries the download, and
records ``pexels_recoveries`` on the manifest.

These tests mock httpx so no network is hit. They assert:
- 200 path skips Pexels entirely.
- 404 path fires Pexels, downloads the replacement, increments the counter.
- 5xx (transient) does NOT trigger Pexels — only permanent statuses do.
- Recovery cap is honored — past the cap we don't query Pexels.
- Bad alt text → empty query → no Pexels call.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest
from bs4 import BeautifulSoup

from main_agent.agents.orchestrator.importers import design_importer as di

pytestmark = [pytest.mark.unit]


def _make_img(src: str, alt: str = "Brown eggs · 3/4 ratio", data_alt: str | None = None) -> object:
    """Build a BeautifulSoup img tag matching the materializer's input shape."""
    html = f'<img src="{src}" alt="{alt}"' + (f' data-alt="{data_alt}"' if data_alt else "") + " />"
    return BeautifulSoup(html, "html.parser").find("img")


def _make_manifest() -> dict:
    return {
        "assets": [],
        "failures": [],
        "processed_artifacts": [],
        "pexels_recoveries": 0,
    }


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestIsDeadSourceError:
    def test_404_is_dead(self):
        assert di._is_dead_source_error("status 404")

    def test_410_is_dead(self):
        assert di._is_dead_source_error("status 410")

    def test_5xx_is_not_dead(self):
        assert not di._is_dead_source_error("status 500")
        assert not di._is_dead_source_error("status 503")

    def test_empty_message(self):
        assert not di._is_dead_source_error("")


class TestPexelsQueryFromImg:
    def test_strips_centered_dot_qualifiers(self):
        img = _make_img("x", alt="Brown eggs · 3/4 ratio")
        assert di._pexels_query_from_img(img) == "Brown eggs"

    def test_strips_em_dash_qualifiers(self):
        img = _make_img("x", alt="Pasture chicken — golden hour, hero")
        assert di._pexels_query_from_img(img) == "Pasture chicken"

    def test_drops_shape_keywords(self):
        img = _make_img("x", alt="Egg carton flat lay")
        # ``flat lay`` is a Pexels-poisoning qualifier; drop it.
        out = di._pexels_query_from_img(img)
        assert "flat lay" not in out.lower()
        assert "Egg carton" in out

    def test_prefers_data_alt_over_alt(self):
        img = _make_img("x", alt="generic", data_alt="Sage chicken")
        assert di._pexels_query_from_img(img) == "Sage chicken"

    def test_empty_when_no_alt(self):
        img = BeautifulSoup('<img src="x"/>', "html.parser").find("img")
        assert di._pexels_query_from_img(img) == ""


# ---------------------------------------------------------------------------
# Full _materialize_one_img path with mocked downloads
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestMaterializeOneImgWithPexelsFallback:
    @pytest.fixture
    def fake_uploader(self, monkeypatch):
        """Stub the R2/asset uploader so tests don't touch network."""
        upload = AsyncMock(return_value=None)
        monkeypatch.setattr(di, "_upload_design_import_asset", upload)
        return upload

    async def test_200_path_skips_pexels(self, fake_uploader, monkeypatch):
        """A successful download must not call Pexels at all."""
        download = AsyncMock(return_value=(b"PNGDATA", "image/png"))
        monkeypatch.setattr(di, "_download_external_image", download)
        recover = AsyncMock(return_value=None)
        monkeypatch.setattr(di, "_pexels_recover_url", recover)

        manifest = _make_manifest()
        img = _make_img("https://images.unsplash.com/photo-1.jpg")

        ok = await di._materialize_one_img(
            ctx=None,
            app_uuid="appA",
            img=img,
            artifact_keys=[],
            asset_registry={},
            manifest=manifest,
        )

        assert ok is True
        recover.assert_not_called()
        assert manifest["pexels_recoveries"] == 0
        assert manifest["failures"] == []

    async def test_404_triggers_pexels_recovery(self, fake_uploader, monkeypatch):
        # First call: 404; second call (after recovery): success.
        download = AsyncMock(side_effect=[(None, "status 404"), (b"PEXELSDATA", "image/jpeg")])
        monkeypatch.setattr(di, "_download_external_image", download)
        recover = AsyncMock(return_value="https://images.pexels.com/photos/42/pexels.jpg")
        monkeypatch.setattr(di, "_pexels_recover_url", recover)

        manifest = _make_manifest()
        img = _make_img(
            "https://images.unsplash.com/photo-stale.jpg",
            alt="Pasture chicken · golden hour",
            data_alt="Pasture chicken",
        )

        ok = await di._materialize_one_img(
            ctx=None,
            app_uuid="appA",
            img=img,
            artifact_keys=[],
            asset_registry={},
            manifest=manifest,
        )

        assert ok is True
        recover.assert_called_once()
        assert manifest["pexels_recoveries"] == 1
        # No failure recorded on the recovered path.
        assert manifest["failures"] == []
        # Asset entry source_url points at Pexels, not the dead Unsplash URL.
        assert any("pexels.com" in entry["source_url"] for entry in manifest["assets"])

    async def test_5xx_does_not_trigger_pexels(self, fake_uploader, monkeypatch):
        """Transient errors must NOT consume the Pexels recovery budget."""
        download = AsyncMock(return_value=(None, "status 503"))
        monkeypatch.setattr(di, "_download_external_image", download)
        recover = AsyncMock(return_value=None)
        monkeypatch.setattr(di, "_pexels_recover_url", recover)

        manifest = _make_manifest()
        img = _make_img("https://images.unsplash.com/photo-1.jpg")

        ok = await di._materialize_one_img(
            ctx=None,
            app_uuid="appA",
            img=img,
            artifact_keys=[],
            asset_registry={},
            manifest=manifest,
        )

        assert ok is False
        recover.assert_not_called()
        assert manifest["pexels_recoveries"] == 0
        assert len(manifest["failures"]) == 1
        assert manifest["failures"][0]["error"] == "status 503"

    async def test_pexels_returns_none_falls_through_to_failure(self, fake_uploader, monkeypatch):
        """If Pexels has no match, the original failure is recorded."""
        download = AsyncMock(return_value=(None, "status 404"))
        monkeypatch.setattr(di, "_download_external_image", download)
        recover = AsyncMock(return_value=None)
        monkeypatch.setattr(di, "_pexels_recover_url", recover)

        manifest = _make_manifest()
        img = _make_img("https://images.unsplash.com/photo-stale.jpg", alt="hen yard")

        ok = await di._materialize_one_img(
            ctx=None,
            app_uuid="appA",
            img=img,
            artifact_keys=[],
            asset_registry={},
            manifest=manifest,
        )

        assert ok is False
        recover.assert_called_once()
        # Counter NOT incremented because no successful recovery.
        assert manifest["pexels_recoveries"] == 0
        assert len(manifest["failures"]) == 1
        assert manifest["failures"][0]["error"] == "status 404"

    async def test_recovery_cap_enforced(self, fake_uploader, monkeypatch):
        """Past the per-workflow cap, no Pexels query is made."""
        download = AsyncMock(return_value=(None, "status 404"))
        monkeypatch.setattr(di, "_download_external_image", download)
        recover = AsyncMock(return_value="https://images.pexels.com/photo.jpg")
        monkeypatch.setattr(di, "_pexels_recover_url", recover)

        # Pre-load the counter at the cap.
        manifest = _make_manifest()
        manifest["pexels_recoveries"] = di._PEXELS_RECOVERY_CAP_PER_WORKFLOW

        img = _make_img("https://images.unsplash.com/dead.jpg", alt="brown chicken")

        ok = await di._materialize_one_img(
            ctx=None,
            app_uuid="appA",
            img=img,
            artifact_keys=[],
            asset_registry={},
            manifest=manifest,
        )

        assert ok is False
        recover.assert_not_called()
        assert manifest["pexels_recoveries"] == di._PEXELS_RECOVERY_CAP_PER_WORKFLOW
        assert len(manifest["failures"]) == 1

    async def test_pexels_replacement_also_404_records_original_failure(
        self, fake_uploader, monkeypatch
    ):
        """If the Pexels URL itself can't be downloaded, fall through to failure."""
        download = AsyncMock(side_effect=[(None, "status 404"), (None, "status 404")])
        monkeypatch.setattr(di, "_download_external_image", download)
        recover = AsyncMock(return_value="https://images.pexels.com/photo.jpg")
        monkeypatch.setattr(di, "_pexels_recover_url", recover)

        manifest = _make_manifest()
        img = _make_img("https://images.unsplash.com/dead.jpg", alt="rooster portrait")

        ok = await di._materialize_one_img(
            ctx=None,
            app_uuid="appA",
            img=img,
            artifact_keys=[],
            asset_registry={},
            manifest=manifest,
        )

        assert ok is False
        recover.assert_called_once()
        # No counter increment because the recovered URL also failed.
        assert manifest["pexels_recoveries"] == 0
        # The failure record carries the ORIGINAL (Unsplash) URL, not the
        # Pexels one — debugging is easier when the manifest points at the
        # source-of-truth that broke first.
        assert manifest["failures"][0]["src"].startswith("https://images.unsplash.com/")
