"""Layer 3 — bridge raw extracted artifacts → canonical seed CSVs.

Reads ``extracted_rows:{name}.json`` + ``extracted_schema:{name}.json``
(written by Layer 2A) for each model the DataIngester proposed, runs them
through the existing ``_build_extracted_seed_dataset`` + ``_save_extracted_seed_artifacts``
pair (which is also used by the design-import path), and merges the
results into ``state[EXTRACTED_SEED_DATA]`` so the downstream BackendBuilder
seed short-circuit picks them up automatically.

This is deterministic — no LLM, no agent call.
"""

from __future__ import annotations

import json
from typing import Optional

import structlog
from google.adk.agents.invocation_context import InvocationContext

from main_agent.constants import StateKeys

from ...shared.builders.backend_builders.backend_builder import (
    _build_extracted_seed_dataset,
    _save_extracted_seed_artifacts,
)

logger = structlog.get_logger(__name__)


async def _load_artifact_json(
    ctx: InvocationContext,
    filename: str,
) -> Optional[object]:
    """Load and JSON-decode a session artifact. Returns ``None`` on miss
    or decode failure — caller decides whether to fail soft or hard."""
    try:
        part = await ctx.artifact_service.load_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename=filename,
        )
    except Exception as exc:  # noqa: BLE001 — defensive across stores
        logger.warning(
            "extracted_seed_bridge.artifact_load_error",
            filename=filename,
            error=str(exc),
        )
        return None
    if part is None:
        return None
    try:
        inline = getattr(part, "inline_data", None)
        if inline is None:
            return None
        data = getattr(inline, "data", None)
        if data is None:
            return None
        return json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        logger.warning(
            "extracted_seed_bridge.artifact_decode_error",
            filename=filename,
            error=str(exc),
        )
        return None


async def bridge_extracted_artifacts_to_seed(
    ctx: InvocationContext,
    model_names: list[str],
) -> tuple[list[str], list[str]]:
    """Hydrate per-model raw artifacts into the canonical seed pipeline.

    Args:
        ctx: invocation context (artifact service + session state).
        model_names: names of models the DataIngester proposed —
            this function loads ``extracted_rows:{name}.json`` and
            ``extracted_schema:{name}.json`` for each.

    Returns:
        ``(succeeded, failed)`` — names of models that landed in
        ``EXTRACTED_SEED_DATA`` vs. names where artifact loading or
        seed-dataset construction failed.

    Side effects (per model):
        * ``state[EXTRACTED_SEED_DATA][name] = rows`` — picked up by
          BackendBuilder's seed short-circuit at backend_builder.py:445.
        * ``state[EXTRACTED_SEED_SOURCE][name] = "data_ingest"`` —
          provenance tag read by ``extracted_seed_dataset_saved``
          telemetry (PR 4).
        * ``state[SEED_DATA_METADATA][name]`` — populated by
          ``_save_extracted_seed_artifacts``.
        * ``seed:{name}.csv`` + ``seed_schema:{name}.json`` artifacts.
    """
    succeeded: list[str] = []
    failed: list[str] = []

    extracted_seed: dict[str, list[dict]] = dict(
        ctx.session.state.get(StateKeys.EXTRACTED_SEED_DATA) or {}
    )
    source_tags: dict[str, str] = dict(ctx.session.state.get(StateKeys.EXTRACTED_SEED_SOURCE) or {})

    datasets: list[dict] = []
    for name in model_names:
        rows = await _load_artifact_json(ctx, f"extracted_rows:{name}.json")
        schema = await _load_artifact_json(ctx, f"extracted_schema:{name}.json")
        if not isinstance(rows, list) or not isinstance(schema, dict):
            logger.warning(
                "extracted_seed_bridge.missing_or_malformed_artifacts",
                name=name,
                has_rows=isinstance(rows, list),
                has_schema=isinstance(schema, dict),
            )
            failed.append(name)
            continue

        dataset = _build_extracted_seed_dataset(schema, rows)
        if dataset is None:
            # Empty rows or invalid schema — soft-fail.
            failed.append(name)
            continue

        datasets.append(dataset)
        # ``EXTRACTED_SEED_DATA`` carries the raw row list (not the seed
        # dataset shape). BackendBuilder's short-circuit at line 445
        # iterates ``{name: rows}`` from this dict.
        extracted_seed[name] = list(rows)
        source_tags[name] = "data_ingest"
        succeeded.append(name)

    if datasets:
        await _save_extracted_seed_artifacts(ctx, datasets)

    ctx.session.state[StateKeys.EXTRACTED_SEED_DATA] = extracted_seed
    ctx.session.state[StateKeys.EXTRACTED_SEED_SOURCE] = source_tags

    logger.info(
        "extracted_seed_bridge.done",
        succeeded=succeeded,
        failed=failed,
    )
    return succeeded, failed
