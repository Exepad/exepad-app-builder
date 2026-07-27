"""Surveyor — read-only grounding agent for edit-mode workflows.

Runs sequentially before the Editor on edit-class turns. Produces a
structured :class:`DiagnosticReport` that the Editor consumes as input,
so plans are grounded in evidence rather than confabulated from names.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Literal

import structlog
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.planners import BuiltInPlanner
from google.adk.tools import load_artifacts
from google.genai import types
from pydantic import BaseModel, Field, field_validator, model_validator

from config import AgentName, get_agent_model
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder
from google.adk.tools.skill_toolset import SkillToolset

from main_agent.agents.utils.skills import load_diagnostic_skills
from main_agent.agents.utils.thought_signature_fix import (
    strip_thinking_from_response,
    strip_thinking_metadata,
)
from main_agent.constants import ProfileLiteral, StateKeys

# Phase 2 runtime probes — gated on SURVEYOR_RUNTIME_PROBES_ENABLED so
# the dark-ship state ships zero behavior change.
try:
    from config import SURVEYOR_RUNTIME_PROBES_ENABLED
except ImportError:  # pragma: no cover — defensive for partial installs
    SURVEYOR_RUNTIME_PROBES_ENABLED = False

from .artifact_tools import (
    describe_artifact_tool,
    discover_dependencies_tool,
    find_symbol_references_tool,
    inspect_app_state_tool,
    list_artifacts_tool,
    search_artifacts_tool,
)
from .surveyor_tools import (
    SURVEYOR_CLASS_B_TOOLS,
    code_revision_diff_tool,
    field_mismatch_report_tool,
    infer_consumer_field_reads_tool,
    infer_handler_return_shape_tool,
    prior_turn_diagnosis_tool,
    prior_turn_diff_tool,
)


logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Input schema
# ---------------------------------------------------------------------------


class SurveyorInput(BaseModel):
    """What the Surveyor sees when invoked.

    Mirrors a slim subset of :class:`EditorInput` so the Surveyor's
    investigation has the same context the Editor will plan against —
    user request, current page, selected component, dependency-map signal.
    """

    user_request: str = Field(
        description="The user's current edit/fix request (this turn's prompt)."
    )
    profile: ProfileLiteral = Field(
        description=(
            "Investigation profile chosen by AppHelpDesk: bug-root-cause "
            "(fix-class), integration-context (add-class), "
            "referent-and-current-state (this/that-class), "
            "cascade-enumeration (rename/restructure-class), or none."
        )
    )
    current_app_config: str = Field(
        default="",
        description=(
            "Slim JSON of the current app config (page list, component names, "
            "model + handler names — no source code or compiled paths). "
            "Reuses the same slim-config shape Editor sees."
        ),
    )
    selected_component_name: str = Field(default="")
    selected_component_source: str = Field(default="")
    current_page_uuid: str = Field(default="")
    help_desk_reasoning: str = Field(
        default="",
        description=(
            "AppHelpDesk's routing reasoning. Surfaces the LLM's intent "
            "classification so the Surveyor's profile-specific prompt can "
            "anchor on it without re-deriving."
        ),
    )
    chat_history: list[str] = Field(
        default_factory=list,
        max_length=10,
        description="Recent conversation summaries for diagnostic continuity.",
    )
    turn_index: int = Field(
        default=0,
        ge=0,
        description=(
            "Edit-turn counter, used as the suffix when persisting "
            "``diagnostic_report:{turn_index}.json`` for cross-turn lookup."
        ),
    )


# ---------------------------------------------------------------------------
# Output schema — DiagnosticReport
# ---------------------------------------------------------------------------


class Evidence(BaseModel):
    """One piece of evidence backing a finding.

    Every claim with ``severity="root_cause"`` MUST attach at least one
    ``Evidence`` record citing the tool that produced the observation
    and a short excerpt. This is the structural defense against
    confabulation: claims without evidence don't validate.
    """

    tool: str = Field(
        description=(
            "Name of the diagnostic tool that produced this observation, "
            "e.g. 'field_mismatch_report_tool', 'load_artifacts_tool', "
            "'prior_turn_diff_tool'. Free-form so Phase 2 runtime probes "
            "fit without schema change."
        )
    )
    args: dict = Field(
        default_factory=dict,
        description="Arguments passed to the tool, for reproducibility.",
    )
    excerpt: str = Field(
        default="",
        max_length=2000,
        description=(
            "Quoted slice of the tool's result — the specific lines / fields "
            "that support the finding. Truncate to ≤2000 chars."
        ),
    )
    location: str = Field(
        default="",
        description=(
            "Source location anchor: ``artifact:line:col``, "
            "``model:column``, ``session_state:key``, or empty if not "
            "applicable. Editor renders this as a clickable link in its "
            "reasoning."
        ),
    )


_FINDING_SEVERITY = Literal["root_cause", "contributing", "context", "warning"]


class Finding(BaseModel):
    """One factual claim about the app's state.

    ``severity`` semantics:

    * ``root_cause`` — explains the symptom directly. MUST have evidence
      and at least one affected entity. The Editor treats these as
      load-bearing facts.
    * ``contributing`` — related but not the proximate cause (e.g. a
      handler is correct but uses a misleading name). Editor weighs
      these as advisory.
    * ``context`` — situational facts (current state, user intent
      restated). No action implied.
    * ``warning`` — defects unrelated to the user's request that the
      Surveyor noticed in passing. Editor surfaces in reasoning but
      does not act on.
    """

    statement: str = Field(
        description=(
            "Concise factual claim. E.g. 'Handler `getOccupancyTrend` "
            "returns field `percentage`; consumer `DashboardContent` "
            "reads `dataKey=\"rate\"`.'"
        )
    )
    severity: _FINDING_SEVERITY
    evidence: list[Evidence] = Field(
        default_factory=list,
        description=(
            "Backing observations. Required (>=1) when severity='root_cause'; "
            "the DiagnosticReport-level model_validator enforces this. "
            "We deliberately avoid a field-level min_length=1 because "
            "Vertex's output_schema JSON-Schema generation can choke on "
            "min_items constraints (cf. AppHelpDeskOutput.decline_category)."
        ),
    )
    affected_entities: list[str] = Field(
        default_factory=list,
        description=(
            "Component / handler / model names involved in this finding. "
            "Required (non-empty) when severity='root_cause'."
        ),
    )


_RESOLUTION_SHAPE = Literal[
    "none",
    "add_field_to_handler",
    "rename_field_in_consumer",
    "both_sides_paired",
    "remove_dead_field",
    "add_neighbor_pattern",
    "restyle_referent",
    "rename_with_cascade",
    "unknown",
]


_CONFIDENCE = Literal["high", "medium", "low"]


class DiagnosticReport(BaseModel):
    """Surveyor output — what the Editor consumes via ``EditorInput.diagnostic_report``.

    The schema is forward-compatible with Phase 2 (runtime probes):
    ``Evidence.tool`` accepts arbitrary tool names, ``reproduction`` is
    free-form, and ``Finding.severity`` covers runtime-observed bugs as
    well as static ones.
    """

    profile: ProfileLiteral
    symptom: str = Field(
        description=(
            "Restate the user's complaint in concrete terms ('the chart "
            "shows no data points' rather than 'broken'). One sentence."
        )
    )
    reproduction: str = Field(
        default="",
        max_length=4000,
        description=(
            "Steps to reproduce, when known. Free-form text — Phase 2 will "
            "populate this with runtime-probe traces (e.g. 'execute_handler "
            "getOccupancyTrend(days=30) → []'). Empty in Phase 1 unless "
            "static analysis can suggest steps."
        ),
    )
    findings: list[Finding] = Field(default_factory=list)
    suggested_resolution_shape: _RESOLUTION_SHAPE = Field(
        default="unknown",
        description=(
            "Shape of the fix the Editor should plan. Constrains action "
            "choice: 'both_sides_paired' demands a paired ModifyHandler + "
            "FrontendBuildAction; 'rename_with_cascade' demands a "
            "FrontendBuildAction with consumer cleanup; 'none' means no "
            "fix is needed (the user might have asked about expected "
            "behavior)."
        ),
    )
    suggested_resolution_prose: str = Field(
        default="",
        max_length=2000,
        description=(
            "Plain-English description of the recommended fix the Editor "
            "should apply. Specific to the findings; the Editor uses this "
            "as the seed for its action prompts."
        ),
    )
    confidence: _CONFIDENCE = Field(
        description=(
            "Surveyor's overall confidence in its findings + resolution "
            "shape. 'low' is valid and preferred over confabulation — the "
            "Editor falls back to today's behavior on low confidence "
            "while still surfacing the report contents in its reasoning."
        )
    )
    blockers: list[str] = Field(
        default_factory=list,
        description=(
            "Things that prevented higher confidence. E.g. 'tool budget "
            "exhausted', 'handler source not in artifact set', "
            "'referent ambiguous between component A and B'. Used by the "
            "Editor and downstream observers to understand the gap."
        ),
    )

    # --- Validators -------------------------------------------------------

    @field_validator("symptom")
    @classmethod
    def _symptom_non_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("symptom must be non-empty — restate the user's complaint")
        return v

    @model_validator(mode="after")
    def _root_cause_findings_need_evidence_and_entities(self) -> "DiagnosticReport":
        for i, f in enumerate(self.findings):
            if f.severity != "root_cause":
                continue
            if not f.evidence:
                raise ValueError(
                    f"findings[{i}] has severity='root_cause' but no evidence — "
                    f"every root_cause claim must cite at least one tool observation"
                )
            if not f.affected_entities:
                raise ValueError(
                    f"findings[{i}] has severity='root_cause' but no "
                    f"affected_entities — name the components/handlers/models involved"
                )
        return self

    @model_validator(mode="after")
    def _low_confidence_or_findings(self) -> "DiagnosticReport":
        # If confidence is 'high' or 'medium' there must be at least one finding.
        # 'low' confidence with empty findings is the explicit "I couldn't conclude"
        # graceful-degrade state and is allowed.
        if self.confidence in ("high", "medium") and not self.findings:
            raise ValueError(
                f"confidence='{self.confidence}' but findings is empty — "
                f"set confidence='low' when no findings could be established"
            )
        return self


# ---------------------------------------------------------------------------
# Empty-report factory (used by core._run_surveyor on agent failure or
# stub-baseline-skip)
# ---------------------------------------------------------------------------


def empty_low_confidence_report(
    profile: ProfileLiteral,
    symptom: str,
    blockers: list[str],
) -> DiagnosticReport:
    """Build a minimal low-confidence report for graceful-degrade paths.

    Used by ``core._run_surveyor`` when the Surveyor agent errors out, when
    components are stubbed (so investigation is wasted), or when the
    Surveyor returns a malformed report. Editor reads this and falls back
    to today's no-grounding behavior.
    """
    return DiagnosticReport(
        profile=profile,
        symptom=symptom or "Surveyor was unable to investigate.",
        reproduction="",
        findings=[],
        suggested_resolution_shape="unknown",
        suggested_resolution_prose="",
        confidence="low",
        blockers=blockers,
    )


# ---------------------------------------------------------------------------
# Helper: serialize report for EditorInput.diagnostic_report (JSON string)
# ---------------------------------------------------------------------------


def report_to_editor_input(report: DiagnosticReport | None) -> str:
    """Serialize a report (or ``None``) to the JSON string the Editor expects.

    The Editor's ``EditorInput.diagnostic_report`` is a string field — the
    LLM sees JSON-serialised content. ``None`` collapses to empty string,
    which the Editor interprets as "Surveyor was skipped".
    """
    if report is None:
        return ""
    return report.model_dump_json()


# Re-exported timestamp for instruction providers that want a "current date"
# tail (matches the editor.py pattern). Imported here to avoid forcing
# every caller to import datetime.
def _current_date() -> str:
    return datetime.now().strftime("%Y-%m-%d")


# ---------------------------------------------------------------------------
# Instruction provider — loads 00_OVERVIEW.md (always) + the profile-specific
# SKILL.md (per AppHelpDesk's classification)
# ---------------------------------------------------------------------------


_INVOCATION_TAIL = """
## INVOCATION CONTEXT

