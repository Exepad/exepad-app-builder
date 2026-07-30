"""
Creation workflow.

Orchestrates the creation of an app:
1. Run creator agent → structured plan (pages, navigation, design system, backend needs)
2. Generate design system (theme.css with Tailwind v4 @theme config) + logic.json
3. Build backend if backend_needed — models + handler TSX + seed data built
   together in parallel via BackendBuilder.build_create (backend.json,
   handler_code:*.tsx, seed:*.csv), BEFORE component generation
4. Generate all code components (header/sidebar, footer, page content) with
   inline per-save validation
4.5. Final Tailwind compile gate + batch handler-code safety-net validation
5. Resolve placeholder images
6. Assemble final app_config.json (with backend artifacts wired in)
7. Inject seed data (D1 routing + static datasets)
8. Cross-validate assembled config
9. Post-process (UUID validation, timestamps)
10. Save to backend
"""

import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from typing import Any, AsyncGenerator, Callable, Optional

from google.adk.agents import LlmAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event
from google.genai import types as genai_types
import structlog

from ...base.base_workflow import BaseWorkflow
from ....models import ProgressTracker
from ....models.timing_tracker import MetricsTracker
from main_agent.constants import StateKeys
from main_agent.agents.utils.agent_docs_loader import AGENT_DOCS_DIR
from main_agent.agents.utils.helpers import (
    push_session_state_update,
    push_prompt_to_next_agent,
)
from main_agent.agents.utils.artifact_manager import ArtifactManager
from ..services.codefocus_assembly_service import (
    AssemblyService,
    AssemblyContext,
    ComponentEntry,
)
from ..services.codefocus_post_processing import PostProcessingService
from ..subagents.creator import CreatorInput
from ...shared.builders.backend_builders.backend_surface_builder import (
    build_backend_surface,
    sample_enum_values_for_models,
)
from ...shared.builders.logic_surface_builder import build_logic_surface
from ...shared.services.document_artifact_service import DocumentArtifactService
from ...shared.services.validation_service import ValidationService
from main_agent.errors import PipelineError, ErrorSeverity
from config import (
    AgentName,
    COMPONENT_BUILDER_ESCALATION_RETRY,
    COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS,
    PARALLEL_PRE_BUILD,
    get_agent_model_name,
)
from ..subagents.component_builder_pool import (
    NUM_SLOTS,
    SLOT_NAMES,
    STATE_EXECUTION_COMPONENTS,
    _TERMINAL_LATCH_KEY,
    chunk_components,
    component_builder_parallel,
    slot_expected_name_state_key,
    slot_input_state_key,
)
from ..services.component_failure_service import (
    build_component_generation_failure,
    build_component_generation_warning,
    build_content_salvage_component_tsx,
    build_placeholder_component_tsx,
    get_component_failure_metadata,
    is_fatal_component_failure,
    is_placeholder_tsx,
)
from ..services.theme_palette_service import (
    ThemePaletteResolutionError,
    load_and_persist_theme_palette,
    render_fallback_theme_css,
)

# Cap component-regen attempts at 1. The orchestrator-level retry loop
# used to re-run ComponentBuilder up to 3× when the inline validator
# rejected the artifact, but the trace evidence shows >1 retry is
# net-negative in cost vs success rate. One retry catches transient
# hiccups; further attempts ship a stub + warnings.
MAX_REPAIR_ATTEMPTS = 1

# Creator gets one retry on truncation / empty-output. The structured
# CreatorOutput JSON is the only place a single MAX_TOKENS hit can wipe
# the entire workflow (component plans, design tokens, backend models —
# all gone), so the retry budget here is independent from
# MAX_REPAIR_ATTEMPTS. validation_service injects _TRUNCATION_PROMPT on
# the second pass, nudging the model to be terser.
MAX_CREATOR_ATTEMPTS = 2

logger = structlog.get_logger(__name__)


# ----------------------------------------------------------------------------
# Design-bundle helpers
# ----------------------------------------------------------------------------


def canonical_page_slug(raw: Any) -> str:
    """Canonicalize a page slug to a fold-key shape.

    Canonical form is kebab-case with the homepage represented as an empty
    string. All these inputs fold to ``""``: ``"/"``, ``""``, ``"home"``,
    ``"index"``. Everything else: strip leading/trailing ``/`` and
    whitespace, lowercase, and normalize ``_`` / whitespace runs to ``-``.
    """
    if not isinstance(raw, str):
        return ""
    s = raw.strip().strip("/").strip().lower()
    if s in ("", "home", "index"):
        return ""
    # Normalize any underscore or whitespace to '-'.
    out_chars: list[str] = []
    prev_dash = False
    for ch in s:
        if ch in (" ", "\t", "_"):
            if not prev_dash:
                out_chars.append("-")
                prev_dash = True
        else:
            out_chars.append(ch)
            prev_dash = False
    return "".join(out_chars).strip("-")


def _route_literal_for_slug(raw: Any) -> str:
    """Coerce a Creator/DesignImporter ``page_slug`` into a runtime route literal.

    Returns a string that's safe to use directly as a route literal in
    the ``AppRoutes`` union and in JSX ``navigate(...)`` / ``<Link to=...>``
    callsites:

    - ``None`` / empty / whitespace / ``"home"`` / ``"index"`` / ``"/"`` → ``"/"``
    - ``"dashboard"``, ``"members"`` (no leading slash) → ``"/dashboard"``,
      ``"/members"`` (auto-prefix; Creator occasionally drops the slash)
    - ``"/about"`` → ``"/about"`` (already canonical)

    The auto-prefix is the second line of defence after ``canonical_page_slug``;
    it specifically targets the case where the LLM drops the leading slash
    because the runtime AppRoute union is ``"/foo"`` not ``"foo"``.
    """
    if not isinstance(raw, str):
        return "/"
    s = raw.strip()
    if not s:
        return "/"
    if s == "/":
        return "/"
    # Fold home synonyms.
    bare = s.lstrip("/").lower()
    if bare in ("home", "index"):
        return "/"
    if not s.startswith("/"):
        s = "/" + s
    return s


_HOMEPAGE_NAME_HINTS: tuple[str, ...] = (
    "dashboard",
    "home",
    "index",
    "main",
    "overview",
    "landing",
)


def _ensure_homepage_content_slug(component_plans: list[dict]) -> None:
    """Ensure at least one ``role=content`` component has ``page_slug == "/"``.

    The Creator system prompt asks for "exactly one homepage content
    component (page_slug: '/')", but the LLM occasionally puts every
    page on a non-``/`` route (e.g. dashboard at ``/dashboard``). Without
    a ``/`` route the runtime SPA serves the wrong page on the bare
    domain, the AppRoutes union excludes ``"/"``, and sidebar/navigation
    components can't write the natural "home" link.

    This helper mutates ``component_plans`` in-place: it normalizes every
    content slug via :func:`_route_literal_for_slug`, then if no content
    component has slug ``"/"``, it promotes the best match (first by
    name pattern, falling back to the first content component) to ``"/"``.
    """
    content_plans = [cp for cp in component_plans if cp.get("role") == "content"]
    if not content_plans:
        return
    for cp in content_plans:
        cp["page_slug"] = _route_literal_for_slug(cp.get("page_slug"))
    if any(cp.get("page_slug") == "/" for cp in content_plans):
        return
    # No homepage — promote the best candidate.
    promoted: dict | None = None
    for cp in content_plans:
        name = (cp.get("name") or "").lower()
        if any(hint in name for hint in _HOMEPAGE_NAME_HINTS):
            promoted = cp
            break
    if promoted is None:
        promoted = content_plans[0]
    original = promoted.get("page_slug")
    promoted["page_slug"] = "/"
    logger.warning(
        "creation_workflow_promoted_homepage_slug",
        component=promoted.get("name"),
        original_slug=original,
    )


def _check_content_components_have_building_plans(plan: dict) -> None:
    """Raise PipelineError if any code-component content plan lacks bullets.

    Run this AFTER ``materialize_plan_artifacts`` resolves ``plan:*``
    artifact refs into inline ``building_plan`` lists. An empty plan
    here means the Creator escalation contract was violated (either
    Creator emitted neither inline nor artifact, or the artifact body
    was missing/empty). ComponentBuilder would otherwise emit a thin,
    barely-actionable component — fail loudly to surface the regression.
    """
    empty_components: list[str] = []
    for cp in plan.get("component_plans") or []:
        if not isinstance(cp, dict):
            continue
        if cp.get("role") != "content":
            continue
        if not cp.get("building_plan"):
            empty_components.append(cp.get("name") or "<unnamed>")
    if empty_components:
        raise PipelineError(
            "Creator returned content components with empty building_plan "
            f"after artifact materialization: {empty_components}. The "
            "artifact contract requires save_plan_artifact + a non-empty "
            "building_plan_artifact reference per content component.",
            severity=ErrorSeverity.FATAL,
            step_name="CreationWorkflow.execute",
        )


def _is_load_artifact_directive(bullet: Any) -> bool:
    """True for a building-plan bullet that tells the builder to load page copy
    from an artifact (e.g. the synthesized "Load page copy/content from
    artifact: X" from plan_artifact_materializer._synthesize_building_plan).

    Such a directive contradicts an eager-inlined ``content_source``: the builder
    would be told both to use the inlined copy AND to call ``load_artifacts``,
    re-tempting the load round-trip that causes content-component no-saves on
    weak models. Stripped only when content was actually inlined.
    """
    low = str(bullet or "").strip().lower()
    return low.startswith("load ") and "artifact" in low


# --- 3D-game recipe eager-inline --------------------------------------------
# The weak non-Gemini cohort almost never calls ``load_skill`` and cannot write
# a correct Three.js FPS from scratch (it falls back to a broken bare-``three``
# import or a flat 2D canvas). So for a detected 3D-game component we inline the
# vetted, validation-passing FPS recipe straight into ``recipe_source`` —
# exactly the proven ``content_source`` pattern that fixed content-page no-saves.
# The recipe is the SAME file the ``game-3d`` skill serves, so ``load_skill``
# users and the eager path never drift.
_FPS_RECIPE_PATH = (
    AGENT_DOCS_DIR
    / "frontend"
    / "component_builder"
    / "skills"
    / "game-3d"
    / "assets"
    / "fps_arena.tsx"
)

# A 3D-game build needs BOTH a 3D signal AND a game signal — so a "3D product
# viewer" (3D, not a game) and a "2D snake game" (game, not 3D) are both
# excluded, and only genuine 3D/WebGL games get the FPS recipe.
_3D_SIGNAL_RE = re.compile(
    r"\b(3-?d|three\.?js|web ?gl|first[- ]?person|fps|counter[- ]?strike|"
    r"wolfenstein|doom|quake|call of duty)\b",
    re.IGNORECASE,
)
# Strong game tokens only. Deliberately NO 'level'/'player'/'wave' — those
# collide with non-games (a "3D video player", a multi-level form, a wave/audio
# tool) and would make ``_is_3d_game`` fire on them.
_GAME_SIGNAL_RE = re.compile(
    r"\b(game|shoot(er|ing)?|fps|arena|enem(y|ies)|deathmatch|counter[- ]?strike|"
    r"wolfenstein|doom|quake|call of duty|gun)\b",
    re.IGNORECASE,
)
# Component-NAME signal — identifies the actual game-canvas component. Used only
# against the component name (never its free-text plan, which on a 3D-game app
# mentions "game"/"3D" on every page).
_GAME_NAME_RE = re.compile(
    r"(game|play|arena|fps|shoot|scene|world|battle|combat|canvas)",
    re.IGNORECASE,
)

# Cache the recipe body ONLY on success — caching the empty-string failure would
# poison the whole process (every later 3D build would ship a placeholder) after
# one transient read miss.
_FPS_RECIPE_CACHE: str = ""


