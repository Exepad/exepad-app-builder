from google.adk.agents import BaseAgent, LlmAgent
from google.adk.events import Event
from google.adk.agents.invocation_context import InvocationContext
from typing import Any, AsyncGenerator, Optional
import structlog
import json
from ..utils.helpers import (
    push_session_state_update,
    safe_app_config_load,
    find_component_with_location,
    push_prompt_to_next_agent,
    find_page_type_with_uuid,
    find_component_by_uuid,
    parse_result_chat_response,
)
from ..utils.artifact_manager import ArtifactManager
from ..utils.safety_telemetry import log_chat_emission
from .app_types.shared.subagents.app_help_desk import AppHelpDeskInput
from .models import ProgressTracker, MetricsTracker
from .service_registry import ServiceRegistry
from config import AgentName, MAX_REPAIR_ATTEMPTS, MAX_SURVEYOR_ATTEMPTS
from main_agent.constants import StateKeys

from .app_types.webapp.subagents.creator import creator_agent
from .app_types.webapp.subagents.component_builder import (
    component_builder_agent,
)
from .app_types.webapp.subagents.component_builder_multiple import (
    component_builder_multiple_agent,
)
from .app_types.webapp.subagents.design_system_builder import (
    design_system_builder_agent,
)
from .app_types.webapp.subagents.editor import editor_agent
from .app_types.webapp.subagents.pre_creator import pre_creator_agent
from .app_types.webapp.subagents.surveyor import surveyor_agent
from .importers.design_importer import design_importer_agent

from .app_types.shared.services.validation_service import ValidationService

logger = structlog.get_logger(__name__)


def get_terminal_failure_summary(session_state: dict[str, Any]) -> str | None:
    """Return the terminal failure summary for workflows that never saved."""
    # Intentional declines (PreCreator on create, AppHelpDesk on edit
    # refusals) are terminal but NOT build failures — they have their own
    # user-facing message via chat_response and a structured backend status.
    # Skip the failure path so the chat message reaches the user.
    if session_state.get(StateKeys.DECLINE_REASON):
        return None

    workflow_type = session_state.get(StateKeys.WORKFLOW_TYPE, "unknown")
    save_app_config = session_state.get(StateKeys.SAVE_APP_CONFIG, False)
    if save_app_config:
        return None

    agent_errors = session_state.get(StateKeys.AGENT_ERRORS, [])
    for error in agent_errors:
        if not isinstance(error, dict):
            continue
        if error.get("type") in {"component_generation_failed", "validation_pipeline_error"}:
            return error.get("summary") or "Build failed before the app could be saved."

    if workflow_type == "create":
        return "Build failed before the app could be saved."

    return None


def should_emit_chat_message(session_state: dict[str, Any]) -> bool:
    """Terminal workflow failures should end with an error event, not a success chat event."""
    return get_terminal_failure_summary(session_state) is None


# Internal action verbs (as emitted by EditingWorkflow._build_action_summary
# and the creation workflow's tasks_done) translated to user-friendly verbs
# before being shown to the response writer. This is a defense-in-depth layer
# on top of the confidentiality rule loaded into ChatResponseWriter — even if
# the writer were to paraphrase its input, there's no internal vocabulary
# left to paraphrase.
_TASKS_DONE_VERB_MAP: tuple[tuple[str, str], ...] = (
    ("change_backend_models", "updated the data structure"),
    ("modify_page_metadata", "updated page settings"),
    ("modify_component", "updated a section"),
    ("modify_handler", "updated existing logic"),
    ("remove_handler", "removed logic"),
    ("modify_styles", "updated styles"),
    ("modify_logic", "updated app logic"),
    ("add_handler", "added new logic"),
    ("add_page", "added a page"),
    ("remove_page", "removed a page"),
)


def _humanize_tasks_done(tasks_done: str) -> str:
    """Replace internal action verbs with user-friendly equivalents.

    Order-sensitive: longer/compound verbs are listed first so that
    `change_backend_models` is matched before `modify_*` patterns and
    `modify_page_metadata` before `modify_component`.
    """
    if not tasks_done:
        return tasks_done
    out = tasks_done
    for internal, friendly in _TASKS_DONE_VERB_MAP:
        out = out.replace(internal, friendly)
    return out


# Deterministic edit-intent guard. A weak non-Gemini router (e.g. deepseek) can
# mislabel a clear imperative edit COMMAND as "help_desk" (observed live:
# "Add a subtitle 'Track your spending' under the heading" → help_desk, so the
# edit silently never ran). When the message unambiguously reads as an edit
# command — a leading imperative edit verb and NOT a question — we override the
# route to "edit". Conservative by design: questions ("how do I add…?") and
# polite/indirect phrasings are left to the LLM router, so legitimate help_desk
# Q&A is never reclassified.
_EDIT_IMPERATIVE_VERBS = frozenset(
    {
        "add",
        "change",
        "make",
        "update",
        "remove",
        "delete",
        "rename",
        "replace",
        "move",
        "set",
        "swap",
        "create",
        "insert",
        "put",
        "hide",
        "show",
        "edit",
        "adjust",
        "reorder",
        "rearrange",
        "resize",
        "recolor",
        "restyle",
        "fix",
        "center",
        "align",
        "increase",
        "decrease",
        "enlarge",
        "shrink",
        "bold",
        "darken",
        "lighten",
        "turn",
        "wire",
        "connect",
        "link",
    }
)
_QUESTION_PREFIXES = (
    "how ",
    "what ",
    "what's",
    "whats ",
    "why ",
    "when ",
    "where ",
    "who ",
    "which ",
    "can ",
    "could ",
    "should ",
    "would ",
    "is ",
    "are ",
    "do ",
    "does ",
    "did ",
    "will ",
    "may ",
    "might ",
    "explain",
    "tell me",
    # How-to / guidance phrasings that open with an edit verb ("show", "walk")
    # but are questions, not commands. Without these, "Show me how to add ..."
    # would trip the leading-verb check below and force a real edit run.
    "show me",
    "walk me through",
    "let me know",
)

