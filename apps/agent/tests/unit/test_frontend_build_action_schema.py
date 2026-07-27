"""Regression tests for the new editor schema.

Locks in the Phase B 8-action shape and the field-level invariants on
``FrontendBuildAction``, ``RenamePageTitleAction``, and the side-effect
sub-models (``PageCreate`` / ``PageRemove`` / ``PageSlugRename``).

These tests are the safety net against silent re-introduction of the
deprecated per-type frontend CRUD (``ModifyComponentAction``,
``AddPageAction``, ``ModifyPageMetadataAction``, ``RemovePageAction``)
or against re-introducing the permission flags / mount metadata that
the plan deliberately removed (``allow_create``, ``allow_delete``,
``mount_target_*``, ``targets[]``, ``primary_targets[]``,
``building_plan[]``).
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from main_agent.agents.orchestrator.app_types.webapp.subagents import editor as editor_module
from main_agent.agents.orchestrator.app_types.webapp.subagents.editor import (
    EditorOutput,
    FrontendBuildAction,
    PageCreate,
    PageRemove,
    PageSlugRename,
    RenamePageTitleAction,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# EditorOutput shape — Phase B 8-action regression
# --------------------------------------------------------------------------- #


class TestEditorOutputShape:
    def test_has_exactly_ten_action_lists_plus_reasoning(self):
        # Plan §3 Phase B canonical surface — 8 action lists, plus the
        # DataIngester-driven 9th list added in PR 4 of the data-ingester
        # rollout, plus the 10th list
        # `edit_seed_data_actions` (data-VALUE edits → SeedDataBuilder edit;
        # routes price/row edits away from the schema builder so they apply
        # and don't loop the model builder).
        expected_action_fields = {
            "modify_styles_actions",
            "change_backend_models_actions",
            "modify_logic_actions",
            "add_handler_actions",
            "modify_handler_actions",
            "remove_handler_actions",
            "rename_page_title_actions",
            "frontend_build_actions",
            "ingest_data_actions",
            "edit_seed_data_actions",
        }
        actual = set(EditorOutput.model_fields.keys()) - {"reasoning"}
        assert actual == expected_action_fields, (
            f"Editor surface drift detected. Missing: {expected_action_fields - actual}, "
            f"unexpected: {actual - expected_action_fields}"
        )

    def test_deprecated_actions_no_longer_exported(self):
        # Plan §3 Phase B explicitly removes these. Guard against accidental
        # re-introduction (e.g. a partial rebase).
        for symbol in (
            "ModifyComponentAction",
            "AddPageAction",
            "ModifyPageMetadataAction",
            "RemovePageAction",
        ):
            assert not hasattr(editor_module, symbol), (
                f"{symbol} was supposed to be removed but is still exported " f"from editor.py"
            )

    def test_round_trip_with_all_action_types(self):
        # Round-trip a payload that touches every action list.
        payload = EditorOutput(
            reasoning="test",
            rename_page_title_actions=[
                RenamePageTitleAction(page_uuid="abc-123", new_title="About Us"),
            ],
            frontend_build_actions=[
                FrontendBuildAction(
                    prompt="Add a Hero entry on the home page.",
                    page_creates=[PageCreate(title="Home", mount_components=["HomeContent"])],
                ),
            ],
        )
        dumped = payload.model_dump()
        restored = EditorOutput.model_validate(dumped)
        assert restored.rename_page_title_actions[0].new_title == "About Us"
        assert restored.frontend_build_actions[0].page_creates[0].title == "Home"

    def test_defaults_yield_empty_lists(self):
        out = EditorOutput(reasoning="empty edit")
        for field in (
            "modify_styles_actions",
            "change_backend_models_actions",
            "modify_logic_actions",
            "add_handler_actions",
            "modify_handler_actions",
            "remove_handler_actions",
            "rename_page_title_actions",
            "frontend_build_actions",
        ):
            assert getattr(out, field) == []


# --------------------------------------------------------------------------- #
# FrontendBuildAction — schema invariants
# --------------------------------------------------------------------------- #


class TestFrontendBuildAction:
    def test_prompt_is_required(self):
        with pytest.raises(ValidationError):
            FrontendBuildAction()  # type: ignore[call-arg]

    def test_default_priority_is_100(self):
        action = FrontendBuildAction(prompt="rename Card.label to Card.title")
        assert action.priority == 100

    def test_no_permission_flags_on_schema(self):
        # Plan §3: there must be NO allow_create / allow_delete fields.
        # The prompt is the constraint. Re-introducing permission flags
        # would re-introduce the friction the plan explicitly removes.
        forbidden = {
            "allow_create",
            "allow_delete",
            "allow_modify",
            "permissions",
        }
        actual = set(FrontendBuildAction.model_fields.keys())
        leaked = forbidden & actual
        assert not leaked, f"Permission flags leaked back onto schema: {leaked}"

    def test_no_mount_target_or_target_list_fields(self):
        # Plan §3: there must be NO mount_target_*, targets[], primary_targets[],
        # building_plan[]. The agent discovers files itself.
        forbidden = {
            "targets",
            "primary_targets",
            "building_plan",
            "mount_target_page",
            "mount_target_component",
            "mount_target_slug",
            "intent",
        }
        actual = set(FrontendBuildAction.model_fields.keys())
        leaked = forbidden & actual
        assert not leaked, f"Pre-decomposition fields leaked back: {leaked}"

    def test_side_effect_lists_default_empty(self):
        action = FrontendBuildAction(prompt="any prompt")
        assert action.page_creates == []
        assert action.page_removes == []
        assert action.page_slug_renames == []

    def test_round_trip_with_full_side_effects(self):
        action = FrontendBuildAction(
            prompt="rebuild navigation",
            page_creates=[
                PageCreate(title="Pricing", slug="/pricing", mount_components=["PricingHero"]),
            ],
            page_removes=[PageRemove(page_uuid="legacy-uuid")],
            page_slug_renames=[PageSlugRename(page_uuid="about-uuid", new_slug="/company")],
            priority=50,
        )
        restored = FrontendBuildAction.model_validate(action.model_dump())
        assert restored.priority == 50
        assert restored.page_creates[0].mount_components == ["PricingHero"]
        assert restored.page_removes[0].page_uuid == "legacy-uuid"
        assert restored.page_slug_renames[0].new_slug == "/company"


# --------------------------------------------------------------------------- #
# PageCreate / PageRemove / PageSlugRename validators
# --------------------------------------------------------------------------- #


class TestPageCreateValidator:
    def test_accepts_pascal_case_components(self):
        pc = PageCreate(title="Home", mount_components=["HomeContent", "Hero"])
        assert pc.mount_components == ["HomeContent", "Hero"]

    def test_rejects_lowercase_component(self):
        with pytest.raises(ValidationError) as exc:
            PageCreate(title="Home", mount_components=["homeContent"])
        assert "PascalCase" in str(exc.value)

    def test_rejects_component_with_slash(self):
        with pytest.raises(ValidationError):
            PageCreate(title="X", mount_components=["pages/Home"])

    def test_rejects_component_with_extension(self):
        with pytest.raises(ValidationError):
            PageCreate(title="X", mount_components=["Home.tsx"])

    def test_slug_optional(self):
        pc = PageCreate(title="About")
        assert pc.slug is None

    def test_mount_components_default_empty(self):
        pc = PageCreate(title="About")
        assert pc.mount_components == []


class TestPageRemoveValidator:
    def test_requires_non_empty_uuid(self):
        with pytest.raises(ValidationError):
            PageRemove(page_uuid="")
        with pytest.raises(ValidationError):
            PageRemove(page_uuid="   ")

    def test_accepts_valid_uuid(self):
        rem = PageRemove(page_uuid="page-123")
        assert rem.page_uuid == "page-123"


class TestPageSlugRenameValidator:
    def test_requires_leading_slash(self):
        with pytest.raises(ValidationError) as exc:
            PageSlugRename(page_uuid="abc", new_slug="about")
        assert "/" in str(exc.value)

    def test_accepts_root_slash(self):
        rename = PageSlugRename(page_uuid="abc", new_slug="/")
        assert rename.new_slug == "/"

    def test_accepts_nested_slug(self):
        rename = PageSlugRename(page_uuid="abc", new_slug="/team/people")
        assert rename.new_slug == "/team/people"

    def test_rejects_empty_uuid(self):
        with pytest.raises(ValidationError):
            PageSlugRename(page_uuid="", new_slug="/about")


# --------------------------------------------------------------------------- #
# RenamePageTitleAction — slug-rename forbidden
# --------------------------------------------------------------------------- #


class TestRenamePageTitleAction:
    def test_constructs_with_just_uuid_and_title(self):
        action = RenamePageTitleAction(page_uuid="page-uuid", new_title="New Title")
        assert action.priority == 100

    def test_schema_does_not_expose_slug_field(self):
        # The plan FORBIDS this action from carrying a slug change.
        # If a `new_slug` (or any slug-shaped) field shows up on the
        # schema we want to fail loudly — slug renames cascade across
        # frontend files and MUST go through FrontendBuildAction.
        forbidden = {"new_slug", "slug", "page_slug", "old_slug"}
        actual = set(RenamePageTitleAction.model_fields.keys())
        leaked = forbidden & actual
        assert not leaked, (
            f"RenamePageTitleAction is supposed to be title-only; "
            f"slug-related field(s) leaked: {leaked}"
        )

    def test_extra_slug_field_is_ignored_by_default_or_rejected(self):
        # With Pydantic's default `extra='ignore'` config, an extra
        # `new_slug` key is silently dropped — that's still fine, the
        # title-only contract holds. We just want to assert the field
        # doesn't end up on the model.
        action = RenamePageTitleAction.model_validate(
            {"page_uuid": "abc", "new_title": "X", "new_slug": "/should-be-ignored"}
        )
        assert not hasattr(action, "new_slug")

    def test_requires_non_empty_page_uuid(self):
        with pytest.raises(ValidationError):
            RenamePageTitleAction(page_uuid="", new_title="X")
        with pytest.raises(ValidationError):
            RenamePageTitleAction(page_uuid="   ", new_title="X")
