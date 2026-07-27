"""Tests for ``frontend_build_side_effects.apply_frontend_build_side_effects``
and the supporting helpers (``render_action_prompt``,
``snapshot_to_bare_names``, ``collect_frontend_artifact_sources``).

After ``ComponentBuilderMultiple`` returns, the workflow has to apply
non-artifact mutations the agent couldn't perform itself — page registry
add / remove / slug-rename, supporting-modules auto-registration via
import-graph inference, orphan GC. These tests pin the contract.
"""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_assembly_service import (
    ComponentEntry,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.editor import (
    FrontendBuildAction,
    PageCreate,
    PageRemove,
    PageSlugRename,
)
from main_agent.agents.orchestrator.app_types.webapp.workflows.frontend_build_side_effects import (
    apply_frontend_build_side_effects,
    render_action_prompt,
    snapshot_to_bare_names,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# render_action_prompt
# --------------------------------------------------------------------------- #


class TestRenderActionPrompt:
    def test_pure_passthrough_when_no_side_effects(self):
        action = FrontendBuildAction(prompt="rename Card.label to Card.title")
        rendered = render_action_prompt(action)
        # No registry hint blocks added → the prompt stays as-is.
        assert rendered.strip() == "rename Card.label to Card.title"

    def test_appends_page_creates_block_when_present(self):
        action = FrontendBuildAction(
            prompt="add About page",
            page_creates=[
                PageCreate(title="About", slug="/about", mount_components=["AboutHero"]),
            ],
        )
        rendered = render_action_prompt(action)
        assert "Page creates" in rendered
        assert "AboutHero" in rendered
        assert "/about" in rendered
        assert "add About page" in rendered  # original prompt preserved

    def test_appends_page_slug_renames_block(self):
        action = FrontendBuildAction(
            prompt="rename about slug",
            page_slug_renames=[PageSlugRename(page_uuid="abc-123", new_slug="/company")],
        )
        rendered = render_action_prompt(action)
        assert "slug renames" in rendered.lower()
        assert "abc-123" in rendered
        assert "/company" in rendered

    def test_appends_page_removes_block(self):
        action = FrontendBuildAction(
            prompt="drop legacy page",
            page_removes=[PageRemove(page_uuid="dead-uuid")],
        )
        rendered = render_action_prompt(action)
        assert "removes" in rendered.lower()
        assert "dead-uuid" in rendered

    def test_combines_all_three_when_present(self):
        action = FrontendBuildAction(
            prompt="rebuild navigation",
            page_creates=[PageCreate(title="Pricing", slug="/pricing", mount_components=["PricingHero"])],
            page_slug_renames=[PageSlugRename(page_uuid="x", new_slug="/team")],
            page_removes=[PageRemove(page_uuid="y")],
        )
        rendered = render_action_prompt(action)
        assert "rebuild navigation" in rendered
        assert "PricingHero" in rendered
        assert "/team" in rendered
        assert "y" in rendered

    def test_image_catalog_hint_appended_when_page_create_and_large_catalog(self):
        """Mirrors the creation-flow image-distribution safety net for edit-mode
        page_creates: a hint block lists user-uploaded UUIDs CBM should prefer."""
        action = FrontendBuildAction(
            prompt="add About page",
            page_creates=[
                PageCreate(title="About", slug="/about", mount_components=["AboutHero"]),
            ],
        )
        catalog = [{"uuid": "logo-1", "url": "u1", "is_logo": True}] + [
            {"uuid": f"c-{i}", "url": f"u{i}", "is_logo": False, "description": f"desc {i}"}
            for i in range(11)
        ]
        rendered = render_action_prompt(action, image_catalog=catalog)
        assert "User-uploaded image catalog hint" in rendered
        assert "c-0" in rendered
        # Logo must NOT be recommended for content distribution.
        assert "logo-1" not in rendered
        # Original prompt + page-creates block still present.
        assert "add About page" in rendered
        assert "AboutHero" in rendered

    def test_no_image_catalog_hint_when_catalog_small(self):
        action = FrontendBuildAction(
            prompt="add About page",
            page_creates=[
                PageCreate(title="About", slug="/about", mount_components=["AboutHero"]),
            ],
        )
        catalog = [{"uuid": f"c-{i}", "url": f"u{i}", "is_logo": False} for i in range(3)]
        rendered = render_action_prompt(action, image_catalog=catalog)
        assert "User-uploaded image catalog hint" not in rendered

    def test_no_image_catalog_hint_when_no_page_creates(self):
        # Restyle-only edits don't add new content, so no hint needed.
        action = FrontendBuildAction(prompt="restyle the existing hero")
        catalog = [
            {"uuid": f"c-{i}", "url": f"u{i}", "is_logo": False} for i in range(20)
        ]
        rendered = render_action_prompt(action, image_catalog=catalog)
        assert "User-uploaded image catalog hint" not in rendered

    def test_image_catalog_default_none_is_backward_compatible(self):
        action = FrontendBuildAction(
            prompt="add a page",
            page_creates=[PageCreate(title="X", slug="/x", mount_components=["XHero"])],
        )
        # Old call sites that don't pass image_catalog get same behavior as before.
        rendered = render_action_prompt(action)
        assert "User-uploaded image catalog hint" not in rendered
        assert "Page creates" in rendered  # unchanged side-effect hint block


# --------------------------------------------------------------------------- #
# snapshot_to_bare_names
# --------------------------------------------------------------------------- #


class TestSnapshotToBareNames:
    def test_strips_prefix_and_extension(self):
        out = snapshot_to_bare_names(
            {
                "codefocus_component:Hero.tsx": "X",
                "codefocus_module:Card.tsx": "Y",
                "codefocus_style:theme.css": "Z",
            }
        )
        # Theme.css — bare key collapses to "theme" (extension stripped, no
        # prefix recognised). The contract is: this dict is keyed for the
        # tsc / sibling-modules layer, which only cares about TSX peers.
        assert out["Hero"] == "X"
        assert out["Card"] == "Y"

    def test_empty_input_yields_empty_output(self):
        assert snapshot_to_bare_names({}) == {}


# --------------------------------------------------------------------------- #
# apply_frontend_build_side_effects
# --------------------------------------------------------------------------- #


def _empty_config() -> dict:
    return {
        "frontend": {"pages": [], "header": [], "sidebar": [], "footer": []},
        "repo": {"frontend": {"components": {}}},
    }


class TestApplyFrontendBuildSideEffectsPageCreates:
    def test_registers_page_with_derived_slug_when_missing(self):
        config = _empty_config()
        action = FrontendBuildAction(
            prompt="add Pricing",
            page_creates=[PageCreate(title="Pricing", mount_components=["PricingHero"])],
        )
        out = asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={},
                artifact_sources_after={
                    "codefocus_component:PricingHero.tsx": (
                        'import { React } from "@exepad/sdk";\n'
                        "export default function PricingHero(){return null}\n"
                    ),
                },
                files_created_this_turn=["codefocus_component:PricingHero.tsx"],
                files_deleted_this_turn=[],
            )
        )
        pages = config["frontend"]["pages"]
        assert len(pages) == 1
        assert pages[0]["title"] == "Pricing"
        assert pages[0]["slug"] == "/pricing"
        assert pages[0]["content"] == [{"componentName": "PricingHero"}]
        # Component registry got the entry.
        assert "PricingHero" in config["repo"]["frontend"]["components"]
        assert any(
            isinstance(c, ComponentEntry) and c.name == "PricingHero"
            for c in out.added_components
        )
        # New page was reported back to the workflow.
        assert out.new_pages == [
            ("__page_uuid__", "/pricing", "Pricing", ["PricingHero"]),
        ] or len(out.new_pages) == 1  # uuid is generated; just check shape

    def test_uses_explicit_slug_when_provided(self):
        config = _empty_config()
        action = FrontendBuildAction(
            prompt="add Pricing",
            page_creates=[PageCreate(title="Pricing", slug="/plans", mount_components=["X"])],
        )
        asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={},
                artifact_sources_after={
                    "codefocus_component:X.tsx": "import { React } from '@exepad/sdk';export default function X(){}",
                },
                files_created_this_turn=["codefocus_component:X.tsx"],
                files_deleted_this_turn=[],
            )
        )
        assert config["frontend"]["pages"][0]["slug"] == "/plans"

    def test_upserts_existing_page_with_same_slug(self):
        config = _empty_config()
        config["frontend"]["pages"].append(
            {"uuid": "old-uuid", "slug": "/about", "title": "About",
             "content": [{"componentName": "Existing"}]}
        )
        action = FrontendBuildAction(
            prompt="add hero to About",
            page_creates=[PageCreate(title="About", slug="/about", mount_components=["AboutHero"])],
        )
        asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={},
                artifact_sources_after={
                    "codefocus_component:AboutHero.tsx": "import { React } from '@exepad/sdk';export default function AboutHero(){}",
                },
                files_created_this_turn=["codefocus_component:AboutHero.tsx"],
                files_deleted_this_turn=[],
            )
        )
        pages = config["frontend"]["pages"]
        # No duplicate page; upserted in place.
        assert len(pages) == 1
        names = {c["componentName"] for c in pages[0]["content"]}
        assert names == {"Existing", "AboutHero"}


