from typing import Literal

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.tools import load_artifacts
from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from dotenv import load_dotenv

from config import get_agent_model, AgentName
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder
from main_agent.agents.utils.thought_signature_fix import (
    strip_thinking_metadata,
    strip_thinking_from_response,
)
from .....tools.content_artifact_tools import save_content_artifact_tool
from google.adk.planners import BuiltInPlanner
from google.genai import types

load_dotenv()

import structlog

logger = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Input schema
# ---------------------------------------------------------------------------


class EditorInput(BaseModel):
    """Defines the input structure for the EditorAgent."""

    user_request: str = Field(description="What the user wants to change.")
    current_app_config: str = Field(description="JSON string of the current app_config.")
    current_component_source: str = Field(
        default="",
        description="Source code of the component being edited (if a specific component is selected).",
    )
    selected_component_name: str = Field(
        default="",
        description="Name of the currently selected component (if any).",
    )
    current_page_uuid: str = Field(
        default="",
        description="UUID of the page the user is currently viewing.",
    )
    help_desk_reasoning: str = Field(
        default="",
        description="Reasoning from the help desk agent that routed the user here.",
    )
    replan_feedback: str = Field(
        default="",
        description=(
            "Corrective feedback when this is a re-plan after the previous plan "
            "was rejected (e.g. it emitted a spurious ingest_data_action). Empty "
            "on the first attempt. When set, treat it as a hard constraint."
        ),
    )
    app_language_code: str = Field(
        default="en",
        description="The language code of the app in ISO 639-1 format.",
    )

    # Content catalog context
    image_catalog_summary: str = Field(
        default="",
        description="Summary of available images from user uploads.",
    )
    document_artifact_list: list[str] = Field(
        default=[],
        description="List of small document artifacts available for loading.",
    )
    large_document_list: list[dict] = Field(
        default=[],
        description="List of large documents with summaries. Each entry has 'source_name' and 'summary'.",
    )
    user_referenced_images: list[str] = Field(
        default=[],
        description="Image UUIDs explicitly referenced by user with @filename syntax.",
    )
    user_referenced_documents: list[str] = Field(
        default=[],
        description="Document artifact names explicitly referenced by user with @filename syntax.",
    )
    user_referenced_large_documents: list[dict] = Field(
        default=[],
        description="Large documents explicitly referenced by user with @filename syntax.",
    )
    dependency_map: str = Field(
        default="",
        description=(
            "JSON dependency graph for cascade planning. Contains three keys: "
            "'model_to_handlers' (table name -> handlers that SQL-reference it), "
            "'handler_to_components' (handler name -> components that call it via useHandler), "
            "'component_to_handlers' (component name -> handlers it calls). "
            "Use this map to find ALL downstream entities affected by any edit "
            "and emit paired actions for each. This is the authoritative signal — "
            "do NOT rely on name heuristics."
        ),
    )

    diagnostic_report: str = Field(
        default="",
        description=(
            "JSON-serialized DiagnosticReport from the Surveyor agent. "
            "When non-empty, contains evidence-bound findings and a "
            "`suggested_resolution_shape` you should treat as load-bearing. "
            "Empty string means the Surveyor was skipped (e.g. quick_remove "
            "or `none` profile) — fall back to today's behavior. "
            "See the GROUNDING FROM SURVEYOR section of your instructions "
            "for the consumption contract."
        ),
    )

    existing_models: list[dict] = Field(
        default_factory=list,
        description=(
            "Edit mode only — list of {name, columns: [{name, type, sample}]} "
            "summaries for every model in the current app_config.backend.models. "
            "Threaded through so the Editor's ingest-action wiring can "
            "validate target_model_name without re-parsing app_config."
        ),
    )
    data_ingest_report: str = Field(
        default="",
        description=(
            "Prose summary emitted by the DataIngester pre-pass when the "
            "user uploaded tabular files this turn. Lists each ProposedModel, "
            "its target_mode (create/append/replace), and target_existing_model_name "
            "if any. **Wiring rules:** target_mode=='create' → emit a "
            "`ChangeBackendModelsAction` to add the model; "
            "target_mode=='append' or 'replace' → emit an `IngestDataAction` "
            "with mode set accordingly. Never emit `IngestDataAction` for a "
            "model not listed in this report; never emit `mode=replace` "
            "unless the report explicitly marks `target_mode=replace`."
        ),
    )


# ---------------------------------------------------------------------------
# Action schemas — one class per builder invocation shape
# ---------------------------------------------------------------------------


class ModifyStylesAction(BaseModel):
    """Modify the app's design system (theme.css).

    Routes to DesignSystemBuilder (build_mode='edit'). The workflow supplies
    the current theme.css — you only describe the change.
    """

    editor_prompt: str = Field(
        description=(
            "Natural-language description of the style change. "
            "E.g. 'Change primary color to #1565C0 and switch the body font to Inter.'"
        )
    )
    priority: int = Field(
        default=100, description="Execution priority within the phase (lower runs first)."
    )


