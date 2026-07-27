"""Tests for shared config finalization utilities.

Tests cover:
- inject_seed_routing: D1 vs static vs frontend state routing
- run_cross_validation: delegation to CrossValidator
- fix_uuids: UUID normalization (invalid, duplicate, root-skip)
- update_timestamp: lastUpdatedEpoch stamping
"""

import uuid as uuid_lib
from unittest.mock import MagicMock, patch

import pytest

pytestmark = [pytest.mark.unit]

HASH_MODULE = "main_agent.agents.utils.csv_utils.compute_content_hash"
FIXED_HASH = "abc123def456deadbeef0000"


# =============================================================================
# inject_seed_routing
# =============================================================================


class TestInjectSeedRouting:
    """Tests for inject_seed_routing — routes seed data to repo.seed, backend.data, or state."""

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_dataset_matching_backend_model_goes_to_repo_seed(self, mock_hash):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        app_config = {}
        seed_metadata = {
            "products": {
                "csv_content": "id,name\n1,Widget",
                "records": [{"id": 1, "name": "Widget"}],
            }
        }
        backend_config = {"models": [{"name": "products"}]}

        result = inject_seed_routing(app_config, seed_metadata, backend_config)

        assert "repo" in result
        assert "products" in result["repo"]["seed"]
        entry = result["repo"]["seed"]["products"]
        assert entry["source"] == f"repo/seed/products_{FIXED_HASH[:12]}.csv"
        assert entry["source_hash"] == f"sha256:{FIXED_HASH[:12]}"
        assert entry["format"] == "csv"
        assert entry["model"] == "products"

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_dataset_not_matching_model_goes_to_static_datasets(self, mock_hash):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        app_config = {}
        seed_metadata = {
            "faq_items": {
                "csv_content": "q,a\nWhat?,This.",
                "records": [{"q": "What?", "a": "This."}],
                "schema": {"fields": [{"name": "q"}, {"name": "a"}]},
            }
        }
        backend_config = {"models": [{"name": "products"}]}

        result = inject_seed_routing(app_config, seed_metadata, backend_config)

        ds = result["backend"]["data"]["datasets"]["faq_items"]
        assert ds["type"] == "static"
        assert ds["records"] == [{"q": "What?", "a": "This."}]
        assert ds["generated"] is True
        assert "schema" in ds

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_dynamic_backend_mode_routes_to_frontend_logic_state(self, mock_hash):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        app_config = {"backend": {"mode": "dynamic"}}
        seed_metadata = {
            "categories": {
                "csv_content": "name\nA\nB",
                "records": [{"name": "A"}, {"name": "B"}],
            }
        }
        backend_config = {"models": []}

        result = inject_seed_routing(app_config, seed_metadata, backend_config)

        state = result["frontend"]["logic"]["state"]
        assert state["categories"] == [{"name": "A"}, {"name": "B"}]
        assert "datasets" not in result.get("backend", {}).get("data", {})

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_datasets_starting_with_underscore_are_skipped(self, mock_hash):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        app_config = {}
        seed_metadata = {
            "_internal": {"csv_content": "x\n1", "records": [{"x": 1}]},
        }
        backend_config = {"models": []}

        result = inject_seed_routing(app_config, seed_metadata, backend_config)

        assert "repo" not in result
        assert "backend" not in result or "data" not in result.get("backend", {})

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_empty_seed_metadata_no_changes(self, mock_hash):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        app_config = {"existing": True}
        result = inject_seed_routing(app_config, {}, {"models": []})

        assert result == {"existing": True}

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_edit_adding_seed_preserves_existing_repo_seed(self, mock_hash):
        """The Verdant (2026-07-10) publish defect: an edit that adds a single
        new seed (``reviews``) must NOT drop the base app's existing seed
        entries. Replacing would ship an empty catalog to a fresh published DB.
        """
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        # Base config already carries seeds for three models (as a create left it).
        app_config = {
            "repo": {
                "seed": {
                    "plants": {"source": "repo/seed/plants_old.csv", "model": "plants"},
                    "orders": {"source": "repo/seed/orders_old.csv", "model": "orders"},
                    "order_items": {
                        "source": "repo/seed/order_items_old.csv",
                        "model": "order_items",
                    },
                }
            }
        }
        # This edit only produced a reviews seed.
        seed_metadata = {
            "reviews": {
                "csv_content": "plant_id,rating\n1,5",
                "records": [{"plant_id": 1, "rating": 5}],
            }
        }
        backend_config = {
            "models": [
                {"name": "plants"},
                {"name": "orders"},
                {"name": "order_items"},
                {"name": "reviews"},
            ]
        }

        result = inject_seed_routing(app_config, seed_metadata, backend_config)

        seed = result["repo"]["seed"]
        # All four models present — the three base entries survive, reviews added.
        assert set(seed.keys()) == {"plants", "orders", "order_items", "reviews"}
        assert seed["plants"]["source"] == "repo/seed/plants_old.csv"  # untouched
        assert seed["reviews"]["model"] == "reviews"

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_reseeding_existing_model_overrides_its_entry(self, mock_hash):
        """When a turn re-seeds a model that already has an entry, the new entry
        (fresh source hash) must WIN — merge, don't accumulate stale sources."""
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        app_config = {
            "repo": {
                "seed": {"plants": {"source": "repo/seed/plants_STALE.csv", "model": "plants"}}
            }
        }
        seed_metadata = {
            "plants": {"csv_content": "id,name\n1,New", "records": [{"id": 1, "name": "New"}]}
        }
        backend_config = {"models": [{"name": "plants"}]}

        result = inject_seed_routing(app_config, seed_metadata, backend_config)

        seed = result["repo"]["seed"]
        assert list(seed.keys()) == ["plants"]
        # New entry wins — source now points at the fresh content-hashed path.
        assert seed["plants"]["source"] == f"repo/seed/plants_{FIXED_HASH[:12]}.csv"

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_no_backend_config_all_datasets_static(self, mock_hash):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        app_config = {}
        seed_metadata = {
            "items": {"csv_content": "a\n1", "records": [{"a": 1}]},
        }

        result = inject_seed_routing(app_config, seed_metadata, None)

        assert "repo" not in result
        ds = result["backend"]["data"]["datasets"]["items"]
        assert ds["type"] == "static"

    @patch(HASH_MODULE, return_value=FIXED_HASH)
    def test_model_name_matching_is_case_insensitive(self, mock_hash):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            inject_seed_routing,
        )

        app_config = {}
        seed_metadata = {
            "Orders": {"csv_content": "id\n1", "records": [{"id": 1}]},
        }
        backend_config = {"models": [{"name": "orders"}]}

        result = inject_seed_routing(app_config, seed_metadata, backend_config)

        assert "Orders" in result["repo"]["seed"]


