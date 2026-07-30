"""
Artifact tools for backend config builder agents.

Validates and saves the generated backend config as an artifact.
The tool_context parameter is automatically injected by ADK.
"""

import json
import structlog
from typing import Any, Dict, Optional
from google.adk.tools import BaseTool, FunctionTool
from google.adk.tools.tool_context import ToolContext
from google import genai

from validation import validate_backend_props
from validation.backend import SYSTEM_COLUMNS
from main_agent.agents.utils.validation_formatting import format_validation_errors

logger = structlog.get_logger(__name__)

BACKEND_ARTIFACT_FILENAME = "backend.json"

# ── Save-tool loop cap (mirrors backend_handler_builder.handler_save_guardrail) ──
# ADK runs its own tool-calling loop and ignores genai's
# AutomaticFunctionCallingConfig.maximumRemoteCalls, so a builder whose
# instruction says "ONLY output a tool call" can re-invoke the save tool
# forever when it has nothing new to save (e.g. a no-op schema "edit" for a
# seed-DATA change). 0ahokkja hit 109 identical backend.json saves in one run
# before the user manually disabled Vertex AI. These callbacks bound it.
_SAVE_TOOL_NAME = "validate_and_save_backend_artifact"
_MAX_TOTAL_SAVE_CALLS = 5
# The model save tool takes no per-target name arg (unlike the per-handler
# builder), so a single shared key bounds the loop per invocation. The caller
# resets it to 0 before each model build.
_MODEL_SAVE_CALL_KEY = "_save_tool_calls:backend_model"


def _strip_system_columns(backend_json: str) -> tuple[str, list[str]]:
    """Drop accidental system-column declarations before validation.

    The LLM intermittently re-declares ``id``, ``owner_id``, ``created_at``,
    ``updated_at`` even though the docs forbid it. The validator hard-rejects
    those cases and burns a retry — pure waste on a deterministic mistake.
    Stripping them first is a pure data sanitization with no semantic risk:
    the auto-CRUD layer adds the system columns back regardless.

    Returns ``(rewritten_json, dropped)`` where ``dropped`` is a list of
    ``"<model>.<col>"`` strings for telemetry. If nothing was dropped or the
    input isn't valid JSON, returns the input unchanged with an empty list.
    """
    clean = backend_json.replace("```json", "").replace("```", "").strip()
    try:
        config = json.loads(clean)
    except json.JSONDecodeError:
        return backend_json, []
    if not isinstance(config, dict):
        return backend_json, []
    dropped: list[str] = []
    for model in config.get("models", []) or []:
        if not isinstance(model, dict):
            continue
        cols = model.get("columns")
        if not isinstance(cols, list):
            continue
        kept: list = []
        for col in cols:
            if isinstance(col, dict) and col.get("name") in SYSTEM_COLUMNS:
                dropped.append(f"{model.get('name', '?')}.{col.get('name')}")
                continue
            kept.append(col)
        if len(kept) != len(cols):
            model["columns"] = kept
    if not dropped:
        return backend_json, []
    return json.dumps(config), dropped


def _coerce_fk_id_types(backend_json: str) -> tuple[str, list[str]]:
    """Coerce FK column ``type: "text"`` → ``type: "integer"`` when the
    column references a parent ``id`` whose runtime type is INTEGER.

    The platform's default ``id`` column is ``INTEGER PRIMARY KEY
    AUTOINCREMENT`` (``packages/deploy-utils/src/schema/types.ts``).
    SQLite does NOT coerce text↔int in ``=`` comparisons, so a FK
    declared ``"type": "text"`` joining ``cost_items.project_id`` to
    ``projects.id`` returns zero rows at query time — silently.

    App ``n1aloggh`` post-mortem: the agent docs at
    ``backend/skills/database-schema-design/SKILL.md`` showed an FK
    example with ``"type": "text"`` (since fixed). This auto-fix
    closes the validator gap so the bug class can't ship.

    Returns ``(rewritten_json, coerced)`` where ``coerced`` is a list
    of ``"<model>.<col>"`` strings. A column is left alone when:
      - it's not nullable or has no ``references``;
      - ``references.column`` is not ``"id"``;
      - the target model declares its own non-integer ``id`` column
        (rare, e.g. text UUIDs).
    """
    clean = backend_json.replace("```json", "").replace("```", "").strip()
    try:
        config = json.loads(clean)
    except json.JSONDecodeError:
        return backend_json, []
    if not isinstance(config, dict):
        return backend_json, []
    models = config.get("models") or []
    if not isinstance(models, list):
        return backend_json, []

    # Build target_id_type map: model_name → declared id type ("integer"
    # by default, or whatever the parent explicitly declares).
    target_id_type: dict[str, str] = {}
    for model in models:
        if not isinstance(model, dict):
            continue
        name = model.get("name")
        if not isinstance(name, str):
            continue
        target_id_type[name] = "integer"
        for col in model.get("columns") or []:
            if isinstance(col, dict) and col.get("name") == "id":
                t = col.get("type")
                if isinstance(t, str):
                    target_id_type[name] = t.lower()

    coerced: list[str] = []
    for model in models:
        if not isinstance(model, dict):
            continue
        cols = model.get("columns")
        if not isinstance(cols, list):
            continue
        for col in cols:
            if not isinstance(col, dict):
                continue
            refs = col.get("references")
            if not isinstance(refs, dict):
                continue
            ref_col = refs.get("column")
            ref_model = refs.get("model")
            if ref_col != "id" or not isinstance(ref_model, str):
                continue
            target_type = target_id_type.get(ref_model, "integer")
            if target_type != "integer":
                continue
            cur_type = col.get("type")
            if isinstance(cur_type, str) and cur_type.lower() == "text":
                col["type"] = "integer"
                coerced.append(f"{model.get('name', '?')}.{col.get('name', '?')}")
    if not coerced:
        return backend_json, []
    return json.dumps(config), coerced


