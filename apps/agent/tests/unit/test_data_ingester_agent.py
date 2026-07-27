"""Unit tests for the DataIngester Layer 2B subagent.

Scope: Pydantic schemas + the report→prose helpers. The LlmAgent itself
is exercised by integration tests with mocked Gemini responses (out of
scope here).
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.data_ingester import (
    DataIngesterInput,
    ExistingModelDetail,
    IngestReport,
    ProposedColumn,
    ProposedModel,
    data_ingester_agent,
    report_to_creator_summary,
    report_to_editor_summary,
)

pytestmark = pytest.mark.unit


class TestProposedColumn:
    def test_minimal(self):
        col = ProposedColumn(name="email", original_name="Email", type="text")
        assert col.nullable is True
        assert col.sample_values == []

    def test_with_samples(self):
        col = ProposedColumn(
            name="email",
            original_name="Email",
            type="text",
            nullable=False,
            sample_values=["a@x", "b@y", "c@z"],
        )
        assert len(col.sample_values) == 3


class TestProposedModel:
    def test_defaults_are_safe(self):
        """`target_mode` defaults to 'create' — the safe option that
        never destroys existing data."""
        model = ProposedModel(name="x", source_artifact="doc:x.md")
        assert model.target_mode == "create"
        assert model.target_existing_model_name is None
        assert model.row_cap_hit is False
        assert model.notes == ""

    def test_append_target_carries_existing_name(self):
        model = ProposedModel(
            name="customers_v2",
            source_artifact="doc:customers_v2.md",
            target_mode="append",
            target_existing_model_name="customers",
        )
        assert model.target_existing_model_name == "customers"


class TestExistingModelDetail:
    def test_round_trip(self):
        m = ExistingModelDetail(
            name="customers",
            columns=[
                {"name": "id", "type": "integer", "sample": "1"},
                {"name": "email", "type": "text", "sample": "a@x"},
            ],
        )
        assert m.columns[1]["sample"] == "a@x"


class TestDataIngesterInput:
    def test_minimum_required(self):
        # ``mode`` is required; everything else has a default.
        ipt = DataIngesterInput(mode="create")
        assert ipt.user_request == ""
        assert ipt.raw_proposed_models == []
        assert ipt.existing_models == []

    def test_edit_mode_with_existing_models(self):
        ipt = DataIngesterInput(
            mode="edit",
            existing_models=[ExistingModelDetail(name="customers", columns=[])],
        )
        assert len(ipt.existing_models) == 1

    def test_missing_mode_rejected(self):
        with pytest.raises(Exception):
            DataIngesterInput()  # type: ignore[call-arg]


class TestIngestReport:
    def test_defaults(self):
        r = IngestReport()
        assert r.proposed_models == []
        assert r.target_mappings == {}
        assert r.confidence == "medium"
        assert r.warnings == []


class TestReportToCreatorSummary:
    def test_empty_report_returns_empty_string(self):
        assert report_to_creator_summary(IngestReport()) == ""

    def test_single_model_renders_with_columns_and_notes(self):
        report = IngestReport(
            proposed_models=[
                ProposedModel(
                    name="customers",
                    source_artifact="doc:customers.md",
                    columns=[
                        ProposedColumn(name="id", original_name="ID", type="integer"),
                        ProposedColumn(name="email", original_name="Email", type="text"),
                    ],
                    row_count=320,
                    notes="User wants signup-date filtering",
                )
            ],
            domain_hints="CRM with order history",
        )
        summary = report_to_creator_summary(report)
        assert "**customers**" in summary
        assert "320 rows" in summary
        assert "id:integer" in summary
        assert "email:text" in summary
        assert "User wants signup-date filtering" in summary
        assert "CRM with order history" in summary
        assert "Do not redeclare" in summary

    def test_warnings_and_failed_artifacts_surfaced(self):
        report = IngestReport(
            proposed_models=[ProposedModel(name="x", source_artifact="doc:x.md")],
            warnings=["customers.xlsx: row count exceeds 50000"],
            failed_artifacts=["doc:weird.md"],
        )
        out = report_to_creator_summary(report)
        assert "row count exceeds 50000" in out
        assert "doc:weird.md" in out

    def test_column_truncation_with_overflow_marker(self):
        report = IngestReport(
            proposed_models=[
                ProposedModel(
                    name="big",
                    source_artifact="doc:big.md",
                    columns=[
                        ProposedColumn(
                            name=f"col_{i}",
                            original_name=f"c{i}",
                            type="text",
                        )
                        for i in range(15)
                    ],
                )
            ]
        )
        out = report_to_creator_summary(report)
        assert "+7 more" in out


class TestReportToEditorSummary:
    def test_empty_report(self):
        assert report_to_editor_summary(IngestReport()) == ""

    def test_create_action_described(self):
        report = IngestReport(
            proposed_models=[ProposedModel(name="orders", source_artifact="doc:orders.md")]
        )
        out = report_to_editor_summary(report)
        assert "ChangeBackendModelsAction" in out
        assert "target_mode=create" in out

    def test_append_lists_target(self):
        report = IngestReport(
            proposed_models=[
                ProposedModel(
                    name="customers_q2",
                    source_artifact="doc:customers_q2.md",
                    target_mode="append",
                    target_existing_model_name="customers",
                )
            ]
        )
        out = report_to_editor_summary(report)
        assert "→ customers" in out
        assert "target_mode=append" in out
        assert "IngestDataAction" in out


class TestAgentDefinition:
    def test_agent_name_matches_AgentName_value(self):
        from config import AgentName

        assert data_ingester_agent.name == AgentName.DATA_INGESTER.value

    def test_agent_has_no_tools(self):
        """DataIngester is a structured-output agent. No tools, no
        skills — the system_instruction must stay byte-stable across
        turns."""
        # `tools` is either unset or empty for structured-output agents.
        tools = getattr(data_ingester_agent, "tools", None) or []
        assert tools == []

    def test_agent_io_schemas(self):
        assert data_ingester_agent.input_schema is DataIngesterInput
        assert data_ingester_agent.output_schema is IngestReport
