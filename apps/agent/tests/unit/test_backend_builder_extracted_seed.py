"""Tests for Phase 3.2's SeedDataBuilder short-circuit.

When the design-import data extractor lifts seed rows from a Babel-shell
sibling JSX (``const STUDENTS = [...]``), those rows are written DIRECTLY
to seed artifacts and the model is removed from the SeedDataBuilder LLM
input. The LLM is the source of truth ONLY for models the extractor
didn't touch.

Behaviour we pin:
  * ``_build_extracted_seed_dataset`` builds CSV-friendly records from a
    ModelPlan-shaped dict + raw rows, fills missing required values,
    auto-adds ``id`` when missing, and JSON-serialises nested values.
  * ``_save_extracted_seed_artifacts`` writes ``seed:<name>.csv`` +
    ``seed_schema:<name>.json`` and updates ``StateKeys.SEED_DATA_METADATA``.
"""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from main_agent.agents.orchestrator.app_types.shared.builders.backend_builders.backend_builder import (  # noqa: E501
    _build_extracted_seed_dataset,
    _save_extracted_seed_artifacts,
)
from main_agent.constants import StateKeys

pytestmark = [pytest.mark.unit]


# ── _build_extracted_seed_dataset ────────────────────────────────────


def test_build_extracted_seed_dataset_basic():
    model_plan = {
        "name": "students",
        "columns": [
            {"name": "id", "type": "integer", "required": True},
            {"name": "name", "type": "text", "required": True},
            {"name": "gpa", "type": "real", "required": False},
        ],
    }
    rows = [
        {"id": 1, "name": "Alice", "gpa": 3.5},
        {"id": 2, "name": "Bob", "gpa": 3.7},
    ]
    ds = _build_extracted_seed_dataset(model_plan, rows)
    assert ds is not None
    assert ds["name"] == "students"
    assert len(ds["records"]) == 2
    assert ds["records"][0] == {"id": 1, "name": "Alice", "gpa": 3.5}
    field_names = [f["name"] for f in ds["schema_fields"]]
    assert field_names == ["id", "name", "gpa"]
    types = {f["name"]: f["type"] for f in ds["schema_fields"]}
    assert types["gpa"] == "number"  # real → number
    assert types["name"] == "string"  # text → string


def test_build_extracted_seed_dataset_auto_adds_id_when_missing():
    """If the source array has no `id` field, the dataset gets a
    sequential integer id and the schema declares it first."""
    model_plan = {
        "name": "tasks",
        "columns": [
            {"name": "label", "type": "text", "required": True},
            {"name": "priority", "type": "text", "required": True},
        ],
    }
    rows = [
        {"label": "Sign forms", "priority": "high"},
        {"label": "Reply to email", "priority": "med"},
    ]
    ds = _build_extracted_seed_dataset(model_plan, rows)
    assert ds is not None
    assert ds["records"][0]["id"] == 1
    assert ds["records"][1]["id"] == 2
    # Schema lists id first.
    assert ds["schema_fields"][0]["name"] == "id"


def test_build_extracted_seed_dataset_serialises_nested_values():
    """JS object/array values get JSON-encoded for CSV friendliness
    (matches the SeedDataBuilder's 'no nested objects' rule)."""
    model_plan = {
        "name": "kpis",
        "columns": [
            {"name": "name", "type": "text", "required": True},
            {"name": "meta", "type": "json", "required": False},
        ],
    }
    rows = [
        {"name": "Retention", "meta": {"unit": "%", "delta": -0.3}},
    ]
    ds = _build_extracted_seed_dataset(model_plan, rows)
    assert ds is not None
    assert isinstance(ds["records"][0]["meta"], str)
    assert json.loads(ds["records"][0]["meta"]) == {"unit": "%", "delta": -0.3}


def test_build_extracted_seed_dataset_returns_none_for_empty_rows():
    model_plan = {"name": "x", "columns": [{"name": "id", "type": "integer"}]}
    assert _build_extracted_seed_dataset(model_plan, []) is None


def test_build_extracted_seed_dataset_converts_bool_to_int():
    """JS booleans (`{ active: true }`) become 1/0 ints in seed CSVs.
    Writing them as `True`/`False` would land as text in D1 and break
    components that filter on `column = 1`."""
    model_plan = {
        "name": "tasks",
        "columns": [
            {"name": "id", "type": "integer", "required": True},
            {"name": "done", "type": "integer", "required": True},
        ],
    }
    rows = [
        {"id": 1, "done": True},
        {"id": 2, "done": False},
    ]
    ds = _build_extracted_seed_dataset(model_plan, rows)
    assert ds is not None
    assert ds["records"][0]["done"] == 1
    assert ds["records"][1]["done"] == 0
    # Critical: integers, not Python bools (which would CSV-write as
    # the string "True").
    assert isinstance(ds["records"][0]["done"], int)
    assert not isinstance(ds["records"][0]["done"], bool)


