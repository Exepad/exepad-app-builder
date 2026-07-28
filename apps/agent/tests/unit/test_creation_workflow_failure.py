"""Unit tests for creation workflow fatal failure summaries."""

import inspect
import json
import re
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from main_agent.agents.orchestrator.app_types.webapp.workflows import creation_workflow
from main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow import (
    CreationWorkflow,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.creator import CreatorOutput
from main_agent.constants import StateKeys
from main_agent.agents.orchestrator.models.progress_tracker import ProgressTracker
from tests.fixtures.mock_ctx import create_mock_ctx

pytestmark = [pytest.mark.unit]


def _build_workflow() -> CreationWorkflow:
    return CreationWorkflow(
        creator_agent=MagicMock(),
        component_builder_agent=MagicMock(),
        design_system_builder_agent=MagicMock(),
        post_processing_service=MagicMock(),
        assembly_service=MagicMock(),
        write_result_response_fn=MagicMock(),
        emit_chat_directly_fn=MagicMock(),
        emit_decline_directly_fn=MagicMock(),
    )


class TestComponentGenerationFailure:
    def test_failure_payload_lists_components_and_reason(self):
        workflow = _build_workflow()

        error_entry, assistant_response, conversation_summary = (
            workflow._build_component_generation_failure(
                {
                    "MainHeader": "builder_escalated",
                    "HomeContent": "Line ~51: Low measured contrast 1.00:1",
                },
                "Create a consulting website",
            )
        )

        assert error_entry["type"] == "component_generation_failed"
        assert error_entry["components"] == ["MainHeader", "HomeContent"]
        assert "could not be safely generated" in error_entry["summary"]
        assert "Low measured contrast" in error_entry["summary"]
        assert "Nothing was saved or deployed." in assistant_response
        assert conversation_summary["user_ask"] == "Create a consulting website"

    def test_failure_payload_truncates_large_component_lists(self):
        workflow = _build_workflow()

        unresolved = {f"Component{i}": "builder_escalated" for i in range(7)}
        error_entry, assistant_response, _ = workflow._build_component_generation_failure(
            unresolved,
            "Create a large site",
        )

        assert "and 2 more" in error_entry["summary"]
        assert "and 2 more" in assistant_response


class TestAppSecondaryTypeFlow:
    """PreCreator is the single source of truth for app_secondary_type.

    Regression guard for a silent drift bug where creation_workflow read
    `plan.get("app_secondary_type", "website")` from the Creator agent's
    output dict — a key that CreatorOutput never declares. Every dataapp
    was persisted as a `website`, surfacing spurious Forms/Blog admin
    tabs and routing through the wrong workflow branches.
    """

    def test_creator_output_does_not_declare_app_secondary_type(self):
        """CreatorOutput intentionally omits `app_secondary_type`.

        If a future change adds this field to CreatorOutput, update the
        flow design or this test — but not both silently.
        """
        assert "app_secondary_type" not in CreatorOutput.model_fields, (
            "CreatorOutput should not declare app_secondary_type — "
            "PreCreator owns that classification. If you added it back, "
            "update the workflow to reconcile the two sources."
        )

    def test_creation_workflow_does_not_read_app_secondary_type_from_plan(self):
        """No caller in creation_workflow.py may read app_secondary_type
        from the Creator plan dict. All reads must go through the local
        `app_secondary_type` variable sourced from session-state
        `pre_classified_app_type` (PreCreator's output).
        """
        source = inspect.getsource(creation_workflow)
        # Strip comments so explanatory prose doesn't trip the check.
        stripped = re.sub(r"#.*", "", source)
        forbidden = re.findall(r'plan\.get\(\s*["\']app_secondary_type["\']', stripped)
        assert not forbidden, (
            "creation_workflow.py reads `plan.get('app_secondary_type', ...)` "
            "in {} place(s). The Creator plan never carries this field "
            "(see CreatorOutput schema); use the local `app_secondary_type` "
            "variable populated from session-state `pre_classified_app_type` "
            "instead.".format(len(forbidden))
        )

    def test_creation_workflow_no_longer_branches_on_plan_already_set(self):
        """Regression guard: ``CreationWorkflow`` used to carry a
        ``_plan_already_set`` skip that bypassed PreCreator + Creator
        when DesignImportWorkflow had already synthesized a plan. With
        DesignImportWorkflow now self-contained (no delegation back to
        CreationWorkflow), that branch is dead code and was removed.
        This test pins the removal — re-introducing the branch would
        re-couple the two workflows."""
        source = inspect.getsource(CreationWorkflow.execute)
        assert "_plan_already_set" not in source, (
            "_plan_already_set branch resurrected — DesignImportWorkflow "
            "should no longer delegate to CreationWorkflow.execute(); "
            "the branch can be deleted again."
        )


async def _empty_async_gen(*args, **kwargs):
    if False:
        yield None


def _missing_theme_css_ctx_and_context():
    """Shared scaffolding for the theme.css failure-mode tests below."""
    ctx = create_mock_ctx(
        session_state={
            StateKeys.INITIAL_DESCRIPTION: "Create a portfolio website",
            StateKeys.CREATOR_PLAN: {
                "app_name": "Portfolio",
                "design_system": {},
                "component_plans": [
                    {
                        "name": "HomePage",
                        "role": "content",
                        "page_slug": "/",
                        "page_title": "Home",
                        # The post-materialization validator requires
                        # content components to have non-empty bullets.
                        "building_plan": ["Hero with intro and CTA"],
                    }
                ],
            },
            StateKeys.AGENT_ERRORS: [],
        }
    )
    ctx.artifact_service = MagicMock()

    content_context = SimpleNamespace(
        image_catalog_summary="",
        document_artifact_list=[],
        large_document_list=[],
        user_referenced_images=[],
        user_referenced_documents=[],
        user_referenced_large_documents=[],
        unresolved_references=[],
    )
    return ctx, content_context


async def test_missing_theme_css_records_warning_and_continues_with_seed_fallback():
    """Cosmetic DesignSystemBuilder failures should not abort the build.

    When theme.css is missing, the workflow records a non-fatal warning and
    asks load_and_persist_theme_palette to derive a palette from the Creator
    agent's seed colours. SAVE_APP_CONFIG/RELOAD_APP must NOT be set False.
    """
    workflow = _build_workflow()
    workflow.validation_service._run_agent_with_retry = _empty_async_gen
    workflow._run_agent_with_metrics = _empty_async_gen

    ctx, content_context = _missing_theme_css_ctx_and_context()
    progress_tracker = ProgressTracker()

    # Pretend the seed-fallback theme palette resolution succeeded.
    fake_palette = {"primary": "#0F172A", "background": "#FFFFFF"}

    with (
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow.DocumentArtifactService.prepare_content_context",
            AsyncMock(return_value=content_context),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow.ArtifactManager.save_config_artifact_from_invocation_context",
            AsyncMock(return_value=1),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow.ArtifactManager.load_artifact_as_string",
            AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow.load_and_persist_theme_palette",
            AsyncMock(return_value=fake_palette),
        ),
    ):
        # The workflow continues past the theme step and will eventually fail
        # in unrelated downstream stages (no real Creator/ComponentBuilder).
        # We only care that the *theme step* did not abort.
        try:
            [event async for event in workflow.execute(ctx, progress_tracker)]
        except Exception:
            pass

    # The warning must be recorded.
    warnings = [
        e
        for e in ctx.session.state[StateKeys.AGENT_ERRORS]
        if e.get("stage") == "DesignSystemBuilder"
    ]
    assert len(warnings) == 1
    assert "falling back" in warnings[0]["summary"]

    # And the theme step must NOT have flipped the abort flags.
    assert ctx.session.state.get(StateKeys.SAVE_APP_CONFIG) is not False
    assert ctx.session.state.get(StateKeys.RELOAD_APP) is not False