async def validate_and_save_backend_artifact(tool_context: ToolContext, backend_json: str) -> dict:
    """
    Validate and save generated backend config as an artifact.

    Validates that the JSON has correct structure using the shared validation
    library, then saves as the backend.json artifact.

    Args:
        backend_json: Complete JSON string of the backend config (mode + models).

    Returns:
        Dict with save status, artifact filename, and version number.

    Example:
        validate_and_save_backend_artifact('{"mode": "dynamic", "models": []}')
    """
    try:
        backend_json, dropped_system_cols = _strip_system_columns(backend_json)
        if dropped_system_cols:
            logger.info(
                "Stripped system columns before validation",
                dropped=dropped_system_cols,
            )

        backend_json, coerced_fk_types = _coerce_fk_id_types(backend_json)
        if coerced_fk_types:
            logger.info(
                "Coerced FK id-type from text → integer before validation",
                coerced=coerced_fk_types,
            )

        result = validate_backend_props(backend_json)

        if not result["valid"]:
            error_msg = format_validation_errors(result["errors"])
            logger.error(f"Backend config validation errors: {error_msg}")
            return {"success": False, "error": error_msg}

        parsed = json.loads(backend_json.replace("```json", "").replace("```", "").strip())

        json_bytes = json.dumps(parsed).encode("utf-8")
        artifact = genai.types.Part.from_bytes(data=json_bytes, mime_type="application/json")
        version = await tool_context.save_artifact(
            filename=BACKEND_ARTIFACT_FILENAME, artifact=artifact
        )

        model_count = len(parsed.get("models", []))
        handler_count = len(parsed.get("handlers", []))

        logger.info(
            f"Saved backend artifact: {BACKEND_ARTIFACT_FILENAME} v{version} "
            f"({model_count} models, {handler_count} handlers, {len(json_bytes)} bytes)"
        )

        return {
            "success": True,
            "artifact_filename": BACKEND_ARTIFACT_FILENAME,
            "version": version,
            "summary": f"{model_count} models, {handler_count} handlers",
            "checks_passed": [
                "json_syntax",
                "schema",
                "model_names",
                "system_columns",
                "foreign_keys",
            ],
        }

    except Exception as e:
        logger.error(f"Failed to save backend artifact: {e}")
        return {"success": False, "error": str(e)}


validate_and_save_backend_artifact_tool = FunctionTool(validate_and_save_backend_artifact)


def backend_model_save_guardrail(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> Optional[Dict]:
    """Enforce a per-invocation save-tool cap on BackendModelBuilder.

    Mirrors ``backend_handler_builder.handler_save_guardrail``: returning a dict
    from ``before_tool_callback`` skips the tool and uses the dict as the result;
    ``tool_context.actions.escalate`` hard-terminates the ADK agent loop (which
    otherwise runs until ``is_final_response()`` and ignores
    ``maximumRemoteCalls``). Prevents the runaway where the builder re-saves an
    identical artifact indefinitely.
    """
    if tool.name != _SAVE_TOOL_NAME:
        return None

    calls = tool_context.state.get(_MODEL_SAVE_CALL_KEY, 0) + 1
    tool_context.state[_MODEL_SAVE_CALL_KEY] = calls

    if calls > _MAX_TOTAL_SAVE_CALLS:
        logger.warning(
            "Backend model save-tool call cap reached — terminating agent loop",
            calls=calls,
            cap=_MAX_TOTAL_SAVE_CALLS,
        )
        tool_context.actions.escalate = True
        return {
            "success": False,
            "error": (
                f"Maximum tool call limit ({_MAX_TOTAL_SAVE_CALLS}) reached. "
                "STOP calling this tool and return your final response immediately."
            ),
            "terminal": True,
        }

    return None


def sanitize_backend_model_save_response(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext, tool_response: Dict
) -> Optional[Dict]:
    """Strip verbose success output so the model sees a clear terminal signal and
    stops re-calling the save tool (mirrors ``sanitize_handler_save_response``).

    Returning a dict from ``after_tool_callback`` replaces ``tool_response``
    before the LLM sees it.
    """
    if tool.name != _SAVE_TOOL_NAME:
        return None

    if tool_response.get("success"):
        return {
            "success": True,
            "artifact_filename": tool_response.get("artifact_filename"),
            "version": tool_response.get("version"),
            "message": "Backend models saved successfully. Your task is complete.",
        }
    return None
