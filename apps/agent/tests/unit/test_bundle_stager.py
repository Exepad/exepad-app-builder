"""Tests for the design-bundle stager.

The stager turns a DesignBundle manifest into a set of ADK artifacts keyed
``bundle:<kind>:<relpath>`` plus a human-readable ``bundle:manifest.md``
index. No parsing, no semantic normalization — just fetch + save + render.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from main_agent.agents.orchestrator.importers.bundle_stager import (
    BUNDLE_SKILL_CONTEXT_STATE_KEY,
    _artifact_key,
    _describe_entry,
    _kind_for_entry,
    _mime_for_entry,
    _render_manifest_markdown,
    _SOURCE_TO_SKILL,
    stage_bundle_artifacts,
)

pytestmark = [pytest.mark.unit]


# ── Pure helpers ──────────────────────────────────────────────────────────


class TestMimeAndKindClassification:
    def test_mime_from_manifest_is_trusted(self):
        assert _mime_for_entry("x", "image/webp") == "image/webp"

    def test_mime_guessed_from_extension(self):
        assert _mime_for_entry("a.html", None) == "text/html"
        assert _mime_for_entry("page.md", None) == "text/markdown"
        assert _mime_for_entry("logo.png", None) == "image/png"
        assert _mime_for_entry("hero.JPEG", None) == "image/jpeg"
        assert _mime_for_entry("style.css", None) == "text/css"
        assert _mime_for_entry("fig.svg", None) == "image/svg+xml"
        assert _mime_for_entry("unknown.bin", None) == "application/octet-stream"

    def test_kind_classification(self):
        assert _kind_for_entry("p/code.html", "text/html") == "html"
        assert _kind_for_entry("p/screen.png", "image/png") == "asset"
        assert _kind_for_entry("theme/DESIGN.md", "text/markdown") == "doc"
        # Raw extension fallback for doc when MIME is generic.
        assert _kind_for_entry("notes.md", "text/plain") == "doc"
        assert _kind_for_entry("styles.css", "text/css") == "asset"

    def test_artifact_key_format(self):
        assert _artifact_key("html", "home_x/code.html") == "bundle:html:home_x/code.html"

    def test_source_to_skill_map(self):
        assert _SOURCE_TO_SKILL == {
            "stitch": "stitch-importer",
            "claude-design": "claude-design-importer",
        }


class TestDescribeEntry:
    def test_stitch_code_html_names_the_folder(self):
        d = _describe_entry("home_happydoods/code.html", "html", "text/html")
        assert "home_happydoods" in d

    def test_screenshot_explicitly_says_not_sent_to_llm(self):
        d = _describe_entry("home_happydoods/screen.png", "asset", "image/png")
        assert "screenshot" in d.lower()
        assert "not sent" in d.lower()

    def test_design_md(self):
        d = _describe_entry("harvest/DESIGN.md", "doc", "text/markdown")
        assert "design" in d.lower() or "notes" in d.lower()

    def test_template_prd(self):
        d = _describe_entry("product_requirements_document.html", "html", "text/html")
        assert "product requirements" in d.lower()


class TestManifestMarkdown:
    def test_renders_three_sections_when_populated(self):
        md = _render_manifest_markdown(
            bundle_id="abc",
            source="stitch",
            skill_name="stitch-importer",
            rows=[
                {
                    "key": "bundle:html:home_x/code.html",
                    "relpath": "home_x/code.html",
                    "mime": "text/html",
                    "description": "Page HTML",
                    "staged": "yes",
                },
                {
                    "key": "bundle:doc:theme/DESIGN.md",
                    "relpath": "theme/DESIGN.md",
                    "mime": "text/markdown",
                    "description": "Notes",
                    "staged": "yes",
                },
                {
                    "key": "bundle:asset:home_x/screen.png",
                    "relpath": "home_x/screen.png",
                    "mime": "image/png",
                    "description": "Screenshot",
                    "staged": "yes",
                },
            ],
        )
        assert "## HTML pages and documents" in md
        assert "## Author-written notes" in md
        assert "## Assets" in md
        assert "bundle:html:home_x/code.html" in md
        assert "stitch-importer" in md
        assert "`abc`" in md

    def test_omits_empty_sections(self):
        md = _render_manifest_markdown(
            bundle_id="abc",
            source="stitch",
            skill_name="stitch-importer",
            rows=[
                {
                    "key": "bundle:html:a/code.html",
                    "relpath": "a/code.html",
                    "mime": "text/html",
                    "description": "Page HTML",
                    "staged": "yes",
                },
            ],
        )
        assert "## HTML pages and documents" in md
        assert "## Author-written notes" not in md
        assert "## Assets" not in md


# ── Integration: stage_bundle_artifacts ───────────────────────────────────


def _fake_ctx():
    """Build a minimal InvocationContext-like stub."""
    artifact_service = SimpleNamespace(save_artifact=AsyncMock(return_value=1))
    session = SimpleNamespace(id="s1", user_id="u1", app_name="test-app")
    return SimpleNamespace(
        artifact_service=artifact_service,
        session=session,
    )


@pytest.mark.asyncio
async def test_stager_stages_all_manifest_entries_and_emits_manifest_md():
    ctx = _fake_ctx()

    # Fake fetch_bytes returning a stub blob per path.
    async def fetch_bytes(path: str) -> bytes:
        return f"content-of:{path}".encode()

    manifest = {
        "source": "stitch",
        "html_files": [
            {
                "archive_relpath": "home_happy/code.html",
                "gcs_path": "design-bundles/abc/home_happy/code.html",
                "mime": "text/html",
            },
            {
                "archive_relpath": "about_us_happy/code.html",
                "gcs_path": "design-bundles/abc/about_us_happy/code.html",
                "mime": "text/html",
            },
            {
                "archive_relpath": "our_products_happy/code.html",
                "gcs_path": "design-bundles/abc/our_products_happy/code.html",
                "mime": "text/html",
            },
            {
                "archive_relpath": "product_requirements_document.html",
                "gcs_path": "design-bundles/abc/product_requirements_document.html",
                "mime": "text/html",
            },
        ],
        "asset_refs": {
            "home_happy/screen.png": {
                "gcs_path": "design-bundles/abc/home_happy/screen.png",
                "mime": "image/png",
            },
            "harvest_hearth/DESIGN.md": {
                "gcs_path": "design-bundles/abc/harvest_hearth/DESIGN.md",
                "mime": "text/markdown",
            },
        },
    }

    result = await stage_bundle_artifacts(
        ctx,
        bundle_id="abc",
        manifest=manifest,
        fetch_bytes=fetch_bytes,
    )

    assert result["bundle_source"] == "stitch"
    assert result["bundle_id"] == "abc"
    assert result["skill_name"] == "stitch-importer"
    assert result["manifest_artifact"] == "bundle:manifest.md"
    assert result["staged_count"] == 6  # 4 html + 2 assets

    # Every file + the manifest.md should have been saved.
    saved_keys = [
        call.kwargs["filename"] for call in ctx.artifact_service.save_artifact.call_args_list
    ]
    assert "bundle:html:home_happy/code.html" in saved_keys
    assert "bundle:html:about_us_happy/code.html" in saved_keys
    assert "bundle:html:our_products_happy/code.html" in saved_keys
    # PRD is HTML so it also lands in the html namespace.
    assert "bundle:html:product_requirements_document.html" in saved_keys
    assert "bundle:asset:home_happy/screen.png" in saved_keys
    assert "bundle:doc:harvest_hearth/DESIGN.md" in saved_keys
    assert "bundle:manifest.md" in saved_keys


@pytest.mark.asyncio
async def test_stager_stages_css_js_and_other_helpers_alongside_html():
    """Production regression: bundle 85356947-… shipped a styles.css that
    the backend categorized into ``manifest["css_files"]`` (not
    ``html_files`` or ``asset_refs``). The original stager only iterated
    ``html_files`` + ``asset_refs``, silently dropping every .css/.js/.md
    helper. This made ``bundle:asset:styles.css`` non-existent at runtime,
    so the Claude Design handler could not harvest ``--barn`` / ``--cream``
    pillar tokens and the runner aborted between BackendBuilder and
    ComponentBuilder.

    The fix iterates every helper bucket the backend's
    ``archive_ingestion_service._classify`` may produce (``html_files``,
    ``css_files``, ``js_files``, ``other_helpers``) plus ``asset_refs``.
    """
    ctx = _fake_ctx()

    async def fetch_bytes(path: str) -> bytes:
        return f"content-of:{path}".encode()

    manifest = {
        "source": "claude-design",
        "html_files": [
            {
                "archive_relpath": "index.html",
                "gcs_path": "design-bundles/abc/index.html",
                "mime": "text/html",
            },
        ],
        # The bucket the original stager ignored.
        "css_files": [
            {
                "archive_relpath": "styles.css",
                "gcs_path": "design-bundles/abc/styles.css",
                "mime": "text/css",
            },
        ],
        "js_files": [
            {
                "archive_relpath": "main.js",
                "gcs_path": "design-bundles/abc/main.js",
                "mime": "application/javascript",
            },
        ],
        "other_helpers": [
            {
                "archive_relpath": "DESIGN.md",
                "gcs_path": "design-bundles/abc/DESIGN.md",
                "mime": "text/markdown",
            },
        ],
        "asset_refs": {
            "img/hero.png": {
                "gcs_path": "design-bundles/abc/img/hero.png",
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
    # The smoking gun: styles.css now lands at the key the Claude Design
    # handler's ``_discover_shared_stylesheet`` looks for.
    assert "bundle:asset:styles.css" in saved_keys
    # Every other helper bucket also stages.
    assert "bundle:html:index.html" in saved_keys
    assert "bundle:asset:main.js" in saved_keys
    assert "bundle:doc:DESIGN.md" in saved_keys  # mime=text/markdown → doc
    assert "bundle:asset:img/hero.png" in saved_keys

    # 1 html + 1 css + 1 js + 1 doc + 1 image = 5 files.
    assert result["staged_count"] == 5


@pytest.mark.asyncio
async def test_stager_handles_fetch_failure_gracefully():
    ctx = _fake_ctx()

    fetched: list[str] = []

    async def fetch_bytes(path: str) -> bytes:
        fetched.append(path)
        if "fail" in path:
            raise RuntimeError("simulated GCS error")
        return b"ok"

    manifest = {
        "source": "stitch",
        "html_files": [
            {
                "archive_relpath": "fail/code.html",
                "gcs_path": "design-bundles/abc/fail/code.html",
                "mime": "text/html",
            },
            {
                "archive_relpath": "ok/code.html",
                "gcs_path": "design-bundles/abc/ok/code.html",
                "mime": "text/html",
            },
        ],
        "asset_refs": {},
    }

    result = await stage_bundle_artifacts(
        ctx,
        bundle_id="abc",
        manifest=manifest,
        fetch_bytes=fetch_bytes,
    )

    # Only 1 file staged — the failing one recorded in manifest.md with
    # staged=no, but no artifact saved for it.
    assert result["staged_count"] == 1
    saved_keys = [
        call.kwargs["filename"] for call in ctx.artifact_service.save_artifact.call_args_list
    ]
    assert "bundle:html:ok/code.html" in saved_keys
    assert "bundle:html:fail/code.html" not in saved_keys
    assert "bundle:manifest.md" in saved_keys


@pytest.mark.asyncio
async def test_stager_returns_empty_when_no_entries():
    ctx = _fake_ctx()

    async def fetch_bytes(path: str) -> bytes:
        return b""

    result = await stage_bundle_artifacts(
        ctx,
        bundle_id="empty",
        manifest={"source": "stitch", "html_files": [], "asset_refs": {}},
        fetch_bytes=fetch_bytes,
    )
    assert result == {}
    # No manifest.md when nothing staged.
    ctx.artifact_service.save_artifact.assert_not_called()


@pytest.mark.asyncio
async def test_stager_unknown_source_leaves_skill_name_empty():
    ctx = _fake_ctx()

    async def fetch_bytes(path: str) -> bytes:
        return b"ok"

    result = await stage_bundle_artifacts(
        ctx,
        bundle_id="x",
        manifest={
            "source": "unknown-format",
            "html_files": [
                {
                    "archive_relpath": "a.html",
                    "gcs_path": "design-bundles/x/a.html",
                    "mime": "text/html",
                }
            ],
            "asset_refs": {},
        },
        fetch_bytes=fetch_bytes,
    )
    assert result["bundle_source"] == "unknown-format"
    assert result["skill_name"] == ""


def test_skill_context_state_key_is_stable():
    # Downstream (PreCreator, digester) relies on this exact key.
    assert BUNDLE_SKILL_CONTEXT_STATE_KEY == "design_bundle_skill_context"
