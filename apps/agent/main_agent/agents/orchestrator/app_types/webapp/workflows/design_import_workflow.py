"""Design-import workflow.

Top-level workflow for design-bundle uploads. The flow:

1. ``_run_import_preparation`` — deterministic prep (stage bundle,
   DesignImporter LLM, decomposition, grounding, app_secondary_type
   reconciliation, data extraction).
2. ``_translate_mechanical_tsx`` — deterministic Babel-shell → TSX
   translation, saves ``codefocus_component:*.tsx`` and
   ``codefocus_module:*.tsx`` artifacts.
3. ``_run_backend_build`` — direct ``BackendBuilder.build_create()``
   call when the design has a dynamic backend (LLM step that materialises
   ``backend.json``, ``handler_code:*.tsx``, ``seed:*.csv`` from the
   plan in ``app_backend_plan``).
4. ``_build_initial_app_config`` — deterministic ``AssemblyService``
   call that produces ``StateKeys.APP_CONFIG`` from the staged artifacts.
5. ``_synthesize_frontend_compliance_edit_plan`` — emit a frontend-only
   ``EditorOutput`` with one ``FrontendBuildAction`` per entry component
   (cleanup + data-wiring).
6. Delegate to ``EditingWorkflow.execute()`` — which detects
   ``StateKeys.EDIT_PLAN_SOURCE == "design_import"`` and skips the
   Editor LLM.

CreationWorkflow is uninvolved — design-import is its own pipeline.
"""

from __future__ import annotations

import json
import re
import uuid as uuid_lib
from typing import Any, AsyncGenerator, Optional

import structlog
from google.adk.agents import LlmAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from config import AgentName
from main_agent.constants import StateKeys
from main_agent.errors import ErrorSeverity, PipelineError
from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.agents.utils.helpers import (
    push_prompt_to_next_agent,
    push_session_state_update,
)

from ...base.base_workflow import BaseWorkflow
from ....models import ProgressTracker
from ....models.timing_tracker import MetricsTracker
from ...shared.builders.backend_builders.backend_builder import BackendBuilder
from ...shared.services.validation_service import ValidationService
from ..services.codefocus_assembly_service import (
    AssemblyContext,
    AssemblyService,
    ComponentEntry,
)
from ..subagents.editor import (
    EditorOutput,
    FrontendBuildAction,
)

logger = structlog.get_logger(__name__)


# Matches CreationWorkflow.MAX_CREATOR_ATTEMPTS=2 — gives the DesignImporter
# LLM one retry under _TRUNCATION_PROMPT for transient max-output-tokens hits.
# 8qfb42sm 2026-05-18: a 10-page school-dashboard Claude-Design import
# truncated 488 tokens below the 32K cap on attempt 1 and aborted because
# this was 1. With the slim component_plans schema landed in the same fix
# bundle, a second attempt under _TRUNCATION_PROMPT ("be more concise")
# should comfortably fit.
MAX_REPAIR_ATTEMPTS = 2


