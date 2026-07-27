"""Unit tests for the seed-data enum validation helpers.

Covers the post-generation assertion that rejects seed rows whose values
fall outside a column's declared ``enum_values``. The two helpers live in
``seed_artifact_tools.py`` and are used by the ``validate_and_save_seed_artifact``
tool right after the LLM returns its dataset JSON.
"""

import json

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.seed_artifact_tools import (
    _extract_enum_column_map,
    _validate_records_against_enums,
    _SEED_INPUT_STATE_KEY,
)

# ---------------------------------------------------------------------------
# _extract_enum_column_map — reads from session state
# ---------------------------------------------------------------------------


class TestExtractEnumColumnMap:
    def test_returns_empty_when_state_key_missing(self):
        assert _extract_enum_column_map({}) == {}

    def test_returns_empty_when_state_key_is_none(self):
        assert _extract_enum_column_map({_SEED_INPUT_STATE_KEY: None}) == {}

    def test_parses_json_string_payload(self):
        payload = {
            "model_plans": [
                {
                    "name": "requests",
                    "columns": [
                        {"name": "title", "type": "text"},
                        {
                            "name": "status",
                            "type": "text",
                            "enum_values": ["draft", "finalized"],
                        },
                    ],
                }
            ]
        }
        state = {_SEED_INPUT_STATE_KEY: json.dumps(payload)}
        result = _extract_enum_column_map(state)
        assert result == {"requests": {"status": ["draft", "finalized"]}}

    def test_accepts_dict_payload_without_reparse(self):
        payload = {
            "model_plans": [
                {
                    "name": "tasks",
                    "columns": [
                        {"name": "priority", "enum_values": ["low", "high"]},
                    ],
                }
            ]
        }
        assert _extract_enum_column_map({_SEED_INPUT_STATE_KEY: payload}) == {
            "tasks": {"priority": ["low", "high"]}
        }

    def test_skips_malformed_entries(self):
        payload = {
            "model_plans": [
                "not-a-dict",
                {"columns": [{"name": "no_model_name", "enum_values": ["x"]}]},
                {"name": "", "columns": [{"name": "status", "enum_values": ["x"]}]},
                {"name": "orders"},  # missing columns
                {
                    "name": "products",
                    "columns": [
                        "not-a-dict",
                        {"enum_values": ["x"]},  # missing col name
                        {"name": "tier"},  # no enum_values
                        {"name": "currency", "enum_values": []},  # empty list
                        {"name": "region", "enum_values": ["us", "eu"]},
                    ],
                },
            ]
        }
        result = _extract_enum_column_map({_SEED_INPUT_STATE_KEY: payload})
        assert result == {"products": {"region": ["us", "eu"]}}

    def test_returns_empty_on_unparseable_string(self):
        assert _extract_enum_column_map({_SEED_INPUT_STATE_KEY: "not-json{"}) == {}

    def test_returns_empty_on_non_dict_json(self):
        assert _extract_enum_column_map({_SEED_INPUT_STATE_KEY: "[1, 2, 3]"}) == {}

    def test_stringifies_numeric_enum_values(self):
        """Numeric enum values (e.g., priority tiers) are coerced to strings.

        Keeps parity with seed record checking, which compares the row
        value as a string against the allowed list.
        """
        payload = {
            "model_plans": [
                {
                    "name": "tiers",
                    "columns": [
                        {"name": "level", "enum_values": [1, 2, 3]},
                    ],
                }
            ]
        }
        result = _extract_enum_column_map({_SEED_INPUT_STATE_KEY: payload})
        assert result == {"tiers": {"level": ["1", "2", "3"]}}


# ---------------------------------------------------------------------------
# _validate_records_against_enums — per-row check
# ---------------------------------------------------------------------------


ENUM_MAP = {
    "requests": {
        "status": ["draft", "pending approval", "in review", "finalized"],
    },
    "tasks": {
        "priority": ["low", "medium", "high"],
    },
}


