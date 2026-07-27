"""Tests for the Claude Design multi-page (v2) export format.

Covers ``_detect_claude_design_mode``, the multi-page branch of
``_apply_claude_design_filter`` (no variant filtering, ``partials.html``
rerouted to ``bundle:doc:*``), and an end-to-end ``stage_bundle_artifacts``
run against the real HappyDoods fixture at
``packages/design-tools-fixtures/claude_design_2/``.

The single-canvas v1 path is covered by
``test_bundle_stager_claude_design.py``; this file is the v2 counterpart.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from main_agent.agents.orchestrator.importers.bundle_stager import (
    _apply_claude_design_filter,
    _detect_claude_design_mode,
    _is_partials_html,
    stage_bundle_artifacts,
)

pytestmark = [pytest.mark.unit]


# ── Mode detection ────────────────────────────────────────────────────────


def _html_entry(relpath: str) -> dict:
    return {
        "archive_relpath": relpath,
        "gcs_path": f"design-bundles/abc/{relpath}",
        "mime": "text/html",
    }


class TestDetectClaudeDesignMode:
    def test_standalone_src_marks_single_canvas(self):
        html = [_html_entry("Foo.html"), _html_entry("Foo (standalone-src).html")]
        assert _detect_claude_design_mode(html) == "single_canvas"

    def test_standalone_marks_single_canvas(self):
        html = [_html_entry("Foo.html"), _html_entry("Foo (standalone).html")]
        assert _detect_claude_design_mode(html) == "single_canvas"

    def test_no_variant_suffix_means_multi_page(self):
        html = [_html_entry("index.html"), _html_entry("shop.html"), _html_entry("contact.html")]
        assert _detect_claude_design_mode(html) == "multi_page"

    def test_single_html_no_suffix_is_multi_page(self):
        # A solo HTML with no variant suffix is treated as multi_page (a
        # single-page multi-page export). The slug rule still produces one
        # `content::page.html` so output is identical to single_canvas for
        # this edge case.
        html = [_html_entry("Solo.html")]
        assert _detect_claude_design_mode(html) == "multi_page"

    def test_empty_html_is_multi_page(self):
        # Defensive: no html_files at all → no variant suffix observed → multi_page.
        assert _detect_claude_design_mode([]) == "multi_page"

    def test_case_insensitive_variant_match(self):
        html = [_html_entry("Foo (Standalone-Src).HTML")]
        assert _detect_claude_design_mode(html) == "single_canvas"


class TestIsPartialsHtml:
    def test_root_partials(self):
        assert _is_partials_html("partials.html") is True

    def test_capitalized_partials(self):
        assert _is_partials_html("Partials.html") is True

    def test_nested_partials(self):
        # basename match — works regardless of folder.
        assert _is_partials_html("subdir/partials.html") is True

    def test_other_html_is_not_partials(self):
        assert _is_partials_html("index.html") is False
        assert _is_partials_html("contact.html") is False


# ── Multi-page branch of _apply_claude_design_filter ──────────────────────


class TestMultiPageFilter:
    def test_all_pages_pass_through_no_dedupe(self):
        html = [
            _html_entry("index.html"),
            _html_entry("shop.html"),
            _html_entry("contact.html"),
        ]
        result = _apply_claude_design_filter(html, {})
        assert result.mode == "multi_page"
        picked = sorted(c["archive_relpath"] for c in result.canonical_html)
        assert picked == ["contact.html", "index.html", "shop.html"]
        assert result.dropped == []
        assert result.partials_doc_refs == {}

    def test_partials_extracted_to_doc_refs(self):
        html = [
            _html_entry("index.html"),
            _html_entry("partials.html"),
            _html_entry("shop.html"),
        ]
        result = _apply_claude_design_filter(html, {})
        assert result.mode == "multi_page"
        # partials.html is NOT in canonical_html.
        canonical_paths = sorted(c["archive_relpath"] for c in result.canonical_html)
        assert canonical_paths == ["index.html", "shop.html"]
        # partials.html IS in partials_doc_refs, keyed by relpath.
        assert "partials.html" in result.partials_doc_refs
        assert result.partials_doc_refs["partials.html"]["mime"] == "text/html"
        assert (
            result.partials_doc_refs["partials.html"]["gcs_path"]
            == "design-bundles/abc/partials.html"
        )
        # Not in dropped — it's staged, just under a different namespace.
        assert all(d["relpath"] != "partials.html" for d in result.dropped)

    def test_partials_capitalization_still_routed(self):
        html = [_html_entry("index.html"), _html_entry("Partials.html")]
        result = _apply_claude_design_filter(html, {})
        assert "Partials.html" in result.partials_doc_refs

    def test_no_partials_means_empty_doc_refs(self):
        html = [_html_entry("index.html"), _html_entry("shop.html")]
        result = _apply_claude_design_filter(html, {})
        assert result.partials_doc_refs == {}


# ── End-to-end run against the HappyDoods fixture ─────────────────────────

# Locate the fixture relative to this test file so the test is portable across
# checkouts. apps/agent/tests/unit/<this file>.parents[4] is the repo root.
FIXTURE_DIR = (
    Path(__file__).resolve().parents[4] / "packages" / "design-tools-fixtures" / "claude_design" / "chick_farm"
)


def _fake_ctx():
    artifact_service = SimpleNamespace(save_artifact=AsyncMock(return_value=1))
    session = SimpleNamespace(id="s1", user_id="u1", app_name="test-app")
    return SimpleNamespace(artifact_service=artifact_service, session=session)


# All 8 deployable pages in the HappyDoods fixture, in alphabetical order.
_FIXTURE_PAGES = [
    "contact.html",
    "flock.html",
    "index.html",
    "practices.html",
    "shop.html",
    "stockists.html",
    "story.html",
    "visit.html",
]


def _fixture_manifest() -> dict:
    """Mirror what the Django backend produces for the HappyDoods fixture.

    8 pages + partials.html in `html_files`, styles.css in `asset_refs`. No
    uploads/, no scraps/, no .napkin (this format doesn't have them).
    """
    return {
        "source": "claude-design",
        "html_files": [
            {
                "archive_relpath": rel,
                "gcs_path": f"design-bundles/abc/{rel}",
                "mime": "text/html",
            }
            for rel in (*_FIXTURE_PAGES, "partials.html")
        ],
        "asset_refs": {
            "styles.css": {
                "gcs_path": "design-bundles/abc/styles.css",
                "mime": "text/css",
            },
        },
    }


def _make_fixture_fetch_bytes():
    """fetch_bytes stub that resolves gcs_path → bytes from the fixture dir."""

    async def fetch_bytes(path: str) -> bytes:
        prefix = "design-bundles/abc/"
        assert path.startswith(prefix), f"unexpected gcs_path: {path}"
        relpath = path[len(prefix) :]
        full = FIXTURE_DIR / relpath
        if not full.exists():
            raise FileNotFoundError(str(full))
        return full.read_bytes()

    return fetch_bytes


@pytest.mark.asyncio
async def test_happydoods_fixture_stages_eight_pages_one_partial_one_styles():
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
    assert result["mode"] == "multi_page"

    saved_keys = [
        call.kwargs["filename"] for call in ctx.artifact_service.save_artifact.call_args_list
    ]

    # Exactly 8 bundle:html:* artifacts — one per deployable page; partials.html
    # must NOT be in the html namespace.
    html_keys = sorted(k for k in saved_keys if k.startswith("bundle:html:"))
    expected_html_keys = sorted(f"bundle:html:{p}" for p in _FIXTURE_PAGES)
    assert html_keys == expected_html_keys
    assert "bundle:html:partials.html" not in saved_keys

    # Exactly one bundle:doc:partials.html artifact.
    doc_keys = [k for k in saved_keys if k.startswith("bundle:doc:")]
    assert doc_keys == ["bundle:doc:partials.html"]

    # styles.css staged as bundle:asset:.
    asset_keys = [k for k in saved_keys if k.startswith("bundle:asset:")]
    assert asset_keys == ["bundle:asset:styles.css"]

    # Zero context_image artifacts (no uploads/ in this format).
    assert not any(k.startswith("bundle:context_image:") for k in saved_keys)

    # Manifest.md is saved.
    assert "bundle:manifest.md" in saved_keys

    # staged_count = 8 pages + 1 doc + 1 asset = 10.
    assert result["staged_count"] == 10


@pytest.mark.asyncio
async def test_happydoods_fixture_manifest_text_carries_mode_and_titles():
    if not FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {FIXTURE_DIR}")

    ctx = _fake_ctx()
    await stage_bundle_artifacts(
        ctx,
        bundle_id="abc",
        manifest=_fixture_manifest(),
        fetch_bytes=_make_fixture_fetch_bytes(),
    )

    manifest_call = next(
        c
        for c in ctx.artifact_service.save_artifact.call_args_list
        if c.kwargs["filename"] == "bundle:manifest.md"
    )
    manifest_text = manifest_call.kwargs["artifact"].inline_data.data.decode("utf-8")

    # Mode bullet appears in the header.
    assert "**Mode:** `multi_page`" in manifest_text

    # Multi-page HTML section title is used (not the single-canvas title).
    assert "## Pages" in manifest_text
    assert "## Canonical page HTML" not in manifest_text

    # partials.html lives under "Author-written notes" with the shared-chrome
    # description override.
    assert "## Author-written notes" in manifest_text
    assert "bundle:doc:partials.html" in manifest_text
    assert "shared chrome" in manifest_text.lower()
    assert "Do NOT emit as a deployable page" in manifest_text

    # styles.css listed under Assets.
    assert "## Assets" in manifest_text
    assert "bundle:asset:styles.css" in manifest_text

    # No "Skipped duplicates" — multi-page exports have nothing to drop.
    assert "## Skipped duplicates and helpers" not in manifest_text

    # No "Reference imagery" — no uploads/ in this format.
    assert "## Reference imagery" not in manifest_text

    # Sanity: every page is listed.
    for page in _FIXTURE_PAGES:
        assert f"bundle:html:{page}" in manifest_text


# ── Babel-shell exports (Platformer Game fixture) ────────────────────────

# A Claude Design Babel-in-browser export carries the React app in sibling
# .jsx files referenced from the HTML via `<script type="text/babel" src=…>`.
# These siblings ride in the manifest's `script_files` bucket and the stager
# routes them to `bundle:script:<relpath>`.
PLATFORMER_FIXTURE_DIR = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "design-tools-fixtures"
    / "claude_design"
    / "Platformer Game"
)


def _platformer_manifest() -> dict:
    """Mirror the backend's manifest for the Platformer Game export.

    2 HTML page shells + 2 sibling .jsx files (game.jsx, tweaks-panel.jsx).
    No styles.css — per-page <head><style> is the only CSS in this export.
    """
    return {
        "source": "claude-design",
        "html_files": [
            {
                "archive_relpath": "Bloop World.html",
                "gcs_path": "design-bundles/plat/Bloop World.html",
                "mime": "text/html",
            },
            {
                "archive_relpath": "Kub Quest.html",
                "gcs_path": "design-bundles/plat/Kub Quest.html",
                "mime": "text/html",
            },
        ],
        "script_files": [
            {
                "archive_relpath": "game.jsx",
                "gcs_path": "design-bundles/plat/game.jsx",
                "mime": "text/jsx",
            },
            {
                "archive_relpath": "tweaks-panel.jsx",
                "gcs_path": "design-bundles/plat/tweaks-panel.jsx",
                "mime": "text/jsx",
            },
        ],
    }


def _make_platformer_fetch_bytes():
    """fetch_bytes stub resolving gcs_path → bytes from the Platformer fixture."""

    async def fetch_bytes(path: str) -> bytes:
        prefix = "design-bundles/plat/"
        assert path.startswith(prefix), f"unexpected gcs_path: {path}"
        relpath = path[len(prefix) :]
        full = PLATFORMER_FIXTURE_DIR / relpath
        if not full.exists():
            raise FileNotFoundError(str(full))
        return full.read_bytes()

    return fetch_bytes


@pytest.mark.asyncio
async def test_platformer_fixture_stages_jsx_siblings_under_bundle_script_namespace():
    if not PLATFORMER_FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {PLATFORMER_FIXTURE_DIR}")

    ctx = _fake_ctx()
    result = await stage_bundle_artifacts(
        ctx,
        bundle_id="plat",
        manifest=_platformer_manifest(),
        fetch_bytes=_make_platformer_fetch_bytes(),
    )

    saved_keys = [
        call.kwargs["filename"] for call in ctx.artifact_service.save_artifact.call_args_list
    ]

    # 2 HTML shells.
    html_keys = sorted(k for k in saved_keys if k.startswith("bundle:html:"))
    assert html_keys == ["bundle:html:Bloop World.html", "bundle:html:Kub Quest.html"]

    # 2 JSX sources under the new bundle:script: namespace — NOT bundle:asset:
    # (they previously would have been silently dropped at backend ingest).
    script_keys = sorted(k for k in saved_keys if k.startswith("bundle:script:"))
    assert script_keys == ["bundle:script:game.jsx", "bundle:script:tweaks-panel.jsx"]

    # No JSX leaked into the asset or doc namespaces.
    assert not any(
        k.startswith("bundle:asset:") and (".jsx" in k or ".tsx" in k) for k in saved_keys
    )
    assert not any(
        k.startswith("bundle:doc:") and (".jsx" in k or ".tsx" in k) for k in saved_keys
    )

    # 2 html + 2 scripts + 1 manifest = 5 staged artifacts.
    assert result["staged_count"] == 4  # excludes manifest.md from the count
    assert "bundle:manifest.md" in saved_keys


@pytest.mark.asyncio
async def test_platformer_fixture_manifest_renders_react_jsx_section():
    if not PLATFORMER_FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {PLATFORMER_FIXTURE_DIR}")

    ctx = _fake_ctx()
    await stage_bundle_artifacts(
        ctx,
        bundle_id="plat",
        manifest=_platformer_manifest(),
        fetch_bytes=_make_platformer_fetch_bytes(),
    )

    manifest_call = next(
        c
        for c in ctx.artifact_service.save_artifact.call_args_list
        if c.kwargs["filename"] == "bundle:manifest.md"
    )
    manifest_text = manifest_call.kwargs["artifact"].inline_data.data.decode("utf-8")

    # The new React/JSX sources section appears with a description that
    # tells the LLM what the bundle:script:* keys are for.
    assert "## React/JSX sources" in manifest_text
    assert "bundle:script:game.jsx" in manifest_text
    assert "bundle:script:tweaks-panel.jsx" in manifest_text
    # The JSX translator pairing is mentioned in the section description.
    assert "JSX translator" in manifest_text


@pytest.mark.asyncio
async def test_happydoods_fixture_does_not_log_multi_group_warning(caplog):
    """Multi-page mode is the expected shape — the ``claude_design_filter_
    multiple_artifact_groups`` warning must NOT fire here. (It's reserved for
    truly unusual single-canvas bundles with multiple Claude artifacts.)"""
    if not FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {FIXTURE_DIR}")

    ctx = _fake_ctx()
    with caplog.at_level("WARNING"):
        await stage_bundle_artifacts(
            ctx,
            bundle_id="abc",
            manifest=_fixture_manifest(),
            fetch_bytes=_make_fixture_fetch_bytes(),
        )

    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert all("multiple_artifact_groups" not in m for m in warnings), warnings
