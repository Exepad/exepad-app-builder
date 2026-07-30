"""
Editing workflow.

Handles modification requests for existing apps:
1. Run editor agent → editing plan (modify/add/remove components, modify backend/logic)
2. Run skill selector for component actions (same as creation workflow)
3. Execute edit actions (rebuild modified components, add new ones, remove old ones,
   update backend/logic configs)
4. Build backend handler TSX code if backend was modified
5. Run cross-validation
6. Update app_config.json
7. Save to backend
"""

import asyncio
import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import TYPE_CHECKING, Any, AsyncGenerator, Callable, Literal, Optional

from ...shared.models.plan_models import HandlerPlan

if TYPE_CHECKING:
    from ...shared.builders.backend_builders.backend_builder import BackendBuilder

from google.adk.agents import LlmAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event
from google.genai import types as genai_types
import structlog

from ...base.base_workflow import BaseWorkflow
from ....models import ProgressTracker
from ....models.timing_tracker import MetricsTracker
from main_agent.constants import StateKeys
from config import AgentName, get_agent_model_name
from main_agent.agents.utils.helpers import (
    push_session_state_update,
    push_prompt_to_next_agent,
    safe_app_config_load,
)
from main_agent.agents.utils.artifact_manager import ArtifactManager
from ..services.codefocus_assembly_service import (
    AssemblyService,
    ComponentEntry,
)
from ..services.codefocus_post_processing import PostProcessingService
from ..subagents.editor import EditorInput, EditorOutput
from ..subagents.component_builder import ComponentBuilderInput
from ..subagents.component_builder_multiple import ComponentBuilderMultipleInput
from ..subagents.component_builder_multiple_polish_pool import (
    NUM_SLOTS as POLISH_NUM_SLOTS,
    SLOT_NAMES as POLISH_SLOT_NAMES,
    STATE_EXECUTION_COMPONENTS_POLISH,
    chunk_components as polish_chunk_actions,
    component_builder_multiple_polish_parallel,
    slot_expected_name_state_key as polish_slot_expected_name_state_key,
    slot_files_modified_state_key as polish_slot_files_modified_state_key,
    slot_input_state_key as polish_slot_input_state_key,
    slot_tool_call_state_key as polish_slot_tool_call_state_key,
)
from .frontend_build_side_effects import (
    apply_frontend_build_side_effects,
    collect_frontend_artifact_sources,
    render_action_prompt,
    snapshot_to_bare_names,
)
from ...shared.builders.backend_builders.backend_surface_builder import build_backend_surface
from ...shared.builders.logic_surface_builder import build_logic_surface
from ...shared.services.document_artifact_service import DocumentArtifactService
from ...shared.services.validation_service import ValidationService
from ..services.component_failure_service import (
    build_component_generation_failure,
    get_component_failure_metadata,
)
from ..services.theme_palette_service import (
    ThemePaletteResolutionError,
    load_and_persist_theme_palette,
)

logger = structlog.get_logger(__name__)

MAX_REPAIR_ATTEMPTS = 3

# Parses style-coverage warning strings produced by ``validate_style_coverage``:
# ``[ComponentName] Class "bg-foo" — color "foo" not in tailwind.config.extend.colors``.
# The em-dash is U+2014. The capture groups feed the styles-only escalation
# path so we know which components reference which removed tokens.
_COVERAGE_WARNING_RE = re.compile(
    r'^\[(?P<component>[^\]]+)\] Class "(?P<class>[^"]+)" — '
    r'(?:color|font) "(?P<token>[^"]+)" not in'
)


