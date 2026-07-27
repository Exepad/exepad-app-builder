"""Unit tests for the source rehydration service.

Self-host model: the runtime worker ships the prior build's sources inline in
the ``/r`` payload under ``source_files`` (relative source path → text). This
service maps each ``app_config`` repo entry's ``source`` to its bytes in that
dict and writes the corresponding ADK artifact. There is no GCS. Tests cover:

- ``_lookup_source`` path resolution edge cases.
- Rehydration of components, handlers, theme.css, compiled.css, seeds.
- App shape guards: no app_uuid, no styles marker, missing source paths.
- Missing source → empty stub for components; reported missing otherwise.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock

from main_agent.agents.orchestrator.app_types.webapp.services.source_rehydration_service import (
    _lookup_source,
    rehydrate_sources,
)

pytestmark = pytest.mark.unit


# ─────────────────────────────────────────────────────────────────────
# _lookup_source — inline payload resolution
# ─────────────────────────────────────────────────────────────────────


class TestLookupSource:
    def test_returns_bytes_for_known_path(self):
        files = {"code/frontend/components/X.tsx": "// x"}
        assert _lookup_source(files, "code/frontend/components/X.tsx") == b"// x"

    def test_passes_through_existing_bytes(self):
        files = {"a/b.csv": b"id\n1"}
        assert _lookup_source(files, "a/b.csv") == b"id\n1"

    def test_tolerates_leading_slash(self):
        files = {"code/x.tsx": "// x"}
        assert _lookup_source(files, "/code/x.tsx") == b"// x"

    def test_none_when_empty_source(self):
        assert _lookup_source({"a": "b"}, "") is None

    def test_none_when_absent(self):
        assert _lookup_source({}, "code/x.tsx") is None


# ─────────────────────────────────────────────────────────────────────
# rehydrate_sources — happy paths + guards
# ─────────────────────────────────────────────────────────────────────


_SOURCE_FILES = {
    "code/frontend/components/HomeContent_abc_v1.tsx": "// home",
    "code/frontend/components/MainHeader_def_v1.tsx": "// header",
    "code/backend/handlers/submitForm_ghi_v1.tsx": "// handler",
    "code/frontend/styles/theme.css": "body { }",
    "compiled/frontend/styles/compiled.css": ".x { }",
    "code/seed/users_jkl_v1.csv": "id\n1",
}


def _mock_ctx(source_files=None):
    """Build a MagicMock InvocationContext with a save-capturing artifact_service."""
    ctx = MagicMock()
    ctx.session.id = "sess-1"
    ctx.session.user_id = "user-1"
    ctx.session.app_name = "orchestrator"
    ctx.session.state = {"app_uuid": "app-uuid-123"}
    if source_files is not None:
        ctx.session.state["source_files"] = source_files
    ctx.artifact_service = MagicMock()
    ctx.artifact_service.save_artifact = AsyncMock(return_value=1)
    return ctx


def _saved_filenames(ctx) -> set:
    return {call.kwargs["filename"] for call in ctx.artifact_service.save_artifact.call_args_list}


_FULL_APP_CONFIG = {
    "repo": {
        "frontend": {
            "tailwindConfig": "theme.css",  # marker: app has Code Focus styles
            "components": {
                "HomeContent": {
                    "type": "code_component",
                    "source": "code/frontend/components/HomeContent_abc_v1.tsx",
                },
                "MainHeader": {
                    "type": "code_component",
                    "source": "code/frontend/components/MainHeader_def_v1.tsx",
                },
            },
        },
        "backend": {
            "handlers": {
                "submitForm": {
                    "source": "code/backend/handlers/submitForm_ghi_v1.tsx",
                },
            },
        },
        "seed": {
            "users": {"source": "code/seed/users_jkl_v1.csv"},
        },
    }
}


class TestRehydrateSources:
    @pytest.mark.asyncio
    async def test_rehydrates_all_asset_types_from_inline_sources(self):
        """Every asset class — components, handlers, styles, seeds — is saved."""
        ctx = _mock_ctx(source_files=_SOURCE_FILES)

        stats = await rehydrate_sources(ctx, _FULL_APP_CONFIG)

        # 2 components + 1 handler + 2 styles (theme + compiled) + 1 seed = 6
        assert stats["components_total"] == 2
        assert stats["components_rehydrated"] == 2
        assert stats["handlers_total"] == 1
        assert stats["handlers_rehydrated"] == 1
        assert stats["styles_total"] == 2
        assert stats["styles_rehydrated"] == 2
        assert stats["seeds_total"] == 1
        assert stats["seeds_rehydrated"] == 1

        assert ctx.artifact_service.save_artifact.call_count == 6
        assert _saved_filenames(ctx) == {
            "codefocus_component:HomeContent.tsx",
            "codefocus_component:MainHeader.tsx",
            "handler_code:submitForm.tsx",
            "codefocus_style:theme.css",
            "codefocus_style:compiled.css",
            "seed:users.csv",
        }

    @pytest.mark.asyncio
    async def test_styles_use_fixed_paths(self):
        """theme.css + compiled.css resolve from their fixed relative paths."""
        ctx = _mock_ctx(source_files=_SOURCE_FILES)

        stats = await rehydrate_sources(ctx, _FULL_APP_CONFIG)

        assert stats["styles_rehydrated"] == 2
        saved = _saved_filenames(ctx)
        assert "codefocus_style:theme.css" in saved
        assert "codefocus_style:compiled.css" in saved

    @pytest.mark.asyncio
    async def test_skips_styles_when_no_tailwind_config(self):
        """JSON-only apps without styles don't try to rehydrate theme.css."""
        ctx = _mock_ctx(source_files={"code/frontend/components/Plain_xyz_v1.tsx": "// p"})
        app_config = {
            "repo": {
                "frontend": {
                    # No tailwindConfig / styles marker
                    "components": {
                        "Plain": {"source": "code/frontend/components/Plain_xyz_v1.tsx"},
                    },
                },
            }
        }

        stats = await rehydrate_sources(ctx, app_config)

        assert stats["styles_total"] == 0
        assert stats["styles_rehydrated"] == 0
        saved = _saved_filenames(ctx)
        assert "codefocus_style:theme.css" not in saved
        assert "codefocus_style:compiled.css" not in saved

    @pytest.mark.asyncio
    async def test_missing_source_creates_stub_for_components(self):
        """A component absent from the payload is replaced with an empty stub
        so the editor can work with it; other asset types report missing."""
        files = dict(_SOURCE_FILES)
        del files["code/frontend/components/MainHeader_def_v1.tsx"]
        ctx = _mock_ctx(source_files=files)

        stats = await rehydrate_sources(ctx, _FULL_APP_CONFIG)

        # Stub was created, so both components count as rehydrated
        assert stats["components_rehydrated"] == 2
        assert stats["components_missing"] == 0
        assert stats["components_missing_names"] == []
        assert "MainHeader" in (ctx.session.state.get("_stubbed_components") or [])
        assert stats["handlers_rehydrated"] == 1
        assert stats["styles_rehydrated"] == 2
        assert stats["seeds_rehydrated"] == 1

    @pytest.mark.asyncio
    async def test_no_inline_sources_stubs_components_others_fail(self):
        """With no source_files at all, components get stubs (rehydrated) while
        handlers/styles/seeds are reported as missing."""
        ctx = _mock_ctx(source_files={})

        stats = await rehydrate_sources(ctx, _FULL_APP_CONFIG)

        assert stats["components_rehydrated"] == 2
        assert stats["components_missing"] == 0
        assert stats["components_missing_names"] == []
        assert stats["handlers_missing_names"] == ["submitForm"]
        assert stats["seeds_missing_names"] == ["users"]

    @pytest.mark.asyncio
    async def test_no_app_uuid_returns_empty_stats(self):
        """Without app_uuid there is nothing to address — return empty stats."""
        ctx = _mock_ctx(source_files=_SOURCE_FILES)
        ctx.session.state = {"source_files": _SOURCE_FILES}

        stats = await rehydrate_sources(ctx, {"repo": {"frontend": {"components": {}}}})

        assert stats["components_total"] == 0
        assert stats["handlers_total"] == 0
        assert stats["styles_total"] == 0
        assert stats["seeds_total"] == 0
        ctx.artifact_service.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_ignores_components_without_source(self):
        """Components missing the `source` field are skipped entirely."""
        ctx = _mock_ctx(source_files={})
        app_config = {
            "repo": {
                "frontend": {
                    "components": {
                        "Sourceless": {"type": "code_component"},
                    }
                }
            }
        }

        stats = await rehydrate_sources(ctx, app_config)

        assert stats["components_total"] == 0
        assert stats["components_rehydrated"] == 0
        ctx.artifact_service.save_artifact.assert_not_called()

    @pytest.mark.asyncio
    async def test_nothing_to_do_short_circuit(self):
        """Apps with zero assets produce a clean no-op."""
        ctx = _mock_ctx(source_files={})
        app_config = {"repo": {"frontend": {"components": {}}}}

        stats = await rehydrate_sources(ctx, app_config)

        for key, value in stats.items():
            if isinstance(value, list):
                assert value == [], f"{key} should be empty list, got {value}"
            else:
                assert value == 0, f"{key} should be 0, got {value}"
        ctx.artifact_service.save_artifact.assert_not_called()