def _load_fps_recipe() -> str:
    """Read the Three.js FPS recipe body (cached on success; fail-safe '')."""
    global _FPS_RECIPE_CACHE
    if _FPS_RECIPE_CACHE:
        return _FPS_RECIPE_CACHE
    try:
        body = _FPS_RECIPE_PATH.read_text(encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning(
            "[CreationWorkflow] FPS recipe unreadable; 3D builds fall back to "
            "the agent's own code (likely placeholder on weak models)",
            path=str(_FPS_RECIPE_PATH),
            error=str(exc),
        )
        return ""
    _FPS_RECIPE_CACHE = body
    return body


def _is_3d_game(text: str) -> bool:
    """True when ``text`` describes a real 3D / WebGL game (not a 2D game, not a
    non-game 3D scene). Requires a 3D signal AND a game signal."""
    if not text:
        return False
    return bool(_3D_SIGNAL_RE.search(text) and _GAME_SIGNAL_RE.search(text))


def _should_inline_fps_recipe(
    *,
    app_secondary_type: str,
    role: str,
    comp_name: str,
    comp_text: str,
    combined_text: str,
    has_content_source: bool,
) -> bool:
    """Decide whether to eager-inline the Three.js FPS recipe into THIS component.

    Tight, prose-page-safe gate (extracted as a pure function so it's unit
    testable):

    * custom app + content role + the app is a real 3D game (``_is_3d_game`` over
      app description + this component's text).
    * NOT a prose page — ``has_content_source`` means the component carries
      eager-inlined markdown copy (Terms/About/menu/instructions); the game
      canvas never does. This single clause excludes sibling content pages AND
      prevents a contradictory recipe_source + content_source on the same build.
    * Per-component identity: the component NAME looks like the game canvas, OR
      its plan text carries an explicit 3D-engine signal (three.js/WebGL/
      first-person/FPS) — which a menu/settings page won't. The bare
      game-vocabulary match on plan text is intentionally NOT used: on a 3D-game
      app every page's copy says "game", so it can't discriminate.
    """
    if app_secondary_type != "custom" or role != "content" or has_content_source:
        return False
    if not _is_3d_game(combined_text):
        return False
    return bool(_GAME_NAME_RE.search(str(comp_name)) or _3D_SIGNAL_RE.search(comp_text))


def _reconcile_page_access(page_access: dict, component_plans: list, agent_name: str) -> dict:
    """Drop / fix ``pageAccess`` keys that don't match real content slugs.

    The Creator emits ``security_plan.page_access`` independently of the
    component-plan slugs, so we routinely see ``{"/": "public"}`` when
    the actual root page is ``/dashboard``. This helper:

    - Drops any non-wildcard key whose slug isn't in ``component_plans``
      (warns to ``agent.log``).
    - Rewrites ``"/"`` to the first content slug when ``"/"`` itself
      isn't a real page (preserves the access level so security intent
      isn't lost).

    Wildcard keys (``"/admin/*"``) and patterns containing ``*`` are
    left untouched.

    Slug keys are stripped of surrounding whitespace before comparison —
    the LLM sometimes emits ``"/ "`` for the root, which would otherwise
    silently fall back to ``defaultAccess`` because runtime ACL lookup
    is exact-match on the page slug.
    """
    if not isinstance(page_access, dict) or not page_access:
        return page_access or {}

    actual_slugs = {
        cp["page_slug"].strip()
        for cp in (component_plans or [])
        if isinstance(cp, dict)
        and cp.get("role") == "content"
        and isinstance(cp.get("page_slug"), str)
        and cp["page_slug"].strip()
    }
    if not actual_slugs:
        return {k.strip() if isinstance(k, str) else k: v for k, v in page_access.items()}

    first_content_slug = next(
        (
            cp["page_slug"].strip()
            for cp in (component_plans or [])
            if isinstance(cp, dict)
            and cp.get("role") == "content"
            and isinstance(cp.get("page_slug"), str)
            and cp["page_slug"].strip()
        ),
        None,
    )

    reconciled: dict = {}
    for raw_slug, level in page_access.items():
        if not isinstance(raw_slug, str):
            continue
        slug = raw_slug.strip()
        if not slug:
            logger.warning(f"[{agent_name}] dropping empty pageAccess key (was {raw_slug!r})")
            continue
        if slug != raw_slug:
            logger.info(f"[{agent_name}] normalized pageAccess key {raw_slug!r} → {slug!r}")
        if "*" in slug:
            reconciled[slug] = level
            continue
        if slug in actual_slugs:
            reconciled[slug] = level
            continue
        if slug == "/" and first_content_slug:
            logger.warning(
                f"[{agent_name}] pageAccess key '/' has no matching page; "
                f"rewriting to first content slug '{first_content_slug}'"
            )
            reconciled[first_content_slug] = level
            continue
        logger.warning(
            f"[{agent_name}] dropping pageAccess key '{slug}' — no matching "
            f"page in component_plans (slugs: {sorted(actual_slugs)})"
        )

    return reconciled


def _flip_ingested_models_to_shared(
    backend_config: dict[str, Any] | None,
    ingest_origins: dict[str, str],
) -> list[str]:
    """Force ``ownerScope = "shared"`` on backend models that came from xlsx ingest.

    The BackendBuilder LLM defaults every model to ``ownerScope = "user"``.
    For xlsx-ingested models that's wrong — the rows are reference data
    seeded once at deploy time with ``owner_id = "preview-owner-{appId}"``,
    an identity the gateway never mints. ``ownerScope = "user"`` then
    filters out every row in every list query, making the app render
    "No X found" on every page even though the table is fully seeded.

    ``shared`` makes ``sys_list`` / ``sys_read`` skip the owner_id WHERE
    clause entirely (see ``apps/app-backend/src/crud/list.ts`` and
    ``read.ts``) so the seeded rows are visible regardless of viewer.

    Args:
        backend_config: The mutable dict from BackendBuilder.result. May
            be None when no backend is needed; in that case this is a
            no-op.
        ingest_origins: ``{model_name: origin_tag}`` from
            ``StateKeys.EXTRACTED_SEED_SOURCE``. Origin ``"data_ingest"``
            means xlsx-derived; other origins (LLM-authored, design-import
            data-extraction) are left alone.

    Returns:
        Names of models flipped. Empty list if no change was needed.
    """
    if not backend_config or not ingest_origins:
        return []
    ingested = {name for name, origin in ingest_origins.items() if origin == "data_ingest"}
    flipped: list[str] = []
    for model in backend_config.get("models", []) or []:
        if model.get("name") in ingested and model.get("ownerScope") == "user":
            model["ownerScope"] = "shared"
            flipped.append(model["name"])
    return flipped


async def _load_seed_csvs_for_models(
    ctx: Any,
    backend_config: dict[str, Any] | None,
) -> dict[str, str]:
    """Load ``seed:<name>.csv`` artifacts for every model that has one.

    Returns ``{model_name: csv_text}`` for models with seed data
    available. Models without a seed artifact are omitted (no entry).
    Failures to load a specific seed are silently skipped — the caller
    treats absence as "no enum sampling for that model".

    Used by ``sample_enum_values_for_models`` to populate column
    ``enum_values`` from seed-derived distinct values.
    """
    if not backend_config:
        return {}
    out: dict[str, str] = {}
    for model in backend_config.get("models", []) or []:
        if not isinstance(model, dict):
            continue
        name = model.get("name")
        if not isinstance(name, str) or not name:
            continue
        try:
            csv_text = await ArtifactManager.load_artifact_as_string(ctx, f"seed:{name}.csv")
        except Exception:  # noqa: BLE001 — best-effort load
            continue
        if csv_text:
            out[name] = csv_text
    return out


class CreationWorkflow(BaseWorkflow):
    """
    Orchestrates the complete app creation workflow.

    Unlike the webapp creation workflow which generates JSON component configs,
    this workflow generates TSX code components that are compiled to ES modules
    and loaded at runtime. When the planner indicates backend_needed, it also
    generates logic.json, backend.json, handler TSX code, and seed data.

    Artifacts Produced:
    - codefocus_style:theme.css — Theme CSS
    - (Tailwind v4: config embedded in theme.css via @theme block)
    - codefocus_component:{name}.tsx — One per component (nav, footer, pages)
    - logic.json — Frontend logic config (if backend_needed)
    - backend.json — Backend models config (if backend_needed)
    - handler_code:{name}.tsx — One per handler (if backend_needed)
    - seed:{name}.csv — One per dataset (if backend_needed)
    """

    def __init__(
        self,
        creator_agent: LlmAgent,
        component_builder_agent: LlmAgent,
        design_system_builder_agent: LlmAgent,
        post_processing_service: PostProcessingService,
        assembly_service: AssemblyService,
        write_result_response_fn: Callable,
        emit_chat_directly_fn: Callable,
        emit_decline_directly_fn: Callable,
        validation_service: Optional[ValidationService] = None,
        # Backend builder (orchestrates model, handler, seed in parallel)
        logic_builder_agent: Optional[LlmAgent] = None,
        backend_builder: Optional["BackendBuilder"] = None,
        # Pre-classification (optional)
        pre_creator_agent: Optional[LlmAgent] = None,
        # Design-bundle imports (optional — only fires when a bundle
        # exists). Stitch / Claude Design imports use this agent to
        # produce theme.css + per-page content HTML artifacts.
        design_importer_agent: Optional[LlmAgent] = None,
        # DataIngester (optional). When ``DATA_INGEST_ENABLED`` is true
        # AND the user uploaded tabular files, runs as Step 0.6 between
        # content prep and PreCreator. Feeds Creator real seed data + a
        # domain-hint summary instead of synthesized fakes.
        data_ingester_agent: Optional[LlmAgent] = None,
    ):
        self.creator_agent = creator_agent
        self.component_builder_agent = component_builder_agent
        self.design_system_builder_agent = design_system_builder_agent
        self.post_processing_service = post_processing_service
        self.assembly_service = assembly_service
        self.write_result_response = write_result_response_fn
        # Direct-emit path: bypass the response-writer LLM when an upstream
        # agent already produced user-ready text. Two flavors:
        #   - emit_chat_directly: casual chat, success summaries
        #   - emit_decline_directly: same plus signals decline_reason +
        #     decline_category to downstream classifiers (skips credits,
        #     soft-deletes the App row on create flow).
        self.emit_chat_directly = emit_chat_directly_fn
        self.emit_decline_directly = emit_decline_directly_fn
        self.validation_service = validation_service or ValidationService()
        self.logic_builder_agent = logic_builder_agent
        self.backend_builder = backend_builder
        self.pre_creator_agent = pre_creator_agent
        self.design_importer_agent = design_importer_agent
        self.data_ingester_agent = data_ingester_agent

    def _build_component_generation_failure(
        self,
        unresolved_components: dict[str, str],
        user_request: str,
    ) -> tuple[dict, str, dict]:
        """Build a fatal failure payload for unresolved component generation."""
        return build_component_generation_failure(unresolved_components, user_request)

    async def _run_data_ingest_pre_pass(
        self,
        ctx: InvocationContext,
        content_context,
        *,
        mode: str,
        user_request: str,
        app_name: str,
        app_description: str = "",
    ) -> tuple[str, str]:
        """Step 0.6 — run the DataIngester pre-pass when conditions are met.

        Soft-fails on any error: a missing sidecar or a 2B LLM crash means
        the workflow continues without ingested data — the user just gets
        synthesized seeds (existing behavior) instead of theirs. Fatal
        failures are reserved for the explicit happy path; bugs here must
        not block app creation.

        Returns ``(domain_hints, creator_summary)`` — both empty strings
        when the pre-pass didn't run.
        """
        from config import DATA_INGEST_ENABLED

        if not DATA_INGEST_ENABLED:
            return "", ""
        if not self.data_ingester_agent:
            return "", ""
        if not getattr(content_context, "structured_documents", None):
            return "", ""

        from ..services.data_ingest_extractor import extract_all
        from ..services.extracted_seed_bridge import (
            bridge_extracted_artifacts_to_seed,
        )
        from ..subagents.data_ingester import (
            DataIngesterInput,
            IngestReport,
            report_to_creator_summary,
        )

        try:
            raw_models, failed_artifacts, layer2a_warnings = await extract_all(ctx, content_context)
        except Exception:  # noqa: BLE001
            logger.warning(
                "[CreationWorkflow] Data ingest Layer 2A crashed — proceeding without ingest",
                exc_info=True,
            )
            return "", ""

        if not raw_models:
            # All uploads ended up in failed_artifacts (e.g. pre-BE-1
            # PDFs with no sidecar). Soft-fail with a user-visible
            # warning; Creator will synthesize seeds the old way.
            if failed_artifacts:
                logger.info(
                    "[CreationWorkflow] Data ingest had no usable sidecars; "
                    "skipping (failed=%s)",
                    failed_artifacts,
                )
            return "", ""

        ingester_input = DataIngesterInput(
            user_request=user_request,
            app_name=app_name,
            app_description=app_description,
            mode=mode,
            raw_proposed_models=raw_models,
            failed_artifacts=failed_artifacts,
            warnings=layer2a_warnings,
            existing_models=[],  # create mode has no existing models
        )
        await push_prompt_to_next_agent(ctx, ingester_input.model_dump_json())

        try:
            async for _event in self.validation_service._run_agent_with_retry(
                ctx,
                self.data_ingester_agent,
                AgentName.DATA_INGESTER.value,
                1,
            ):
                # The DataIngester yields a single final event with the
                # structured output; we don't forward it as a progress
                # update — the workflow surfaces the report via
                # CreatorInput / IngestReport state.
                pass
        except Exception:  # noqa: BLE001
            logger.warning(
                "[CreationWorkflow] DataIngester LLM crashed — falling back to mechanical model names",
                exc_info=True,
            )
            # Fall back to raw Layer 2A output so seed extraction still
            # happens; just lose the LLM polish.
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
                        "[CreationWorkflow] DataIngester returned malformed report; "
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

        # Persist the report as a turn-scoped artifact for cross-turn lookup.
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
                "[CreationWorkflow] Failed to persist data_ingest_report artifact",
                exc_info=True,
            )

        # Hydrate seed artifacts so BackendBuilder's short-circuit picks
        # them up at build time.
        try:
            await bridge_extracted_artifacts_to_seed(ctx, [m.name for m in report.proposed_models])
        except Exception:  # noqa: BLE001
            logger.warning(
                "[CreationWorkflow] extracted_seed_bridge crashed — seed data may be incomplete",
                exc_info=True,
            )

        return report.domain_hints, report_to_creator_summary(report)

    def _merge_data_ingest_models_into_plan(
        self,
        ctx: InvocationContext,
        plan: dict,
    ) -> None:
        """Splice IngestReport.proposed_models (target_mode == 'create')
        into ``plan['app_backend_plan']['models']``. Ingester wins on
        name conflict — Creator was instructed not to redeclare these
        models, so any overlap usually means the Creator hallucinated
        a model the upload already covered.

        Also flips ``backend_type`` from ``none`` → ``dynamic`` when the
        Creator left it off but the user clearly uploaded structured data;
        without this the BackendBuilder is skipped and the seeds we just
        wrote are never deployed.

        Mutates ``plan`` in-place. No-op when no ingest report present.
        """
        from ..subagents.data_ingester import IngestReport

        raw = ctx.session.state.get(StateKeys.DATA_INGEST_REPORT)
        if not raw:
            return
        try:
            report = raw if isinstance(raw, IngestReport) else IngestReport.model_validate(raw)
        except Exception:  # noqa: BLE001
            logger.warning(
                "[CreationWorkflow] DATA_INGEST_REPORT malformed at merge time; skipping",
                exc_info=True,
            )
            return

        create_models = [m for m in report.proposed_models if m.target_mode == "create"]
        if not create_models:
            return

        backend_plan = plan.setdefault("app_backend_plan", {})
        existing_models = backend_plan.get("models") or []
        # Index existing models by name for the conflict check.
        by_name: dict[str, dict] = {}
        for m in existing_models:
            if isinstance(m, dict) and m.get("name"):
                by_name[m["name"]] = m

        for ingest_model in create_models:
            # Convert ProposedColumn → ColumnPlan-shaped dict. Skip system
            # columns (id/owner_id/created_at/updated_at) — Creator's
            # downstream code adds them automatically.
            cols: list[dict] = []
            for col in ingest_model.columns:
                if col.name in {"id", "owner_id", "created_at", "updated_at"}:
                    continue
                cols.append(
                    {
                        "name": col.name,
                        "type": (
                            col.type
                            if col.type in {"text", "integer", "real", "json", "blob"}
                            else "text"
                        ),
                        "required": not col.nullable,
                    }
                )
            model_dict = {
                "name": ingest_model.name,
                "columns": cols,
                "owner_scope": "user",
                "seed_hint": "",
            }
            by_name[ingest_model.name] = model_dict
            logger.info(
                "[CreationWorkflow] Merged DataIngester model into plan",
                model=ingest_model.name,
                column_count=len(cols),
                replaced_existing=ingest_model.name
                in {m.get("name") for m in existing_models if isinstance(m, dict)},
            )

        backend_plan["models"] = list(by_name.values())
        # Flip backend_type if the Creator left it off but we now have models.
        if backend_plan.get("backend_type", "none") == "none" and backend_plan["models"]:
            backend_plan["backend_type"] = "dynamic"
            logger.info(
                "[CreationWorkflow] Flipped backend_type to 'dynamic' for DataIngester models"
            )
        plan["app_backend_plan"] = backend_plan

    async def _build_component_builder_input(
        self,
        ctx,
        plan_item: dict,
        fallback_index: int,
        *,
        design_context: str,
        app_language_code: str,
        app_context: str,
        image_uuid_to_url: dict,
        backend_config: dict,
        plan: dict,
        app_secondary_type: str,
        logic_surface: str,
    ):
        """Construct a ComponentBuilderInput for one component plan.

        Extracted from the inline construction in the per-component build loop so
        both the sequential path and the slot-pool round dispatcher can share it.
        ``fallback_index`` is used to derive a deterministic ``Component{N}``
        name when the plan dict is missing a ``name`` field — matches the
        prior loop's index-based fallback behavior.

        Content artifacts are EAGER-LOADED into ``content_source`` here (mirroring
        the edit-mode ``existing_source`` pattern) so weak non-Gemini models never
        need to call ``load_artifacts`` mid-turn — that round-trip is the dominant
        cause of content-component "no-save" escalations (the model spends its turn
        loading and never reaches the save tool). See ``content_source`` field doc.
        """
        from ..subagents.component_builder import ComponentBuilderInput

        component_image_urls: dict = {}
        for img_uuid in plan_item.get("image_references", []):
            url = image_uuid_to_url.get(img_uuid)
            if url:
                component_image_urls[img_uuid] = url

        content_artifact = plan_item.get("content_artifact", "") or ""
        content_source, content_artifact = await self._eager_load_content_source(
            ctx, content_artifact
        )

        building_plan = plan_item.get("building_plan", []) or []
        if content_source:
            # Content was eager-inlined into content_source; drop any synthesized
            # "Load ... from artifact" directive so the builder isn't told both to
            # use the inlined copy AND to call load_artifacts (the contradiction
            # re-introduces the no-save load round-trip on weak models). Kept when
            # inline failed (content_source empty) — then the directive is correct.
            building_plan = [b for b in building_plan if not _is_load_artifact_directive(b)]

        fallback_name = f"Component{fallback_index}"
        comp_name = plan_item.get("name", fallback_name)

        # ── 3D-game recipe eager-inline ──────────────────────────────────────
        # For a detected 3D/WebGL GAME component, inline the vetted Three.js FPS
        # recipe into ``recipe_source`` (mirrors the content_source pattern). The
        # weak cohort can't write correct Three.js from scratch and won't call
        # load_skill, so this is what makes "build a 3D game" actually ship a
        # playable WebGL game instead of a broken bare-``three`` import or a flat
        # 2D fallback. Scoping decision lives in the pure ``_should_inline_fps_recipe``
        # (unit-tested) — it excludes prose pages (content_source set) and sibling
        # menu/About/Settings pages so only the actual game canvas gets the recipe.
        recipe_source = ""
        description = ctx.session.state.get(StateKeys.INITIAL_DESCRIPTION, "") or ""
        app_name = ctx.session.state.get(StateKeys.APP_NAME, "") or ""
        comp_text = " ".join(
            [
                str(comp_name),
                str(plan_item.get("page_summary", "") or ""),
                str(plan_item.get("page_short_summary", "") or ""),
                " ".join(str(b) for b in building_plan),
            ]
        )
        combined = " ".join([str(description), str(app_name), comp_text])
        if _should_inline_fps_recipe(
            app_secondary_type=app_secondary_type,
            role=plan_item.get("role", "content"),
            comp_name=comp_name,
            comp_text=comp_text,
            combined_text=combined,
            has_content_source=bool(content_source),
        ):
            recipe_source = _load_fps_recipe()
            if recipe_source:
                # The recipe IS the code; drop any "load ..." directive that would
                # re-tempt a discovery round-trip on the weak model.
                building_plan = [b for b in building_plan if not _is_load_artifact_directive(b)]
                logger.info(
                    "[CreationWorkflow] inlined 3D FPS recipe into recipe_source",
                    component=comp_name,
                    recipe_bytes=len(recipe_source),
                )

        return ComponentBuilderInput(
            component_name=comp_name,
            component_role=plan_item.get("role", "content"),
            building_plan=building_plan,
            build_mode="create",
            existing_source="",
            design_system_context=design_context,
            app_language_code=app_language_code,
            output_artifact_name=comp_name,
            app_context=app_context,
            image_urls=(json.dumps(component_image_urls) if component_image_urls else ""),
            content_artifact=content_artifact,
            content_source=content_source,
            recipe_source=recipe_source,
            backend_surface=build_backend_surface(
                backend_config,
                security_plan=plan.get("app_security_plan"),
                app_secondary_type=app_secondary_type,
            ),
            logic_surface=logic_surface,
        )

    @staticmethod
    async def _eager_load_content_source(ctx, content_artifact: str) -> tuple[str, str]:
        """Eager-load a content artifact body for inlining into ``content_source``.

        Returns ``(content_source, content_artifact)``. On success the body is
        returned and the artifact NAME is blanked (so the model has no name to
        tempt a redundant ``load_artifacts`` call). On any failure (missing /
        unreadable artifact) the body is empty and the original name is preserved
        so the model can still load it itself — fail-safe, never worse than today.
        """
        if not content_artifact:
            return "", ""
        try:
            body = await ArtifactManager.load_artifact_as_string(ctx, content_artifact)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "[CreationWorkflow] content_source eager-load failed; "
                "leaving artifact name for the model to load",
                content_artifact=content_artifact,
                error=str(exc),
            )
            return "", content_artifact
        if body:
            return body, ""
        # Empty/absent body — keep the name as a fallback path.
        return "", content_artifact

    async def _post_process_component_result(
        self,
        ctx,
        plan_item: dict,
        *,
        agent_name: str,
        fallback_index: int,
    ) -> tuple[Optional[ComponentEntry], bool]:
        """Verify a component artifact saved; on failure classify + write placeholder.

        Returns ``(component_entry, is_fatal_failure)``:
        - On success → ``(ComponentEntry, False)``
        - Non-fatal failure (placeholder saved) → ``(ComponentEntry, False)``
        - Non-fatal failure where placeholder save also failed → ``(None, False)``
          (caller should skip the component, matching the existing ``continue``)
        - Fatal failure → ``(None, True)`` (caller should abort the round/loop)

        Logic mirrors the sequential per-component post-build block at the
        previous ``creation_workflow.py:1092-1173`` exactly. Extracted so the
        slot-pool round dispatcher can call it for each component AFTER the
        round completes (it can't run mid-iteration under parallel).
        """
        fallback_name = f"Component{fallback_index}"
        comp_name = plan_item.get("name", fallback_name)
        comp_role = plan_item.get("role", "content")
        artifact_key = f"codefocus_component:{comp_name}.tsx"
        saved_source = await ArtifactManager.load_artifact_as_string(ctx, artifact_key)

        if not saved_source:
            failure_reason, failure_class = get_component_failure_metadata(
                ctx.session.state,
                comp_name,
            )
            fatal = is_fatal_component_failure(failure_class)
            logger.warning(
                f"[{agent_name}] Component {comp_name} has no artifact after "
                f"builder — marking unresolved",
                failure_reason=failure_reason,
                failure_class=failure_class,
                fatal=fatal,
            )
            unresolved_components = dict(ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}))
            unresolved_components[comp_name] = failure_reason
            await push_session_state_update(
                ctx,
                {StateKeys.UNRESOLVED_COMPONENTS: unresolved_components},
            )
            if fatal:
                logger.error(
                    f"[{agent_name}] Stopping component generation due to fatal failure",
                    component=comp_name,
                    failure_class=failure_class,
                )
                return None, True
            # Non-fatal: ship a placeholder so the page still renders and
            # the user can regenerate this section in the editor.
            placeholder_tsx = build_placeholder_component_tsx(
                comp_name, failure_reason, failure_class, comp_role
            )
            try:
                from google import genai as genai_module

                placeholder_bytes = placeholder_tsx.encode("utf-8")
                placeholder_artifact = genai_module.types.Part.from_bytes(
                    data=placeholder_bytes, mime_type="text/plain"
                )
                await ctx.artifact_service.save_artifact(
                    session_id=ctx.session.id,
                    user_id=ctx.session.user_id,
                    app_name=ctx.session.app_name,
                    filename=artifact_key,
                    artifact=placeholder_artifact,
                )
                logger.info(
                    f"[{agent_name}] Saved placeholder artifact for {comp_name}",
                    failure_class=failure_class,
                )
            except Exception as e:
                logger.error(
                    f"[{agent_name}] Failed to save placeholder for {comp_name}: {e}",
                    exc_info=True,
                )
                # Skip this component (matches the prior loop's ``continue``)
                return None, False

        entry = ComponentEntry(
            name=comp_name,
            role=comp_role,
            page_slug=plan_item.get("page_slug"),
            page_title=plan_item.get("page_title"),
            summary=plan_item.get("page_summary", "")
            or "\n".join(plan_item.get("building_plan", []))[:200],
            supporting_modules=[],
        )
        return entry, False

    async def _clear_if_recovered(self, ctx, plan_item: dict, component_entries: list) -> bool:
        """After a no-save retry re-dispatch, decide if ``plan_item`` recovered.

        Recovered ⇔ its artifact is now present AND not a placeholder (the slot
        saved real TSX this pass). On recovery, clear the component from
        UNRESOLVED_COMPONENTS + COMPONENT_FAILURE_DETAILS and ensure a
        ComponentEntry exists (the round-1 post-process appends one when the
        placeholder saved; the rare placeholder-save-failure path does not —
        cover both). Returns True iff recovered.
        """
        name = plan_item.get("name")
        source = await ArtifactManager.load_artifact_as_string(
            ctx, f"codefocus_component:{name}.tsx"
        )
        if not source or is_placeholder_tsx(source):
            return False  # still no real artifact — keep the placeholder

        unresolved_now = dict(ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}) or {})
        unresolved_now.pop(name, None)
        details_now = dict(ctx.session.state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {}) or {})
        details_now.pop(name, None)
        await push_session_state_update(
            ctx,
            {
                StateKeys.UNRESOLVED_COMPONENTS: unresolved_now,
                StateKeys.COMPONENT_FAILURE_DETAILS: details_now,
            },
        )
        if not any(getattr(e, "name", None) == name for e in component_entries):
            component_entries.append(
                ComponentEntry(
                    name=name,
                    role=plan_item.get("role", "content"),
                    page_slug=plan_item.get("page_slug"),
                    page_title=plan_item.get("page_title"),
                    summary=plan_item.get("page_summary", "")
                    or "\n".join(plan_item.get("building_plan", []))[:200],
                    supporting_modules=[],
                )
            )
        return True

    async def _salvage_unresolved_content_from_source(
        self,
        ctx,
        *,
        component_plans: list,
        component_entries: list,
        agent_name: str,
        round_has_fatal: bool = False,
    ) -> list[str]:
        """Lever B — deterministic content salvage from ``content_source``.

        A ``role == "content"`` page whose markdown body was eager-inlined into
        ``content_source`` at dispatch (see ``_build_component_builder_input``)
        but that the model STILL failed to echo into a save tool call — even
        after Lever A's independent re-rolls — does not need the model at all:
        the platform already holds the copy. Re-load that body and render it
        into a real TSX component (``build_content_salvage_component_tsx``), so
        the legal / marketing page ships its ACTUAL content instead of a
        "needs attention" placeholder. This is the dominant residual no-save on
        weak non-Gemini models, where a long body (~2.5 KB+) is the single
        hardest thing to reproduce verbatim in one turn.

        Fires only for content components carrying a non-empty, renderable
        ``content_source`` — it never invents content. On success, mirrors
        ``_clear_if_recovered``: overwrite the artifact, drop the component from
        UNRESOLVED_COMPONENTS + COMPONENT_FAILURE_DETAILS, and ensure a
        ComponentEntry exists. Returns the list of salvaged component names.
        """
        if round_has_fatal:
            return []
        unresolved = dict(ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}) or {})
        if not unresolved:
            return []
        plans_by_name = {cp.get("name"): cp for cp in component_plans if isinstance(cp, dict)}
        salvaged: list[str] = []
        for name in list(unresolved.keys()):
            cp = plans_by_name.get(name)
            if not isinstance(cp, dict) or cp.get("role") != "content":
                continue
            if await self._salvage_one_content_component(ctx, cp, component_entries, agent_name):
                salvaged.append(name)
        if salvaged:
            logger.info(
                f"[{agent_name}] content salvage recovered {len(salvaged)} "
                f"component(s) from content_source",
                components=salvaged,
            )
        return salvaged

    async def _salvage_one_content_component(
        self, ctx, cp: dict, component_entries: list, agent_name: str
    ) -> bool:
        """Render one still-unresolved content slot from its eager-loaded body.

        Re-loads the ``content_source`` body the dispatch inlined, renders it via
        ``build_content_salvage_component_tsx``, overwrites the placeholder
        artifact, and mirrors ``_clear_if_recovered``'s bookkeeping (drop from
        UNRESOLVED_COMPONENTS + COMPONENT_FAILURE_DETAILS, ensure a
        ComponentEntry). Returns True iff a real component was saved. No-ops
        (returns False) when the body is empty/unrenderable or the save fails —
        the caller then keeps the placeholder, never worse than today.
        """
        name = cp.get("name")
        content_source, _ = await self._eager_load_content_source(
            ctx, cp.get("content_artifact", "") or ""
        )
        if not content_source.strip():
            return False
        salvage_tsx = build_content_salvage_component_tsx(
            name, content_source, page_title=cp.get("page_title") or ""
        )
        if not salvage_tsx:
            return False
        try:
            from google import genai as genai_module

            salvage_artifact = genai_module.types.Part.from_bytes(
                data=salvage_tsx.encode("utf-8"), mime_type="text/plain"
            )
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=f"codefocus_component:{name}.tsx",
                artifact=salvage_artifact,
            )
        except Exception as e:  # pragma: no cover - defensive
            logger.error(
                f"[{agent_name}] content salvage save failed for {name}: {e}",
                exc_info=True,
            )
            return False

        unresolved_now = dict(ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}) or {})
        unresolved_now.pop(name, None)
        details_now = dict(ctx.session.state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {}) or {})
        details_now.pop(name, None)
        await push_session_state_update(
            ctx,
            {
                StateKeys.UNRESOLVED_COMPONENTS: unresolved_now,
                StateKeys.COMPONENT_FAILURE_DETAILS: details_now,
            },
        )
        if not any(getattr(e, "name", None) == name for e in component_entries):
            component_entries.append(
                ComponentEntry(
                    name=name,
                    role=cp.get("role", "content"),
                    page_slug=cp.get("page_slug"),
                    page_title=cp.get("page_title"),
                    summary=cp.get("page_summary", "")
                    or "\n".join(cp.get("building_plan", []))[:200],
                    supporting_modules=[],
                )
            )
        logger.info(
            f"[{agent_name}] content salvage RECOVERED {name} from content_source",
            content_bytes=len(content_source),
        )
        return True

    async def _retry_unresolved_components(
        self,
        ctx,
        *,
        component_entries: list,
        code_component_plans: list,
        agent_name: str,
        metrics_tracker,
        cb_model,
        build_input_kwargs: dict,
    ) -> AsyncGenerator[Event, None]:
        """Lever A — re-dispatch ComponentBuilder for components that produced
        no real artifact (gemini-3-flash single-turn no-save), once per attempt.

        Each slot uses model-default sampling (no temperature/seed set), so a
        fresh re-dispatch is an INDEPENDENT re-roll: failure rate p → p^(1+attempts).
        For every still-unresolved component we reset its per-component guardrail
        state (so it gets a fresh save budget), re-run it through the slot pool,
        then check the artifact: a non-placeholder source means the slot saved
        real TSX → clear it from UNRESOLVED/COMPONENT_FAILURE_DETAILS (and ensure
        a ComponentEntry exists). Components still missing keep their placeholder
        (partial-ship ships them). Telemetry is logged for the recovery rate.

        Only call this for the recoverable case (no fatal failure in the build).
        """
        plans_by_name = {cp.get("name"): cp for cp in code_component_plans}
        name_to_idx = {cp.get("name"): i for i, cp in enumerate(code_component_plans)}
        attempts = max(1, COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS)
        recovered_total: list[str] = []
        initial = list((ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}) or {}).keys())

        for attempt in range(1, attempts + 1):
            unresolved = dict(ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}) or {})
            targets = [plans_by_name[n] for n in unresolved if n in plans_by_name]
            if not targets:
                break
            target_names = [cp.get("name") for cp in targets]
            logger.info(
                f"[{agent_name}] No-save retry attempt {attempt}/{attempts}",
                components=target_names,
            )

            # Reset per-component guardrail state so each target gets a fresh
            # save budget. Keys mirror slot_save_guardrail: the per-component
            # call counter `_save_tool_calls:{name}` and the shared terminal
            # latch dict keyed by component name.
            latches = dict(ctx.session.state.get(_TERMINAL_LATCH_KEY, {}) or {})
            for name in target_names:
                ctx.session.state.pop(f"_save_tool_calls:{name}", None)
                latches.pop(name, None)
            ctx.session.state[_TERMINAL_LATCH_KEY] = latches

            for batch in chunk_components(targets, NUM_SLOTS):
                active_slots = SLOT_NAMES[: len(batch)]
                ctx.session.state[STATE_EXECUTION_COMPONENTS] = active_slots
                for slot_name, cp in zip(active_slots, batch):
                    builder_input = await self._build_component_builder_input(
                        ctx,
                        cp,
                        name_to_idx.get(cp.get("name"), 0),
                        **build_input_kwargs,
                    )
                    ctx.session.state[slot_input_state_key(slot_name)] = json.dumps(
                        builder_input.model_dump()
                    )
                    ctx.session.state[slot_expected_name_state_key(slot_name)] = cp.get(
                        "name", "Component"
                    )

                if metrics_tracker:
                    await metrics_tracker.start_agent(
                        ctx, AgentName.COMPONENT_BUILDER.value, model=cb_model
                    )
                try:
                    async for event in component_builder_parallel._run_async_impl(ctx):
                        if (
                            metrics_tracker
                            and hasattr(event, "usage_metadata")
                            and event.usage_metadata
                        ):
                            await metrics_tracker.record_tokens(
                                ctx, event.usage_metadata, AgentName.COMPONENT_BUILDER.value
                            )
                        yield event
                finally:
                    if metrics_tracker:
                        await metrics_tracker.stop_agent(ctx)

                # Per-round key hygiene (same as the main dispatch loop).
                ctx.session.state.pop(STATE_EXECUTION_COMPONENTS, None)
                for slot_name in SLOT_NAMES:
                    ctx.session.state.pop(slot_input_state_key(slot_name), None)
                    ctx.session.state.pop(slot_expected_name_state_key(slot_name), None)

                # Recovery check: a non-placeholder artifact means the slot saved
                # real TSX this time.
                for cp in batch:
                    if await self._clear_if_recovered(ctx, cp, component_entries):
                        recovered_total.append(cp.get("name"))
                        logger.info(
                            f"[{agent_name}] No-save retry RECOVERED {cp.get('name')}",
                            attempt=attempt,
                        )

        still = list((ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}) or {}).keys())
        logger.info(
            f"[{agent_name}] No-save retry complete",
            attempted=initial,
            recovered=recovered_total,
            still_unresolved=still,
            recovered_count=len(recovered_total),
            attempted_count=len(initial),
        )

    async def execute(
        self,
        ctx: InvocationContext,
        progress_tracker: ProgressTracker,
        metrics_tracker: Optional[MetricsTracker] = None,
    ) -> AsyncGenerator[Event, None]:
        """Execute the creation workflow."""
        agent_name = "Creation"

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

        # ─── Step 1: Plan ─────────────────────────────────────────────
        yield progress_tracker.create_event(
            ctx, "planning", internal_message="Planning app structure"
        )
        logger.info(f"[{agent_name}] Step 1: Running creator")

        app_description = ctx.session.state.get(StateKeys.INITIAL_DESCRIPTION, "")
        app_name = ctx.session.state.get("app_name", "My App")
        app_language_code = ctx.session.state.get("app_language_code", "en")
        user_language_code = ctx.session.state.get("user_language_code", "en")
        creation_source = ctx.session.state.get("creation_source", "")
        # Prepare content context (documents, images, @filename references)
        content_context = await DocumentArtifactService.prepare_content_context(
            ctx, user_prompt=app_description
        )

        logger.info(
            f"[{agent_name}] Content context prepared: "
            f"{len(content_context.document_artifact_list)} doc artifacts, "
            f"{len(content_context.large_document_list)} large docs, "
            f"{len(content_context.user_referenced_images)} user-ref images, "
            f"{len(content_context.user_referenced_documents)} user-ref docs"
        )

        # Report unresolved @filename references
        if content_context.unresolved_references:
            from main_agent.agents.orchestrator.models.agent_errors import (
                ContentReferenceError,
            )

            error = ContentReferenceError(
                timestamp=datetime.now(timezone.utc).isoformat(),
                summary=(
                    f"Could not resolve {len(content_context.unresolved_references)} "
                    f"file reference(s): {', '.join(content_context.unresolved_references)}"
                ),
                unresolved_references=content_context.unresolved_references,
            )
            existing_errors = ctx.session.state.get(StateKeys.AGENT_ERRORS, [])
            existing_errors.append(error.model_dump())
            await push_session_state_update(ctx, {"agent_errors": existing_errors})
            logger.warning(
                f"[{agent_name}] Unresolved file references: "
                f"{content_context.unresolved_references}"
            )

        # ─── Step 0.6: Data ingest pre-pass ──────────────────────────
        # When the user uploaded tabular files (Excel/CSV today; PDF/DOCX/PPTX
        # post-BE-*) and ``DATA_INGEST_ENABLED`` is on, run the DataIngester
        # before PreCreator so its domain_hints can shape app-type
        # classification, and bridge raw rows into ``EXTRACTED_SEED_DATA``
        # so the BackendBuilder seed short-circuit picks them up at build
        # time.
        ingest_domain_hints, ingest_creator_summary = await self._run_data_ingest_pre_pass(
            ctx,
            content_context,
            mode="create",
            user_request=app_description,
            app_name=app_name,
        )

        # ─── Step 0.5: Pre-classify app type ────────────────────────
        if self.pre_creator_agent:
            from ..subagents.pre_creator import PreCreatorInput

            pre_input = PreCreatorInput(
                app_name=app_name,
                app_description=app_description,
                app_language_code=app_language_code,
                creation_source=creation_source,
                bundle_domain_hints=ingest_domain_hints,
                bundle_page_slugs=[],
            )
            await push_prompt_to_next_agent(ctx, pre_input.model_dump_json())
            # Run PreCreator via validation_service so its token usage, latency,
            # and input/output land in metrics_summary.json and agent_io/.
            # Raw `.run_async(ctx)` bypasses both, making classification
            # drift invisible to telemetry.
            # 2 attempts, not 1. PreCreator is the FIRST phase, so any schema
            # slip here kills the build outright — observed live when a model
            # returned an app type outside the Literal and the run died before
            # anything had been created. `is_output_schema_error` already
            # classifies that as retryable; it just never got a second attempt.
            # This is the cheapest call in the pipeline (~3s, a few hundred
            # tokens), so the re-roll costs almost nothing and covers the fields
            # the app-type normaliser cannot (language codes, branch_label).
            async for event in self.validation_service._run_agent_with_retry(
                ctx,
                self.pre_creator_agent,
                AgentName.PRE_CREATOR.value,
                2,
            ):
                yield event

            pre_result = ctx.session.state.get("pre_creator_output", {})

            # ─── Refusal short-circuit (meta-request or unsafe content) ──
            # The PreCreator can reject a request before any planning runs
            # so we never expose internals or build disallowed content.
            # See packages/schemas/data/agent_docs/common/docs/00_REFUSAL_RULES.md.
            #
            # `decline_reason` is already user-ready (per safety doc § 4),
            # so we skip the response-writer LLM and emit it directly —
            # one round-trip total instead of two.
            if pre_result.get("branch_label") == "decline":
                decline_category = pre_result.get("decline_category", "none")
                decline_reason = pre_result.get("decline_reason") or (
                    "I can't build that. Please tell me about a different app "
                    "you'd like to create."
                )
                logger.info(
                    f"[{agent_name}] PreCreator declined: " f"category={decline_category!r}"
                )
                refusal_user_request = (
                    f"Create app: {app_name} — {app_description}"
                    if app_description
                    else f"Create app: {app_name}"
                )
                # Use _emit_decline_directly (not _emit_chat_directly) so
                # downstream sets DECLINE_REASON/DECLINE_CATEGORY in
                # session state. BackendNotificationService reads those
                # to send status="declined" → backend skips credits and
                # soft-deletes the App row.
                await self.emit_decline_directly(
                    ctx, refusal_user_request, decline_reason, decline_category
                )
                return

            pre_classified_type = pre_result.get("app_secondary_type", "website")
            app_language_code = pre_result.get("app_language_code", app_language_code)
            user_language_code = pre_result.get("user_language_code", "en")
            await push_session_state_update(
                ctx,
                {
                    "pre_classified_app_type": pre_classified_type,
                    "app_language_code": app_language_code,
                    "user_language_code": user_language_code,
                },
            )
            logger.info(
                f"[{agent_name}] Pre-classified: type={pre_classified_type}, "
                f"lang={app_language_code}, user_lang={user_language_code}"
            )

        creator_input = CreatorInput(
            app_name=app_name,
            app_description=app_description,
            # Content-aware fields
            image_catalog_summary=content_context.image_catalog_summary,
            document_artifact_list=content_context.document_artifact_list,
            large_document_list=content_context.large_document_list,
            user_referenced_images=content_context.user_referenced_images,
            user_referenced_documents=content_context.user_referenced_documents,
            user_referenced_large_documents=(content_context.user_referenced_large_documents),
            # No bundle fields — design-imports go through DesignImportWorkflow
            bundle_domain_hints=ingest_domain_hints,
            bundle_page_slugs=[],
            data_ingest_report=ingest_creator_summary,
        )

        # Run creator agent (with retry for empty/truncated responses)
        await push_prompt_to_next_agent(ctx, creator_input.model_dump_json())

        async for event in self.validation_service._run_agent_with_retry(
            ctx,
            self.creator_agent,
            AgentName.CREATOR.value,
            MAX_CREATOR_ATTEMPTS,
        ):
            yield event

        plan = ctx.session.state.get(StateKeys.CREATOR_PLAN, {})
        if not plan or not plan.get("component_plans"):
            raise PipelineError(
                "Creator agent returned empty or invalid output",
                severity=ErrorSeverity.FATAL,
                step_name="CreationWorkflow.execute",
            )

        # Materialize any building_plan artifacts emitted by Creator (or
        # the design-import path) back into the inline list[str] shape
        # downstream consumers expect. No-op when no artifact refs are set.
        # Must run before ComponentBuilder dispatch, validation context, and
        # any chat-summary builder.
        from main_agent.agents.orchestrator.app_types.webapp.services.plan_artifact_materializer import (
            materialize_plan_artifacts,
        )

        plan = await materialize_plan_artifacts(plan, ctx)

        # Post-materialization sanity check: every content component must
        # have an actionable ``building_plan``. An empty plan means either
        # Creator skipped escalation (regression on the artifact contract)
        # or the artifact body was empty / failed to load. Either way,
        # ComponentBuilder would emit a thinly-described component, so
        # fail loudly here instead of shipping garbage.
        _check_content_components_have_building_plans(plan)

        # Save plan as debug artifact (matches webapp's app_creator_plan.json)
        await ArtifactManager.save_config_artifact_from_invocation_context(
            ctx, plan, "codefocus_plan.json"
        )

        # Update app_name from creator output (creator refines generic names like "New App")
        app_name = plan.get("app_name", app_name)

        app_secondary_type = ctx.session.state.get("pre_classified_app_type", "website")

        await push_session_state_update(
            ctx,
            {
                "app_name": app_name,
                "app_type": app_secondary_type,
                "app_building_plan": plan.get("app_building_plan", []),
                "design_system": plan.get("design_system", {}),
            },
        )

        total_components = len(plan.get("component_plans", []))

        logger.info(
            f"[{agent_name}] Plan received",
            components=total_components,
            navigation=plan.get("navigation_type"),
            backend_type=plan.get("app_backend_plan", {}).get("backend_type", "none"),
        )

        # Calculate estimated total time now that we know component count
        await progress_tracker.calculate_total_time_codefocus(ctx, total_components)

        # ─── Steps 2-3: Design System + Logic + Backend ──────────────
        design_system = plan.get("design_system", {})
        from ..subagents.design_system_builder import (
            DesignSystemBuilderInput,
        )

        # Pre-compute M3 palette deterministically for guaranteed contrast
        from main_agent.services.validation.style_coverage import compute_m3_palette

        seed_primary = design_system.get("primary_color") or "#0F766E"
        seed_secondary = design_system.get("secondary_color") or "#D97706"
        seed_surface = design_system.get("surface_color") or "#FFFBEB"
        seed_error = design_system.get("error_color") or "#DC2626"

        pre_computed = compute_m3_palette(
            primary=seed_primary,
            secondary=seed_secondary,
            surface=seed_surface,
            error=seed_error,
        )

        ds_input = DesignSystemBuilderInput(
            primary_color=seed_primary,
            secondary_color=seed_secondary,
            surface_color=seed_surface,
            error_color=seed_error,
            headline_font=design_system.get("headline_font") or "Outfit",
            body_font=design_system.get("body_font") or "DM Sans",
            design_style=design_system.get("design_style") or ["modern dashboard"],
            app_language_code=app_language_code,
            pre_computed_palette=json.dumps(pre_computed),
        )

        backend_config = None
        logic_config = None
        seed_metadata = None

        # ─── Step 1.5: Merge DataIngester models into Creator plan ────
        # Creator was told (via data_ingest_report) NOT to redeclare these
        # models. The IngestReport may still hold models the Creator left
        # out, so we splice them in here before the BackendBuilder runs.
        # Ingester wins on name conflict — its column types come from the
        # backend's typed sidecar, not the LLM's guess.
        self._merge_data_ingest_models_into_plan(ctx, plan)

        app_backend_plan = plan.get("app_backend_plan", {})
        app_logic_plan = plan.get("app_logic_plan", {})
        backend_type = app_backend_plan.get("backend_type", "none")
        # File storage is independent of backend_type (plan_models.py: "Storage is
        # independent of backend_type — a 'none' app can still have storage"). A
        # form/'none' app with file uploads still needs the backend build to run so
        # BackendBuilder emits {mode:"none", storage:{...}} (its non-dynamic branch,
        # backend_builder.py:411-417). Without this, the Creator's storage.enabled is
        # silently dropped, R2 is never provisioned, and every upload fails with
        # STORAGE_DISABLED (surfaced on 4wsdbbsz rental-application, 2026-05-23).
        storage_enabled = bool((app_backend_plan.get("storage") or {}).get("enabled"))
        backend_needed = backend_type == "dynamic" or storage_enabled

        has_logic = bool(app_logic_plan and app_logic_plan.get("state_variables"))

        if backend_needed and not self.backend_builder:
            logger.warning(
                f"[{agent_name}] Creator indicated backend_type='dynamic' but "
                f"backend builder is not available — skipping backend generation"
            )
            backend_needed = False

        # Prepare Logic input (if needed)
        logic_input_json = None
        if has_logic and self.logic_builder_agent:
            from ...shared.builders.logic_builder import LogicBuilderInput

            logic_input = LogicBuilderInput(
                app_logic_plan=json.dumps(app_logic_plan),
                app_pages_building_plan_list=json.dumps(plan.get("component_plans", [])),
                # app_secondary_type is owned by PreCreator (session state
                # `pre_classified_app_type`); the Creator's `plan` dict does NOT
                # carry this field, so `plan.get("app_secondary_type", ...)`
                # always returned the fallback and corrupted downstream inputs.
                app_type=app_secondary_type,
            )
            logic_input_json = json.dumps(logic_input.model_dump())

        # ─── Steps 2-3: Design System + Logic (parallel or sequential) ──

        skip_design_system_builder = False

        run_parallel = (
            PARALLEL_PRE_BUILD and logic_input_json is not None and not skip_design_system_builder
        )

        logger.info(
            f"[{agent_name}] Pre-build decision",
            parallel=run_parallel,
            flag_enabled=PARALLEL_PRE_BUILD,
            has_logic=logic_input_json is not None,
            has_backend=backend_needed,
            skip_ds_builder=skip_design_system_builder,
        )

        if run_parallel:
            # ── Parallel path: DS + Logic concurrently ──
            from .parallel_pre_build import run_pre_build_parallel

            await progress_tracker.update(ctx, 10, "Building design system and logic")
            yield progress_tracker.create_event(
                ctx,
                "building_pre_build",
                internal_message="Building design system and logic in parallel",
            )
            logger.info(f"[{agent_name}] Steps 2-3: Running DS + Logic in parallel")

            if metrics_tracker:
                await metrics_tracker.start_agent(ctx, "ParallelPreBuild", model="parallel")

            try:
                async for event in run_pre_build_parallel(
                    ctx=ctx,
                    ds_agent=self.design_system_builder_agent,
                    ds_input_json=json.dumps(ds_input.model_dump()),
                    logic_agent=self.logic_builder_agent if logic_input_json else None,
                    logic_input_json=logic_input_json,
                    backend_agent=None,
                    backend_input_json=None,
                ):
                    yield event
            except PipelineError:
                logger.warning(
                    f"[{agent_name}] Parallel pre-build failed, falling back to sequential",
                    exc_info=True,
                )
                run_parallel = False

            if metrics_tracker:
                await metrics_tracker.stop_agent(ctx)

            await progress_tracker.update(ctx, 20, "Pre-build complete")

        if not run_parallel:
            # ── Sequential path (fallback or DS-only) ──
            if skip_design_system_builder:
                await progress_tracker.update(ctx, 10, "Adopting imported design system")
                yield progress_tracker.create_event(
                    ctx,
                    "adopting_imported_theme",
                    internal_message="Using theme from your imported design",
                )
            else:
                await progress_tracker.update(ctx, 10, "Design system")
                yield progress_tracker.create_event(
                    ctx, "building_theme", internal_message="Creating design system"
                )
                logger.info(f"[{agent_name}] Step 2: Generating design system")

                await push_prompt_to_next_agent(ctx, json.dumps(ds_input.model_dump()))
                async for event in self._run_agent_with_metrics(
                    ctx,
                    self.design_system_builder_agent,
                    AgentName.DESIGN_SYSTEM_BUILDER.value,
                    metrics_tracker,
                ):
                    yield event

            if logic_input_json and self.logic_builder_agent:
                await progress_tracker.update(ctx, 18, "Frontend logic")
                yield progress_tracker.create_event(
                    ctx, "building_logic", internal_message="Building frontend logic"
                )
                logger.info(f"[{agent_name}] Step 3a: Generating logic artifact")

                await push_prompt_to_next_agent(ctx, logic_input_json)
                async for event in self._run_agent_with_metrics(
                    ctx,
                    self.logic_builder_agent,
                    AgentName.LOGIC_BUILDER.value,
                    metrics_tracker,
                ):
                    yield event

        # ── Step 3b: Backend building (model + handler + seed in parallel) ──
        if backend_needed and self.backend_builder:
            await progress_tracker.update(ctx, 22, "Building backend")
            yield progress_tracker.create_event(
                ctx,
                "building_backend",
                internal_message="Building backend (models, handlers, seed)",
            )
            logger.info(f"[{agent_name}] Step 3b: Running BackendBuilder")

            async for event in self.backend_builder.build_create(
                ctx=ctx,
                backend_plan=app_backend_plan,
                app_context=f"{plan.get('app_name', app_name)} — {app_description[:200]}",
                app_secondary_type=app_secondary_type,
                needs_auth=bool(plan.get("app_security_plan", {}).get("needs_auth", False)),
            ):
                yield event

            backend_result = self.backend_builder.result
            backend_config = backend_result.backend_config
            seed_metadata = backend_result.seed_metadata
            has_handler_build = False  # Handlers already built by BackendBuilder

            ingest_origins = ctx.session.state.get(StateKeys.EXTRACTED_SEED_SOURCE) or {}
            flipped = _flip_ingested_models_to_shared(backend_config, ingest_origins)
            if flipped:
                logger.info(
                    f"[{agent_name}] Flipped ingested models to ownerScope=shared",
                    models=flipped,
                    count=len(flipped),
                )

            # P3 — auto-populate ``enum_values`` from seed CSVs (distinct
            # count in [2, 8]) so the three existing enum validators
            # (check_enum_coverage / FilterEnumCaseMismatchRule /
            # HandlerSqlEnumCaseRule) start firing on seed-derived
            # closed sets the Creator didn't declare. App eiu7xj0v
            # (2026-05-14) regression: orders.status had 6 real values
            # but components only handled 3; once enum_values is set,
            # the validators force exhaustive coverage.
            seed_csvs = await _load_seed_csvs_for_models(ctx, backend_config)
            if seed_csvs:
                populated = sample_enum_values_for_models(backend_config, seed_csvs)
                if populated:
                    logger.info(
                        f"[{agent_name}] Populated enum_values from seed",
                        populated=populated,
                        models=list(populated.keys()),
                    )

            logger.info(
                f"[{agent_name}] BackendBuilder complete",
                models=backend_result.model_count,
                handlers=backend_result.handler_count,
                has_seed=seed_metadata is not None,
            )

        # ── Load artifacts produced by pre-build agents ──
        # In Tailwind v4, all config lives in theme.css (no tailwind.config.js)
        theme_css_check = await ArtifactManager.load_artifact_as_string(
            ctx, "codefocus_style:theme.css"
        )
        if not theme_css_check:
            # DesignSystemBuilder failed to produce theme.css (e.g. hit the
            # contrast-validation retry cap). Record a non-fatal warning and
            # let load_and_persist_theme_palette() derive a palette from the
            # Creator agent's seed colours instead. A cosmetic builder failure
            # should never abort the whole workflow.
            warning_entry = {
                "type": "design_system_warning",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "summary": (
                    "DesignSystemBuilder did not produce theme.css — "
                    "falling back to seed-colour-derived palette"
                ),
                "stage": "DesignSystemBuilder",
            }
            existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
            existing_errors.append(warning_entry)
            await push_session_state_update(
                ctx,
                {StateKeys.AGENT_ERRORS: existing_errors},
            )
            logger.warning(
                f"[{agent_name}] Design system builder did not save theme.css "
                f"artifact — falling back to seed colours"
            )
        try:
            resolved_theme = await load_and_persist_theme_palette(
                ctx,
                fallback_to_seed=True,
            )
        except ThemePaletteResolutionError as e:
            # Both the artifact AND the seed-fallback failed — this is now
            # truly unrecoverable (the Creator agent didn't provide seed
            # colours either). Surface the structured error to the backend so
            # the 409 response can carry it to the user.
            #
            # Log it too. This used to go ONLY to the SSE stream, so the error
            # that terminated the whole build appeared in the browser and
            # nowhere in the container logs — leaving `docker logs` showing a
            # clean run that simply stopped, with nothing to debug from.
            logger.error(
                "theme_palette_resolution_failed",
                error=str(e),
                phase="creation.design_system",
            )
            error_entry = {
                "type": "validation_pipeline_error",
                "timestamp": datetime.now(timezone.utc).isoformat(),
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
            yield progress_tracker.create_event(
                ctx,
                "error",
                internal_message=f"Theme palette resolution failed: {e}",
            )
            return

        headline_font = design_system.get("headline_font") or "Outfit"
        body_font = design_system.get("body_font") or "DM Sans"
        font_urls = [
            f"https://fonts.googleapis.com/css2?family={body_font.replace(' ', '+')}:wght@400;500;600;700&display=swap",
        ]
        if headline_font.lower() != body_font.lower():
            font_urls.append(
                f"https://fonts.googleapis.com/css2?family={headline_font.replace(' ', '+')}:wght@400;500;600;700&display=swap"
            )
        if app_secondary_type != "dataapp":
            font_urls.append(
                "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
            )

        if logic_input_json:
            logic_artifact = await ArtifactManager.load_artifact_as_string(ctx, "logic.json")
            if logic_artifact:
                logic_config = json.loads(logic_artifact)
                logger.info(
                    f"[{agent_name}] Logic artifact loaded",
                    state=len(logic_config.get("state", {})),
                    actions=len(logic_config.get("actions", {})),
                    computed=len(logic_config.get("computed", {})),
                )

        # Pre-compute handler build flag (handlers already built by BackendBuilder)
        if not backend_needed:
            has_handler_build = False

        # ─── Step 4: Generate Components ──────────────────────────────
        await progress_tracker.update(ctx, 30, "Building components")
        yield progress_tracker.create_event(
            ctx, "building_components", internal_message="Building components"
        )
        logger.info(f"[{agent_name}] Step 4: Generating components")

        component_plans = plan.get("component_plans", [])

        # Normalize content-component slugs and guarantee exactly one
        # homepage at ``/`` — narrows the AppRoutes union for tsc and
        # gives MainSidebar/Header components a real ``/`` route to link
        # to instead of resorting to ``"/#dashboard"`` hash anchors.
        _ensure_homepage_content_slug(component_plans)

        # Build logic surface for component builders
        logic_surface = build_logic_surface(logic_config)

        # Build design system context for component builders.
        # On create, the Creator's `design_style` is in scope and gets passed
        # in (used as ephemeral guidance only — never persisted to app_config
        # after this point). Palette + fonts come from theme.css.
        from ..services.design_system_context import build_design_system_context
        from main_agent.services.theme.theme_view import ThemeView

        design_context = build_design_system_context(
            resolved_theme.palette,
            fonts=resolved_theme.fonts,
            design_style=design_system.get("design_style") or [],
            theme_view=ThemeView.from_css(resolved_theme.theme_css or ""),
        )

        # Build app context (page list for navigation)
        app_context = json.dumps(
            {
                "pages": [
                    {"title": cp.get("page_title", ""), "slug": cp.get("page_slug", "")}
                    for cp in component_plans
                    if cp.get("role") == "content"
                ],
                "app_name": plan.get("app_name", app_name),
                "navigation_type": plan.get("navigation_type", "HeaderMenuTop"),
            }
        )

        from ..subagents.component_builder import (
            ComponentBuilderInput,
        )

        # Resolve image UUIDs from catalog to URLs for component builders
        image_catalog = ctx.session.state.get("image_catalog", [])
        image_uuid_to_url = {
            img.get("uuid"): img.get("url")
            for img in image_catalog
            if img.get("uuid") and img.get("url")
        }
        if image_uuid_to_url:
            logger.info(f"[{agent_name}] Image catalog: {len(image_uuid_to_url)} images available")

        # Push validation context so inline tool checks (syntax + semantic)
        # can read backend models, logic, and page slugs from session state.
        # `security_enabled` mirrors the gate in Step 7.1 (config assembly)
        # that wires `app_config.security` — read from the creator plan here
        # because component build/validation runs before assembly. Lets the
        # ``dead_signout`` fixer inject a Sign-Out control into an auth
        # app's sidebar when the LLM omits one.
        await push_session_state_update(
            ctx,
            {
                "_validation_context_models": (backend_config or {}).get("models", []),
                "_validation_context_handlers": (backend_config or {}).get("handlers", []),
                "_validation_context_logic": logic_config or {},
                "_validation_context_security_enabled": bool(
                    (plan.get("app_security_plan") or {}).get("needs_auth")
                ),
                "_validation_context_theme_palette": resolved_theme.palette,
                "_validation_context_page_slugs": [
                    # ``component_plans`` has already been normalized by
                    # ``_ensure_homepage_content_slug`` — every content
                    # slug is a clean route literal starting with ``/``.
                    # Re-run the coerce defensively in case some upstream
                    # path mutated the field after normalization.
                    _route_literal_for_slug(cp.get("page_slug"))
                    for cp in component_plans
                    if cp.get("role") == "content"
                ],
                "_validation_context_services": {},
            },
        )

        # Load handler TSX from artifact storage and publish to the
        # validation context so cross-reference rules
        # (``component.charts.datakey_handler_mismatch`` and friends)
        # can audit producer contracts during component build. The
        # rules fail open when ``handler_sources`` is missing, which
        # silently disabled them in creation mode until 2026-05-13
        # (app ``n1aloggh`` post-mortem). Mirrors the analogous step
        # in ``editing_workflow.py`` after source rehydration.
        try:
            handler_names_for_sources = [
                h.get("name", "")
                for h in (backend_config or {}).get("handlers", []) or []
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

        # Skill selection is now LLM-driven inside ComponentBuilder via the
        # ADK SkillToolset attached to that agent (list_skills + load_skill at
        # inference time). The workflow no longer pre-selects skills.

        # Generate code components.
        # Round-based dispatch through the static slot pool defined in
        # ``component_builder_pool``: chunk component plans into NUM_SLOTS-sized
        # rounds, write per-slot input + expected name into session state, fan
        # the round out through the shared ParallelAgent, then post-process each
        # component's artifact (verify / placeholder / fatal classification).
        # ADK handles branching, event tagging, and session isolation natively.
        component_entries = []
        try:
            cb_model = get_agent_model_name(AgentName.COMPONENT_BUILDER.value)
        except KeyError:
            cb_model = None

        for round_idx, batch in enumerate(chunk_components(component_plans, NUM_SLOTS)):
            active_slots = SLOT_NAMES[: len(batch)]

            # Per-component progress events at round start. Under parallel,
            # all components in the round begin at roughly the same time, so
            # we emit "Building X (n/total)" for each as a pre-anticipation —
            # users see a burst of N progress events at the round boundary.
            for offset, cp in enumerate(batch):
                global_idx = round_idx * NUM_SLOTS + offset
                component_progress = 30 + int(((global_idx + 1) / max(total_components, 1)) * 50)
                await progress_tracker.update(
                    ctx,
                    component_progress,
                    f"Building {cp.get('name', 'component')} ({global_idx + 1}/{total_components})",
                )
                yield progress_tracker.create_event(
                    ctx,
                    "building_component",
                    internal_message=(
                        f"Building {cp.get('name', 'component')} "
                        f"({global_idx + 1}/{total_components})"
                    ),
                )

            # Slot-to-component assignment via state (no ADK input binding).
            ctx.session.state[STATE_EXECUTION_COMPONENTS] = active_slots
            for offset, (slot_name, cp) in enumerate(zip(active_slots, batch)):
                global_idx = round_idx * NUM_SLOTS + offset
                builder_input = await self._build_component_builder_input(
                    ctx,
                    cp,
                    global_idx,
                    design_context=design_context,
                    app_language_code=app_language_code,
                    app_context=app_context,
                    image_uuid_to_url=image_uuid_to_url,
                    backend_config=backend_config,
                    plan=plan,
                    app_secondary_type=app_secondary_type,
                    logic_surface=logic_surface,
                )
                ctx.session.state[slot_input_state_key(slot_name)] = json.dumps(
                    builder_input.model_dump()
                )
                ctx.session.state[slot_expected_name_state_key(slot_name)] = cp.get(
                    "name", f"Component{global_idx}"
                )

            # Round-level metrics tracking. ``record_tokens`` accumulates into
            # the single ``current_agent_tokens`` bucket — under parallel we
            # attribute the whole round to ``component_builder`` (matching the
            # sequential telemetry key). ``stop_agent``'s "agent called multiple
            # times" branch accumulates across rounds.
            if metrics_tracker:
                await metrics_tracker.start_agent(
                    ctx, AgentName.COMPONENT_BUILDER.value, model=cb_model
                )

            try:
                async for event in component_builder_parallel._run_async_impl(ctx):
                    if (
                        metrics_tracker
                        and hasattr(event, "usage_metadata")
                        and event.usage_metadata
                    ):
                        await metrics_tracker.record_tokens(
                            ctx,
                            event.usage_metadata,
                            AgentName.COMPONENT_BUILDER.value,
                        )
                    yield event
            finally:
                if metrics_tracker:
                    await metrics_tracker.stop_agent(ctx)

            # State hygiene: clear per-round keys before the next round so a
            # short final round (e.g. round 3 of 4+4+3) doesn't leave stale
            # entries that an idle slot could see.
            ctx.session.state.pop(STATE_EXECUTION_COMPONENTS, None)
            for slot_name in SLOT_NAMES:
                ctx.session.state.pop(slot_input_state_key(slot_name), None)
                ctx.session.state.pop(slot_expected_name_state_key(slot_name), None)

            # Per-component post-processing (artifact verification, failure
            # classification, placeholder save) at the round boundary.
            # Mirrors the sequential path's break-on-fatal at coarser
            # granularity: the round's siblings ran to completion before we
            # discovered the fatal — accept that wasted work in exchange for
            # simpler control flow (no asyncio cancellation / partial rollback).
            round_has_fatal = False
            for offset, cp in enumerate(batch):
                global_idx = round_idx * NUM_SLOTS + offset
                entry, fatal = await self._post_process_component_result(
                    ctx, cp, agent_name=agent_name, fallback_index=global_idx
                )
                if entry is not None:
                    component_entries.append(entry)
                if fatal:
                    round_has_fatal = True

            if round_has_fatal:
                break

        # ─── Lever A: one-shot retry for no-save'd components ─────────────
        # A ComponentBuilder slot can end its single turn with no save tool
        # call (gemini-3-flash no-save) → no artifact → placeholder. Each slot
        # samples with temperature>0, so re-dispatch is an independent re-roll.
        # Recover what we can BEFORE the partial-ship / abort decision below.
        # UNRESOLVED check first so the `round_has_fatal` read is safe even if
        # the round loop never ran. Skipped on fatal failures (build aborts).
        if (
            COMPONENT_BUILDER_ESCALATION_RETRY
            and ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS)
            and not round_has_fatal
        ):
            async for event in self._retry_unresolved_components(
                ctx,
                component_entries=component_entries,
                code_component_plans=component_plans,
                agent_name=agent_name,
                metrics_tracker=metrics_tracker,
                cb_model=cb_model,
                build_input_kwargs=dict(
                    design_context=design_context,
                    app_language_code=app_language_code,
                    app_context=app_context,
                    image_uuid_to_url=image_uuid_to_url,
                    backend_config=backend_config,
                    plan=plan,
                    app_secondary_type=app_secondary_type,
                    logic_surface=logic_surface,
                ),
            ):
                yield event

        # ─── Lever B: deterministic content salvage ──────────────────────
        # A content page whose body was eager-inlined into ``content_source``
        # but that STILL no-saved after Lever A's re-rolls doesn't need the
        # model — we already hold the copy. Render that markdown into a real
        # component so the page ships its actual content instead of a
        # placeholder. Runs independent of the Lever A retry flag (the
        # eager-inline + no-save can happen with retries disabled too); gating
        # (fatal build / nothing unresolved) lives inside the method so it sees
        # post-Lever-A survivors only.
        await self._salvage_unresolved_content_from_source(
            ctx,
            component_plans=component_plans,
            component_entries=component_entries,
            agent_name=agent_name,
            round_has_fatal=round_has_fatal,
        )

        unresolved_components = dict(ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}))
        if unresolved_components:
            failure_classes = {
                name: detail.get("failure_class")
                for name, detail in ctx.session.state.get(
                    StateKeys.COMPONENT_FAILURE_DETAILS, {}
                ).items()
                if isinstance(detail, dict) and detail.get("failure_class")
            }
            has_fatal = any(is_fatal_component_failure(cls) for cls in failure_classes.values())

            if has_fatal:
                error_entry, assistant_response, conversation_summary = (
                    build_component_generation_failure(
                        unresolved_components,
                        app_description or ctx.session.state.get(StateKeys.USER_PROMPT, ""),
                        failure_classes=failure_classes or None,
                    )
                )
                existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
                existing_errors.append(error_entry)
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
                return

            # Recoverable — placeholders shipped in place of failed components.
            # Record a non-terminal warning and let the workflow keep going
            # through validation, assembly, and backend save.
            warning_entry, assistant_response, conversation_summary = (
                build_component_generation_warning(
                    unresolved_components,
                    failure_classes=failure_classes or None,
                )
            )
            existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
            existing_errors.append(warning_entry)
            await push_session_state_update(
                ctx,
                {
                    StateKeys.AGENT_ERRORS: existing_errors,
                    StateKeys.CHAT_RESPONSE: assistant_response,
                    StateKeys.CONVERSATION_MESSAGE_SUMMARY: conversation_summary,
                },
            )
            logger.warning(
                f"[{agent_name}] {len(unresolved_components)} component(s) shipped as "
                f"placeholders; build continues",
                components=list(unresolved_components.keys()),
            )

        # ─── Final Tailwind compile gate ────────────────────────────────
        # Cross-component step: compiles theme.css + every component
        # together. Deterministic, no LLM — runs deterministic CSS
        # fixers and a single ``tailwindcss`` CLI invocation (~1s).
        from main_agent.services.validation.final_compile_gate import (
            run_final_compile_gate,
        )

        await progress_tracker.update(ctx, 82, "Validating components")
        yield progress_tracker.create_event(
            ctx, "validating", internal_message="Validating components"
        )
        logger.info(f"[{agent_name}] Step 4.5: Final Tailwind compile gate")

        # Load all component sources from artifacts. Babel-shell supporting
        # modules are loaded separately into `module_sources` and merged
        # into the compile-gate inputs further down — they MUST contribute
        # className tokens to Tailwind's scan but MUST NOT participate in
        # the duplicate-content guard, image-placeholder resolution, or
        # any per-component save-back loop (they're only ever bundled into
        # their entry, never round-tripped as standalone components).
        tsx_sources = {}
        for comp_entry in component_entries:
            artifact_key = f"codefocus_component:{comp_entry.name}.tsx"
            source = await ArtifactManager.load_artifact_as_string(ctx, artifact_key)
            if source:
                tsx_sources[comp_entry.name] = source

        module_sources: dict[str, str] = {}
        for comp_entry in component_entries:
            for mod_name in getattr(comp_entry, "supporting_modules", None) or []:
                if mod_name in module_sources:
                    continue
                mod_source = await ArtifactManager.load_artifact_as_string(
                    ctx, f"codefocus_module:{mod_name}.tsx"
                )
                if mod_source:
                    module_sources[mod_name] = mod_source

        # ─── Step 4.5b: Batch validate handler code (safety net) ─────
        has_handler_build = (
            backend_needed and backend_config and len(backend_config.get("handlers", [])) > 0
        )
        if has_handler_build:
            from main_agent.services.validation.fixers import (
                apply_handler_auto_fixes,
                apply_handler_enum_case_fixes,
            )
            from main_agent.services.validation.syntax_validator import validate_tsx_syntax
            from main_agent.services.validation.handler_semantic_validator import (
                run_handler_semantic_checks,
            )

            handler_names = [
                h.get("name", h.get("method", "unknown"))
                for h in backend_config.get("handlers", [])
            ]
            model_names = [
                m.get("name", "") for m in backend_config.get("models", []) if m.get("name")
            ]

            for hname in handler_names:
                handler_artifact = await ArtifactManager.load_artifact_as_string(
                    ctx, f"handler_code:{hname}.tsx"
                )
                if not handler_artifact:
                    logger.warning(f"[{agent_name}] Handler artifact missing: {hname}")
                    continue

                # esbuild is a synchronous subprocess (up to 10s); offload it to a
                # worker thread so this batch loop does not freeze the event loop.
                valid, syntax_errors = await asyncio.to_thread(
                    validate_tsx_syntax, handler_artifact
                )
                if not valid:
                    logger.error(
                        f"[{agent_name}] Handler {hname} failed batch syntax check",
                        errors=syntax_errors[:3],
                    )
                    continue

                fixed_code, fixes = apply_handler_auto_fixes(
                    handler_artifact, model_names=model_names
                )
                # Enum-case rewrite — needs full models with enum_values.
                fixed_code, enum_fixes = apply_handler_enum_case_fixes(
                    fixed_code, backend_config.get("models", [])
                )
                fixes.extend(enum_fixes)
                result = run_handler_semantic_checks(fixed_code, backend_config.get("models", []))

                if not result.valid:
                    logger.error(
                        f"[{agent_name}] Handler {hname} failed batch semantic check",
                        errors=result.errors[:3],
                    )
                elif fixes:
                    # Re-save with auto-fixes applied
                    from google import genai as genai_module

                    code_bytes = fixed_code.encode("utf-8")
                    artifact = genai_module.types.Part.from_bytes(
                        data=code_bytes, mime_type="text/plain"
                    )
                    await ctx.artifact_service.save_artifact(
                        session_id=ctx.session.id,
                        user_id=ctx.session.user_id,
                        app_name=ctx.session.app_name,
                        filename=f"handler_code:{hname}.tsx",
                        artifact=artifact,
                    )
                    logger.info(f"[{agent_name}] Handler {hname} batch-fixed: {fixes}")

        # Detect duplicate component content (context-bleed guard)
        content_hashes: dict[str, str] = {}
        duplicate_components: list[str] = []
        for comp_name, source in tsx_sources.items():
            h = hashlib.sha256(source.encode()).hexdigest()[:16]
            if h in content_hashes:
                logger.error(
                    f"[{agent_name}] Duplicate content detected: "
                    f"{comp_name} is identical to {content_hashes[h]}"
                )
                duplicate_components.append(comp_name)
            else:
                content_hashes[h] = comp_name

        if duplicate_components:
            error_entry = {
                "type": "duplicate_component_content",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "summary": f"Duplicate content in: {', '.join(duplicate_components)}",
                "duplicates": duplicate_components,
            }
            existing_errors = ctx.session.state.get(StateKeys.AGENT_ERRORS, [])
            existing_errors.append(error_entry)
            await push_session_state_update(ctx, {StateKeys.AGENT_ERRORS: existing_errors})

            # Attempt to regenerate each duplicate component (max 1 retry each)
            cp_by_name = {cp.get("name"): cp for cp in component_plans}
            for dup_name in duplicate_components:
                original_name = None
                for h, first_name in content_hashes.items():
                    dup_h = hashlib.sha256(tsx_sources[dup_name].encode()).hexdigest()[:16]
                    if h == dup_h:
                        original_name = first_name
                        break

                cp = cp_by_name.get(dup_name)
                if not cp:
                    logger.warning(
                        f"[{agent_name}] Cannot regenerate {dup_name}: "
                        f"no matching component plan found"
                    )
                    continue

                logger.info(
                    f"[{agent_name}] Regenerating duplicate component {dup_name} "
                    f"(was identical to {original_name})"
                )

                component_image_urls = {}
                for img_uuid in cp.get("image_references", []):
                    url = image_uuid_to_url.get(img_uuid)
                    if url:
                        component_image_urls[img_uuid] = url

                augmented_plan = list(cp.get("building_plan", []))
                augmented_plan.insert(
                    0,
                    (
                        f"IMPORTANT: You previously generated content identical to "
                        f"{original_name}. Generate UNIQUE content for {dup_name} — "
                        f"do NOT reuse code from {original_name}."
                    ),
                )

                retry_content_source, retry_content_artifact = (
                    await self._eager_load_content_source(ctx, cp.get("content_artifact", "") or "")
                )
                retry_input = ComponentBuilderInput(
                    component_name=cp.get("name", dup_name),
                    component_role=cp.get("role", "content"),
                    building_plan=augmented_plan,
                    design_system_context=design_context,
                    app_language_code=app_language_code,
                    output_artifact_name=cp.get("name", dup_name),
                    app_context=app_context,
                    image_urls=(json.dumps(component_image_urls) if component_image_urls else ""),
                    content_artifact=retry_content_artifact,
                    content_source=retry_content_source,
                    backend_surface=build_backend_surface(
                        backend_config,
                        security_plan=plan.get("app_security_plan"),
                        app_secondary_type=app_secondary_type,
                    ),
                    logic_surface=logic_surface,
                )

                await push_session_state_update(
                    ctx, {"_expected_component_name": cp.get("name", dup_name)}
                )
                await push_prompt_to_next_agent(ctx, json.dumps(retry_input.model_dump()))
                async for event in self._run_agent_with_metrics(
                    ctx,
                    self.component_builder_agent,
                    AgentName.COMPONENT_BUILDER.value,
                    metrics_tracker,
                ):
                    yield event

                # Reload and verify the regenerated component
                artifact_key = f"codefocus_component:{dup_name}.tsx"
                new_source = await ArtifactManager.load_artifact_as_string(ctx, artifact_key)
                if new_source:
                    new_h = hashlib.sha256(new_source.encode()).hexdigest()[:16]
                    if new_h in content_hashes and content_hashes[new_h] != dup_name:
                        logger.error(
                            f"[{agent_name}] {dup_name} still duplicate after "
                            f"regeneration (matches {content_hashes[new_h]})"
                        )
                    else:
                        tsx_sources[dup_name] = new_source
                        content_hashes[new_h] = dup_name
                        logger.info(
                            f"[{agent_name}] Successfully regenerated {dup_name} "
                            f"with unique content"
                        )

        # Load theme CSS from artifacts.
        # In Tailwind v4, theme.css contains everything (@import, @theme, :root).
        base_css = await ArtifactManager.load_artifact_as_string(ctx, "codefocus_style:theme.css")
        if not base_css:
            # DesignSystemBuilder produced no theme.css (off-Gemini no-save).
            # The old fallback compiled the bare TAILWIND_BASE_CSS bootstrap —
            # which has NO M3 tokens, so every bg-primary/text-on-surface class
            # ships unstyled AND no theme.css artifact is persisted (the runtime
            # then 404s on /styles/theme.css). Instead, render a coherent
            # seed-palette theme.css and persist it so the app ships styled and
            # deploy materializes theme.css. See theme_palette_service.
            base_css = render_fallback_theme_css()
            from google import genai as genai_module

            fallback_artifact = genai_module.types.Part.from_bytes(
                data=base_css.encode("utf-8"), mime_type="text/css"
            )
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename="codefocus_style:theme.css",
                artifact=fallback_artifact,
            )
            logger.warning(
                f"[{agent_name}] No theme.css artifact — compiling and persisting "
                f"a seed-palette fallback theme so the app ships styled"
            )

        # The compile gate is a deterministic ~1s subprocess call.
        # Run unconditionally — even when some components shipped as stubs
        # from the inline validator, the Tailwind output still needs to
        # compile so the deployed app has CSS. Babel-shell supporting
        # modules ride alongside their entries via synthetic keys so the
        # Tailwind class scanner sees their className tokens; the gate
        # only reads `tsx_sources.values()`, so the synthetic key is
        # purely a uniqueness marker.
        compile_inputs = dict(tsx_sources)
        for mod_name, mod_src in module_sources.items():
            compile_inputs[f"__module__/{mod_name}"] = mod_src
        # The gate shells out to `tailwindcss` (a synchronous subprocess that can
        # run up to 30s). Offload it to a worker thread so it does not freeze the
        # single asyncio event loop (which would stall the /cancel watchdog,
        # /health, and every concurrent build).
        compile_result = await asyncio.to_thread(
            run_final_compile_gate,
            theme_css=base_css,
            tsx_sources=compile_inputs,
        )

        # Persist the rewritten theme.css when deterministic CSS fixers
        # touched it (lifted nested @import/@source/@utility, prepended
        # bootstrap directives, stripped unknown @apply, repaired bare
        # commas — see final_compile_gate for the exact passes).
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
            logger.info(
                f"[{agent_name}] Saved rewritten theme.css "
                f"(deterministic CSS fixers rewrote it)"
            )
            await load_and_persist_theme_palette(
                ctx,
                fallback_to_seed=False,
            )

        # Persist compiled CSS for the R2 upload step.
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
            logger.info(f"[{agent_name}] Saved compiled CSS ({len(css_bytes)} bytes)")

        for w in compile_result.warnings:
            logger.warning(f"[{agent_name}] Compile warning: {w}")
        for f in compile_result.fixes_applied:
            logger.info(f"[{agent_name}] Compile auto-fixed: {f}")

        if not compile_result.success:
            # Tailwind compile failed even after deterministic recovery.
            # Per ship-with-warnings: log the errors, record an entry,
            # but continue the workflow — the deploy pipeline will surface
            # the missing CSS and the user can iterate via the editor.
            logger.error(
                f"[{agent_name}] Final Tailwind compile failed",
                errors=compile_result.fatal_errors[:5],
            )
            error_entry = {
                "type": "tailwind_compile_failed",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "summary": (
                    f"Tailwind compile failed with " f"{len(compile_result.fatal_errors)} error(s)"
                ),
                "errors": compile_result.fatal_errors,
            }
            existing_errors = ctx.session.state.get(StateKeys.AGENT_ERRORS, [])
            existing_errors.append(error_entry)
            await push_session_state_update(ctx, {StateKeys.AGENT_ERRORS: existing_errors})

        # Pattern C: split unresolved-component failures into fatal vs
        # recoverable. Fatal classes (jsx_syntax_error, missing_model,
        # etc.) abort the build. Recoverable classes (validation_failed,
        # forbidden-API issues, contrast warnings) ship as placeholder
        # TSX when ENABLE_PARTIAL_SHIP is on — the saved placeholder
        # artifact already renders a "needs your attention" card so the
        # user gets a deployed app plus a list of components to patch.
        is_partial_ship_run = False
        validation_failures = ctx.session.state.get("validation_failures", {})
        unresolved_components = ctx.session.state.get(StateKeys.UNRESOLVED_COMPONENTS, {})
        all_stubs = {**unresolved_components, **validation_failures}
        if all_stubs:
            failure_detail_map = dict(
                ctx.session.state.get(StateKeys.VALIDATION_FAILURE_DETAILS, {})
            )
            failure_detail_map.update(
                dict(ctx.session.state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {}))
            )
            failure_classes = {
                name: detail.get("failure_class")
                for name, detail in failure_detail_map.items()
                if isinstance(detail, dict) and detail.get("failure_class")
            }

            from main_agent.agents.orchestrator.app_types.webapp.services import (
                partial_ship_service,
            )
            from main_agent.agents.utils.failure_telemetry import emit_outcome

            decision = partial_ship_service.decide(all_stubs, failure_classes)

            if decision.should_abort:
                error_entry, assistant_response, conversation_summary = (
                    build_component_generation_failure(
                        all_stubs,
                        app_description or ctx.session.state.get(StateKeys.USER_PROMPT, ""),
                        failure_classes=failure_classes or None,
                    )
                )
                existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
                existing_errors.append(error_entry)

                logger.error(
                    f"[{agent_name}] Aborting creation: unresolved component generation failures",
                    components=list(all_stubs.keys()),
                    fatal=decision.fatal_components,
                    recoverable=decision.recoverable_components,
                    sources=all_stubs,
                )

                emit_outcome(
                    session_id=ctx.session.id,
                    workflow="creation",
                    outcome="abort",
                    component_count=len(component_plans),
                    fatal_failures=decision.fatal_components,
                    recoverable_failures=decision.recoverable_components,
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
                return

            if decision.ship_partial:
                # All failures are recoverable AND the gating flag is on:
                # placeholder TSX is already saved; surface a warning chat
                # message and continue to assembly + deploy.
                warning_entry, assistant_response, conversation_summary = (
                    build_component_generation_warning(
                        all_stubs,
                        failure_classes=failure_classes or None,
                    )
                )
                existing_errors = list(ctx.session.state.get(StateKeys.AGENT_ERRORS, []))
                existing_errors.append(warning_entry)

                logger.warning(
                    f"[{agent_name}] Partial ship: {len(decision.recoverable_components)} "
                    f"component(s) shipped as placeholders",
                    components=decision.recoverable_components,
                )

                emit_outcome(
                    session_id=ctx.session.id,
                    workflow="creation",
                    outcome="partial_ship",
                    component_count=len(component_plans),
                    recoverable_failures=decision.recoverable_components,
                    failure_classes=failure_classes or None,
                )

                await push_session_state_update(
                    ctx,
                    {
                        StateKeys.AGENT_ERRORS: existing_errors,
                        StateKeys.CHAT_RESPONSE: assistant_response,
                        StateKeys.CONVERSATION_MESSAGE_SUMMARY: conversation_summary,
                    },
                )
                # Mark this run so the success-path `write_result_response`
                # call below knows NOT to overwrite the partial-ship
                # warning chat message + telemetry event. Local variable
                # only — must NOT leak to session state where it would
                # poison subsequent edit workflow runs.
                is_partial_ship_run = True
                # Fall through to Step 5 (image resolution) + assembly.

        # ─── Step 5: Image Resolution ─────────────────────────────────
        # (Step 6 / Seed Data removed — now handled by BackendBuilder)
        from ..services.codefocus_image_resolver import resolve_placeholder_images

        image_catalog = ctx.session.state.get("image_catalog", [])
        app_uuid = ctx.session.state.get("app_uuid", "")

        # ── Image Resolution ──
        await progress_tracker.update(ctx, 84, "Resolving images")
        yield progress_tracker.create_event(
            ctx, "resolving_images", internal_message="Fetching stock images"
        )
        logger.info(f"[{agent_name}] Step 5: Resolving placeholder images")

        pre_resolve_sources = dict(tsx_sources)
        tsx_sources, images_resolved = await resolve_placeholder_images(
            tsx_sources, image_catalog, app_uuid=app_uuid
        )

        if images_resolved > 0:
            logger.info(
                f"[{agent_name}] Resolved placeholder images",
                images_resolved=images_resolved,
            )
            from ..subagents.artifact_tools import save_component_artifact

            for name, updated_tsx in tsx_sources.items():
                if updated_tsx != pre_resolve_sources.get(name):
                    await save_component_artifact(ctx, updated_tsx, name)

        # ─── Step 7: Assemble app_config ──────────────────────────────
        await progress_tracker.update(ctx, 91, "Assembling app")
        yield progress_tracker.create_event(
            ctx, "assembling", internal_message="Assembling app configuration"
        )
        logger.info(f"[{agent_name}] Step 7: Assembling app_config")

        # Pull the final theme.css so assembly can derive defaultTheme from
        # `--color-background` luminance. Defaults to "" — the inferer falls
        # back to "light" when the CSS is missing or unparseable.
        theme_css_for_assembly = (
            await ArtifactManager.load_artifact_as_string(ctx, "codefocus_style:theme.css") or ""
        )

        assembly_context = AssemblyContext(
            app_name=app_name,
            app_alias=app_name.lower().replace(" ", "-"),
            # PreCreator is the single source of truth for app_secondary_type.
            # The Creator plan does not carry this field (see CreatorOutput
            # schema in creator.py); reading it from `plan` silently fell back
            # to "website" for every build, mis-classifying dataapps as
            # websites in the admin UI.
            app_secondary_type=app_secondary_type,
            navigation_type=plan.get("navigation_type", "HeaderMenuTop"),
            font_urls=font_urls,
            components=component_entries,
            backend_config=backend_config,
            logic_config=logic_config,
            favicon_svg=plan.get("app_favicon_svg", ""),
            theme_css=theme_css_for_assembly,
        )

        app_config = self.assembly_service.assemble_app_config(assembly_context)

        # ─── Step 7.1: Wire security config from creator plan ─────────
        security_plan = plan.get("app_security_plan", {})
        if security_plan and security_plan.get("needs_auth"):
            raw_providers = security_plan.get("auth_providers", ["email"]) or []
            normalized_providers = []
            for entry in raw_providers:
                if isinstance(entry, str):
                    normalized_providers.append({"provider": entry})
                elif isinstance(entry, dict) and entry.get("provider"):
                    normalized_providers.append({"provider": entry["provider"]})
            page_access = _reconcile_page_access(
                security_plan.get("page_access", {}),
                component_plans,
                agent_name,
            )
            app_config["security"] = {
                "authProviders": normalized_providers,
                "roles": security_plan.get("roles", []),
                "roleHierarchy": security_plan.get("role_hierarchy", {}),
                "defaultRole": security_plan.get("default_role", ""),
                "defaultAccess": security_plan.get("default_access", "authenticated"),
                "pageAccess": page_access,
                "allowSignup": security_plan.get("allow_signup", True),
            }
            logger.info(
                f"[{agent_name}] Security config wired: "
                f"providers={security_plan.get('auth_providers')}, "
                f"roles={security_plan.get('roles')}"
            )

        # ─── Step 7.5: Inject seed data (D1 routing + static datasets) ─
        if seed_metadata:
            from ...shared.services.config_finalization import inject_seed_routing

            inject_seed_routing(app_config, seed_metadata, backend_config, agent_name)

        # ─── Step 7.55: Prune orphan handlers + model-usage consistency ──
        # A handler is orphan when no component references it via
        # ``useHandler('name')`` or ``useHandler("name")``. The most common
        # cause is the DesignImporter declaring an ``email`` handler for a
        # contact form while ComponentBuilder wires the form to the
        # platform forms endpoint (`fetch('/_forms/submit')`) instead.
        # Orphans compile to dead JS on R2 and create confusion; drop them.
        #
        # Model-usage consistency is warn-only: we flag when a declared
        # model is wired in some pages but not others that reference it
        # in copy. The LLM's decision to keep irregular layouts hardcoded
        # is often legitimate, so we log instead of mutate.
        try:
            from ..services.orphan_handler_pruner import (
                prune_orphan_handlers,
                report_model_usage_consistency,
            )

            pruned = await prune_orphan_handlers(
                ctx,
                app_config,
                component_plans,
                agent_name=agent_name,
            )
            if pruned:
                logger.info(
                    f"[{agent_name}] Pruned orphan handlers",
                    handlers=pruned,
                )

            inconsistent = await report_model_usage_consistency(
                ctx,
                app_config,
                component_plans,
                agent_name=agent_name,
            )
            if inconsistent:
                logger.warning(
                    f"[{agent_name}] Model usage inconsistent across pages",
                    details=inconsistent,
                )
        except Exception:  # noqa: BLE001
            # Never let these post-assembly checks break the workflow —
            # worst case orphan handlers ship (minor inefficiency).
            logger.exception(
                f"[{agent_name}] Orphan-handler / model-consistency check " "raised; continuing"
            )

        # ─── Step 7.6: Cross-validate assembled config ─────────────────
        from ...shared.services.config_finalization import run_cross_validation

        run_cross_validation(app_config, agent_name)

        # ─── Step 8: Post-process ─────────────────────────────────────
        logger.info(f"[{agent_name}] Step 8: Post-processing")
        app_config = self.post_processing_service.process(app_config)

        # ─── Step 9: Save ─────────────────────────────────────────────
        await progress_tracker.update(ctx, 95, "Saving app")
        yield progress_tracker.create_event(ctx, "saving", internal_message="Saving app")
        logger.info(f"[{agent_name}] Step 9: Saving app_config")

        await push_session_state_update(
            ctx,
            {
                "is_app_created": True,
                "is_first_app_creation": True,
                StateKeys.APP_CONFIG: json.dumps(app_config, ensure_ascii=False),
                "app_name": app_name,
                "app_language_code": app_language_code,
                "user_language_code": user_language_code,
                "save_app_config": True,
                "reload_app": True,
            },
        )

        # Write to development output location (if configured)
        app_config_path = ctx.session.state.get(StateKeys.APP_CONFIG_PATH)
        if app_config_path:
            try:
                with open(app_config_path, "w", encoding="utf-8") as f:
                    json.dump(app_config, f, indent=4, ensure_ascii=False)
                logger.info(f"[{agent_name}] App config saved to: {app_config_path}")
            except (IOError, OSError) as e:
                logger.warning(f"[{agent_name}] Could not write config to {app_config_path}: {e}")

        # Build result summary
        backend_summary_parts = []
        if backend_config:
            model_count = len(backend_config.get("models", []))
            handler_count = len(backend_config.get("handlers", []))
            if model_count:
                backend_summary_parts.append(f"{model_count} models")
            if handler_count:
                backend_summary_parts.append(f"{handler_count} handlers")

        result_detail = (
            f"Created app with {len(component_entries)} components, "
            f"{len([c for c in component_entries if c.role == 'content'])} pages, "
            f"using {plan.get('navigation_type', 'HeaderMenuTop')} navigation."
        )
        if backend_summary_parts:
            result_detail += f" Backend: {', '.join(backend_summary_parts)}."

        # Pattern C: skip the success response writer when the run is a
        # partial-ship — the warning chat message set inside the all_stubs
        # branch must survive to the user. write_result_response would
        # otherwise overwrite chat_response with a success-shaped string
        # generated by the response-writer LLM.
        if not is_partial_ship_run:
            # Write result response (include app_building_plan as tasks_done context)
            building_plan_summary = plan.get("app_building_plan", [])
            tasks_done = result_detail
            if building_plan_summary:
                tasks_done += "\n\nPlanning goals:\n" + "\n".join(
                    f"- {b}" for b in building_plan_summary
                )
            async for event in self.write_result_response(
                ctx,
                "creation",
                f"Create a {app_secondary_type} app called '{plan.get('app_name', app_name)}'",
                tasks_done,
            ):
                yield event

        logger.info(
            f"[{agent_name}] Creation workflow complete",
            app_name=plan.get("app_name"),
            components=len(component_entries),
            backend_needed=backend_needed,
            partial_ship=is_partial_ship_run,
        )

        # Pattern G: emit a single success outcome event so the BigQuery
        # sink can compute success-vs-failure rates by skill / flow_skill.
        # ``partial_ship`` outcomes are emitted earlier inside the
        # all_stubs branch; this only fires for clean builds.
        if not is_partial_ship_run:
            from main_agent.agents.utils.failure_telemetry import emit_outcome

            emit_outcome(
                session_id=ctx.session.id,
                workflow="creation",
                outcome="success",
                component_count=len(component_entries),
            )
