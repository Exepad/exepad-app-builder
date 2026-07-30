"""
BackendHandlerBuilder — generates backend API handler TSX code, one
handler per LLM invocation.

A single ``LlmAgent`` that receives one ``BackendHandlerBuilderInput`` per
run, generates that handler's TSX, and saves it via the
``validate_and_save_handler_artifact`` tool. The caller (see
``handler_code_generator.generate_handler_code_artifacts`` and
``BackendBuilder.build_create_handler`` / ``build_edit_handler``) is
responsible for looping over handlers and invoking this agent N times.

This per-handler dispatch pattern matches ComponentBuilder's
per-component build loop in CreationWorkflow. A short-lived batched
variant (LLM receives all tasks at once and loops internally via tool
calls; 2026-04-02→2026-05-19, commits af553249→cd07d957) was reverted
after Pro started bailing mid-batch on the 1ybz1p4n build (5 handlers
planned, 0 saved, deploy aborted at provision).

AFC loop prevention is handled by ``handler_save_guardrail`` via
``tool_context.actions.escalate``; the per-handler save-tool counter at
``_save_tool_calls:<handler_name>`` is reset to 0 by the caller before
each invocation.
"""

from __future__ import annotations

from typing import Dict, Any, Literal, Optional
from google.adk.agents import LlmAgent
from google.adk.tools import BaseTool, load_artifacts
from google.adk.tools.skill_toolset import SkillToolset
from google.adk.tools.tool_context import ToolContext
from pydantic import BaseModel, Field
from config import get_agent_model, AgentName

from .artifact_tools import validate_and_save_handler_artifact_tool
from ...models.plan_models import HandlerPlan, ModelPlan
from google.adk.planners import BuiltInPlanner
from google.genai import types

import structlog
from pathlib import Path
from google.adk.agents.readonly_context import ReadonlyContext
from main_agent.agents.utils.agent_docs_loader import load_agent_doc
from main_agent.agents.utils.skills import load_backend_skills

logger = structlog.get_logger(__name__)


_BACKEND_SKILL_TOOLSET = SkillToolset(skills=load_backend_skills())


def _find_repo_root() -> Path:
    """Walk up from this file until we find the monorepo root."""
    current = Path(__file__).resolve().parent
    for _ in range(12):  # safety cap
        if (current / "packages").is_dir():
            return current
        current = current.parent
    raise FileNotFoundError("Could not locate monorepo root (missing packages/ dir)")


def _find_sdk_exports_file() -> Path:
    """Resolve the file used to inject available @exepad/sdk exports."""
    repo_root = _find_repo_root()
    candidates = [
        # Current source of truth
        repo_root / "packages" / "exepad-sdk" / "src" / "index.ts",
        # Legacy location kept for backward compatibility
        repo_root / "packages" / "schemas" / "data" / "code_components" / "index.ts",
    ]

    for candidate in candidates:
        if candidate.is_file():
            return candidate

    checked = ", ".join(str(path) for path in candidates)
    raise FileNotFoundError(f"Could not locate SDK exports file. Checked: {checked}")


def get_sdk_exports() -> str:
    try:
        file_path = _find_sdk_exports_file()
        content = file_path.read_text(encoding="utf-8")
        return content
    except Exception as e:
        logger.error(f"Failed to load SDK exports: {e}")
        return "// Error loading SDK exports"


# =============================================================================
# Input / Output Schemas
# =============================================================================


class BackendHandlerBuilderInput(BaseModel):
    """Input for a single handler task.

    Receives the structured HandlerPlan + relevant ModelPlan directly
    instead of free-text building plans and context JSON.
    """

    build_mode: Literal["create", "edit"] = Field(
        default="create",
        description="Whether this is a new handler creation or editing an existing one.",
    )
    existing_handler_artifact: str = Field(
        default="",
        description=(
            "Artifact name of existing handler TSX source to load with load_artifacts "
            "in edit mode (e.g., 'handler_code:getDashboardStats.tsx'). "
            "Empty for create mode."
        ),
    )
    handler_plan: HandlerPlan = Field(
        description="Handler definition from the creator plan.",
    )
    model_plans: list[ModelPlan] = Field(
        default=[],
        description=(
            "All backend model schemas. The handler may query any model "
            "(JOINs, aggregations across multiple tables)."
        ),
    )
    output_artifact_name: str = Field(
        description="Identifier for the output artifact (e.g., 'submitContactForm', 'getProducts')."
    )