class DesignImportWorkflow(BaseWorkflow):
    """Self-contained design-import pipeline.

    Runs deterministic prep, mechanical TSX translation, direct backend
    build, initial config assembly, and synthesizes a frontend-compliance
    EditPlan for the cleanup pass via EditingWorkflow.
    """

    def __init__(
        self,
        editing_workflow: BaseWorkflow,
        backend_builder: BackendBuilder,
        assembly_service: Optional[AssemblyService] = None,
        design_importer_agent: Optional[LlmAgent] = None,
        validation_service: Optional[ValidationService] = None,
    ) -> None:
        self.editing_workflow = editing_workflow
        self.backend_builder = backend_builder
        self.assembly_service = assembly_service or AssemblyService()
        self.design_importer_agent = design_importer_agent
        self.validation_service = validation_service or ValidationService()

    # ------------------------------------------------------------------ #
    # execute()
    # ------------------------------------------------------------------ #

    async def execute(
        self,
        ctx: InvocationContext,
        progress_tracker: ProgressTracker,
        metrics_tracker: Optional[MetricsTracker] = None,
        sub_action: str = "generic_request",
    ) -> AsyncGenerator[Event, None]:
        agent_name = "DesignImport"
        design_bundle_id = ctx.session.state.get(StateKeys.DESIGN_BUNDLE_ID, "")
        if not design_bundle_id:
            raise PipelineError(
                "DesignImportWorkflow requires StateKeys.DESIGN_BUNDLE_ID",
                severity=ErrorSeverity.FATAL,
                step_name="DesignImportWorkflow.execute",
            )

        # Phase 0–3.1 deterministic prep
        async for event in self._run_import_preparation(ctx, progress_tracker, agent_name):
            yield event

        # Mechanical TSX translation (deterministic)
        await self._translate_mechanical_tsx(ctx, agent_name)

        # Backend artifact generation (LLM, when backend is dynamic)
        async for event in self._run_backend_build(ctx, progress_tracker, agent_name):
            yield event

        # Initial app_config assembly (deterministic)
        await self._build_initial_app_config(ctx, agent_name)

        # Synthesize frontend-only compliance EditPlan + delegate
        synthesized_plan = self._synthesize_frontend_compliance_edit_plan(ctx)
        actions_count = len(synthesized_plan.frontend_build_actions)
        await push_session_state_update(
            ctx,
            {
                StateKeys.EDIT_PLAN: synthesized_plan.model_dump(),
                StateKeys.EDIT_PLAN_SOURCE: "design_import",
            },
        )
        if actions_count == 0:
            logger.info(
                f"[{agent_name}] No frontend cleanup needed (no entry "
                "components with mechanical TSX); persisting initial "
                "app_config and exiting."
            )
            # Even with zero actions, run EditingWorkflow once so the
            # final compile gate + persist runs uniformly. The pre-built
            # plan is empty; phase 8 short-circuits at its empty-list
            # guard but the post-phase pipeline still finalizes.
        logger.info(
            f"[{agent_name}] Dispatching {actions_count} FrontendBuildAction(s) "
            "via EditingWorkflow"
        )
        async for event in self.editing_workflow.execute(
            ctx,
            progress_tracker,
            metrics_tracker=metrics_tracker,
            sub_action="design_import_compliance",
        ):
            yield event

    # ------------------------------------------------------------------ #
    # Phase 0/1/1.5/2/2.3 — design-import preparation
    # ------------------------------------------------------------------ #

    async def _run_import_preparation(
        self,
        ctx: InvocationContext,
        progress_tracker: ProgressTracker,
        agent_name: str,
    ) -> AsyncGenerator[Event, None]:
        from main_agent.agents.orchestrator.importers import dispatcher as _importer_dispatcher
        from main_agent.agents.orchestrator.importers.bundle_digest import (
            digest_bundle_artifacts,
        )
        from main_agent.agents.orchestrator.importers.design_importer import (
            DesignImporterInput,
            materialize_design_import_images,
        )
        from main_agent.agents.orchestrator.importers.grounding import (
            ground_design_import_metadata,
        )
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            HandlerError,
        )
        from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
            DecompositionPlan,
        )
        from main_agent.agents.orchestrator.importers.tools.decomposition.runner import (
            run_design_decomposition,
        )

        design_bundle_id = ctx.session.state.get(StateKeys.DESIGN_BUNDLE_ID, "")
        app_name = ctx.session.state.get("app_name", "My App")
        app_description = ctx.session.state.get(StateKeys.INITIAL_DESCRIPTION, "")
        app_language_code = ctx.session.state.get("app_language_code", "en")
        user_language_code = ctx.session.state.get("user_language_code", "en")

        yield progress_tracker.create_event(
            ctx,
            "importing_design_bundle",
            internal_message="Importing your design",
        )

        try:
            bundle_skill_context = await _importer_dispatcher.dispatch_design_bundle(
                ctx,
                design_bundle_id=design_bundle_id,
            )
        except Exception as exc:
            logger.exception(f"[{agent_name}] design bundle dispatch failed: {exc}")
            raise PipelineError(
                f"Could not load design bundle {design_bundle_id}: {exc}",
                severity=ErrorSeverity.FATAL,
                step_name="DesignImportWorkflow.import_preparation",
            ) from exc

        if not bundle_skill_context:
            raise PipelineError(
                f"Could not load design bundle {design_bundle_id}",
                severity=ErrorSeverity.FATAL,
                step_name="DesignImportWorkflow.import_preparation",
            )

        _importer_dispatcher.stash_skill_context_on_session_state(
            ctx.session.state,
            bundle_skill_context,
        )
        bundle_source = bundle_skill_context.get("bundle_source") or "design"
        staged = bundle_skill_context.get("staged_count", 0)
        logger.info(
            f"[{agent_name}] design bundle staged: "
            f"source={bundle_source} "
            f"skill={bundle_skill_context.get('skill_name')} "
            f"files={staged}"
        )
        yield progress_tracker.create_event(
            ctx,
            "design_bundle_imported",
            internal_message=(
                f"Staged {staged} file{'s' if staged != 1 else ''} from {bundle_source} bundle"
            ),
        )

        # ── DesignImporter LLM ──
        skill_name = bundle_skill_context.get("skill_name", "")
        if self.design_importer_agent is None or not skill_name:
            raise PipelineError(
                "DesignImporter is not configured for this design bundle",
                severity=ErrorSeverity.FATAL,
                step_name="DesignImportWorkflow.import_preparation",
            )

        manifest_artifact = bundle_skill_context.get("manifest_artifact", "bundle:manifest.md")
        manifest_markdown = (
            await ArtifactManager.load_artifact_as_string(ctx, manifest_artifact) or ""
        )
        if not manifest_markdown.strip():
            raise PipelineError(
                f"Design bundle manifest artifact is empty or missing: {manifest_artifact}",
                severity=ErrorSeverity.FATAL,
                step_name="DesignImportWorkflow.import_preparation",
            )

        importer_input = DesignImporterInput(
            source=bundle_source,
            app_name=app_name or "My App",
            app_description=app_description or "",
            app_language_code=app_language_code or "en",
            manifest_markdown=manifest_markdown,
        )
        await push_prompt_to_next_agent(ctx, importer_input.model_dump_json())
        async for event in self.validation_service._run_agent_with_retry(
            ctx,
            self.design_importer_agent,
            AgentName.DESIGN_IMPORTER.value,
            MAX_REPAIR_ATTEMPTS,
        ):
            yield event

        # ── Deterministic decomposition pass ──
        plan_dict = ctx.session.state.get("design_decomposition_plan")
        if not plan_dict:
            raise PipelineError(
                "DesignImporter did not return a design_decomposition_plan",
                severity=ErrorSeverity.FATAL,
                step_name="DesignImportWorkflow.import_preparation",
            )
        try:
            plan = DecompositionPlan.model_validate(_as_plain_dict(plan_dict))
        except Exception as exc:
            raise PipelineError(
                f"DesignImporter plan failed schema validation: {exc}",
                severity=ErrorSeverity.FATAL,
                step_name="DesignImportWorkflow.import_preparation",
            ) from exc

        try:
            decomposition_result = await run_design_decomposition(
                ctx,
                plan=plan,
                skill_context=ctx.session.state.get("design_bundle_skill_context", {}) or {},
            )
        except HandlerError as exc:
            raise PipelineError(
                f"Deterministic decomposition failed: {exc}",
                severity=ErrorSeverity.FATAL,
                step_name="DesignImportWorkflow.import_preparation",
            ) from exc

        logger.info(
            f"[{agent_name}] Decomposition emitted "
            f"{decomposition_result.pages_emitted} page(s), "
            f"{decomposition_result.chrome_emitted} chrome region(s), "
            f"transformed {decomposition_result.placeholders_transformed} placeholder(s); "
            f"unmatched={len(decomposition_result.unmatched_placeholder_labels)}"
        )

        creator_plan = decomposition_result.synthesized_creator_plan

        # ── Materialize image references into repo assets ──
        _app_uuid_for_import_assets = ctx.session.state.get("app_uuid", "")
        _materialized = await materialize_design_import_images(
            ctx,
            _app_uuid_for_import_assets,
        )
        if _materialized:
            logger.info(
                f"[{agent_name}] Materialized {_materialized} imported image reference(s)."
            )

        # ── Bundle digest (used downstream by helpers) ──
        _bundle_digest = await digest_bundle_artifacts(ctx)
        if _bundle_digest:
            ctx.session.state["design_bundle_digest"] = _bundle_digest
            logger.info(
                f"[{agent_name}] Bundle digest: "
                f"brand={_bundle_digest.get('brand_name')!r} "
                f"pages={_bundle_digest.get('page_slugs')} "
                f"headlines={len(_bundle_digest.get('headlines', []))}"
            )

        # ── Grounding ──
        _grounding_meta = await ground_design_import_metadata(
            ctx,
            creator_plan,
            bundle_digest=_bundle_digest,
        )

        # ── Reconcile app_secondary_type ──
        _app_backend_plan = creator_plan.get("app_backend_plan") or {}
        _backend_is_dynamic = _app_backend_plan.get("backend_type") == "dynamic"
        _has_models = bool(_app_backend_plan.get("models"))
        _is_sidebar_layout = creator_plan.get("navigation_type") == "SidebarMenuLeft"
        app_secondary_type = (
            "dataapp"
            if _is_sidebar_layout and (_backend_is_dynamic or _has_models)
            else "website"
        )

        creator_plan["design_import_meta"] = {
            "static_design_only": not (_backend_is_dynamic or _has_models),
            "app_name_reseeded": bool(_grounding_meta.get("app_name_reseeded")),
            "extracted_models": list(_grounding_meta.get("extracted_models") or []),
            "extracted_wiring": list(_grounding_meta.get("extracted_wiring") or []),
        }

        # ── Reconcile app_name: user input always wins over LLM override ──
        # Structural enforcement of the contract documented in
        # design_importer.py's `app_name` Field doc. The LLM is told to
        # copy the user's `app_name` verbatim and only override on
        # placeholder patterns — but Gemini still hallucinates (rdzn62gx
        # 2026-05-16: user typed "home", LLM emitted "Hub's project").
        # This block enforces the rule structurally so a single buggy
        # `or` further downstream can't reintroduce the regression.
        _PLACEHOLDER_APP_NAMES = {
            "",
            "untitled",
            "new app",
            "my app",
            "test",
            "app",
            "create",
            "make me an app",
        }
        session_app_name = (ctx.session.state.get("app_name") or "").strip()
        plan_app_name = (creator_plan.get("app_name") or "").strip()
        if session_app_name and session_app_name.lower() not in _PLACEHOLDER_APP_NAMES:
            # User supplied a real name — always wins.
            if plan_app_name and plan_app_name.lower() != session_app_name.lower():
                logger.warning(
                    f"[{agent_name}] DesignImporter app_name override "
                    f"rejected: LLM emitted {plan_app_name!r} but user "
                    f"supplied {session_app_name!r}; keeping user value."
                )
            creator_plan["app_name"] = session_app_name
        # else: user gave a placeholder; keep whatever the LLM came up with.

        await push_session_state_update(
            ctx,
            {
                StateKeys.CREATOR_PLAN: creator_plan,
                "pre_classified_app_type": app_secondary_type,
                "app_language_code": app_language_code,
                "user_language_code": user_language_code,
            },
        )

        logger.info(
            f"[{agent_name}] Import preparation done; backend_type="
            f"{_app_backend_plan.get('backend_type', 'none')}, "
            f"models={len(_app_backend_plan.get('models') or [])}, "
            f"handlers={len(_app_backend_plan.get('handlers') or [])}, "
            f"components={len(creator_plan.get('component_plans') or [])}"
        )

    # ------------------------------------------------------------------ #
    # Mechanical TSX translation
    # ------------------------------------------------------------------ #

    async def _translate_mechanical_tsx(
        self, ctx: InvocationContext, agent_name: str
    ) -> None:
        """Run the deterministic Babel-shell → TSX translation pass.

        Saves ``codefocus_component:*.tsx`` and ``codefocus_module:*.tsx``
        artifacts and stashes the translated component metadata for the
        assembly step.
        """
        from main_agent.agents.orchestrator.importers.tools.jsx_to_tsx import (
            translate_design_import_components,
        )

        creator_plan = ctx.session.state.get(StateKeys.CREATOR_PLAN, {}) or {}
        translated = await translate_design_import_components(ctx, creator_plan)

        # Persist the translated metadata on session state so the assembly
        # step can build ComponentEntry list without re-walking the plan.
        translated_payload = [
            {
                "name": t.name,
                "role": t.role,
                "page_slug": t.page_slug,
                "page_title": t.page_title,
                "summary": t.summary,
                "supporting_modules": list(t.supporting_modules),
            }
            for t in translated
        ]
        await push_session_state_update(
            ctx,
            {"design_import_translated_components": translated_payload},
        )
        # Also fold supporting_modules back into the creator_plan so the
        # synthesized FrontendBuildActions know which modules to clean.
        cp_by_name = {
            cp.get("name"): cp for cp in creator_plan.get("component_plans") or []
            if isinstance(cp, dict)
        }
        for t in translated:
            cp = cp_by_name.get(t.name)
            if cp is not None and t.supporting_modules:
                cp["supporting_modules"] = list(t.supporting_modules)
        await push_session_state_update(
            ctx,
            {StateKeys.CREATOR_PLAN: creator_plan},
        )
        translated_count = sum(1 for t in translated if t.entry_tsx)
        missing = [t.name for t in translated if not t.entry_tsx]
        if missing:
            logger.warning(
                "design_import_translation_incomplete",
                expected=len(translated),
                translated=translated_count,
                missing=missing,
            )
        logger.info(
            f"[{agent_name}] Translated {translated_count} "
            f"entry component(s) and "
            f"{sum(len(t.supporting_modules) for t in translated)} supporting module(s)"
        )

    # ------------------------------------------------------------------ #
    # Direct backend build
    # ------------------------------------------------------------------ #

    async def _run_backend_build(
        self,
        ctx: InvocationContext,
        progress_tracker: ProgressTracker,
        agent_name: str,
    ) -> AsyncGenerator[Event, None]:
        """Direct ``BackendBuilder.build_create()`` call.

        Skips when the imported design has no dynamic backend (static
        marketing sites). Runs models + handlers + seeds in parallel
        when ``app_backend_plan.backend_type == "dynamic"``.
        """
        creator_plan = ctx.session.state.get(StateKeys.CREATOR_PLAN, {}) or {}
        backend_plan = creator_plan.get("app_backend_plan") or {}
        backend_type = backend_plan.get("backend_type", "none")

        if backend_type != "dynamic":
            logger.info(
                f"[{agent_name}] Static design (backend_type={backend_type!r}); "
                "skipping backend build."
            )
            if False:  # pragma: no cover — keeps the async generator shape
                yield None  # type: ignore[misc]
            return

        app_name = ctx.session.state.get("app_name", "")
        app_description = ctx.session.state.get(StateKeys.INITIAL_DESCRIPTION, "") or ""
        app_context = f"{app_name}: {app_description}".strip(": ") or app_name or "App"
        app_secondary_type = ctx.session.state.get("pre_classified_app_type", "website")

        yield progress_tracker.create_event(
            ctx,
            "building_backend",
            internal_message="Generating backend models, handlers, and seed data",
        )
        logger.info(
            f"[{agent_name}] Running BackendBuilder.build_create for "
            f"{len(backend_plan.get('models') or [])} model(s) + "
            f"{len(backend_plan.get('handlers') or [])} handler(s)"
        )

        async for event in self.backend_builder.build_create(
            ctx,
            backend_plan=backend_plan,
            app_context=app_context,
            app_secondary_type=app_secondary_type,
        ):
            yield event

    # ------------------------------------------------------------------ #
    # Initial app_config assembly
    # ------------------------------------------------------------------ #

    async def _build_initial_app_config(
        self, ctx: InvocationContext, agent_name: str
    ) -> None:
        """Assemble the initial ``app_config`` from staged artifacts.

        Pulls translated components, finalised theme.css, and (if
        present) the just-built backend.json + logic.json. Calls
        ``AssemblyService.assemble_app_config`` and pushes the result
        to ``StateKeys.APP_CONFIG``.
        """
        creator_plan = ctx.session.state.get(StateKeys.CREATOR_PLAN, {}) or {}
        translated_payload = list(
            ctx.session.state.get("design_import_translated_components") or []
        )

        # Build ComponentEntry list (only entries that produced TSX)
        component_entries: list[ComponentEntry] = []
        for row in translated_payload:
            if not isinstance(row, dict):
                continue
            name = row.get("name") or ""
            if not name:
                continue
            component_entries.append(
                ComponentEntry(
                    name=name,
                    role=row.get("role") or "content",
                    page_slug=row.get("page_slug"),
                    page_title=row.get("page_title"),
                    summary=row.get("summary") or "",
                    supporting_modules=list(row.get("supporting_modules") or []),
                )
            )

        # Pull theme.css for defaultTheme inference
        theme_css = (
            await ArtifactManager.load_artifact_as_string(
                ctx, "codefocus_style:theme.css"
            )
            or ""
        )

        # Pull backend.json + logic.json if present (BackendBuilder may
        # have just written them).
        backend_config: Optional[dict] = None
        backend_str = await ArtifactManager.load_artifact_as_string(ctx, "backend.json")
        if backend_str:
            try:
                backend_config = json.loads(backend_str)
            except Exception as exc:
                logger.warning(
                    f"[{agent_name}] backend.json failed to parse during assembly",
                    error=str(exc),
                )

        # Surface intent-vs-final drift. The LLM's design_import backend_intent
        # (merged into app_backend_plan by runner._synthesize_creator_plan) is
        # the upstream contract; the BackendBuilder output is the realized
        # schema. Loud-log when the realized model count or FK count is lower
        # than the intent — silent loss is the failure mode seen on pnkndvyy.
        if backend_config is not None:
            intent_plan = creator_plan.get("app_backend_plan") or {}
            intent_models = intent_plan.get("models") or []
            final_models = backend_config.get("models") or []
            intent_fks = sum(
                1
                for m in intent_models
                if isinstance(m, dict)
                for c in (m.get("columns") or [])
                if isinstance(c, dict) and c.get("references")
            )
            final_fks = sum(
                1
                for m in final_models
                if isinstance(m, dict)
                for c in (m.get("columns") or [])
                if isinstance(c, dict) and c.get("references")
            )
            if len(final_models) < len(intent_models) or final_fks < intent_fks:
                lost_models = sorted(
                    {m.get("name") for m in intent_models if isinstance(m, dict)}
                    - {m.get("name") for m in final_models if isinstance(m, dict)}
                )
                logger.warning(
                    "backend_intent_drift",
                    intent_count=len(intent_models),
                    final_count=len(final_models),
                    intent_fks=intent_fks,
                    final_fks=final_fks,
                    lost_models=lost_models,
                )
        logic_config: Optional[dict] = None
        logic_str = await ArtifactManager.load_artifact_as_string(ctx, "logic.json")
        if logic_str:
            try:
                logic_config = json.loads(logic_str)
            except Exception as exc:
                logger.warning(
                    f"[{agent_name}] logic.json failed to parse during assembly",
                    error=str(exc),
                )

        # Prefer creator_plan.app_name (which encodes the LLM's name decision —
        # normally the user's input verbatim, but a design-derived name when the
        # user supplied a placeholder). Fall back to session app_name only when
        # the plan didn't set it. This keeps in-page brand copy in lockstep with
        # the URL alias / browser tab. See:
        #   - design_importer.py:568-584 (the field doc that gates the LLM)
        #   - design_bundle_importer/skills/.../creator-plan-contract.md (the
        #     mirror rule the LLM reads at inference time).
        app_name = (
            (creator_plan.get("app_name") or "").strip()
            or (ctx.session.state.get("app_name") or "").strip()
            or "My App"
        )
        font_urls = list(creator_plan.get("font_urls") or [])
        app_secondary_type = ctx.session.state.get("pre_classified_app_type", "website")
        navigation_type = creator_plan.get("navigation_type", "HeaderMenuTop")

        assembly_context = AssemblyContext(
            app_name=app_name,
            app_alias=app_name.lower().replace(" ", "-"),
            app_secondary_type=app_secondary_type,
            navigation_type=navigation_type,
            font_urls=font_urls,
            components=component_entries,
            backend_config=backend_config,
            logic_config=logic_config,
            favicon_svg=creator_plan.get("app_favicon_svg", ""),
            theme_css=theme_css,
        )
        app_config = self.assembly_service.assemble_app_config(assembly_context)

        # Stamp app_uuid if available
        app_uuid = ctx.session.state.get("app_uuid", "")
        if app_uuid:
            app_config.setdefault("metadata", {})["app_uuid"] = app_uuid

        await push_session_state_update(
            ctx,
            {StateKeys.APP_CONFIG: app_config},
        )
        logger.info(
            f"[{agent_name}] Initial app_config assembled: "
            f"{len(component_entries)} component(s), "
            f"backend={'yes' if backend_config else 'no'}, "
            f"theme_default={app_config.get('frontend', {}).get('theme', {}).get('defaultTheme', 'light')}"
        )

    # ------------------------------------------------------------------ #
    # Frontend compliance EditPlan synthesis
    # ------------------------------------------------------------------ #

    def _synthesize_frontend_compliance_edit_plan(
        self, ctx: InvocationContext
    ) -> EditorOutput:
        """Build the frontend-only compliance EditPlan.

        One ``FrontendBuildAction`` per entry component carrying
        mechanical TSX. The action's prompt asks ComponentBuilderMultiple
        to validate the entry + its supporting modules and wire any
        extracted backend models in place of static-array consumers.
        """
        creator_plan = ctx.session.state.get(StateKeys.CREATOR_PLAN, {}) or {}
        meta = creator_plan.get("design_import_meta") or {}
        wiring_entries = list(meta.get("extracted_wiring") or [])

        entry_to_modules: dict[str, list[str]] = {}
        for cp in creator_plan.get("component_plans") or []:
            if not isinstance(cp, dict):
                continue
            if cp.get("role") != "content":
                continue
            name = cp.get("name") or ""
            if not name:
                continue
            modules = [
                m for m in (cp.get("supporting_modules") or []) if isinstance(m, str) and m
            ]
            entry_to_modules[name] = modules

        entry_to_wiring: dict[str, list[dict[str, Any]]] = {}
        for w in wiring_entries:
            if not isinstance(w, dict):
                continue
            entry_name = w.get("entry_component") or w.get("component_name") or ""
            if not entry_name:
                continue
            entry_to_wiring.setdefault(entry_name, []).append(w)

        # Pull model names so we can hint CBM to wire `useModel('X')` when
        # an entry's name semantically maps to a backend model but no
        # static-array wiring was extracted (the deterministic data
        # extractor only fires on JS arrays in the source; pages that are
        # pure HTML with no inline data — like Stitch's BookingCalendar /
        # ResourceManagement — have nothing to extract). Without this
        # hint, CBM finishes a pure-translation pass quickly and never
        # wires the data. First surfaced on app alo48zsn (2026-05-15)
        # where BookingCalendar (84s) and ResourceManagement (79s)
        # shipped with 0 useModel calls while the matching `bookings`
        # and `resources` models existed in the schema.
        backend_plan = creator_plan.get("app_backend_plan") or {}
        model_names = [
            m.get("name", "")
            for m in (backend_plan.get("models") or [])
            if isinstance(m, dict) and m.get("name")
        ]

        actions: list[FrontendBuildAction] = []
        for entry_name, modules in entry_to_modules.items():
            wiring_for_entry = entry_to_wiring.get(entry_name, [])
            if not modules and not wiring_for_entry:
                # An entry with no supporting modules and no wiring is
                # a single-file mechanical TSX — still benefits from a
                # cleanup pass through ComponentBuilderMultiple.
                pass
            model_hints = _models_related_to_component(entry_name, model_names)
            # Drop models already covered by explicit wiring entries —
            # the explicit hint is more specific (names the consumer
            # module + the array symbol).
            already_wired = {
                w.get("model_name") for w in wiring_for_entry if isinstance(w, dict)
            }
            model_hints = [m for m in model_hints if m not in already_wired]
            prompt = self._build_compliance_prompt(
                entry_name=entry_name,
                modules=modules,
                wiring=wiring_for_entry,
                model_hints=model_hints,
            )
            actions.append(FrontendBuildAction(prompt=prompt))

        return EditorOutput(
            reasoning=(
                "DesignImportWorkflow synthesized compliance pass. The "
                "mechanical TSX produced by jsx_to_tsx is byte-faithful "
                "to the source design but never went through the platform "
                "compliance validators. ComponentBuilderMultiple cleans "
                "and (when applicable) wires extracted backend models."
            ),
            frontend_build_actions=actions,
        )

    @staticmethod
    def _build_compliance_prompt(
        *,
        entry_name: str,
        modules: list[str],
        wiring: list[dict[str, Any]],
        model_hints: list[str] | None = None,
    ) -> str:
        """Build the per-entry polish-mode prompt.

        The polish agent's system instruction already enumerates the
        allowed edit categories + forbidden mutations + the strict
        "translation polish, not regeneration" contract. This prompt
        only carries per-entry data:
          * the entry name + supporting modules to attend to
          * the explicit wiring list (data-extractor confirmed consumers)
          * fuzzy model hints, kept softer than before — they're a
            *check-if-the-source-already-has-a-related-array* hint, NOT
            "throw away the source literals and useModel everything"
            (that wording shipped the chick_farm RC#2 regression).

        See Track 3 / Fix 3.3 in
        ~/.claude/plans/create-a-full-fix-modular-horizon.md.
        """
        lines = [
            f"Polish the mechanically-translated entry component `{entry_name}` "
            "for platform compliance. The TSX is the source of truth — apply "
            "only the edit categories enumerated in your system instruction."
        ]
        if modules:
            lines.append(
                f"Supporting modules to include in the polish pass: "
                f"{', '.join('`' + m + '`' for m in modules)}."
            )
        if wiring:
            wiring_lines = []
            for w in wiring:
                consumer = w.get("consumer_module") or "<unknown>"
                symbol = w.get("data_symbol") or "<symbol>"
                model = w.get("model_name") or "<model>"
                wiring_lines.append(
                    f"- In module `{consumer}`, replace the static `{symbol}` array "
                    f"with `useModel('{model}').data` (category: USEMODEL-WIRING). "
                    f"Render rows in EXACTLY the same JSX shape as the source's "
                    f"hardcoded sample row — preserve every column, label, and "
                    f"badge text. Do not redesign the card."
                )
            lines.append(
                "Wire the following extracted backend models (the data extractor "
                "confirmed both the array declaration AND a `.map()` consumer for "
                "each entry below):"
            )
            lines.extend(wiring_lines)
            lines.append(
                "Use `discover_dependencies` and `find_symbol_references` to "
                "verify every consumer is updated."
            )
        if model_hints:
            # Softer than before: this is a HINT to check, not an instruction
            # to rewrite. Source literals on OTHER pages may not be in the
            # seed CSV; preserving them is correct (RC#2 lesson).
            hint_lines = [
                f"- A model named `{name}` exists in the backend schema."
                for name in model_hints
            ]
            lines.append(
                "Heuristic model-name match (NOT a confirmed wiring) — only act "
                "on the hints below if the source TSX of THIS component already "
                "contains a top-level `const X = [{{...}}, {{...}}, ...]` array "
                "consumed by `.map()` in this same file. If it does, apply "
                "USEMODEL-WIRING. If it does NOT (e.g. the page has hardcoded "
                "sibling JSX cards with literal copy), LEAVE THE LITERALS — "
                "those literals may be the canonical copy for that page and "
                "the seed CSV (which was inferred from a different page) won't "
                "contain them. Reseeding would silently overwrite the user's design."
            )
            lines.extend(hint_lines)
        return "\n".join(lines)