class ChangeBackendModelsAction(BaseModel):
    """Add, modify, or remove backend models and columns in one shot.

    Routes to BackendModelBuilder (build_mode='edit'). The builder takes the
    current models + your editor_prompt and regenerates the entire model set.
    Describe ALL model changes you want in a single editor_prompt — you do
    not need multiple actions for multiple changes.

    This action does NOT touch handlers. Use ModifyHandlerAction (for existing
    handlers that need updating to use the new schema) or AddHandlerAction
    (for new handlers) in the same response to cover the cascade.
    """

    editor_prompt: str = Field(
        description=(
            "Free-text description of model changes. Can describe multiple "
            "operations in one prompt. E.g. 'Add a price column (number, "
            "required) to products. Remove the deprecated tasks_legacy model. "
            "Add a new comments model with text content and user_id.' "
            "The builder handles everything in a single LLM call."
        ),
    )
    priority: int = Field(default=100)


class ModifyLogicAction(BaseModel):
    """Modify frontend shared state variables.

    Routes to LogicBuilder (build_mode='edit'). The workflow supplies the
    current logic config — you only describe the change.
    """

    editor_prompt: str = Field(
        description=(
            "Description of the state variable change. "
            "E.g. 'Add a searchQuery state variable initialized to empty string.'"
        )
    )
    priority: int = Field(default=100)


class AddHandlerAction(BaseModel):
    """Create a new backend handler from scratch.

    Routes to BackendHandlerBuilder (build_mode='create') + deterministic
    backend.json handlers[] append.

    Use this when:
    - User explicitly asks to add a new handler
    - You decided to create a new handler alongside an existing one instead of
      a breaking signature edit (see ModifyHandlerAction decision guidance)
    - You need a specialized variant of an existing handler (e.g. 'getActiveProducts'
      alongside 'getProducts') without disturbing existing callers
    """

    handler_name: str = Field(
        description="Unique camelCase handler name, e.g. 'getActiveProducts'. Must NOT collide with any existing handler in the current app_config."
    )
    auth_level: str = Field(
        default="authenticated",
        description="'public' | 'authenticated' | 'role:<name>' (e.g. 'role:admin')",
    )
    handler_type: Literal["read", "write"] = Field(
        default="read",
        description="Whether the handler primarily reads or writes data.",
    )

    @field_validator("auth_level")
    @classmethod
    def _check_auth_level(cls, v: str) -> str:
        if v in ("public", "authenticated"):
            return v
        if v.startswith("role:") and len(v) > len("role:"):
            return v
        raise ValueError(
            f"auth_level must be 'public', 'authenticated', or 'role:<name>' — got {v!r}"
        )

    inputs: list[str] = Field(
        default_factory=list,
        description="Input parameters in HandlerPlan format, e.g. ['userId: text, required'].",
    )
    outputs: list[str] = Field(
        description="Output fields in HandlerPlan format, e.g. ['products: array', 'total: number']."
    )
    logic: list[str] = Field(
        description="Bullet-point description of what the handler does. The builder generates TSX from these bullets.",
    )
    priority: int = Field(default=100)


class ModifyHandlerAction(BaseModel):
    """Modify an existing backend handler's TSX code and/or signature.

    Routes to BackendHandlerBuilder (build_mode='edit'). The workflow loads
    the existing handler_code:{handler_name}.tsx artifact and passes it to
    the builder so only the described changes are applied.

    SIGNATURE EDITS (setting any new_* field): BEFORE emitting, you MUST
    check `dependency_map.handler_to_components[handler_name]` to identify
    all callers. Decision tree:

    1. Backward-compatible change (optional input added, new output field):
       Modify in place + emit a paired FrontendBuildAction whose prompt
       describes the caller updates needed to consume the new capability.

    2. Breaking change (removed/retyped field, new required input):
       If caller count is small (≤3): modify + emit a paired
       FrontendBuildAction telling the agent to update ALL callers.
       If caller count is large OR some callers should keep the old
       behavior: prefer AddHandlerAction for a new specialized handler
       alongside, and emit a FrontendBuildAction migrating only the
       callers that want the new behavior.

    Make this call as a senior engineer would. The dependency map is
    authoritative for caller discovery — do NOT use name heuristics.
    """

    handler_name: str = Field(
        description="Exact existing handler name from the current app_config."
    )
    modification_plan: str = Field(
        default="",
        description=(
            "Natural-language description of the logic changes to apply. "
            "The builder loads existing TSX and applies ONLY these changes."
        ),
    )

    # Optional signature overrides. When ANY are set, the workflow patches
    # backend.json handlers[] entry deterministically BEFORE running the
    # handler builder with the new signature.
    new_inputs: list[str] | None = Field(
        default=None,
        description=(
            "Replacement inputs in HandlerPlan string format, e.g. "
            "['status: text, optional', 'limit: number']. "
            "When set, fully replaces existing inputs."
        ),
    )
    new_outputs: list[str] | None = Field(
        default=None,
        description="Replacement outputs in the same format as new_inputs.",
    )
    new_auth_level: str | None = Field(
        default=None,
        description="New auth level: 'public' | 'authenticated' | 'role:<name>'",
    )
    new_handler_type: Literal["read", "write"] | None = Field(
        default=None,
        description="Change read/write classification.",
    )
    priority: int = Field(default=100)


class RemoveHandlerAction(BaseModel):
    """Remove a backend handler. Deterministic — no builder.

    The editor MUST check `dependency_map.handler_to_components[handler_name]`
    BEFORE emitting this action and emit a paired FrontendBuildAction whose
    prompt tells the agent to find every `useHandler('<name>')` caller and
    remove the call cleanly. If any component still references the removed
    handler after the edit, cross-validation will fail.
    """

    handler_name: str = Field(description="Exact existing handler name to remove.")
    priority: int = Field(default=100)