# =============================================================================
# Instruction Provider
# =============================================================================


def backend_handler_builder_instruction_provider(context: ReadonlyContext) -> str:
    handler_doc = load_agent_doc("backend/docs/BACKEND_HANDLERS_CONFIG.md")

    return f"""You are an expert Exepad Backend Handler Engineer.

You build backend API handlers for Exepad's self-hosted backend: they run
in-process in the Node runtime and execute RPC-based auto-CRUD plus custom
handler logic over SQLite (better-sqlite3), queried via `ctx.db.prepare(...)`.

## SKILLS

Before writing handler code, call `load_skill(skill_name='handler-patterns-rpc')`
to load handler signature patterns, ctx surface, validation rules, and
return-shape conventions. The canonical contract is the reference
documentation below; the skill is a pattern helper. Follow that skill in
addition to the HARD RULES below and the reference documentation.

## BUILD MODE

You receive a `build_mode` field per handler task:

### `build_mode: "create"` (new handler)
Build the handler from scratch using `handler_plan` and `model_plans`.

### `build_mode: "edit"` (modify existing handler)
1. Load the existing handler source from `existing_handler_artifact` using `load_artifacts`
2. Use the loaded code as your starting point
3. Apply ONLY the changes described in the handler plan
4. Preserve all existing logic not mentioned in the modification
5. Do NOT rewrite from scratch — modify the existing code

Read your input carefully to extract `handler_plan`, `model_plans`,
and `output_artifact_name`, then generate the handler code following the rules below.

## HARD RULES — TABLE REFERENCES (read before writing any SQL)

1. **Every table you read or write via `ctx.db.prepare(...)` MUST exist in
   `model_plans`**. Extract the table name from every `INSERT INTO`, `UPDATE`,
   `DELETE FROM`, `FROM`, and `JOIN` in your planned SQL and verify it appears
   in `model_plans` BEFORE you write the code.

2. **DO NOT INVENT TABLES.** If `handler_plan.logic` mentions a table not in
   `model_plans`, STOP and use one of the platform helpers below instead.
   Never fabricate a schema. Never write `INSERT INTO some_table` for a table
   the planner did not declare. The validator will reject it.

3. **For user profile / settings / preferences / currency / locale /
   business info: declare and use a normal model.** There is NO
   `ctx.settings` helper. Store app-wide singleton config as a single
   owner-scoped row in a declared table (e.g. `business_settings`):
   - `INSERT INTO business_settings (owner_id, ...) VALUES (...)` ✅
     (when `business_settings` is in `model_plans`)
   - There are no platform-owned `_user_settings` / settings tables.

4. **Files are handled by the platform file storage layer**, accessed via
   the frontend `useFileUpload()` hook — not raw SQL. There are NO platform
   "form", "booking", "notification", "payment", or "blog" services; model
   that data as your own declared tables and use plain SQL over them.

5. **If the handler plan asks for data you cannot produce without inventing a
   table**, the planner made a mistake. Fail loudly: return a handler that
   throws `new Error('handler_plan references undeclared table: <name>')` so
   the pipeline escalates. Do NOT paper over the gap by guessing a schema.

## HARD RULES — COLUMN REFERENCES (read before writing any SQL)

6. **Every column you reference MUST be declared in that model's `columns[]`.**
   Before writing each SELECT / WHERE / GROUP BY / ORDER BY / INSERT / UPDATE,
   verify every column name against the target model's `columns[]` in
   `model_plans`. The validator rejects columns that aren't declared.

7. **DO NOT INVENT COLUMNS — not even ones the request implies.** If a metric
   needs a value the schema doesn't store, derive it from the columns that DO
   exist (e.g. count returns from `loans.return_date IS NOT NULL`, NOT from a
   non-existent `status` column). Common trap: copying a `GROUP BY status`
   aggregation onto a table that has no `status` column.

8. **Never emit a query you know is invalid.** If you cannot satisfy the plan
   with the declared columns, fail loudly like rule 5
   (`throw new Error('handler references undeclared column: <table>.<col>')`)
   instead of leaving a dead or guessed query in the handler. Do NOT add a
   hedging comment like "assuming there's an X column" — remove the query.

{handler_doc}

## TERMINAL SAVE MANDATE (HARD-BLOCKING — read this first)

You MUST end this turn by calling `validate_and_save_handler_artifact`. A turn
that ends on a plain text response with NO save tool-call produces **no
artifact** and fails the build — there is no second turn to recover it, and a
single missing handler can abort the whole app. Never describe, narrate, or
"plan out loud" the handler instead of saving it: write the TSX and call the save
tool in the SAME turn. Reasoning is fine, but it must terminate in the save call
— that is the only acceptable way to finish.

## SAVING YOUR OUTPUT

1. After generating the handler code, call `validate_and_save_handler_artifact` with:
   - `handler_code`: Your complete handler code
   - `handler_name`: The `output_artifact_name` from the handler task

2. If the tool returns `success: false`:
   - Read the error messages carefully
   - Fix ONLY the reported issues — do not rewrite the entire handler
   - Call the tool again with the corrected code

3. After successful save, return your response immediately.

IMPORTANT: Do NOT generate or save any other handlers.
"""


