"""Format-specific dispatch for the deterministic decomposition pass.

Each handler knows how to extract theme tokens, layer-block CSS, and (for
Claude Design) ``.ph`` placeholder data from a particular bundle shape.
The runner picks the right handler off ``design_bundle_skill_context.skill_name``.
"""

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
    FormatHandler,
    HandlerError,
    ThemeSources,
    select_handler,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.claude_design import (
    ClaudeDesignHandler,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.stitch import (
    StitchHandler,
)

__all__ = [
    "ClaudeDesignHandler",
    "FormatHandler",
    "HandlerError",
    "StitchHandler",
    "ThemeSources",
    "select_handler",
]
