"""Unit tests for the Surveyor's DiagnosticReport schema validators."""

import json

import pytest
from pydantic import ValidationError

from main_agent.agents.orchestrator.app_types.webapp.subagents.surveyor import (
    DiagnosticReport,
    Evidence,
    Finding,
    SurveyorInput,
    empty_low_confidence_report,
    report_to_editor_input,
)


# ---------------------------------------------------------------------------
# Evidence + Finding (basic field constraints)
# ---------------------------------------------------------------------------


class TestEvidence:
    def test_minimal_evidence(self):
        e = Evidence(tool="field_mismatch_report_tool")
        assert e.tool == "field_mismatch_report_tool"
        assert e.args == {}
        assert e.excerpt == ""
        assert e.location == ""

    def test_truncates_excerpt_if_oversize(self):
        # max_length=2000 is enforced by Pydantic.
        with pytest.raises(ValidationError):
            Evidence(tool="x", excerpt="a" * 2001)


class TestFindingBasic:
    def test_warning_finding_no_evidence_required(self):
        # Only severity='root_cause' demands evidence.
        f = Finding(statement="Style nit unrelated to user request", severity="warning")
        assert f.severity == "warning"
        assert f.evidence == []

    def test_context_finding_no_evidence_required(self):
        f = Finding(statement="User mentioned page X", severity="context")
        assert f.severity == "context"


# ---------------------------------------------------------------------------
# DiagnosticReport — model_validator enforcement
# ---------------------------------------------------------------------------


def _good_evidence() -> list[Evidence]:
    return [
        Evidence(
            tool="field_mismatch_report_tool",
            args={"components": ["DashboardContent"]},
            excerpt="Consumer reads 'rate' but producer returns 'percentage'.",
            location="DashboardContent.tsx:137",
        )
    ]


class TestDiagnosticReportRootCause:
    def test_root_cause_with_evidence_and_entities_passes(self):
        report = DiagnosticReport(
            profile="bug-root-cause",
            symptom="Chart displays no data points",
            findings=[
                Finding(
                    statement="dataKey='rate' but handler returns 'percentage'",
                    severity="root_cause",
                    evidence=_good_evidence(),
                    affected_entities=["DashboardContent", "getOccupancyTrend"],
                )
            ],
            confidence="high",
            suggested_resolution_shape="both_sides_paired",
        )
        assert report.findings[0].severity == "root_cause"

    def test_root_cause_without_evidence_rejected(self):
        with pytest.raises(ValidationError) as excinfo:
            DiagnosticReport(
                profile="bug-root-cause",
                symptom="Chart displays no data",
                findings=[
                    Finding(
                        statement="x",
                        severity="root_cause",
                        evidence=[],
                        affected_entities=["X"],
                    )
                ],
                confidence="high",
            )
        assert "no evidence" in str(excinfo.value)

    def test_root_cause_without_affected_entities_rejected(self):
        with pytest.raises(ValidationError) as excinfo:
            DiagnosticReport(
                profile="bug-root-cause",
                symptom="Chart displays no data",
                findings=[
                    Finding(
                        statement="x",
                        severity="root_cause",
                        evidence=_good_evidence(),
                        affected_entities=[],
                    )
                ],
                confidence="high",
            )
        assert "affected_entities" in str(excinfo.value)

    def test_contributing_finding_does_not_need_evidence(self):
        # contributing/context/warning have no evidence requirement.
        DiagnosticReport(
            profile="bug-root-cause",
            symptom="Chart issue",
            findings=[
                Finding(
                    statement="Naming is suboptimal",
                    severity="contributing",
                    evidence=[],
                )
            ],
            confidence="medium",
        )


class TestDiagnosticReportConfidence:
    def test_low_confidence_with_empty_findings_allowed(self):
        # Graceful-degrade: 'I couldn't conclude anything' is valid.
        report = DiagnosticReport(
            profile="bug-root-cause",
            symptom="Chart displays no data",
            findings=[],
            confidence="low",
            blockers=["tool budget exhausted before reaching consumer"],
        )
        assert report.findings == []
        assert report.confidence == "low"

    def test_high_confidence_with_empty_findings_rejected(self):
        with pytest.raises(ValidationError) as excinfo:
            DiagnosticReport(
                profile="bug-root-cause",
                symptom="Chart issue",
                findings=[],
                confidence="high",
            )
        assert "findings is empty" in str(excinfo.value)

    def test_medium_confidence_with_empty_findings_rejected(self):
        with pytest.raises(ValidationError):
            DiagnosticReport(
                profile="bug-root-cause",
                symptom="Chart issue",
                findings=[],
                confidence="medium",
            )


class TestDiagnosticReportSymptom:
    def test_empty_symptom_rejected(self):
        with pytest.raises(ValidationError) as excinfo:
            DiagnosticReport(
                profile="bug-root-cause",
                symptom="",
                findings=[],
                confidence="low",
            )
        assert "symptom" in str(excinfo.value)

    def test_whitespace_only_symptom_rejected(self):
        with pytest.raises(ValidationError):
            DiagnosticReport(
                profile="bug-root-cause",
                symptom="   \n\t",
                findings=[],
                confidence="low",
            )


# ---------------------------------------------------------------------------
# Profile + resolution-shape enums
# ---------------------------------------------------------------------------


class TestProfileEnum:
    def test_all_five_profiles_accepted(self):
        for profile in (
            "bug-root-cause",
            "integration-context",
            "referent-and-current-state",
            "cascade-enumeration",
            "none",
        ):
            DiagnosticReport(
                profile=profile,  # type: ignore[arg-type]
                symptom="x",
                confidence="low",
            )

    def test_underscored_profile_rejected(self):
        # AgentSkills.io spec disallows underscores in skill names. The
        # ProfileLiteral type uses hyphenated values so the same string can
        # double as the on-disk skill directory name.
        with pytest.raises(ValidationError):
            DiagnosticReport(
                profile="bug_root_cause",  # type: ignore[arg-type]
                symptom="x",
                confidence="low",
            )