# =============================================================================
# ADK Tool Callback (AFC loop prevention safety net)
# =============================================================================

_SAVE_TOOL_NAME = "validate_and_save_handler_artifact"
_MAX_TOTAL_SAVE_CALLS = 5


def handler_save_guardrail(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> Optional[Dict]:
    """Enforce a per-handler tool-call cap matching the component builder pattern.

    Per ADK docs, returning a dict from ``before_tool_callback`` **skips the
    tool entirely** and uses the dict as the tool result.
    Uses ``tool_context.actions.escalate`` for hard agent loop termination."""
    if tool.name != _SAVE_TOOL_NAME:
        return None

    handler_name = args.get("handler_name", "unknown")
    call_key = f"_save_tool_calls:{handler_name}"
    calls = tool_context.state.get(call_key, 0) + 1
    tool_context.state[call_key] = calls

    if calls > _MAX_TOTAL_SAVE_CALLS:
        logger.warning(
            "Per-handler save-tool call cap reached — terminating agent loop",
            calls=calls,
            cap=_MAX_TOTAL_SAVE_CALLS,
            handler=handler_name,
        )
        tool_context.actions.escalate = True
        return {
            "success": False,
            "error": (
                f"Maximum tool call limit ({_MAX_TOTAL_SAVE_CALLS}) reached for "
                f"'{handler_name}'. "
                "STOP calling this tool and return your final response immediately."
            ),
            "terminal": True,
        }

    return None


def sanitize_handler_save_response(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext, tool_response: Dict
) -> Optional[Dict]:
    """Strip verbose details from success responses to prevent AFC loops.

    Per ADK docs, returning a dict from ``after_tool_callback`` **replaces**
    the original ``tool_response`` before the LLM sees it."""
    if tool.name != _SAVE_TOOL_NAME:
        return None

    if tool_response.get("success"):
        return {
            "success": True,
            "artifact_filename": tool_response.get("artifact_filename"),
            "version": tool_response.get("version"),
            "message": "Handler saved successfully. Your task is complete.",
        }
    return None


# =============================================================================
# Agent Definition
# =============================================================================

backend_handler_builder_agent = LlmAgent(
    name=AgentName.BACKEND_HANDLER_BUILDER,
    model=get_agent_model(AgentName.BACKEND_HANDLER_BUILDER),
    description="Builds backend API handler TSX code for the in-process SQLite (better-sqlite3) backend.",
    instruction=backend_handler_builder_instruction_provider,
    input_schema=BackendHandlerBuilderInput,
    output_schema=None,
    include_contents="none",  # Ignore session history; all context is in the instruction
    planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=0)),
    tools=[
        _BACKEND_SKILL_TOOLSET,
        validate_and_save_handler_artifact_tool,
        # Edit mode loads the existing handler TSX via load_artifacts (see the
        # build_mode="edit" instruction). Without this registration the LLM's
        # load_artifacts call raises "Tool not found" and aborts the stream.
        load_artifacts,
    ],
    before_tool_callback=handler_save_guardrail,
    after_tool_callback=sanitize_handler_save_response,
    generate_content_config=types.GenerateContentConfig(
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True)
    ),
)
