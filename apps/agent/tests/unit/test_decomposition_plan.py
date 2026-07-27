"""Schema-level tests for ``DecompositionPlan`` / ``BackendIntent``.

These tests lock down the load-bearing invariant that the LLM-emitted
``backend_intent`` cannot ship empty column objects. Reproduced 2026-05-15
on app ``r74zfpfj``: DesignImporter (Flash) emitted
``{"name": "members", "columns": [{}]}`` for every model, the permissive
``list[dict]`` accepted it silently, and BackendBuilder produced 0 models.

Tightening ``BackendModelSpec.columns`` from ``list[dict]`` to
``list[ColumnPlan]`` makes Pydantic reject the empty objects at parse
time — the LLM must now emit a real ``name`` for every column, or the
workflow surfaces a validation error instead of silently producing a
backend-less app.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from main_agent.agents.orchestrator.app_types.shared.models.plan_models import (
    ColumnPlan,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    BackendIntent,
    BackendModelSpec,
)

pytestmark = [pytest.mark.unit]


class TestBackendModelSpecColumnValidation:
    """Schema-level guards against the design-import backend-intent regression."""

    def test_empty_column_dict_rejected(self):
        """The exact failure mode from r74zfpfj: empty `{}` columns."""
        with pytest.raises(ValidationError) as excinfo:
            BackendModelSpec(name="members", columns=[{}])
        # The error should point at the missing required `name` field.
        assert "name" in str(excinfo.value).lower()

    def test_column_without_name_rejected(self):
        """Any dict missing `name` is rejected — even with other fields set."""
        with pytest.raises(ValidationError):
            BackendModelSpec(name="members", columns=[{"type": "text"}])

    def test_well_formed_column_accepted(self):
        """Real column data parses cleanly and round-trips through model_dump."""
        spec = BackendModelSpec(
            name="members",
            columns=[
                {"name": "id", "type": "text"},
                {"name": "full_name", "type": "text", "required": True},
                {"name": "joined_at", "type": "text"},
            ],
        )
        assert len(spec.columns) == 3
        assert all(isinstance(c, ColumnPlan) for c in spec.columns)
        dumped = spec.model_dump()
        assert dumped["name"] == "members"
        assert dumped["columns"][1]["required"] is True

    def test_column_type_defaults_to_text(self):
        """`type` has a default — a column with just `name` is still valid."""
        spec = BackendModelSpec(name="x", columns=[{"name": "id"}])
        assert spec.columns[0].type == "text"

    def test_empty_columns_list_still_allowed(self):
        """An empty columns list is structurally valid (no models declared)."""
        spec = BackendModelSpec(name="placeholder", columns=[])
        assert spec.columns == []


class TestBackendIntentColumnValidation:
    """Same guard, exercised through the parent ``BackendIntent`` container."""

    def test_r74zfpfj_failure_mode_now_rejected(self):
        """Exact payload shape that shipped to app r74zfpfj.

        Three models, each with `columns: [{}]`. With the permissive
        `list[dict]` schema this used to parse and produce a backend-less
        app silently. Post-fix it raises.
        """
        payload = {
            "models": [
                {"name": "members", "columns": [{}]},
                {"name": "resources", "columns": [{}]},
                {"name": "bookings", "columns": [{}]},
            ],
            "handlers": [],
            "seeds": {},
        }
        with pytest.raises(ValidationError):
            BackendIntent(**payload)

    def test_well_formed_intent_round_trips(self):
        """Non-pathological payloads still parse and dump unchanged."""
        payload = {
            "models": [
                {
                    "name": "members",
                    "columns": [
                        {"name": "id", "type": "text"},
                        {"name": "full_name", "type": "text", "required": True},
                    ],
                }
            ],
            "handlers": [],
            "seeds": {},
        }
        intent = BackendIntent(**payload)
        assert len(intent.models) == 1
        assert intent.models[0].columns[0].name == "id"

    def test_empty_intent_still_valid(self):
        """No models/handlers/seeds is the "no backend" case — valid."""
        intent = BackendIntent()
        assert intent.models == []
        assert intent.handlers == []
        assert intent.seeds == {}