def _pretty_json(raw: str) -> str:
    """Pretty-print a JSON string, falling back to the raw value on error."""
    try:
        return json.dumps(json.loads(raw), indent=2, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return raw


def _slim_config_for_editor(current_config_str: str) -> str:
    """Strip repo.* paths/hashes from a config string for the editor LLM.

    The editor doesn't need GCS-versioned source/compiled paths, but it
    DOES need to know which components already exist so it can plan
    restore-vs-replace rather than inventing. We keep a minimal
    ``repo.frontend.components`` dict mapping each component name to
    ``{summary, source_hash, supporting_modules}`` (when present) and
    drop everything else under ``repo``. ``supporting_modules`` (Phase 2
    Babel-shell per-module) is preserved so the Editor can pick a
    component manifest. ComponentBuilderMultiple discovers supporting
    modules through the dependency graph rather than relying on the
    editor to enumerate them.

    Returns the input string unchanged if the JSON can't be parsed.
    See ``xdk89qba`` post-mortem for why editor planning needs the
    component-name list.
    """
    try:
        slim_config = json.loads(current_config_str)
    except (json.JSONDecodeError, TypeError):
        return current_config_str
    if not isinstance(slim_config, dict):
        return current_config_str

    full_repo = slim_config.pop("repo", None)
    slim_components: dict[str, dict] = {}
    if isinstance(full_repo, dict):
        fe = full_repo.get("frontend", {})
        fe_components = fe.get("components", {}) if isinstance(fe, dict) else {}
        if isinstance(fe_components, dict):
            for cname, ccfg in fe_components.items():
                if not isinstance(ccfg, dict):
                    continue
                entry: dict = {}
                if ccfg.get("summary"):
                    entry["summary"] = ccfg["summary"]
                if ccfg.get("source_hash"):
                    entry["source_hash"] = ccfg["source_hash"]
                mods = ccfg.get("supporting_modules")
                if isinstance(mods, list) and mods:
                    entry["supporting_modules"] = [
                        m for m in mods if isinstance(m, str)
                    ]
                slim_components[cname] = entry
    if slim_components:
        slim_config.setdefault("repo", {}).setdefault("frontend", {})[
            "components"
        ] = slim_components
    return json.dumps(slim_config, ensure_ascii=False)


def _format_editor_prompt(editor_input: EditorInput) -> str:
    """Format the editor input as a readable, markdown-structured prompt.

    Avoids the double-escaped JSON problem where ``current_app_config`` (a JSON
    string) gets re-escaped inside ``json.dumps(model_dump())``, producing
    unreadable ``\\"`` noise.  Instead, each JSON field is pretty-printed inside
    a fenced code block so the LLM can parse the structure at a glance.
    """
    parts: list[str] = [f"## User Request\n{editor_input.user_request}"]

    # Corrective feedback when this is a re-plan after a rejected first plan
    # (e.g. spurious ingest_data_actions). Placed high for salience.
    if getattr(editor_input, "replan_feedback", ""):
        parts.append(f"## IMPORTANT — Re-plan Feedback\n{editor_input.replan_feedback}")

    if editor_input.help_desk_reasoning:
        parts.append(f"## Help Desk Reasoning\n{editor_input.help_desk_reasoning}")

    # Surveyor grounding — load-bearing per the "GROUNDING FROM SURVEYOR"
    # section of the Editor instruction. Rendered only when the Surveyor ran
    # this turn (non-empty). Was previously built into EditorInput but never
    # rendered here, so the Editor never received it — see bug fix 2026-05-20.
    if editor_input.diagnostic_report:
        parts.append(
            f"## Diagnostic Report (Surveyor)\n```json\n"
            f"{_pretty_json(editor_input.diagnostic_report)}\n```"
        )

    parts.append(
        f"## Current App Config\n```json\n{_pretty_json(editor_input.current_app_config)}\n```"
    )

    if editor_input.selected_component_name:
        parts.append(f"## Selected Component\n**Name:** {editor_input.selected_component_name}")
    if editor_input.current_component_source:
        parts.append(
            f"## Selected Component Source\n"
            f"```tsx\n{editor_input.current_component_source}\n```"
        )
    if editor_input.current_page_uuid:
        parts.append(f"## Current Page UUID\n{editor_input.current_page_uuid}")

    parts.append(f"## App Language\n{editor_input.app_language_code}")

    # Existing backend models — lets the planner validate ingest targets and
    # ground model/handler cascades against real model names.
    if editor_input.existing_models:
        parts.append(
            f"## Existing Backend Models\n{_format_existing_models(editor_input.existing_models)}"
        )

    if editor_input.dependency_map:
        parts.append(
            f"## Dependency Map\n```json\n{_pretty_json(editor_input.dependency_map)}\n```"
        )

    # Data-upload context. ALWAYS rendered so the planner knows whether
    # ingest_data_actions are applicable this turn. Empty => explicit guard
    # (this is the signal whose absence let a plain text edit mis-route into
    # an ingest_data_action — see bug fix 2026-05-20).
    if editor_input.data_ingest_report:
        parts.append(f"## Data Upload\n{editor_input.data_ingest_report}")
    else:
        parts.append(
            "## Data Upload\n"
            "No data files were uploaded this turn. Do NOT emit `ingest_data_actions` — "
            "those apply ONLY when a tabular file was uploaded and processed by the "
            "DataIngester. A text / UI / content change to a component is ALWAYS a "
            "`frontend_build_action`."
        )

    _append_catalogs(parts, editor_input)

    return "\n\n".join(parts)


def _format_existing_models(models: list[dict]) -> str:
    """Compact one-line-per-model summary: ``- name(col:type, col:type)``."""
    lines: list[str] = []
    for model in models:
        if not isinstance(model, dict):
            continue
        name = model.get("name", "")
        cols = model.get("columns") or []
        col_str = ", ".join(
            f"{c.get('name')}:{c.get('type', 'text')}"
            for c in cols
            if isinstance(c, dict) and c.get("name")
        )
        lines.append(f"- {name}({col_str})")
    return "\n".join(lines) if lines else "(none)"


def _append_catalogs(parts: list[str], editor_input: EditorInput) -> None:
    """Append optional catalog/reference sections to the prompt parts list."""
    if editor_input.image_catalog_summary:
        parts.append(f"## Image Catalog\n{editor_input.image_catalog_summary}")
    if editor_input.document_artifact_list:
        parts.append(f"## Document Artifacts\n{', '.join(editor_input.document_artifact_list)}")
    if editor_input.large_document_list:
        large = json.dumps(editor_input.large_document_list, indent=2, ensure_ascii=False)
        parts.append(f"## Large Documents\n```json\n{large}\n```")
    if editor_input.user_referenced_images:
        parts.append(f"## User-Referenced Images\n{', '.join(editor_input.user_referenced_images)}")
    if editor_input.user_referenced_documents:
        parts.append(
            f"## User-Referenced Documents\n{', '.join(editor_input.user_referenced_documents)}"
        )
    if editor_input.user_referenced_large_documents:
        large_refs = json.dumps(
            editor_input.user_referenced_large_documents, indent=2, ensure_ascii=False
        )
        parts.append(f"## User-Referenced Large Documents\n```json\n{large_refs}\n```")


@dataclass
class _EditPhaseState:
    """Shared mutable state passed between EditingWorkflow phase methods.

    Decouples the phase implementations from the 20+ local variables that
    lived in the original inline execute() body. Phases mutate fields on
    this object; execute() reads them back for the final assembly + save.
    """

    # ── Static context (set once before phases run) ──
    agent_name: str
    current_config: dict
    app_language_code: str
    app_secondary_type: str
    design_system_context: str
    # Resolved theme tokens (parsed from theme.css). Replaces the previous
    # `raw_design_system` field that read from `app_config.frontend.designSystem` —
    # theme.css is now the sole source of truth.
    pre_computed_palette: Any
    fonts: dict[str, str]
    image_uuid_to_url: dict
    existing_backend: dict
    existing_security: Optional[dict]
    existing_pages: list[dict]
    progress_tracker: Any  # ProgressTracker
    metrics_tracker: Any  # Optional[MetricsTracker]

    # ── Mutating state (populated/updated as phases run) ──
    existing_page_list: list[dict] = field(default_factory=list)
    logic_surface: str = ""
    updated_backend_config: Optional[dict] = None
    updated_logic_config: Optional[dict] = None
    added_components: list = field(default_factory=list)
    modified_names: list[str] = field(default_factory=list)
    removed_names: list[str] = field(default_factory=list)
    removed_page_uuids: list[str] = field(default_factory=list)
    resolved_theme_palette: dict = field(default_factory=dict)
    completed_actions: int = 0
    total_actions: int = 0
    edit_plan: Optional[EditorOutput] = None
    terminal_failure_summary: Optional[str] = None
    # Dependency map computed once before editor runs; phases read it for
    # cascade pre-flight checks (e.g. remove_handler caller verification).
    dependency_map: dict[str, dict[str, list[str]]] = field(default_factory=dict)
    # Slug remap registry mutations applied during `_run_phase_frontend_build`.
    # Kept on the state for telemetry / logging but the agent owns the JSX
    # rewrite cascade now.
    slug_remaps: dict[str, str] = field(default_factory=dict)
    # Cached backend_surface JSON for the current updated_backend_config.
    # Invalidated (set to None) every time a backend phase mutates state.
    _backend_surface_cache: Optional[str] = None

    def app_context_json(self) -> str:
        return json.dumps(
            {
                "pages": self.existing_page_list,
                "app_name": self.current_config.get("name", ""),
            }
        )

    def image_urls_json(self) -> str:
        return json.dumps(self.image_uuid_to_url) if self.image_uuid_to_url else ""

    def live_backend(self) -> dict:
        return self.updated_backend_config or self.existing_backend or {}

    def backend_surface_for_builder(self) -> str:
        """Return the backend surface JSON, cached until `invalidate_backend_surface()` is called.

        Component phases call this N times (once per component) with the same
        backend state; we build the surface JSON once and reuse it until a
        backend mutation (add/modify/remove handler, change models) invalidates
        the cache.
        """
        if self._backend_surface_cache is None:
            self._backend_surface_cache = build_backend_surface(
                self.updated_backend_config or self.existing_backend,
                security_config=self.existing_security,
                app_secondary_type=self.app_secondary_type,
            )
        return self._backend_surface_cache

    def invalidate_backend_surface(self) -> None:
        """Drop the cached backend_surface. Call after any backend mutation
        so the next builder call rebuilds with the fresh state."""
        self._backend_surface_cache = None


class EditingWorkflow(BaseWorkflow):
    """
    Orchestrates editing of an existing app.

    Unlike creation, editing works with an existing app_config and
    modifies specific components based on the user's request.
    Supports backend and logic modifications in addition to component edits.
    """

    def __init__(
        self,
        editor_agent: LlmAgent,
        component_builder_agent: LlmAgent,
        component_builder_multiple_agent: LlmAgent,
        post_processing_service: PostProcessingService,
        assembly_service: AssemblyService,
        write_result_response_fn: Callable,
        # Backend builder (optional)
        logic_builder_agent: Optional[LlmAgent] = None,
        backend_builder: Optional["BackendBuilder"] = None,
        # Design system builder (for modify_styles)
        design_system_builder_agent: Optional[LlmAgent] = None,
        validation_service: Optional[ValidationService] = None,
        # DataIngester (optional). PR 4 wires this into the edit flow;
        # PR 2 just accepts it so the service registry stays uniform with
        # CreationWorkflow.
        data_ingester_agent: Optional[LlmAgent] = None,
        # Polish-mode variant. Dispatched in `_run_phase_frontend_build`
        # when `StateKeys.EDIT_PLAN_SOURCE == "design_import"` to ensure
        # the post-translation cleanup pass runs against the narrow
        # 3-skill toolset + edit-only contract. Optional for backwards
        # compatibility with callers that don't yet pass it; falls back
        # to the full agent in that case (logging a warning so
        # mis-wired test fixtures surface clearly). See Track 3 of
        # ~/.claude/plans/create-a-full-fix-modular-horizon.md.
        component_builder_polish_agent: Optional[LlmAgent] = None,
    ):
        self.editor_agent = editor_agent
        self.component_builder_agent = component_builder_agent
        self.component_builder_multiple_agent = component_builder_multiple_agent
        self.component_builder_polish_agent = component_builder_polish_agent
        self.post_processing_service = post_processing_service
        self.assembly_service = assembly_service
        self.write_result_response = write_result_response_fn
        self.logic_builder_agent = logic_builder_agent
        self.backend_builder = backend_builder
        self.design_system_builder_agent = design_system_builder_agent
        self.validation_service = validation_service or ValidationService()
        self.data_ingester_agent = data_ingester_agent

    # ═══════════════════════════════════════════════════════════════════
    # Data-ingest pre-pass helpers
    # ═══════════════════════════════════════════════════════════════════

    @staticmethod
    def _build_existing_model_details(current_config: dict) -> list[dict]:
        """Build the ``existing_models`` list for the DataIngester input.

        Each entry: ``{name, columns: [{name, type, sample}]}`` shaped to
        match ``data_ingester.ExistingModelDetail``. For v1 we leave
        ``sample`` empty — pulling samples requires a per-app D1 query
        and the semantic-overlap judgment is already valuable with name +
        type only. Future work can populate samples via the Surveyor's
        runtime probe.
        """
        backend = (current_config or {}).get("backend") or {}
        models = backend.get("models") or []
        out: list[dict] = []
        for model in models:
            if not isinstance(model, dict):
                continue
            name = model.get("name")
            if not name:
                continue
            cols: list[dict] = []
            raw_columns = model.get("columns")
            # Defensive: in malformed configs we've seen ``columns`` be a
            # dict instead of a list; iterating that yields keys (strings)
            # and explodes the next ``isinstance(col, dict)`` check
            # silently downstream. Skip the model wholesale rather than
            # try to recover with arbitrary key→value mappings.
            if not isinstance(raw_columns, list):
                logger.warning(
                    f"[EditingWorkflow] _build_existing_model_details: "
                    f"model {name!r} has non-list columns ({type(raw_columns).__name__}); "
                    f"skipping for DataIngester input"
                )
                continue
            for col in raw_columns:
                if not isinstance(col, dict) or not col.get("name"):
                    continue
                cols.append(
                    {
                        "name": col["name"],
                        "type": col.get("type", "text"),
                        "sample": "",
                    }
                )
            out.append({"name": name, "columns": cols})
        return out

    async def _run_data_ingest_pre_pass(
        self,
        ctx: InvocationContext,
        content_context,
        *,
        user_request: str,
        current_config: dict,
        app_language_code: str,
    ) -> tuple[str, list[dict]]:
        """Edit-mode counterpart of ``CreationWorkflow._run_data_ingest_pre_pass``.

        Returns ``(data_ingest_report_prose, existing_models_for_editor)``.
        Both empty when the pre-pass didn't run or soft-failed.

        Soft-fail on any error — a missing sidecar or LLM crash must not
        block an edit turn. The user just doesn't get auto-ingest.
        """
        from config import DATA_INGEST_ENABLED

        if not DATA_INGEST_ENABLED:
            return "", []
        if not self.data_ingester_agent:
            return "", []
        if not getattr(content_context, "structured_documents", None):
            return "", []

        from ..services.data_ingest_extractor import extract_all
        from ..services.extracted_seed_bridge import (
            bridge_extracted_artifacts_to_seed,
        )
        from ..subagents.data_ingester import (
            DataIngesterInput,
            ExistingModelDetail,
            IngestReport,
            report_to_editor_summary,
        )

        existing_models_dicts = self._build_existing_model_details(current_config)

        try:
            raw_models, failed_artifacts, layer2a_warnings = await extract_all(
                ctx, content_context
            )
        except Exception:  # noqa: BLE001
            logger.warning(
                "[EditingWorkflow] Data ingest Layer 2A crashed — proceeding without ingest",
                exc_info=True,
            )
            return "", existing_models_dicts

        if not raw_models:
            if failed_artifacts:
                logger.info(
                    "[EditingWorkflow] Data ingest had no usable sidecars; "
                    "skipping (failed=%s)",
                    failed_artifacts,
                )
            return "", existing_models_dicts

        # Convert existing_models_dicts → typed ExistingModelDetail list for
        # the agent input schema.
        existing_models_typed = [
            ExistingModelDetail.model_validate(m) for m in existing_models_dicts
        ]

        ingester_input = DataIngesterInput(
            user_request=user_request,
            app_name=(current_config or {}).get("name", ""),
            app_description=(current_config or {}).get("description", ""),
            mode="edit",
            raw_proposed_models=raw_models,
            failed_artifacts=failed_artifacts,
            warnings=layer2a_warnings,
            existing_models=existing_models_typed,
        )
        await push_prompt_to_next_agent(ctx, ingester_input.model_dump_json())

        try:
            async for _event in self.validation_service._run_agent_with_retry(
                ctx,
                self.data_ingester_agent,
                AgentName.DATA_INGESTER.value,
                1,
            ):
                pass
        except Exception:  # noqa: BLE001
            logger.warning(
                "[EditingWorkflow] DataIngester LLM crashed — falling back to mechanical models",
                exc_info=True,
            )
            report = IngestReport(
                proposed_models=raw_models,
                failed_artifacts=failed_artifacts,
                warnings=layer2a_warnings,
                confidence="low",
                domain_hints="",
            )
            ctx.session.state[StateKeys.DATA_INGEST_REPORT] = report.model_dump()
        else:
            raw = ctx.session.state.get(StateKeys.DATA_INGEST_REPORT) or {}
            if isinstance(raw, IngestReport):
                report = raw
            elif isinstance(raw, dict):
                try:
                    report = IngestReport.model_validate(raw)
                except Exception:  # noqa: BLE001
                    logger.warning(
                        "[EditingWorkflow] DataIngester returned malformed report; "
                        "falling back to raw Layer 2A output",
                        exc_info=True,
                    )
                    report = IngestReport(
                        proposed_models=raw_models,
                        failed_artifacts=failed_artifacts,
                        warnings=layer2a_warnings,
                        confidence="low",
                        domain_hints="",
                    )
            else:
                report = IngestReport(
                    proposed_models=raw_models,
                    failed_artifacts=failed_artifacts,
                    warnings=layer2a_warnings,
                    confidence="low",
                    domain_hints="",
                )

        # Persist as turn-scoped artifact for cross-turn lookup.
        try:
            turn_index = ctx.session.state.get(StateKeys.DIAGNOSTIC_TURN_INDEX, 0) or 0
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=f"data_ingest_report:{int(turn_index)}.json",
                artifact=genai_types.Part.from_bytes(
                    data=report.model_dump_json().encode("utf-8"),
                    mime_type="application/json",
                ),
            )
        except Exception:  # noqa: BLE001
            logger.warning(
                "[EditingWorkflow] Failed to persist data_ingest_report artifact",
                exc_info=True,
            )

        try:
            await bridge_extracted_artifacts_to_seed(
                ctx, [m.name for m in report.proposed_models]
            )
        except Exception:  # noqa: BLE001
            logger.warning(
                "[EditingWorkflow] extracted_seed_bridge crashed — seed data may be incomplete",
                exc_info=True,
            )

        return report_to_editor_summary(report), existing_models_dicts

    # ═══════════════════════════════════════════════════════════════════
    # Main execute() — slim dispatcher over extracted phase methods
    # ═══════════════════════════════════════════════════════════════════

    async def execute(
        self,
        ctx: InvocationContext,
        progress_tracker: ProgressTracker,
        metrics_tracker: Optional[MetricsTracker] = None,
        sub_action: str = "generic_request",
    ) -> AsyncGenerator[Event, None]:
        """Execute the editing workflow."""
        agent_name = "Editing"

        await push_session_state_update(
            ctx,
            {
                StateKeys.UNRESOLVED_COMPONENTS: {},
                StateKeys.COMPONENT_FAILURE_DETAILS: {},
                StateKeys.VALIDATION_FAILURE_CLASSES: {},
                StateKeys.VALIDATION_FAILURE_DETAILS: {},
                StateKeys.SYSTEMIC_VALIDATION_ABORT: None,
                "validation_failures": {},
            },
        )

        current_config_str = self._load_config_str(ctx, agent_name)
        if current_config_str is None:
            yield progress_tracker.create_event(
                ctx, "error", internal_message="No app configuration found."
            )
            return
        current_config = json.loads(current_config_str)

        if sub_action == "quick_remove":
            async for event in self._execute_quick_remove(
                ctx, current_config, progress_tracker, agent_name
            ):
                yield event
            return

        state = await self._prepare_phase_state(
            ctx, current_config, progress_tracker, metrics_tracker, agent_name
        )
        if state.terminal_failure_summary:
            return

        async for event in self._plan_edits(ctx, state, current_config_str):
            yield event

        if state.edit_plan is None or state.total_actions == 0:
            return

        yield progress_tracker.create_event(
            ctx, "building_components", internal_message="Applying edits"
        )
        phase_runners = [
            self._run_phase_modify_styles,
            self._run_phase_change_backend_models,
            # Edit-seed-data runs after change_backend_models so a value edit
            # targets the post-schema model. Routes data-VALUE changes to the
            # seed builder (not the schema builder, which would no-op).
            self._run_phase_edit_seed_data,
            # Ingest must run after change_backend_models so any new
            # 'create' models exist on app_config before an append/replace
            # references them.
            self._run_phase_ingest_data,
            self._run_phase_modify_logic,
            self._run_phase_add_handler,
            self._run_phase_modify_handler,
            self._run_phase_remove_handler,
            self._run_phase_rename_page_title,
            self._run_phase_frontend_build,
        ]
        for runner in phase_runners:
            async for event in runner(ctx, state):
                yield event
            if state.terminal_failure_summary:
                return

        async for event in self._run_batch_validation(ctx, current_config, state):
            yield event
        if state.terminal_failure_summary:
            return

        user_request = ctx.session.state.get(StateKeys.CURRENT_PROMPT, "")
        async for event in self._assemble_and_save(ctx, current_config, state, user_request):
            yield event

    # ═══════════════════════════════════════════════════════════════════
    # Setup helpers
    # ═══════════════════════════════════════════════════════════════════

    @staticmethod
    def _load_config_str(ctx: InvocationContext, agent_name: str) -> Optional[str]:
        loaded = safe_app_config_load(ctx, StateKeys.APP_CONFIG, agent_name, "string")
        if not loaded:
            logger.error(f"[{agent_name}] No app config found in session state")
            return None
        return loaded if isinstance(loaded, str) else json.dumps(loaded)

    async def _prepare_phase_state(
        self,
        ctx: InvocationContext,
        current_config: dict,
        progress_tracker: ProgressTracker,
        metrics_tracker: Optional[MetricsTracker],
        agent_name: str,
    ) -> _EditPhaseState:
        """Build the shared phase state object from current_config + session state."""
        existing_backend = current_config.get("backend", {}) or {}
        existing_logic = current_config.get("frontend", {}).get("logic", {}) or {}
        existing_pages = current_config.get("frontend", {}).get("pages", []) or []
        existing_security = current_config.get("security")
        existing_page_list = [
            {"title": p.get("title", ""), "slug": p.get("slug", "/")}
            for p in existing_pages
            if isinstance(p, dict)
        ]

        image_catalog = ctx.session.state.get("image_catalog", []) or []
        image_uuid_to_url = {
            img.get("uuid"): img.get("url")
            for img in image_catalog
            if img.get("uuid") and img.get("url")
        }

        # `security_enabled` mirrors the runtime's interpretation
        # (top-level ``security`` present + ``enabled != False``) so the
        # ``dead_signout`` fixer can inject a missing Sign-Out control when
        # editing an auth-enabled app's sidebar. ``_refresh_validation_context``
        # below omits this key; push_session_state_update merges, so the value
        # set here survives every mid-edit refresh.
        security_enabled = bool(
            isinstance(existing_security, dict) and existing_security.get("enabled") is not False
        )
        await push_session_state_update(
            ctx,
            {
                "_validation_context_models": existing_backend.get("models", []),
                "_validation_context_handlers": existing_backend.get("handlers", []),
                "_validation_context_logic": existing_logic,
                "_validation_context_security_enabled": security_enabled,
                "_validation_context_theme_palette": ctx.session.state.get(
                    StateKeys.RESOLVED_THEME_PALETTE, {}
                ),
                "_validation_context_page_slugs": [
                    p.get("slug", "/") for p in existing_pages if isinstance(p, dict)
                ],
                "_validation_context_services": current_config.get("services", {}) or {},
            },
        )

        # Rehydrate component + handler TSX sources from GCS into the session's
        # artifact store. Previous-turn artifacts may still exist, so this step
        # refreshes the working copies from durable GCS before downstream code
        # reads them.
        #
        # We deliberately do NOT swallow missing blobs silently — we
        # capture the list of components/handlers whose source couldn't
        # be rehydrated and pass it to the plan/execute phases so they
        # Rehydrate component/handler/style sources from GCS into the
        # session artifact store. Missing component blobs are replaced
        # with empty stubs by the rehydration service so the editor can
        # treat every component uniformly.
        #
        # Design-import branch: skip rehydration entirely. The mechanical
        # translator, BackendBuilder.build_create, and the decomposition
        # runner have all just saved fresh artifacts to the session's
        # artifact store, and on a first deploy GCS holds nothing. Running
        # rehydration here would overwrite the fresh in-memory TSX with
        # stubs (GCS returns None → _make_component_stub → _save_artifact),
        # which then cascades into ComponentBuilderMultiple hitting the
        # 25-tool-call cap with 0 saves and the app shipping empty. The
        # symmetric design-import exclusion at the stub-baseline guard
        # below (~L770) confirms this branch is intentionally distinct.
        plan_source = ctx.session.state.get(StateKeys.EDIT_PLAN_SOURCE, "editor")
        if plan_source != "design_import":
            try:
                from ..services.source_rehydration_service import rehydrate_sources

                await rehydrate_sources(ctx, current_config)
            except Exception as rehydrate_err:
                logger.error(
                    "source_rehydration_failed",
                    error=str(rehydrate_err),
                )
        else:
            logger.info(
                "source_rehydration_skipped_design_import",
                reason="design_import path; session artifacts are the canonical source",
            )

        # After rehydration, load handler TSX from the artifact store and
        # publish to the validation context so cross-reference rules
        # (chart dataKey vs handler return shape) can audit producer
        # contracts. Failure is non-fatal — the rules fail open when
        # ``handler_sources`` is missing.
        try:
            from main_agent.agents.utils.artifact_manager import ArtifactManager

            handler_names_for_sources = [
                h.get("name", "")
                for h in (existing_backend.get("handlers", []) or [])
                if isinstance(h, dict) and h.get("name")
            ]
            handler_sources_map: dict[str, str] = {}
            for h_name in handler_names_for_sources:
                src = await ArtifactManager.load_artifact_as_string(
                    ctx, f"handler_code:{h_name}.tsx"
                )
                if src:
                    handler_sources_map[h_name] = src
            await push_session_state_update(
                ctx,
                {"_validation_context_handler_sources": handler_sources_map},
            )
        except Exception as sources_err:
            logger.warning(
                "handler_sources_load_failed",
                error=str(sources_err),
            )

        design_system_context = ""
        pre_computed_palette: dict = {}
        fonts: dict[str, str] = {}
        terminal_failure_summary: Optional[str] = None

        # Stub-baseline guard: if rehydration replaced any component with an
        # empty stub (its GCS source blob was missing), the agent's view of
        # the app is fictional. Editing that view doesn't add to existing
        # content — it REPLACES whatever the runtime is currently serving
        # with a brand-new component the LLM writes from scratch. Bug
        # surfaced 2026-05-07 on app 8wpuopnb: a "Put a fancy movie poster
        # animation at dashboard" edit destroyed the dashboard's KPIs,
        # rating chart, and recent-activity sections because every
        # component had been rehydrated as a stub.
        #
        # Aborting here is the safe move. The runtime keeps serving the
        # existing R2 deploy; the user is told their source-of-truth is
        # incomplete and to contact support before re-attempting. We only
        # gate EDITS on this — rendering remains tolerant of stubs because
        # `_upload_repo_component_files` already skips stub uploads to
        # preserve the working R2 copy.
        stubbed = list(ctx.session.state.get("_stubbed_components") or [])
        plan_source = ctx.session.state.get(StateKeys.EDIT_PLAN_SOURCE, "editor")
        if stubbed and plan_source != "design_import":
            stub_summary = (
                f"This app's source-of-truth is incomplete: "
                f"{len(stubbed)} component(s) "
                f"({', '.join(stubbed)}) have no source blob in agent "
                f"storage. Editing on this baseline would replace the "
                f"existing component code with a brand-new file rather "
                f"than modifying it. Aborting the edit so your current "
                f"deployment is preserved."
            )
            error_entry = {
                "type": "stub_baseline_abort",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "summary": stub_summary,
                "stage": "StubBaselineAbort",
                "stubbed_components": stubbed,
            }
            existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
            existing_errors.append(error_entry)
            await push_session_state_update(
                ctx,
                {
                    StateKeys.AGENT_ERRORS: existing_errors,
                    StateKeys.SAVE_APP_CONFIG: False,
                    StateKeys.RELOAD_APP: False,
                },
            )
            logger.error(
                "edit_aborted_stub_baseline",
                app_uuid=ctx.session.state.get("app_uuid"),
                stubbed_count=len(stubbed),
                stubbed_components=stubbed,
            )
            terminal_failure_summary = stub_summary
        elif stubbed:
            # Design-import-CREATE: fresh app, no live R2 deploy to
            # protect. Stubs mean the design-import dispatcher didn't
            # translate (see translate_design_import_components). Log
            # loudly but let phase 8 ComponentBuilderMultiple build from
            # scratch rather than terminally aborting.
            logger.warning(
                "design_import_stubs_present_continuing",
                app_uuid=ctx.session.state.get("app_uuid"),
                stubbed_count=len(stubbed),
                stubbed_components=stubbed,
            )
        try:
            resolved_theme = await load_and_persist_theme_palette(
                ctx,
                fallback_to_seed=True,
            )
            from ..services.design_system_context import build_design_system_context
            from main_agent.services.theme.theme_view import ThemeView

            # On edit, design_style[] is intentionally omitted — the existing
            # component TSX is the design memory, and re-feeding the planner's
            # natural-language bullets propagates stale token vocabulary.
            design_system_context = build_design_system_context(
                resolved_theme.palette,
                fonts=resolved_theme.fonts,
                theme_view=ThemeView.from_css(resolved_theme.theme_css or ""),
            )
            pre_computed_palette = resolved_theme.palette
            fonts = resolved_theme.fonts
            await push_session_state_update(
                ctx,
                {"_validation_context_theme_palette": resolved_theme.palette},
            )
        except ThemePaletteResolutionError as e:
            # Logged as well as streamed — a terminal error that appears only in
            # the browser leaves `docker logs` with nothing to debug from.
            logger.error(
                "theme_palette_resolution_failed",
                error=str(e),
                phase="editing.theme_palette",
            )
            error_entry = {
                "type": "validation_pipeline_error",
                "timestamp": datetime.utcnow().isoformat() + "Z",
                "summary": f"Theme palette resolution failed: {e}",
                "stage": "ThemePaletteResolutionError",
            }
            existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
            existing_errors.append(error_entry)
            await push_session_state_update(
                ctx,
                {
                    StateKeys.AGENT_ERRORS: existing_errors,
                    StateKeys.SAVE_APP_CONFIG: False,
                    StateKeys.RELOAD_APP: False,
                },
            )
            terminal_failure_summary = error_entry["summary"]

        return _EditPhaseState(
            agent_name=agent_name,
            current_config=current_config,
            app_language_code=ctx.session.state.get("app_language_code", "en"),
            app_secondary_type=current_config.get("appSecondaryType", "website"),
            design_system_context=design_system_context,
            pre_computed_palette=pre_computed_palette,
            fonts=fonts,
            image_uuid_to_url=image_uuid_to_url,
            existing_backend=existing_backend,
            existing_security=existing_security,
            existing_pages=existing_pages,
            progress_tracker=progress_tracker,
            metrics_tracker=metrics_tracker,
            existing_page_list=existing_page_list,
            logic_surface=build_logic_surface(existing_logic),
            resolved_theme_palette=pre_computed_palette,
            terminal_failure_summary=terminal_failure_summary,
        )

    async def _plan_edits(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
        current_config_str: str,
    ) -> AsyncGenerator[Event, None]:
        """Build dependency map, run editor agent, parse EditorOutput into state.edit_plan.

        On failure or empty output, yields an error event and leaves state.edit_plan
        as None (caller checks). state.total_actions is set on success.

        When ``StateKeys.EDIT_PLAN_SOURCE == "design_import"`` and an
        ``EDIT_PLAN`` dict is already in session state, this method
        bypasses the Editor LLM entirely — the upstream
        ``DesignImportWorkflow`` already synthesized a frontend
        compliance plan and we just consume it.
        """
        from ..services.dependency_map_builder import build_dependency_map

        # ── Pre-built-plan skip (DesignImportWorkflow upstream) ──────────
        plan_source = ctx.session.state.get(StateKeys.EDIT_PLAN_SOURCE, "editor")
        if plan_source == "design_import":
            edit_plan_raw = ctx.session.state.get(StateKeys.EDIT_PLAN) or {}
            try:
                edit_plan = EditorOutput.model_validate(edit_plan_raw)
            except Exception as e:
                logger.error(
                    f"[{state.agent_name}] Pre-built design-import plan "
                    f"failed schema validation: {e}",
                    raw=edit_plan_raw,
                )
                yield state.progress_tracker.create_event(
                    ctx,
                    "error",
                    internal_message="Synthesized design-import plan was malformed.",
                )
                return
            total = (
                len(edit_plan.modify_styles_actions)
                + len(edit_plan.change_backend_models_actions)
                + len(edit_plan.modify_logic_actions)
                + len(edit_plan.add_handler_actions)
                + len(edit_plan.modify_handler_actions)
                + len(edit_plan.remove_handler_actions)
                + len(edit_plan.rename_page_title_actions)
                + len(edit_plan.frontend_build_actions)
                + len(getattr(edit_plan, "ingest_data_actions", []) or [])
                + len(getattr(edit_plan, "edit_seed_data_actions", []) or [])
            )
            state.edit_plan = edit_plan
            state.total_actions = total
            # Build a (likely empty) dependency_map so phase runners that
            # consume it don't NPE.
            state.dependency_map = await build_dependency_map(ctx, state.current_config)  # type: ignore[assignment]
            logger.info(
                f"[{state.agent_name}] Skipped Editor LLM — consuming "
                f"pre-built {plan_source} plan with {total} action(s)"
            )
            return

        dependency_map = await build_dependency_map(ctx, state.current_config)
        state.dependency_map = dependency_map  # type: ignore[assignment]

        user_request = ctx.session.state.get(StateKeys.CURRENT_PROMPT, "")
        content_context = await DocumentArtifactService.prepare_content_context(
            ctx, user_prompt=user_request
        )

        if content_context.unresolved_references:
            await self._record_unresolved_references(ctx, content_context.unresolved_references)

        # ── DataIngester pre-pass (edit mode) ─────────────────────────
        # Runs whenever the user uploaded tabular files on this turn and
        # ``DATA_INGEST_ENABLED`` is on. Returns a prose summary the
        # Editor consumes to choose between ChangeBackendModelsAction
        # (target_mode=create) and IngestDataAction (append/replace).
        data_ingest_report_str, existing_models_dicts = await self._run_data_ingest_pre_pass(
            ctx,
            content_context,
            user_request=user_request,
            current_config=state.current_config,
            app_language_code=state.app_language_code,
        )

        selected_component_name = ctx.session.state.get("selected_component_name", "")
        selected_component_source = ctx.session.state.get("selected_component_source", "")
        current_page_uuid = ctx.session.state.get("current_page_uuid") or ""
        help_desk_reasoning = ctx.session.state.get("app_help_desk_output", {}).get("reasoning", "")

        yield state.progress_tracker.create_event(
            ctx, "analyzing_request", internal_message="Planning edits"
        )
        logger.info(f"[{state.agent_name}] Step 1: Running editor agent")

        # Strip repo.* paths/hashes but keep a slim component-name dict so
        # editor planning isn't blind to existing components. See
        # ``_slim_config_for_editor`` for details.
        editor_config_str = _slim_config_for_editor(current_config_str)

        # Read the Surveyor's DiagnosticReport from session state (written by
        # core._run_surveyor) and serialise to JSON for the Editor's input.
        # Empty string means the Surveyor was skipped (quick_remove,
        # diagnostic_profile=none, or stub-baseline guard).
        diagnostic_report_str = ""
        report_raw = ctx.session.state.get(StateKeys.DIAGNOSTIC_REPORT)
        if report_raw:
            try:
                diagnostic_report_str = (
                    json.dumps(report_raw)
                    if isinstance(report_raw, dict)
                    else str(report_raw)
                )
            except Exception:
                # Defensive: malformed report → empty string. Editor falls
                # back to today's behavior.
                diagnostic_report_str = ""

        # Always give the planner the live model list (independent of the
        # data-ingest pre-pass, which only runs when DATA_INGEST_ENABLED) so it
        # can validate ingest targets and ground cascades against real names.
        existing_models_for_editor = existing_models_dicts or self._build_existing_model_details(
            state.current_config
        )

        # The Surveyor's recommended fix shape. 'none' = no fix is needed (the
        # user likely asked about expected behavior). Used below to AVOID
        # pressuring a zero-action re-plan when the diagnosis itself concluded
        # nothing should change — forcing a re-roll there risks fabricating a
        # spurious edit on a working app. The empty-report fallback uses
        # 'unknown' (not 'none'), so a missing/low-confidence report still
        # allows the corrective re-plan.
        surveyor_shape = ""
        if isinstance(report_raw, dict):
            surveyor_shape = report_raw.get("suggested_resolution_shape", "") or ""

        # Bounded re-plan loop: at most one corrective re-plan when the first
        # plan produced only spurious ingest_data_actions (mis-route bug) or no
        # actions at all (weak-model planning miss).
        replan_feedback = ""
        edit_plan: Optional[EditorOutput] = None
        total = 0
        for replan_attempt in range(2):
            editor_input = EditorInput(
                user_request=user_request,
                current_app_config=editor_config_str,
                current_component_source=selected_component_source,
                selected_component_name=selected_component_name,
                current_page_uuid=current_page_uuid,
                help_desk_reasoning=help_desk_reasoning,
                replan_feedback=replan_feedback,
                app_language_code=state.app_language_code,
                dependency_map=json.dumps(dependency_map),
                diagnostic_report=diagnostic_report_str,
                image_catalog_summary=content_context.image_catalog_summary,
                document_artifact_list=content_context.document_artifact_list,
                large_document_list=content_context.large_document_list,
                user_referenced_images=content_context.user_referenced_images,
                user_referenced_documents=content_context.user_referenced_documents,
                user_referenced_large_documents=content_context.user_referenced_large_documents,
                existing_models=existing_models_for_editor,
                data_ingest_report=data_ingest_report_str,
            )

            await push_prompt_to_next_agent(ctx, _format_editor_prompt(editor_input))

            async for event in self.validation_service._run_agent_with_retry(
                ctx,
                self.editor_agent,
                AgentName.EDITOR.value,
                MAX_REPAIR_ATTEMPTS,
            ):
                yield event

            edit_plan_raw = ctx.session.state.get(StateKeys.EDIT_PLAN, {})
            try:
                edit_plan = EditorOutput.model_validate(edit_plan_raw)
            except Exception as e:
                logger.error(
                    f"[{state.agent_name}] Failed to parse editor output: {e}",
                    raw=edit_plan_raw,
                )
                yield state.progress_tracker.create_event(
                    ctx,
                    "error",
                    internal_message="Editor returned an invalid plan. Please try again.",
                )
                return

            # Drop spurious ingest_data_actions (no upload this turn, or target
            # is not a real backend model — e.g. a component name). Deterministic
            # guard for the mis-route bug (2026-05-20).
            dropped_ingest = self._sanitize_ingest_actions(
                edit_plan,
                data_ingest_report_str,
                existing_models_for_editor,
                state.agent_name,
            )

            total = (
                len(edit_plan.modify_styles_actions)
                + len(edit_plan.change_backend_models_actions)
                + len(edit_plan.modify_logic_actions)
                + len(edit_plan.add_handler_actions)
                + len(edit_plan.modify_handler_actions)
                + len(edit_plan.remove_handler_actions)
                + len(edit_plan.rename_page_title_actions)
                + len(edit_plan.frontend_build_actions)
                + len(edit_plan.ingest_data_actions)
                + len(getattr(edit_plan, "edit_seed_data_actions", []) or [])
            )

            if total > 0:
                break

            # No actionable plan. Two distinct RECOVERABLE misses each get ONE
            # corrective re-plan via this bounded loop before we give up:
            #   (a) the only output was rejected ingest action(s) — a mis-route
            #       (2026-05-20); or
            #   (b) the Editor emitted ZERO actions of any kind — a weak-model
            #       planning miss where it "reasons" (e.g. "let me load X first")
            #       but never emits a FrontendBuildAction (2026-06-29). Hard-
            #       failing on the first miss wastes the available retry and drops
            #       a working preview to `error`, so re-roll the Editor once with
            #       explicit corrective feedback (the same model emits actions on
            #       most runs) and only settle if the SECOND plan is still empty.
            # SAFETY: the actionless re-roll (b) is GATED on the Surveyor NOT
            # having concluded suggested_resolution_shape='none'. When the
            # diagnosis says no fix is needed, a zero-action plan is the CORRECT
            # outcome; pressuring "you MUST emit an action" there could fabricate
            # a spurious edit on a working app, so we settle cleanly instead.
            if replan_attempt == 0 and dropped_ingest:
                targets = ", ".join(a.target_model_name for a in dropped_ingest)
                replan_feedback = (
                    f"Your previous plan emitted ingest_data_action(s) targeting "
                    f"[{targets}], which were REJECTED: no data file was uploaded this "
                    f"turn and/or the target is not a backend model (it is likely a "
                    f"component). Re-plan this request as a `frontend_build_action` that "
                    f"makes the requested text/UI change. Do NOT emit any ingest_data_actions."
                )
                logger.warning(
                    f"[{state.agent_name}] Editor produced only invalid ingest actions "
                    f"({targets}); re-planning once with corrective feedback"
                )
                continue

            if replan_attempt == 0 and surveyor_shape != "none":
                replan_feedback = (
                    "Your previous response emitted ZERO edit actions: you described "
                    "or planned the change (or stopped to 'load'/'inspect' a component) "
                    "but never emitted an action. You MUST return at least one action "
                    "that actually performs the requested change — for any TSX, content, "
                    "copy, or layout change emit a `frontend_build_action` now. Do not "
                    "stop after reasoning; emit the action(s)."
                )
                logger.warning(
                    f"[{state.agent_name}] Editor returned no actions; "
                    f"re-planning once with corrective feedback"
                )
                continue

            if surveyor_shape == "none":
                logger.info(
                    f"[{state.agent_name}] Editor returned no actions and the Surveyor "
                    f"concluded shape='none' (no fix needed); settling without a re-roll"
                )
            else:
                logger.warning(f"[{state.agent_name}] Editor returned no actions after re-plan")
            yield state.progress_tracker.create_event(
                ctx,
                "error",
                internal_message="Could not determine what changes to make. Please try again with a more specific request.",
            )
            return

        assert edit_plan is not None  # loop either breaks with a plan or returns
        state.edit_plan = edit_plan
        state.total_actions = total
        # Defense-in-depth: pre-merge planned page_creates slugs into the
        # validation context so the navigate-path auto-fixer sees them.
        planned_slugs: list[str] = []
        for fb_action in edit_plan.frontend_build_actions:
            for create in fb_action.page_creates:
                if create.slug:
                    planned_slugs.append(create.slug)
            for rename in fb_action.page_slug_renames:
                planned_slugs.append(rename.new_slug)
        if planned_slugs:
            seeded = list(ctx.session.state.get("_validation_context_page_slugs", []) or [])
            for slug in planned_slugs:
                if slug not in seeded:
                    seeded.append(slug)
            await push_session_state_update(ctx, {"_validation_context_page_slugs": seeded})
        logger.info(
            f"[{state.agent_name}] Edit plan: {total} actions",
            styles=len(edit_plan.modify_styles_actions),
            change_models=len(edit_plan.change_backend_models_actions),
            logic=len(edit_plan.modify_logic_actions),
            add_handlers=len(edit_plan.add_handler_actions),
            modify_handlers=len(edit_plan.modify_handler_actions),
            remove_handlers=len(edit_plan.remove_handler_actions),
            rename_page_titles=len(edit_plan.rename_page_title_actions),
            frontend_build=len(edit_plan.frontend_build_actions),
            ingest_data=len(edit_plan.ingest_data_actions),
            edit_seed_data=len(getattr(edit_plan, "edit_seed_data_actions", []) or []),
        )

    @staticmethod
    def _sanitize_ingest_actions(
        edit_plan: EditorOutput,
        data_ingest_report_str: str,
        existing_models: list[dict],
        agent_name: str,
    ) -> list:
        """Drop spurious ``IngestDataAction``s from ``edit_plan`` in place.

        An ingest action is valid ONLY when a tabular file was uploaded this
        turn (non-empty ``data_ingest_report``) AND ``target_model_name`` is a
        real backend model. Anything else is a mis-route — most commonly a
        plain text/UI edit that landed in ``ingest_data_actions`` with a
        component name as the target (bug found 2026-05-20). Returns the list
        of dropped actions so the caller can decide whether to re-plan.
        """
        actions = list(getattr(edit_plan, "ingest_data_actions", None) or [])
        if not actions:
            return []
        upload_happened = bool((data_ingest_report_str or "").strip())
        model_names = {
            (m.get("name") or "").lower()
            for m in (existing_models or [])
            if isinstance(m, dict)
        }
        kept: list = []
        dropped: list = []
        for action in actions:
            target_ok = action.target_model_name.lower() in model_names
            if upload_happened and target_ok:
                kept.append(action)
            else:
                dropped.append(action)
        if dropped:
            reason = (
                "no data uploaded this turn"
                if not upload_happened
                else "target is not a backend model"
            )
            logger.warning(
                f"[{agent_name}] Dropping {len(dropped)} spurious ingest_data_action(s) "
                f"({reason}): {[a.target_model_name for a in dropped]}"
            )
            edit_plan.ingest_data_actions = kept
        return dropped

    @staticmethod
    async def _record_unresolved_references(ctx: InvocationContext, unresolved: list[str]) -> None:
        from datetime import datetime, timezone
        from main_agent.agents.orchestrator.models.agent_errors import ContentReferenceError

        error = ContentReferenceError(
            timestamp=datetime.now(timezone.utc).isoformat(),
            summary=(
                f"Could not resolve {len(unresolved)} "
                f"file reference(s): {', '.join(unresolved)}"
            ),
            unresolved_references=unresolved,
        )
        existing_errors = ctx.session.state.get(StateKeys.AGENT_ERRORS, []) or []
        existing_errors.append(error.model_dump())
        await push_session_state_update(ctx, {"agent_errors": existing_errors})

    # ═══════════════════════════════════════════════════════════════════
    # Progress tick helper
    # ═══════════════════════════════════════════════════════════════════

    async def _tick(self, ctx: InvocationContext, state: _EditPhaseState, label: str) -> None:
        state.completed_actions += 1
        progress = 20 + int((state.completed_actions / max(state.total_actions, 1)) * 60)
        await state.progress_tracker.update(
            ctx,
            progress,
            f"Applying: {label} ({state.completed_actions}/{state.total_actions})",
        )

    # ═══════════════════════════════════════════════════════════════════
    # Phase 1: modify_styles
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_modify_styles(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        if state.edit_plan is None:
            return
        sorted_actions = sorted(state.edit_plan.modify_styles_actions, key=lambda a: a.priority)
        for styles_action in sorted_actions:
            await self._tick(ctx, state, "modify_styles")
            yield state.progress_tracker.create_event(
                ctx, "building_component", internal_message="Updating design system"
            )
            if not self.design_system_builder_agent:
                logger.warning(
                    f"[{state.agent_name}] modify_styles skipped: no design_system_builder_agent"
                )
                continue

            from ..subagents.design_system_builder import DesignSystemBuilderInput

            # Seed colors + fonts come from theme.css (parsed into the snapshot
            # at phase init). On edit, design_style[] stays empty — the existing
            # theme.css is the design memory.
            palette = state.pre_computed_palette or {}
            ds_input = DesignSystemBuilderInput(
                build_mode="edit",
                existing_theme_artifact="codefocus_style:theme.css",
                editor_prompt=styles_action.editor_prompt,
                primary_color=palette.get("primary") or "#0F766E",
                secondary_color=palette.get("secondary") or "#D97706",
                surface_color=palette.get("surface") or "#FFFBEB",
                error_color=palette.get("error") or "#DC2626",
                headline_font=(
                    state.fonts.get("heading") or state.fonts.get("headline") or "Inter"
                ),
                body_font=(state.fonts.get("body") or state.fonts.get("sans") or "Inter"),
                app_language_code=state.app_language_code,
                pre_computed_palette=(
                    json.dumps(state.pre_computed_palette) if state.pre_computed_palette else ""
                ),
            )

            await push_prompt_to_next_agent(ctx, json.dumps(ds_input.model_dump()))
            async for event in self._run_agent_with_metrics(
                ctx,
                self.design_system_builder_agent,
                AgentName.DESIGN_SYSTEM_BUILDER.value,
                state.metrics_tracker,
            ):
                yield event
            logger.info(f"[{state.agent_name}] Design system updated")
            if not await self._refresh_design_system_context_from_theme(
                ctx,
                state,
                fallback_to_seed=False,
            ):
                return

    # ═══════════════════════════════════════════════════════════════════
    # Phase 2: change_backend_models
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_change_backend_models(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        if state.edit_plan is None:
            return
        sorted_actions = sorted(
            state.edit_plan.change_backend_models_actions, key=lambda a: a.priority
        )
        for models_action in sorted_actions:
            await self._tick(ctx, state, "change_backend_models")
            yield state.progress_tracker.create_event(
                ctx, "building_component", internal_message="Updating backend models"
            )
            if not self.backend_builder:
                logger.warning(
                    f"[{state.agent_name}] change_backend_models skipped: no backend_builder"
                )
                continue

            logger.info(
                f"[{state.agent_name}] Backend models change",
                prompt=models_action.editor_prompt[:100],
            )
            async for event in self.backend_builder.build_edit_models(
                ctx=ctx,
                current_config=state.live_backend(),
                editor_prompt=models_action.editor_prompt,
            ):
                yield event

            backend_result = self.backend_builder.result
            if backend_result.backend_config:
                state.updated_backend_config = backend_result.backend_config
                state.invalidate_backend_surface()
                await self._refresh_validation_context(
                    ctx,
                    state.updated_backend_config,
                    state.updated_logic_config,
                    state.existing_pages,
                    state.added_components,
                )

    # ═══════════════════════════════════════════════════════════════════
    # Phase 2.4: edit_seed_data (data-VALUE edits → SeedDataBuilder edit)
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_edit_seed_data(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        """Apply each ``EditSeedDataAction`` by running SeedDataBuilder (edit).

        Loads the model's current seed rows, applies the editor_prompt, and
        re-saves the dataset. The updated SEED_DATA_METADATA is picked up by
        ``inject_seed_routing`` at finalization → ``repo.seed`` → deploy reseed,
        so the preview D1 reflects the change. Routing data-value edits here
        (instead of ChangeBackendModelsAction → BackendModelBuilder) is what
        makes the change actually take effect.
        """
        if state.edit_plan is None:
            return
        actions = getattr(state.edit_plan, "edit_seed_data_actions", None) or []
        if not actions:
            return
        if not self.backend_builder:
            logger.warning(f"[{state.agent_name}] edit_seed_data skipped: no backend_builder")
            return

        live_backend = state.live_backend()
        backend_model_names = {
            (m.get("name") or "").lower()
            for m in (live_backend.get("models") or [])
            if isinstance(m, dict)
        }

        # App name + summary for realistic-data context (best-effort).
        app_ctx = ""
        try:
            full_cfg = ctx.session.state.get("app_config")
            if isinstance(full_cfg, str):
                full_cfg = json.loads(full_cfg)
            if isinstance(full_cfg, dict):
                app_ctx = (
                    f"{full_cfg.get('name', '')} — "
                    f"{full_cfg.get('shortSummary') or full_cfg.get('summary') or ''}"
                ).strip(" —")
        except Exception:  # noqa: BLE001
            app_ctx = ""

        for action in sorted(actions, key=lambda a: a.priority):
            target = action.target_model_name
            if target.lower() not in backend_model_names:
                logger.warning(
                    f"[{state.agent_name}] edit_seed_data skipped: target model "
                    f"{target!r} not in current backend"
                )
                continue

            await self._tick(ctx, state, f"edit_seed_data {target}")
            yield state.progress_tracker.create_event(
                ctx,
                "building_component",
                internal_message=f"Updating data in {target}",
            )

            async for event in self.backend_builder.build_edit_seed(
                ctx=ctx,
                current_config=live_backend,
                target_model=target,
                editor_prompt=action.editor_prompt,
                app_context=app_ctx,
            ):
                yield event

            logger.info(f"[{state.agent_name}] edit_seed_data applied")

    # ═══════════════════════════════════════════════════════════════════
    # Phase 2.5: ingest_data (DataIngester append/replace)
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_ingest_data(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        """Wire each ``IngestDataAction`` into the seed pipeline.

        Mutates ``state[SEED_DATA_METADATA]`` to annotate the relevant
        dataset with ``ingest_target_model`` / ``ingest_mode`` /
        ``ingest_batch_id`` fields. ``inject_seed_routing`` reads these
        at finalization time and emits a ``repo.seed[...]`` entry with
        the correct mode / batch_id under a batch-scoped key (so
        sibling batches for the same target model coexist).

        Safety:

        * target_model_name must be present in the live backend.
        * The ingest_name derived from ``source_rows_artifact`` must be
          present in the ``DATA_INGEST_REPORT``.
        * ``mode='replace'`` is only honored when the IngestReport
          explicitly marked the model as ``target_mode='replace'`` —
          the Editor cannot upgrade ``append`` to ``replace``.
        """
        if state.edit_plan is None:
            return
        actions = getattr(state.edit_plan, "ingest_data_actions", None) or []
        if not actions:
            return

        from ..subagents.data_ingester import IngestReport

        raw = ctx.session.state.get(StateKeys.DATA_INGEST_REPORT) or {}
        report: Optional[IngestReport] = None
        if isinstance(raw, IngestReport):
            report = raw
        elif isinstance(raw, dict) and raw:
            try:
                report = IngestReport.model_validate(raw)
            except Exception:  # noqa: BLE001
                logger.warning(
                    f"[{state.agent_name}] DATA_INGEST_REPORT malformed at ingest_data phase; "
                    "rejecting all IngestDataActions for safety"
                )
                return

        report_by_name = {m.name: m for m in (report.proposed_models if report else [])}

        live_backend = state.live_backend()
        backend_model_names = {
            (m.get("name") or "").lower()
            for m in (live_backend.get("models") or [])
            if isinstance(m, dict)
        }

        seed_metadata = dict(ctx.session.state.get(StateKeys.SEED_DATA_METADATA) or {})

        sorted_actions = sorted(actions, key=lambda a: a.priority)
        applied = 0
        for action in sorted_actions:
            await self._tick(ctx, state, f"ingest_data {action.target_model_name}")
            yield state.progress_tracker.create_event(
                ctx,
                "building_component",
                internal_message=f"Importing data into {action.target_model_name}",
            )

            # Target model must already exist in the backend after
            # change_backend_models has run.
            if action.target_model_name.lower() not in backend_model_names:
                logger.warning(
                    f"[{state.agent_name}] ingest_data skipped: target model "
                    f"{action.target_model_name!r} not in current backend"
                )
                continue

            # Derive the ingest_name from the source artifact name.
            artifact_name = action.source_rows_artifact
            if not artifact_name.startswith("extracted_rows:"):
                logger.warning(
                    f"[{state.agent_name}] ingest_data skipped: malformed source artifact "
                    f"{artifact_name!r} (expected extracted_rows:NAME.json)"
                )
                continue
            ingest_name = artifact_name[len("extracted_rows:"):]
            if ingest_name.endswith(".json"):
                ingest_name = ingest_name[: -len(".json")]

            # Must be a model the DataIngester produced this turn. When
            # the report is missing entirely, EVERY IngestDataAction is
            # suspect (the Editor shouldn't have emitted any without a
            # report on input) — refuse them all rather than silently
            # mutating tables.
            if report is None:
                logger.warning(
                    f"[{state.agent_name}] ingest_data refused: no DATA_INGEST_REPORT "
                    f"in state — Editor emitted IngestDataAction without an ingest pre-pass"
                )
                continue
            if ingest_name not in report_by_name:
                logger.warning(
                    f"[{state.agent_name}] ingest_data refused: {ingest_name!r} not in "
                    f"IngestReport (Editor hallucinated an ingest target)"
                )
                continue

            # Never escalate to replace without the IngestReport's blessing.
            if action.mode == "replace":
                report_model = report_by_name.get(ingest_name)
                if not report_model or report_model.target_mode != "replace":
                    actual = report_model.target_mode if report_model else "missing"
                    logger.warning(
                        f"[{state.agent_name}] ingest_data refused replace: "
                        f"IngestReport.target_mode={actual!r} for {ingest_name!r}"
                    )
                    continue

            # Bridge must have populated SEED_DATA_METADATA[ingest_name]
            # already (Step 0.6 in EditingWorkflow runs before phases).
            if ingest_name not in seed_metadata:
                logger.warning(
                    f"[{state.agent_name}] ingest_data skipped: no SEED_DATA_METADATA "
                    f"for {ingest_name!r} (bridge may have failed)"
                )
                continue

            entry = dict(seed_metadata[ingest_name])
            entry["ingest_target_model"] = action.target_model_name
            entry["ingest_mode"] = action.mode
            entry["ingest_batch_id"] = action.batch_id
            seed_metadata[ingest_name] = entry
            applied += 1
            logger.info(
                f"[{state.agent_name}] ingest_data applied: "
                f"{ingest_name} → {action.target_model_name} ({action.mode}, batch={action.batch_id})"
            )

        if applied:
            ctx.session.state[StateKeys.SEED_DATA_METADATA] = seed_metadata

    # ═══════════════════════════════════════════════════════════════════
    # Phase 3: modify_logic
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_modify_logic(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        if state.edit_plan is None:
            return
        sorted_actions = sorted(state.edit_plan.modify_logic_actions, key=lambda a: a.priority)
        for logic_action in sorted_actions:
            await self._tick(ctx, state, "modify_logic")
            yield state.progress_tracker.create_event(
                ctx, "building_component", internal_message="Updating frontend logic"
            )
            if not self.logic_builder_agent:
                logger.warning(f"[{state.agent_name}] modify_logic skipped: no logic_builder_agent")
                continue

            from ...shared.builders.logic_builder import LogicBuilderInput

            current_logic = state.current_config.get("frontend", {}).get("logic", {}) or {}
            logic_plan = {
                "current_logic": current_logic,
                "modification": logic_action.editor_prompt,
            }
            logic_input = LogicBuilderInput(
                build_mode="edit",
                editor_prompt=logic_action.editor_prompt,
                app_logic_plan=json.dumps(logic_plan),
                app_type=state.app_secondary_type,
            )
            await push_prompt_to_next_agent(ctx, json.dumps(logic_input.model_dump()))
            async for event in self._run_agent_with_metrics(
                ctx,
                self.logic_builder_agent,
                AgentName.LOGIC_BUILDER.value,
                state.metrics_tracker,
            ):
                yield event

            logic_artifact = await ArtifactManager.load_artifact_as_string(ctx, "logic.json")
            if logic_artifact:
                state.updated_logic_config = json.loads(logic_artifact)
                state.logic_surface = build_logic_surface(state.updated_logic_config)
                await self._refresh_validation_context(
                    ctx,
                    state.updated_backend_config,
                    state.updated_logic_config,
                    state.existing_pages,
                    state.added_components,
                )

    # ═══════════════════════════════════════════════════════════════════
    # Phase 4: add_handler
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_add_handler(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        if state.edit_plan is None:
            return
        sorted_actions = sorted(state.edit_plan.add_handler_actions, key=lambda a: a.priority)
        for add_handler_action in sorted_actions:
            await self._tick(ctx, state, f"add_handler {add_handler_action.handler_name}")
            yield state.progress_tracker.create_event(
                ctx,
                "building_component",
                internal_message=f"Creating handler: {add_handler_action.handler_name}",
            )
            if not self.backend_builder:
                logger.warning(f"[{state.agent_name}] add_handler skipped: no backend_builder")
                continue

            live_backend = state.live_backend()
            existing_handler_names = {
                h.get("name")
                for h in (live_backend.get("handlers", []) or [])
                if isinstance(h, dict)
            }
            if add_handler_action.handler_name in existing_handler_names:
                logger.error(
                    f"[{state.agent_name}] add_handler skipped: handler "
                    f"{add_handler_action.handler_name} already exists"
                )
                continue

            handler_plan = HandlerPlan(
                name=add_handler_action.handler_name,
                auth_level=add_handler_action.auth_level,
                handler_type=add_handler_action.handler_type,
                inputs=list(add_handler_action.inputs),
                outputs=list(add_handler_action.outputs),
                logic=list(add_handler_action.logic),
            )

            async for event in self.backend_builder.build_create_handler(
                ctx=ctx,
                current_config=live_backend,
                handler_plan=handler_plan,
            ):
                yield event

            state.updated_backend_config = self._append_handler_metadata(live_backend, handler_plan)
            state.invalidate_backend_surface()
            await self._save_backend_artifact(ctx, state.updated_backend_config)
            await self._refresh_validation_context(
                ctx,
                state.updated_backend_config,
                state.updated_logic_config,
                state.existing_pages,
                state.added_components,
            )

    # ═══════════════════════════════════════════════════════════════════
    # Phase 5: modify_handler (body + optional signature)
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_modify_handler(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        if state.edit_plan is None:
            return
        sorted_actions = sorted(state.edit_plan.modify_handler_actions, key=lambda a: a.priority)
        for handler_action in sorted_actions:
            await self._tick(ctx, state, f"modify_handler {handler_action.handler_name}")
            yield state.progress_tracker.create_event(
                ctx,
                "building_component",
                internal_message=f"Updating handler: {handler_action.handler_name}",
            )
            if not self.backend_builder:
                logger.warning(f"[{state.agent_name}] modify_handler skipped: no backend_builder")
                continue

            live_backend = state.live_backend()
            signature_changed = any(
                v is not None
                for v in (
                    handler_action.new_inputs,
                    handler_action.new_outputs,
                    handler_action.new_auth_level,
                    handler_action.new_handler_type,
                )
            )

            if signature_changed:
                patched = self._patch_handler_signature(
                    live_backend,
                    handler_action.handler_name,
                    new_inputs=handler_action.new_inputs,
                    new_outputs=handler_action.new_outputs,
                    new_auth_level=handler_action.new_auth_level,
                    new_handler_type=handler_action.new_handler_type,
                )
                if patched is None:
                    logger.error(
                        f"[{state.agent_name}] modify_handler signature patch failed — "
                        f"{handler_action.handler_name} not found"
                    )
                    continue
                state.updated_backend_config = patched
                state.invalidate_backend_surface()
                await self._save_backend_artifact(ctx, state.updated_backend_config)
                live_backend = state.updated_backend_config

            # When only the signature changed and no plan was given, synthesize
            # a default instruction so the handler builder actually adapts the
            # body. An empty HandlerPlan.logic tells the builder "no changes".
            effective_plan = handler_action.modification_plan
            if signature_changed and not effective_plan.strip():
                effective_plan = (
                    "The handler signature has been updated. Adapt the body so it "
                    "consumes the new inputs and produces the new outputs. Preserve "
                    "all existing logic that does not conflict with the new signature."
                )

            async for event in self.backend_builder.build_edit_handler(
                ctx=ctx,
                current_config=live_backend,
                handler_name=handler_action.handler_name,
                modification_plan=effective_plan,
                new_inputs=handler_action.new_inputs,
                new_outputs=handler_action.new_outputs,
                new_auth_level=handler_action.new_auth_level,
                new_handler_type=handler_action.new_handler_type,
            ):
                yield event

            if signature_changed:
                await self._refresh_validation_context(
                    ctx,
                    state.updated_backend_config,
                    state.updated_logic_config,
                    state.existing_pages,
                    state.added_components,
                )

    # ═══════════════════════════════════════════════════════════════════
    # Phase 6: remove_handler
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_remove_handler(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        if state.edit_plan is None:
            return
        sorted_actions = sorted(state.edit_plan.remove_handler_actions, key=lambda a: a.priority)

        # Pre-flight cascade check: every handler being removed must have a
        # paired FrontendBuildAction whose prompt mentions the handler name —
        # the editor must emit the cascade fix in the same response so the
        # subsequent frontend_build phase removes the dangling callers.
        # We can't introspect the prompt content reliably, so we look for
        # the handler name as a substring in any action prompt.
        handler_to_components = state.dependency_map.get("handler_to_components", {})
        blocked_removals: set[str] = set()
        all_frontend_prompts = " ".join(
            a.prompt for a in state.edit_plan.frontend_build_actions
        )
        for remove_handler_action in sorted_actions:
            callers = list(
                handler_to_components.get(remove_handler_action.handler_name, []) or []
            )
            if callers and remove_handler_action.handler_name not in all_frontend_prompts:
                logger.error(
                    f"[{state.agent_name}] remove_handler BLOCKED — "
                    f"{remove_handler_action.handler_name} is still referenced by "
                    f"{callers}; editor must emit a paired FrontendBuildAction "
                    f"naming the handler so its callers are cleaned up before "
                    f"the handler is removed.",
                )
                blocked_removals.add(remove_handler_action.handler_name)

        for remove_handler_action in sorted_actions:
            await self._tick(ctx, state, f"remove_handler {remove_handler_action.handler_name}")
            yield state.progress_tracker.create_event(
                ctx,
                "building_component",
                internal_message=f"Removing handler: {remove_handler_action.handler_name}",
            )

            if remove_handler_action.handler_name in blocked_removals:
                # Pre-flight rejected — skip to avoid the "deleted artifact
                # + dangling references" failure mode. Cross-validation will
                # still fire at assembly time for any dangling callers that
                # somehow get past this guard.
                continue

            live_backend = state.live_backend()
            patched = self._remove_handler_from_backend(
                live_backend, remove_handler_action.handler_name
            )
            if patched is None:
                logger.error(
                    f"[{state.agent_name}] remove_handler skipped — "
                    f"{remove_handler_action.handler_name} not found"
                )
                continue

            state.updated_backend_config = patched
            state.invalidate_backend_surface()
            await self._save_backend_artifact(ctx, state.updated_backend_config)
            await self._delete_handler_artifact(ctx, remove_handler_action.handler_name)
            await self._refresh_validation_context(
                ctx,
                state.updated_backend_config,
                state.updated_logic_config,
                state.existing_pages,
                state.added_components,
            )

    # ═══════════════════════════════════════════════════════════════════
    # Phase 7: rename_page_title (deterministic — slug renames forbidden)
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_rename_page_title(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        """Title-only page rename. The Pydantic schema rejects slug changes —
        slug renames flow through `FrontendBuildAction.page_slug_renames`
        because they cascade across nav links."""
        if state.edit_plan is None:
            return
        sorted_actions = sorted(
            state.edit_plan.rename_page_title_actions, key=lambda a: a.priority
        )
        for action in sorted_actions:
            await self._tick(ctx, state, f"rename_page_title {action.page_uuid}")
            target_page = self._find_page_by_uuid(state.current_config, action.page_uuid)
            if target_page is None:
                logger.error(
                    f"[{state.agent_name}] rename_page_title skipped — uuid "
                    f"{action.page_uuid} not found"
                )
                continue
            target_page["title"] = action.new_title
            # Keep existing_page_list in sync so subsequent phases see the
            # renamed title in app_context_json().
            state.existing_page_list = [
                {"title": p.get("title", ""), "slug": p.get("slug", "/")}
                for p in state.current_config.get("frontend", {}).get("pages", []) or []
                if isinstance(p, dict)
            ]
            logger.info(
                f"[{state.agent_name}] Renamed page title",
                page_uuid=action.page_uuid,
                new_title=action.new_title,
            )
        if False:  # pragma: no cover — keeps this an async generator
            yield

    @staticmethod
    def _find_page_by_uuid(current_config: dict, page_uuid: str) -> Optional[dict]:
        pages = current_config.get("frontend", {}).get("pages", []) or []
        for p in pages:
            if isinstance(p, dict) and p.get("uuid") == page_uuid:
                return p
        return None

    # ═══════════════════════════════════════════════════════════════════
    # ComponentBuilderMultiple invocation safety wrapper
    # ═══════════════════════════════════════════════════════════════════

    async def _run_cbm_with_caps(
        self,
        ctx: InvocationContext,
        state: "_EditPhaseState",
        *,
        invocation_label: str,
    ) -> AsyncGenerator[Event, None]:
        """Run ComponentBuilderMultiple with tool-call + wall-clock caps.

        ADK's ``LlmAgent.run_async()`` has no built-in iteration limit
        (``base_llm_flow.run_async``: ``while True ... break only on
        is_final_response()``). When the model keeps emitting tool
        calls without a final-text response — read-loop / explore-loop
        pathologies — the dispatch can run until Cloud Run's 60-min
        request timeout.

        This wrapper bounds the invocation by both:

        - tool-call count (``COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS``,
          default 25): counts ``function_call`` parts across all
          yielded events. A typical convergent run lands in 4-12 calls.
        - wall-clock seconds (``COMPONENT_BUILDER_MULTIPLE_TIMEOUT_SECONDS``,
          default 600): total time spanning every LLM turn + tool
          execution + 429 backoff.

        On cap hit, the inner generator is closed (cancels in-flight
        LLM calls), a phase-level error is appended to
        ``StateKeys.AGENT_ERRORS`` so the workflow's terminal path
        finalizes with whatever was already saved, and the wrapper
        returns normally — never raising.
        """
        from config import (
            COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS,
            COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS,
            COMPONENT_BUILDER_MULTIPLE_TIMEOUT_SECONDS,
        )

        timeout_s = max(1, int(COMPONENT_BUILDER_MULTIPLE_TIMEOUT_SECONDS))

        # Route to the polish-mode variant when this dispatch originates
        # from DesignImportWorkflow's post-translation cleanup pass. The
        # polish agent has a narrower skill toolset (`component-editing`,
        # `state-hooks`, `theme-token-migration` only) and edit-only
        # write tools (no full-file `validate_and_save_*`), preventing
        # the LLM from regenerating sections that the mechanical
        # translator already produced byte-faithfully. See Track 3 in
        # ~/.claude/plans/create-a-full-fix-modular-horizon.md and
        # RC#2/#3/#9/#12/#13/#15 in app w4hov6ht's drift inventory.
        edit_plan_source = ctx.session.state.get(StateKeys.EDIT_PLAN_SOURCE)
        is_design_import_polish = edit_plan_source == "design_import"
        if is_design_import_polish and self.component_builder_polish_agent is not None:
            dispatch_agent = self.component_builder_polish_agent
            dispatch_label = AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH.value
            # Polish-mode processes 4-6 components per dispatch with
            # multiple edits per component — the standard 25 cap is too
            # tight (rdzn62gx hit it twice). Use the higher cap.
            max_calls = max(1, int(COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS))
        else:
            if is_design_import_polish:
                # Polish agent not wired (test fixtures or older callers).
                # Fall back to the full agent + log so the gap is visible.
                logger.warning(
                    f"[{state.agent_name}] EDIT_PLAN_SOURCE=design_import but "
                    "component_builder_polish_agent is None — falling back to "
                    "the full ComponentBuilderMultiple. Design-import drift "
                    "guardrails will not apply.",
                )
            dispatch_agent = self.component_builder_multiple_agent
            dispatch_label = AgentName.COMPONENT_BUILDER_MULTIPLE.value
            max_calls = max(1, int(COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS))

        inner = self._run_agent_with_metrics(
            ctx,
            dispatch_agent,
            dispatch_label,
            state.metrics_tracker,
        )

        call_count = 0
        # Tool-call interval at which to emit an SSE progress beat. Without
        # this, _run_cbm_with_caps yields whatever the inner agent yields
        # but emits zero progress events of its own — the phase-level
        # `building_component` event upstream is the only signal the user
        # sees during the dispatch. App ckfk4mun (2026-05-18) ran 11 min
        # of polish under that silence; the user thought the system had
        # hung and disabled Vertex AI manually. Three is small enough to
        # feel responsive without flooding the SSE channel; a 45-call
        # polish dispatch beats 15 times, well under 1 Hz.
        PROGRESS_BEAT_EVERY = 3
        last_beat_bucket = 0
        aborted_reason: Optional[str] = None
        start = time.monotonic()

        try:
            while True:
                elapsed = time.monotonic() - start
                remaining = timeout_s - elapsed
                if remaining <= 0:
                    aborted_reason = (
                        f"timeout: {timeout_s}s elapsed without final response"
                    )
                    break
                try:
                    event = await asyncio.wait_for(
                        inner.__anext__(), timeout=remaining
                    )
                except StopAsyncIteration:
                    break  # Agent terminated normally.
                except asyncio.TimeoutError:
                    aborted_reason = (
                        f"timeout: {timeout_s}s elapsed without final response"
                    )
                    break

                # Count function calls in this event. A single event can
                # carry multiple parallel calls.
                fcs = None
                try:
                    if event is not None and hasattr(event, "get_function_calls"):
                        fcs = event.get_function_calls()
                except Exception:
                    fcs = None
                if fcs:
                    call_count += len(fcs)

                yield event

                # Emit a progress beat whenever the tool-call count crosses
                # a new PROGRESS_BEAT_EVERY-sized bucket. Reuses the existing
                # `building_component` action so the backend's progress
                # orchestrator maps it to phase=`building` without needing
                # a new action registration.
                current_bucket = call_count // PROGRESS_BEAT_EVERY
                if fcs and current_bucket > last_beat_bucket:
                    last_beat_bucket = current_bucket
                    yield state.progress_tracker.create_event(
                        ctx,
                        "building_component",
                        internal_message=(
                            f"Polishing components ({call_count}/{max_calls})"
                        ),
                    )

                if call_count >= max_calls:
                    aborted_reason = (
                        f"tool-call cap: {call_count} calls reached max {max_calls}"
                    )
                    break
        finally:
            try:
                await inner.aclose()
            except Exception:
                logger.warning("cbm_inner_aclose_failed", exc_info=True)

        if aborted_reason:
            elapsed = round(time.monotonic() - start, 2)
            logger.warning(
                "cbm_dispatch_capped",
                label=invocation_label,
                reason=aborted_reason,
                tool_calls=call_count,
                elapsed_s=elapsed,
            )
            existing_errors = list(
                ctx.session.state.get(StateKeys.AGENT_ERRORS, []) or []
            )
            existing_errors.append(
                f"ComponentBuilderMultiple ({invocation_label}) aborted "
                f"after {elapsed}s / {call_count} tool calls — {aborted_reason}. "
                f"Workflow will finalize with whatever was saved before "
                f"the cap fired."
            )
            await push_session_state_update(
                ctx, {StateKeys.AGENT_ERRORS: existing_errors}
            )

    # ═══════════════════════════════════════════════════════════════════
    # Phase 8: frontend_build (ComponentBuilderMultiple cluster dispatch)
    # ═══════════════════════════════════════════════════════════════════

    async def _run_phase_frontend_build(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        """Cross-file frontend refactor dispatch.

        For each ``FrontendBuildAction``:
          1. Seed `_codefocus_sibling_modules` with every staged frontend
             artifact so tsc has full peer visibility on the first save.
          2. Build a ``ComponentBuilderMultipleInput`` with the action's
             prompt + read-only context. Skills are loaded by the worker
             at inference time via its SkillToolset.
          3. Invoke ComponentBuilderMultiple.
          4. Diff staged artifacts before/after to populate
             state.added/modified/removed_names + page registry mutations.
        """
        if state.edit_plan is None:
            return
        sorted_actions = sorted(
            state.edit_plan.frontend_build_actions, key=lambda a: a.priority
        )
        if not sorted_actions:
            if False:  # pragma: no cover
                yield
            return

        # ─────────────────────────────────────────────────────────────────
        # Parallel polish branch — design_import multi-action only.
        # ─────────────────────────────────────────────────────────────────
        #
        # DesignImportWorkflow emits one ``FrontendBuildAction`` per page
        # entry. With N pages, the sequential per-action loop below runs
        # the polish agent N times back-to-back; each dispatch consistently
        # hits the 30 tool-call cap on multi-page school-dashboard-class
        # imports. App fv83uavm (2026-05-18) was a 5-page bundle that timed
        # out at the 1200s WORKFLOW_TIMEOUT cap; 5 × ~3.3 min = 16.5 min
        # plus 2 min DesignImporter just exceeded the 20-min budget.
        #
        # Under parallel dispatch, the static N-slot polish pool runs up to
        # ``POLISH_NUM_SLOTS`` (default 3) entries concurrently per round.
        # 5-page imports split into 3+2 rounds → ~6-8 min wall time. The
        # pool is gated to the design-import polish flow ONLY — regular
        # editing turns and single-action design imports keep the existing
        # sequential ``_run_cbm_with_caps`` path with full per-action
        # tier-2 retry semantics.
        edit_plan_source = ctx.session.state.get(StateKeys.EDIT_PLAN_SOURCE)
        use_parallel_polish = (
            edit_plan_source == "design_import"
            and len(sorted_actions) > 1
        )

        if use_parallel_polish:
            async for event in self._run_phase_frontend_build_parallel_polish(
                ctx, state, sorted_actions
            ):
                yield event
            return

        # ─────────────────────────────────────────────────────────────────
        # Sequential per-action path — regular editing turns, single-action
        # design imports, or any path where the polish pool isn't gated in.
        # ─────────────────────────────────────────────────────────────────
        for action in sorted_actions:
            await self._tick(ctx, state, "frontend_build")
            yield state.progress_tracker.create_event(
                ctx,
                "building_component",
                internal_message="Refactoring frontend (cross-file build)",
            )

            # ── Snapshot staged frontend artifacts BEFORE the agent runs ──
            sources_before = await collect_frontend_artifact_sources(ctx)
            sibling_before_bare = snapshot_to_bare_names(sources_before)
            await push_session_state_update(
                ctx,
                {
                    "_codefocus_sibling_modules": dict(sibling_before_bare),
                    "_files_created_this_turn": [],
                    "_files_deleted_this_turn": [],
                    # The bleed guard's name set is None → prefix-allowlist
                    # alone carries the safety load (FrontendBuildAction is
                    # prompt-only; planner cannot enumerate targets).
                    "_expected_component_name": None,
                    "_expected_save_tool_name": None,
                },
            )

            # ── Build worker input ──
            # Skills are loaded by the worker at inference time via its
            # SkillToolset (list_skills / load_skill); workflow does not
            # pre-resolve any skill markdown.
            #
            # Pass image_catalog so render_action_prompt can append a
            # user-uploaded-image hint when the action creates new pages.
            # Mirrors the creation-flow safety net in
            # plan_artifact_materializer._distribute_unused_catalog_images:
            # edits that add new content sections previously left their
            # image_references empty and fell back to catalog keyword
            # search, hiding user uploads.
            worker_prompt = render_action_prompt(
                action,
                image_catalog=ctx.session.state.get("image_catalog", []) or [],
            )
            worker_input = ComponentBuilderMultipleInput(
                prompt=worker_prompt,
                design_system_context=state.design_system_context,
                backend_surface=state.backend_surface_for_builder(),
                logic_surface=state.logic_surface,
                app_context=state.app_context_json(),
                image_urls=state.image_urls_json(),
                app_language_code=state.app_language_code,
            )
            await push_prompt_to_next_agent(ctx, json.dumps(worker_input.model_dump()))
            async for event in self._run_cbm_with_caps(
                ctx, state, invocation_label="frontend_build"
            ):
                yield event

            # ── Tier 2 — end-of-turn dirty-file sweep + fix-up retry ──
            #
            # Sweep the FULL pipeline over files this turn touched
            # (created + modified + their importers). If errors remain,
            # re-invoke ComponentBuilderMultiple with a fix-up prompt
            # up to ``COMPONENT_BUILDER_MULTIPLE_FIX_UP_RETRIES`` times.
            # The sweep is purely agent-internal — only terminal
            # failures bubble up.
            async for event in self._run_tier2_fix_up_loop(
                ctx, state, action, worker_prompt
            ):
                yield event

            # ── Post-agent diff + side-effect application ──
            sources_after = await collect_frontend_artifact_sources(ctx)
            files_created = list(
                ctx.session.state.get("_files_created_this_turn") or []
            )
            files_deleted = list(
                ctx.session.state.get("_files_deleted_this_turn") or []
            )
            # Fallback: if the agent didn't go through tracked save/delete
            # paths, derive created/deleted from the snapshot diff.
            if not files_created:
                files_created = [
                    name for name in sources_after if name not in sources_before
                ]
            if not files_deleted:
                files_deleted = [
                    name for name in sources_before if name not in sources_after
                ]

            await self._apply_frontend_build_post_dispatch(
                ctx,
                state,
                action=action,
                sibling_before_bare=sibling_before_bare,
                sources_after=sources_after,
                files_created=files_created,
                files_deleted=files_deleted,
            )

    async def _apply_frontend_build_post_dispatch(
        self,
        ctx: InvocationContext,
        state: "_EditPhaseState",
        *,
        action,
        sibling_before_bare: dict,
        sources_after: dict,
        files_created: list,
        files_deleted: list,
    ) -> None:
        """Run the per-action side-effects + bookkeeping.

        Factored out of ``_run_phase_frontend_build`` so the parallel
        polish path can reuse the same post-dispatch logic (page registry
        mutations, validation context refresh, image resolution). Mutates
        ``state`` in place; returns nothing.
        """
        side_effects = await apply_frontend_build_side_effects(
            ctx,
            action=action,
            current_config=state.current_config,
            sibling_modules_before=sibling_before_bare,
            artifact_sources_after=sources_after,
            files_created_this_turn=files_created,
            files_deleted_this_turn=files_deleted,
        )

        for added in side_effects.added_components:
            state.added_components.append(added)
        for name in side_effects.modified_names:
            if name not in state.modified_names:
                state.modified_names.append(name)
        for name in side_effects.removed_names:
            if name not in state.removed_names:
                state.removed_names.append(name)
        for uuid_ in side_effects.removed_page_uuids:
            if uuid_ not in state.removed_page_uuids:
                state.removed_page_uuids.append(uuid_)

        # Refresh existing_page_list so the next action's app_context
        # JSON sees the registry mutations.
        state.existing_page_list = [
            {"title": p.get("title", ""), "slug": p.get("slug", "/")}
            for p in state.current_config.get("frontend", {}).get("pages", []) or []
            if isinstance(p, dict)
        ]
        await self._refresh_validation_context(
            ctx,
            state.updated_backend_config,
            state.updated_logic_config,
            state.existing_pages,
            state.added_components,
        )

        # Image resolution sweep over each modified / added entry.
        seen_for_images: set[str] = set()
        for name in side_effects.modified_names + [
            c.name for c in side_effects.added_components
        ]:
            if name in seen_for_images:
                continue
            seen_for_images.add(name)
            await self._resolve_component_images(ctx, name, state.agent_name)

    async def _run_phase_frontend_build_parallel_polish(
        self,
        ctx: InvocationContext,
        state: "_EditPhaseState",
        sorted_actions: list,
    ) -> AsyncGenerator[Event, None]:
        """Parallel polish dispatch via the static N-slot pool.

        Mirrors :func:`CreationWorkflow`'s chunked-rounds shape
        (creation_workflow.py:1628-1713). Per round:

          1. Snapshot artifacts ONCE; seed the shared sibling-modules
             cache. Reset legacy global write-trackers (polish never
             touches the create/delete keys, but a defensive reset
             prevents stale state from leaking across the previous
             sequential phase into this parallel round).
          2. For each ``(slot_name, action)`` in the active batch: build
             the worker input, push it to ``state[{slot}_input]``, reset
             the slot's tool-call counter and per-slot dirty list,
             emit a pre-anticipation progress event.
          3. Dispatch the ``TimeoutParallelAgent`` once for the whole
             round — ADK runs all active slots concurrently, branches
             session state, and merges events back into a single stream.
          4. After dispatch, drain the per-slot ``_files_modified_this_turn__{slot}``
             accumulators into a per-action ``files_modified`` list,
             run the standard post-dispatch side-effects loop (page
             registry mutations, validation context refresh, image
             resolution) sequentially over the batch — preserving the
             chained-append semantics of ``state.added_components`` /
             ``state.modified_names`` / ``state.removed_names``.
          5. Log a ``cross_slot_module_overlap`` warning when two slots
             wrote the same filename in the round. Empirical risk is
             low (~0% in fv83uavm/ckfk4mun observations) but worth
             tracking so we can escalate to v2 module-scope tightening
             if it ever fires above a few percent of polish rounds.
          6. Pop every per-slot state key before the next round to
             prevent idle-slot bleed.

        Tier-2 fix-up retry is deliberately SKIPPED on the parallel
        path. The retry path was 0% hit rate across fv83uavm/ckfk4mun
        (`tier2_fix_up_clean attempt=0 dirty_count=1` after every
        dispatch). If a future build needs the retry, design a
        round-replay (re-dispatch the same batch with the fix-up prompt)
        then. The single-action sequential path keeps the original
        ``_run_tier2_fix_up_loop`` semantics.
        """
        for round_idx, batch in enumerate(
            polish_chunk_actions(sorted_actions, POLISH_NUM_SLOTS)
        ):
            active_slots = POLISH_SLOT_NAMES[: len(batch)]

            await self._tick(ctx, state, "frontend_build")

            # ── Per-round snapshot + shared sibling cache ──
            sources_before = await collect_frontend_artifact_sources(ctx)
            sibling_before_bare = snapshot_to_bare_names(sources_before)
            await push_session_state_update(
                ctx,
                {
                    "_codefocus_sibling_modules": dict(sibling_before_bare),
                    # Polish never creates or deletes (no save/delete tools
                    # in toolset), but reset defensively in case the
                    # previous sequential phase left these populated.
                    "_files_created_this_turn": [],
                    "_files_deleted_this_turn": [],
                    "_expected_component_name": None,
                    "_expected_save_tool_name": None,
                },
            )
            # Activate slots via DIRECT state write — mirrors
            # creation_workflow.py:1657 (per-round activation needs to
            # land on the local state mapping immediately so the slot's
            # before_agent_callback sees it on the same tick, regardless
            # of whether session_service persistence has flushed).
            ctx.session.state[STATE_EXECUTION_COMPONENTS_POLISH] = list(active_slots)
            # Publish the round's active slot list under a dedicated key
            # that the inline cross-slot overlap detector reads from
            # _record_artifact_write_kind (see artifact_tools.py). Kept
            # separate from STATE_EXECUTION_COMPONENTS_POLISH (which gates
            # the slot-skip callback) so future changes to one don't
            # silently alter the other's semantics.
            ctx.session.state["_polish_active_slots"] = list(active_slots)

            # ── Per-slot input + reset per-slot counters ──
            batch_inputs = []
            for slot_name, action in zip(active_slots, batch):
                worker_prompt = render_action_prompt(
                    action,
                    image_catalog=ctx.session.state.get("image_catalog", []) or [],
                )
                worker_input = ComponentBuilderMultipleInput(
                    prompt=worker_prompt,
                    design_system_context=state.design_system_context,
                    backend_surface=state.backend_surface_for_builder(),
                    logic_surface=state.logic_surface,
                    app_context=state.app_context_json(),
                    image_urls=state.image_urls_json(),
                    app_language_code=state.app_language_code,
                )
                batch_inputs.append((slot_name, action, worker_input))
                ctx.session.state[polish_slot_input_state_key(slot_name)] = json.dumps(
                    worker_input.model_dump()
                )
                # Expected-name key is diagnostic-only under the polish
                # flow (no save tool to gate); populate for log clarity.
                expected_entry = self._entry_name_from_action(action)
                ctx.session.state[
                    polish_slot_expected_name_state_key(slot_name)
                ] = expected_entry
                ctx.session.state[polish_slot_tool_call_state_key(slot_name)] = 0
                ctx.session.state[polish_slot_files_modified_state_key(slot_name)] = []
                # Hard ownership whitelist for edit_artifact_tool. The
                # owned set is JUST the entry file — supporting modules
                # are read-only context across the round. Prevents the
                # cross-slot collision pattern observed in production
                # app b9kwhxdv (round 3 wrote MessagesContent.tsx from
                # three slots within seconds, silently dropping two
                # slots' edits to last-writer-wins).
                ctx.session.state[f"_polish_owned_files__{slot_name}"] = [
                    f"codefocus_component:{expected_entry}.tsx"
                ]

                # Pre-anticipation progress beat — mirrors CreationWorkflow's
                # round-start burst at creation_workflow.py:1637-1654.
                yield state.progress_tracker.create_event(
                    ctx,
                    "building_component",
                    internal_message=(
                        f"Polishing {expected_entry} "
                        f"(round {round_idx + 1}, slot {slot_name})"
                    ),
                )

            # ── Round-level metrics + dispatch ──
            metrics_tracker = state.metrics_tracker
            try:
                polish_model = get_agent_model_name(
                    AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH.value
                )
            except KeyError:
                polish_model = None
            if metrics_tracker:
                await metrics_tracker.start_agent(
                    ctx,
                    AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH.value,
                    model=polish_model,
                )

            try:
                async for event in component_builder_multiple_polish_parallel._run_async_impl(
                    ctx
                ):
                    if (
                        metrics_tracker
                        and hasattr(event, "usage_metadata")
                        and event.usage_metadata
                    ):
                        await metrics_tracker.record_tokens(
                            ctx,
                            event.usage_metadata,
                            AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH.value,
                        )
                    yield event
            finally:
                if metrics_tracker:
                    await metrics_tracker.stop_agent(ctx)
                # Defence-in-depth overlap logging from the per-slot
                # lists populated up to the cancel point. With the
                # edit_artifact_tool ownership gate this should fire
                # zero hits; if it does fire, it means a future write
                # tool skipped the gate. Lives in finally: so WORKFLOW
                # _TIMEOUT cancellation (GeneratorExit through the
                # TaskGroup) still surfaces it.
                self._log_cross_slot_overlap(ctx, active_slots, round_idx)

            # ── Per-action post-dispatch loop (sequential within the round) ──
            sources_after = await collect_frontend_artifact_sources(ctx)

            # Rebuild per_slot_writes for the post-dispatch loop (the
            # in-finally detector consumed only the round-end snapshot;
            # the bookkeeping below still needs the per-slot lists).
            per_slot_writes: dict[str, list[str]] = {}
            for slot_name in active_slots:
                per_slot_writes[slot_name] = list(
                    ctx.session.state.get(
                        polish_slot_files_modified_state_key(slot_name)
                    )
                    or []
                )

            for slot_name, action, _worker_input in batch_inputs:
                slot_files_modified = per_slot_writes.get(slot_name, [])
                # Polish has no save/delete tools — `_files_created_this_turn`
                # and `_files_deleted_this_turn` stay empty. The artifact
                # diff fallback below covers the rare case where the
                # mechanical translator wrote something the polish agent
                # touched (none in practice).
                files_created: list[str] = [
                    name for name in sources_after if name not in sources_before
                ]
                files_deleted: list[str] = [
                    name for name in sources_before if name not in sources_after
                ]
                await self._apply_frontend_build_post_dispatch(
                    ctx,
                    state,
                    action=action,
                    sibling_before_bare=sibling_before_bare,
                    sources_after=sources_after,
                    files_created=files_created,
                    files_deleted=files_deleted,
                )

            # ── Per-round state cleanup (mirrors creation_workflow.py:1710-1713) ──
            ctx.session.state.pop(STATE_EXECUTION_COMPONENTS_POLISH, None)
            ctx.session.state.pop("_polish_active_slots", None)
            for slot_name in POLISH_SLOT_NAMES:
                ctx.session.state.pop(polish_slot_input_state_key(slot_name), None)
                ctx.session.state.pop(
                    polish_slot_expected_name_state_key(slot_name), None
                )
                ctx.session.state.pop(polish_slot_tool_call_state_key(slot_name), None)
                ctx.session.state.pop(
                    polish_slot_files_modified_state_key(slot_name), None
                )
                ctx.session.state.pop(f"_polish_owned_files__{slot_name}", None)

    @staticmethod
    def _entry_name_from_action(action) -> str:
        """Best-effort extraction of the entry-component name from a
        ``FrontendBuildAction.prompt``. Used for log lines and the slot's
        ``_expected_component_name__{slot}`` diagnostic key. The polish
        flow has no save tool, so the value isn't gating any guardrail —
        a fallback string is acceptable when parsing fails."""
        prompt = getattr(action, "prompt", "") or ""
        # design_import_workflow._build_compliance_prompt formats the
        # prompt as: "Polish the mechanically-translated entry component
        # `EntryName` for platform compliance. ..."
        match = re.search(r"entry component `([A-Z][A-Za-z0-9_]*)`", prompt)
        if match:
            return match.group(1)
        return "frontend_build_action"

    @staticmethod
    def _log_cross_slot_overlap(
        ctx: InvocationContext, active_slots: list[str], round_idx: int
    ) -> None:
        """Round-end cross-slot module-overlap detector.

        Reads each active slot's ``_files_modified_this_turn__{slot}``
        list and emits one ``cross_slot_module_overlap`` warning per
        filename that two-or-more slots wrote in the same round. Runs
        from inside the dispatch ``finally:`` so ``WORKFLOW_TIMEOUT``
        cancellation (``GeneratorExit`` through the ParallelAgent's
        TaskGroup) still surfaces overlap signal up to the cancel point.

        With the ``edit_artifact_tool`` ownership gate in place this
        helper is defensively redundant; it stays as a tripwire for
        future write tools that bypass the gate.
        """
        per_slot_writes: dict[str, list[str]] = {}
        for slot_name in active_slots:
            per_slot_writes[slot_name] = list(
                ctx.session.state.get(
                    polish_slot_files_modified_state_key(slot_name)
                )
                or []
            )
        overlap_by_file: dict[str, list[str]] = {}
        for slot_name, files in per_slot_writes.items():
            for fn in files:
                overlap_by_file.setdefault(fn, []).append(slot_name)
        for fn, slots in overlap_by_file.items():
            if len(slots) >= 2:
                logger.warning(
                    "cross_slot_module_overlap",
                    filename=fn,
                    slots=sorted(slots),
                    round=round_idx,
                )

    async def _run_tier2_fix_up_loop(
        self,
        ctx: InvocationContext,
        state: "_EditPhaseState",
        action,
        original_prompt: str,
    ) -> AsyncGenerator[Event, None]:
        """Tier-2 dirty-file sweep + fix-up re-invocation.

        After ComponentBuilderMultiple ends its turn, sweep the full
        validation pipeline over every file touched this turn (and
        their importers). When errors remain, re-invoke the agent with
        a fix-up prompt up to N retries, then give up.

        N defaults to 1 (env: ``COMPONENT_BUILDER_MULTIPLE_FIX_UP_RETRIES``).
        Failures past the cap surface via ``state.agent_errors`` /
        ``StateKeys.AGENT_ERRORS`` so the workflow's existing terminal
        path picks them up.
        """
        from main_agent.services.validation.dirty_file_sweeper import (
            render_fix_up_prompt,
            sweep_dirty_files,
        )
        from config import COMPONENT_BUILDER_MULTIPLE_FIX_UP_RETRIES

        max_retries = max(0, int(COMPONENT_BUILDER_MULTIPLE_FIX_UP_RETRIES))
        current_prompt = original_prompt

        for attempt in range(max_retries + 1):
            sources = await collect_frontend_artifact_sources(ctx)
            dirty: set[str] = set()
            for key in ("_files_created_this_turn", "_files_modified_this_turn"):
                for name in ctx.session.state.get(key) or []:
                    if isinstance(name, str):
                        dirty.add(name)
            if not dirty:
                # Nothing touched — nothing to sweep.
                return

            theme_css = ""
            try:
                theme_artifact = await ctx.artifact_service.load_artifact(
                    session_id=ctx.session.id,
                    user_id=ctx.session.user_id,
                    app_name=ctx.session.app_name,
                    filename="codefocus_style:theme.css",
                )
                if theme_artifact and getattr(theme_artifact, "inline_data", None):
                    theme_css = theme_artifact.inline_data.data.decode(
                        "utf-8", errors="replace"
                    )
            except Exception:
                theme_css = ""

            issues = await sweep_dirty_files(
                dirty,
                sources,
                theme_css=theme_css,
                models=ctx.session.state.get("_validation_context_models") or [],
                handlers=ctx.session.state.get("_validation_context_handlers") or [],
                logic=ctx.session.state.get("_validation_context_logic") or {},
                page_slugs=ctx.session.state.get(
                    "_validation_context_page_slugs"
                )
                or [],
                theme_palette=ctx.session.state.get(
                    "_validation_context_theme_palette"
                )
                or {},
            )
            error_issues = {
                fname: [i for i in lst if i.severity == "error"]
                for fname, lst in issues.items()
            }
            error_issues = {f: lst for f, lst in error_issues.items() if lst}

            if not error_issues:
                logger.info(
                    "tier2_fix_up_clean",
                    attempt=attempt,
                    dirty_count=len(dirty),
                )
                return

            if attempt >= max_retries:
                # Out of retries — surface as a phase-level error.
                summary = "; ".join(
                    f"{fn} ({len(lst)} errors)" for fn, lst in error_issues.items()
                )
                logger.error(
                    "tier2_fix_up_exhausted",
                    attempt=attempt,
                    files=list(error_issues),
                    summary=summary,
                )
                existing_errors = list(
                    ctx.session.state.get(StateKeys.AGENT_ERRORS, []) or []
                )
                existing_errors.append(
                    f"ComponentBuilderMultiple Tier-2 fix-up exhausted after "
                    f"{max_retries} retry(ies): {summary}"
                )
                await push_session_state_update(
                    ctx, {StateKeys.AGENT_ERRORS: existing_errors}
                )
                return

            # Build the fix-up prompt and re-invoke.
            current_prompt = render_fix_up_prompt(current_prompt, issues)
            logger.info(
                "tier2_fix_up_retry",
                attempt=attempt,
                files=list(error_issues),
            )
            # Emit a progress beat so the front-end knows the retry phase
            # has started. Without this the user sees the same `80%`
            # frozen-bar UX the initial dispatch did, but now extended by
            # another N minutes (ckfk4mun 2026-05-18: 5 more minutes of
            # silence after the initial polish already ran 5 min).
            yield state.progress_tracker.create_event(
                ctx,
                "building_component",
                internal_message=(
                    f"Polishing components (retry {attempt + 1}, fixing "
                    f"{len(error_issues)} file(s))"
                ),
            )
            retry_input = ComponentBuilderMultipleInput(
                prompt=current_prompt,
                design_system_context=state.design_system_context,
                backend_surface=state.backend_surface_for_builder(),
                logic_surface=state.logic_surface,
                app_context=state.app_context_json(),
                image_urls=state.image_urls_json(),
                app_language_code=state.app_language_code,
            )
            await push_prompt_to_next_agent(
                ctx, json.dumps(retry_input.model_dump())
            )
            async for event in self._run_cbm_with_caps(
                ctx, state, invocation_label=f"tier2_retry_{attempt + 1}"
            ):
                yield event

    # ═══════════════════════════════════════════════════════════════════
    # Batch validation (extracted from execute)
    # ═══════════════════════════════════════════════════════════════════

    async def _run_batch_validation(
        self,
        ctx: InvocationContext,
        current_config: dict,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        has_components = bool(state.modified_names or state.added_components)
        theme_changed = bool(state.edit_plan and state.edit_plan.modify_styles_actions)
        styles_only = theme_changed and not has_components
        if not (has_components or styles_only):
            return

        unresolved_components = dict(ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}))
        if unresolved_components:
            await self._record_terminal_component_failure(ctx, state, unresolved_components)
            return

        if styles_only:
            async for event in self._run_styles_only_coverage(ctx, state):
                yield event
            # A recolor must regenerate compiled.css against the new theme over
            # the FULL component set. theme.css alone is not enough: compiled.css
            # bakes the theme :root color tokens at Tailwind-compile time, so
            # without this pass it keeps the OLD colors and overrides the recolor
            # (partial recolor — verified app 0ahokkja, 2026-05-25).
            if not state.terminal_failure_summary:
                async for event in self._recompile_all_components_css(ctx, state):
                    yield event
            return

        async for event in self._run_components_touched_validation(
            ctx, current_config, state, unresolved_components
        ):
            yield event
        # If a theme change rode alongside component edits, the touched-only
        # compile inside _run_components_touched_validation can omit untouched
        # components' utility classes and their recolor — recompile the full set.
        if theme_changed and not state.terminal_failure_summary:
            async for event in self._recompile_all_components_css(ctx, state):
                yield event

    async def _run_components_touched_validation(
        self,
        ctx: InvocationContext,
        current_config: dict,
        state: _EditPhaseState,
        unresolved_components: dict[str, str],
    ) -> AsyncGenerator[Event, None]:
        """Components-touched branch of post-edit validation.

        Per-component Stages 1+2+4 already ran inline at component save
        time. The only batch-level work is the final Tailwind compile,
        plus an optional read-only style-coverage sweep over UNTOUCHED
        components when this turn also modified the theme.
        """
        from main_agent.services.validation.final_compile_gate import (
            TAILWIND_BASE_CSS,
            run_final_compile_gate,
        )

        yield state.progress_tracker.create_event(
            ctx, "validating", internal_message="Validating components"
        )
        logger.info(f"[{state.agent_name}] Step 2.4: Final Tailwind compile gate")

        touched_names = set(state.modified_names + [c.name for c in state.added_components])
        tsx_sources: dict[str, str] = {}
        for name in touched_names:
            source = await ArtifactManager.load_artifact_as_string(
                ctx, f"codefocus_component:{name}.tsx"
            )
            if source:
                tsx_sources[name] = source

        # Phase 2/4: also feed Babel-shell supporting modules into the
        # Tailwind compile so utility classes that only appear inside
        # `Charts.tsx` / `Sidebar.tsx` etc. survive Tailwind's tree-shake.
        # Without this, a Phase 4 module edit that introduces new classes
        # (e.g. `bg-primary-container/40` only used in the Donut chart)
        # would compile a CSS file missing those classes — the deployed
        # app would render unstyled.
        # Modules are loaded under synthetic keys so they don't collide
        # with same-named entries; the gate only reads `tsx_sources.values()`
        # for class extraction so the key is purely a uniqueness marker.
        seen_module_keys: set[str] = set()
        for entry_name in touched_names:
            for mod_name in _supporting_modules_for(state.current_config, entry_name):
                if mod_name in seen_module_keys:
                    continue
                seen_module_keys.add(mod_name)
                mod_source = await ArtifactManager.load_artifact_as_string(
                    ctx, f"codefocus_module:{mod_name}.tsx"
                )
                if mod_source:
                    tsx_sources[f"__module__/{mod_name}"] = mod_source

        base_css = (
            await ArtifactManager.load_artifact_as_string(ctx, "codefocus_style:theme.css")
            or TAILWIND_BASE_CSS
        )
        tailwind_config = base_css  # v4: config is embedded in the CSS

        # Offload the synchronous `tailwindcss` subprocess (up to 30s) to a
        # worker thread so it does not block the event loop.
        compile_result = await asyncio.to_thread(
            run_final_compile_gate,
            theme_css=base_css,
            tsx_sources=tsx_sources,
        )

        if compile_result.rewritten_theme_css is not None:
            from google import genai as genai_module

            theme_bytes = compile_result.rewritten_theme_css.encode("utf-8")
            theme_artifact = genai_module.types.Part.from_bytes(
                data=theme_bytes, mime_type="text/css"
            )
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename="codefocus_style:theme.css",
                artifact=theme_artifact,
            )
            tailwind_config = compile_result.rewritten_theme_css

        if compile_result.compiled_css:
            from google import genai as genai_module

            css_bytes = compile_result.compiled_css.encode("utf-8")
            css_artifact = genai_module.types.Part.from_bytes(data=css_bytes, mime_type="text/css")
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename="codefocus_style:compiled.css",
                artifact=css_artifact,
            )

        for w in compile_result.warnings:
            logger.warning(f"[{state.agent_name}] Compile warning: {w}")
        for f in compile_result.fixes_applied:
            logger.info(f"[{state.agent_name}] Compile auto-fixed: {f}")

        if not compile_result.success:
            logger.error(
                f"[{state.agent_name}] Final Tailwind compile failed",
                errors=compile_result.fatal_errors[:5],
            )
            await self._record_terminal_validation_error(
                ctx,
                state,
                summary=(
                    f"Tailwind compile failed: " f"{'; '.join(compile_result.fatal_errors[:3])}"
                ),
                stage="CssCompilationError",
            )
            return

        # E2: theme-modifying turn — sweep UNTOUCHED components for tokens
        # removed out from under them. Read-only; no auto-fix.
        if state.edit_plan and state.edit_plan.modify_styles_actions:
            await self._coverage_check_untouched(ctx, state, touched_names, tailwind_config)

    async def _recompile_all_components_css(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        """Regenerate compiled.css against the new theme over the FULL component
        set after a theme/color edit.

        A recolor rewrites theme.css tokens, but compiled.css bakes the theme
        ``:root`` variables (``--color-primary`` etc.) at Tailwind-compile time.
        Without this pass, compiled.css keeps the OLD tokens and overrides the
        new theme, so the recolor only partially lands (verified app 0ahokkja,
        2026-05-25). Compiling over ALL components — not just the touched set —
        keeps every utility class in the regenerated CSS.
        """
        from main_agent.services.validation.final_compile_gate import (
            TAILWIND_BASE_CSS,
            run_final_compile_gate,
        )

        base_css = (
            await ArtifactManager.load_artifact_as_string(ctx, "codefocus_style:theme.css")
            or TAILWIND_BASE_CSS
        )

        tsx_sources = await self._load_rehydrated_component_sources(ctx, state)
        if not tsx_sources:
            return

        # Include supporting Babel-shell modules so their utility classes
        # survive Tailwind's tree-shake (mirrors _run_components_touched_validation).
        seen_module_keys: set[str] = set()
        for entry_name in list(tsx_sources.keys()):
            for mod_name in _supporting_modules_for(state.current_config, entry_name):
                if mod_name in seen_module_keys:
                    continue
                seen_module_keys.add(mod_name)
                mod_source = await ArtifactManager.load_artifact_as_string(
                    ctx, f"codefocus_module:{mod_name}.tsx"
                )
                if mod_source:
                    tsx_sources[f"__module__/{mod_name}"] = mod_source

        yield state.progress_tracker.create_event(
            ctx, "validating", internal_message="Recompiling styles for theme change"
        )
        logger.info(
            f"[{state.agent_name}] Theme-change full recompile "
            f"({len(tsx_sources)} sources)"
        )

        # Offload the synchronous `tailwindcss` subprocess (up to 30s) to a
        # worker thread so it does not block the event loop.
        compile_result = await asyncio.to_thread(
            run_final_compile_gate,
            theme_css=base_css,
            tsx_sources=tsx_sources,
        )

        if compile_result.rewritten_theme_css is not None:
            from google import genai as genai_module

            theme_bytes = compile_result.rewritten_theme_css.encode("utf-8")
            theme_artifact = genai_module.types.Part.from_bytes(
                data=theme_bytes, mime_type="text/css"
            )
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename="codefocus_style:theme.css",
                artifact=theme_artifact,
            )

        if compile_result.compiled_css:
            from google import genai as genai_module

            css_bytes = compile_result.compiled_css.encode("utf-8")
            css_artifact = genai_module.types.Part.from_bytes(data=css_bytes, mime_type="text/css")
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename="codefocus_style:compiled.css",
                artifact=css_artifact,
            )

        for w in compile_result.warnings:
            logger.warning(f"[{state.agent_name}] Recompile warning: {w}")

        if not compile_result.success:
            logger.error(
                f"[{state.agent_name}] Theme-change recompile failed",
                errors=compile_result.fatal_errors[:5],
            )
            await self._record_terminal_validation_error(
                ctx,
                state,
                summary=(
                    f"Tailwind recompile failed: "
                    f"{'; '.join(compile_result.fatal_errors[:3])}"
                ),
                stage="CssCompilationError",
            )

    async def _load_rehydrated_component_sources(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
        *,
        exclude: Optional[set[str]] = None,
    ) -> dict[str, str]:
        """Return ``{component_name: tsx_source}`` for all rehydrated
        component artifacts. Names in ``exclude`` are skipped. Returns an
        empty dict if artifact enumeration fails."""
        try:
            all_keys = await ctx.artifact_service.list_artifact_keys(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
            )
        except Exception as e:  # pragma: no cover
            logger.warning(
                f"[{state.agent_name}] list_artifact_keys failed during coverage scan: {e}"
            )
            return {}

        sources: dict[str, str] = {}
        for key in all_keys:
            if not (key.startswith("codefocus_component:") and key.endswith(".tsx")):
                continue
            name = key[len("codefocus_component:") : -len(".tsx")]
            if exclude and name in exclude:
                continue
            source = await ArtifactManager.load_artifact_as_string(ctx, key)
            if source:
                sources[name] = source
        return sources

    async def _record_coverage_failure(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
        warnings: list[str],
        *,
        scope_label: str,
        stage: str,
    ) -> None:
        summary = (
            f"Theme change broke style coverage for {scope_label} "
            f"({len(warnings)} warnings): {warnings[0]}"
        )
        logger.error(
            f"[{state.agent_name}] {scope_label.capitalize()} coverage check failed",
            warning_count=len(warnings),
            sample=warnings[:3],
        )
        await self._record_terminal_validation_error(
            ctx,
            state,
            summary=summary,
            stage=stage,
        )

    async def _coverage_check_untouched(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
        touched_names: set[str],
        tailwind_config: str,
    ) -> None:
        """Read-only stage-4 pass over components NOT in the touched set.

        The in-pipeline stage 4 already covered touched components against
        the new theme. This extra pass catches the untouched component that
        references a theme token the user removed in the same turn.
        """
        from main_agent.services.validation.style_coverage import validate_style_coverage

        untouched_sources = await self._load_rehydrated_component_sources(
            ctx, state, exclude=touched_names
        )
        if not untouched_sources:
            return

        warnings = validate_style_coverage(untouched_sources, tailwind_config)
        if warnings:
            await self._record_coverage_failure(
                ctx,
                state,
                warnings,
                scope_label="untouched components",
                stage="StyleCoverageUntouched",
            )

    async def _run_styles_only_coverage(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
    ) -> AsyncGenerator[Event, None]:
        """Stage-4-only pass for styles-only edits.

        No TSX was modified, so syntax/semantic stages have no work and the
        semantic auto-fix is unsafe to run on untouched files. Style coverage
        is a read-only class-token scan that catches the only real cross-file
        hazard of a theme change: a removed theme token referenced by an
        existing component.

        On warnings, the workflow used to abort all-or-nothing. We now
        escalate: parse the warnings to identify which components reference
        the dropped tokens and rewrite them via ComponentBuilder so the
        edit can land instead of forcing the user to re-prompt.
        """
        from main_agent.services.validation.final_compile_gate import TAILWIND_BASE_CSS
        from main_agent.services.validation.style_coverage import validate_style_coverage

        yield state.progress_tracker.create_event(
            ctx, "validating", internal_message="Checking style coverage"
        )

        theme_css = (
            await ArtifactManager.load_artifact_as_string(ctx, "codefocus_style:theme.css")
            or TAILWIND_BASE_CSS
        )

        tsx_sources = await self._load_rehydrated_component_sources(ctx, state)
        warnings = validate_style_coverage(tsx_sources, theme_css)
        if warnings:
            async for event in self._escalate_styles_only_to_component_rewrite(
                ctx, state, warnings, theme_css
            ):
                yield event

    async def _escalate_styles_only_to_component_rewrite(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
        warnings: list[str],
        theme_css: str,
    ) -> AsyncGenerator[Event, None]:
        """Rewrite components that reference removed theme tokens.

        When a styles-only edit drops tokens that existing components still
        use, the read-only stage-4 sweep produces N warnings of the form
        ``[ComponentName] Class "<full_class>" — <color|font> "<token>"
        not in ...``. Instead of aborting (which forces the user to
        re-prompt with "also restyle existing components"), we parse the
        warnings into ``{component: [removed_tokens]}``, hand each
        component back to ComponentBuilder with the removed-token list as
        a building hint, save the regenerated TSX, then re-run stage-4 to
        confirm coverage.

        On success, leaves ``state.modified_names`` populated with the
        rewritten component names and lets the workflow flow into
        ``_assemble_and_save`` (``SAVE_APP_CONFIG=True``,
        ``RELOAD_APP=True``).

        On failure, calls ``_record_coverage_failure`` with stage label
        ``StyleCoverageEscalated`` so the failure is distinguishable from
        the original ``StyleCoverage`` abort in ``agent_errors.json``.
        """
        from main_agent.services.validation.style_coverage import validate_style_coverage

        affected: dict[str, set[str]] = {}
        for w in warnings:
            m = _COVERAGE_WARNING_RE.match(w)
            if not m:
                continue
            affected.setdefault(m.group("component"), set()).add(m.group("token"))

        if not affected:
            await self._record_coverage_failure(
                ctx,
                state,
                warnings,
                scope_label="existing components",
                stage="StyleCoverage",
            )
            return

        yield state.progress_tracker.create_event(
            ctx,
            "building_component",
            internal_message=(
                f"Theme dropped tokens still in use; rewriting " f"{len(affected)} component(s)"
            ),
        )
        logger.info(
            "styles_only_escalation_started",
            affected_count=len(affected),
            components=sorted(affected.keys()),
        )

        rewritten: dict[str, str] = {}
        for component_name, removed_tokens in affected.items():
            existing_artifact = f"codefocus_component:{component_name}.tsx"
            existing_source = await ArtifactManager.load_artifact_as_string(ctx, existing_artifact)
            if not existing_source:
                logger.warning(
                    "styles_only_escalation_missing_artifact",
                    component=component_name,
                )
                continue

            token_list = ", ".join(sorted(removed_tokens))
            building_plan = [
                (
                    f"The theme has changed. The following tokens are no longer "
                    f"defined and must be replaced with semantically-equivalent "
                    f"tokens from the new theme: {token_list}."
                ),
                (
                    "This is a styles-only-coverage escalation — load the "
                    "`theme-token-migration` skill via load_skill before "
                    "writing any code."
                ),
                (
                    "Rewrite this component's classes to use only tokens "
                    "present in the current theme.css. Do not change behavior "
                    "or layout."
                ),
            ]

            # C.1: eagerly load prior TSX so ComponentBuilder skips its
            # initial load_artifacts tool call.
            rewrite_existing_source = (
                await ArtifactManager.load_artifact_as_string(ctx, existing_artifact)
            ) or ""

            rewrite_input = ComponentBuilderInput(
                build_mode="edit",
                existing_source_artifact=existing_artifact,
                existing_source=rewrite_existing_source,
                component_name=component_name,
                component_role=_get_component_role(state.current_config, component_name),
                building_plan=building_plan,
                design_system_context=state.design_system_context,
                app_language_code=state.app_language_code,
                output_artifact_name=component_name,
                app_context=state.app_context_json(),
                image_urls=state.image_urls_json(),
                content_artifact="",
                backend_surface=state.backend_surface_for_builder(),
                logic_surface=state.logic_surface,
            )

            await push_session_state_update(ctx, {"_expected_component_name": component_name})
            await push_prompt_to_next_agent(ctx, json.dumps(rewrite_input.model_dump()))
            async for event in self._run_agent_with_metrics(
                ctx,
                self.component_builder_agent,
                AgentName.COMPONENT_BUILDER.value,
                state.metrics_tracker,
            ):
                yield event

            saved = await ArtifactManager.load_artifact_as_string(ctx, existing_artifact)
            if saved:
                rewritten[component_name] = saved
                if component_name not in state.modified_names:
                    state.modified_names.append(component_name)
            else:
                logger.error(
                    "styles_only_escalation_no_artifact",
                    component=component_name,
                )

        if not rewritten:
            await self._record_coverage_failure(
                ctx,
                state,
                warnings,
                scope_label="existing components",
                stage="StyleCoverageEscalated",
            )
            return

        # Re-run stage-4 against the rewritten components AND any remaining
        # untouched components — the warning parse may have missed a few,
        # and we want a single failure if anything still references a
        # dropped token.
        follow_up_warnings = list(validate_style_coverage(rewritten, theme_css))
        untouched_sources = await self._load_rehydrated_component_sources(
            ctx, state, exclude=set(rewritten.keys())
        )
        if untouched_sources:
            follow_up_warnings.extend(validate_style_coverage(untouched_sources, theme_css))

        if follow_up_warnings:
            await self._record_coverage_failure(
                ctx,
                state,
                follow_up_warnings,
                scope_label="rewritten components",
                stage="StyleCoverageEscalated",
            )
            return

        logger.info(
            "styles_only_escalation_succeeded",
            rewritten_count=len(rewritten),
            components=sorted(rewritten.keys()),
        )

    # ═══════════════════════════════════════════════════════════════════
    # Final assemble + save (extracted from execute)
    # ═══════════════════════════════════════════════════════════════════

    @staticmethod
    def _edit_produced_no_change(state: "_EditPhaseState", edit_plan_source: str) -> bool:
        """True when an interactive edit turn netted ZERO config-affecting change.

        The dominant cause (2026-06-29) is ComponentBuilderMultiple exhausting
        its tool-call budget without landing a single save (every turn
        ``ToolUse:0`` → 0 files modified) while the Editor's plan claimed a
        ``frontend_build`` change. Such a turn must NOT deploy a version
        byte-identical to the previous one nor let the result-writer fabricate
        "Applied N edits" — it changed nothing.

        Excludes the design-import polish flow: its components are materialized
        upstream (`_build_initial_app_config`), so the polish diff is
        legitimately empty even though the deploy is real.
        """
        if edit_plan_source == "design_import":
            return False
        plan = state.edit_plan
        if plan is None:
            return False
        if (
            state.added_components
            or state.modified_names
            or state.removed_names
            or state.removed_page_uuids
        ):
            return False
        # No frontend change landed. If the plan ALSO touched nothing else
        # (styles / backend / handlers / logic / seed / rename / ingest), the
        # turn changed nothing at all — so the lone frontend_build action(s)
        # produced no edit.
        touched_elsewhere = bool(
            plan.modify_styles_actions
            or plan.change_backend_models_actions
            or plan.add_handler_actions
            or plan.modify_handler_actions
            or plan.remove_handler_actions
            or plan.modify_logic_actions
            or plan.rename_page_title_actions
            or getattr(plan, "edit_seed_data_actions", None)
            or plan.ingest_data_actions
        )
        # Page-level structural ops live on the FrontendBuildAction, not the
        # top-level lists, and don't all surface in the four state sets above:
        # a ``page_slug_rename`` populates only ``side_effects.slug_remaps``
        # (applied in place to current_config) and an empty-mount
        # ``page_create`` only adds a page. A planned page create / remove /
        # rename is therefore a real, deployable change even when CBM lands 0
        # component saves — never discard it as a no-op.
        plan_touches_pages = any(
            fb.page_creates or fb.page_removes or fb.page_slug_renames
            for fb in plan.frontend_build_actions
        )
        return not (touched_elsewhere or plan_touches_pages)

    async def _assemble_and_save(
        self,
        ctx: InvocationContext,
        current_config: dict,
        state: _EditPhaseState,
        user_request: str,
    ) -> AsyncGenerator[Event, None]:
        if state.edit_plan is None:
            return

        # Honest no-op guard: an edit that produced NO net change must not
        # deploy an unchanged version nor claim success. Settle with an error so
        # the user keeps their working preview and knows to retry, instead of
        # the result-writer fabricating "Applied N edits" over a 0-diff deploy.
        edit_plan_source = ctx.session.state.get(StateKeys.EDIT_PLAN_SOURCE, "editor")
        if self._edit_produced_no_change(state, edit_plan_source):
            logger.warning(
                f"[{state.agent_name}] Edit produced NO net change "
                f"(plan had {state.total_actions} action(s) but 0 components were "
                f"added/modified/removed) — not deploying an unchanged version; "
                f"settling honestly instead of reporting success"
            )
            yield state.progress_tracker.create_event(
                ctx,
                "error",
                internal_message=(
                    "I wasn't able to apply that change — no edits were made. "
                    "Please try again, or describe the change more specifically."
                ),
            )
            return

        await state.progress_tracker.update(ctx, 85, "Updating configuration")
        yield state.progress_tracker.create_event(
            ctx, "assembling", internal_message="Updating configuration"
        )
        logger.info(f"[{state.agent_name}] Step 3: Updating app_config")

        updated_config = self.assembly_service.update_app_config_for_edit(
            current_config,
            added_components=state.added_components,
            removed_component_names=state.removed_names,
            removed_page_uuids=state.removed_page_uuids,
            modified_component_names=state.modified_names,
            backend_config=state.updated_backend_config,
            logic_config=state.updated_logic_config,
        )

        from ...shared.services.config_finalization import (
            inject_seed_routing,
            run_cross_validation,
        )

        # Splice DataIngester seed annotations into ``repo.seed`` before
        # cross-validation runs. Without this, IngestDataActions are
        # applied to SEED_DATA_METADATA but never reach the deployed
        # config — the app-backend would have no idea about the import.
        # No-op when no ingest actions ran this turn (SEED_DATA_METADATA
        # has no ``ingest_target_model`` annotations).
        edit_seed_metadata = ctx.session.state.get(StateKeys.SEED_DATA_METADATA) or {}
        if edit_seed_metadata:
            inject_seed_routing(
                updated_config,
                edit_seed_metadata,
                state.updated_backend_config or state.existing_backend,
                state.agent_name,
            )

        run_cross_validation(updated_config, state.agent_name)
        updated_config = self.post_processing_service.process(updated_config)

        await state.progress_tracker.update(ctx, 90, "Saving changes")
        yield state.progress_tracker.create_event(ctx, "saving", internal_message="Saving changes")

        # Publish the touched sets into the completion callback so a cloud
        # backend can skip re-processing untouched components / handlers /
        # seeds / styles. Keys are edit-only; creation turns leave them absent.
        edit_plan = state.edit_plan
        # TC-002 follow-up: when the edit is a single-component modify and
        # nothing else is touched, populate hot-reload metadata so the
        # runtime can patch only that component instead of forcing a full
        # iframe reload. Conditions are intentionally strict — if any
        # styles/models/handlers/added/removed are touched, or the
        # component name is referenced from multiple slots, leave the keys
        # unset and the orchestrator falls back to full reload.
        hot_reload_keys: dict[str, str] = {}
        only_single_component_modify = (
            len(state.modified_names) == 1
            and not state.added_components
            and not state.removed_names
            and not state.removed_page_uuids
            and not edit_plan.modify_styles_actions
            and not edit_plan.change_backend_models_actions
            and not edit_plan.add_handler_actions
            and not edit_plan.modify_handler_actions
            and not edit_plan.remove_handler_actions
            and not edit_plan.modify_logic_actions
        )
        if only_single_component_modify:
            from main_agent.agents.utils.component_tree import (
                find_unique_slot_for_component_name,
            )

            component_name = next(iter(state.modified_names))
            slot = find_unique_slot_for_component_name(updated_config, component_name)
            if slot is not None:
                slot_uuid, page_uuid = slot
                hot_reload_keys = {
                    StateKeys.CHANGED_COMPONENT_UUID: slot_uuid,
                    StateKeys.CHANGE_TYPE: "modify",
                }
                if page_uuid:
                    hot_reload_keys[StateKeys.CHANGED_PAGE_UUID] = page_uuid
                logger.info(
                    f"[{state.agent_name}] Hot-reload metadata set for "
                    f"single-component modify: component={component_name} "
                    f"slot={slot_uuid} page={page_uuid or '(app-level)'}"
                )

        await push_session_state_update(
            ctx,
            {
                StateKeys.APP_CONFIG: json.dumps(updated_config),
                "save_app_config": True,
                "reload_app": True,
                "_edit_touched_components": sorted(
                    set(state.modified_names) | {c.name for c in state.added_components}
                ),
                "_edit_touched_handlers": sorted(
                    {a.handler_name for a in edit_plan.add_handler_actions}
                    | {a.handler_name for a in edit_plan.modify_handler_actions}
                ),
                "_edit_styles_touched": bool(edit_plan.modify_styles_actions),
                "_edit_models_touched": bool(edit_plan.change_backend_models_actions),
                "_edit_seeds_touched": bool(
                    getattr(edit_plan, "edit_seed_data_actions", None)
                ),
                **hot_reload_keys,
            },
        )

        action_summary = self._build_action_summary(state.edit_plan)
        async for event in self.write_result_response(
            ctx,
            "edit",
            user_request,
            f"Applied {state.total_actions} edits: {action_summary}",
        ):
            yield event

        # Derive "was backend/logic touched" from the plan instead of tracking
        # live flags — safer because phases can short-circuit without mutation.
        edit_plan = state.edit_plan
        backend_touched = bool(
            edit_plan
            and (
                edit_plan.change_backend_models_actions
                or edit_plan.add_handler_actions
                or edit_plan.modify_handler_actions
                or edit_plan.remove_handler_actions
            )
        )
        logic_touched = bool(edit_plan and edit_plan.modify_logic_actions)

        logger.info(
            f"[{state.agent_name}] Editing workflow complete",
            actions=state.total_actions,
            added=len(state.added_components),
            removed_components=len(state.removed_names),
            removed_pages=len(state.removed_page_uuids),
            modified=len(state.modified_names),
            backend_touched=backend_touched,
            logic_touched=logic_touched,
        )

    @staticmethod
    def _build_action_summary(edit_plan: EditorOutput) -> str:
        # User-facing phrasing only — this string flows into the chat reply.
        parts: list[str] = (
            ["updated styles"] * len(edit_plan.modify_styles_actions)
            + ["updated the data structure"] * len(edit_plan.change_backend_models_actions)
            + ["updated app logic"] * len(edit_plan.modify_logic_actions)
            + ["added new logic"] * len(edit_plan.add_handler_actions)
            + ["updated existing logic"] * len(edit_plan.modify_handler_actions)
            + ["removed logic"] * len(edit_plan.remove_handler_actions)
            + ["renamed page"] * len(edit_plan.rename_page_title_actions)
            + ["updated the data"] * len(getattr(edit_plan, "edit_seed_data_actions", []) or [])
        )
        for action in edit_plan.frontend_build_actions:
            if action.page_creates:
                titles = ", ".join(pc.title for pc in action.page_creates)
                parts.append(f"added page(s): {titles}")
            elif action.page_removes:
                parts.append(f"removed {len(action.page_removes)} page(s)")
            elif action.page_slug_renames:
                parts.append(f"re-slugged {len(action.page_slug_renames)} page(s)")
            else:
                parts.append("updated frontend")
        return ", ".join(parts)

    # ═══════════════════════════════════════════════════════════════════
    # Shared sub-helpers
    # ═══════════════════════════════════════════════════════════════════

    async def _refresh_validation_context(
        self,
        ctx: InvocationContext,
        backend_config: dict | None,
        logic_config: dict | None,
        existing_pages: list[dict],
        added_components: list[ComponentEntry],
    ) -> None:
        """Re-push validation context after backend/logic changes so subsequent
        component builders validate against the updated models/logic."""
        page_slugs = [p.get("slug", "/") for p in existing_pages if isinstance(p, dict)] + [
            c.page_slug for c in added_components if c.page_slug
        ]

        await push_session_state_update(
            ctx,
            {
                "_validation_context_models": (backend_config or {}).get("models", []),
                "_validation_context_handlers": (backend_config or {}).get("handlers", []),
                "_validation_context_logic": logic_config or {},
                "_validation_context_theme_palette": ctx.session.state.get(
                    StateKeys.RESOLVED_THEME_PALETTE, {}
                ),
                "_validation_context_page_slugs": page_slugs,
            },
        )

    async def _refresh_design_system_context_from_theme(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
        *,
        fallback_to_seed: bool,
    ) -> bool:
        """Refresh state.design_system_context from the current theme.css artifact."""
        try:
            snapshot = await load_and_persist_theme_palette(
                ctx,
                fallback_to_seed=fallback_to_seed,
            )
        except ThemePaletteResolutionError as e:
            logger.error(
                "theme_palette_resolution_failed",
                error=str(e),
                phase="editing.design_system",
                fallback_to_seed=fallback_to_seed,
            )
            await self._record_terminal_validation_error(
                ctx,
                state,
                summary=f"Theme palette resolution failed: {e}",
                stage="ThemePaletteResolutionError",
            )
            return False

        from ..services.design_system_context import build_design_system_context
        from main_agent.services.theme.theme_view import ThemeView

        state.pre_computed_palette = snapshot.palette
        state.resolved_theme_palette = snapshot.palette
        state.fonts = snapshot.fonts
        # design_style is intentionally omitted on edit — see _initialize_phase_state
        state.design_system_context = build_design_system_context(
            snapshot.palette,
            fonts=snapshot.fonts,
            theme_view=ThemeView.from_css(snapshot.theme_css or ""),
        )
        return True

    async def _record_terminal_validation_error(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
        *,
        summary: str,
        stage: str,
    ) -> None:
        """Persist a terminal validation failure and stop the edit workflow.

        Invariant (load-bearing): any ADK-store artifact writes made earlier
        this turn — new theme.css, rewritten component TSX, patched
        backend.json, etc. — must NOT be promoted to durable storage after
        this call. We rely on:

          1. ``SAVE_APP_CONFIG=False`` → the success-only config snapshot
             (``_save_app_config_artifact``) never runs, and the runtime
             worker materializes the build only on terminal success, so
             nothing reaches durable storage.
          2. Next turn starts with a cold ADK store and re-pulls the last
             durably-saved sources from the worker's inline ``source_files``
             payload (see ``source_rehydration_service``), effectively
             discarding every uncommitted mutation from this failed turn.

        If either of those assumptions changes (e.g., promote-on-save moves
        earlier, or the ADK store becomes warm across turns), add an
        explicit artifact purge here to preserve the "all-or-nothing" edit
        semantic.
        """
        error_entry = {
            "type": "validation_pipeline_error",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "summary": summary,
            "stage": stage,
        }
        logger.error(
            "validation_pipeline_error",
            event_type="validation_pipeline_error",
            stage=stage,
            summary=summary,
            app_uuid=ctx.session.state.get(StateKeys.APP_UUID),
            session_id=ctx.session.id,
        )
        existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
        existing_errors.append(error_entry)
        await push_session_state_update(
            ctx,
            {
                StateKeys.AGENT_ERRORS: existing_errors,
                StateKeys.SAVE_APP_CONFIG: False,
                StateKeys.RELOAD_APP: False,
            },
        )
        state.terminal_failure_summary = summary

    async def _record_terminal_component_failure(
        self,
        ctx: InvocationContext,
        state: _EditPhaseState,
        unresolved_components: dict[str, str],
    ) -> None:
        """Persist a terminal unresolved-component failure and stop the edit workflow.

        Same invariant as ``_record_terminal_validation_error``: uncommitted
        ADK-store writes from this turn (partial theme changes, partial
        component rewrites, backend patches) must stay local. The combination
        of ``SAVE_APP_CONFIG=False`` and next-turn cold rehydration keeps R2
        and durable GCS consistent with the last successful save. Do not add
        GCS uploads before this point without also tracking rollback.

        Pattern C scope note: partial-ship is creation-only. Edits are
        delta operations; shipping a partial delta with placeholder TSX
        for the user's just-requested change is more confusing than
        rolling back. Pattern G telemetry still emits an ``abort``
        outcome for editing failures so the BigQuery view shows them.
        """
        failure_detail_map = dict(ctx.session.state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {}))
        failure_detail_map.update(
            dict(ctx.session.state.get(StateKeys.VALIDATION_FAILURE_DETAILS, {}))
        )
        failure_classes = {
            name: detail.get("failure_class")
            for name, detail in failure_detail_map.items()
            if isinstance(detail, dict) and detail.get("failure_class")
        }
        error_entry, assistant_response, conversation_summary = build_component_generation_failure(
            unresolved_components,
            ctx.session.state.get(StateKeys.CURRENT_PROMPT, ""),
            failure_classes=failure_classes or None,
        )
        logger.error(
            "component_generation_failure",
            event_type="component_generation_failure",
            unresolved_count=len(unresolved_components),
            unresolved_components=sorted(unresolved_components.keys()),
            failure_classes=failure_classes or None,
            app_uuid=ctx.session.state.get(StateKeys.APP_UUID),
            session_id=ctx.session.id,
        )
        existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
        existing_errors.append(error_entry)

        # Pattern G: emit telemetry even for edit aborts — gives the
        # weekly aggregation view visibility into edit-path failure
        # patterns alongside creation-path ones.
        from main_agent.agents.utils.failure_telemetry import emit_outcome

        emit_outcome(
            session_id=ctx.session.id,
            workflow="editing",
            outcome="abort",
            fatal_failures=sorted(unresolved_components.keys()),
            failure_classes=failure_classes or None,
        )

        await push_session_state_update(
            ctx,
            {
                StateKeys.AGENT_ERRORS: existing_errors,
                StateKeys.SAVE_APP_CONFIG: False,
                StateKeys.RELOAD_APP: False,
                StateKeys.CHAT_RESPONSE: assistant_response,
                StateKeys.CONVERSATION_MESSAGE_SUMMARY: conversation_summary,
            },
        )
        state.terminal_failure_summary = error_entry["summary"]

    # ---- Deterministic backend.json patchers (handler CRUD helpers) ----

    @staticmethod
    def _parse_param_str(desc: str) -> dict:
        """Parse 'name: type, required' into {name, type} dict.

        Matches the semantics of backend_builder._parse_param_description
        so our handler metadata patches stay shape-compatible with the
        create-mode _build_handler_metadata output."""
        if ":" in desc:
            name, rest = desc.split(":", 1)
            type_str = rest.strip().split(",")[0].strip()
            return {"name": name.strip(), "type": type_str}
        return {"name": desc.strip(), "type": "string"}

    def _append_handler_metadata(self, backend_config: dict, handler_plan: HandlerPlan) -> dict:
        """Return a copy of backend_config with a new handler entry appended."""
        import copy

        patched = copy.deepcopy(backend_config) if backend_config else {}
        handlers = list(patched.get("handlers", []) or [])
        handlers.append(
            {
                "name": handler_plan.name,
                "method": handler_plan.name,
                "summary": handler_plan.name,
                "authLevel": handler_plan.auth_level,
                "handlerType": handler_plan.handler_type,
                "inputs": [self._parse_param_str(i) for i in handler_plan.inputs],
                "outputs": [self._parse_param_str(o) for o in handler_plan.outputs],
            }
        )
        patched["handlers"] = handlers
        return patched

    def _patch_handler_signature(
        self,
        backend_config: dict,
        handler_name: str,
        new_inputs: list | None,
        new_outputs: list | None,
        new_auth_level: str | None,
        new_handler_type: str | None,
    ) -> dict | None:
        """Return a copy of backend_config with the given handler's signature
        fields replaced. Returns None if the handler is not found."""
        import copy

        patched = copy.deepcopy(backend_config) if backend_config else {}
        handlers = list(patched.get("handlers", []) or [])
        found_idx = None
        for idx, h in enumerate(handlers):
            if isinstance(h, dict) and h.get("name") == handler_name:
                found_idx = idx
                break
        if found_idx is None:
            return None

        entry = dict(handlers[found_idx])
        if new_inputs is not None:
            entry["inputs"] = [self._parse_param_str(i) for i in new_inputs]
        if new_outputs is not None:
            entry["outputs"] = [self._parse_param_str(o) for o in new_outputs]
        if new_auth_level is not None:
            entry["authLevel"] = new_auth_level
        if new_handler_type is not None:
            entry["handlerType"] = new_handler_type
        handlers[found_idx] = entry
        patched["handlers"] = handlers
        return patched

    @staticmethod
    def _remove_handler_from_backend(backend_config: dict, handler_name: str) -> dict | None:
        """Return a copy of backend_config with the given handler removed.
        Returns None if the handler is not found."""
        import copy

        patched = copy.deepcopy(backend_config) if backend_config else {}
        handlers = list(patched.get("handlers", []) or [])
        new_handlers = [
            h for h in handlers if not (isinstance(h, dict) and h.get("name") == handler_name)
        ]
        if len(new_handlers) == len(handlers):
            return None
        patched["handlers"] = new_handlers
        return patched

    @staticmethod
    async def _save_backend_artifact(ctx: InvocationContext, backend_config: dict) -> None:
        """Persist the updated backend.json so downstream phases + validation see it."""
        from google import genai as genai_module

        payload = json.dumps(backend_config).encode("utf-8")
        artifact = genai_module.types.Part.from_bytes(data=payload, mime_type="application/json")
        await ctx.artifact_service.save_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename="backend.json",
            artifact=artifact,
        )

    @staticmethod
    async def _delete_handler_artifact(ctx: InvocationContext, handler_name: str) -> None:
        """Delete a handler_code:{name}.tsx artifact. Best-effort — logs on failure."""
        filename = f"handler_code:{handler_name}.tsx"
        try:
            if hasattr(ctx.artifact_service, "delete_artifact"):
                await ctx.artifact_service.delete_artifact(
                    session_id=ctx.session.id,
                    user_id=ctx.session.user_id,
                    app_name=ctx.session.app_name,
                    filename=filename,
                )
                logger.info(f"Deleted handler artifact: {filename}")
            else:
                from google import genai as genai_module

                empty = genai_module.types.Part.from_bytes(data=b"", mime_type="text/plain")
                await ctx.artifact_service.save_artifact(
                    session_id=ctx.session.id,
                    user_id=ctx.session.user_id,
                    app_name=ctx.session.app_name,
                    filename=filename,
                    artifact=empty,
                )
                logger.info(f"Cleared handler artifact (no delete support): {filename}")
        except Exception as e:
            logger.warning(f"Could not delete handler artifact {filename}: {e}")

    async def _resolve_component_images(
        self,
        ctx: InvocationContext,
        component_name: str,
        agent_name: str,
        *,
        artifact_kind: str = "component",
    ) -> None:
        """Resolve placeholder/hallucinated image URLs in a single component or module.

        ``artifact_kind`` selects the artifact prefix:
          - ``"component"`` (default) → ``codefocus_component:<name>.tsx``
          - ``"module"`` → ``codefocus_module:<name>.tsx``

        Phase 4 module edits use the module path so image swaps inside a
        Charts/Sidebar/etc. module reach the resolver. Without this, an
        edit like "swap the donut chart hero image" would save the new
        placeholder unresolved.
        """
        from ..services.codefocus_image_resolver import resolve_placeholder_images

        prefix = (
            "codefocus_module:" if artifact_kind == "module" else "codefocus_component:"
        )
        artifact_key = f"{prefix}{component_name}.tsx"
        comp_source = await ArtifactManager.load_artifact_as_string(ctx, artifact_key)
        if not comp_source:
            return

        image_catalog = ctx.session.state.get("image_catalog", [])
        app_uuid = ctx.session.state.get("app_uuid", "")
        resolved_sources, count = await resolve_placeholder_images(
            {component_name: comp_source}, image_catalog, app_uuid=app_uuid
        )
        if count > 0:
            resolved = resolved_sources[component_name]
            if artifact_kind == "module":
                # Modules don't go through the export-default validator;
                # save_component_artifact's name-mismatch guard would
                # block them. Save directly via the artifact service.
                from google import genai as _genai

                code_bytes = resolved.encode("utf-8")
                part = _genai.types.Part.from_bytes(
                    data=code_bytes, mime_type="text/tsx"
                )
                await ctx.artifact_service.save_artifact(
                    session_id=ctx.session.id,
                    user_id=ctx.session.user_id,
                    app_name=ctx.session.app_name,
                    filename=artifact_key,
                    artifact=part,
                )
            else:
                from ..subagents.artifact_tools import save_component_artifact

                await save_component_artifact(ctx, resolved, component_name)
            logger.info(
                f"[{agent_name}] Resolved {count} images in {artifact_kind} "
                f"{component_name}"
            )

    async def _execute_quick_remove(
        self,
        ctx: InvocationContext,
        current_config: dict,
        progress_tracker: ProgressTracker,
        agent_name: str,
    ) -> AsyncGenerator[Event, None]:
        """Deterministic component removal — no LLM needed."""
        selected_component_name = ctx.session.state.get("selected_component_name", "")
        if not selected_component_name:
            logger.warning(f"[{agent_name}] quick_remove: no component selected")
            yield progress_tracker.create_event(
                ctx, "error", internal_message="No component selected for removal."
            )
            return

        logger.info(f"[{agent_name}] quick_remove: removing {selected_component_name}")

        yield progress_tracker.create_event(
            ctx, "assembling", internal_message="Updating configuration"
        )

        updated_config = self.assembly_service.update_app_config_for_edit(
            current_config,
            removed_component_names=[selected_component_name],
        )
        updated_config = self.post_processing_service.process(updated_config)

        # Surface latent orphans (e.g., the removed component was the sole
        # caller of a handler). Non-blocking — the "quick" path preserves
        # its fast semantics, and the main edit path also runs this check.
        try:
            from ...shared.services.config_finalization import run_cross_validation

            run_cross_validation(updated_config, agent_name)
        except Exception as e:
            logger.warning(
                f"[{agent_name}] quick_remove cross-validation surfaced issues "
                f"(non-blocking): {e}"
            )

        yield progress_tracker.create_event(ctx, "saving", internal_message="Saving changes")

        await push_session_state_update(
            ctx,
            {
                StateKeys.APP_CONFIG: json.dumps(updated_config),
                "save_app_config": True,
                "reload_app": True,
            },
        )

        async for event in self.write_result_response(
            ctx,
            "edit",
            f"Remove {selected_component_name}",
            f"Removed component: {selected_component_name}",
        ):
            yield event

        logger.info(
            f"[{agent_name}] quick_remove complete",
            removed=selected_component_name,
        )


def _get_component_role(
    config: dict, component_name: str
) -> Literal["header", "sidebar", "footer", "content"]:
    """Determine a component's role from the app_config."""
    frontend = config.get("frontend", {})

    for comp in frontend.get("header", []):
        if comp.get("component") == component_name:
            return "header"
    for comp in frontend.get("sidebar", []):
        if comp.get("component") == component_name:
            return "sidebar"
    for comp in frontend.get("footer", []):
        if comp.get("component") == component_name:
            return "footer"

    return "content"


def _supporting_modules_for(config: dict, component_name: str) -> list[str]:
    """Return the entry component's declared supporting modules.

    Reads `repo.frontend.components[<name>].supporting_modules`. Returns
    [] when the entry doesn't exist or has no module list. Used by the
    editing workflow's batch-validation sweep to feed Babel-shell sibling
    modules into the final Tailwind compile alongside their entry.
    """
    repo = config.get("repo") if isinstance(config, dict) else None
    if not isinstance(repo, dict):
        return []
    frontend = repo.get("frontend")
    if not isinstance(frontend, dict):
        return []
    components = frontend.get("components")
    if not isinstance(components, dict):
        return []
    entry = components.get(component_name)
    if not isinstance(entry, dict):
        return []
    mods = entry.get("supporting_modules") or []
    if not isinstance(mods, list):
        return []
    return [m for m in mods if isinstance(m, str)]


def _generate_slug(component_name: str) -> str:
    """Generate a page slug from a component name."""
    name = component_name
    for suffix in ("Content", "Page", "View"):
        if name.endswith(suffix) and len(name) > len(suffix):
            name = name[: -len(suffix)]

    slug = re.sub(r"(?<=[a-z0-9])([A-Z])", r"-\1", name).lower()
    slug = re.sub(r"[^a-z0-9-]", "", slug)
    slug = slug.strip("-") or "page"

    return f"/{slug}"