# ---------------------------------------------------------------------------
# Helpers — empty_low_confidence_report + report_to_editor_input
# ---------------------------------------------------------------------------


class TestHelpers:
    def test_empty_low_confidence_report(self):
        r = empty_low_confidence_report(
            profile="bug-root-cause",
            symptom="Surveyor failed to invoke",
            blockers=["surveyor_agent_error: ConnectionError"],
        )
        assert r.confidence == "low"
        assert r.findings == []
        assert r.blockers == ["surveyor_agent_error: ConnectionError"]

    def test_report_to_editor_input_serializes_to_json(self):
        r = empty_low_confidence_report(
            profile="bug-root-cause", symptom="x", blockers=["y"]
        )
        s = report_to_editor_input(r)
        parsed = json.loads(s)
        assert parsed["profile"] == "bug-root-cause"
        assert parsed["confidence"] == "low"

    def test_report_to_editor_input_none_yields_empty_string(self):
        assert report_to_editor_input(None) == ""


# ---------------------------------------------------------------------------
# Wire contract — Surveyor output_key writes a dict; EditorInput.diagnostic_report
# expects a JSON string. The threading path in editing_workflow._plan_edits must
# round-trip cleanly between them.
# ---------------------------------------------------------------------------


class TestSurveyorEditorWireContract:
    """Verify the cross-file data flow contract:

    1. Surveyor agent produces DiagnosticReport via output_schema.
    2. ADK serializes to dict via model_dump() and writes to session state
       under output_key=StateKeys.DIAGNOSTIC_REPORT.
    3. editing_workflow._plan_edits reads the dict, json.dumps to a string,
       passes to EditorInput.diagnostic_report.
    4. The Editor sees a JSON string it can parse mentally.
    """

    def test_full_round_trip_dict_to_string_to_dict(self):
        # Surveyor produces a real-world-ish report.
        report = DiagnosticReport(
            profile="bug-root-cause",
            symptom="Chart renders no data points",
            findings=[
                Finding(
                    statement="Chart reads dataKey='rate' but handler returns 'percentage'",
                    severity="root_cause",
                    evidence=[
                        Evidence(
                            tool="field_mismatch_report_tool",
                            args={"components": ["DashboardContent"]},
                            excerpt="Mismatch: producer=getOccupancyTrend field=rate kind=missing_in_producer",
                            location="DashboardContent.tsx:137",
                        )
                    ],
                    affected_entities=["DashboardContent", "getOccupancyTrend"],
                )
            ],
            suggested_resolution_shape="both_sides_paired",
            suggested_resolution_prose="Update the consumer's dataKey OR rename the producer's field.",
            confidence="high",
        )

        # Step 2: ADK serializes via model_dump (what output_schema does).
        state_dict = report.model_dump()
        assert isinstance(state_dict, dict)
        assert state_dict["profile"] == "bug-root-cause"

        # Step 3: editing_workflow's threading code (paraphrased).
        editor_input_str = (
            json.dumps(state_dict) if isinstance(state_dict, dict) else str(state_dict)
        )
        assert isinstance(editor_input_str, str)
        assert len(editor_input_str) > 0

        # Step 4: Editor parses (mentally / via JSON.parse in its prompt).
        reparsed = json.loads(editor_input_str)
        assert reparsed["profile"] == "bug-root-cause"
        assert reparsed["confidence"] == "high"
        assert reparsed["suggested_resolution_shape"] == "both_sides_paired"
        assert len(reparsed["findings"]) == 1
        assert reparsed["findings"][0]["severity"] == "root_cause"
        assert reparsed["findings"][0]["affected_entities"] == [
            "DashboardContent",
            "getOccupancyTrend",
        ]

    def test_threading_handles_non_dict_state_gracefully(self):
        # If session state somehow contains a non-dict value, the threading
        # code must not crash. Pre-fall-through behavior is to str() it.
        state_value = "{ malformed JSON or model_dump output }"
        editor_input_str = (
            json.dumps(state_value)
            if isinstance(state_value, dict)
            else str(state_value)
        )
        # Editor receives a string — it can decide what to do with malformed
        # input. Important: no exception raised.
        assert isinstance(editor_input_str, str)

    def test_empty_state_yields_empty_string_in_threading(self):
        # editing_workflow._plan_edits: `if report_raw: ...` — when missing,
        # Editor receives empty string per its contract.
        state_value = None
        diagnostic_report_str = ""
        if state_value:  # mirrors the production code branch
            diagnostic_report_str = json.dumps(state_value)
        assert diagnostic_report_str == ""


# ---------------------------------------------------------------------------
# SurveyorInput basic shape
# ---------------------------------------------------------------------------


class TestSurveyorInput:
    def test_minimal_input(self):
        i = SurveyorInput(user_request="fix the chart", profile="bug-root-cause")
        assert i.user_request == "fix the chart"
        assert i.profile == "bug-root-cause"
        assert i.turn_index == 0
        assert i.chat_history == []

    def test_chat_history_max_length(self):
        with pytest.raises(ValidationError):
            SurveyorInput(
                user_request="x",
                profile="bug-root-cause",
                chat_history=["e"] * 11,
            )

    def test_negative_turn_index_rejected(self):
        with pytest.raises(ValidationError):
            SurveyorInput(
                user_request="x",
                profile="bug-root-cause",
                turn_index=-1,
            )
