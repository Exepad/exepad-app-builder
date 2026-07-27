"""Tests for the Claude Design pre-filter in the bundle stager.

Covers ``_apply_claude_design_filter`` in isolation plus an end-to-end
``stage_bundle_artifacts`` run against the real Taskflow Board fixture at
``packages/design-tools-fixtures/claude_design/``. The fixture exercises the
real-world export shape (3 HTML variants + uploads/* + scraps/*.napkin)
that motivated the filter.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from main_agent.agents.orchestrator.importers.bundle_stager import (
    _apply_claude_design_filter,
    _claude_design_group_stem,
    _claude_design_variant_priority,
    _render_manifest_markdown,
    stage_bundle_artifacts,
)

pytestmark = [pytest.mark.unit]


# ── Pure-helper tests ─────────────────────────────────────────────────────


class TestVariantPriority:
    def test_standalone_src_wins(self):
        assert _claude_design_variant_priority("Foo (standalone-src).html")[0] == 0

    def test_canvas_in_the_middle(self):
        assert _claude_design_variant_priority("Foo.html")[0] == 1

    def test_minified_standalone_loses(self):
        assert _claude_design_variant_priority("Foo (standalone).html")[0] == 2

    def test_priority_is_case_insensitive(self):
        assert _claude_design_variant_priority("Foo (Standalone-Src).HTML")[0] == 0


class TestGroupStem:
    def test_standalone_src_stripped(self):
        assert _claude_design_group_stem("Taskflow Board (standalone-src).html") == "Taskflow Board"

    def test_standalone_stripped(self):
        assert _claude_design_group_stem("Taskflow Board (standalone).html") == "Taskflow Board"

    def test_canvas_stripped(self):
        assert _claude_design_group_stem("Taskflow Board.html") == "Taskflow Board"

    def test_no_extension_unchanged(self):
        assert _claude_design_group_stem("Taskflow Board") == "Taskflow Board"


# ── _apply_claude_design_filter ────────────────────────────────────────────


def _html_entry(relpath: str) -> dict:
    return {
        "archive_relpath": relpath,
        "gcs_path": f"design-bundles/abc/{relpath}",
        "mime": "text/html",
    }


def _asset_ref(mime: str = "image/png") -> dict:
    return {"gcs_path": "design-bundles/abc/x", "mime": mime}


class TestClaudeDesignFilter:
    def test_picks_standalone_src_over_canvas_and_standalone(self):
        html = [
            _html_entry("Taskflow Board.html"),
            _html_entry("Taskflow Board (standalone).html"),
            _html_entry("Taskflow Board (standalone-src).html"),
        ]
        result = _apply_claude_design_filter(html, {})

        assert result.mode == "single_canvas"
        assert len(result.canonical_html) == 1
        assert result.canonical_html[0]["archive_relpath"] == "Taskflow Board (standalone-src).html"
        assert result.asset_refs == {}
        assert result.context_image_refs == {}
        assert result.partials_doc_refs == {}
        # Two variants dropped, both name the canonical winner in their reason.
        dropped_paths = sorted(d["relpath"] for d in result.dropped)
        assert dropped_paths == [
            "Taskflow Board (standalone).html",
            "Taskflow Board.html",
        ]
        for row in result.dropped:
            assert "Taskflow Board (standalone-src).html" in row["reason"]

    def test_falls_back_to_canvas_when_standalone_src_missing(self):
        html = [
            _html_entry("Foo.html"),
            _html_entry("Foo (standalone).html"),
        ]
        result = _apply_claude_design_filter(html, {})
        assert result.canonical_html[0]["archive_relpath"] == "Foo.html"
        assert result.mode == "single_canvas"

    def test_single_variant_passes_through_no_drops(self):
        # A single bare-canvas HTML has no variant suffix → mode is multi_page;
        # the page passes through with zero drops.
        html = [_html_entry("Solo.html")]
        result = _apply_claude_design_filter(html, {})
        assert result.canonical_html[0]["archive_relpath"] == "Solo.html"
        assert result.dropped == []
        assert result.mode == "multi_page"

    def test_uploads_image_routed_to_context(self):
        assets = {
            "uploads/pasted-1776619804346-0.png": _asset_ref("image/png"),
            "real-asset.svg": _asset_ref("image/svg+xml"),
        }
        result = _apply_claude_design_filter([], assets)
        assert "uploads/pasted-1776619804346-0.png" in result.context_image_refs
        assert "uploads/pasted-1776619804346-0.png" not in result.asset_refs
        # Non-uploads asset stays in regular asset_refs.
        assert "real-asset.svg" in result.asset_refs
        # Image-MIME upload is not dropped — it's routed.
        assert all("uploads/" not in d["relpath"] for d in result.dropped)

    def test_scraps_dropped_with_reason(self):
        assets = {"scraps/sketch-x.napkin": _asset_ref("application/octet-stream")}
        result = _apply_claude_design_filter([], assets)
        assert result.asset_refs == {}
        assert result.context_image_refs == {}
        assert len(result.dropped) == 1
        assert result.dropped[0]["relpath"] == "scraps/sketch-x.napkin"
        assert "scraps" in result.dropped[0]["reason"].lower()

    def test_uploads_non_image_dropped_not_routed(self):
        assets = {"uploads/notes.txt": _asset_ref("text/plain")}
        result = _apply_claude_design_filter([], assets)
        assert result.asset_refs == {}
        assert result.context_image_refs == {}
        assert len(result.dropped) == 1
        assert result.dropped[0]["relpath"] == "uploads/notes.txt"

    def test_multiple_artifact_groups_yield_multiple_canonicals(self):
        html = [
            _html_entry("Login.html"),
            _html_entry("Login (standalone-src).html"),
            _html_entry("Dashboard.html"),
            _html_entry("Dashboard (standalone-src).html"),
        ]
        result = _apply_claude_design_filter(html, {})
        assert result.mode == "single_canvas"
        picked = sorted(c["archive_relpath"] for c in result.canonical_html)
        assert picked == [
            "Dashboard (standalone-src).html",
            "Login (standalone-src).html",
        ]

    def test_nested_html_passes_through_untouched(self):
        """Nested HTML (rare in single-canvas Claude Design exports) is not
        subject to variant grouping — it's keyed by full relpath and passed
        through. The presence of a (standalone-src) sibling pins the bundle
        to single_canvas mode."""
        html = [
            _html_entry("Foo (standalone-src).html"),
            _html_entry("subpages/help.html"),
        ]
        result = _apply_claude_design_filter(html, {})
        assert result.mode == "single_canvas"
        picked = sorted(c["archive_relpath"] for c in result.canonical_html)
        assert picked == ["Foo (standalone-src).html", "subpages/help.html"]
        # Nested HTML must not appear in dropped — it was preserved, not skipped.
        assert all(d["relpath"] != "subpages/help.html" for d in result.dropped)


# ── End-to-end stager run against the real Taskflow Board fixture ─────────


# Locate the fixture relative to this test file so the test is portable across
# checkouts. apps/agent/tests/unit/<this file>.parents[4] is the repo root.
FIXTURE_DIR = (
    Path(__file__).resolve().parents[4] / "packages" / "design-tools-fixtures" / "claude_design"
)


def _fake_ctx():
    artifact_service = SimpleNamespace(save_artifact=AsyncMock(return_value=1))
    session = SimpleNamespace(id="s1", user_id="u1", app_name="test-app")
    return SimpleNamespace(artifact_service=artifact_service, session=session)


def _fixture_manifest() -> dict:
    """Mirror what the Django backend produces for the Taskflow fixture.

    `.napkin` files land in the backend's `other_helpers` bucket which the
    stager doesn't read at all — so they don't appear here.
    """
    return {
        "source": "claude-design",
        "html_files": [
            {
                "archive_relpath": "Taskflow Board.html",
                "gcs_path": "design-bundles/abc/Taskflow Board.html",
                "mime": "text/html",
            },
            {
                "archive_relpath": "Taskflow Board (standalone).html",
                "gcs_path": "design-bundles/abc/Taskflow Board (standalone).html",
                "mime": "text/html",
            },
            {
                "archive_relpath": "Taskflow Board (standalone-src).html",
                "gcs_path": "design-bundles/abc/Taskflow Board (standalone-src).html",
                "mime": "text/html",
            },
        ],
        "asset_refs": {
            "uploads/pasted-1776619804346-0.png": {
                "gcs_path": "design-bundles/abc/uploads/pasted-1776619804346-0.png",
                "mime": "image/png",
            },
        },
    }


def _make_fixture_fetch_bytes():
    """fetch_bytes stub that resolves gcs_path → bytes from the fixture dir."""

    async def fetch_bytes(path: str) -> bytes:
        # gcs_path looks like `design-bundles/abc/<relpath>`. Strip the prefix.
        prefix = "design-bundles/abc/"
        assert path.startswith(prefix), f"unexpected gcs_path: {path}"
        relpath = path[len(prefix) :]
        full = FIXTURE_DIR / relpath
        if not full.exists():
            raise FileNotFoundError(str(full))
        return full.read_bytes()

    return fetch_bytes


@pytest.mark.asyncio
async def test_taskflow_fixture_produces_one_canonical_html_and_one_context_image():
    if not FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {FIXTURE_DIR}")

    ctx = _fake_ctx()
    result = await stage_bundle_artifacts(
        ctx,
        bundle_id="abc",
        manifest=_fixture_manifest(),
        fetch_bytes=_make_fixture_fetch_bytes(),
    )

    assert result["bundle_source"] == "claude-design"
    assert result["skill_name"] == "claude-design-importer"

    saved_keys = [
        call.kwargs["filename"] for call in ctx.artifact_service.save_artifact.call_args_list
    ]

    # Exactly one bundle:html:* artifact, and it's the (standalone-src) variant.
    html_keys = [k for k in saved_keys if k.startswith("bundle:html:")]
    assert html_keys == ["bundle:html:Taskflow Board (standalone-src).html"]

    # Zero bundle:asset:* artifacts (the only asset_refs entry was an upload,
    # which routes to context_image instead).
    asset_keys = [k for k in saved_keys if k.startswith("bundle:asset:")]
    assert asset_keys == []

    # Exactly one bundle:context_image:* artifact — the user-pasted PNG.
    context_keys = [k for k in saved_keys if k.startswith("bundle:context_image:")]
    assert context_keys == ["bundle:context_image:uploads/pasted-1776619804346-0.png"]

    # Manifest.md must be saved.
    assert "bundle:manifest.md" in saved_keys

    # staged_count counts every saved artifact except manifest.md (1 html + 1 ctx).
    assert result["staged_count"] == 2


@pytest.mark.asyncio
async def test_taskflow_fixture_manifest_text_has_canonical_skipped_and_reference_sections():
    if not FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {FIXTURE_DIR}")

    ctx = _fake_ctx()
    await stage_bundle_artifacts(
        ctx,
        bundle_id="abc",
        manifest=_fixture_manifest(),
        fetch_bytes=_make_fixture_fetch_bytes(),
    )

    # Find the manifest.md save call and decode its body.
    manifest_call = next(
        c
        for c in ctx.artifact_service.save_artifact.call_args_list
        if c.kwargs["filename"] == "bundle:manifest.md"
    )
    manifest_part = manifest_call.kwargs["artifact"]
    manifest_text = manifest_part.inline_data.data.decode("utf-8")

    # Source-aware HTML section title.
    assert "## Canonical page HTML" in manifest_text
    assert "there is exactly one" in manifest_text

    # The Reference imagery section warning is present.
    assert "## Reference imagery" in manifest_text
    assert "do NOT use as deployable" in manifest_text

    # The Skipped section names both rejected variants.
    assert "## Skipped duplicates and helpers" in manifest_text
    assert "Taskflow Board.html" in manifest_text
    assert "Taskflow Board (standalone).html" in manifest_text
    # The reasons mention the canonical winner.
    assert "Taskflow Board (standalone-src).html" in manifest_text


# ── Empty-bundle behavior ─────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bundle_with_only_dropped_entries_returns_empty():
    """A bundle that contains only filtered-out files (e.g. only `scraps/`)
    has nothing for the LLM to read. The stager must return ``{}`` and not
    save a manifest, mirroring the catastrophic-failure path the dispatcher
    relies on."""
    ctx = _fake_ctx()

    async def fetch_bytes(path: str) -> bytes:  # pragma: no cover — never called
        raise AssertionError("should not fetch when everything is dropped")

    manifest = {
        "source": "claude-design",
        "html_files": [],
        "asset_refs": {
            "scraps/sketch.napkin": {
                "gcs_path": "design-bundles/abc/scraps/sketch.napkin",
                "mime": "application/octet-stream",
            },
        },
    }

    result = await stage_bundle_artifacts(
        ctx,
        bundle_id="abc",
        manifest=manifest,
        fetch_bytes=fetch_bytes,
    )

    assert result == {}
    # No manifest.md saved either — same shape as the legacy empty path.
    saved_keys = [
        call.kwargs["filename"] for call in ctx.artifact_service.save_artifact.call_args_list
    ]
    assert saved_keys == []


# ── Filter is a no-op for non-claude-design sources ───────────────────────


@pytest.mark.asyncio
async def test_filter_is_noop_for_stitch_source():
    """Stitch bundles must pass through unchanged. A Stitch-shaped
    manifest with multiple HTMLs at top-level should stage all of them, and
    no context_image artifacts should be produced."""
    ctx = _fake_ctx()

    async def fetch_bytes(path: str) -> bytes:
        return b"<html></html>"

    manifest = {
        "source": "stitch",
        "html_files": [
            {
                "archive_relpath": "home_x/code.html",
                "gcs_path": "design-bundles/abc/home_x/code.html",
                "mime": "text/html",
            },
            {
                "archive_relpath": "about_y/code.html",
                "gcs_path": "design-bundles/abc/about_y/code.html",
                "mime": "text/html",
            },
        ],
        "asset_refs": {
            "uploads/something.png": {
                "gcs_path": "design-bundles/abc/uploads/something.png",
                "mime": "image/png",
            },
        },
    }

    result = await stage_bundle_artifacts(
        ctx,
        bundle_id="abc",
        manifest=manifest,
        fetch_bytes=fetch_bytes,
    )

    saved_keys = [
        call.kwargs["filename"] for call in ctx.artifact_service.save_artifact.call_args_list
    ]
    # Both Stitch HTMLs staged.
    assert "bundle:html:home_x/code.html" in saved_keys
    assert "bundle:html:about_y/code.html" in saved_keys
    # uploads/ stays as an asset under Stitch (filter only fires for claude-design).
    assert "bundle:asset:uploads/something.png" in saved_keys
    # No context_image artifacts.
    assert not any(k.startswith("bundle:context_image:") for k in saved_keys)
    assert result["bundle_source"] == "stitch"


# ── _render_manifest_markdown rendering of dropped + context_image ────────


class TestManifestMarkdownNewSections:
    def test_dropped_section_renders_each_row(self):
        md = _render_manifest_markdown(
            bundle_id="x",
            source="claude-design",
            skill_name="claude-design-importer",
            rows=[
                {
                    "key": "bundle:html:Foo (standalone-src).html",
                    "relpath": "Foo (standalone-src).html",
                    "mime": "text/html",
                    "description": "HTML",
                    "staged": "yes",
                },
            ],
            dropped=[
                {"relpath": "Foo.html", "reason": "Duplicate Claude Design variant"},
                {"relpath": "scraps/x.napkin", "reason": "Discarded sketch"},
            ],
        )
        assert "## Skipped duplicates and helpers" in md
        assert "- `Foo.html` — Duplicate Claude Design variant" in md
        assert "- `scraps/x.napkin` — Discarded sketch" in md

    def test_context_image_section_renders_with_warning(self):
        md = _render_manifest_markdown(
            bundle_id="x",
            source="claude-design",
            skill_name="claude-design-importer",
            rows=[
                {
                    "key": "bundle:context_image:uploads/ref.png",
                    "relpath": "uploads/ref.png",
                    "mime": "image/png",
                    "description": "Reference image",
                    "staged": "yes",
                },
            ],
        )
        assert "## Reference imagery" in md
        assert "do NOT use as deployable" in md
        assert "bundle:context_image:uploads/ref.png" in md

    def test_html_title_three_way_split(self):
        rows = [
            {
                "key": "bundle:html:home/code.html",
                "relpath": "home/code.html",
                "mime": "text/html",
                "description": "HTML",
                "staged": "yes",
            }
        ]
        stitch_md = _render_manifest_markdown(
            bundle_id="x", source="stitch", skill_name="stitch-importer", rows=rows
        )
        claude_canvas_md = _render_manifest_markdown(
            bundle_id="x",
            source="claude-design",
            skill_name="claude-design-importer",
            rows=rows,
            mode="single_canvas",
        )
        claude_multi_md = _render_manifest_markdown(
            bundle_id="x",
            source="claude-design",
            skill_name="claude-design-importer",
            rows=rows,
            mode="multi_page",
        )
        # Stitch keeps the original generic title.
        assert "## HTML pages and documents" in stitch_md
        assert "## Canonical page HTML" not in stitch_md
        assert "## Pages" not in stitch_md
        # Claude Design single_canvas → "Canonical page HTML (… exactly one)".
        assert "## Canonical page HTML" in claude_canvas_md
        assert "there is exactly one" in claude_canvas_md
        # Claude Design multi_page → "## Pages (…)".
        assert "## Pages" in claude_multi_md
        assert "## Canonical page HTML" not in claude_multi_md
        # Mode bullet appears in the header for claude-design with mode set.
        assert "**Mode:** `single_canvas`" in claude_canvas_md
        assert "**Mode:** `multi_page`" in claude_multi_md
        assert "**Mode:**" not in stitch_md  # No mode for non-claude-design

    def test_omits_dropped_section_when_empty(self):
        md = _render_manifest_markdown(
            bundle_id="x",
            source="stitch",
            skill_name="stitch-importer",
            rows=[
                {
                    "key": "bundle:html:p/code.html",
                    "relpath": "p/code.html",
                    "mime": "text/html",
                    "description": "x",
                    "staged": "yes",
                }
            ],
            dropped=None,
        )
        assert "## Skipped duplicates and helpers" not in md
