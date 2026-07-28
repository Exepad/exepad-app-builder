"""Normalize near-miss tool-call names emitted by the model.

Weaker / non-Gemini models (several OpenRouter / LiteLLM providers) occasionally
emit a *near-miss* tool name — most commonly the singular ``load_artifact`` for
ADK's built-in ``load_artifacts``. ADK resolves tools by **exact** name and
raises a hard ``ValueError`` during resolution. When the agent runs inside a
builder-pool slot (outside the App's ``plugin_manager``), the
``ReflectAndRetryToolPlugin`` guidance path doesn't fire, so that ValueError
propagates and aborts the whole build — the worst possible outcome for a single
fumbled tool name.

This module provides an ``after_model_callback`` that rewrites a small, explicit
allow-list of known aliases to their canonical names in the model response,
*before* ADK processes the function calls. A fatal crash becomes a normal,
successful tool call. The allow-list is deliberately tiny and conservative:
every entry maps a hallucinated spelling to a real tool the builder agents
register, so it can never mask a genuinely unknown tool (an unmapped bad name
still surfaces through ADK's normal path).
"""

from __future__ import annotations

from typing import Optional

import structlog
from google.adk.agents.callback_context import CallbackContext
from google.adk.models import LlmResponse

logger = structlog.get_logger(__name__)

# hallucinated_name -> canonical registered tool name.
# Keep conservative: only obvious singular/plural confusions of tools the
# builder agents actually register. ``load_artifacts`` is ADK's built-in
# LoadArtifactsTool, present on every component-builder agent.
_TOOL_NAME_ALIASES: dict[str, str] = {
    "load_artifact": "load_artifacts",
}


def normalize_tool_call_names(
    callback_context: CallbackContext, llm_response: LlmResponse
) -> Optional[LlmResponse]:
    """Rewrite known alias tool-call names in-place; return the response when
    anything changed (ADK uses a non-None return to replace the response).
    """
    if llm_response is None or llm_response.content is None:
        return None

    changed = False
    for part in llm_response.content.parts or []:
        function_call = getattr(part, "function_call", None)
        if function_call is None or not getattr(function_call, "name", None):
            continue
        canonical = _TOOL_NAME_ALIASES.get(function_call.name)
        if canonical and canonical != function_call.name:
            logger.warning(
                "tool_call_name_normalized",
                agent=getattr(callback_context, "agent_name", "?"),
                hallucinated=function_call.name,
                canonical=canonical,
            )
            function_call.name = canonical
            changed = True

    return llm_response if changed else None
