"""
Artifact tools for backend handler builder agents.

Validates handler TSX code (syntax + semantic) before saving as versioned
artifacts. Follows the same pattern as validate_and_save_tsx_component_artifact
in the codefocus component builder.

The tool_context parameter is automatically injected by ADK.
"""

import asyncio

import structlog
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google import genai

logger = structlog.get_logger(__name__)

# Artifact naming convention for handlers
HANDLER_ARTIFACT_PREFIX = "handler_code:"

# Used by parallel builder for artifact filename computation
ARTIFACT_PREFIXES = {
    "handler": HANDLER_ARTIFACT_PREFIX,
}

_MAX_SEMANTIC_RETRIES = 3


def _format_errors(errors: list[str], max_errors: int = 5) -> str:
    """Format error list for LLM consumption."""
    truncated = errors[:max_errors]
    lines = [f"- {e}" for e in truncated]
    if len(errors) > max_errors:
        lines.append(f"... and {len(errors) - max_errors} more errors")
    return "\n".join(lines)


async def validate_and_save_handler_artifact(
    tool_context: ToolContext,
    handler_code: str,
    handler_name: str,
) -> dict:
    """
    Validate and save generated backend handler code as an artifact.

    Runs syntax and semantic validation before saving. If validation fails,
    returns errors so you can fix the code and call this tool again.

    Args:
        handler_code: Complete handler TypeScript code string
        handler_name: Handler identifier (e.g., "submitContactForm", "getProducts")

    Returns:
        Dict with save status. On failure: {"success": false, "error": "..."}.
        On success: {"success": true, "artifact_filename": "...", "version": N, ...}.
    """
    filename = f"{HANDLER_ARTIFACT_PREFIX}{handler_name}.tsx"

    try:
        # ── 1. Syntax validation (esbuild parse) ──────────────────────
        from main_agent.services.validation.syntax_validator import validate_tsx_syntax

        # esbuild runs a blocking subprocess — offload it so the single
        # asyncio event loop (concurrent builds, /cancel watchdog, /health)
        # isn't frozen while the handler is validated.
        valid, syntax_errors = await asyncio.to_thread(validate_tsx_syntax, handler_code)
        if not valid:
            formatted = _format_errors(syntax_errors)
            logger.info(
                f"Handler syntax validation failed for {handler_name}",
                errors=syntax_errors[:3],
            )
            return {"success": False, "error": f"Syntax errors — fix and retry:\n{formatted}"}

        # ── 2. Handler auto-fixes (import rewrites) ──────────────────
        from main_agent.services.validation.fixers import (
            apply_handler_auto_fixes,
            apply_handler_enum_case_fixes,
            apply_handler_fk_column_fixes,
        )
        from main_agent.services.validation.handler_semantic_validator import (
            run_handler_semantic_checks,
        )

        # ``_validation_context_models`` holds full model dicts
        # ({name, columns:[{name, type, enum_values}]}) so the SQL
        # column-reference and enum-case rules can see the schema. The import
        # auto-fixer only needs the bare table names — derive them here.
        # (Tolerate the legacy name-only string shape too.)
        models = tool_context.state.get("_validation_context_models", [])
        model_names = [(m.get("name") if isinstance(m, dict) else m) for m in (models or [])]
        model_names = [n for n in model_names if n]
        fixed_code, fixes = apply_handler_auto_fixes(handler_code, model_names=model_names)
        # Enum-case rewrite pass — pulls full models (with enum_values).
        fixed_code, enum_fixes = apply_handler_enum_case_fixes(fixed_code, models)
        fixes.extend(enum_fixes)
        # FK-column drift pass — rewrites `t.project` → `t.project_id` when the
        # model materialized the relation as a `<name>_id` FK column (the seed
        # side is reconciled in deploy-utils' r2-seeder). Pulls full models.
        fixed_code, fk_fixes = apply_handler_fk_column_fixes(fixed_code, models)
        fixes.extend(fk_fixes)
        if fixes:
            logger.info(
                f"Auto-fixed {len(fixes)} issue(s) in handler {handler_name}",
                fixes=fixes,
            )

        # ── 2b. Parse declared outputs once for the semantic pass ─────
        # ``ReturnMissingFieldRule`` is dispatched by ``handler_rules()``
        # when ``AstContext.handler_plan`` is set, so we don't need a
        # separate ``check_return_fields_ast`` call here.
        expected_outputs_map = tool_context.state.get("_validation_handler_expected_outputs", {})
        raw_outputs = expected_outputs_map.get(handler_name, [])
        parsed_outputs = []
        for out in raw_outputs:
            if isinstance(out, str) and ":" in out:
                name, rest = out.split(":", 1)
                parsed_outputs.append(
                    {"name": name.strip(), "type": rest.strip().split(",")[0].strip()}
                )
            elif isinstance(out, str):
                parsed_outputs.append({"name": out.strip(), "type": "string"})
            elif isinstance(out, dict):
                parsed_outputs.append(out)

        # ── 3. Handler semantic checks ───────────────────────────────
        result = run_handler_semantic_checks(fixed_code, models, expected_outputs=parsed_outputs)

        if not result.valid:
            fail_key = f"_handler_semantic_failures:{handler_name}"
            fail_count = tool_context.state.get(fail_key, 0) + 1
            tool_context.state[fail_key] = fail_count

            formatted = _format_errors(result.errors)
            logger.info(
                f"Handler semantic validation failed for {handler_name}",
                errors=result.errors[:3],
                attempt=fail_count,
                max_retries=_MAX_SEMANTIC_RETRIES,
            )

            if fail_count >= _MAX_SEMANTIC_RETRIES:
                logger.warning(
                    f"Semantic retry cap reached for handler {handler_name}",
                    fail_count=fail_count,
                )
                tool_context.actions.escalate = True
                return {
                    "success": False,
                    "error": (
                        f"STOP — '{handler_name}' has failed semantic validation "
                        f"{fail_count} times. Do NOT call this tool again. "
                        f"Return your final response immediately."
                    ),
                    "terminal": True,
                }

            return {"success": False, "error": f"Semantic errors — fix and retry:\n{formatted}"}

        # ── 4. Save artifact ─────────────────────────────────────────
        code_bytes = fixed_code.encode("utf-8")
        artifact = genai.types.Part.from_bytes(data=code_bytes, mime_type="text/plain")
        version = await tool_context.save_artifact(filename=filename, artifact=artifact)

        # Reflect the stages that actually ran (the prior static list claimed a
        # non-existent "sql_safety" column check). handler_semantic runs the
        # tsx_ast handler_rules(): imports, forbidden APIs, export shape, SQL
        # table refs, SQL column refs, return fields, enum case, etc.
        checks_passed = ["syntax", "auto_fixes", "handler_semantic"]

        logger.info(
            "Handler validated and saved",
            handler=handler_name,
            artifact=filename,
            version=version,
            bytes=len(code_bytes),
            auto_fixes=len(fixes),
            warnings=[w[:80] for w in (result.warnings or [])],
            checks_passed=checks_passed,
        )

        response: dict = {
            "success": True,
            "artifact_filename": filename,
            "version": version,
            "checks_passed": checks_passed,
        }
        if result.warnings:
            response["warnings"] = result.warnings[:5]
        if fixes:
            response["auto_fixes_applied"] = fixes[:5]
        return response

    except Exception as e:
        logger.error(f"Failed to validate/save handler artifact {handler_name}: {e}")
        return {"success": False, "error": str(e)}


# Register as FunctionTool — agents use this
validate_and_save_handler_artifact_tool = FunctionTool(validate_and_save_handler_artifact)