class IngestDataAction(BaseModel):
    """Wire a DataIngester-produced model into the seed pipeline as an
    append-or-replace into an existing backend model.

    PRECONDITION (hard): only ever emit this when the prompt's "Data Upload"
    section reports that a tabular file was uploaded and processed this turn.
    If that section says no data was uploaded, emitting an IngestDataAction is
    ALWAYS wrong — a text / UI / content change is a ``FrontendBuildAction``.
    ``target_model_name`` MUST be a model listed under "Existing Backend
    Models", never a component name. The workflow drops violations and
    re-plans, so a mis-routed ingest action just wastes a turn.

    Only emitted when the DataIngester pre-pass already produced a model
    with ``target_mode`` set to ``"append"`` or ``"replace"``. Never used
    for ``"create"`` — those flow through ``ChangeBackendModelsAction``.

    The workflow's ``_run_phase_ingest_data`` reads this action and writes
    an entry into ``app_config.repo.seed`` with ``{source, mode, batch_id,
    format: "csv"}``. The deploy pipeline (PR 3) honors the ``mode`` and
    ``batch_id`` fields when seeding D1.

    **Safety:** never emit for a model name not present in the
    ``IngestReport``. Never emit ``mode="replace"`` unless the
    ``IngestReport`` explicitly set ``target_mode="replace"`` — the
    Editor cannot upgrade ``append`` to ``replace`` on its own.
    """

    target_model_name: str = Field(
        description=(
            "Existing backend model the ingested rows land in (e.g. "
            "'customers'). Must match an entry in EditorInput.existing_models."
        )
    )
    source_rows_artifact: str = Field(
        description=(
            "Artifact name of the raw extracted rows JSON — "
            "'extracted_rows:{name}.json' written by Layer 2A."
        ),
    )
    source_schema_artifact: str = Field(
        description=(
            "Artifact name of the raw extracted schema JSON — "
            "'extracted_schema:{name}.json' written by Layer 2A."
        ),
    )
    mode: Literal["append", "replace"] = Field(
        description=(
            "How rows should land. 'append' adds to the existing table "
            "under a per-batch owner_id; 'replace' overwrites the model's "
            "platform seed. Defaults to append in IngestReport, mirror "
            "that here unless the user explicitly asked to overwrite."
        ),
    )
    batch_id: str = Field(
        description=(
            "Per-turn deterministic batch identifier "
            "('{turn_index}-{hash(rows)[:8]}'). Drives append-mode "
            "owner_id and re-deploy idempotency in the seeder."
        ),
    )
    reasoning: str = Field(
        default="",
        description="Why this action — user intent quote + overlap match summary.",
    )
    priority: int = Field(default=100)


class EditSeedDataAction(BaseModel):
    """Edit the VALUES in an existing model's seed/sample data — change a field
    value, add a row, or remove a row — WITHOUT changing the table schema.

    Routes to SeedDataBuilder (build_mode='edit'). The workflow loads the
    current seed rows, applies your ``editor_prompt``, and re-seeds the preview
    database.

    Use this — NOT ``ChangeBackendModelsAction`` — whenever the user wants to
    change the DATA itself, e.g. 'change the price of the Canvas Daily Tote to
    $29', 'add a product called Linen Throw Blanket', 'remove the discontinued
    item', 'rename the "Gold" tier to "Premium"'. ``ChangeBackendModelsAction``
    is ONLY for SCHEMA changes (add/alter/remove columns or models); a
    data-value change sent there is a no-op — the schema is unchanged, so the
    value never updates and the build wastes a turn.

    ``target_model_name`` MUST be a model listed under "Existing Backend Models".
    """

    target_model_name: str = Field(
        description=(
            "Existing backend model whose seed rows to edit (e.g. 'products'). "
            "Must match an entry in EditorInput.existing_models."
        ),
    )
    editor_prompt: str = Field(
        description=(
            "Free-text description of the data change(s) to apply to the current "
            "rows of this model — update a value, add a row, remove a row. "
            "Describe ALL changes for this model in one prompt."
        ),
    )
    priority: int = Field(default=100)


# ---------------------------------------------------------------------------
# Frontend cross-file refactor — FrontendBuildAction (routes to ComponentBuilderMultiple)
# ---------------------------------------------------------------------------


class PageCreate(BaseModel):
    """Workflow-side: create a new page entry post-agent."""

    title: str = Field(description="Page title shown in browser tab and navigation.")
    slug: str | None = Field(
        default=None,
        description="URL slug, e.g. '/about'. If None, derived from title.",
    )
    mount_components: list[str] = Field(
        default_factory=list,
        description=(
            "Entry component names the agent will create on this page. "
            "Workflow registers each as a content slot post-agent."
        ),
    )

    @field_validator("mount_components")
    @classmethod
    def _validate_mount_components(cls, v: list[str]) -> list[str]:
        for name in v:
            if not name or not name[0].isupper():
                raise ValueError(
                    f"mount_components entry {name!r} must be PascalCase (starts uppercase)."
                )
            if "/" in name or name.endswith(".tsx"):
                raise ValueError(
                    f"mount_components entry {name!r} must be a bare component name "
                    f"(no slashes, no extension)."
                )
        return v