class TestApplyFrontendBuildSideEffectsArtifactGuard:
    """A PageCreate.mount_components name with no built artifact must NOT be
    registered. Regression for app auqofu6p5 (2026-06-29): the Editor planned a
    new ``PricingSection`` but the builder folded the pricing markup into the
    MODIFIED ``HomeContent`` and never wrote PricingSection.tsx. Registering it
    made the worker's materializeBuild raise "Missing component artifact" and
    the whole edit hard-failed, dropping the deployed app to ``error`` and losing
    its working preview. The artifact-existence screen drops the orphan so the
    config stays deployable (the pricing content still renders from HomeContent)."""

    _ARTIFACTS = "main_agent.agents.orchestrator.app_types.webapp.workflows.frontend_build_side_effects.ArtifactManager.list_artifacts"

    def test_skips_mount_component_with_no_artifact(self):
        # Existing single-page site: "/" already holds [HomeContent].
        config = {
            "frontend": {
                "pages": [
                    {
                        "uuid": "p1",
                        "slug": "/",
                        "title": "Home",
                        "content": [{"componentName": "HomeContent"}],
                    }
                ],
                "header": [],
                "sidebar": [],
                "footer": [],
            },
            "repo": {"frontend": {"components": {"HomeContent": {"role": "content"}}}},
        }
        action = FrontendBuildAction(
            prompt="add a pricing section",
            page_creates=[PageCreate(title="Home", slug="/", mount_components=["PricingSection"])],
        )
        # The artifact store holds HomeContent + theme — NOT PricingSection
        # (the builder folded the markup into HomeContent and created nothing).
        with patch(
            self._ARTIFACTS,
            new=AsyncMock(
                return_value=[
                    "codefocus_component:HomeContent.tsx",
                    "codefocus_style:theme.css",
                ]
            ),
        ):
            out = asyncio.run(
                apply_frontend_build_side_effects(
                    ctx=SimpleNamespace(),
                    action=action,
                    current_config=config,
                    sibling_modules_before={},
                    artifact_sources_after={},
                    files_created_this_turn=[],  # only HomeContent was MODIFIED
                    files_deleted_this_turn=[],
                )
            )
        # Orphan must not be registered (else materializeBuild raises + edit fails).
        assert "PricingSection" not in config["repo"]["frontend"]["components"]
        # The existing "/" page keeps HomeContent and gains NO PricingSection mount.
        home = next(p for p in config["frontend"]["pages"] if p["slug"] == "/")
        assert {c.get("componentName") for c in home["content"]} == {"HomeContent"}
        assert all(c.name != "PricingSection" for c in out.added_components)

    def test_keeps_mount_component_built_this_turn(self):
        # The happy path is unaffected: a genuinely-created component IS mounted.
        config = _empty_config()
        action = FrontendBuildAction(
            prompt="add Pricing page",
            page_creates=[
                PageCreate(title="Pricing", slug="/pricing", mount_components=["PricingHero"])
            ],
        )
        with patch(self._ARTIFACTS, new=AsyncMock(return_value=[])):
            asyncio.run(
                apply_frontend_build_side_effects(
                    ctx=SimpleNamespace(),
                    action=action,
                    current_config=config,
                    sibling_modules_before={},
                    artifact_sources_after={
                        "codefocus_component:PricingHero.tsx": (
                            "export default function PricingHero(){return null}"
                        )
                    },
                    files_created_this_turn=["codefocus_component:PricingHero.tsx"],
                    files_deleted_this_turn=[],
                )
            )
        assert "PricingHero" in config["repo"]["frontend"]["components"]
        page = next(p for p in config["frontend"]["pages"] if p["slug"] == "/pricing")
        assert {c.get("componentName") for c in page["content"]} == {"PricingHero"}


