"""Tests for the image resolver's ``data-asset-relpath`` short-circuit.

When an ``<ExepadImage>`` tag carries ``data-asset-relpath="imports/..."``,
the resolver skips stock-image fetch and rewrites the tag in place to
``src="__ASSET_IMG:assets/<relpath>__"`` — a deploy-time placeholder the
backend rewrites to the final ``/a/{public_id}/repo/{optimized_path}`` URL
after WebP optimization. See
``exepad-backend/core/services/deploy.py::rewrite_image_placeholders_in_components``.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver import (
    _needs_resolution,
    _parse_exepad_image_props,
    _repo_asset_url,
    _resolve_exepad_images,
    _resolve_repo_asset_tag,
)

pytestmark = [pytest.mark.unit]


class TestNeedsResolutionAssetImg:
    """Pin the explicit ``__ASSET_IMG:`` short-circuit in `_needs_resolution`.

    Code review of Fix 1.4 (2026-05-16) caught that the resolver was
    relying on `_is_hallucinated_url` returning False via exception
    handling — accidental correctness. The explicit prefix check makes
    the contract documented and resistant to future refactors of the
    hallucinated-URL detector.
    """

    def test_asset_img_placeholder_is_already_resolved(self):
        assert _needs_resolution("__ASSET_IMG:assets/imports/abc.png__") is False
        assert _needs_resolution("__ASSET_IMG:assets/images/pexels-123.jpg__") is False

    def test_other_paths_unchanged(self):
        # Sanity: the explicit `__ASSET_IMG:` check doesn't disturb
        # existing behavior for the other empty/sentinel/data branches.
        assert _needs_resolution("") is True
        assert _needs_resolution(None) is True  # type: ignore[arg-type]
        assert _needs_resolution("__PLACEHOLDER__") is True
        assert _needs_resolution("data:image/png;base64,abc") is True
        # Already-resolved set short-circuits without invoking the
        # hallucinated-URL detector.
        assert (
            _needs_resolution(
                "https://images.pexels.com/photo/12345.jpg",
                resolved_urls={"https://images.pexels.com/photo/12345.jpg"},
            )
            is False
        )


class TestRepoAssetUrl:
    def test_emits_asset_placeholder(self):
        assert (
            _repo_asset_url("uagm3ff1", "imports/abc123.webp")
            == "__ASSET_IMG:assets/imports/abc123.webp__"
        )

    def test_strips_leading_slash(self):
        assert (
            _repo_asset_url("uagm3ff1", "/imports/abc.webp")
            == "__ASSET_IMG:assets/imports/abc.webp__"
        )

    def test_empty_relpath_returns_empty(self):
        assert _repo_asset_url("uagm3ff1", "") == ""
        assert _repo_asset_url("uagm3ff1", None) == ""  # type: ignore[arg-type]

    def test_app_uuid_is_ignored(self):
        # The placeholder does not depend on app_uuid — backend deploy uses
        # the app's real public_id at rewrite time.
        with_uuid = _repo_asset_url("agent-internal-uuid", "imports/x.webp")
        without_uuid = _repo_asset_url("", "imports/x.webp")
        assert with_uuid == without_uuid == "__ASSET_IMG:assets/imports/x.webp__"


class TestParseExepadImageProps:
    def test_extracts_data_asset_relpath(self):
        tag_body = (
            ' data-asset-relpath="imports/abc.webp"'
            ' alt="chickens"'
            ' keywords="chickens in field"'
            " width={800} height={600} importance={8}"
        )
        props = _parse_exepad_image_props(tag_body)
        assert props["asset_relpath"] == "imports/abc.webp"
        assert props["keywords"] == "chickens in field"
        assert props["width"] == 800

    def test_missing_data_asset_relpath_is_empty(self):
        tag_body = ' keywords="golden retriever" importance={7}'
        props = _parse_exepad_image_props(tag_body)
        assert props["asset_relpath"] == ""


class TestResolveRepoAssetTag:
    def test_injects_placeholder_and_vendor_strips_relpath(self):
        tag = (
            '<ExepadImage data-asset-relpath="imports/abc.webp"'
            ' alt="chickens" keywords="chickens" width={800}'
            " height={600} importance={8} />"
        )
        new = _resolve_repo_asset_tag(tag, "__ASSET_IMG:assets/imports/abc.webp__")
        assert "__ASSET_IMG:assets/imports/abc.webp__" in new
        assert 'vendor="design_import"' in new
        assert "data-asset-relpath" not in new


@pytest.mark.asyncio
class TestResolveExepadImagesImportAssetShortCircuit:
    async def test_import_asset_tag_rewritten_to_placeholder_without_stock_fetch(self):
        tsx = (
            "function X() { return (\n"
            '  <ExepadImage data-asset-relpath="imports/hero.webp"'
            ' alt="chickens in pasture" keywords="chickens in pasture"'
            " width={1200} height={800} importance={9} />\n"
            "); }"
        )
        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver.process_one_image_prop",
            new=AsyncMock(),
        ) as mock_fetch:
            new_tsx, count, total_tags, new_urls = await _resolve_exepad_images(
                tsx,
                image_catalog=[],
                used_uuids=set(),
                used_urls=set(),
                app_uuid="uagm3ff1",
            )

        mock_fetch.assert_not_called()
        assert "__ASSET_IMG:assets/imports/hero.webp__" in new_tsx
        # Ensure no baked /a/<uuid>/ leaked — that was the Flaw 1 regression.
        assert "/a/uagm3ff1/repo/assets/imports/hero.webp" not in new_tsx
        assert 'vendor="design_import"' in new_tsx
        assert "data-asset-relpath" not in new_tsx
        assert count == 1
        assert total_tags == 1
        assert "__ASSET_IMG:assets/imports/hero.webp__" in new_urls

    async def test_mixed_import_asset_and_stock_both_resolve(self):
        tsx = (
            "function X() { return (<>\n"
            '  <ExepadImage data-asset-relpath="imports/hero.webp"'
            ' alt="hero" keywords="hero" width={1200} height={800}'
            " importance={9} />\n"
            '  <ExepadImage keywords="team portrait" width={400}'
            " height={400} importance={5} />\n"
            "</>); }"
        )

        async def fake_process(image_prop, **kwargs):
            return {
                "src": "https://images.pexels.com/photo/12345.jpg",
                "asset": {"provider": "pexels", "providerImgId": "12345"},
            }

        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver.process_one_image_prop",
            new=fake_process,
        ):
            new_tsx, count, total_tags, _ = await _resolve_exepad_images(
                tsx,
                image_catalog=[],
                used_uuids=set(),
                used_urls=set(),
                app_uuid="uagm3ff1",
            )

        assert "__ASSET_IMG:assets/imports/hero.webp__" in new_tsx
        assert "images.pexels.com/photo/12345.jpg" in new_tsx
        assert count == 2
        assert total_tags == 2

    async def test_canonical_asset_img_placeholder_short_circuits_without_data_attr(self):
        """The translator now emits ``src="__ASSET_IMG:assets/...__"`` +
        ``vendor="design_import"`` directly (see ``wiring/images.py``), so the
        resolver should NOT hit the legacy ``data-asset-relpath`` path. It
        should also NOT issue a stock-photo fetch: ``__ASSET_IMG:`` is a
        non-stock URL that ``_needs_resolution`` treats as already resolved.
        Verifies the architectural fix for RC#4 (chick_farm Stitch images
        were being orphaned and refetched via stock search because the LLM
        stripped the unknown ``data-asset-relpath`` data attribute)."""
        tsx = (
            '<ExepadImage keywords="hero shot" importance={5} width={1200}'
            ' height={800} src="__ASSET_IMG:assets/imports/abc.webp__"'
            ' vendor="design_import" />'
        )
        fetch_mock = AsyncMock()
        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver.process_one_image_prop",
            new=fetch_mock,
        ):
            new_tsx, count, total_tags, _ = await _resolve_exepad_images(
                tsx,
                image_catalog=[],
                used_uuids=set(),
                used_urls=set(),
                app_uuid="uagm3ff1",
            )

        fetch_mock.assert_not_called()
        # Placeholder + vendor preserved byte-for-byte.
        assert 'src="__ASSET_IMG:assets/imports/abc.webp__"' in new_tsx
        assert 'vendor="design_import"' in new_tsx
        assert "data-asset-relpath" not in new_tsx
        # total_tags counts only tags that needed work (stock-fetch slots OR
        # repo-asset rewrites). The canonical `__ASSET_IMG:` placeholder is
        # treated as already-resolved by `_needs_resolution`, so it bypasses
        # both queues — no slot, no rewrite, no fetch. The tag is left untouched.
        assert total_tags == 0
        assert count == 0

    async def test_no_import_asset_tags_falls_through_unchanged_behavior(self):
        tsx = '<ExepadImage keywords="red barn" importance={6} />'

        async def fake_process(image_prop, **kwargs):
            return {
                "src": "https://images.pexels.com/photo/99.jpg",
                "asset": {"provider": "pexels", "providerImgId": "99"},
            }

        with patch(
            "main_agent.agents.orchestrator.app_types.webapp.services.codefocus_image_resolver.process_one_image_prop",
            new=fake_process,
        ):
            new_tsx, count, total_tags, _ = await _resolve_exepad_images(
                tsx, image_catalog=[], used_uuids=set(), used_urls=set(), app_uuid="u1"
            )

        assert "pexels.com" in new_tsx
        assert "data-asset-relpath" not in new_tsx
        assert count == 1
        assert total_tags == 1
