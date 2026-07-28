"""
Shared config finalization utilities.

These functions implement the build-mode-agnostic finalization steps that run
after app config assembly in the Code Focus (TSX) flow:

- Seed data routing (D1 vs static vs frontend state)
- Auth demo user CSV generation
- Cross-validation
- UUID normalization
- Timestamp update
"""

import time
import uuid as uuid_lib
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


# =============================================================================
# Seed Data Routing
# =============================================================================


def inject_seed_routing(
    app_config: dict,
    seed_metadata: dict,
    backend_config: Optional[dict],
    agent_name: str = "Finalization",
) -> dict:
    """Route seed data to the correct config location.

    For each dataset in seed_metadata:
    - If the dataset name matches a backend model -> repo.seed (D1 target)
    - If backend mode is "dynamic" -> frontend.logic.state (reference data)
    - Otherwise -> backend.data.datasets (static mode)

    Args:
        app_config: The assembled app config dict (mutated in place)
        seed_metadata: Dict of {dataset_name: {csv_content, content_hash, schema, records}}
        backend_config: The backend config dict (for model name lookup)
        agent_name: Label for logging

    Returns:
        The mutated app_config dict
    """
    from main_agent.agents.utils.csv_utils import compute_content_hash

    backend_model_names = set()
    if backend_config:
        for m in backend_config.get("models", []):
            if isinstance(m, dict) and m.get("name"):
                backend_model_names.add(m["name"].lower())

    repo_seed = {}
    frontend_datasets = {}

    for dataset_name, meta in seed_metadata.items():
        if dataset_name.startswith("_"):
            continue

        csv_content = meta.get("csv_content", "")
        content_hash = meta.get("content_hash", compute_content_hash(csv_content))
        source_path = f"repo/seed/{dataset_name}_{content_hash[:12]}.csv"

        # DataIngester append/replace annotations (set by
        # EditingWorkflow._run_phase_ingest_data when an IngestDataAction
        # targets an existing model). The target_model field may differ
        # from dataset_name when the user's upload had a different
        # filename than the existing table — in that case we use a
        # batch-scoped repo.seed key so prior entries for the same model
        # are preserved.
        ingest_target = meta.get("ingest_target_model")
        ingest_mode = meta.get("ingest_mode")
        ingest_batch_id = meta.get("ingest_batch_id")

        if ingest_target:
            seed_entry = {
                "source": source_path,
                "source_hash": f"sha256:{content_hash[:12]}",
                "format": "csv",
                "model": ingest_target,
            }
            if ingest_mode:
                seed_entry["mode"] = ingest_mode
            if ingest_batch_id:
                seed_entry["batch_id"] = ingest_batch_id
            # Batch-scoped key — never collides with the existing seed
            # for the same model.
            entry_key = (
                f"{ingest_target}__ingest_{ingest_batch_id}"
                if ingest_batch_id
                else f"{ingest_target}__ingest_{dataset_name}"
            )
            repo_seed[entry_key] = seed_entry
        elif dataset_name.lower() in backend_model_names:
            repo_seed[dataset_name] = {
                "source": source_path,
                "source_hash": f"sha256:{content_hash[:12]}",
                "format": "csv",
                "model": dataset_name,
            }
        else:
            schema = meta.get("schema")
            records = meta.get("records", [])
            frontend_datasets[dataset_name] = {
                "type": "static",
                "records": records,
                "generated": True,
            }
            if schema:
                frontend_datasets[dataset_name]["schema"] = schema

    if repo_seed:
        repo = app_config.setdefault("repo", {})
        # MERGE into any existing seed map rather than replacing it. On create
        # this turn's seed_metadata covers every dataset, so there is nothing to
        # preserve. But on an EDIT that adds a single new seed (e.g. a new
        # ``reviews`` model), seed_metadata holds ONLY that dataset — replacing
        # would drop the base app's existing seed entries (plants/orders/…).
        # Preview survives on its persistent DB, but a fresh PUBLISHED database
        # would then seed only the new model and ship an empty catalog. Merging
        # also makes the ingest-append path above (batch-scoped keys) actually
        # preserve prior batches across turns, as its comment promises.
        # New entries win; stale entries for models later removed are screened
        # out at deploy time (the seeder skips entries whose model is gone).
        existing_seed = repo.get("seed")
        if isinstance(existing_seed, dict) and existing_seed:
            merged_seed = {**existing_seed, **repo_seed}
        else:
            merged_seed = repo_seed
        repo["seed"] = merged_seed
        logger.info(
            f"[{agent_name}] Injected repo.seed with {len(repo_seed)} new "
            f"entry/entries ({len(merged_seed)} total)"
        )

    if frontend_datasets:
        if app_config.get("backend", {}).get("mode") == "dynamic":
            logic_state = (
                app_config.setdefault("frontend", {})
                .setdefault("logic", {})
                .setdefault("state", {})
            )
            for ds_name, ds_val in frontend_datasets.items():
                logic_state[ds_name] = ds_val.get("records", [])
            logger.info(
                f"[{agent_name}] Injected {len(frontend_datasets)} static dataset(s) "
                f"into frontend.logic.state (dynamic backend)"
            )
        else:
            backend_data = (
                app_config.setdefault("backend", {"mode": "static"})
                .setdefault("data", {})
                .setdefault("datasets", {})
            )
            backend_data.update(frontend_datasets)
            logger.info(
                f"[{agent_name}] Injected backend.data.datasets with "
                f"{len(frontend_datasets)} static dataset(s)"
            )

    logger.info(
        f"[{agent_name}] Seed data routing: "
        f"{len(frontend_datasets)} static, {len(repo_seed)} D1"
    )

    return app_config