# =============================================================================
# run_cross_validation
# =============================================================================


class TestRunCrossValidation:
    """Tests for run_cross_validation — delegates to CrossValidator."""

    @patch(
        "main_agent.agents.orchestrator.app_types.shared.services.cross_validator.CrossValidator"
    )
    def test_delegates_to_cross_validator(self, MockCrossValidator):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            run_cross_validation,
        )

        mock_instance = MagicMock()
        mock_instance.validate_and_fix.return_value = ["warning1", "warning2"]
        MockCrossValidator.return_value = mock_instance

        app_config = {"pages": []}
        warnings = run_cross_validation(app_config)

        MockCrossValidator.assert_called_once()
        mock_instance.validate_and_fix.assert_called_once_with(app_config)
        assert warnings == ["warning1", "warning2"]

    @patch(
        "main_agent.agents.orchestrator.app_types.shared.services.cross_validator.CrossValidator"
    )
    def test_returns_empty_list_when_no_warnings(self, MockCrossValidator):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            run_cross_validation,
        )

        mock_instance = MagicMock()
        mock_instance.validate_and_fix.return_value = []
        MockCrossValidator.return_value = mock_instance

        warnings = run_cross_validation({})

        assert warnings == []


# =============================================================================
# fix_uuids
# =============================================================================


class TestFixUuids:
    """Tests for fix_uuids — UUID validation, deduplication, and normalization."""

    def test_valid_unique_uuids_unchanged(self):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            fix_uuids,
        )

        uuid1 = str(uuid_lib.uuid4())
        uuid2 = str(uuid_lib.uuid4())
        config = {
            "pages": [
                {"pageUuid": uuid1},
                {"pageUuid": uuid2},
            ]
        }

        fix_uuids(config)

        assert config["pages"][0]["pageUuid"] == uuid1
        assert config["pages"][1]["pageUuid"] == uuid2

    def test_invalid_uuid_replaced(self):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            fix_uuids,
        )

        config = {"pages": [{"pageUuid": "not-a-uuid"}]}

        fix_uuids(config)

        new_val = config["pages"][0]["pageUuid"]
        assert new_val != "not-a-uuid"
        uuid_lib.UUID(new_val)  # should not raise

    def test_duplicate_uuids_second_replaced(self):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            fix_uuids,
        )

        dup = str(uuid_lib.uuid4())
        config = {
            "pages": [
                {"pageUuid": dup},
                {"pageUuid": dup},
            ]
        }

        fix_uuids(config)

        first = config["pages"][0]["pageUuid"]
        second = config["pages"][1]["pageUuid"]
        assert first == dup
        assert second != dup
        uuid_lib.UUID(second)  # valid

    def test_root_uuid_key_skipped(self):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            fix_uuids,
        )

        config = {"uuid": "my-app-slug", "pages": [{"pageUuid": str(uuid_lib.uuid4())}]}

        fix_uuids(config)

        assert config["uuid"] == "my-app-slug"

    def test_nested_uuids_in_lists_and_dicts(self):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            fix_uuids,
        )

        config = {
            "sections": [
                {
                    "components": [
                        {"componentUuid": "bad-1"},
                        {"componentUuid": "bad-2"},
                    ]
                }
            ]
        }

        fix_uuids(config)

        c1 = config["sections"][0]["components"][0]["componentUuid"]
        c2 = config["sections"][0]["components"][1]["componentUuid"]
        uuid_lib.UUID(c1)
        uuid_lib.UUID(c2)
        assert c1 != c2

    def test_case_insensitive_uuid_key_detection(self):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            fix_uuids,
        )

        config = {"pages": [{"PageUUID": "invalid"}]}

        fix_uuids(config)

        val = config["pages"][0]["PageUUID"]
        uuid_lib.UUID(val)  # should be a valid replacement


# =============================================================================
# update_timestamp
# =============================================================================


class TestUpdateTimestamp:
    """Tests for update_timestamp — sets lastUpdatedEpoch."""

    @patch("main_agent.agents.orchestrator.app_types.shared.services.config_finalization.time")
    def test_sets_last_updated_epoch(self, mock_time):
        from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
            update_timestamp,
        )

        mock_time.time.return_value = 1711500000.123
        config = {}

        result = update_timestamp(config)

        assert result["lastUpdatedEpoch"] == 1711500000
        assert result is config