class TestValidateRecordsAgainstEnums:
    def test_no_enum_map_returns_no_errors(self):
        records = [{"id": 1, "status": "whatever"}]
        assert _validate_records_against_enums("requests", records, {}) == []

    def test_dataset_not_in_enum_map_is_noop(self):
        """Seed rows for a dataset with no enum columns pass freely."""
        records = [{"id": 1, "title": "foo"}]
        assert _validate_records_against_enums("comments", records, ENUM_MAP) == []

    def test_all_rows_valid_returns_empty(self):
        records = [
            {"id": 1, "status": "draft"},
            {"id": 2, "status": "pending approval"},
            {"id": 3, "status": "finalized"},
        ]
        assert _validate_records_against_enums("requests", records, ENUM_MAP) == []

    def test_invalid_row_produces_descriptive_error(self):
        records = [
            {"id": 1, "status": "draft"},
            {"id": 2, "status": "approved"},  # not in enum_values
        ]
        errors = _validate_records_against_enums("requests", records, ENUM_MAP)
        assert len(errors) == 1
        msg = errors[0]
        assert "requests" in msg
        assert "status" in msg
        assert "approved" in msg
        # Must surface the allowed list so the retrying LLM knows what to pick
        assert "draft" in msg
        assert "finalized" in msg

    def test_multiple_invalid_rows_report_each(self):
        records = [
            {"id": 1, "status": "draft"},
            {"id": 2, "status": "bogus"},
            {"id": 3, "status": "also-bogus"},
        ]
        errors = _validate_records_against_enums("requests", records, ENUM_MAP)
        assert len(errors) == 2
        assert any("bogus" in e for e in errors)
        assert any("also-bogus" in e for e in errors)

    def test_missing_column_in_record_is_skipped(self):
        """Records without the enum column are fine — rejection is only for

        rows that carry a *wrong* value, not for rows that omit the column
        entirely (which the schema layer handles separately).
        """
        records = [
            {"id": 1, "title": "no status here"},
            {"id": 2, "status": "draft"},
        ]
        assert _validate_records_against_enums("requests", records, ENUM_MAP) == []

    def test_none_value_is_skipped(self):
        """Explicit null values pass through — they're either NULL in D1

        or will be defaulted by the column's ``default_value``.
        """
        records = [
            {"id": 1, "status": None},
            {"id": 2, "status": "draft"},
        ]
        assert _validate_records_against_enums("requests", records, ENUM_MAP) == []

    def test_multiple_enum_columns_checked_per_row(self):
        enum_map = {
            "items": {
                "status": ["active", "archived"],
                "priority": ["low", "high"],
            }
        }
        records = [
            {"id": 1, "status": "active", "priority": "urgent"},  # priority invalid
        ]
        errors = _validate_records_against_enums("items", records, enum_map)
        assert len(errors) == 1
        assert "priority" in errors[0]
        assert "urgent" in errors[0]

    def test_non_dict_record_is_skipped(self):
        """Corrupt records (non-object entries) are not our concern here —

        they're rejected earlier in the tool's primary shape validation.
        The enum helper must not crash on them.
        """
        records = ["not-a-dict", {"id": 1, "status": "draft"}]
        assert _validate_records_against_enums("requests", records, ENUM_MAP) == []

    def test_case_sensitive_comparison(self):
        """D1 is case-sensitive; enum_values are lowercase by convention."""
        records = [{"id": 1, "status": "Draft"}]
        errors = _validate_records_against_enums("requests", records, ENUM_MAP)
        assert len(errors) == 1
        assert "Draft" in errors[0]

    def test_numeric_values_stringified_for_comparison(self):
        """Integer row values against integer-origin enum values match."""
        enum_map = {"tiers": {"level": ["1", "2", "3"]}}
        records = [{"id": 1, "level": 2}]  # int, not str
        assert _validate_records_against_enums("tiers", records, enum_map) == []
        records_bad = [{"id": 1, "level": 5}]
        errors = _validate_records_against_enums("tiers", records_bad, enum_map)
        assert len(errors) == 1
        assert "5" in errors[0]


class TestExtractEnumColumnMapCasing:
    """A Creator-authored camelCase ``enumValues`` is the runtime-enforced
    vocabulary — seed rows must comply with it. Reading only snake ``enum_values``
    let a camel-only enum silently escape seed validation."""

    def test_reads_camelcase_enum_values(self):
        payload = {
            "model_plans": [
                {
                    "name": "requests",
                    "columns": [
                        {
                            "name": "status",
                            "type": "text",
                            "enumValues": ["draft", "finalized"],
                        },
                    ],
                }
            ]
        }
        result = _extract_enum_column_map({_SEED_INPUT_STATE_KEY: payload})
        assert result == {"requests": {"status": ["draft", "finalized"]}}

    def test_snake_case_wins_when_both_present(self):
        # Both keys present: snake (the plan's canonical build-time key) is read
        # first; the OR short-circuits before camel. Either way the vocab is
        # non-empty and enforced.
        payload = {
            "model_plans": [
                {
                    "name": "requests",
                    "columns": [
                        {
                            "name": "status",
                            "enum_values": ["draft", "final"],
                            "enumValues": ["draft", "final"],
                        },
                    ],
                }
            ]
        }
        result = _extract_enum_column_map({_SEED_INPUT_STATE_KEY: payload})
        assert result == {"requests": {"status": ["draft", "final"]}}

    def test_camel_only_enum_now_enforced_against_seed_rows(self):
        """End-to-end: a camel-only enum now rejects an out-of-vocab seed row."""
        payload = {
            "model_plans": [
                {
                    "name": "requests",
                    "columns": [
                        {"name": "status", "enumValues": ["draft", "finalized"]},
                    ],
                }
            ]
        }
        enum_map = _extract_enum_column_map({_SEED_INPUT_STATE_KEY: payload})
        errors = _validate_records_against_enums(
            "requests", [{"id": 1, "status": "bogus"}], enum_map
        )
        assert len(errors) == 1
        assert "bogus" in errors[0]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
