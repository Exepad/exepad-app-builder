"""Unit tests for ``_flip_ingested_models_to_shared``.

The helper enforces an invariant: xlsx-ingested models default to
``ownerScope = "shared"`` so seeded rows are visible to any viewer.
LLM-authored models keep their chosen scope.
"""

from __future__ import annotations

from main_agent.agents.orchestrator.app_types.webapp.workflows.creation_workflow import (
    _flip_ingested_models_to_shared,
)


class TestFlipIngestedModelsToShared:
    def test_flips_only_ingested_models(self):
        backend_config = {
            "models": [
                {"name": "customers", "ownerScope": "user"},      # ingested
                {"name": "products", "ownerScope": "user"},       # ingested
                {"name": "user_settings", "ownerScope": "user"},  # NOT ingested
            ]
        }
        origins = {"customers": "data_ingest", "products": "data_ingest"}
        flipped = _flip_ingested_models_to_shared(backend_config, origins)

        assert sorted(flipped) == ["customers", "products"]
        # Ingested → shared
        assert backend_config["models"][0]["ownerScope"] == "shared"
        assert backend_config["models"][1]["ownerScope"] == "shared"
        # Non-ingested untouched
        assert backend_config["models"][2]["ownerScope"] == "user"

    def test_leaves_already_shared_alone(self):
        # The LLM (or a prior pass) already set ownerScope=shared — no
        # double-log, no message reordering.
        backend_config = {
            "models": [
                {"name": "categories", "ownerScope": "shared"},
            ]
        }
        origins = {"categories": "data_ingest"}
        flipped = _flip_ingested_models_to_shared(backend_config, origins)
        assert flipped == []
        assert backend_config["models"][0]["ownerScope"] == "shared"

    def test_ignores_non_data_ingest_origins(self):
        # Design-import data-extraction produces models with a different
        # origin tag. Those follow the LLM's choice — they may be
        # user-scoped on purpose. Helper must NOT flip them.
        backend_config = {
            "models": [
                {"name": "tasks", "ownerScope": "user"},
            ]
        }
        origins = {"tasks": "design_extract"}
        flipped = _flip_ingested_models_to_shared(backend_config, origins)
        assert flipped == []
        assert backend_config["models"][0]["ownerScope"] == "user"

    def test_empty_origins_noop(self):
        backend_config = {
            "models": [{"name": "x", "ownerScope": "user"}]
        }
        assert _flip_ingested_models_to_shared(backend_config, {}) == []
        assert backend_config["models"][0]["ownerScope"] == "user"

    def test_none_backend_config_noop(self):
        # Backend may be absent (frontend-only app) — helper must not crash.
        assert _flip_ingested_models_to_shared(None, {"x": "data_ingest"}) == []

    def test_missing_models_key_noop(self):
        # backend_config exists but has no "models" key yet.
        assert _flip_ingested_models_to_shared({}, {"x": "data_ingest"}) == []

    def test_models_with_no_name_skipped(self):
        # Defensive: a malformed model entry without "name" can't match.
        backend_config = {
            "models": [
                {"ownerScope": "user"},  # nameless — skip
                {"name": "good", "ownerScope": "user"},
            ]
        }
        origins = {"good": "data_ingest"}
        flipped = _flip_ingested_models_to_shared(backend_config, origins)
        assert flipped == ["good"]

    def test_regression_fhx5x8rj_shape(self):
        # Mirrors the fhx5x8rj failure: 9 xlsx-ingested models, all
        # named ``sample_business_data_*``, all defaulted to user.
        backend_config = {
            "models": [
                {"name": f"sample_business_data_{n}", "ownerScope": "user"}
                for n in (
                    "categories", "customers", "products", "suppliers",
                    "employees", "orders", "orderitems", "reviews", "inventory",
                )
            ]
        }
        origins = {m["name"]: "data_ingest" for m in backend_config["models"]}
        flipped = _flip_ingested_models_to_shared(backend_config, origins)
        assert len(flipped) == 9
        assert all(m["ownerScope"] == "shared" for m in backend_config["models"])