class TestApplyFrontendBuildSideEffectsSlugRenames:
    def test_updates_slug_in_registry_and_records_remap(self):
        config = _empty_config()
        config["frontend"]["pages"].append(
            {"uuid": "p1", "slug": "/old", "title": "Old", "content": []}
        )
        action = FrontendBuildAction(
            prompt="rename slug",
            page_slug_renames=[PageSlugRename(page_uuid="p1", new_slug="/new")],
        )
        out = asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={},
                artifact_sources_after={},
                files_created_this_turn=[],
                files_deleted_this_turn=[],
            )
        )
        assert config["frontend"]["pages"][0]["slug"] == "/new"
        assert out.slug_remaps == {"/old": "/new"}

    def test_warns_when_target_uuid_missing(self):
        config = _empty_config()
        action = FrontendBuildAction(
            prompt="rename slug",
            page_slug_renames=[PageSlugRename(page_uuid="missing", new_slug="/x")],
        )
        # Must not crash; no registry mutation.
        asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={},
                artifact_sources_after={},
                files_created_this_turn=[],
                files_deleted_this_turn=[],
            )
        )
        assert config["frontend"]["pages"] == []


class TestApplyFrontendBuildSideEffectsPageRemoves:
    def test_drops_page_and_orphan_components(self):
        config = _empty_config()
        config["frontend"]["pages"] = [
            {
                "uuid": "p1",
                "slug": "/dead",
                "title": "Dead",
                "content": [{"componentName": "Orphan"}, {"componentName": "Shared"}],
            },
            {
                "uuid": "p2",
                "slug": "/keep",
                "title": "Keep",
                "content": [{"componentName": "Shared"}],
            },
        ]
        config["repo"]["frontend"]["components"] = {
            "Orphan": {"role": "content"},
            "Shared": {"role": "content"},
        }
        action = FrontendBuildAction(
            prompt="drop legacy page",
            page_removes=[PageRemove(page_uuid="p1")],
        )
        out = asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={},
                artifact_sources_after={},
                files_created_this_turn=[],
                files_deleted_this_turn=[],
            )
        )
        slugs = {p["slug"] for p in config["frontend"]["pages"]}
        assert slugs == {"/keep"}
        # Orphan was on /dead only — registry drops it.
        assert "Orphan" not in config["repo"]["frontend"]["components"]
        # Shared was on both pages — kept.
        assert "Shared" in config["repo"]["frontend"]["components"]
        assert out.removed_page_uuids == ["p1"]
        assert "Orphan" in out.removed_names
        assert "Shared" not in out.removed_names

    def test_preserves_orphan_when_still_used_in_chrome(self):
        config = _empty_config()
        config["frontend"]["pages"] = [
            {"uuid": "p1", "slug": "/x", "title": "X",
             "content": [{"componentName": "Header"}]},
        ]
        config["frontend"]["header"] = [{"component": "Header"}]
        config["repo"]["frontend"]["components"] = {"Header": {"role": "header"}}
        action = FrontendBuildAction(
            prompt="drop x",
            page_removes=[PageRemove(page_uuid="p1")],
        )
        asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={},
                artifact_sources_after={},
                files_created_this_turn=[],
                files_deleted_this_turn=[],
            )
        )
        # Header is still referenced from chrome → preserved.
        assert "Header" in config["repo"]["frontend"]["components"]