def _models_related_to_component(
    component_name: str, model_names: list[str]
) -> list[str]:
    """Fuzzy-match a PascalCase component name to backend model names.

    Splits the component name on CamelCase boundaries (``BookingCalendar``
    → ``{booking, calendar}``) and returns every model name whose
    singular/plural form appears among the resulting tokens. Filters out
    short tokens (< 4 chars) to avoid false positives ("Tag", "Box").

    Used to inject ``useModel('X')`` hints into CBM's compliance prompt
    when the entry name semantically maps to a model but no static-array
    wiring was extracted (pages that are pure HTML with no inline data).
    First wired 2026-05-15 after the alo48zsn incident.

    Examples:
      ``BookingCalendar`` + ``[bookings, resources]`` → ``[bookings]``
      ``ResourceManagement`` + ``[resources, plans]`` → ``[resources]``
      ``BillingInvoices`` + ``[invoices, members]`` → ``[invoices]``
      ``DashboardHeader`` + ``[bookings]`` → ``[]`` (no overlap)
    """
    if not component_name or not model_names:
        return []

    # Split CamelCase / PascalCase into tokens; keep tokens >= 4 chars.
    tokens = {
        t.lower()
        for t in re.findall(r"[A-Z][a-z]+|[a-z]+", component_name)
        if len(t) >= 4
    }
    if not tokens:
        return []

    matched: list[str] = []
    for model_name in model_names:
        if not model_name:
            continue
        mn = model_name.lower()
        # Match the model name directly, the singular (drop trailing s),
        # or any token >= 4 chars inside a snake_case model name.
        candidates = {mn}
        if len(mn) > 4 and mn.endswith("s"):
            candidates.add(mn[:-1])
        for piece in mn.split("_"):
            if len(piece) >= 4:
                candidates.add(piece)
                if len(piece) > 4 and piece.endswith("s"):
                    candidates.add(piece[:-1])
        # Also match component-side tokens with trailing-s stripped.
        expanded_tokens = set(tokens)
        for t in tokens:
            if len(t) > 4 and t.endswith("s"):
                expanded_tokens.add(t[:-1])
        if candidates & expanded_tokens:
            matched.append(model_name)
    return matched


def _as_plain_dict(value: Any) -> dict:
    """Accept ADK's ``EventActions.state_delta`` / Pydantic shapes safely."""
    if isinstance(value, dict):
        return value
    if hasattr(value, "model_dump"):
        try:
            dumped = value.model_dump()
            if isinstance(dumped, dict):
                return dumped
        except Exception:
            pass
    return dict(value) if hasattr(value, "items") else {}
