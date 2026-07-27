"""Tests for ``_strip_system_columns`` — pre-validation sanitization that
drops accidental system-column declarations from ``backend.json`` so the
LLM doesn't burn a retry on a deterministic mistake.

Regression for app ``ky3clhzb``: BackendModelBuilder declared ``owner_id``
on two of seven models, validator hard-rejected, one full retry round-trip.
With this strip in place the same input passes validation in a single pass.
"""

from __future__ import annotations

import json

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_artifact_tools import (  # noqa: E501
    _strip_system_columns,
)

pytestmark = [pytest.mark.unit]


class TestStripSystemColumns:
    def test_strips_owner_id_declaration(self):
        backend_json = json.dumps({
            "mode": "dynamic",
            "models": [
                {
                    "name": "pets",
                    "columns": [
                        {"name": "name", "type": "string"},
                        {"name": "owner_id", "type": "text"},
                    ],
                },
            ],
        })
        out, dropped = _strip_system_columns(backend_json)
        config = json.loads(out)
        assert dropped == ["pets.owner_id"]
        assert config["models"][0]["columns"] == [
            {"name": "name", "type": "string"}
        ]

    def test_strips_all_four_system_columns(self):
        backend_json = json.dumps({
            "models": [
                {
                    "name": "x",
                    "columns": [
                        {"name": "id", "type": "integer"},
                        {"name": "created_at", "type": "datetime"},
                        {"name": "updated_at", "type": "datetime"},
                        {"name": "owner_id", "type": "text"},
                        {"name": "label", "type": "string"},
                    ],
                },
            ],
        })
        out, dropped = _strip_system_columns(backend_json)
        config = json.loads(out)
        assert sorted(dropped) == sorted(
            ["x.id", "x.created_at", "x.updated_at", "x.owner_id"]
        )
        assert config["models"][0]["columns"] == [
            {"name": "label", "type": "string"}
        ]

    def test_unchanged_when_no_system_columns_declared(self):
        backend_json = json.dumps({
            "models": [
                {"name": "tags", "columns": [{"name": "label", "type": "string"}]},
            ],
        })
        out, dropped = _strip_system_columns(backend_json)
        # Same string returned, empty drop list.
        assert out == backend_json
        assert dropped == []

    def test_strips_across_multiple_models(self):
        # Regression for ky3clhzb: models[2] (pets) and models[6] (billing)
        # both declared owner_id. Both must be cleaned in one pass.
        backend_json = json.dumps({
            "models": [
                {"name": "vets", "columns": [{"name": "name", "type": "string"}]},
                {"name": "owners", "columns": [{"name": "name", "type": "string"}]},
                {
                    "name": "pets",
                    "columns": [
                        {"name": "owner_id", "type": "text"},
                        {"name": "name", "type": "string"},
                    ],
                },
                {
                    "name": "billing",
                    "columns": [
                        {"name": "owner_id", "type": "text"},
                        {"name": "amount", "type": "number"},
                    ],
                },
            ],
        })
        out, dropped = _strip_system_columns(backend_json)
        config = json.loads(out)
        assert sorted(dropped) == ["billing.owner_id", "pets.owner_id"]
        # Other columns untouched.
        assert config["models"][2]["columns"] == [{"name": "name", "type": "string"}]
        assert config["models"][3]["columns"] == [{"name": "amount", "type": "number"}]

    def test_invalid_json_returns_input_unchanged(self):
        out, dropped = _strip_system_columns("not json {")
        assert out == "not json {"
        assert dropped == []

    def test_non_object_json_returns_input_unchanged(self):
        out, dropped = _strip_system_columns("[]")
        assert out == "[]"
        assert dropped == []

    def test_markdown_fenced_input_is_parsed(self):
        backend_json = (
            "```json\n"
            + json.dumps(
                {
                    "models": [
                        {
                            "name": "x",
                            "columns": [{"name": "owner_id", "type": "text"}],
                        }
                    ]
                }
            )
            + "\n```"
        )
        out, dropped = _strip_system_columns(backend_json)
        # When stripping happens, output is a clean JSON string (fences gone).
        assert dropped == ["x.owner_id"]
        assert json.loads(out)["models"][0]["columns"] == []