Today's date: {current_date}
Active diagnostic profile: **{profile}**
Edit turn index: {turn_index}

Generate the `symptom`, `findings`, `suggested_resolution_shape`,
`suggested_resolution_prose`, `confidence`, and `blockers` fields
in your DiagnosticReport. Every `severity: "root_cause"` finding MUST
cite at least one Evidence record from a tool call you actually made.

You are NOT planning actions. You are NOT writing code. You are gathering
evidence so the Editor — which runs after you and otherwise confabulates
source-level facts from names — can plan against ground truth.
"""


_SKILL_DIRECTIVE_TEMPLATE = """\
## ACTIVE PROFILE — LOAD YOUR SKILL FIRST

AppHelpDesk has selected `profile = "{profile}"`. The corresponding
diagnostic SKILL.md is registered with your `SkillToolset` under the
same name. Before issuing any other tool call:

1. Call `load_skill(skill_name="{profile}")` and read the body
   end-to-end.
2. If that skill body directs you to read `references/<file>`, call
   `load_skill_resource(skill_name="{profile}", file_path="references/<file>")`.

Treat the loaded skill body as the authoritative methodology + tool
budget for this turn — it overrides any conflicting guidance in the
overview above. Do not start sweeping the artifact set until the
skill is loaded.
"""


def surveyor_instruction_provider(context: ReadonlyContext) -> str:
    """Build the Surveyor's prompt: base overview + load_skill directive.

    Reads ``StateKeys.DIAGNOSTIC_PROFILE`` from session state to tell the
    LLM which diagnostic SKILL.md to ``load_skill`` first. Defaults to
    ``bug-root-cause`` (the most thorough profile) when the profile
    field is missing.

    Skill bodies are NOT inlined in the prompt anymore — the Surveyor
    has a ``SkillToolset`` attached and the LLM pulls the skill on
    demand via the ``load_skill`` tool. This keeps the static prompt
    cache-stable across profiles.
    """
    profile_raw = context.state.get(StateKeys.DIAGNOSTIC_PROFILE) or "bug-root-cause"
    # Defensive: schema enforces hyphenated values, but a stale session-state
    # write could produce something unexpected. Coerce to a known profile.
    if profile_raw == "none":
        # The orchestrator should have skipped Surveyor — but if we got here
        # anyway, fall back to bug-root-cause and log a warning.
        logger.warning(
            "[Surveyor] invoked with profile='none'; falling back to bug-root-cause"
        )
        profile_raw = "bug-root-cause"

    # Read the canonical turn index that core._run_surveyor pushed to state
    # before invocation. Falls back to chat_history length, then 0, so the
    # prompt never silently shows "turn 0" when the orchestrator forgot to
    # write the key.
    turn_index = context.state.get(StateKeys.DIAGNOSTIC_TURN_INDEX)
    if turn_index is None:
        chat_history_state = context.state.get(StateKeys.CHAT_HISTORY)
        turn_index = (
            len(chat_history_state) if isinstance(chat_history_state, list) else 0
        )

    return (
        InstructionBuilder()
        # Always-loaded base — output schema, evidence rules, methodology.
        .add_doc("diagnostic/docs/00_OVERVIEW.md")
        # Tell the LLM which SkillToolset entry to load first.
        .add(_SKILL_DIRECTIVE_TEMPLATE.format(profile=profile_raw))
        # Per-invocation tail — date, profile, turn index, role recap.
        .add(
            _INVOCATION_TAIL.format(
                current_date=_current_date(),
                profile=profile_raw,
                turn_index=turn_index,
            )
        )
        .build()
    )


_DIAGNOSTIC_REPORT_ARTIFACT_PREFIX = "diagnostic_report:"
_DIAGNOSTIC_REPORT_ARTIFACT_SUFFIX = ".json"


def _diagnostic_report_artifact_name(turn_index: int) -> str:
    """Filename used by both the writer (after_agent_callback) and the reader
    (``prior_turn_diagnosis_tool``). Keeping this in one place avoids the
    silent no-op that hits when those two key formulas drift apart.
    """
    return (
        f"{_DIAGNOSTIC_REPORT_ARTIFACT_PREFIX}{int(turn_index)}"
        f"{_DIAGNOSTIC_REPORT_ARTIFACT_SUFFIX}"
    )


async def persist_diagnostic_report(
    callback_context: CallbackContext,
) -> None:
    """Write the just-produced ``DiagnosticReport`` to the session artifact
    bucket as ``diagnostic_report:{turn_index}.json``.

    ``output_key`` only writes to *session state*, which is in-memory and
    not visible to ``prior_turn_diagnosis_tool``'s ``list_artifacts`` call.
    Without this callback the prior-turn lookup is structurally impossible —
    the writer never produces what the reader scans for.

    Fail-soft: any exception is logged and swallowed. A persistence failure
    must not abort the edit turn — the Editor still has the in-state report.
    """
    try:
        report = callback_context.state.get(StateKeys.DIAGNOSTIC_REPORT)
        if not report:
            # Surveyor failed and the orchestrator's empty-report fallback
            # may still write later; persisting an absent report would
            # produce a confusing artifact for prior_turn_diagnosis to
            # surface. Skip silently.
            return

        turn_index = callback_context.state.get(StateKeys.DIAGNOSTIC_TURN_INDEX)
        if turn_index is None:
            chat_history_state = callback_context.state.get(StateKeys.CHAT_HISTORY)
            turn_index = (
                len(chat_history_state) if isinstance(chat_history_state, list) else 0
            )
        turn_index = int(turn_index)

        payload = json.dumps(report) if isinstance(report, dict) else str(report)
        artifact = types.Part.from_bytes(
            data=payload.encode("utf-8"), mime_type="application/json"
        )
        filename = _diagnostic_report_artifact_name(turn_index)
        version = await callback_context.save_artifact(
            filename=filename, artifact=artifact
        )
        logger.info(
            "[Surveyor] persisted diagnostic report artifact",
            filename=filename,
            version=version,
            turn_index=turn_index,
        )
    except Exception as e:  # noqa: BLE001 — soft-fail by contract
        logger.warning(
            "[Surveyor] failed to persist diagnostic report artifact",
            error=str(e),
            error_type=type(e).__name__,
        )


# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------


# Read-only tool surface — 12 total.
#
# 7 existing ADK tools (re-used from artifact_tools.py / load_artifacts):
#   list_artifacts, search_artifacts, describe_artifact, find_symbol_references,
#   discover_dependencies, inspect_app_state, load_artifacts
# 5 new diagnostic tools (surveyor_tools.py):
#   infer_handler_return_shape, infer_consumer_field_reads, field_mismatch_report,
#   prior_turn_diff, prior_turn_diagnosis
#
# All deterministic except `load_artifacts` (which is just I/O). No write
# tools — by design. The Surveyor cannot mutate any artifact or session state
# beyond its own output_key. The instruction prompt enforces per-profile
# tool budgets at the LLM level.
SURVEYOR_TOOLS = [
    # General artifact / dependency-graph tools.
    list_artifacts_tool,
    search_artifacts_tool,
    describe_artifact_tool,
    find_symbol_references_tool,
    discover_dependencies_tool,
    inspect_app_state_tool,
    load_artifacts,
    # Diagnostic tools specific to the Surveyor (Class A — always on).
    infer_handler_return_shape_tool,
    infer_consumer_field_reads_tool,
    field_mismatch_report_tool,
    prior_turn_diff_tool,
    prior_turn_diagnosis_tool,
    code_revision_diff_tool,
]


# Class B runtime probes — only present when the feature flag is on.
# Read at module import time. Cycling the flag requires an agent restart
# so the LlmAgent's tool list and system_instruction stay in lockstep.
_CLASS_B_TOOLS = SURVEYOR_CLASS_B_TOOLS if SURVEYOR_RUNTIME_PROBES_ENABLED else []


# Diagnostic SkillToolset — built once. The LLM calls list_skills /
# load_skill / load_skill_resource at inference time; the workflow
# tells it which profile via the static instruction tail.
_DIAGNOSTIC_SKILL_TOOLSET = SkillToolset(skills=load_diagnostic_skills())


surveyor_agent = LlmAgent(
    name=AgentName.SURVEYOR,
    model=get_agent_model(AgentName.SURVEYOR),
    description=(
        "Read-only grounding agent. Investigates the current app state and "
        "produces a structured DiagnosticReport that the Editor consumes "
        "as input. Loads a profile-specific SKILL.md per AgentSkills.io spec "
        "based on AppHelpDesk's classification (bug-root-cause / "
        "integration-context / referent-and-current-state / cascade-enumeration)."
    ),
    instruction=surveyor_instruction_provider,
    input_schema=SurveyorInput,
    output_schema=DiagnosticReport,
    output_key=StateKeys.DIAGNOSTIC_REPORT,
    before_model_callback=strip_thinking_metadata,
    after_model_callback=strip_thinking_from_response,
    # Persist the structured report as a session-scoped artifact so the next
    # edit turn's `prior_turn_diagnosis_tool` can find it. Without this the
    # cross-turn lookup is dead code — see persist_diagnostic_report docstring.
    after_agent_callback=persist_diagnostic_report,
    generate_content_config=types.GenerateContentConfig(
        # Disable AFC — we want explicit tool-call gating per the SKILL.md
        # budget rules. AFC's automatic loop fights with that contract.
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
    ),
    planner=BuiltInPlanner(
        # thinking_budget=0 — investigation is structured tool-use, not
        # reasoning-heavy synthesis. Bumping budget didn't show signal in
        # AppHelpDesk evals; we keep cost tight and revisit if the
        # bug-root-cause profile under-performs.
        thinking_config=types.ThinkingConfig(
            include_thoughts=False,
            thinking_budget=0,
        )
    ),
    tools=[_DIAGNOSTIC_SKILL_TOOLSET, *SURVEYOR_TOOLS, *_CLASS_B_TOOLS],
)