# =============================================================================
# Cross-Validation
# =============================================================================


def run_cross_validation(
    app_config: dict,
    agent_name: str = "Finalization",
) -> list[str]:
    """Run deterministic cross-validation on the assembled config.

    Args:
        app_config: The assembled app config dict (mutated in place for fixes)
        agent_name: Label for logging

    Returns:
        List of warning messages (empty if validation passed clean)
    """
    from .cross_validator import CrossValidator

    validator = CrossValidator()
    warnings = validator.validate_and_fix(app_config)
    for w in warnings:
        logger.warning(f"[{agent_name}] Cross-validation: {w}")
    logger.info(f"[{agent_name}] Cross-validation complete: {len(warnings)} warning(s)")
    return warnings


# =============================================================================
# UUID Normalization
# =============================================================================

_ROOT_SKIP_KEYS = frozenset({"uuid"})


def _is_valid_uuid(value) -> bool:
    """Check if a value is a valid UUID string."""
    if not isinstance(value, str):
        return False
    try:
        uuid_lib.UUID(value)
        return True
    except (ValueError, AttributeError):
        return False


def fix_uuids(config: dict) -> dict:
    """Recursively ensure all UUID fields in the config are valid and unique.

    Walks the entire config tree looking for keys containing 'uuid'
    (case-insensitive). Invalid or duplicate UUIDs are replaced with
    fresh UUIDv4 values.

    The root-level ``uuid`` key is an app alias/slug (not a UUIDv4)
    and is intentionally skipped.

    Args:
        config: The app config dict (mutated in place)

    Returns:
        The mutated config dict
    """
    seen_uuids: set[str] = set()
    stats = {"valid": 0, "fixed_invalid": 0, "fixed_duplicates": 0}

    def _recurse(obj, is_root: bool = False):
        if isinstance(obj, dict):
            for key, value in obj.items():
                if is_root and key in _ROOT_SKIP_KEYS:
                    continue

                if "uuid" in key.lower():
                    needs_new = False
                    reason = ""

                    if not _is_valid_uuid(value):
                        needs_new = True
                        reason = "invalid format"
                    elif value in seen_uuids:
                        needs_new = True
                        reason = "duplicate"
                    else:
                        seen_uuids.add(value)
                        stats["valid"] += 1

                    if needs_new:
                        new_uuid = str(uuid_lib.uuid4())
                        while new_uuid in seen_uuids:
                            new_uuid = str(uuid_lib.uuid4())
                        seen_uuids.add(new_uuid)
                        obj[key] = new_uuid
                        if reason == "invalid format":
                            stats["fixed_invalid"] += 1
                        else:
                            stats["fixed_duplicates"] += 1
                else:
                    _recurse(value)
        elif isinstance(obj, list):
            for item in obj:
                _recurse(item)

    _recurse(config, is_root=True)

    logger.info(
        "UUID post-processing complete",
        valid=stats["valid"],
        fixed_invalid=stats["fixed_invalid"],
        fixed_duplicates=stats["fixed_duplicates"],
        total=len(seen_uuids),
    )
    return config


# =============================================================================
# Timestamp
# =============================================================================


def update_timestamp(config: dict) -> dict:
    """Set lastUpdatedEpoch to the current time.

    Args:
        config: The app config dict (mutated in place)

    Returns:
        The mutated config dict
    """
    config["lastUpdatedEpoch"] = int(time.time())
    return config