def test_build_extracted_seed_dataset_fills_missing_required_values():
    """A row missing a required column gets a typed default — empty
    string for text, 0 for integer/real, '{}' for json. Lets the seed
    artifact validator pass instead of erroring on null in NOT NULL."""
    model_plan = {
        "name": "items",
        "columns": [
            {"name": "id", "type": "integer", "required": True},
            {"name": "name", "type": "text", "required": True},
            {"name": "qty", "type": "integer", "required": True},
        ],
    }
    rows = [
        {"id": 1, "name": "A"},  # qty missing
    ]
    ds = _build_extracted_seed_dataset(model_plan, rows)
    assert ds is not None
    assert ds["records"][0]["qty"] == 0


# ── _save_extracted_seed_artifacts ───────────────────────────────────


def _make_artifact_recorder() -> tuple[AsyncMock, list[tuple[str, bytes, str]]]:
    """Return an async mock save_artifact + a list it records into."""
    recorded: list[tuple[str, bytes, str]] = []

    async def save_artifact(*, session_id, user_id, app_name, filename, artifact):
        recorded.append((filename, artifact.inline_data.data, artifact.inline_data.mime_type))
        return 1

    mock = AsyncMock(side_effect=save_artifact)
    return mock, recorded


def _make_ctx(state: dict | None = None) -> SimpleNamespace:
    artifact_service = SimpleNamespace(save_artifact=None)
    session = SimpleNamespace(
        id="s",
        user_id="u",
        app_name="a",
        state=state if state is not None else {},
    )
    return SimpleNamespace(session=session, artifact_service=artifact_service)


def test_save_extracted_seed_artifacts_writes_csv_and_schema():
    mock_save, recorded = _make_artifact_recorder()
    ctx = _make_ctx()
    ctx.artifact_service.save_artifact = mock_save

    datasets = [
        {
            "name": "students",
            "records": [
                {"id": 1, "name": "Alice", "gpa": 3.5},
                {"id": 2, "name": "Bob", "gpa": 3.7},
            ],
            "schema_fields": [
                {"name": "id", "type": "number"},
                {"name": "name", "type": "string"},
                {"name": "gpa", "type": "number"},
            ],
        },
    ]
    asyncio.run(
        _save_extracted_seed_artifacts(ctx, datasets)
    )

    filenames = [r[0] for r in recorded]
    assert "seed:students.csv" in filenames
    assert "seed_schema:students.json" in filenames

    csv_bytes = next(b for f, b, _ in recorded if f == "seed:students.csv")
    csv_text = csv_bytes.decode("utf-8")
    assert "id,name,gpa" in csv_text
    assert "Alice" in csv_text
    assert "3.7" in csv_text


def test_save_extracted_seed_artifacts_updates_metadata():
    mock_save, _ = _make_artifact_recorder()
    ctx = _make_ctx()
    ctx.artifact_service.save_artifact = mock_save

    datasets = [
        {
            "name": "students",
            "records": [{"id": 1, "name": "Alice"}],
            "schema_fields": [
                {"name": "id", "type": "number"},
                {"name": "name", "type": "string"},
            ],
        },
    ]
    asyncio.run(
        _save_extracted_seed_artifacts(ctx, datasets)
    )
    metadata = ctx.session.state[StateKeys.SEED_DATA_METADATA]
    assert "students" in metadata
    assert metadata["students"]["record_count"] == 1
    # content_hash populated (same field LLM-path metadata carries) so
    # downstream cache invalidation works uniformly across both paths.
    assert metadata["students"]["content_hash"]
    assert len(metadata["students"]["content_hash"]) >= 8


def test_save_extracted_seed_artifacts_skips_empty_records():
    mock_save, recorded = _make_artifact_recorder()
    ctx = _make_ctx()
    ctx.artifact_service.save_artifact = mock_save

    datasets = [
        {"name": "empty", "records": [], "schema_fields": []},
        {
            "name": "has_rows",
            "records": [{"id": 1}],
            "schema_fields": [{"name": "id", "type": "number"}],
        },
    ]
    asyncio.run(
        _save_extracted_seed_artifacts(ctx, datasets)
    )
    filenames = [r[0] for r in recorded]
    # Empty dataset skipped; populated one written.
    assert "seed:empty.csv" not in filenames
    assert "seed:has_rows.csv" in filenames
