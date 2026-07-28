"""Tests for normalized validation failure classification."""

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.component_failure_service import (
    get_component_failure_metadata,
)
from main_agent.constants import StateKeys
from main_agent.services.validation.failure_classification import (
    classify_validation_failure,
    contains_non_ascii_jsx_identifier,
    contains_schema_bleed,
)

pytestmark = [pytest.mark.unit]


def test_classifies_contrast_token_mismatch():
    failure_class = classify_validation_failure(
        ["Low measured contrast 1.00:1 for text #ffffff on inherited background #ffffff"]
    )

    assert failure_class == "contrast_token_mismatch"


def test_classifies_forbidden_document_api():
    failure_class = classify_validation_failure(
        ["Direct document access — use React refs instead of document.getElementById()."]
    )

    assert failure_class == "forbidden_document_api"


def test_detects_non_ascii_jsx_identifier():
    tsx = "function Demo(){ return <Badge></蔔>; }"

    assert contains_non_ascii_jsx_identifier(tsx) is True
    assert classify_validation_failure(["Unexpected closing tag"], tsx) == "jsx_tag_corruption"


def test_component_failure_metadata_prefers_detail_payload():
    reason, failure_class = get_component_failure_metadata(
        {
            StateKeys.COMPONENT_FAILURE_DETAILS: {
                "HeroSection": {
                    "first_error": "Low measured contrast 1.00:1",
                    "failure_class": "contrast_token_mismatch",
                }
            },
            "validation_failures": {"HeroSection": "fallback"},
        },
        "HeroSection",
    )

    assert reason == "Low measured contrast 1.00:1"
    assert failure_class == "contrast_token_mismatch"


def test_component_failure_metadata_recovers_from_validation_log():
    """No save-detail, but the validation log has a failed entry for this
    component → surface its real error + class (not the opaque literal)."""
    reason, failure_class = get_component_failure_metadata(
        {
            StateKeys.COMPONENT_FAILURE_DETAILS: {},
            "tsx_component_validation_log": [
                {
                    "artifact_filename": "codefocus_component:OtherCard.tsx",
                    "is_valid": False,
                    "validation_errors": ["sibling error — must not be attributed"],
                    "failure_class": "semantic_invalid",
                },
                {
                    "artifact_filename": "codefocus_component:AdoptContent.tsx",
                    "is_valid": False,
                    "validation_errors": ["Unknown model field pets.foo"],
                    "failure_class": "model_payload_mismatch",
                },
            ],
        },
        "AdoptContent",
    )

    assert reason == "Unknown model field pets.foo"
    assert failure_class == "model_payload_mismatch"


def test_component_failure_metadata_no_save_call_is_specific():
    """No detail and no log entry for the component (the true no-tool-call
    case) → a specific reason, never the opaque "builder_escalated" literal."""
    reason, failure_class = get_component_failure_metadata(
        {
            StateKeys.COMPONENT_FAILURE_DETAILS: {},
            "tsx_component_validation_log": [],
            "validation_failures": {},
        },
        "AdoptContent",
    )

    assert reason != "builder_escalated"
    assert "no save tool call" in reason.lower()
    assert failure_class == "builder_no_save"


def test_classifies_jsx_syntax_and_generic_validation_failures():
    assert classify_validation_failure(["Unexpected token '<'"]) == "jsx_syntax_error"
    assert classify_validation_failure(["Some unrelated validation message"]) == "validation_failed"


def test_non_ascii_identifier_ignores_non_letter_tags():
    tsx = "function Demo(){ return <123></123>; }"

    assert contains_non_ascii_jsx_identifier(tsx) is False


def test_detects_schema_bleed_pattern():
    leaked = '<p>Welcome to our taproom",component_name:'

    assert contains_schema_bleed(leaked) is True
    assert classify_validation_failure(["Unterminated string literal"], leaked) == "schema_bleed"


def test_schema_bleed_requires_both_error_and_source_signature():
    leaked_source = '<p>Hello",tsx_content:'
    clean_source = "function Demo(){ return <p>Hello</p>; }"

    assert classify_validation_failure(["Unexpected token '<'"], clean_source) == "jsx_syntax_error"
    assert classify_validation_failure(["Some warning"], leaked_source) == "validation_failed"


def test_schema_bleed_ignores_camelcase_object_keys():
    camel_source = 'const x = { someKey: "value" };'

    assert contains_schema_bleed(camel_source) is False