# A leading edit verb followed only by a vague pronoun object ("fix it",
# "change something") is too underspecified to deterministically override the
# router's clarification reply — let the LLM route (and its "what would you
# like me to change?" prompt) stand.
_VAGUE_OBJECTS = frozenset(
    {
        "it",
        "this",
        "that",
        "these",
        "those",
        "them",
        "stuff",
        "something",
        "anything",
        "everything",
        "things",
    }
)


def _looks_like_edit_command(text: str) -> bool:
    """True when ``text`` is unambiguously an imperative edit command.

    Leading edit verb + not phrased as a question + a concrete object. Used only
    to override a ``help_desk`` route to ``edit`` (never the reverse), so false
    negatives are harmless (the LLM route stands) and false positives are
    minimized.
    """
    low = (text or "").strip().lower()
    if not low or low.endswith("?"):
        return False
    if low.startswith(_QUESTION_PREFIXES):
        return False
    words = low.split()
    first = words[0].strip("\"'`.,:;!-")
    if first not in _EDIT_IMPERATIVE_VERBS:
        return False
    rest = [w for w in (w.strip("\"'`.,:;!-") for w in words[1:]) if w]
    if not rest or (len(rest) == 1 and rest[0] in _VAGUE_OBJECTS):
        return False
    return True


# Auth / access-control change requests are configured at the platform level,
# NOT editable via the app editor (see AppHelpDesk's auth routing rule). The
# router parks them in help_desk with ``is_refusal=false`` (a legitimate,
# non-refusal deflection), so the edit-intent override below would otherwise
# reclassify an imperatively-phrased one ("add an admin role") back into edit —
# where the EditingWorkflow has no action that can satisfy it. Exempt them: the
# override only ever converts help_desk -> edit, so a false negative here (a
# genuine edit left in help_desk) is harmless.
_AUTH_ROUTING_TERMS = (
    "log in",
    "login",
    "log-in",
    "sign in",
    "signin",
    "sign-in",
    "sign up",
    "signup",
    "sign-up",
    "authentication",
    "authenticate",
    "password",
    "access control",
    "access-control",
    "permission",
    "permissions",
    "admin role",
    "user role",
    "member role",
    "user roles",
    "who can access",
    "who can view",
    "who can sign in",
    "make it public",
    "make it private",
    "make the app public",
    "make the app private",
    "signed-in users",
    "logged-in users",
    "require login",
    "require sign",
    "require log in",
    "restrict access",
)


def _looks_like_auth_request(text: str) -> bool:
    """True when the message asks to change auth / access-control / roles.

    Those are platform-configured, not editor-editable, so the router sends them
    to help_desk. This guard keeps the imperative edit-intent override from
    dragging such a request ("add an admin role") into the EditingWorkflow.
    """
    low = (text or "").strip().lower()
    if not low:
        return False
    return any(term in low for term in _AUTH_ROUTING_TERMS)


# Decline signals the router can emit when it parks a refusal-worthy prompt in
# the help_desk branch. The bool ``is_refusal`` is the LEAST reliable channel on
# a weak model, so the edit-intent override treats a decline expressed via ANY
# channel as authoritative: it must never reclassify a refusal into an executed
# edit.
_DECLINE_RESPONSE_MARKERS = (
    "i can't",
    "i can’t",
    "i cannot",
    "i can not",
    "i won't",
    "i won’t",
    "i will not",
    "i'm not able",
    "i am not able",
    "i'm unable",
    "i am unable",
    "i don't build",
    "i keep my own internals private",
)
# High-precision markers the router writes into its ``reasoning`` engineering log
# when it declines (every refusal example cites "Refusal § 2.x"). This is the
# independent content screen: it catches a refusal whose ``is_refusal`` bool was
# missed but whose reasoning still records the safety judgment.
_REFUSAL_REASONING_MARKERS = (
    "refusal",
    "§ 2",
    "unsafe content",
    "doorway",
    "meta-request",
    "seo-manipulation",
)


def _router_declined(help_desk_output: dict) -> bool:
    """True if the router signalled a deliberate decline by ANY channel.

    A genuine refusal must always stand, so the edit-intent override is fail-safe:
    it does not fire if the router declined via the ``is_refusal`` bool, the
    ``decline_category``, the user-facing decline prose, OR the reasoning log.
    Relying on ``is_refusal`` alone would let a "branch-right, flag-wrong" miss
    on the same weak router convert a refusal into an executed build.
    """
    if help_desk_output.get("is_refusal"):
        return True
    if (help_desk_output.get("decline_category") or "none") != "none":
        return True
    response = (help_desk_output.get("help_desk_response") or "").lower()
    if any(marker in response for marker in _DECLINE_RESPONSE_MARKERS):
        return True
    reasoning = (help_desk_output.get("reasoning") or "").lower()
    if any(marker in reasoning for marker in _REFUSAL_REASONING_MARKERS):
        return True
    return False


