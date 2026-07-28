"""
Builder Factory -- creates JSON config builder agents from doc combinations.

A single factory function eliminates boilerplate when defining new JSON config
agents (LogicBuilder, BackendModelBuilder, etc.). Each agent gets:
- Documentation loaded via load_agent_docs()
- A validate+save artifact tool
- Schema lookup tools for error recovery
"""

from typing import Callable, Optional, Union

from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.planners import BuiltInPlanner
from google.adk.tools import load_artifacts
from google.genai import types

from config import get_agent_model
from main_agent.agents.utils.agent_docs_loader import load_agent_docs
from main_agent.agents.utils.thought_signature_fix import (
    strip_thinking_metadata,
    strip_thinking_from_response,
)
from full_schema_utils import (
    get_exepad_schema,
    get_exepad_schema_catalog,
)

import structlog

logger = structlog.get_logger(__name__)


def create_json_config_builder(
    name: str,
    agent_docs: list[str],
    role_instruction: Union[str, Callable[..., str]],
    input_schema,
    validate_tool: Callable,
    thinking_budget: int = 8192,
    extra_tools: Optional[list] = None,
    output_schema=None,
    output_key: Optional[str] = None,
    max_tool_calls: int = 10,
    before_tool_callback: Optional[Callable] = None,
    after_tool_callback: Optional[Callable] = None,
) -> LlmAgent:
    """
    Factory: doc combination + validate tool -> LlmAgent.

    Creates a JSON config builder agent with:
    - Multi-doc loading (concatenated with separators)
    - Validate + save artifact tool
    - Schema lookup tools for error recovery

    Args:
        name: Agent name (must match AgentName enum entry)
        agent_docs: List of doc filenames to load (e.g., ["04_UI_LOGIC.md"])
        role_instruction: Agent-specific role text (str) or instruction_provider callable
            that receives ReadonlyContext and returns str. Docs are appended automatically.
        input_schema: Pydantic BaseModel for input
        validate_tool: FunctionTool for validate+save artifact
        thinking_budget: Thinking token budget (default 8192)
        extra_tools: Additional tools beyond the standard set
        output_schema: Optional Pydantic BaseModel for output
        output_key: Optional session state key for output
        max_tool_calls: Deprecated/no-op. ADK runs its own tool loop and ignores
            genai's AutomaticFunctionCallingConfig.maximumRemoteCalls. Bound a
            builder's save loop with a `before_tool_callback` save-guardrail that
            sets `tool_context.actions.escalate` instead (see
            backend_artifact_tools.backend_model_save_guardrail).
        before_tool_callback: Optional ADK before_tool_callback (e.g. a save-loop
            guardrail). Returning a dict skips the tool and uses it as the result.
        after_tool_callback: Optional ADK after_tool_callback (e.g. response
            sanitizer to keep the LLM's terminal signal clean).

    Returns:
        Configured LlmAgent instance
    """
    docs_content = load_agent_docs(agent_docs)
    docs_suffix = "\n\n## Reference Documentation\n\n" + docs_content if docs_content else ""

    if callable(role_instruction):
        _role_fn = role_instruction

        def instruction_provider(context: ReadonlyContext) -> str:
            return _role_fn(context) + docs_suffix

    else:

        def instruction_provider(context: ReadonlyContext) -> str:
            return role_instruction + docs_suffix

    tools = [
        validate_tool,
        load_artifacts,
        get_exepad_schema,
        get_exepad_schema_catalog,
    ] + (extra_tools or [])

    agent_kwargs = dict(
        name=name,
        model=get_agent_model(name),
        description=f"Builds JSON config using {', '.join(agent_docs)}",
        instruction=instruction_provider,
        input_schema=input_schema,
        tools=tools,
        before_model_callback=strip_thinking_metadata,
        after_model_callback=strip_thinking_from_response,
        before_tool_callback=before_tool_callback,
        after_tool_callback=after_tool_callback,
        planner=BuiltInPlanner(
            thinking_config=types.ThinkingConfig(
                include_thoughts=True,
                thinking_budget=thinking_budget,
            )
        ),
        # ADK runs its own tool loop; disable genai's built-in AFC (matching the
        # handler builder). Loop bounding comes from the save-guardrail callback,
        # not maximumRemoteCalls (which ADK ignores).
        generate_content_config=types.GenerateContentConfig(
            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                disable=True,
            )
        ),
    )

    if output_schema is not None:
        agent_kwargs["output_schema"] = output_schema
    if output_key is not None:
        agent_kwargs["output_key"] = output_key

    return LlmAgent(**agent_kwargs)
