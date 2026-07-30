"""DataIngester — slim LlmAgent for the data-ingest pre-pass.

Runs once at the start of CreationWorkflow (Step 0.6) and EditingWorkflow
(alongside Surveyor) whenever the user uploaded tabular files. All heavy
work — sidecar fetch, schema extraction, naming, artifact writes — is
done deterministically in :mod:`data_ingest_extractor` (Layer 2A) before
this agent runs.

The agent's job is the five judgment tasks the LLM is genuinely needed
for: semantic renaming when source names are opaque, semantic schema
overlap for edit-mode targeting, target_mode decision (create / append /
replace), ``domain_hints`` for PreCreator, and ``notes`` per model
capturing analytical intent from the user request.

**No tools. No skills. No code executor. No after_agent_callback.**
Structured-input → structured-output. One LLM call per turn.
"""

from __future__ import annotations

import structlog
from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.planners import BuiltInPlanner
from google.genai import types
from pydantic import BaseModel, Field

from config import AgentName, get_agent_model
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder
from main_agent.agents.utils.thought_signature_fix import (
    strip_thinking_from_response,
    strip_thinking_metadata,
)
from main_agent.constants import StateKeys

logger = structlog.get_logger(__name__)


# =============================================================================
# Pydantic schemas — shared input / output contract
# =============================================================================
#
# These models live in the subagent module (not a separate types file)
# because they are the data-ingest pre-pass's only public surface. Both
# Layer 2A (extractor) and the workflow callers import directly from
# here. Keeping them co-located with the LlmAgent definition keeps the
# contract obvious.
#
# Field descriptions matter — Vertex AI's structured-output mode strips
# nothing from the schema, so descriptions become part of the model's
# inference signal.


class ProposedColumn(BaseModel):
    """One column on a :class:`ProposedModel`. Built mechanically by
    Layer 2A from the backend's sidecar schema; the LLM does not modify
    columns, only model-level fields."""

    name: str = Field(..., description="Canonical snake_case identifier safe for D1 columns.")
    original_name: str = Field(
        ..., description="Original header text from the user's upload (preserved verbatim)."
    )
    type: str = Field(
        ...,
        description=(
            "Canonical D1 type token: 'text' | 'integer' | 'real' | 'json' | 'blob'. "
            "Inferred by the backend; the LLM should not change it."
        ),
    )
    nullable: bool = Field(
        default=True,
        description="True when at least one row in the sample had a null value for this column.",
    )
    sample_values: list[str] = Field(
        default_factory=list,
        description="Up to three non-null sample values (string-coerced). Helps the LLM judge semantic similarity to existing_models.",
    )


class ProposedModel(BaseModel):
    """A single table the DataIngester wants to create / append-to /
    replace. Layer 2A builds the mechanical fields; Layer 2B (the LLM)
    can refine ``name`` (semantic rename), ``target_mode``,
    ``target_existing_model_name``, and ``notes``."""

    name: str = Field(
        ...,
        description=(
            "snake_case model name. Layer 2A starts from filename stem; the LLM "
            "may rename when source is opaque (e.g. 'sheet_1' → 'customers') based "
            "on column headers + sample_values. Must remain snake_case and unique."
        ),
    )
    source_artifact: str = Field(
        ...,
        description=(
            "doc:{name}.md artifact this model was extracted from. The LLM must "
            "not change this — it's the audit trail back to the upload."
        ),
    )
    columns: list[ProposedColumn] = Field(
        default_factory=list,
        description="Backend-typed columns. The LLM does not modify this list.",
    )
    row_count: int = Field(
        default=0,
        description="Number of rows in the backend sidecar (after row-cap clipping if any).",
    )
    row_cap_hit: bool = Field(
        default=False,
        description=(
            "True when the sidecar contained more rows than DATA_INGEST_ROW_CAP "
            "and was clipped. Layer 2A also emits a row_cap_exceeded warning."
        ),
    )
    target_mode: str = Field(
        default="create",
        description=(
            "How this model should land in D1: 'create' (new model), "
            "'append' (add rows to an existing model), 'replace' (overwrite "
            "an existing model's rows). Edit mode only — create mode always "
            "uses 'create'. Default and safe fallback is 'create'."
        ),
    )
    target_existing_model_name: str | None = Field(
        default=None,
        description=(
            "Required when target_mode is 'append' or 'replace'. The "
            "existing model's name (from existing_models[].name). Null "
            "for 'create'."
        ),
    )
    notes: str = Field(
        default="",
        description=(
            "Free-form notes (≤200 chars) capturing analytical intent the "
            "user expressed (e.g. 'user asked for avg sales by season'). "
            "Creator/Editor read this to plan a runtime handler that "
            "computes the aggregate."
        ),
    )