async def test_theme_palette_resolution_unrecoverable_aborts_build():
    """If even the seed-fallback path raises (no seed colours either), the
    workflow still aborts and surfaces the structured error — preserving the
    pre-fix safety net for the truly unrecoverable case."""
    from main_agent.agents.orchestrator.app_types.webapp.services.theme_palette_service import (
        ThemePaletteResolutionError,
    )

    workflow = _build_workflow()
    workflow.validation_service._run_agent_with_retry = _empty_async_gen
    workflow._run_agent_with_metrics = _empty_async_gen

    ctx, content_context = _missing_theme_css_ctx_and_context()
    progress_tracker = ProgressTracker()

    with (
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow.DocumentArtifactService.prepare_content_context",
            AsyncMock(return_value=content_context),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow.ArtifactManager.save_config_artifact_from_invocation_context",
            AsyncMock(return_value=1),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow.ArtifactManager.load_artifact_as_string",
            AsyncMock(return_value=None),
        ),
        patch(
            "main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow.load_and_persist_theme_palette",
            AsyncMock(side_effect=ThemePaletteResolutionError("no palette")),
        ),
    ):
        events = [event async for event in workflow.execute(ctx, progress_tracker)]

    assert ctx.session.state[StateKeys.SAVE_APP_CONFIG] is False
    assert ctx.session.state[StateKeys.RELOAD_APP] is False

    # Both the warning (cosmetic) and the structured error (fatal) are present.
    error_entries = ctx.session.state[StateKeys.AGENT_ERRORS]
    assert any(e.get("stage") == "DesignSystemBuilder" for e in error_entries)
    assert any(
        e.get("stage") == "ThemePaletteResolutionError"
        and "Theme palette resolution failed" in e["summary"]
        for e in error_entries
    )

    last_event = json.loads(events[-1].content.parts[0].text)
    assert last_event["action"] == "error"
    assert "Theme palette resolution failed" in last_event["internal_message"]