class PipelineOrchestrator(BaseAgent):
    """
    Main pipeline orchestrator for app building workflows.

    Routes requests to workflows for creation and editing.

    Routing Logic (Two-Level):
    1. Direct Actions (action_label): Route based on frontend-specified action
    2. Edit Mode: Run help desk to get branch_label + sub_action
       - branch_label: 'edit', 'help_desk'
       - sub_action: 'quick_remove', 'quick_modify', 'generic_request'
    """

    app_help_desk_agent: LlmAgent
    result_response_writer_agent: LlmAgent

    progress_tracker: Optional[ProgressTracker] = None
    metrics_tracker: Optional[MetricsTracker] = None
    validation_service: Optional[ValidationService] = None
    creation_workflow: Optional[Any] = None
    editing_workflow: Optional[Any] = None
    design_import_workflow: Optional[Any] = None

    model_config = {"arbitrary_types_allowed": True}

    def __init__(
        self,
        name: str,
        app_help_desk_agent: LlmAgent,
        result_response_writer_agent: LlmAgent,
    ):
        super().__init__(
            name=name,
            app_help_desk_agent=app_help_desk_agent,
            result_response_writer_agent=result_response_writer_agent,
        )

        self.progress_tracker = ProgressTracker()
        self.metrics_tracker = MetricsTracker()

        registry = ServiceRegistry.create(
            write_result_response_fn=self._write_result_response,
            emit_chat_directly_fn=self._emit_chat_directly,
            emit_decline_directly_fn=self._emit_decline_directly,
            creator_agent=creator_agent,
            component_builder_agent=component_builder_agent,
            component_builder_multiple_agent=component_builder_multiple_agent,
            design_system_builder_agent=design_system_builder_agent,
            editor_agent=editor_agent,
            pre_creator_agent=pre_creator_agent,
            design_importer_agent=design_importer_agent,
        )

        self.validation_service = registry.validation_service
        self.creation_workflow = registry.creation_workflow
        self.editing_workflow = registry.editing_workflow
        self.design_import_workflow = registry.design_import_workflow

    def _require_editing_workflow(self):
        """Raise early if the editing workflow was not initialized."""
        if self.editing_workflow is None:
            raise RuntimeError(
                "editing_workflow is None — " "editor_agent was not provided during initialization"
            )

    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        async for event in self._main_agent_loop(ctx):
            yield event

    async def _main_agent_loop(self, ctx: InvocationContext):
        logger.info(f"[{self.name}] Starting app building workflow.")

        await self._reset_save_flags(ctx)
        await self.progress_tracker.reset(ctx)
        await self.metrics_tracker.start_workflow(ctx)

        yield self.progress_tracker.create_event(
            ctx, "message", internal_message="Handling request"
        )

        await self._extract_selected_component_config(ctx)

        operation_mode = ctx.session.state.get(StateKeys.OPERATION_MODE)
        action_label = ctx.session.state.get(StateKeys.ACTION_LABEL)
        action_payload = ctx.session.state.get(StateKeys.ACTION_PAYLOAD)
        current_prompt = ctx.session.state.get(StateKeys.CURRENT_PROMPT)

        logger.info(f"[{self.name}] Operation mode: {operation_mode}")
        logger.info(f"[{self.name}] Action label: {action_label}")
        logger.info(f"[{self.name}] Action payload: {action_payload}")

        if operation_mode != "create":
            await push_session_state_update(
                ctx,
                {
                    "initial_app_config_for_comparison": safe_app_config_load(
                        ctx, StateKeys.APP_CONFIG, self.name, "string"
                    )
                },
            )
            logger.info(f"[{self.name}] Initial app config for comparison is set.")

        # =====================================================================
        # ROUTING LOGIC
        # =====================================================================

        if action_label:
            async for event in self._handle_direct_action(
                ctx, action_label, action_payload, current_prompt
            ):
                yield event

        elif operation_mode == "create":
            async for event in self._handle_creation(ctx):
                yield event

        elif operation_mode == "edit":
            async for event in self._handle_edit(ctx, current_prompt):
                yield event

        else:
            logger.error(f"[{self.name}] Unknown operation mode: {operation_mode}")
            yield self.progress_tracker.create_event(
                ctx, "error", internal_message=f"Unknown mode: {operation_mode}"
            )
            yield await self.progress_tracker.create_completion_event(ctx)
            return

        # =====================================================================
        # POST-WORKFLOW: save, notify frontend, complete
        # =====================================================================
        async for event in self._handle_workflow_completion(ctx):
            yield event

    async def _handle_creation(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        """Route creation requests.

        When a ``design_bundle_id`` is present, dispatch to
        :class:`DesignImportWorkflow` (which runs the design-import
        pipeline, then delegates to :class:`CreationWorkflow`, then
        runs FrontendBuildAction cleanup via :class:`EditingWorkflow`).
        Otherwise route directly to the Code Focus creation workflow.
        """
        await push_session_state_update(ctx, {StateKeys.WORKFLOW_TYPE: "create"})
        yield self.progress_tracker.create_event(
            ctx, "creation_mode_starting", internal_message="Starting creation"
        )

        design_bundle_id = ctx.session.state.get(StateKeys.DESIGN_BUNDLE_ID, "")
        if design_bundle_id and self.design_import_workflow is not None:
            logger.info(
                f"[{self.name}] Routing to DesignImportWorkflow "
                f"(design_bundle_id={design_bundle_id})"
            )
            async for event in self.design_import_workflow.execute(
                ctx, self.progress_tracker, self.metrics_tracker
            ):
                yield event
            return

        logger.info(f"[{self.name}] Routing to Code Focus creation workflow")
        async for event in self.creation_workflow.execute(
            ctx, self.progress_tracker, self.metrics_tracker
        ):
            yield event

    async def _handle_edit(
        self, ctx: InvocationContext, current_prompt: str
    ) -> AsyncGenerator[Event, None]:
        """Run help desk routing, then dispatch to the appropriate edit/help_desk branch."""
        yield self.progress_tracker.create_event(
            ctx, "analyzing_request", internal_message="Analyzing request"
        )

        async for event in self._run_help_desk_routing(ctx, current_prompt):
            yield event

        help_desk_output = ctx.session.state.get("app_help_desk_output", {})
        branch_label = help_desk_output.get("branch_label", "edit")
        sub_action = help_desk_output.get("sub_action", "generic_request")
        help_desk_response = help_desk_output.get("help_desk_response", "")
        help_desk_reasoning = help_desk_output.get("reasoning", "")

        # Deterministic edit-intent guard (see _looks_like_edit_command): rescue a
        # clear imperative edit command that a weak router mislabeled as help_desk.
        # Refusals are exempt via _router_declined, which screens EVERY decline
        # channel (bool, category, decline prose, and the reasoning log) — not the
        # is_refusal bool alone — so a refusal can never be reclassified into an
        # executed edit. Never reclassifies the other direction, so legitimate Q&A
        # is untouched.
        if (
            branch_label == "help_desk"
            and not _router_declined(help_desk_output)
            and not _looks_like_auth_request(current_prompt)
            and _looks_like_edit_command(current_prompt)
        ):
            logger.warning(
                f"[{self.name}] Router said help_desk but the message is an "
                f"imperative edit command — overriding to edit",
                prompt_preview=(current_prompt or "")[:80],
            )
            branch_label = "edit"
            sub_action = "generic_request"
            help_desk_response = ""

        logger.info(f"[{self.name}] ========== ROUTING DECISION ==========")
        logger.info(f"[{self.name}] Branch: {branch_label}")
        logger.info(f"[{self.name}] Sub-Action: {sub_action}")
        logger.info(f"[{self.name}] Response: {help_desk_response}")
        if help_desk_reasoning:
            logger.info(f"[{self.name}] Reasoning: {help_desk_reasoning}")
        logger.info(f"[{self.name}] =======================================")

        if branch_label == "help_desk":
            yield self.progress_tracker.create_event(ctx, "help_desk", "Thinking...")

            # AppHelpDesk's `help_desk_response` is already user-ready. Skip
            # the response-writer LLM and emit it directly — one LLM round
            # trip total instead of two.
            #
            # Dispatch on `is_refusal`: refusals carry a decline_category and
            # need the decline-state signal so the backend skips credits and
            # the frontend shows the refusal card. Casual Q&A doesn't.
            if help_desk_output.get("is_refusal"):
                await self._emit_decline_directly(
                    ctx,
                    current_prompt or "",
                    help_desk_response,
                    help_desk_output.get("decline_category", "none"),
                    source_agent="app_help_desk",
                )
            else:
                await self._emit_chat_directly(ctx, current_prompt or "", help_desk_response)

        elif branch_label == "edit":
            yield self.progress_tracker.create_event(
                ctx,
                "app_editing_started",
                internal_message=("Editing" if sub_action == "generic_request" else "Quick action"),
            )

            await push_session_state_update(ctx, {"workflow_type": "edit"})

            # Source rehydration — pull canonical TSX from durable GCS into
            # this session's per-request ADK artifact store BEFORE any agent
            # that needs to read source. Without this step, the Surveyor's
            # ``load_artifacts`` tool returns ``not found`` for every
            # ``codefocus_component:*`` / ``handler_code:*`` lookup (the
            # session-scoped namespace starts empty), and confidence-high
            # diagnostic findings degenerate to ``confidence=low,
            # findings=0``. Bug surfaced 2026-05-08 (tfluo79j morning trace +
            # ky3clhzb pie-chart trace). Idempotent: if the artifact store
            # already contains the file, the GCS read is wasted but
            # harmless. EditingWorkflow.execute() also calls rehydration
            # on its own path for safety; the duplicate is acceptable cost
            # versus the structural risk of forgetting the call here.
            diagnostic_profile = help_desk_output.get("diagnostic_profile", "bug-root-cause")
            # Deterministic Surveyor gating for quick_modify. quick_modify is
            # the scoped trivial path (simple text / color / icon change on a
            # SELECTED component); it always routes through the Editor, which is
            # grounded directly via _format_editor_prompt (existing models +
            # data-upload guard + selected component). The Help Desk was
            # assigning this same edit class inconsistent profiles — 'none' on
            # some turns, a real profile on others (2026-05-20) — which made
            # Surveyor invocation a coin-flip and added ~20s/$0.017 for no
            # benefit on trivial edits. Force-skip the Surveyor here so the
            # behavior is consistent; generic_request still gets its profile.
            if sub_action == "quick_modify":
                diagnostic_profile = "none"
            if sub_action != "quick_remove":
                try:
                    from .app_types.webapp.services.source_rehydration_service import (
                        rehydrate_sources,
                    )

                    pre_config = safe_app_config_load(ctx, StateKeys.APP_CONFIG, self.name, "dict")
                    if isinstance(pre_config, dict):
                        await rehydrate_sources(ctx, pre_config)
                except Exception as pre_rehydrate_err:
                    logger.warning(
                        f"[{self.name}] Pre-Surveyor rehydration failed "
                        f"(non-fatal — Surveyor will fail open): "
                        f"{pre_rehydrate_err}"
                    )

            # Surveyor pre-pass — runs before the Editor on edit-class turns
            # to ground its plan in evidence rather than confabulated names.
            # Skipped on quick_remove (structurally trivial) and on the
            # explicit `none` profile (deterministic ops where investigation
            # would waste an LLM call).
            if sub_action != "quick_remove" and diagnostic_profile != "none":
                async for event in self._run_surveyor(ctx, current_prompt, diagnostic_profile):
                    yield event

            self._require_editing_workflow()
            logger.info(f"[{self.name}] Routing to Code Focus editing workflow")
            async for event in self.editing_workflow.execute(
                ctx,
                self.progress_tracker,
                self.metrics_tracker,
                sub_action=sub_action,
            ):
                yield event

        else:
            logger.warning(f"[{self.name}] Unknown branch_label: {branch_label}")
            yield self.progress_tracker.create_event(
                ctx, "error", internal_message=f"Unknown routing: {branch_label}"
            )

    async def _handle_workflow_completion(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        """Save to backend, send frontend events, and finalize the workflow."""
        failure_summary = get_terminal_failure_summary(ctx.session.state)

        # FAST PATH — terminal failure: yield the user-facing error event
        # BEFORE awaiting the backend callback. Previously the callback
        # (GCS upload + Django POST with 120s × 3 retry) could delay the
        # error event by up to ~6 minutes, manifesting as a "frozen" UI.
        # Backend still gets notified for the DB record; it just no longer
        # gates user feedback.
        if failure_summary:
            yield self.progress_tracker.create_event(ctx, "error", internal_message=failure_summary)
            async for event in self._notify_backend_completion(ctx):
                yield event
            formatted_summary = self.metrics_tracker.format_summary(ctx)
            logger.info(f"[{self.name}] {formatted_summary}")
            logger.info(f"[{self.name}] Workflow completed (terminal failure).")
            return

        # Notify backend of completion and WAIT for database write.
        # Only surface the build-framed "Saving" step when there is actually a
        # config to persist. A conversational (help_desk) turn changes nothing,
        # so "Saving to backend" would mislead the user — but the backend
        # notification itself still runs for bookkeeping.
        if ctx.session.state.get(StateKeys.SAVE_APP_CONFIG):
            await self.progress_tracker.update(ctx, 40, "Saving")
            yield self.progress_tracker.create_event(
                ctx,
                "saving",
                internal_message="Saving to backend",
            )
        async for event in self._notify_backend_completion(ctx):
            yield event
        backend_saved = ctx.session.state.get("_backend_save_result", False)

        if backend_saved and ctx.session.state.get(StateKeys.SAVE_APP_CONFIG):
            reload_app = ctx.session.state.get(StateKeys.RELOAD_APP, False)
            changed_component_uuid = ctx.session.state.get(StateKeys.CHANGED_COMPONENT_UUID)
            change_type = ctx.session.state.get(StateKeys.CHANGE_TYPE)
            changed_page_uuid = ctx.session.state.get(StateKeys.CHANGED_PAGE_UUID)

            changed_component_config = None
            if changed_component_uuid and change_type == "modify":
                app_config = safe_app_config_load(ctx, StateKeys.APP_CONFIG, self.name, "dict")
                if app_config:
                    changed_component_config = find_component_by_uuid(
                        app_config, changed_component_uuid
                    )
                    if changed_component_config:
                        logger.info(
                            f"[{self.name}] Including component config in event for direct update"
                        )
                    else:
                        logger.warning(
                            f"[{self.name}] Could not find component {changed_component_uuid} in config"
                        )

            logger.info(f"[{self.name}] Backend save confirmed, sending app_config_updated event")

            yield self.progress_tracker.create_app_config_updated_event(
                ctx,
                reload_app=reload_app,
                changed_component_uuid=changed_component_uuid,
                change_type=change_type,
                changed_page_uuid=changed_page_uuid,
                changed_component_config=changed_component_config,
            )
        elif ctx.session.state.get(StateKeys.SAVE_APP_CONFIG):
            # Backend save failed: previously this branch logged and moved on,
            # so the chat reply landed but the iframe was never told to
            # reload — same UX as TC-002 from a different cause. Surface the
            # failure as a user-visible error event instead of silently
            # dropping it.
            logger.warning(
                f"[{self.name}] Backend save failed or timed out, "
                "emitting error event instead of app_config_updated"
            )
            yield self.progress_tracker.create_event(
                ctx,
                "error",
                internal_message=(
                    "Couldn't save your changes. The agent finished its work, "
                    "but the preview wasn't updated. Try again in a moment."
                ),
            )

        if should_emit_chat_message(ctx.session.state):
            async for event in self._send_chat_message_to_frontend(ctx):
                yield event

        reload_app = ctx.session.state.get(StateKeys.RELOAD_APP, False)
        if reload_app:
            yield self.progress_tracker.create_page_reload_event(
                ctx, ctx.session.state.get(StateKeys.GOTO_PAGE_SLUG)
            )

        yield await self.progress_tracker.create_completion_event(ctx)

        formatted_summary = self.metrics_tracker.format_summary(ctx)
        logger.info(f"[{self.name}] {formatted_summary}")

        logger.info(f"[{self.name}] Workflow completed.")

    async def _handle_direct_action(
        self, ctx: InvocationContext, action_label: str, action_payload: str, current_prompt: str
    ) -> AsyncGenerator[Event, None]:
        """Handle direct actions from frontend that bypass the help desk."""
        logger.info(f"[{self.name}] ========== DIRECT ACTION ==========")
        logger.info(f"[{self.name}] Action Label: {action_label}")
        logger.info(f"[{self.name}] Action Payload: {action_payload}")
        logger.info(f"[{self.name}] Prompt: {current_prompt[:100] if current_prompt else 'N/A'}")

        action_mapping = {
            "add_contact_info": ("edit", "generic_request"),
        }

        if action_label not in action_mapping:
            logger.warning(f"[{self.name}] Unknown action_label: {action_label}")
            logger.info(f"[{self.name}] =======================================")
            yield self.progress_tracker.create_event(
                ctx, "error", internal_message=f"Unknown action: {action_label}"
            )
            return

        branch_label, sub_action = action_mapping[action_label]

        logger.info(f"[{self.name}] Mapped to Branch: {branch_label}")
        logger.info(f"[{self.name}] Mapped to Sub-Action: {sub_action}")
        logger.info(f"[{self.name}] =======================================")

        await push_session_state_update(
            ctx,
            {
                "app_help_desk_output": {
                    "branch_label": branch_label,
                    "sub_action": sub_action,
                    "reasoning": f"Direct action from frontend: {action_label}",
                }
            },
        )

        yield self.progress_tracker.create_event(
            ctx, "direct_action_started", internal_message=f"Direct action: {action_label}"
        )

        if branch_label == "edit":
            await push_session_state_update(ctx, {"workflow_type": "edit"})
            self._require_editing_workflow()
            logger.info(f"[{self.name}] Direct action routing to Code Focus editing workflow")
            async for event in self.editing_workflow.execute(
                ctx,
                self.progress_tracker,
                self.metrics_tracker,
                sub_action=sub_action,
            ):
                yield event

    async def _run_help_desk_routing(
        self, ctx: InvocationContext, current_prompt: str
    ) -> AsyncGenerator[Event, None]:
        """Run the help desk agent to get routing decision."""
        app_config = safe_app_config_load(ctx, StateKeys.APP_CONFIG, self.name, "dict")
        current_page_uuid = ctx.session.state.get("current_page_uuid")
        current_page_type = find_page_type_with_uuid(app_config, current_page_uuid)
        logger.info(f"[{self.name}] Current page type: {current_page_type}")

        selected_component_config = ctx.session.state.get(StateKeys.SELECTED_COMPONENT_CONFIG)

        if selected_component_config:
            if isinstance(selected_component_config, dict):
                component_str = json.dumps(
                    selected_component_config, separators=(",", ":"), ensure_ascii=False
                )
            else:
                component_str = str(selected_component_config)
        else:
            component_str = ""

        help_desk_input = AppHelpDeskInput(
            user_request=current_prompt or "",
            # Last 5 turns is enough for routing context; longer histories
            # were costing ~1k+ tokens per call without changing the decision.
            chat_history=ctx.session.state.get("chat_history", [])[-5:],
            current_page_type=current_page_type,
            selected_component_config=component_str,
            build_mode="codefocus",
        )

        logger.info(f"[{self.name}] Help desk input: {help_desk_input.model_dump_json()}")

        await push_prompt_to_next_agent(ctx, help_desk_input.model_dump_json())

        async for event in self.validation_service._run_agent_with_retry(
            ctx, self.app_help_desk_agent, AgentName.APP_HELP_DESK.value, MAX_REPAIR_ATTEMPTS
        ):
            yield event

        help_desk_output = ctx.session.state.get("app_help_desk_output", {})

        logger.info(f"[{self.name}] ========== HELP DESK OUTPUT ==========")
        logger.info(f"[{self.name}] Branch Label: {help_desk_output.get('branch_label', 'N/A')}")
        logger.info(f"[{self.name}] Sub Action: {help_desk_output.get('sub_action', 'N/A')}")
        logger.info(f"[{self.name}] Response: {help_desk_output.get('help_desk_response', 'N/A')}")
        logger.info(f"[{self.name}] Reasoning: {help_desk_output.get('reasoning', 'N/A')}")
        logger.info(f"[{self.name}] =======================================")

    async def _run_surveyor(
        self,
        ctx: InvocationContext,
        current_prompt: str,
        diagnostic_profile: str,
    ) -> AsyncGenerator[Event, None]:
        """Run the Surveyor diagnostic pre-pass before the Editor.

        Reads the profile chosen by AppHelpDesk, builds a slim SurveyorInput,
        invokes the Surveyor agent with one retry attempt, and writes the
        DiagnosticReport to ``StateKeys.DIAGNOSTIC_REPORT``. The Editor reads
        that field via ``EditorInput.diagnostic_report`` to ground its plan.

        Failure modes — all degrade gracefully, never block the workflow:

        * **Stubbed components** — when ``_stubbed_components`` has any
          entries, components are placeholders and investigation is wasted.
          Skip the LLM call; write an empty low-confidence report so the
          Editor still gets *something* (the existing stub abort fires
          downstream).
        * **Surveyor LLM error** — fall back to an empty low-confidence
          report. Workflow proceeds; the Editor reverts to its today
          behavior.
        * **Schema validation error** — same as LLM error.
        """
        from .app_types.webapp.subagents.surveyor import (
            SurveyorInput,
            empty_low_confidence_report,
        )

        # Push the profile into session state so surveyor_instruction_provider
        # picks the right SKILL.md, and the turn index so the prompt's "turn N"
        # fact and the after_agent_callback's artifact filename
        # (`diagnostic_report:{N}.json`) stay aligned with the SurveyorInput
        # the LLM receives.
        chat_history_for_index = ctx.session.state.get("chat_history", []) or []
        await push_session_state_update(
            ctx,
            {
                StateKeys.DIAGNOSTIC_PROFILE: diagnostic_profile,
                StateKeys.DIAGNOSTIC_TURN_INDEX: len(chat_history_for_index),
            },
        )

        # Stub baseline guard — if components are stubs, skip investigation.
        stubbed = ctx.session.state.get("_stubbed_components") or []
        if stubbed:
            logger.info(
                f"[{self.name}] Surveyor skipped — stubbed components present",
                count=len(stubbed),
            )
            empty = empty_low_confidence_report(
                profile=diagnostic_profile,  # type: ignore[arg-type]
                symptom=(
                    "Components in this app are placeholders/stubs; the "
                    "Surveyor cannot draw evidence-backed conclusions until "
                    "the stub baseline is resolved."
                ),
                blockers=[f"stubbed_components:{len(stubbed)}"],
            )
            await push_session_state_update(ctx, {StateKeys.DIAGNOSTIC_REPORT: empty.model_dump()})
            return

        yield self.progress_tracker.create_event(
            ctx,
            "investigating",
            internal_message="Investigating before planning",
        )

        # Build the Surveyor's input.
        chat_history = ctx.session.state.get("chat_history", []) or []
        selected_component_name = ctx.session.state.get("selected_component_name", "")
        selected_component_source = ctx.session.state.get("selected_component_source", "")
        current_page_uuid = ctx.session.state.get("current_page_uuid") or ""
        help_desk_reasoning = ctx.session.state.get("app_help_desk_output", {}).get("reasoning", "")
        # Use the slim app_config the Editor will see — same shape, same trim
        # rules. Falls back to the raw config string when the slim helper isn't
        # in scope (e.g. very early sessions).
        try:
            from .app_types.webapp.workflows.editing_workflow import (
                _slim_config_for_editor,
            )

            raw_config = ctx.session.state.get(StateKeys.APP_CONFIG) or "{}"
            if isinstance(raw_config, dict):
                raw_config = json.dumps(raw_config)
            slim_config = _slim_config_for_editor(raw_config)
        except Exception:
            slim_config = ""

        surveyor_input = SurveyorInput(
            user_request=current_prompt or "",
            profile=diagnostic_profile,  # type: ignore[arg-type]
            current_app_config=slim_config,
            selected_component_name=selected_component_name,
            selected_component_source=selected_component_source,
            current_page_uuid=current_page_uuid,
            help_desk_reasoning=help_desk_reasoning,
            chat_history=list(chat_history)[-5:],
            turn_index=len(chat_history),
        )

        await push_prompt_to_next_agent(ctx, surveyor_input.model_dump_json())

        # Run with MAX_SURVEYOR_ATTEMPTS (default 2). The validation_service helper
        # handles 429s, transient errors, and schema-validation failures uniformly
        # — including a malformed/empty DiagnosticReport (is_output_schema_error),
        # which a weak off-Gemini model emits routinely. With only 1 attempt the
        # first bad roll fell straight through to the empty-report fallback below,
        # stripping every off-Gemini edit of diagnostic grounding; a re-roll lets
        # the model self-correct (as proven for the Creator). On terminal failure
        # we still fall through to the empty-report fallback.
        try:
            async for event in self.validation_service._run_agent_with_retry(
                ctx, surveyor_agent, AgentName.SURVEYOR.value, max_attempts=MAX_SURVEYOR_ATTEMPTS
            ):
                yield event
        except Exception as e:
            logger.warning(
                f"[{self.name}] Surveyor agent error — falling back to empty report",
                error=str(e),
                profile=diagnostic_profile,
            )
            empty = empty_low_confidence_report(
                profile=diagnostic_profile,  # type: ignore[arg-type]
                symptom=current_prompt or "Surveyor failed to invoke",
                blockers=[f"surveyor_agent_error: {type(e).__name__}: {e}"],
            )
            await push_session_state_update(ctx, {StateKeys.DIAGNOSTIC_REPORT: empty.model_dump()})
            return

        # If the agent returned but didn't write a report (schema validation
        # failure that didn't raise, or output_key collision), fall back too.
        report = ctx.session.state.get(StateKeys.DIAGNOSTIC_REPORT)
        if not report:
            empty = empty_low_confidence_report(
                profile=diagnostic_profile,  # type: ignore[arg-type]
                symptom=current_prompt or "Surveyor returned no report",
                blockers=["surveyor_no_output"],
            )
            await push_session_state_update(ctx, {StateKeys.DIAGNOSTIC_REPORT: empty.model_dump()})
            return

        logger.info(
            f"[{self.name}] Surveyor report ready",
            profile=report.get("profile") if isinstance(report, dict) else "?",
            confidence=report.get("confidence") if isinstance(report, dict) else "?",
            findings_count=(len(report.get("findings", [])) if isinstance(report, dict) else 0),
        )

    async def _reset_save_flags(self, ctx: InvocationContext):
        await push_session_state_update(
            ctx,
            {
                "save_app_config": False,
                "reload_app": False,
                "is_app_created": False,
                "goto_page_slug": None,
                "chat_response": None,
                "conversation_message_summary": None,
            },
        )

    async def _extract_selected_component_config(self, ctx: InvocationContext):
        selected_uuid = ctx.session.state.get("selected_component")

        if not selected_uuid:
            logger.info(f"[{self.name}] No component selected")
            return

        logger.info(f"[{self.name}] Selected component UUID: {selected_uuid}")

        app_config = safe_app_config_load(ctx, StateKeys.APP_CONFIG, self.name, "dict")

        if not app_config:
            logger.warning(f"[{self.name}] No app config found to search for component")
            return

        component_info = find_component_with_location(app_config, selected_uuid)

        if not component_info:
            logger.warning(
                f"[{self.name}] Component with UUID {selected_uuid} not found in app config"
            )
            await push_session_state_update(
                ctx, {"selected_component_config": None, "selected_component_location": ""}
            )
            return

        component_config = component_info["config"]
        location_type = component_info["location_type"]
        page_uuid = component_info.get("page_uuid")

        logger.info(f"[{self.name}] Found component at location: {location_type}")
        if page_uuid:
            logger.info(f"[{self.name}] Component belongs to page: {page_uuid}")

        # Derive component name from CodeComponentProps config
        component_name = component_config.get("component", "")

        session_update = {
            "selected_component_config": component_config,
            "selected_component_location": location_type,
        }
        if component_name:
            session_update["selected_component_name"] = component_name
            # Load TSX source so editor agent can see what it's modifying
            source = await ArtifactManager.load_artifact_as_string(
                ctx, f"codefocus_component:{component_name}.tsx"
            )
            if source:
                session_update["selected_component_source"] = source

        if page_uuid:
            session_update["current_page_uuid"] = page_uuid
        elif location_type == "page":
            session_update["current_page_uuid"] = selected_uuid
        else:
            session_update["current_page_uuid"] = ""

        await push_session_state_update(ctx, session_update)

    async def _emit_chat_directly(
        self, ctx: InvocationContext, user_request: str, response_text: str
    ) -> None:
        """Skip the response-writer LLM and post `response_text` straight to chat.

        Used when an upstream agent (AppHelpDesk's `help_desk_response`,
        PreCreator's `decline_reason`) has already produced user-ready text.
        Writes the same session-state keys ResultResponseWriter would have,
        so the existing `_send_chat_message_to_frontend` step still finds
        `chat_response` and emits it to the user — no plumbing change.
        """
        summary = {
            "user_ask": user_request,
            "assistant_action_and_response": response_text,
        }
        await push_session_state_update(
            ctx,
            {
                "chat_response": response_text,
                "conversation_message_summary": summary,
                "current_prompt": user_request,
            },
        )
        log_chat_emission(
            response_text,
            source_agent="app_help_desk",
            session_id=getattr(ctx.session, "id", None),
            user_prompt=user_request,
        )
        logger.info(f"[{self.name}] Direct chat emit (no writer LLM). Response: {response_text}")

    async def _emit_decline_directly(
        self,
        ctx: InvocationContext,
        user_request: str,
        decline_reason: str,
        decline_category: str,
        source_agent: str = "pre_creator",
    ) -> None:
        """Same as _emit_chat_directly, plus the decline-state signal.

        Downstream classifiers (`get_terminal_failure_summary`,
        `BackendNotificationService`) read `StateKeys.DECLINE_REASON` to
        distinguish a deliberate refusal from a build failure: declines
        skip credit deduction, suppress the build-failed UX, and trigger
        a soft-delete of the just-spawned App row on the create flow.

        ``source_agent`` is used only for safety-telemetry tagging so
        chat_safety_leak warnings are aggregable per-gate (PreCreator vs
        AppHelpDesk). Default matches the most common call site (create
        flow); the help_desk dispatch overrides to "app_help_desk".
        """
        summary = {
            "user_ask": user_request,
            "assistant_action_and_response": decline_reason,
        }
        await push_session_state_update(
            ctx,
            {
                "chat_response": decline_reason,
                "conversation_message_summary": summary,
                "current_prompt": user_request,
                StateKeys.DECLINE_REASON: decline_reason,
                StateKeys.DECLINE_CATEGORY: decline_category,
            },
        )
        log_chat_emission(
            decline_reason,
            source_agent=source_agent,
            session_id=getattr(ctx.session, "id", None),
            user_prompt=user_request,
        )
        logger.info(
            f"[{self.name}] Decline emitted (no writer LLM). "
            f"category={decline_category!r} response={decline_reason!r}"
        )

    async def _write_result_response(
        self, ctx: InvocationContext, operation_type: str, user_request: str, tasks_done: str
    ) -> AsyncGenerator[Event, None]:
        logger.info(f"[{self.name}] Writing result response for {operation_type}")

        # operation_type is kept for telemetry/logging only — it is no longer
        # surfaced to the response-writer LLM, which previously paraphrased
        # it (e.g. "I routed your request through the editing workflow…").
        humanized_tasks = _humanize_tasks_done(tasks_done)

        tasks_done_prompt = f"""## User Request
{user_request}

## Tasks Completed
{humanized_tasks}

## Language
{ctx.session.state.get(StateKeys.USER_LANGUAGE_CODE, "en")}"""

        await push_session_state_update(
            ctx,
            {"result_response_writer_prompt": tasks_done_prompt, "current_prompt": user_request},
        )

        async for event in self.validation_service._run_agent_with_retry(
            ctx,
            self.result_response_writer_agent,
            AgentName.RESULT_RESPONSE_WRITER.value,
            MAX_REPAIR_ATTEMPTS,
        ):
            yield event

        full_output = ctx.session.state.get(StateKeys.RESULT_CHAT_RESPONSE)
        chat_response, conversation_summary = parse_result_chat_response(full_output)

        await push_session_state_update(
            ctx,
            {"chat_response": chat_response, "conversation_message_summary": conversation_summary},
        )

        log_chat_emission(
            chat_response,
            source_agent="chat_response_writer",
            session_id=getattr(ctx.session, "id", None),
            user_prompt=user_request,
        )

        logger.info(
            f"[{self.name}] Result response written successfully. Response: {chat_response}"
        )

    async def _send_chat_message_to_frontend(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        chat_response = ctx.session.state.get(StateKeys.CHAT_RESPONSE, "")
        if chat_response:
            yield self.progress_tracker.create_chat_message_event(ctx, chat_response)
        else:
            logger.warning(f"[{self.name}] No chat response found in session state")
            return

    async def _notify_backend_completion(
        self, ctx: InvocationContext
    ) -> AsyncGenerator[Event, None]:
        from .app_types.shared.services.backend_notification_service import (
            BackendNotificationService,
        )

        service = BackendNotificationService()
        async for event in service.notify_completion(
            ctx, self.metrics_tracker, self.progress_tracker
        ):
            yield event
