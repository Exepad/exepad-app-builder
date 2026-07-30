"""Tests for post-import image materialization."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from google import genai

from main_agent.agents.orchestrator.importers import design_importer as importer

pytestmark = [pytest.mark.unit]


def _part(data: bytes | str, mime: str):
    if isinstance(data, str):
        data = data.encode("utf-8")
    return genai.types.Part.from_bytes(data=data, mime_type=mime)


class _ArtifactService:
    def __init__(self, artifacts: dict[str, object]):
        self.artifacts = artifacts

    async def list_artifact_keys(self, **_kwargs):
        return list(self.artifacts.keys())

    async def load_artifact(self, *, filename: str, **_kwargs):
        return self.artifacts.get(filename)

    async def save_artifact(self, *, filename: str, artifact, **_kwargs):
        self.artifacts[filename] = artifact
        return 0


def _ctx(artifacts: dict[str, object]):
    return SimpleNamespace(
        session=SimpleNamespace(
            id="s1",
            user_id="u1",
            app_name="agent",
            state={},
        ),
        artifact_service=_ArtifactService(artifacts),
    )


@pytest.mark.asyncio
async def test_materializer_rewrites_external_images(monkeypatch):
    artifacts = {
        "content::page.html": _part(
            '<section><img src="https://cdn.example/hero.png" alt="Hero"></section>',
            "text/html",
        )
    }
    ctx = _ctx(artifacts)
    uploads: list[dict] = []

    async def fake_download(url: str):
        assert url == "https://cdn.example/hero.png"
        return b"png-bytes", "image/png"

    async def fake_upload(**kwargs):
        uploads.append(kwargs)

    monkeypatch.setattr(importer, "_download_external_image", fake_download)
    monkeypatch.setattr(importer, "_upload_design_import_asset", fake_upload)

    rewritten = await importer.materialize_design_import_images(ctx, "app1")

    assert rewritten == 1
    assert uploads and uploads[0]["relpath"].startswith("imports/")
    html = artifacts["content::page.html"].inline_data.data.decode("utf-8")
    assert 'data-asset-relpath="imports/' in html
    assert 'data-source-url="https://cdn.example/hero.png"' in html
    assert 'src=""' in html
    assert "url:https://cdn.example/hero.png" in ctx.session.state["_design_import_assets"]

    manifest = json.loads(
        artifacts["design_import/asset-manifest.json"].inline_data.data.decode("utf-8")
    )
    assert manifest["failures"] == []
    assert manifest["processed_artifacts"] == ["content::page.html"]


@pytest.mark.asyncio
async def test_materializer_rewrites_bundle_relative_images(monkeypatch):
    artifacts = {
        "content::page.html": _part(
            '<main><img src="assets/hero.png" alt="Hero"></main>',
            "text/html",
        ),
        "bundle:asset:stitch/assets/hero.png": _part(b"png-bytes", "image/png"),
    }
    ctx = _ctx(artifacts)
    uploads: list[dict] = []

    async def fake_upload(**kwargs):
        uploads.append(kwargs)

    monkeypatch.setattr(importer, "_upload_design_import_asset", fake_upload)

    rewritten = await importer.materialize_design_import_images(ctx, "app1")

    assert rewritten == 1
    assert uploads and uploads[0]["relpath"].startswith("imports/")
    html = artifacts["content::page.html"].inline_data.data.decode("utf-8")
    assert 'data-asset-relpath="imports/' in html
    assert 'data-source-path="assets/hero.png"' in html
    assert 'src=""' in html

    registry = ctx.session.state["_design_import_assets"]
    entry = registry["bundle:assets/hero.png"]
    assert entry["source_artifact"] == "bundle:asset:stitch/assets/hero.png"
