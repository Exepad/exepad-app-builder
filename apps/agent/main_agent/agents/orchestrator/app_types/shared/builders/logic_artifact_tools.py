"""
Artifact tools for the LogicBuilder agent.

Validates and saves the generated frontend.logic JSON as an artifact.
The tool_context parameter is automatically injected by ADK.
"""

import json
import structlog
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google import genai

from validation import validate_logic_config
from main_agent.agents.utils.validation_formatting import format_validation_errors

logger = structlog.get_logger(__name__)

LOGIC_ARTIFACT_FILENAME = "logic.json"
MAX_VALIDATION_RETRIES = 4

_validation_failure_counts: dict[str, int] = {}


async def validate_and_save_logic_artifact(tool_context: ToolContext, logic_json: str) -> dict:
    """
    Validate and save generated frontend.logic config as an artifact.

    Validates the logic JSON against the LogicProps schema (state only)
    before saving it as the logic.json artifact. Returns schema validation
    errors so the LLM can fix and retry (up to MAX_VALIDATION_RETRIES).

    Args:
        logic_json: Complete JSON string of the logic config with state field.

    Returns:
        Dict with save status, artifact filename, and version number.

    Example:
        validate_and_save_logic_artifact('{"state": {}}')
    """
    session_id = getattr(tool_context, "session_id", None) or id(tool_context)
    ctx_key = str(session_id)

    try:
        validation_result = validate_logic_config(logic_json)
        if not validation_result["valid"]:
            _validation_failure_counts[ctx_key] = _validation_failure_counts.get(ctx_key, 0) + 1
            attempt = _validation_failure_counts[ctx_key]

            if attempt >= MAX_VALIDATION_RETRIES:
                logger.error(
                    f"Logic config schema validation failed after {attempt} attempts, "
                    f"giving up: {validation_result['errors']}"
                )
                _validation_failure_counts.pop(ctx_key, None)
                return {
                    "success": False,
                    "error": (
                        f"Schema validation failed after {attempt} attempts. "
                        f"Last errors: {format_validation_errors(validation_result['errors'])}. "
                        f"STOP retrying — save the best version you have and move on."
                    ),
                    "fatal": True,
                }

            logger.error(
                f"Logic config schema validation failed (attempt {attempt}/{MAX_VALIDATION_RETRIES}): "
                f"{validation_result['errors']}"
            )
            return {
                "success": False,
                "error": format_validation_errors(validation_result["errors"]),
                "attempt": attempt,
                "max_attempts": MAX_VALIDATION_RETRIES,
            }

        parsed = json.loads(logic_json.replace("```json", "").replace("```", "").strip())

        # Strip legacy keys that are no longer supported
        parsed.pop("onMount", None)
        parsed.pop("actions", None)
        parsed.pop("computed", None)

        json_bytes = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        artifact = genai.types.Part.from_bytes(data=json_bytes, mime_type="application/json")
        version = await tool_context.save_artifact(
            filename=LOGIC_ARTIFACT_FILENAME, artifact=artifact
        )

        _validation_failure_counts.pop(ctx_key, None)

        state_count = len(parsed.get("state", {}))

        logger.info(
            f"Saved logic artifact: {LOGIC_ARTIFACT_FILENAME} v{version} "
            f"({state_count} state vars, {len(json_bytes)} bytes)"
        )

        return {
            "success": True,
            "artifact_filename": LOGIC_ARTIFACT_FILENAME,
            "version": version,
            "summary": f"{state_count} state vars",
            "checks_passed": [
                "json_syntax",
                "schema",
                "state_types",
            ],
        }

    except Exception as e:
        logger.error(f"Failed to save logic artifact: {e}")
        return {"success": False, "error": str(e)}


validate_and_save_logic_artifact_tool = FunctionTool(validate_and_save_logic_artifact)