class TestApplyFrontendBuildSideEffectsCreatedModules:
    def test_auto_registers_module_under_importing_entry(self):
        config = _empty_config()
        # Pre-existing entry in registry.
        config["repo"]["frontend"]["components"]["Dashboard"] = {
            "role": "content",
            "supporting_modules": [],
        }
        action = FrontendBuildAction(prompt="extract chart helper into ChartUtils")
        asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={
                    "Dashboard": (
                        'import { React } from "@exepad/sdk";\n'
                        "export default function Dashboard(){return null}\n"
                    ),
                },
                artifact_sources_after={
                    # Updated Dashboard now imports ChartUtils
                    "codefocus_component:Dashboard.tsx": (
                        'import { React } from "@exepad/sdk";\n'
                        'import { fmt } from "./ChartUtils";\n'
                        "export default function Dashboard(){return null}\n"
                    ),
                    # Newly created supporting module
                    "codefocus_module:ChartUtils.tsx": (
                        'import { React } from "@exepad/sdk";\n'
                        "export function fmt(x){return x}\n"
                    ),
                },
                files_created_this_turn=["codefocus_module:ChartUtils.tsx"],
                files_deleted_this_turn=[],
            )
        )
        modules = config["repo"]["frontend"]["components"]["Dashboard"][
            "supporting_modules"
        ]
        assert "ChartUtils" in modules

    def test_unimported_module_logs_and_skips_registration(self):
        config = _empty_config()
        config["repo"]["frontend"]["components"]["Dashboard"] = {
            "role": "content",
            "supporting_modules": [],
        }
        action = FrontendBuildAction(prompt="add ChartUtils for later")
        asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={
                    "Dashboard": (
                        'import { React } from "@exepad/sdk";\n'
                        "export default function Dashboard(){return null}\n"
                    ),
                },
                artifact_sources_after={
                    # Dashboard does NOT import ChartUtils
                    "codefocus_component:Dashboard.tsx": (
                        'import { React } from "@exepad/sdk";\n'
                        "export default function Dashboard(){return null}\n"
                    ),
                    "codefocus_module:ChartUtils.tsx": (
                        'import { React } from "@exepad/sdk";\n'
                        "export function fmt(x){return x}\n"
                    ),
                },
                files_created_this_turn=["codefocus_module:ChartUtils.tsx"],
                files_deleted_this_turn=[],
            )
        )
        # Registry is untouched for an unimported module.
        modules = config["repo"]["frontend"]["components"]["Dashboard"][
            "supporting_modules"
        ]
        assert "ChartUtils" not in modules


