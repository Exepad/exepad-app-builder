"""Tests for ``_coerce_fk_id_types`` — pre-validation sanitization that
coerces foreign-key columns referencing ``<model>.id`` from ``text`` to
``integer`` so they match the platform's default INTEGER primary key.

Regression for app ``n1aloggh``: ``cost_items.project_id`` was declared
``"type": "text"`` and referenced ``projects.id``. SQLite does NOT
coerce text↔int in ``=`` comparisons, so the JOIN query for the
dashboard's TCO Breakdown chart returned zero rows — the chart rendered
empty. The agent docs example was misleading; the validator never
caught the type mismatch.
"""

from __future__ import annotations

import json

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_artifact_tools import (  # noqa: E501
    _coerce_fk_id_types,
)

pytestmark = [pytest.mark.unit]


class TestCoerceFkIdTypes:
    def test_coerces_text_fk_referencing_id(self):
        backend_json = json.dumps(
            {
                "mode": "dynamic",
                "models": [
                    {"name": "projects", "columns": [{"name": "name", "type": "text"}]},
                    {
                        "name": "cost_items",
                        "columns": [
                            {
                                "name": "project_id",
                                "type": "text",
                                "references": {"model": "projects", "column": "id"},
                            },
                            {"name": "amount", "type": "real"},
                        ],
                    },
                ],
            }
        )
        out, coerced = _coerce_fk_id_types(backend_json)
        config = json.loads(out)
        assert coerced == ["cost_items.project_id"]
        cols = config["models"][1]["columns"]
        assert cols[0]["type"] == "integer"
        # Non-FK column is left alone.
        assert cols[1]["type"] == "real"

    def test_leaves_already_integer_fk_alone(self):
        backend_json = json.dumps(
            {
                "models": [
                    {"name": "projects", "columns": []},
                    {
                        "name": "cost_items",
                        "columns": [
                            {
                                "name": "project_id",
                                "type": "integer",
                                "references": {"model": "projects", "column": "id"},
                            }
                        ],
                    },
                ]
            }
        )
        out, coerced = _coerce_fk_id_types(backend_json)
        assert coerced == []
        assert out == backend_json

    def test_respects_declared_text_id_on_parent(self):
        """When the parent declares its own ``id: text`` (rare — UUID
        keyed shared tables), the FK should NOT be coerced."""
        backend_json = json.dumps(
            {
                "models": [
                    {
                        "name": "tenants",
                        "columns": [{"name": "id", "type": "text"}],
                    },
                    {
                        "name": "users",
                        "columns": [
                            {
                                "name": "tenant_id",
                                "type": "text",
                                "references": {"model": "tenants", "column": "id"},
                            }
                        ],
                    },
                ]
            }
        )
        out, coerced = _coerce_fk_id_types(backend_json)
        assert coerced == []

    def test_ignores_fk_referencing_non_id_column(self):
        backend_json = json.dumps(
            {
                "models": [
                    {"name": "users", "columns": [{"name": "email", "type": "text"}]},
                    {
                        "name": "events",
                        "columns": [
                            {
                                "name": "user_email",
                                "type": "text",
                                "references": {"model": "users", "column": "email"},
                            }
                        ],
                    },
                ]
            }
        )
        out, coerced = _coerce_fk_id_types(backend_json)
        assert coerced == []

    def test_invalid_json_returns_unchanged(self):
        out, coerced = _coerce_fk_id_types("not json")
        assert coerced == []
        assert out == "not json"

    def test_handles_missing_columns_gracefully(self):
        backend_json = json.dumps({"models": [{"name": "x"}]})
        out, coerced = _coerce_fk_id_types(backend_json)
        assert coerced == []
