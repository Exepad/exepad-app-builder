"""
Parallel pre-build runner for Code Focus creation workflow.

Runs the Design System, Logic, and Backend builders concurrently using
TimeoutParallelAgent. Each agent is cloned with input_schema=None and reads
its input from a dedicated session-state key, following the same pattern
established in the TimeoutParallelAgent pattern.
"""

from __future__ import annotations

from typing import AsyncGenerator, Optional

from google.adk.agents import LlmAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event
import structlog

from config import PARALLEL_INITIAL_BUILDERS_TIMEOUT
from main_agent.agents.utils.timeout_parallel_agent import TimeoutParallelAgent
from main_agent.errors import PipelineError

logger = structlog.get_logger(__name__)

# State keys used to pass structured input to each parallel clone
PRE_BUILD_DS_INPUT_KEY = "_pre_build_ds_input"
PRE_BUILD_LOGIC_INPUT_KEY = "_pre_build_logic_input"
PRE_BUILD_BACKEND_INPUT_KEY = "_pre_build_backend_input"


def create_pre_build_clone(
    original: LlmAgent,
    state_key: str,
    label: str,
) -> LlmAgent:
    """Clone an agent for parallel execution with input read from a state key.

    The original agent's instruction provider is resolved once (safe because
    none of the pre-build providers read from context or session state). The
    clone receives its structured input via the instruction rather than via
    ADK's input_schema binding, which avoids conflicts when multiple agents
    share the same session conversation history.
    """
    base_instruction = original.instruction
    if callable(base_instruction):
        base_instruction = base_instruction(None)

    def instruction_provider(ctx, _base=base_instruction, _key=state_key):
        state_input = ctx.state.get(_key, "") if ctx else ""
        return (
            _base + "\n\n## YOUR INPUT\n"
            "Parse this JSON input and use the fields exactly as described above:\n"
            + state_input
            + "\n"
        )

    return LlmAgent(
        name=f"{original.name}_{label}",
        model=original.model,
        description=original.description,
        instruction=instruction_provider,
        input_schema=None,
        tools=original.tools,
        planner=original.planner,
        output_key=f"pre_build_result_{label}",
    )


async def run_pre_build_parallel(
    ctx: InvocationContext,
    ds_agent: LlmAgent,
    ds_input_json: str,
    logic_agent: Optional[LlmAgent],
    logic_input_json: Optional[str],
    backend_agent: Optional[LlmAgent],
    backend_input_json: Optional[str],
) -> AsyncGenerator[Event, None]:
    """Run pre-build agents (DS + optional Logic + optional Backend) in parallel.

    Sets each agent's input into a named state key, creates clones, and
    runs them via TimeoutParallelAgent.  After completion, callers should
    load artifacts the same way the sequential path does.
    """
    ctx.session.state[PRE_BUILD_DS_INPUT_KEY] = ds_input_json

    clones = [create_pre_build_clone(ds_agent, PRE_BUILD_DS_INPUT_KEY, "ds")]

    if logic_agent and logic_input_json:
        ctx.session.state[PRE_BUILD_LOGIC_INPUT_KEY] = logic_input_json
        clones.append(create_pre_build_clone(logic_agent, PRE_BUILD_LOGIC_INPUT_KEY, "logic"))

    if backend_agent and backend_input_json:
        ctx.session.state[PRE_BUILD_BACKEND_INPUT_KEY] = backend_input_json
        clones.append(create_pre_build_clone(backend_agent, PRE_BUILD_BACKEND_INPUT_KEY, "backend"))

    agent_names = [c.name for c in clones]
    logger.info(
        "[ParallelPreBuild] Starting parallel pre-build",
        agents=agent_names,
        agent_count=len(clones),
        timeout=PARALLEL_INITIAL_BUILDERS_TIMEOUT,
    )

    parallel_agent = TimeoutParallelAgent(
        name="ParallelPreBuild",
        sub_agents=clones,
        timeout_seconds=PARALLEL_INITIAL_BUILDERS_TIMEOUT,
    )

    try:
        async for event in parallel_agent._run_async_impl(ctx):
            yield event
    except TimeoutError as exc:
        logger.error(
            "[ParallelPreBuild] Timed out waiting for pre-build agents",
            agents=agent_names,
            timeout=PARALLEL_INITIAL_BUILDERS_TIMEOUT,
        )
        raise PipelineError(
            f"Parallel pre-build timed out after {PARALLEL_INITIAL_BUILDERS_TIMEOUT}s "
            f"(agents: {', '.join(agent_names)})",
            step_name="ParallelPreBuild",
        ) from exc

    logger.info("[ParallelPreBuild] Parallel pre-build complete", agents=agent_names)
