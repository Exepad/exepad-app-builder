"""Unit tests for the Editor-grounding bug fix (2026-05-20).

Two deterministic, LLM-free surfaces:

* ``_format_editor_prompt`` must render the three EditorInput fields that
  were previously built but silently dropped — ``diagnostic_report``,
  ``existing_models`` — and ALWAYS render a "## Data Upload" section
  (an explicit "no data uploaded" guard when empty). The dropped
  ``data_ingest_report``/``diagnostic_report`` left the Editor ungrounded,
  which let a plain text edit mis-route into an ``ingest_data_action``.
* ``EditingWorkflow._sanitize_ingest_actions`` drops spurious ingest
  actions (no upload this turn, or target is not a real backend model).
"""

from __future__ import annotations

import json

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.editor import (
    EditorInput,
    EditorOutput,
    IngestDataAction,
)
from main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow import (
    EditingWorkflow,
    _format_editor_prompt,
)

pytestmark = pytest.mark.unit


def _input(**overrides) -> EditorInput:
    base = dict(user_request="Change the heading to 'X'.", current_app_config="{}")
    base.update(overrides)
    return EditorInput(**base)


# =============================================================================
# _format_editor_prompt — the three previously-dropped fields
# =============================================================================


class TestFormatEditorPromptGrounding:
    def test_empty_data_upload_renders_guard(self):
        """No upload this turn => an explicit guard telling the planner NOT
        to emit ingest_data_actions. This signal was entirely absent before."""
        out = _format_editor_prompt(_input(data_ingest_report=""))
        assert "## Data Upload" in out
        assert "No data files were uploaded this turn" in out
        assert "ingest_data_actions" in out

    def test_nonempty_data_upload_rendered_without_guard(self):
        out = _format_editor_prompt(
            _input(data_ingest_report="Proposed model customers_v2 (append → customers).")
        )
        assert "## Data Upload" in out
        assert "customers_v2" in out
        assert "No data files were uploaded this turn" not in out

    def test_diagnostic_report_rendered_when_present(self):
        report = json.dumps(
            {"profile": "referent-and-current-state", "confidence": "high", "findings": []}
        )
        out = _format_editor_prompt(_input(diagnostic_report=report))
        assert "## Diagnostic Report (Surveyor)" in out
        assert "referent-and-current-state" in out

    def test_diagnostic_report_absent_when_empty(self):
        out = _format_editor_prompt(_input(diagnostic_report=""))
        assert "## Diagnostic Report" not in out

    def test_existing_models_rendered(self):
        out = _format_editor_prompt(
            _input(
                existing_models=[
                    {
                        "name": "customers",
                        "columns": [
                            {"name": "id", "type": "integer"},
                            {"name": "email", "type": "text"},
                        ],
                    }
                ]
            )
        )
        assert "## Existing Backend Models" in out
        assert "- customers(id:integer, email:text)" in out

    def test_replan_feedback_rendered_high(self):
        out = _format_editor_prompt(_input(replan_feedback="Do NOT emit ingest_data_actions."))
        assert "## IMPORTANT — Re-plan Feedback" in out
        assert "Do NOT emit ingest_data_actions." in out


# =============================================================================
# _sanitize_ingest_actions — drop spurious ingest actions
# =============================================================================


def _ingest(target: str) -> IngestDataAction:
    return IngestDataAction(
        target_model_name=target,
        source_rows_artifact="extracted_rows:x.json",
        source_schema_artifact="extracted_schema:x.json",
        mode="append",
        batch_id="t-1",
    )


class TestSanitizeIngestActions:
    def test_drops_when_no_upload_even_if_target_real(self):
        plan = EditorOutput(reasoning="", ingest_data_actions=[_ingest("customers")])
        dropped = EditingWorkflow._sanitize_ingest_actions(
            plan, "", [{"name": "customers"}], "test"
        )
        assert len(dropped) == 1
        assert plan.ingest_data_actions == []

    def test_drops_when_target_not_a_model(self):
        """The mis-route case: a component name as the ingest target."""
        plan = EditorOutput(reasoning="", ingest_data_actions=[_ingest("DashboardContent")])
        dropped = EditingWorkflow._sanitize_ingest_actions(
            plan, "report present", [{"name": "customers"}], "test"
        )
        assert [a.target_model_name for a in dropped] == ["DashboardContent"]
        assert plan.ingest_data_actions == []

    def test_keeps_valid_action(self):
        plan = EditorOutput(reasoning="", ingest_data_actions=[_ingest("customers")])
        dropped = EditingWorkflow._sanitize_ingest_actions(
            plan, "report present", [{"name": "customers"}], "test"
        )
        assert dropped == []
        assert len(plan.ingest_data_actions) == 1

    def test_case_insensitive_model_match(self):
        plan = EditorOutput(reasoning="", ingest_data_actions=[_ingest("Customers")])
        dropped = EditingWorkflow._sanitize_ingest_actions(
            plan, "report present", [{"name": "customers"}], "test"
        )
        assert dropped == []
        assert len(plan.ingest_data_actions) == 1

    def test_no_ingest_actions_returns_empty(self):
        plan = EditorOutput(reasoning="")
        dropped = EditingWorkflow._sanitize_ingest_actions(plan, "", [], "test")
        assert dropped == []

    def test_partial_drop_keeps_valid_drops_invalid(self):
        plan = EditorOutput(
            reasoning="",
            ingest_data_actions=[_ingest("customers"), _ingest("DashboardContent")],
        )
        dropped = EditingWorkflow._sanitize_ingest_actions(
            plan, "report present", [{"name": "customers"}], "test"
        )
        assert [a.target_model_name for a in dropped] == ["DashboardContent"]
        assert [a.target_model_name for a in plan.ingest_data_actions] == ["customers"]