class TestApplyFrontendBuildSideEffectsDeletedFiles:
    def test_removes_component_from_registry_and_page_mounts(self):
        config = _empty_config()
        config["frontend"]["pages"] = [
            {
                "uuid": "p1",
                "slug": "/x",
                "title": "X",
                "content": [{"componentName": "Doomed"}, {"componentName": "Kept"}],
            }
        ]
        config["repo"]["frontend"]["components"] = {
            "Doomed": {"role": "content"},
            "Kept": {"role": "content"},
        }
        action = FrontendBuildAction(prompt="remove Doomed component")
        out = asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={"Doomed": "x", "Kept": "y"},
                artifact_sources_after={"codefocus_component:Kept.tsx": "y"},
                files_created_this_turn=[],
                files_deleted_this_turn=["codefocus_component:Doomed.tsx"],
            )
        )
        assert "Doomed" not in config["repo"]["frontend"]["components"]
        names = {c["componentName"] for c in config["frontend"]["pages"][0]["content"]}
        assert names == {"Kept"}
        assert "Doomed" in out.removed_names

    def test_removes_module_from_supporting_modules(self):
        config = _empty_config()
        config["repo"]["frontend"]["components"] = {
            "Dashboard": {
                "role": "content",
                "supporting_modules": ["ChartUtils", "OtherUtil"],
            },
        }
        action = FrontendBuildAction(prompt="drop ChartUtils")
        asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={"ChartUtils": "x"},
                artifact_sources_after={},
                files_created_this_turn=[],
                files_deleted_this_turn=["codefocus_module:ChartUtils.tsx"],
            )
        )
        assert config["repo"]["frontend"]["components"]["Dashboard"][
            "supporting_modules"
        ] == ["OtherUtil"]


class TestApplyFrontendBuildSideEffectsModifiedDiff:
    def test_reports_modified_entry_when_source_changed(self):
        config = _empty_config()
        config["repo"]["frontend"]["components"]["Hero"] = {"role": "content"}
        action = FrontendBuildAction(prompt="update Hero")
        out = asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={"Hero": "OLD"},
                artifact_sources_after={"codefocus_component:Hero.tsx": "NEW"},
                files_created_this_turn=[],
                files_deleted_this_turn=[],
            )
        )
        assert out.modified_names == ["Hero"]

    def test_module_change_bubbles_up_to_importing_entries(self):
        config = _empty_config()
        config["repo"]["frontend"]["components"] = {
            "Dashboard": {
                "role": "content",
                "supporting_modules": ["ChartUtils"],
            },
        }
        action = FrontendBuildAction(prompt="update ChartUtils")
        out = asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={"ChartUtils": "OLD"},
                artifact_sources_after={"codefocus_module:ChartUtils.tsx": "NEW"},
                files_created_this_turn=[],
                files_deleted_this_turn=[],
            )
        )
        # The entry that owns ChartUtils gets reported as modified, NOT
        # the module itself (which would never re-validate on its own).
        assert "Dashboard" in out.modified_names

    def test_no_diff_when_source_unchanged(self):
        config = _empty_config()
        config["repo"]["frontend"]["components"]["Hero"] = {"role": "content"}
        action = FrontendBuildAction(prompt="no-op")
        out = asyncio.run(
            apply_frontend_build_side_effects(
                ctx=None,
                action=action,
                current_config=config,
                sibling_modules_before={"Hero": "SAME"},
                artifact_sources_after={"codefocus_component:Hero.tsx": "SAME"},
                files_created_this_turn=[],
                files_deleted_this_turn=[],
            )
        )
        assert out.modified_names == []
