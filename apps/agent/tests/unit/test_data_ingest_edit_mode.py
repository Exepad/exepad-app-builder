"""Unit tests for PR 4 edit-mode wiring.

Covers the pieces of the edit-mode flow that are deterministic and
LLM-free:

* ``inject_seed_routing`` honors DataIngester annotations (mode,
  batch_id, target model) and emits a batch-scoped repo.seed entry.
* ``EditingWorkflow._run_phase_ingest_data`` enforces the three safety
  rules (target model exists, ingest_name in IngestReport, no replace
  escalation).
* ``EditingWorkflow._build_existing_model_details`` produces the
  ExistingModelDetail-shaped input the DataIngester expects.

End-to-end edit-mode flow (Editor LLM → IngestDataAction → seed deploy)
is exercised manually per the plan's verification section; that's a full
integration with mocked Gemini responses and lives elsewhere.
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from main_agent.agents.orchestrator.app_types.shared.services.config_finalization import (
    inject_seed_routing,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.data_ingester import (
    IngestReport,
    ProposedColumn,
    ProposedModel,
)
from main_agent.agents.orchestrator.app_types.webapp.subagents.editor import (
    EditorOutput,
    IngestDataAction,
)
from main_agent.agents.orchestrator.app_types.webapp.workflows.editing_workflow import (
    EditingWorkflow,
    _EditPhaseState,
)
from main_agent.constants import StateKeys

pytestmark = pytest.mark.unit


# =============================================================================
# inject_seed_routing — ingest annotations
# =============================================================================


class TestInjectSeedRoutingIngestAnnotations:
    def test_replace_mode_unchanged_when_no_ingest_target(self):
        """Vanilla seed routing (no ingest metadata) keeps today's
        behavior — entry keyed by dataset name, no mode/batch_id."""
        app_config = {"backend": {"models": [{"name": "customers"}]}}
        seed_metadata = {
            "customers": {
                "csv_content": "name\nAlice",
                "content_hash": "deadbeefcafe",
                "schema": {"fields": []},
                "records": [{"name": "Alice"}],
            }
        }
        result = inject_seed_routing(app_config, seed_metadata, app_config["backend"])
        entry = result["repo"]["seed"]["customers"]
        assert entry["model"] == "customers"
        assert "mode" not in entry
        assert "batch_id" not in entry

    def test_append_target_yields_batch_scoped_key(self):
        """A seed metadata entry annotated with ingest_target_model goes
        under a batch-scoped key so it doesn't overwrite the baseline
        seed for the same model."""
        app_config = {"backend": {"models": [{"name": "customers"}]}}
        seed_metadata = {
            "customers_v2": {
                "csv_content": "name,email\nAlice,a@x",
                "content_hash": "abcdef123456",
                "schema": {"fields": []},
                "records": [{"name": "Alice", "email": "a@x"}],
                "ingest_target_model": "customers",
                "ingest_mode": "append",
                "ingest_batch_id": "5-cafef00d",
            }
        }
        result = inject_seed_routing(app_config, seed_metadata, app_config["backend"])
        seed = result["repo"]["seed"]
        # The entry sits under a batch-scoped key, never under 'customers'
        # itself (so any existing 'customers' baseline entry is safe).
        assert "customers__ingest_5-cafef00d" in seed
        assert "customers" not in seed
        entry = seed["customers__ingest_5-cafef00d"]
        assert entry["model"] == "customers"
        assert entry["mode"] == "append"
        assert entry["batch_id"] == "5-cafef00d"
        assert entry["format"] == "csv"
        assert entry["source"].endswith(".csv")

    def test_replace_mode_passes_through(self):
        app_config = {"backend": {"models": [{"name": "customers"}]}}
        seed_metadata = {
            "customers_v2": {
                "csv_content": "name\nBob",
                "content_hash": "1234567890ab",
                "schema": {"fields": []},
                "records": [{"name": "Bob"}],
                "ingest_target_model": "customers",
                "ingest_mode": "replace",
                "ingest_batch_id": "6-deadbeef",
            }
        }
        result = inject_seed_routing(app_config, seed_metadata, app_config["backend"])
        entry = result["repo"]["seed"]["customers__ingest_6-deadbeef"]
        assert entry["mode"] == "replace"

    def test_baseline_seed_coexists_with_ingest_batch(self):
        """The baseline 'customers' seed and a DataIngester append batch
        end up under different keys; both survive into repo.seed."""
        app_config = {"backend": {"models": [{"name": "customers"}]}}
        seed_metadata = {
            "customers": {  # baseline (e.g. from SeedDataBuilder)
                "csv_content": "name\nAlice",
                "content_hash": "111111111111",
                "schema": {"fields": []},
                "records": [{"name": "Alice"}],
            },
            "customers_q2": {  # user uploaded customers_q2.xlsx this turn
                "csv_content": "name\nBob",
                "content_hash": "222222222222",
                "schema": {"fields": []},
                "records": [{"name": "Bob"}],
                "ingest_target_model": "customers",
                "ingest_mode": "append",
                "ingest_batch_id": "7-q2hash",
            },
        }
        result = inject_seed_routing(app_config, seed_metadata, app_config["backend"])
        seed = result["repo"]["seed"]
        assert "customers" in seed
        assert "customers__ingest_7-q2hash" in seed
        # Two separate repo.seed entries for the same model. The
        # deploy-utils seeder applies the baseline as replace (DELETE +
        # INSERT) then the append batch as INSERT-only, both under the
        # platform seedOwnerId so the user sees all rows.
        assert "mode" not in seed["customers"]
        assert seed["customers__ingest_7-q2hash"]["mode"] == "append"


# =============================================================================
# _build_existing_model_details
# =============================================================================


class TestBuildExistingModelDetails:
    def test_extracts_name_and_columns(self):
        config = {
            "backend": {
                "models": [
                    {
                        "name": "customers",
                        "columns": [
                            {"name": "id", "type": "integer"},
                            {"name": "email", "type": "text"},
                        ],
                    }
                ]
            }
        }
        out = EditingWorkflow._build_existing_model_details(config)
        assert len(out) == 1
        assert out[0]["name"] == "customers"
        assert out[0]["columns"][1]["name"] == "email"
        assert out[0]["columns"][1]["type"] == "text"
        # Sample is empty for v1 (placeholder for future D1 probe).
        assert out[0]["columns"][1]["sample"] == ""

    def test_skips_malformed_entries(self):
        config = {
            "backend": {
                "models": [
                    {"name": "", "columns": []},
                    "not a dict",
                    {"name": "valid", "columns": [{"name": "x"}]},
                ]
            }
        }
        out = EditingWorkflow._build_existing_model_details(config)
        names = [m["name"] for m in out]
        assert names == ["valid"]

    def test_empty_config(self):
        assert EditingWorkflow._build_existing_model_details({}) == []
        assert EditingWorkflow._build_existing_model_details({"backend": {}}) == []

    def test_columns_as_dict_skipped(self):
        """Defensive: when ``columns`` is a dict instead of a list, the
        model is skipped rather than yielding garbage keys-as-columns."""
        config = {
            "backend": {
                "models": [
                    {"name": "good", "columns": [{"name": "x"}]},
                    {"name": "broken", "columns": {"x": {"type": "text"}}},
                ]
            }
        }
        out = EditingWorkflow._build_existing_model_details(config)
        assert [m["name"] for m in out] == ["good"]


# =============================================================================
# _run_phase_ingest_data — safety rules
# =============================================================================


def _make_phase_state(
    *,
    edit_plan: EditorOutput,
    existing_models: list[dict] | None = None,
) -> _EditPhaseState:
    """Build the minimum _EditPhaseState fixture for ingest-phase tests."""
    return _EditPhaseState(
        agent_name="test",
        current_config={},
        app_language_code="en",
        app_secondary_type="website",
        design_system_context="",
        pre_computed_palette=None,
        fonts={},
        image_uuid_to_url={},
        existing_backend={"models": existing_models or []},
        existing_security=None,
        existing_pages=[],
        progress_tracker=MagicMock(create_event=MagicMock(return_value=None)),
        metrics_tracker=None,
        edit_plan=edit_plan,
    )


def _make_ctx(
    *,
    seed_metadata: dict | None = None,
    ingest_report: dict | None = None,
) -> MagicMock:
    ctx = MagicMock()
    ctx.session.id = "s1"
    ctx.session.user_id = "u1"
    ctx.session.app_name = "app1"
    ctx.session.state = {
        StateKeys.SEED_DATA_METADATA: seed_metadata or {},
        StateKeys.DATA_INGEST_REPORT: ingest_report or {},
    }
    return ctx


@pytest.fixture
def fake_workflow():
    """Bare EditingWorkflow used only to invoke the phase method.

    We don't construct via __init__ because that requires a bunch of
    services; the phase method only touches ``self.validation_service``
    and ``self.data_ingester_agent`` indirectly via ``_tick``, both of
    which we can stub out via attribute assignment.
    """
    wf = EditingWorkflow.__new__(EditingWorkflow)
    wf._tick = AsyncMock()  # type: ignore[method-assign]
    return wf


def _collect_async_gen(agen):
    """Run an async generator to completion and discard events."""
    import asyncio

    async def _drain():
        out = []
        async for ev in agen:
            out.append(ev)
        return out

    return asyncio.run(_drain())


@pytest.mark.asyncio
async def test_no_ingest_actions_is_noop(fake_workflow):
    state = _make_phase_state(edit_plan=EditorOutput(reasoning=""))
    ctx = _make_ctx()
    async for _ in fake_workflow._run_phase_ingest_data(ctx, state):
        pass
    # No mutations to SEED_DATA_METADATA.
    assert ctx.session.state[StateKeys.SEED_DATA_METADATA] == {}


@pytest.mark.asyncio
async def test_target_model_not_in_backend_skipped(fake_workflow):
    """IngestDataAction targeting a non-existent backend model is dropped."""
    plan = EditorOutput(
        reasoning="",
        ingest_data_actions=[
            IngestDataAction(
                target_model_name="ghosts",
                source_rows_artifact="extracted_rows:customers_v2.json",
                source_schema_artifact="extracted_schema:customers_v2.json",
                mode="append",
                batch_id="t-1",
            )
        ],
    )
    state = _make_phase_state(
        edit_plan=plan,
        existing_models=[{"name": "customers"}],
    )
    report = IngestReport(
        proposed_models=[
            ProposedModel(
                name="customers_v2",
                source_artifact="doc:customers_v2.md",
                target_mode="append",
                target_existing_model_name="customers",
            )
        ]
    )
    ctx = _make_ctx(
        seed_metadata={"customers_v2": {"csv_content": "x"}},
        ingest_report=report.model_dump(),
    )
    async for _ in fake_workflow._run_phase_ingest_data(ctx, state):
        pass
    # Annotations NOT applied — target_model didn't exist.
    assert (
        "ingest_target_model" not in ctx.session.state[StateKeys.SEED_DATA_METADATA]["customers_v2"]
    )


@pytest.mark.asyncio
async def test_ingest_name_not_in_report_skipped(fake_workflow):
    """If the Editor hallucinates an ingest target, we refuse it."""
    plan = EditorOutput(
        reasoning="",
        ingest_data_actions=[
            IngestDataAction(
                target_model_name="customers",
                source_rows_artifact="extracted_rows:not_in_report.json",
                source_schema_artifact="extracted_schema:not_in_report.json",
                mode="append",
                batch_id="t-1",
            )
        ],
    )
    state = _make_phase_state(
        edit_plan=plan,
        existing_models=[{"name": "customers"}],
    )
    report = IngestReport(
        proposed_models=[
            ProposedModel(
                name="customers_v2",  # report has v2, action references not_in_report
                source_artifact="doc:customers_v2.md",
                target_mode="append",
                target_existing_model_name="customers",
            )
        ]
    )
    ctx = _make_ctx(
        seed_metadata={"not_in_report": {"csv_content": "x"}},
        ingest_report=report.model_dump(),
    )
    async for _ in fake_workflow._run_phase_ingest_data(ctx, state):
        pass
    assert (
        "ingest_target_model"
        not in ctx.session.state[StateKeys.SEED_DATA_METADATA]["not_in_report"]
    )


@pytest.mark.asyncio
async def test_replace_escalation_refused(fake_workflow):
    """Editor cannot upgrade append → replace without the IngestReport saying so."""
    plan = EditorOutput(
        reasoning="",
        ingest_data_actions=[
            IngestDataAction(
                target_model_name="customers",
                source_rows_artifact="extracted_rows:customers_v2.json",
                source_schema_artifact="extracted_schema:customers_v2.json",
                mode="replace",  # ← Editor escalated
                batch_id="t-1",
            )
        ],
    )
    state = _make_phase_state(
        edit_plan=plan,
        existing_models=[{"name": "customers"}],
    )
    report = IngestReport(
        proposed_models=[
            ProposedModel(
                name="customers_v2",
                source_artifact="doc:customers_v2.md",
                target_mode="append",  # ← report says append, not replace
                target_existing_model_name="customers",
            )
        ]
    )
    ctx = _make_ctx(
        seed_metadata={"customers_v2": {"csv_content": "x"}},
        ingest_report=report.model_dump(),
    )
    async for _ in fake_workflow._run_phase_ingest_data(ctx, state):
        pass
    # Replace refused → no annotations.
    assert (
        "ingest_target_model" not in ctx.session.state[StateKeys.SEED_DATA_METADATA]["customers_v2"]
    )


@pytest.mark.asyncio
async def test_happy_path_annotates_seed_metadata(fake_workflow):
    """Valid IngestDataAction → SEED_DATA_METADATA gains
    {ingest_target_model, ingest_mode, ingest_batch_id} fields."""
    plan = EditorOutput(
        reasoning="",
        ingest_data_actions=[
            IngestDataAction(
                target_model_name="customers",
                source_rows_artifact="extracted_rows:customers_v2.json",
                source_schema_artifact="extracted_schema:customers_v2.json",
                mode="append",
                batch_id="t-1",
                reasoning="user said 'merge these new ones'",
            )
        ],
    )
    state = _make_phase_state(
        edit_plan=plan,
        existing_models=[{"name": "customers"}],
    )
    report = IngestReport(
        proposed_models=[
            ProposedModel(
                name="customers_v2",
                source_artifact="doc:customers_v2.md",
                target_mode="append",
                target_existing_model_name="customers",
            )
        ]
    )
    ctx = _make_ctx(
        seed_metadata={"customers_v2": {"csv_content": "n\nA", "content_hash": "h1"}},
        ingest_report=report.model_dump(),
    )
    async for _ in fake_workflow._run_phase_ingest_data(ctx, state):
        pass
    entry = ctx.session.state[StateKeys.SEED_DATA_METADATA]["customers_v2"]
    assert entry["ingest_target_model"] == "customers"
    assert entry["ingest_mode"] == "append"
    assert entry["ingest_batch_id"] == "t-1"


@pytest.mark.asyncio
async def test_missing_data_ingest_report_refuses_all_actions(fake_workflow):
    """When session state has no DATA_INGEST_REPORT, every IngestDataAction
    is refused — the Editor shouldn't have emitted any without an ingest
    pre-pass on its input, so we refuse to mutate tables on its word
    alone."""
    plan = EditorOutput(
        reasoning="",
        ingest_data_actions=[
            IngestDataAction(
                target_model_name="customers",
                source_rows_artifact="extracted_rows:customers_v2.json",
                source_schema_artifact="extracted_schema:customers_v2.json",
                mode="append",
                batch_id="t-1",
            )
        ],
    )
    state = _make_phase_state(
        edit_plan=plan,
        existing_models=[{"name": "customers"}],
    )
    ctx = _make_ctx(
        seed_metadata={"customers_v2": {"csv_content": "x"}},
        ingest_report={},  # explicitly empty
    )
    async for _ in fake_workflow._run_phase_ingest_data(ctx, state):
        pass
    # No annotations applied — refused for safety.
    assert "ingest_target_model" not in ctx.session.state[StateKeys.SEED_DATA_METADATA][
        "customers_v2"
    ]


@pytest.mark.asyncio
async def test_replace_honored_when_report_marks_replace(fake_workflow):
    """When the IngestReport explicitly marks replace, the Editor's
    replace action is honored end-to-end."""
    plan = EditorOutput(
        reasoning="",
        ingest_data_actions=[
            IngestDataAction(
                target_model_name="customers",
                source_rows_artifact="extracted_rows:customers_v2.json",
                source_schema_artifact="extracted_schema:customers_v2.json",
                mode="replace",
                batch_id="t-1",
            )
        ],
    )
    state = _make_phase_state(
        edit_plan=plan,
        existing_models=[{"name": "customers"}],
    )
    report = IngestReport(
        proposed_models=[
            ProposedModel(
                name="customers_v2",
                source_artifact="doc:customers_v2.md",
                target_mode="replace",
                target_existing_model_name="customers",
            )
        ]
    )
    ctx = _make_ctx(
        seed_metadata={"customers_v2": {"csv_content": "x"}},
        ingest_report=report.model_dump(),
    )
    async for _ in fake_workflow._run_phase_ingest_data(ctx, state):
        pass
    entry = ctx.session.state[StateKeys.SEED_DATA_METADATA]["customers_v2"]
    assert entry["ingest_mode"] == "replace"
