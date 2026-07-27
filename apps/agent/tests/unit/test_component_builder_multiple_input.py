"""Schema regression tests for ``ComponentBuilderMultipleInput``.

The plan deliberately strips the input down to ``prompt`` + read-only
context. These tests are the safety net against silently re-introducing
a per-file decomposition (``targets[]`` / ``primary_targets[]`` /
``building_plan[]``), permission flags (``allow_create`` /
``allow_delete``), or mount metadata (``mount_target_*``). Re-introducing
any of those would push planning back onto the editor — which is exactly
what the new architecture moves away from.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from main_agent.agents.orchestrator.app_types.webapp.subagents.component_builder_multiple import (
    ComponentBuilderMultipleInput,
)

pytestmark = [pytest.mark.unit]


# --------------------------------------------------------------------------- #
# Required field surface
# --------------------------------------------------------------------------- #


class TestRequiredAndOptional:
    def test_prompt_is_required(self):
        with pytest.raises(ValidationError) as exc:
            ComponentBuilderMultipleInput()  # type: ignore[call-arg]
        assert "prompt" in str(exc.value)

    def test_minimal_payload_validates(self):
        # Only `prompt` is mandatory; every read-only context field has a
        # non-None default so the planner can ship a slim message when the
        # surfaces aren't applicable.
        x = ComponentBuilderMultipleInput(prompt="rename Card.label to Card.title")
        assert x.prompt == "rename Card.label to Card.title"
        # Defaults across the read-only context.
        assert x.design_system_context == ""
        assert x.backend_surface == ""
        assert x.logic_surface == ""
        assert x.app_context == ""
        assert x.image_urls == ""
        assert x.app_language_code == "en"

    def test_round_trip_preserves_context(self):
        x = ComponentBuilderMultipleInput(
            prompt="rebuild the dashboard",
            design_system_context='{"colors": {}}',
            backend_surface='{"models": []}',
            logic_surface='{"state_keys": []}',
            app_context='{"pages": []}',
            image_urls="{}",
            app_language_code="tr",
        )
        restored = ComponentBuilderMultipleInput.model_validate(x.model_dump())
        assert restored.app_language_code == "tr"
        assert restored.app_context == '{"pages": []}'

    def test_all_context_fields_are_strings(self):
        # The read-only context surface is byte-stable JSON-as-string for
        # cache reuse across builders. Switching to dict/list at any point
        # would break that, so guard the type contract.
        for field_name, field in ComponentBuilderMultipleInput.model_fields.items():
            assert field.annotation is str, (
                f"{field_name} should be `str` for prompt-cache stability, "
                f"got {field.annotation}"
            )


# --------------------------------------------------------------------------- #
# Forbidden-field regression guards (the heart of the plan)
# --------------------------------------------------------------------------- #


class TestForbiddenFields:
    def test_no_per_file_decomposition_fields(self):
        forbidden = {
            "targets",
            "primary_targets",
            "building_plan",
            "files",
            "file_set",
            "existing_source",
            "intent",
            "build_mode",
        }
        actual = set(ComponentBuilderMultipleInput.model_fields.keys())
        leaked = forbidden & actual
        assert not leaked, (
            "ComponentBuilderMultipleInput must not carry pre-decomposition "
            f"fields. The agent discovers files via its tool surface. Leaked: "
            f"{leaked}"
        )

    def test_no_permission_flags(self):
        forbidden = {
            "allow_create",
            "allow_delete",
            "allow_modify",
            "permissions",
            "writable_prefixes",
        }
        actual = set(ComponentBuilderMultipleInput.model_fields.keys())
        leaked = forbidden & actual
        assert not leaked, (
            "Permission flags do not belong on the input schema — the "
            f"prompt itself is the constraint. Leaked: {leaked}"
        )

    def test_no_mount_metadata_fields(self):
        forbidden = {
            "mount_target_page",
            "mount_target_component",
            "mount_target_slug",
            "page_creates",
            "page_removes",
            "page_slug_renames",
        }
        actual = set(ComponentBuilderMultipleInput.model_fields.keys())
        leaked = forbidden & actual
        assert not leaked, (
            "Mount metadata is workflow-side state (FrontendBuildAction "
            "side-effects), not input to the worker. Leaked: " f"{leaked}"
        )


# --------------------------------------------------------------------------- #
# Field surface = exactly the plan-specified set
# --------------------------------------------------------------------------- #


class TestExactFieldSet:
    def test_input_field_set_matches_plan(self):
        # Plan §1: ``ComponentBuilderMultipleInput`` carries exactly these
        # fields and no others. Drift in either direction (silently dropped
        # context surface OR added decomposition field) should be caught.
        expected = {
            "prompt",
            "design_system_context",
            "backend_surface",
            "logic_surface",
            "app_context",
            "image_urls",
            "app_language_code",
        }
        actual = set(ComponentBuilderMultipleInput.model_fields.keys())
        assert actual == expected, (
            f"Input schema drift. Missing: {expected - actual}, "
            f"unexpected: {actual - expected}"
        )
