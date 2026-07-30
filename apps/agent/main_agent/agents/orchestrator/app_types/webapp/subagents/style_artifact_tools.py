"""
Artifact tools for the DesignSystemBuilder agent.

Validates theme.css (Tailwind v4 CSS-first config) before saving as versioned
artifacts. Runs semantic checks so the builder LLM can fix errors via AFC retries,
eliminating the need for a separate fixer agent.

The tool_context parameter is automatically injected by ADK.
"""

import structlog
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google import genai

from main_agent.agents.utils.validation_formatting import format_validation_errors

logger = structlog.get_logger(__name__)

STYLE_ARTIFACT_PREFIX = "codefocus_style:"

_MAX_STYLE_SEMANTIC_RETRIES = 3


async def validate_and_save_style_artifact(
    tool_context: ToolContext,
    css_content: str,
    style_name: str,
) -> dict:
    """
    Validate and save generated CSS as a Code Focus style artifact.

    Validates structure, forbidden patterns, required SDK variables, and HSL format.
    Tailwind v4 uses CSS-first config — only .css files are accepted.

    Args:
        css_content: Complete CSS configuration string
        style_name: Filename for the style (e.g., "theme.css")

    Returns:
        Dict with save status. On failure: {"success": false, "error": "..."}.
        On success: {"success": true, "artifact_filename": "...", "version": N, ...}.
    """
    filename = f"{STYLE_ARTIFACT_PREFIX}{style_name}"

    try:
        checks_passed = []
        auto_fixes = []
        content_to_save = css_content

        # ── Reject .js files — v4 uses CSS-first config ─────────────
        if style_name.endswith(".js"):
            return {
                "success": False,
                "error": (
                    "Tailwind v4 uses CSS-first config. Generate theme.css with "
                    "@import, @theme, @layer, and :root blocks — not tailwind.config.js."
                ),
            }

        if style_name.endswith(".css"):
            # 1. Basic structure check
            content_stripped = css_content.strip()
            if len(content_stripped) < 20:
                return {
                    "success": False,
                    "error": "CSS content is empty or truncated. Generate the complete theme CSS.",
                }
            checks_passed.append("structure")

            # 2. Semantic validation via css_ast rule engine — 13 rules
            # covering forbidden patterns, required structure, HSL format,
            # and contrast pair advisories. Every finding carries a
            # ``(rule_id, line, col)`` so the LLM can pinpoint edits.
            from main_agent.services.validation.css_ast import (
                CssContext,
                parse_css,
            )
            from main_agent.services.validation.css_ast.rules.default_set import (
                theme_css_rules,
            )
            from main_agent.services.validation.finding import run_rules

            stylesheet = parse_css(css_content)
            ctx = CssContext(css=css_content, stylesheet=stylesheet)
            findings = run_rules(ctx, theme_css_rules())
            errors = [f.formatted_message() for f in findings if f.severity == "error"]

            if errors:
                fail_key = f"_design_system_semantic_failures:{style_name}"
                fail_count = tool_context.state.get(fail_key, 0) + 1
                tool_context.state[fail_key] = fail_count

                formatted = format_validation_errors(errors, max_errors=5)

                if fail_count >= _MAX_STYLE_SEMANTIC_RETRIES:
                    tool_context.actions.escalate = True
                    return {
                        "success": False,
                        "error": (
                            f"STOP — '{style_name}' has failed semantic validation "
                            f"{fail_count} times. Do NOT call this tool again for this file. "
                            f"Return your final response immediately."
                        ),
                        "terminal": True,
                    }

                return {
                    "success": False,
                    "error": f"Theme CSS errors — fix and retry:\n{formatted}",
                }

            checks_passed.extend(["forbidden_patterns", "required_structure", "sdk_variables"])

        # ── Save artifact ────────────────────────────────────────────
        content_bytes = content_to_save.encode("utf-8")
        artifact = genai.types.Part.from_bytes(data=content_bytes, mime_type="text/plain")
        version = await tool_context.save_artifact(filename=filename, artifact=artifact)

        logger.info(
            f"Saved validated style artifact: {filename} v{version} "
            f"({len(content_bytes)} bytes, checks={checks_passed})"
        )

        response: dict = {
            "success": True,
            "artifact_filename": filename,
            "version": version,
            "checks_passed": checks_passed,
        }
        if auto_fixes:
            response["auto_fixes_applied"] = auto_fixes
        return response

    except Exception as e:
        logger.error(f"Failed to validate/save style artifact {style_name}: {e}")
        return {"success": False, "error": str(e)}


# Register as FunctionTool — agents use this
validate_and_save_style_artifact_tool = FunctionTool(validate_and_save_style_artifact)
