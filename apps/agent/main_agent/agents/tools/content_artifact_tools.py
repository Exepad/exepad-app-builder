"""
Content Artifact Tools for planner agents.

This module provides FunctionTools for planner agents (AppCreatorAgent,
AppEditorAgent, AppBloggerAgent) to save generated markdown content as
artifacts for builder agents to consume.

The planner generates content in markdown format, saves it as artifacts,
and the builder agents then load these artifacts to convert the content
into the appropriate component JSON structure.
"""

import structlog
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google import genai

logger = structlog.get_logger(__name__)


async def save_content_artifact(
    tool_context: ToolContext,
    artifact_name: str,
    content_md: str,
) -> dict:
    """
    Save generated markdown content as artifact for builder to load.

    This tool is used by planner agents to save the content they generate
    for each component/section. The builder agents then load these artifacts
    and convert the markdown content into component JSON structures.

    Args:
        tool_context: ADK tool context with artifact service access
        artifact_name: Identifier in format "page:component" (e.g., "home:hero", "about:story")
        content_md: The markdown content to save

    Returns:
        {"success": True, "artifact_filename": "content:home:hero.md", ...} on success
        {"success": False, "error": "..."} on failure
    """
    try:
        # Validate artifact_name format
        if not artifact_name or ":" not in artifact_name:
            return {
                "success": False,
                "error": f"Invalid artifact_name format: '{artifact_name}'. Expected 'page:component' format.",
            }

        # Generate artifact filename
        artifact_key = f"content:{artifact_name}.md"

        # Validate content
        if not content_md or not content_md.strip():
            return {
                "success": False,
                "error": "Content cannot be empty.",
            }

        # Convert content to bytes and create Part
        content_bytes = content_md.encode("utf-8")
        artifact = genai.types.Part.from_bytes(data=content_bytes, mime_type="text/markdown")

        # Save artifact using the context's artifact service
        # Note: ToolContext provides save_artifact directly
        version = await tool_context.save_artifact(filename=artifact_key, artifact=artifact)

        logger.info(
            f"[save_content_artifact] Saved content artifact: {artifact_key} "
            f"(v{version}, {len(content_bytes)} bytes)"
        )

        return {
            "success": True,
            "artifact_filename": artifact_key,
            "version": version,
            "summary": f"Saved {len(content_md)} chars of markdown content",
        }

    except Exception as e:
        logger.error(f"[save_content_artifact] Error saving artifact: {e}")
        return {
            "success": False,
            "error": str(e),
        }


# Create the FunctionTool instance for use in agents
save_content_artifact_tool = FunctionTool(func=save_content_artifact)


async def save_plan_artifact(
    tool_context: ToolContext,
    artifact_name: str,
    plan_md: str,
) -> dict:
    """
    Save a building-plan markdown body as an artifact.

    Used by Creator to escalate large `building_plan` lists (per-component)
    or `app_building_plan` (app-wide) out of the structured-output payload
    so the JSON doesn't truncate at Gemini 3's combined max_output_tokens
    cap. The workflow materializes these artifacts back into the inline
    list[str] shape immediately after Creator returns, so downstream
    consumers (ComponentBuilder, summary builders) read the classic field
    unchanged.

    Filename convention: ``plan:{artifact_name}.md``. The ``plan:``
    namespace is distinct from ``content:`` (used by save_content_artifact)
    so logs and listings separate cleanly.

    Args:
        tool_context: ADK tool context with artifact service access
        artifact_name: Identifier — for per-component plans the
            PascalCase component name (e.g., "HomeContent"); for the
            app-wide plan the literal string "app". Must be non-empty
            and contain no colons (the ``plan:`` prefix is added here).
        plan_md: The markdown body, one bullet per line. Section headers
            (``## Layout`` etc.) are allowed but the materializer will
            skip them.

    Returns:
        ``{"success": True, "artifact_filename": "plan:{name}.md", ...}``
        on success; ``{"success": False, "error": "..."}`` on failure.
    """
    try:
        # Validate artifact_name format — colon-free single token.
        if not artifact_name or not artifact_name.strip():
            return {
                "success": False,
                "error": "artifact_name cannot be empty.",
            }
        if ":" in artifact_name:
            return {
                "success": False,
                "error": (
                    f"Invalid artifact_name '{artifact_name}': must not contain "
                    "':'. The 'plan:' prefix is added automatically."
                ),
            }

        # Validate content
        if not plan_md or not plan_md.strip():
            return {
                "success": False,
                "error": "plan_md cannot be empty.",
            }

        # Generate artifact filename in the dedicated plan: namespace.
        artifact_key = f"plan:{artifact_name}.md"

        # Convert content to bytes and create Part
        content_bytes = plan_md.encode("utf-8")
        artifact = genai.types.Part.from_bytes(data=content_bytes, mime_type="text/markdown")

        # Save artifact using the context's artifact service
        version = await tool_context.save_artifact(filename=artifact_key, artifact=artifact)

        logger.info(
            f"[save_plan_artifact] Saved plan artifact: {artifact_key} "
            f"(v{version}, {len(content_bytes)} bytes)"
        )

        return {
            "success": True,
            "artifact_filename": artifact_key,
            "version": version,
            "summary": f"Saved {len(plan_md)} chars of plan markdown",
        }

    except Exception as e:
        logger.error(f"[save_plan_artifact] Error saving artifact: {e}")
        return {
            "success": False,
            "error": str(e),
        }


# FunctionTool instance for Creator (and other planner agents) to escalate
# building_plan / app_building_plan to artifacts.
save_plan_artifact_tool = FunctionTool(func=save_plan_artifact)
