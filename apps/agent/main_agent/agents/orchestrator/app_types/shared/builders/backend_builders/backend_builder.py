"""
BackendBuilder — unified orchestrator for all backend generation.

Decomposes BackendPlan into focused inputs and runs model builder,
handler code builder, and seed data builder in parallel.

Supports both creation and editing modes.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, AsyncGenerator, Optional

if TYPE_CHECKING:
    from ...models.plan_models import HandlerPlan

from google.adk.agents import LlmAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event
import structlog

from config import PARALLEL_BUILD_PHASE_TIMEOUT
from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.agents.utils.helpers import push_prompt_to_next_agent
from main_agent.agents.utils.timeout_parallel_agent import TimeoutParallelAgent
from main_agent.constants import StateKeys
from main_agent.errors import PipelineError

from .backend_model_builder import BackendModelBuilderInput
from .artifact_tools import HANDLER_ARTIFACT_PREFIX
from .handler_code_generator import generate_handler_code_artifacts
from .seed_data_builder import SeedDataBuilderInput


def _build_extracted_seed_dataset(
    model_plan_dict: dict,
    rows: list[dict],
) -> dict | None:
    """Convert a (model_plan, extracted_rows) pair into a seed-artifact
    dataset entry shaped like the SeedDataBuilder LLM output.

    Returns ``{"name", "records", "schema_fields"}`` or ``None`` when
    the model has no rows. Each row's keys are normalised to the
    column names declared in ``model_plan_dict.columns`` (snake-cased
    by the data extractor before this point) and an integer ``id``
    column is added when missing.

    Type-string mapping mirrors the SeedDataBuilder's prompt rules:
    integer/real/text/json → number/number/string/json.
    """
    if not rows:
        return None
    columns = model_plan_dict.get("columns") or []
    by_name = {c.get("name"): c for c in columns if isinstance(c, dict)}

    # Build schema_fields from columns; ensure `id` is present.
    schema_fields = []
    has_id = any(c.get("name") == "id" for c in columns if isinstance(c, dict))
    if not has_id:
        schema_fields.append({"name": "id", "type": "number"})
    for col in columns:
        if not isinstance(col, dict):
            continue
        col_name = col.get("name")
        if not col_name:
            continue
        col_type = col.get("type", "text")
        ui_type = {
            "integer": "number",
            "real": "number",
            "text": "string",
            "json": "json",
            "blob": "string",
        }.get(col_type, "string")
        schema_fields.append({"name": col_name, "type": ui_type})

    # Normalise records: keep declared columns + auto-fill id.
    records: list[dict] = []
    for idx, row in enumerate(rows, start=1):
        record: dict = {}
        if not has_id and "id" not in row:
            record["id"] = idx
        for col_name, col in by_name.items():
            if col_name == "id" and not has_id:
                continue
            value = row.get(col_name)
            if value is None and col.get("required"):
                # Required column with missing value — best-effort default
                # by type so the seed validator accepts it.
                col_type = col.get("type", "text")
                if col_type == "integer" or col_type == "real":
                    value = 0
                elif col_type == "json":
                    value = "{}"
                else:
                    value = ""
            # Serialize nested dict/list as JSON string for csv-friendly
            # storage (matches SeedDataBuilder's "no nested objects" rule).
            if isinstance(value, (dict, list)):
                value = json.dumps(value, separators=(",", ":"))
            # Booleans land as 0/1 to match SeedDataBuilder's prompt rule
            # ("integer ... also used for booleans: 0=false, 1=true"). The
            # raw `True`/`False` would CSV-write as `"True"`/`"False"`,
            # which D1 stores as text strings — breaking components that
            # filter on `column = 1`.
            elif isinstance(value, bool):
                value = 1 if value else 0
            record[col_name] = value
        # Ensure id is first if it was auto-filled.
        if "id" not in record:
            record["id"] = idx
        records.append(record)

    return {
        "name": model_plan_dict["name"],
        "records": records,
        "schema_fields": schema_fields,
    }


async def _save_extracted_seed_artifacts(
    ctx: InvocationContext,
    extracted_datasets: list[dict],
) -> None:
    """Write seed:<name>.csv + seed_schema:<name>.json artifacts for each
    extracted dataset, plus update SEED_DATA_METADATA. Same shape as the
    SeedDataBuilder tool's output so AssemblyService can ingest both
    paths uniformly.
    """
    import csv as csv_mod
    import io

    import google.genai as genai

    from main_agent.agents.utils.csv_utils import compute_content_hash

    metadata = ctx.session.state.get(StateKeys.SEED_DATA_METADATA) or {}

    for ds in extracted_datasets:
        name = ds["name"]
        records = ds["records"]
        schema_fields = ds["schema_fields"]
        if not records:
            continue

        # CSV serialisation — mirror the helper used by the seed tool.
        buf = io.StringIO()
        # Use union of keys across rows to be safe with optional cols.
        fieldnames: list[str] = []
        seen: set[str] = set()
        for r in records:
            for k in r.keys():
                if k not in seen:
                    seen.add(k)
                    fieldnames.append(k)
        writer = csv_mod.DictWriter(buf, fieldnames=fieldnames)
        writer.writeheader()
        for r in records:
            writer.writerow({k: r.get(k, "") for k in fieldnames})
        csv_content = buf.getvalue()
        csv_bytes = csv_content.encode("utf-8")

        await ctx.artifact_service.save_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename=f"seed:{name}.csv",
            artifact=genai.types.Part.from_bytes(data=csv_bytes, mime_type="text/csv"),
        )

        schema_data = {"fields": schema_fields, "primaryKey": "id"}
        schema_bytes = json.dumps(schema_data, separators=(",", ":"), ensure_ascii=False).encode(
            "utf-8"
        )
        await ctx.artifact_service.save_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename=f"seed_schema:{name}.json",
            artifact=genai.types.Part.from_bytes(data=schema_bytes, mime_type="application/json"),
        )

        metadata[name] = {
            "csv_content": csv_content,
            "content_hash": compute_content_hash(csv_content),
            "records": records,
            "schema": schema_data,
            "record_count": len(records),
        }
        # Provenance — design_import vs data_ingest. The
        # extracted_seed_bridge (DataIngester path) populates
        # EXTRACTED_SEED_SOURCE before this function runs; everything
        # else falls back to 'design_import' (today's only writer).
        source_tags = ctx.session.state.get(StateKeys.EXTRACTED_SEED_SOURCE) or {}
        source_label = source_tags.get(name, "design_import")
        logger.info(
            "extracted_seed_dataset_saved",
            name=name,
            record_count=len(records),
            csv_bytes=len(csv_bytes),
            source=source_label,
        )

    ctx.session.state[StateKeys.SEED_DATA_METADATA] = metadata


def _build_storage_config(storage_plan: dict | None) -> dict | None:
    """Convert StoragePlan (agent planning) → StorageProps (runtime config).

    Maps snake_case plan fields to camelCase runtime fields and converts
    max_file_size_mb to bytes.
    """
    if not storage_plan or not storage_plan.get("enabled"):
        return None
    return {
        "enabled": True,
        "maxFileSize": storage_plan.get("max_file_size_mb", 10) * 1024 * 1024,
        "allowedMimeTypes": storage_plan.get("allowed_mime_types", ["image/*", "application/pdf"]),
        "publicAccess": storage_plan.get("public_access", False),
    }


from ...models.plan_models import ModelPlan, ColumnPlan

logger = structlog.get_logger(__name__)


def _model_config_to_plan(model_config: dict) -> ModelPlan:
    """Convert a runtime ModelConfig dict back to a ModelPlan.

    Used in edit mode to pass current models as typed objects.
    """
    columns = []
    for col in model_config.get("columns", []):
        if not isinstance(col, dict):
            continue
        ref = col.get("references")
        ref_model = None
        if isinstance(ref, dict):
            ref_model = ref.get("model")
        elif isinstance(ref, str):
            ref_model = ref

        # Accept both camelCase (persisted app config) and snake_case
        # (fresh ColumnPlan.model_dump) keys so this helper stays usable
        # from both the create and edit flows.
        raw_enum = col.get("enumValues") or col.get("enum_values")
        enum_values = (
            [str(v) for v in raw_enum] if isinstance(raw_enum, list) and raw_enum else None
        )

        columns.append(
            ColumnPlan(
                name=col.get("name", ""),
                type=col.get("type", "text"),
                required=not col.get("isNullable", False),
                is_unique=col.get("isUnique", False),
                default_value=(
                    str(col["defaultValue"]) if col.get("defaultValue") is not None else None
                ),
                references=ref_model,
                enum_values=enum_values,
            )
        )

    return ModelPlan(
        name=model_config.get("name", ""),
        columns=columns,
        owner_scope=model_config.get("ownerScope", "user"),
    )


@dataclass
class BackendBuildResult:
    """Result of backend building (creation or editing)."""

    backend_config: Optional[dict] = None
    handler_metadata: list[dict] = field(default_factory=list)
    seed_metadata: Optional[dict] = None
    handler_count: int = 0
    model_count: int = 0


def _clone_agent_with_state_input(
    original: LlmAgent,
    state_key: str,
    label: str,
) -> LlmAgent:
    """Clone an agent for parallel execution with input read from a state key."""
    base_instruction = original.instruction
    if callable(base_instruction):
        base_instruction = base_instruction(None)

    def instruction_provider(ctx, _base=base_instruction, _key=state_key):
        state_input = ctx.state.get(_key, "") if ctx else ""
        return (
            _base + "\n\n## YOUR INPUT\n"
            "Parse this JSON input and use the fields exactly as described above:\n"
            + state_input
            + "\n"
        )

    return LlmAgent(
        name=f"{original.name}_{label}",
        model=original.model,
        description=original.description,
        instruction=instruction_provider,
        input_schema=None,
        tools=original.tools,
        planner=original.planner,
        output_key=f"backend_build_result_{label}",
        # Preserve the save-loop guardrail + disabled-AFC config so the parallel
        # create clone is bounded too (the bare edit path runs the agent directly
        # and already carries these).
        before_tool_callback=original.before_tool_callback,
        after_tool_callback=original.after_tool_callback,
        generate_content_config=original.generate_content_config,
    )


def _parse_param_description(desc: str) -> dict:
    """Parse 'fieldName: type' or 'fieldName: type, required' into {name, type}.

    HandlerPlan stores inputs/outputs as plain strings (e.g. 'totalRevenue: number').
    Downstream consumers (build_backend_surface, component builders) expect dicts
    with 'name' and 'type' keys.  This bridge prevents silent data loss.
    """
    if ":" in desc:
        name, rest = desc.split(":", 1)
        type_str = rest.strip().split(",")[0].strip()
        return {"name": name.strip(), "type": type_str}
    return {"name": desc.strip(), "type": "string"}


def _param_to_str(p) -> str:
    """Inverse of _parse_param_description: turn a dict or string back into a
    HandlerPlan input/output string like 'fieldName: type'.

    Used to reconstruct a HandlerPlan.inputs/outputs list from backend.json
    handlers[] entries (which store dicts) in edit mode.
    """
    if isinstance(p, str):
        return p
    if isinstance(p, dict):
        name = p.get("name", "")
        type_ = p.get("type", "string")
        return f"{name}: {type_}"
    return str(p)


def _build_handler_metadata(handler_plans: list[dict]) -> list[dict]:
    """Mechanically derive handler metadata from BackendPlan.handlers."""
    metadata = []
    for h in handler_plans:
        metadata.append(
            {
                "name": h.get("name", ""),
                "method": h.get("name", ""),
                "summary": h.get("name", ""),
                "authLevel": h.get("auth_level", "authenticated"),
                "handlerType": h.get("handler_type", "write"),
                "inputs": [
                    _parse_param_description(inp) if isinstance(inp, str) else inp
                    for inp in h.get("inputs", [])
                ],
                "outputs": [
                    _parse_param_description(out) if isinstance(out, str) else out
                    for out in h.get("outputs", [])
                ],
            }
        )
    return metadata


class BackendBuilder:
    """Unified backend builder — orchestrates model, handler, and seed generation.

    In creation mode, decomposes BackendPlan and runs all builders in parallel.
    In edit mode, runs the model builder with modification context.
    """

    def __init__(
        self,
        backend_model_builder_agent: LlmAgent,
        backend_handler_builder_agent: LlmAgent,
        seed_data_builder_agent: Optional[LlmAgent] = None,
    ):
        self.model_builder_agent = backend_model_builder_agent
        self.handler_builder_agent = backend_handler_builder_agent
        self.seed_data_builder_agent = seed_data_builder_agent

    async def build_create(
        self,
        ctx: InvocationContext,
        backend_plan: dict,
        app_context: str = "",
        app_secondary_type: str = "website",
        needs_auth: bool = False,
    ) -> AsyncGenerator[Event, None]:
        """Run all backend builders in parallel from BackendPlan.

        Args:
            ctx: Invocation context
            backend_plan: Full BackendPlan dict from creator
            app_context: App name + description for seed data
            app_secondary_type: website, form, dataapp, or custom

        Yields:
            Events from parallel builder execution
        """
        backend_type = backend_plan.get("backend_type", "none")
        model_plans = backend_plan.get("models", [])
        handler_plans = backend_plan.get("handlers", [])
        static_datasets = backend_plan.get("static_datasets", [])

        if backend_type != "dynamic":
            # No models/handlers needed — return minimal config
            bc: dict = {"mode": backend_type}
            storage_config = _build_storage_config(backend_plan.get("storage"))
            if storage_config:
                bc["storage"] = storage_config
            self._result = BackendBuildResult(backend_config=bc)
            return

        # ── Prepare focused inputs for each builder ──

        # 1. Model builder: backend_type + model_plans + security_plan
        model_input = BackendModelBuilderInput(
            build_mode="create",
            model_plans=model_plans,
        )
        model_input_json = json.dumps(model_input.model_dump())

        # 2. Handler metadata (mechanical) + handler code builder
        handler_metadata = _build_handler_metadata(handler_plans)
        has_handlers = len(handler_plans) > 0

        # 3. Seed data: model_plans + static_datasets (typed, no intermediate format)
        # Previously suppressed whenever app_secondary_type == "website"; that
        # silently dropped the seeds design-import bundles legitimately declare
        # (e.g. a marketing site whose products page reads useModel("products")).
        # SeedDataBuilder already no-ops on empty inputs, so we only require a
        # populated model/static plan to run it.

        # Phase 3.2 — design-import data extractor produces seed rows
        # for any model whose source array literal we lifted from a
        # Babel-shell sibling. Write those rows DIRECTLY to seed
        # artifacts and exclude the model from the SeedDataBuilder
        # input — the LLM doesn't need to (and shouldn't) regenerate
        # them. The extractor is the source of truth: re-running the
        # LLM would let it "improve" the data away from the design.
        extracted_seed_rows: dict[str, list[dict]] = (
            ctx.session.state.get(StateKeys.EXTRACTED_SEED_DATA) or {}
        )
        extracted_dataset_payloads: list[dict] = []
        seed_model_plans = list(model_plans)
        if extracted_seed_rows:
            # Match by snake-case model name. ModelPlan instances at
            # this point may be Pydantic objects or plain dicts depending
            # on the upstream call site — handle both.
            def _model_name(m):
                return m.name if hasattr(m, "name") else m.get("name", "")

            extracted_names: set[str] = set()
            for mp in model_plans:
                name = _model_name(mp)
                rows = extracted_seed_rows.get(name)
                if not rows:
                    continue
                mp_dict = mp.model_dump() if hasattr(mp, "model_dump") else dict(mp)
                ds = _build_extracted_seed_dataset(mp_dict, rows)
                if ds is not None:
                    extracted_dataset_payloads.append(ds)
                    extracted_names.add(name)
            if extracted_names:
                seed_model_plans = [
                    mp for mp in model_plans if _model_name(mp) not in extracted_names
                ]
                logger.info(
                    "[BackendBuilder] Extracted seed short-circuit applied",
                    extracted=sorted(extracted_names),
                    remaining_for_llm=[_model_name(m) for m in seed_model_plans],
                )

        if extracted_dataset_payloads:
            await _save_extracted_seed_artifacts(ctx, extracted_dataset_payloads)

        has_seed_data = bool((seed_model_plans or static_datasets) and self.seed_data_builder_agent)

        seed_input_json = None
        if has_seed_data:
            seed_input = SeedDataBuilderInput(
                model_plans=seed_model_plans,
                static_datasets=static_datasets,
                app_context=app_context,
            )
            seed_input_json = json.dumps(seed_input.model_dump())

        # ── Run builders in parallel ──

        # State keys for parallel clones
        MODEL_KEY = "_backend_build_model_input"
        SEED_KEY = "_backend_build_seed_input"

        ctx.session.state[MODEL_KEY] = model_input_json
        # Reset the model save-tool counter so backend_model_save_guardrail caps
        # this build's loop (key matches backend_artifact_tools._MODEL_SAVE_CALL_KEY).
        ctx.session.state["_save_tool_calls:backend_model"] = 0
        clones = [_clone_agent_with_state_input(self.model_builder_agent, MODEL_KEY, "model")]

        if has_seed_data and seed_input_json:
            ctx.session.state[SEED_KEY] = seed_input_json
            clones.append(
                _clone_agent_with_state_input(self.seed_data_builder_agent, SEED_KEY, "seed")
            )

        clone_names = [c.name for c in clones]
        logger.info(
            "[BackendBuilder] Starting parallel backend build",
            agents=clone_names,
            has_handlers=has_handlers,
            has_seed=has_seed_data,
        )

        parallel_agent = TimeoutParallelAgent(
            name="ParallelBackendBuild",
            sub_agents=clones,
            timeout_seconds=PARALLEL_BUILD_PHASE_TIMEOUT,
        )

        try:
            async for event in parallel_agent._run_async_impl(ctx):
                yield event
        except TimeoutError as exc:
            raise PipelineError(
                f"Parallel backend build timed out after {PARALLEL_BUILD_PHASE_TIMEOUT}s",
                step_name="ParallelBackendBuild",
            ) from exc

        logger.info("[BackendBuilder] Parallel phase complete", agents=clone_names)

        # ── Load model builder artifact ──
        backend_config = None
        backend_artifact = await ArtifactManager.load_artifact_as_string(ctx, "backend.json")
        if backend_artifact:
            backend_config = json.loads(backend_artifact)

        if backend_config:
            # Inject handler metadata (derived mechanically, not from LLM)
            backend_config["handlers"] = handler_metadata
            # Inject storage config from the plan (not from backend.json artifact)
            storage_config = _build_storage_config(backend_plan.get("storage"))
            if storage_config:
                backend_config["storage"] = storage_config
            # Website + no-auth post-processing: a marketing site's product
            # catalog is inherently public. The LLM often defaults
            # crudPolicy.read to "owner" (the generic safe choice), which
            # hides the catalog from every visitor. Force "public" reads
            # when the app is a static website with no auth.
            if app_secondary_type == "website" and not needs_auth:
                changed = 0
                for model in backend_config.get("models", []):
                    crud = model.setdefault("crudPolicy", {})
                    if crud.get("read") != "public":
                        crud["read"] = "public"
                        changed += 1
                if changed:
                    logger.info(
                        "[BackendBuilder] Coerced crudPolicy.read → 'public' "
                        "for %d website model(s) with no auth requirement",
                        changed,
                    )

        # ── Run handler code builder (one LLM invocation per handler) ──
        if has_handlers and backend_config:
            logger.info(
                "[BackendBuilder] Generating handler code",
                handler_count=len(handler_plans),
            )
            # Table-reference correctness is enforced post-generation by
            # the ``handler.sql.undeclared_table`` AST rule (see
            # ``main_agent.services.validation.tsx_ast.rules``), which
            # parses the real SQL from the generated TSX. The handler
            # builder LLM sees the full model_plans list and Hard Rules
            # #1/#2/#5 forbid inventing tables, so there is nothing to
            # pre-validate.
            async for event in generate_handler_code_artifacts(
                ctx=ctx,
                handler_plans=handler_plans,
                model_plans=model_plans,
                agent_label="BackendBuilder",
            ):
                yield event

            # ── Handler read-gate cross-check ──
            # This is the one point where all three facts have REAL values: the
            # models carry a computed crudPolicy, the handler metadata carries
            # authLevel, and the handler TSX is still in the artifact store. Warn
            # when a handler can be called at a weaker auth level than the read
            # gate on a model its SQL reads (a public handler JOINing a
            # role:admin model exfiltrates it). See handler_read_gate.py.
            await self._warn_handler_read_gate_bypass(ctx, backend_config, handler_metadata)

        # ── Collect results ──
        seed_metadata = ctx.session.state.get(StateKeys.SEED_DATA_METADATA)

        self._result = BackendBuildResult(
            backend_config=backend_config,
            handler_metadata=handler_metadata,
            seed_metadata=seed_metadata,
            handler_count=len(handler_metadata),
            model_count=len(backend_config.get("models", [])) if backend_config else 0,
        )

        logger.info(
            "[BackendBuilder] Build complete",
            models=self._result.model_count,
            handlers=self._result.handler_count,
            has_seed=seed_metadata is not None,
        )

    async def _warn_handler_read_gate_bypass(
        self, ctx, backend_config: dict | None, handler_metadata: list[dict]
    ) -> None:
        """Log a warning per handler that can be called at a weaker auth level
        than the read gate on a model its SQL reads (see handler_read_gate.py).

        Best-effort + non-fatal: any failure to load a source or run the check is
        swallowed so a diagnostic can never break a build. The handler TSX is
        pulled from the artifact store here — the only place it coexists with the
        built models' crudPolicy and the handlers' authLevel.
        """
        try:
            if not backend_config:
                return
            models = backend_config.get("models") or []
            if not models or not handler_metadata:
                return
            from main_agent.services.validation.handler_read_gate import check_handler_read_gate

            sources: dict[str, str] = {}
            for h in handler_metadata:
                name = h.get("name") or h.get("method")
                if not name:
                    continue
                src = await ArtifactManager.load_artifact_as_string(
                    ctx, f"{HANDLER_ARTIFACT_PREFIX}{name}.tsx"
                )
                if src:
                    sources[name] = src

            for warning in check_handler_read_gate(models, handler_metadata, sources):
                logger.warning("[BackendBuilder] Handler read-gate: %s", warning)
        except Exception as exc:  # pragma: no cover - diagnostic must never break a build
            logger.debug("[BackendBuilder] handler read-gate check skipped: %s", exc)

    @property
    def result(self) -> BackendBuildResult:
        """Access the build result after iteration completes."""
        return getattr(self, "_result", BackendBuildResult())

    async def build_edit_models(
        self,
        ctx: InvocationContext,
        current_config: dict,
        editor_prompt: str,
    ) -> AsyncGenerator[Event, None]:
        """Edit mode: run BackendModelBuilder to modify existing models.

        Handler code is NOT touched. If handlers need updating to match the
        new schema, the caller must emit a separate ModifyHandlerAction.

        Args:
            ctx: Invocation context
            current_config: Current backend config dict (from app_config["backend"])
            editor_prompt: Free-text description of the model change

        Yields:
            Events from model builder execution
        """
        current_model_plans = [
            _model_config_to_plan(m)
            for m in current_config.get("models", [])
            if isinstance(m, dict)
        ]

        model_input = BackendModelBuilderInput(
            build_mode="edit",
            model_plans=current_model_plans,
            editor_prompt=editor_prompt,
        )

        # Reset the per-invocation save-tool counter so backend_model_save_guardrail
        # caps THIS edit's loop independently (mirrors the per-handler reset above).
        # Key matches backend_artifact_tools._MODEL_SAVE_CALL_KEY.
        ctx.session.state["_save_tool_calls:backend_model"] = 0

        await push_prompt_to_next_agent(ctx, json.dumps(model_input.model_dump()))
        async for event in self.model_builder_agent.run_async(ctx):
            yield event

        # Load updated backend artifact (models only — preserve existing handlers/storage)
        backend_config = None
        backend_artifact = await ArtifactManager.load_artifact_as_string(ctx, "backend.json")
        if backend_artifact:
            backend_config = json.loads(backend_artifact)

        # Preserve existing handlers and storage from current_config — the model
        # builder only rewrites models[], not the whole backend config.
        if backend_config is not None:
            if "handlers" not in backend_config and current_config.get("handlers"):
                backend_config["handlers"] = current_config["handlers"]
            if "storage" not in backend_config and current_config.get("storage"):
                backend_config["storage"] = current_config["storage"]

        self._result = BackendBuildResult(
            backend_config=backend_config,
            model_count=len(backend_config.get("models", [])) if backend_config else 0,
        )

        logger.info(
            "[BackendBuilder] Model edit complete",
            models=self._result.model_count,
        )

    async def build_edit_seed(
        self,
        ctx: InvocationContext,
        current_config: dict,
        target_model: str,
        editor_prompt: str,
        app_context: str = "",
    ) -> AsyncGenerator[Event, None]:
        """Edit mode: run SeedDataBuilder to apply a data-VALUE change to an
        existing model's seed rows (price edits, add/remove rows) — no schema
        change. The updated dataset flows through SEED_DATA_METADATA →
        ``inject_seed_routing`` → ``repo.seed`` → deploy reseed (preview reseeds
        the D1). Routing a data-value change here instead of BackendModelBuilder
        is what actually applies the change (the model builder only rewrites the
        schema, which a data edit leaves unchanged).
        """
        if not self.seed_data_builder_agent:
            logger.warning("[BackendBuilder] build_edit_seed skipped: no seed_data_builder_agent")
            self._result = BackendBuildResult(backend_config=current_config or None)
            return

        # Resolve the target model plan (schema + enum context for validation).
        model_dict = next(
            (
                m
                for m in (current_config.get("models") or [])
                if isinstance(m, dict) and (m.get("name") or "").lower() == target_model.lower()
            ),
            None,
        )
        if model_dict is None:
            logger.warning(
                "[BackendBuilder] build_edit_seed: target model not found",
                target_model=target_model,
            )
            self._result = BackendBuildResult(backend_config=current_config or None)
            return
        model_plan = _model_config_to_plan(model_dict)

        # Load the CURRENT seed rows (rehydrated on edit) so the builder edits
        # in place rather than regenerating the whole table.
        current_records: dict = {}
        seed_csv = await ArtifactManager.load_artifact_as_string(ctx, f"seed:{target_model}.csv")
        if seed_csv:
            try:
                import csv as _csv
                from io import StringIO

                current_records[target_model] = list(_csv.DictReader(StringIO(seed_csv)))
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[BackendBuilder] build_edit_seed: failed to parse current seed CSV",
                    target_model=target_model,
                    error=str(exc),
                )

        seed_input = SeedDataBuilderInput(
            build_mode="edit",
            model_plans=[model_plan],
            editor_prompt=editor_prompt,
            current_records=current_records,
            app_context=app_context,
        )
        seed_input_json = json.dumps(seed_input.model_dump())

        # The seed validator reads enum_values from this state key; the save
        # tool's _MAX_SEED_TOOL_CALLS cap reads its own counter. Reset both.
        ctx.session.state["_backend_build_seed_input"] = seed_input_json
        ctx.session.state["_seed_tool_total_calls"] = 0

        await push_prompt_to_next_agent(ctx, seed_input_json)
        async for event in self.seed_data_builder_agent.run_async(ctx):
            yield event

        # Seed edits never change schema — preserve the existing backend config.
        self._result = BackendBuildResult(
            backend_config=current_config if current_config else None,
            model_count=len(current_config.get("models", [])) if current_config else 0,
        )
        logger.info("[BackendBuilder] Seed edit complete", target_model=target_model)

    async def build_edit_handler(
        self,
        ctx: InvocationContext,
        current_config: dict,
        handler_name: str,
        modification_plan: str,
        new_inputs: list | None = None,
        new_outputs: list | None = None,
        new_auth_level: str | None = None,
        new_handler_type: str | None = None,
    ) -> AsyncGenerator[Event, None]:
        """Edit mode: run BackendHandlerBuilder to modify a single handler.

        Reconstructs a HandlerPlan from the current backend.handlers entry.
        When any of new_inputs/new_outputs/new_auth_level/new_handler_type is
        set, the HandlerPlan is built with the OVERRIDES — the caller is
        expected to have already patched the backend.json handlers[] entry
        deterministically and to flow the updated config back via the
        workflow's updated_backend_config cache.

        The modification_plan bullets go into HandlerPlan.logic so the
        builder sees the intent in edit mode, while `existing_handler_artifact`
        triggers load_artifacts of the current handler TSX.

        Args:
            ctx: Invocation context
            current_config: Current backend config dict
            handler_name: Name of the handler to edit (must exist in current_config["handlers"])
            modification_plan: Description of the logic change
            new_inputs: Optional replacement input list (HandlerPlan string format)
            new_outputs: Optional replacement output list
            new_auth_level: Optional new auth level
            new_handler_type: Optional new handler type ('read' or 'write')

        Yields:
            Events from handler builder execution
        """
        from ...models.plan_models import HandlerPlan
        from .backend_handler_builder import (
            BackendHandlerBuilderInput,
            backend_handler_builder_agent,
        )

        # Find the existing handler metadata
        handlers = current_config.get("handlers", []) or []
        existing = None
        for h in handlers:
            if isinstance(h, dict) and h.get("name") == handler_name:
                existing = h
                break

        if existing is None:
            logger.error(
                "[BackendBuilder] Handler not found for edit",
                handler_name=handler_name,
                available=[h.get("name") for h in handlers if isinstance(h, dict)],
            )
            self._result = BackendBuildResult()
            return

        # Apply signature overrides when set; otherwise read from existing entry
        resolved_inputs = (
            list(new_inputs)
            if new_inputs is not None
            else [_param_to_str(p) for p in existing.get("inputs", [])]
        )
        resolved_outputs = (
            list(new_outputs)
            if new_outputs is not None
            else [_param_to_str(p) for p in existing.get("outputs", [])]
        )
        resolved_auth = (
            new_auth_level
            if new_auth_level is not None
            else existing.get("authLevel", "authenticated")
        )
        resolved_type = (
            new_handler_type
            if new_handler_type is not None
            else existing.get("handlerType", "write")
        )

        handler_plan = HandlerPlan(
            name=handler_name,
            auth_level=resolved_auth,
            handler_type=resolved_type,
            inputs=resolved_inputs,
            outputs=resolved_outputs,
            logic=[modification_plan] if modification_plan else [],
        )

        current_model_plans = [
            _model_config_to_plan(m)
            for m in current_config.get("models", [])
            if isinstance(m, dict)
        ]

        # Handler plan/model consistency is enforced post-generation by
        # the ``handler.sql.undeclared_table`` AST rule on the real SQL
        # emitted by the handler builder. No pre-generation prose check —
        # the builder LLM receives the full model_plans list and is
        # forbidden from fabricating tables.

        handler_input = BackendHandlerBuilderInput(
            build_mode="edit",
            existing_handler_artifact=f"handler_code:{handler_name}.tsx",
            handler_plan=handler_plan,
            model_plans=current_model_plans,
            output_artifact_name=handler_name,
        )

        # Inject validation context so handler validator sees current models + expected outputs.
        # Full model shape (name + columns) so the SQL column-reference + enum-case
        # rules can see the schema, not just table names.
        ctx.session.state["_validation_context_models"] = [
            m.model_dump() for m in current_model_plans if m.name
        ]
        ctx.session.state["_validation_handler_expected_outputs"] = {
            handler_name: handler_plan.outputs
        }
        # Reset per-handler save-tool counter so the cap in
        # backend_handler_builder.py applies fresh for this invocation.
        ctx.session.state[f"_save_tool_calls:{handler_name}"] = 0

        await push_prompt_to_next_agent(ctx, json.dumps(handler_input.model_dump()))
        async for event in backend_handler_builder_agent.run_async(ctx):
            yield event

        # Same read-gate cross-check as the create path — an edit that regenerates
        # a handler (and can LOWER its authLevel to public) must not reintroduce a
        # model read-gate bypass.
        await self._warn_handler_read_gate_bypass(
            ctx,
            current_config,
            [
                {
                    "name": handler_name,
                    "authLevel": resolved_auth,
                    "handlerType": resolved_type,
                }
            ],
        )

        # Backend config isn't rewritten for handler edits — preserve current config
        # and report a pass-through result so the workflow keeps the existing handler metadata.
        self._result = BackendBuildResult(
            backend_config=current_config if current_config else None,
            handler_count=len(handlers),
            model_count=len(current_config.get("models", [])),
        )

        logger.info(
            "[BackendBuilder] Handler edit complete",
            handler_name=handler_name,
            signature_overridden=any(
                v is not None for v in (new_inputs, new_outputs, new_auth_level, new_handler_type)
            ),
        )

    async def build_create_handler(
        self,
        ctx: InvocationContext,
        current_config: dict,
        handler_plan: "HandlerPlan",
    ) -> AsyncGenerator[Event, None]:
        """Create mode: run BackendHandlerBuilder to generate a single new handler.

        Mirrors build_edit_handler but with build_mode='create' and no
        existing_handler_artifact — the builder generates TSX from scratch
        using the HandlerPlan's logic bullets as the spec.

        The caller is responsible for appending the new handler's metadata
        to backend.json handlers[] and refreshing updated_backend_config.

        Args:
            ctx: Invocation context
            current_config: Current backend config dict (for model_plans context)
            handler_plan: HandlerPlan instance describing the new handler
        """
        from .backend_handler_builder import (
            BackendHandlerBuilderInput,
            backend_handler_builder_agent,
        )

        current_model_plans = [
            _model_config_to_plan(m)
            for m in current_config.get("models", [])
            if isinstance(m, dict)
        ]

        # Table-reference correctness is enforced post-generation by the
        # ``handler.sql.undeclared_table`` AST rule on the real SQL the
        # handler builder emits. The builder LLM receives the full
        # current_model_plans list and is forbidden from fabricating
        # tables, so there is no pre-generation prose check to run here.

        handler_input = BackendHandlerBuilderInput(
            build_mode="create",
            handler_plan=handler_plan,
            model_plans=current_model_plans,
            output_artifact_name=handler_plan.name,
        )

        # Inject validation context. Full model shape (name + columns) so the
        # SQL column-reference + enum-case rules can see the schema, not just names.
        ctx.session.state["_validation_context_models"] = [
            m.model_dump() for m in current_model_plans if m.name
        ]
        ctx.session.state["_validation_handler_expected_outputs"] = {
            handler_plan.name: handler_plan.outputs
        }
        # Reset per-handler save-tool counter so the cap in
        # backend_handler_builder.py applies fresh for this invocation.
        ctx.session.state[f"_save_tool_calls:{handler_plan.name}"] = 0

        await push_prompt_to_next_agent(ctx, json.dumps(handler_input.model_dump()))
        async for event in backend_handler_builder_agent.run_async(ctx):
            yield event

        # Read-gate cross-check for the newly-added handler — adding a handler to
        # an existing app is the common way the bypass recurs, so it must be
        # covered here too, not only on fresh creation.
        await self._warn_handler_read_gate_bypass(
            ctx,
            current_config,
            [
                {
                    "name": handler_plan.name,
                    "authLevel": handler_plan.auth_level,
                    "handlerType": handler_plan.handler_type,
                }
            ],
        )

        self._result = BackendBuildResult(
            backend_config=current_config if current_config else None,
            handler_count=len(current_config.get("handlers", []) or []),
            model_count=len(current_config.get("models", [])),
        )

        logger.info(
            "[BackendBuilder] Handler create complete",
            handler_name=handler_plan.name,
        )
