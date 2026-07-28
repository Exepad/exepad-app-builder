"""
TimeoutParallelAgent — ParallelAgent subclass with configurable timeout.

Wraps the ADK ParallelAgent's _run_async_impl with asyncio.timeout()
to prevent indefinite hangs when a sub-agent's async generator stalls.

This is compatible with ADK's internal asyncio.TaskGroup-based execution:
- TimeoutError propagates into queue.get(), breaking the sentinel-wait loop
- TaskGroup.__aexit__ cancels all running sub-agent tasks
- ParallelAgent's finally block calls aclose() on all generators

Usage:
    from main_agent.agents.utils.timeout_parallel_agent import TimeoutParallelAgent

    agent = TimeoutParallelAgent(
        name="MyParallelAgent",
        sub_agents=[...],
        timeout_seconds=180.0,
    )
"""

import asyncio
from typing import AsyncGenerator, ClassVar, Optional

from typing_extensions import override

from google.adk.agents import ParallelAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.agents.parallel_agent_config import ParallelAgentConfig
from google.adk.events import Event

import structlog

logger = structlog.get_logger(__name__)

# Default timeout for parallel agent execution (seconds)
DEFAULT_PARALLEL_AGENT_TIMEOUT = 180.0


class TimeoutParallelAgent(ParallelAgent):
    """ParallelAgent with configurable execution timeout.

    If the parallel execution exceeds timeout_seconds, asyncio.TimeoutError
    is raised. The ADK's internal TaskGroup handles cancellation of all
    sub-agent tasks, and the finally block in ParallelAgent._run_async_impl
    calls aclose() on all generators for clean shutdown.

    Attributes:
        timeout_seconds: Maximum execution time in seconds. None disables timeout.
    """

    timeout_seconds: Optional[float] = DEFAULT_PARALLEL_AGENT_TIMEOUT

    config_type: ClassVar[type] = ParallelAgentConfig

    @override
    async def _run_async_impl(self, ctx: InvocationContext) -> AsyncGenerator[Event, None]:
        if self.timeout_seconds is None or self.timeout_seconds <= 0:
            # No timeout — delegate directly to parent
            async for event in super()._run_async_impl(ctx):
                yield event
            return

        try:
            async with asyncio.timeout(self.timeout_seconds):
                async for event in super()._run_async_impl(ctx):
                    yield event
        except TimeoutError:
            sub_agent_names = [sa.name for sa in self.sub_agents]
            logger.error(
                f"[{self.name}] ParallelAgent execution TIMED OUT after "
                f"{self.timeout_seconds}s. Sub-agents: {sub_agent_names}. "
                f"One or more sub-agent generators likely hung without "
                f"completing. Check if all sub-agents produced their expected "
                f"artifacts before the timeout."
            )
            # Re-raise as TimeoutError so callers can handle it
            # (e.g., check for partial artifacts, graceful degradation)
            raise