class ExistingModelDetail(BaseModel):
    """Edit-mode input: summary of an existing model so the LLM can judge
    semantic overlap (cust_id ≈ customer_id) instead of relying on string
    set-math, which is semantically blind."""

    name: str
    columns: list[dict] = Field(
        default_factory=list,
        description=(
            "List of {name, type, sample} dicts. 'sample' is one example value "
            "from D1 (string-coerced), used by the LLM to judge whether a "
            "ProposedModel's columns line up semantically."
        ),
    )


class DataIngesterInput(BaseModel):
    """Sole input to the LlmAgent. Layer 2A populates raw_proposed_models /
    failed_artifacts / warnings; the workflow populates user_request /
    app_name / app_description / mode / existing_models."""

    user_request: str = Field(
        default="",
        description="The user's prompt for this turn (verbatim). The LLM mines it for analytical intent + edit-mode targeting cues.",
    )
    app_name: str = Field(default="", description="App display name (or empty in create mode).")
    app_description: str = Field(
        default="", description="App description (or empty in create mode)."
    )
    mode: str = Field(
        ...,
        description="'create' or 'edit'. 'create' implies all target_mode values are 'create'.",
    )
    raw_proposed_models: list[ProposedModel] = Field(
        default_factory=list,
        description="Output of Layer 2A. The LLM may rename + set notes/target_mode but must not invent new models.",
    )
    failed_artifacts: list[str] = Field(
        default_factory=list,
        description="Artifact names where Layer 2A couldn't extract a sidecar.",
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="Non-fatal Layer 2A warnings (row_cap_exceeded, etc.). The LLM should echo these into IngestReport.warnings.",
    )
    existing_models: list[ExistingModelDetail] = Field(
        default_factory=list,
        description="Edit mode only. Drives the semantic-overlap judgment for target_mode.",
    )


class IngestReport(BaseModel):
    """Sole output of the LlmAgent. Persisted to session state under
    ``StateKeys.DATA_INGEST_REPORT`` and written to disk as
    ``data_ingest_report:{turn_index}.json``."""

    proposed_models: list[ProposedModel] = Field(
        default_factory=list,
        description="Final list (post-rename / post-target). Same names = same models as raw_proposed_models — never invent new ones.",
    )
    target_mappings: dict[str, str] = Field(
        default_factory=dict,
        description=(
            "Map of {raw_model_name: existing_model_name} for entries where "
            "target_mode is 'append' or 'replace'. EditingWorkflow uses this "
            "to wire IngestDataAction. Empty in create mode."
        ),
    )
    warnings: list[str] = Field(
        default_factory=list,
        description="User-facing warnings — include all Layer 2A warnings plus any LLM-level concerns (low confidence on a model, ambiguous user intent, etc.).",
    )
    failed_artifacts: list[str] = Field(
        default_factory=list,
        description="Echo of Layer 2A's failed_artifacts. Surfaced to the user as 'file format not yet supported for data import' or similar.",
    )
    confidence: str = Field(
        default="medium",
        description="'high' | 'medium' | 'low'. The LLM's overall confidence that this ingest plan matches user intent.",
    )
    domain_hints: str = Field(
        default="",
        description=(
            "≤500 chars summarising what kind of app this data suggests. "
            "Threaded into PreCreator's bundle_domain_hints. Free-form prose."
        ),
    )


# =============================================================================
# Instruction provider
# =============================================================================


_INVOCATION_TAIL = """
## Invocation summary

Your input is the structured payload above (``DataIngesterInput``); its
``mode`` field tells you whether this is a ``create`` or ``edit`` turn.
Your output must satisfy the ``IngestReport`` schema exactly.

Key reminders:

- Do NOT invent new ``proposed_models``. The set you return must have
  the same ``source_artifact`` values as ``raw_proposed_models`` — you
  may only refine ``name`` (when opaque), ``target_mode``,
  ``target_existing_model_name``, and ``notes``.
- In create mode, every ``target_mode`` must be ``"create"`` and
  ``target_existing_model_name`` must be ``null``.
- In edit mode, prefer ``"create"`` as a safe default. Only emit
  ``"append"`` when the user explicitly asked to merge with an
  existing dataset AND the semantic overlap is unambiguous. Only emit
  ``"replace"`` when the user explicitly asked to overwrite —
  destructive operations require explicit consent.
- Echo every Layer 2A warning into ``warnings`` so the user sees them.
"""