class PageRemove(BaseModel):
    """Workflow-side: remove a page entry post-agent.

    The agent has already cleaned the navigation cascade (rewrote nav
    links across components). The workflow only updates the registry.
    """

    page_uuid: str = Field(
        description="UUID of the page to remove. Matches frontend.pages[*].uuid."
    )

    @field_validator("page_uuid")
    @classmethod
    def _validate_page_uuid(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("page_uuid must be non-empty.")
        return v


class PageSlugRename(BaseModel):
    """Workflow-side: update page slug post-agent.

    The agent has already rewritten every nav link / navigate() / Link
    to= reference. The workflow only updates the registry.
    """

    page_uuid: str = Field(description="UUID of the page whose slug changes.")
    new_slug: str = Field(
        description="New URL slug, e.g. '/about-us'. Must start with '/'.",
    )

    @field_validator("page_uuid")
    @classmethod
    def _validate_page_uuid(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("page_uuid must be non-empty.")
        return v

    @field_validator("new_slug")
    @classmethod
    def _validate_slug(cls, v: str) -> str:
        if not v.startswith("/"):
            raise ValueError(f"new_slug must start with '/', got {v!r}.")
        return v


class FrontendBuildAction(BaseModel):
    """All cross-file frontend refactor work. Routes to ComponentBuilderMultiple.

    The Editor (planner) writes WHAT in plain language. The agent
    (worker) discovers WHICH files matter and HOW to edit them via its
    coding-agent tool surface.

    Covers component create/modify/remove (with cascade), module
    create/modify/remove (with cascade), theme tweaks, slug renames
    (with nav-link cascade), page add/remove. Frontend cascades from
    handler / model operations are also handled here, but the editor
    PAIRS those with the corresponding handler / model action; this
    action does not delete or modify handler artifacts itself.
    """

    prompt: str = Field(
        description=(
            "Natural-language task description. Example: 'Rename the "
            "Card component prop `label` to `title` everywhere it's "
            "used. Update the Card declaration and every consumer.'"
        )
    )

    # Structured non-artifact side-effects the workflow applies post-agent.
    page_creates: list[PageCreate] = Field(default_factory=list)
    page_removes: list[PageRemove] = Field(default_factory=list)
    page_slug_renames: list[PageSlugRename] = Field(default_factory=list)

    priority: int = Field(default=100)


class RenamePageTitleAction(BaseModel):
    """Title-only page rename. Truly deterministic — no agent.

    This class has no `new_slug` field; slug renames are cross-file
    cascades and MUST go through FrontendBuildAction.page_slug_renames.
    """

    page_uuid: str = Field(
        description="UUID of the page to rename. Matches frontend.pages[*].uuid."
    )
    new_title: str = Field(description="New page title.")
    priority: int = Field(default=100)

    @field_validator("page_uuid")
    @classmethod
    def _validate_page_uuid(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("page_uuid must be non-empty.")
        return v


# ---------------------------------------------------------------------------
# Output schema
# ---------------------------------------------------------------------------


class EditorOutput(BaseModel):
    """Defines the output structure for the EditorAgent.

    Actions are grouped by type into separate lists. The workflow executes
    them in a fixed 10-phase canonical order:
        modify_styles → change_backend_models → edit_seed_data →
        ingest_data → modify_logic → add_handler → modify_handler →
        remove_handler → rename_page_title → frontend_build
    So you do NOT need to worry about ordering between action types.
    Within each list, actions are sorted by priority ascending before
    execution.

    Frontend cross-file work (component add / modify / remove with
    cascade, module add / modify / remove with cascade, theme tweaks,
    slug renames with nav-link cascade, page add / remove) all flow
    through `frontend_build_actions` to ComponentBuilderMultiple, which
    discovers files via its coding-agent tool surface and edits them in
    one turn. Handler / model frontend cascades are handled by PAIRING
    the specialized action with a `FrontendBuildAction` whose prompt
    describes the cascade.
    """

    reasoning: str = Field(
        description="Engineering log explaining intent analysis, dependency map reasoning, and action selection."
    )
    # Whole-artifact rewrite actions (typically 0 or 1 per edit)
    modify_styles_actions: list[ModifyStylesAction] = Field(default_factory=list)
    change_backend_models_actions: list[ChangeBackendModelsAction] = Field(default_factory=list)
    modify_logic_actions: list[ModifyLogicAction] = Field(default_factory=list)

    # Per-handler CRUD — frontend cascades emitted as paired FrontendBuildAction(s).
    add_handler_actions: list[AddHandlerAction] = Field(default_factory=list)
    modify_handler_actions: list[ModifyHandlerAction] = Field(default_factory=list)
    remove_handler_actions: list[RemoveHandlerAction] = Field(default_factory=list)

    # Title-only page rename (deterministic — slug changes rejected).
    rename_page_title_actions: list[RenamePageTitleAction] = Field(default_factory=list)

    # ALL cross-file frontend refactor work — routes to ComponentBuilderMultiple.
    frontend_build_actions: list[FrontendBuildAction] = Field(default_factory=list)

    # DataIngester append/replace into an existing model. Only populated
    # when the IngestReport (data_ingest_report on EditorInput) carried a
    # model with target_mode == 'append' or 'replace'.
    ingest_data_actions: list[IngestDataAction] = Field(default_factory=list)

    # Edit the VALUES of an existing model's seed rows (no schema change) —
    # change a field, add a row, remove a row. Routes to SeedDataBuilder edit.
    edit_seed_data_actions: list[EditSeedDataAction] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Instruction provider
# ---------------------------------------------------------------------------


def editor_instruction_provider(context: ReadonlyContext) -> str:
    """Instruction provider for EditorAgent."""
    current_date = datetime.now().strftime("%Y-%m-%d")

    instruction_text = """
## SYSTEM CONTEXT
Current Date: {current_date}
Role: Senior App Configuration Architect.

## MISSION

Translate user edit requests into precise, typed edit actions for an
Exepad web application. You are a senior engineer — reason about cascading
impacts across backend and frontend, and emit the complete set of actions
needed for a coherent change.

You are the **planner**. ComponentBuilderMultiple is the **worker**. You
have only metadata visibility (component / page / handler / model NAMES);
you cannot read TSX file contents. So when emitting `FrontendBuildAction`,
you describe the change in plain language — DO NOT pretend to enumerate
every affected file. The worker discovers the file set via its
coding-agent tool surface (search, find symbol references, dependency
graph). Your prompt is the spec; the worker handles the cascade.

Return ONE JSON object that fully conforms to **EditorOutput**:
- reasoning: string (engineering log — intent analysis, dependency map reasoning, action selection)
- modify_styles_actions: list[ModifyStylesAction] (theme/design-system changes)
- change_backend_models_actions: list[ChangeBackendModelsAction] (add/alter/remove D1 models)
- modify_logic_actions: list[ModifyLogicAction] (frontend state changes)
- add_handler_actions: list[AddHandlerAction] (new backend handlers)
- modify_handler_actions: list[ModifyHandlerAction] (edit existing handlers)
- remove_handler_actions: list[RemoveHandlerAction] (delete handlers)
- rename_page_title_actions: list[RenamePageTitleAction] (title-only page rename)
- frontend_build_actions: list[FrontendBuildAction] (all cross-file frontend work)
- ingest_data_actions: list[IngestDataAction] (append/replace into an existing model from a DataIngester upload)
- edit_seed_data_actions: list[EditSeedDataAction] (change VALUES in an existing model's seed rows — no schema change)

## DATA vs SCHEMA (critical routing rule)

When the user wants to change the **data itself** — a price, a name, add a row,
remove a row, fix a value in a table/catalog/list — emit an
`edit_seed_data_actions` entry, NOT `change_backend_models_actions`.
`change_backend_models_actions` is ONLY for SCHEMA changes (add/alter/remove a
column or model). A data-value change routed to the model builder is a no-op:
the schema is unchanged, so the value never updates and the turn is wasted.
Examples → `edit_seed_data_actions`: "change the Canvas Daily Tote price to $29",
"add a product Linen Throw Blanket", "remove the sold-out item", "rename the Gold
tier to Premium". `target_model_name` must be a model from "## Existing Backend
Models".

## DATA INGEST WIRING

**PRECONDITION (hard).** Look at the "## Data Upload" section of the prompt.
If it says no data files were uploaded this turn, you MUST NOT emit any
`ingest_data_actions` — full stop. A text / UI / content change to a component
is ALWAYS a `frontend_build_action`, never an ingest action. `target_model_name`
must be a model from the "## Existing Backend Models" section, never a component
name. (The workflow rejects violations and forces a re-plan, wasting a turn.)

When the "## Data Upload" section contains a DataIngester report (non-empty)
the user uploaded tabular files this turn and the pre-pass already extracted
them. For each ProposedModel listed in the report:

- **target_mode == 'create'**: emit a `ChangeBackendModelsAction` whose
  prompt asks for the new model. Reference the report's column names and
  types so the BackendModelBuilder lands on the same schema.
- **target_mode == 'append'**: emit an `IngestDataAction` with
  `mode='append'`, targeting the existing model named in the report.
  Use the `source_rows_artifact` / `source_schema_artifact` / `batch_id`
  values directly from the report.
- **target_mode == 'replace'**: emit an `IngestDataAction` with
  `mode='replace'`. Only do this when the IngestReport explicitly marked
  the model as `replace`. Never escalate `append` to `replace` yourself.

**Safety rules** (the workflow rejects violations):

- Never emit `IngestDataAction` for a model name not present in the
  `data_ingest_report`.
- Never emit `mode='replace'` for a model the report marked as `append`
  or `create`.

**CRITICAL:** Generate the `reasoning` field FIRST. Walk through: (a) what
the user wants, (b) **what the Surveyor's `diagnostic_report` says (if
non-empty)**, (c) which entities are directly affected, (d) what
dependents exist in `dependency_map`, (e) judgment calls (modify-in-place
vs. new-variant), (f) the final action list.

## GROUNDING FROM SURVEYOR

When `diagnostic_report` is non-empty, a read-only Surveyor agent has
investigated the current app state before you. Its output is a
`DiagnosticReport` JSON with these top-level fields:

- `profile` — which investigation profile ran (`bug-root-cause`,
  `cascade-enumeration`, `integration-context`,
  `referent-and-current-state`).
- `symptom` — concrete restatement of the user's complaint.
- `findings` — list of `{statement, severity, evidence, affected_entities}`.
- `suggested_resolution_shape` — one of: `add_field_to_handler`,
  `rename_field_in_consumer`, `both_sides_paired`, `remove_dead_field`,
  `add_neighbor_pattern`, `restyle_referent`, `rename_with_cascade`,
  `none`, `unknown`.
- `suggested_resolution_prose` — plain-English description of the
  recommended fix.
- `confidence` — `high`, `medium`, or `low`.
- `blockers` — what prevented higher confidence.

### Consumption rules — non-negotiable

1. **Read findings before deciding.** The Surveyor saw source-level facts
   you cannot see directly (handler return shapes, JSX dataKey
   references, prior-turn diffs). Treat each `severity: "root_cause"`
   finding as load-bearing.
2. **Never contradict an evidence-backed root_cause finding** without
   citing your own counter-evidence in `reasoning`. The Surveyor's
   evidence cites specific tool calls + file:line locations; absent a
   stronger signal, it wins.
3. **`suggested_resolution_shape` constrains your action choice:**

   | Shape | Required action mix |
   |---|---|
   | `add_field_to_handler` | One `ModifyHandlerAction` (the producer); paired `FrontendBuildAction` if consumers need wiring |
   | `rename_field_in_consumer` | One `FrontendBuildAction` updating the consumer; NO handler change |
   | `both_sides_paired` | One `ModifyHandlerAction` AND one `FrontendBuildAction` describing the consumer cascade. **NEVER one without the other** — this is the rate/percentage bug class we built the Surveyor to catch |
   | `remove_dead_field` | One `ModifyHandlerAction` only |
   | `add_neighbor_pattern` | One or more `FrontendBuildAction(s)` referencing the named neighbor pattern in the prompt |
   | `restyle_referent` | One `FrontendBuildAction`; pair with `ModifyStylesAction` if new tokens are needed. **MANDATORY when the restyle is a chart-type swap (`<Charts.BarChart>` → `<Charts.PieChart>`, etc.):** the prompt MUST instruct the builder to verify that the chart's existing `dataKey` / `nameKey` props still reference fields the producer handler emits. Different chart types have different conventions (Pie wants a categorical `nameKey`, Bar/Line want numeric `dataKey`), so a mechanical type swap that preserves the old field names regularly produces empty charts. The agent reading this should add this verification clause to the builder prompt by default, not as an afterthought. (Bug class: ky3clhzb 2026-05-08 — `<Pie dataKey="appointments" nameKey="name">` against handler emitting `appointmentCount`/`vetName`, rendered as legend-only no slices.) |
   | `rename_with_cascade` | The handler/model rename action AND a `FrontendBuildAction` whose prompt names every consumer site from the report |
   | `none` | No actions needed (the user asked about expected behavior) |
   | `unknown` | Use your dependency_map and judgment as you would today |

4. **`confidence: "low"` fallback.** When confidence is low, the report
   may have empty findings — fall back to today's behavior using
   `dependency_map` heuristics, but still surface the report's `symptom`
   and `blockers` in your `reasoning` so the user can see what was
   investigated.
5. **Empty `diagnostic_report` field** means the Surveyor was skipped
   (e.g. trivial deterministic op, quick_remove, or stub-baseline guard).
   Operate as you do today — no behavioral change.
6. **Ambiguous `suggested_resolution_prose` (multi-option recommendations).**
   When the prose contains alternatives — signaled by `" or "`, `"alternatively"`,
   `"perhaps "`, `"either ... or ..."`, or any enumeration of competing
   approaches — you MUST pick ONE option and surface the choice explicitly
   in your `reasoning` field using this pattern:

   > "Surveyor offered: (A) ..., (B) .... Chose (A) because [cite a specific
   > finding, design_style bullet, or constraint that distinguishes the
   > options]."

   Do NOT silently merge alternatives into a single composite instruction
   that mixes both. Do NOT pick implicitly without naming the discarded
   option. The user reads `reasoning` to audit the decision; collapsing
   options without traceability hides a judgment call. If both options are
   equally good, say so and pick the simpler one with that justification.

### Examples

**Example A — Surveyor identifies a both_sides_paired bug:**

```
diagnostic_report.profile = "bug-root-cause"
diagnostic_report.findings[0] = {
  statement: "Chart reads dataKey='rate' but handler getOccupancyTrend returns 'percentage'",
  severity: "root_cause",
  evidence: [...],
  affected_entities: ["DashboardContent", "getOccupancyTrend"]
}
diagnostic_report.suggested_resolution_shape = "both_sides_paired"
```

Your plan MUST emit BOTH:
- `ModifyHandlerAction(handler_name="getOccupancyTrend", modification_plan="Rename output field 'percentage' back to 'rate' to match the chart's dataKey, OR keep 'percentage' and update the consumer.")`
- `FrontendBuildAction(prompt="In DashboardContent.tsx, ensure the <Charts.Area dataKey> matches the handler's return-field name. Either change dataKey to 'percentage' or coordinate with the handler's revert to 'rate'.")`

**Example B — Surveyor identifies a cascade rename:**

```
diagnostic_report.profile = "cascade-enumeration"
diagnostic_report.findings = [
  {statement: "DashboardContent at line 24 calls useHandler('getOccupancyTrend')", severity: "context", ...},
  {statement: "ReportsContent at line 13 calls useHandler('getOccupancyTrend')", severity: "context", ...}
]
diagnostic_report.suggested_resolution_shape = "rename_with_cascade"
```

Your plan emits the rename + a single `FrontendBuildAction` whose prompt
explicitly names BOTH consumer sites for the worker to update.

## FrontendBuildAction — when to emit

Emit `FrontendBuildAction` for ANY cross-file frontend work:

- Component create / modify / remove (with cascade across consumers)
- Module create / modify / remove
- Theme tweaks (font swaps, color changes, spacing) when paired with
  component edits
- Page **slug** renames (cascades through every nav link / Link to= /
  navigate() literal — emit `page_slug_renames`)
- Page add (emit `page_creates` with the component name(s) the agent
  should create)
- Page remove (emit `page_removes`; agent fixes nav-link cascade,
  workflow drops registry entry)
- Handler / model cascades (paired with the specialized action — see
  "Pairing pattern" below)

The action carries:
- `prompt: str` — your natural-language task description.
- `page_creates: list[PageCreate]` — workflow registers new pages
  post-agent.
- `page_removes: list[PageRemove]` — workflow removes pages post-agent.
- `page_slug_renames: list[PageSlugRename]` — workflow updates registry
  post-agent.

Use `RenamePageTitleAction` when ONLY the title changes (no slug change,
no nav cascade). Slug renames are FORBIDDEN on RenamePageTitleAction —
they MUST go through `FrontendBuildAction.page_slug_renames`.

## Pairing pattern — handler / model changes with frontend cascades

Handler / model operations stay in their dedicated actions
(`AddHandlerAction`, `ModifyHandlerAction`, `RemoveHandlerAction`,
`ChangeBackendModelsAction`). The agent cannot touch handler artifacts.

When a handler or model change cascades into frontend callers, emit
the specialized action AND a paired `FrontendBuildAction` describing
the cascade. Phase ordering (handler/model phases run BEFORE
`frontend_build`) ensures the agent sees the post-change state.

Examples:

```python
# Add a handler + wire it from a component
add_handler_actions = [AddHandlerAction(handler_name="export_csv", ...)]
frontend_build_actions = [FrontendBuildAction(
    prompt=(
        "A new handler `export_csv` was just added. Wire it into the "
        "`ReportsPage` component: add a button that calls "
        "`useHandler('export_csv')` and downloads the result."
    ),
)]

# Modify a handler signature + update callers
modify_handler_actions = [ModifyHandlerAction(handler_name="search_products", ...)]
frontend_build_actions = [FrontendBuildAction(
    prompt=(
        "Handler `search_products` now takes a second `limit` argument "
        "(default 50). Find every component calling "
        "`useHandler('search_products')` and pass the new argument."
    ),
)]

# Remove a handler + cascade-fix every caller
remove_handler_actions = [RemoveHandlerAction(handler_name="legacy_export")]
frontend_build_actions = [FrontendBuildAction(
    prompt=(
        "Handler `legacy_export` is being removed. Find every component "
        "calling `useHandler('legacy_export')` and remove the call cleanly."
    ),
)]
```

The same pattern applies to model column renames / removals when
components read those columns.

## Writing prompts for FrontendBuildAction

Write the prompt as a clear engineering ticket. Include:

- WHAT to change (component / module / theme element by name).
- ANY known cascade hints from `dependency_map` (e.g. handler callers).
- Critical constraints (preserve nav items, keep slug structure, etc.).

DO NOT write JSX, CSS, or hook syntax in the prompt. The worker owns
mechanics. You describe intent.

---

## RULES

1. **Preserve existing names.** Do NOT rename components, handlers, or
   slugs unless the user explicitly asks.

2. **Be specific.** Every FrontendBuildAction `prompt`, `editor_prompt`, and
   `modification_plan` must have enough detail for the builder to execute.

3. **Minimal but complete.** Emit what's necessary AND sufficient. The
   cascade rule means cascades often need paired actions.

4. **Navigation updates flow through `FrontendBuildAction`.** Adding,
   removing, or re-slugging a page automatically cascades into header
   / sidebar / footer nav links — describe the cascade in the
   `FrontendBuildAction.prompt`. The agent searches for affected
   `<Link to=...>` / `navigate(...)` / `href=...` references and
   updates them.

5. **CASCADE RULE (most important).** Use `dependency_map` to find ALL
   downstream dependents of any entity you change, and emit paired
   actions for each. Model edit → handlers → components. This is the
   authoritative signal. Do not rely on name heuristics.

6. **Component naming.** New component names must be PascalCase and descriptive.

7. **Handler uniqueness.** `AddHandlerAction.handler_name` must not
   collide with any existing handler.

8. **Priority.** Set `priority` (lower = earlier) only when intra-phase
   ordering matters. Default 100 is correct unless you have a reason.

9. **Do not prune nav items.** When emitting a `FrontendBuildAction`
   for a non-navigation reason (theme, layout, styling, adding an
   unrelated button to a chrome component), the `prompt` MUST NOT say
   anything about rewriting, filtering, or reconciling the nav list.
   The agent will preserve existing nav items when the prompt is
   silent. Only mention navigation when the user explicitly asked for
   a nav change.

10. **Image swaps — describe intent, not mechanics.** When the user asks
    to change, swap, or replace any image, your `FrontendBuildAction.prompt`
    should describe **what** the new image is (subject, mood,
    composition) — not **how** to mutate the JSX. The agent owns the
    `<ExepadImage>` mechanics (when to delete `src`, when to update
    `keywords`, etc.) and applies them based on the intent in your
    prompt. Phrase the prompt as a clear visible-change request, e.g.
    *"Replace the hero background image with a cinematic sun-drenched
    farm landscape at golden hour with rolling green hills."* Do NOT
    write things like "REMOVE the src attribute" or "update keywords
    to ..." — those implementation details are the agent's
    responsibility. See `editor/docs/04_IMAGE_OPS.md`.

11. **Repair empty pages on their own slug.** If `frontend.pages`
    contains a page whose `content` array is empty (no component
    rendering on it — the user sees a blank screen at that URL), emit
    a `FrontendBuildAction` whose `page_creates` lists a `PageCreate`
    with **that page's exact existing slug** in the `slug` field. The
    workflow upserts onto the existing page entry rather than creating
    a duplicate. NEVER pick a new slug like `index`, `home`, or any
    variant just to "avoid a collision" — the user's URL bar still
    points at the original slug.

---

## DARK MODE REQUESTS

When the user asks to add dark mode support or a theme toggle, describe
intent only — DesignSystemBuilder and ComponentBuilderMultiple own the
CSS and JSX mechanics respectively. Emit:

1. **Theme overrides.** One `ModifyStylesAction` whose `editor_prompt`
   says: *"Add WCAG AA dark mode support."* Optionally include a brief
   tone hint (e.g. *"warm dark palette"*, *"high-contrast neutral"*) if
   the user's request implies one. DesignSystemBuilder owns the dark-
   mode CSS contract (`html.dark` selector, full M3 token override set,
   the shadcn-tokens-only anti-pattern). Do NOT enumerate CSS variable
   names, `@layer` syntax, or selector details in your prompt.

2. **Toggle component + hardcoded-color cleanup.** ONE
   `FrontendBuildAction` whose `prompt` says: *"Add a theme toggle
   button to the navigation component (sidebar/header) following the
   `theme-toggle` skill pattern. Then sweep every content component
   that uses literal hex / hsl colors for backgrounds or text and
   replace them with M3 theme tokens so they pick up dark mode
   automatically."* Name the skill by reference; do NOT describe the
   toggle's implementation. Do NOT touch components that already use
   theme tokens — the agent will skip them.

---

## CONTENT ARTIFACTS

When the user provides documents and you're creating NEW content via a
`FrontendBuildAction` that adds a page or component:

1. Load relevant documents with `load_artifacts`
2. Extract content relevant to the new page/component
3. Reference the content directly in the `prompt` field — quote
   relevant excerpts the agent should incorporate. The agent reads the
   prompt as the spec.

There is no separate `content_artifact` channel on `FrontendBuildAction`
— the prompt is the only intent channel. Inline the content excerpts
directly in the prompt text.

---

## FINAL VALIDATION CHECKLIST

Before returning, verify:

- **Cascade complete:** for every `change_backend_models_actions`, check
  `dependency_map.model_to_handlers` and emit paired `ModifyHandlerAction`s
  (or `RemoveHandlerAction`s when a model is being removed and the handler
  exists only to query it); for each handler change, check
  `handler_to_components` and emit a paired `FrontendBuildAction` whose
  `prompt` describes the cascade ("find every `useHandler('<name>')`
  caller and …").
- **Handler signature edits** have a paired `FrontendBuildAction`
  for caller updates, OR you used `AddHandlerAction` for a new
  specialized handler instead.
- **`AddHandlerAction.handler_name`** does not collide with any
  existing handler.
- **`RemoveHandlerAction`** has a paired `FrontendBuildAction` for
  caller cleanup.
- **Page add / remove / slug rename** flows through a single
  `FrontendBuildAction` with the appropriate `page_creates`,
  `page_removes`, or `page_slug_renames` field — the agent handles
  the nav-link cascade.
- Every `handler_name` / `page_uuid` references a real entity.
- Every `prompt` / `editor_prompt` is specific and actionable.

---

""".replace("{current_date}", current_date)

    return (
        InstructionBuilder()
        .add(instruction_text)
        # Platform context — capabilities, built-in services
        .add_doc("planner/docs/00_PLATFORM_GUIDE.md")
        # Dependency map + missing-source component handling
        .add_doc("editor/docs/00_DEPENDENCY_MAP.md")
        # Output shape + all 10 action schemas with cascade rules
        .add_doc("editor/docs/01_ACTION_SCHEMAS.md")
        # Decision tree — which action(s) to emit for each user intent
        .add_doc("editor/docs/02_DECISION_TREE.md")
        # Worked examples (9) + anti-patterns
        .add_doc("editor/docs/03_EXAMPLES.md")
        # Image-swap planning rules (src vs keywords semantics — silent
        # no-op pitfall when only keywords are updated).
        .add_doc("editor/docs/04_IMAGE_OPS.md")
        .build()
    )


# ---------------------------------------------------------------------------
# Agent definition
# ---------------------------------------------------------------------------

editor_agent = LlmAgent(
    name=AgentName.EDITOR,
    model=get_agent_model(AgentName.EDITOR),
    description="Analyzes app config and user requests to produce precise editing plans.",
    instruction=editor_instruction_provider,
    input_schema=EditorInput,
    output_schema=EditorOutput,
    output_key="edit_plan",
    before_model_callback=strip_thinking_metadata,
    after_model_callback=strip_thinking_from_response,
    generate_content_config=types.GenerateContentConfig(
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
    ),
    planner=BuiltInPlanner(
        thinking_config=types.ThinkingConfig(
            include_thoughts=True,
            thinking_budget=8192,
        )
    ),
    tools=[
        load_artifacts,
        save_content_artifact_tool,
    ],
)
