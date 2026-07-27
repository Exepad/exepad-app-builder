"""Base workflow interface for all app types."""

from abc import ABC, abstractmethod
from typing import AsyncGenerator, Optional

import structlog
from google.adk.agents import LlmAgent
from google.adk.events import Event
from google.adk.agents.invocation_context import InvocationContext

from config import get_agent_model_name
from ...models.timing_tracker import MetricsTracker
from main_agent.agents.utils.artifact_manager import ArtifactManager

logger = structlog.get_logger(__name__)


class BaseWorkflow(ABC):
    """
    Abstract base class for app type workflows.

    All app type workflows (creation, editing) should inherit from this class
    and implement the execute method.
    """

    @abstractmethod
    async def execute(
        self, ctx: InvocationContext, progress_tracker
    ) -> AsyncGenerator[Event, None]:
        """
        Execute the workflow.

        Args:
            ctx: The invocation context containing session state and services
            progress_tracker: Progress tracker for reporting progress

        Yields:
            Events to be sent to the client
        """

    async def _run_agent_with_metrics(
        self,
        ctx: InvocationContext,
        agent: LlmAgent,
        agent_name: str,
        metrics_tracker: Optional[MetricsTracker],
    ) -> AsyncGenerator[Event, None]:
        """Run an agent with metrics tracking (no retry/validation)."""
        if metrics_tracker:
            try:
                model = get_agent_model_name(agent_name)
            except KeyError:
                model = None
            await metrics_tracker.start_agent(ctx, agent_name, model=model)

        # Save agent input as artifact
        input_data = ctx.session.state.get("last_prompt_to_agent")
        await ArtifactManager.save_agent_io_artifact(ctx, agent_name, "input", input_data)

        try:
            async for event in agent.run_async(ctx):
                if metrics_tracker and hasattr(event, "usage_metadata") and event.usage_metadata:
                    await metrics_tracker.record_tokens(ctx, event.usage_metadata, agent_name)
                yield event

            # Save agent output as artifact
            output_key = getattr(agent, "output_key", None)
            if output_key:
                agent_output = ctx.session.state.get(output_key)
                if agent_output is not None:
                    await ArtifactManager.save_agent_io_artifact(
                        ctx, agent_name, "output", agent_output
                    )
        finally:
            if metrics_tracker:
                agent_metrics = await metrics_tracker.stop_agent(ctx)
                if agent_metrics:
                    logger.info(
                        f"[{agent_name}] Total execution time: " f"{agent_metrics['duration']:.2f}s"
                    )