def data_ingester_instruction_provider(context: ReadonlyContext) -> str:
    """Build the DataIngester's prompt: single overview doc + invocation tail.

    No skills, no profile selection — the agent has one job and one prompt.
    The instruction is **byte-stable** across create/edit turns; per-turn
    context (mode, models, user request) flows through ``DataIngesterInput``.
    """
    return InstructionBuilder().add_doc("data_ingest/00_OVERVIEW.md").add(_INVOCATION_TAIL).build()


# =============================================================================
# Report → prose helpers (consumed by Creator + Editor)
# =============================================================================


def report_to_creator_summary(report: IngestReport) -> str:
    """Render an :class:`IngestReport` as prose for ``CreatorInput.data_ingest_report``.

    Empty string when there are no proposed models (caller may also gate
    on this).
    """
    if not report.proposed_models:
        return ""

    lines: list[str] = []
    lines.append(
        "## Data import pre-pass\n"
        "The following backend models will be auto-provisioned with real "
        "seed data extracted from the user's uploads. **Do not redeclare "
        "these models in `app_backend_plan.models`** — they are added by "
        "the workflow after you return."
    )
    for model in report.proposed_models:
        cols_desc = ", ".join(f"{c.name}:{c.type}" for c in model.columns[:8])
        if len(model.columns) > 8:
            cols_desc += f", … (+{len(model.columns) - 8} more)"
        note_suffix = f" — note: {model.notes}" if model.notes else ""
        cap_suffix = " (row cap hit — partial)" if model.row_cap_hit else ""
        lines.append(
            f"- **{model.name}** ({model.row_count} rows{cap_suffix}): {cols_desc}{note_suffix}"
        )

    if report.domain_hints:
        lines.append(f"\n**Domain hints from uploads:** {report.domain_hints}")
    if report.warnings:
        lines.append("\n**Ingest warnings:**")
        for w in report.warnings:
            lines.append(f"- {w}")
    if report.failed_artifacts:
        lines.append("\n**Files we couldn't import:** " + ", ".join(report.failed_artifacts))
    return "\n".join(lines)


def report_to_editor_summary(report: IngestReport) -> str:
    """Same as :func:`report_to_creator_summary` but framed for the Editor —
    explicit about target_mode so the Editor knows which action class to
    emit (``ChangeBackendModelsAction`` vs ``IngestDataAction``)."""
    if not report.proposed_models:
        return ""

    lines: list[str] = []
    lines.append(
        "## Data import pre-pass\n"
        "The user uploaded tabular files. The DataIngester has already "
        "extracted them; you must wire each model into the app using the "
        "guidance below.\n"
        "\n"
        "- ``target_mode == 'create'`` → emit a ``ChangeBackendModelsAction`` to add the model.\n"
        "- ``target_mode == 'append'`` → emit an ``IngestDataAction`` (mode=\"append\") targeting the existing model.\n"
        "- ``target_mode == 'replace'`` → emit an ``IngestDataAction`` (mode=\"replace\") targeting the existing model.\n"
        "\n"
        "Never emit ``IngestDataAction`` for a model that's not in this report."
    )
    for model in report.proposed_models:
        target = (
            f" → {model.target_existing_model_name}" if model.target_existing_model_name else ""
        )
        note_suffix = f" — {model.notes}" if model.notes else ""
        lines.append(
            f"- **{model.name}** ({model.row_count} rows, target_mode={model.target_mode}{target}){note_suffix}"
        )
    if report.warnings:
        lines.append("\n**Warnings:** " + "; ".join(report.warnings))
    if report.failed_artifacts:
        lines.append("\n**Files we couldn't import:** " + ", ".join(report.failed_artifacts))
    return "\n".join(lines)


# =============================================================================
# LlmAgent
# =============================================================================


data_ingester_agent = LlmAgent(
    name=AgentName.DATA_INGESTER.value,
    model=get_agent_model(AgentName.DATA_INGESTER),
    description=(
        "Slim judgment agent for tabular-data uploads. Layer 2A has already "
        "fetched backend-typed sidecars and built raw ProposedModels; this "
        "agent only does the five NL tasks: semantic renaming, semantic "
        "schema overlap for edit-mode targeting, target_mode decision, "
        "domain_hints synthesis, notes capture."
    ),
    instruction=data_ingester_instruction_provider,
    input_schema=DataIngesterInput,
    output_schema=IngestReport,
    output_key=StateKeys.DATA_INGEST_REPORT,
    before_model_callback=strip_thinking_metadata,
    after_model_callback=strip_thinking_from_response,
    planner=BuiltInPlanner(
        # 512 tokens of internal reasoning — judgment is structured but
        # not deep; pro-tier reasoning isn't warranted. Bump only if eval
        # data shows weak edit-mode targeting on semantic-overlap cases.
        thinking_config=types.ThinkingConfig(
            include_thoughts=False,
            thinking_budget=512,
        ),
    ),
)
