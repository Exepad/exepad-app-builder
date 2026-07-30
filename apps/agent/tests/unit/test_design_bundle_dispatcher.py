"""Tests for the new skill-based importer dispatcher.

The dispatcher is tiny: it fetches the manifest, calls the stager, and
stashes a skill-context pointer on session state. No NormalizedSource,
no Python readers.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from main_agent.agents.orchestrator.importers import dispatcher
from main_agent.agents.orchestrator.importers.bundle_stager import (
    BUNDLE_SKILL_CONTEXT_STATE_KEY,
)

pytestmark = [pytest.mark.unit]


def _fake_ctx():
    return SimpleNamespace(
        artifact_service=SimpleNamespace(save_artifact=AsyncMock(return_value=1)),
        session=SimpleNamespace(id="s", user_id="u", app_name="a"),
    )


class TestDispatchBundle:
    @pytest.mark.asyncio
    async def test_returns_none_when_bundle_id_empty(self):
        ctx = _fake_ctx()
        result = await dispatcher.dispatch_design_bundle(ctx, design_bundle_id="")
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_manifest_fetch_fails(self):
        ctx = _fake_ctx()
        with patch(
            "main_agent.agents.orchestrator.importers.dispatcher.fetch_bundle_manifest",
            new=AsyncMock(return_value=None),
        ):
            result = await dispatcher.dispatch_design_bundle(ctx, design_bundle_id="abc")
        assert result is None

    @pytest.mark.asyncio
    async def test_returns_none_when_manifest_is_malformed(self):
        ctx = _fake_ctx()
        with patch(
            "main_agent.agents.orchestrator.importers.dispatcher.fetch_bundle_manifest",
            new=AsyncMock(return_value={"manifest": "not-a-dict"}),
        ):
            result = await dispatcher.dispatch_design_bundle(ctx, design_bundle_id="abc")
        assert result is None

    @pytest.mark.asyncio
    async def test_stages_and_returns_skill_context(self):
        ctx = _fake_ctx()

        async def fetch_bytes(path: str) -> bytes:
            return b"x"

        manifest_response = {
            "source": "stitch",
            "manifest": {
                "html_files": [
                    {
                        "archive_relpath": "home_x/code.html",
                        "gcs_path": "design-bundles/abc/home_x/code.html",
                        "mime": "text/html",
                    }
                ],
                "asset_refs": {},
            },
        }
        with patch(
            "main_agent.agents.orchestrator.importers.dispatcher.fetch_bundle_manifest",
            new=AsyncMock(return_value=manifest_response),
        ):
            result = await dispatcher.dispatch_design_bundle(
                ctx,
                design_bundle_id="abc",
                fetch_bytes=fetch_bytes,
            )

        assert result is not None
        assert result["bundle_source"] == "stitch"
        assert result["skill_name"] == "stitch-importer"
        assert result["bundle_id"] == "abc"
        assert result["staged_count"] == 1

    @pytest.mark.asyncio
    async def test_stash_skill_context_on_session_state(self):
        state: dict = {}
        skill_context = {
            "bundle_source": "stitch",
            "bundle_id": "abc",
            "skill_name": "stitch-importer",
            "manifest_artifact": "bundle:manifest.md",
            "staged_count": 3,
        }
        dispatcher.stash_skill_context_on_session_state(state, skill_context)
        assert state[BUNDLE_SKILL_CONTEXT_STATE_KEY] == skill_context
        assert state[dispatcher.CREATION_INPUT_MODALITY_KEY] == "design_bundle"
