"""Metrics tracker for agent and workflow execution: timing + token consumption."""

import time
from datetime import datetime, timezone
import structlog
from typing import Any, Dict, Optional, TypedDict
from google.adk.agents.invocation_context import InvocationContext
from google.genai.types import GenerateContentResponseUsageMetadata
from ...utils.helpers import push_session_state_update
from config import get_effective_model_name

logger = structlog.get_logger(__name__)


# Default token structure used throughout the tracker
def _empty_tokens() -> Dict:
    """Return empty token structure."""
    return {
        "total_tokens": 0,
        "prompt_tokens": 0,
        "candidates_tokens": 0,
        "thoughts_tokens": 0,
        "tool_use_tokens": 0,
        "cached_tokens": 0,
        "cost": 0.0,
    }


class AgentMetrics(TypedDict):
    """Metrics for a single agent execution."""

    duration: float
    total_tokens: int
    prompt_tokens: int
    candidates_tokens: int
    thoughts_tokens: int
    tool_use_tokens: int
    cached_tokens: int
    cost: float
    model: Optional[str]
    examples_used: Optional[Dict[str, str]]  # artifact_identifier -> example_id


class MetricsTracker:
    """
    Tracks execution time AND token consumption for agents and workflows.

    This class is stateless and stores metrics data in the InvocationContext session state.

    Session State Keys:
    - workflow_start_time: Start time of the workflow
    - agent_metrics: Dict[str, AgentMetrics] - Accumulated metrics per agent
    - current_agent_metrics: Name of the currently executing agent
    - current_agent_start_time: Start time of the current agent
    - current_agent_tokens: Accumulated tokens during current agent execution
    """

    def __init__(self):
        pass

    async def start_workflow(self, ctx: InvocationContext):
        """Start tracking workflow execution."""
        await push_session_state_update(
            ctx,
            {
                "workflow_start_time": time.time(),
                "workflow_start_iso": datetime.now(timezone.utc).isoformat(),
                "agent_metrics": {},
                "agent_examples_used": {},  # agent_name -> {artifact_identifier: example_id}
                "current_agent_metrics": None,
                "current_agent_start_time": None,
                "current_agent_tokens": _empty_tokens(),
                "current_agent_model": None,
                # Keep legacy keys for backward compatibility
                "agent_timings": {},
                "current_agent_timing": None,
                "current_agent_start_timing": None,
            },
        )
        logger.info("Started workflow metrics tracking")

    async def start_agent(
        self, ctx: InvocationContext, agent_name: str, model: Optional[str] = None
    ):
        """
        Start tracking an agent's execution.

        Args:
            ctx: Invocation context
            agent_name: Name of the agent being tracked
            model: Optional model name used by this agent (e.g., 'gemini-3-flash-preview')
        """
        current_agent = ctx.session.state.get("current_agent_metrics")

        if current_agent:
            logger.warning(f"Agent {current_agent} not stopped before starting {agent_name}")
            await self.stop_agent(ctx)

        await push_session_state_update(
            ctx,
            {
                "current_agent_metrics": agent_name,
                "current_agent_start_time": time.time(),
                # Capture the ISO timestamp at start too — used to build the
                # generation_steps audit log on stop_agent. Previously the
                # writer-on-stop path existed but no caller wrote the
                # started_at field, so debug/generation_steps.json shipped
                # empty (regression observed on coje33ih, 2026-05-12).
                "current_agent_start_iso": datetime.now(timezone.utc).isoformat(),
                "current_agent_tokens": _empty_tokens(),
                "current_agent_model": model,
                # Legacy keys
                "current_agent_timing": agent_name,
                "current_agent_start_timing": time.time(),
            },
        )
        logger.info(
            f"Started metrics tracking for {agent_name}" + (f" (model: {model})" if model else "")
        )

    async def record_tokens(
        self,
        ctx: InvocationContext,
        usage_metadata: GenerateContentResponseUsageMetadata,
        agent_name: Optional[str] = None,
    ):
        """
        Record token usage from an LLM event.

        Accumulates tokens during agent execution. Call this for each event
        that contains usage_metadata.

        Args:
            ctx: Invocation context
            usage_metadata: Token usage metadata from the LLM event
            agent_name: Optional agent name for logging (uses current agent if not provided)
        """
        current_tokens = ctx.session.state.get("current_agent_tokens", _empty_tokens())

        # Resolve the model that ACTUALLY served this agent under the current
        # provider (not the gemini-* base name) so cost is attributed to the
        # real model — Gemini SKUs, or OpenRouter/LiteLLM ids on self-host.
        log_agent_name = agent_name or ctx.session.state.get("current_agent_metrics", "Unknown")
        model = None
        try:
            model = get_effective_model_name(log_agent_name)
        except KeyError:
            pass  # Unknown agent, use default pricing

        from ..app_types.shared.services.pricing_service import calculate_cost

        cost = calculate_cost(usage_metadata, model=model)
        total_tokens = usage_metadata.total_token_count or 0
        prompt_tokens = usage_metadata.prompt_token_count or 0
        candidates_tokens = usage_metadata.candidates_token_count or 0
        thoughts_tokens = usage_metadata.thoughts_token_count or 0
        tool_use_tokens = usage_metadata.tool_use_prompt_token_count or 0
        cached_tokens = usage_metadata.cached_content_token_count or 0

        # Accumulate tokens (in case agent makes multiple LLM calls)
        new_tokens = {
            "total_tokens": current_tokens.get("total_tokens", 0) + total_tokens,
            "prompt_tokens": current_tokens.get("prompt_tokens", 0) + prompt_tokens,
            "candidates_tokens": current_tokens.get("candidates_tokens", 0) + candidates_tokens,
            "thoughts_tokens": current_tokens.get("thoughts_tokens", 0) + thoughts_tokens,
            "tool_use_tokens": current_tokens.get("tool_use_tokens", 0) + tool_use_tokens,
            "cached_tokens": current_tokens.get("cached_tokens", 0) + cached_tokens,
            "cost": current_tokens.get("cost", 0.0) + cost,
        }

        await push_session_state_update(ctx, {"current_agent_tokens": new_tokens})

        # Log the token usage (log_agent_name already set above for model lookup)
        logger.info(
            f"[{log_agent_name}] Token usage - "
            f"Total: {total_tokens}, Prompt: {prompt_tokens}, "
            f"Candidates: {candidates_tokens}, Thoughts: {thoughts_tokens}, "
            f"ToolUse: {tool_use_tokens}, Cached: {cached_tokens}, Cost: ${cost:.6f}"
        )

    async def record_agent_examples(
        self,
        ctx: InvocationContext,
        agent_name: str,
        examples: Dict[str, str],
    ):
        """
        Record which examples an agent utilized.

        Args:
            ctx: Invocation context
            agent_name: Name of the agent that used the examples
            examples: Mapping of artifact_identifier -> example_id
        """
        if not examples:
            return

        agent_examples = ctx.session.state.get("agent_examples_used", {})
        if agent_name in agent_examples:
            agent_examples[agent_name].update(examples)
        else:
            agent_examples[agent_name] = dict(examples)

        await push_session_state_update(ctx, {"agent_examples_used": agent_examples})
        logger.info(f"[{agent_name}] Recorded {len(examples)} example(s) utilized")

    async def stop_agent(self, ctx: InvocationContext) -> Optional[AgentMetrics]:
        """
        Stop tracking current agent and return its metrics.

        Returns:
            AgentMetrics dict with duration, tokens, cost, and model, or None if no agent was tracking
        """
        current_agent = ctx.session.state.get("current_agent_metrics")
        current_start = ctx.session.state.get("current_agent_start_time")
        current_tokens = ctx.session.state.get("current_agent_tokens", {})
        current_model = ctx.session.state.get("current_agent_model")

        if not current_agent or not current_start:
            return None

        duration = time.time() - current_start

        # Build metrics for this agent run
        agent_run_metrics: AgentMetrics = {
            "duration": duration,
            "total_tokens": current_tokens.get("total_tokens", 0),
            "prompt_tokens": current_tokens.get("prompt_tokens", 0),
            "candidates_tokens": current_tokens.get("candidates_tokens", 0),
            "thoughts_tokens": current_tokens.get("thoughts_tokens", 0),
            "tool_use_tokens": current_tokens.get("tool_use_tokens", 0),
            "cached_tokens": current_tokens.get("cached_tokens", 0),
            "cost": current_tokens.get("cost", 0.0),
            "model": current_model,
        }

        # Accumulate if agent was called multiple times
        agent_metrics = ctx.session.state.get("agent_metrics", {})
        if current_agent in agent_metrics:
            existing = agent_metrics[current_agent]
            agent_metrics[current_agent] = {
                "duration": existing["duration"] + duration,
                "total_tokens": existing["total_tokens"] + agent_run_metrics["total_tokens"],
                "prompt_tokens": existing["prompt_tokens"] + agent_run_metrics["prompt_tokens"],
                "candidates_tokens": existing["candidates_tokens"]
                + agent_run_metrics["candidates_tokens"],
                "thoughts_tokens": existing["thoughts_tokens"]
                + agent_run_metrics["thoughts_tokens"],
                "tool_use_tokens": existing["tool_use_tokens"]
                + agent_run_metrics["tool_use_tokens"],
                "cached_tokens": existing["cached_tokens"] + agent_run_metrics["cached_tokens"],
                "cost": existing["cost"] + agent_run_metrics["cost"],
                "model": current_model
                or existing.get("model"),  # Keep first model if multiple runs
            }
        else:
            agent_metrics[current_agent] = agent_run_metrics

        # Also update legacy agent_timings for backward compatibility
        agent_timings = ctx.session.state.get("agent_timings", {})
        if current_agent in agent_timings:
            agent_timings[current_agent] += duration
        else:
            agent_timings[current_agent] = duration

        # Append a generation_steps record so debug/generation_steps.json
        # has a per-agent audit trail. Field shape mirrors agent_metrics
        # plus the wall-clock window for readability.
        start_iso = ctx.session.state.get("current_agent_start_iso")
        finished_iso = datetime.now(timezone.utc).isoformat()
        step_record = {
            "name": current_agent,
            "started_at": start_iso,
            "finished_at": finished_iso,
            "duration_sec": duration,
            "model": current_model,
            "total_tokens": agent_run_metrics["total_tokens"],
            "cached_tokens": agent_run_metrics["cached_tokens"],
            "cost": agent_run_metrics["cost"],
        }
        steps_list = list(ctx.session.state.get("generation_steps", []) or [])
        steps_list.append(step_record)

        await push_session_state_update(
            ctx,
            {
                "agent_metrics": agent_metrics,
                "current_agent_metrics": None,
                "current_agent_start_time": None,
                "current_agent_start_iso": None,
                "current_agent_tokens": _empty_tokens(),
                "current_agent_model": None,
                "generation_steps": steps_list,
                # Legacy keys
                "agent_timings": agent_timings,
                "current_agent_timing": None,
                "current_agent_start_timing": None,
            },
        )

        logger.info(
            f"{current_agent} completed - "
            f"Duration: {duration:.2f}s, "
            f"Tokens: {agent_run_metrics['total_tokens']}, "
            f"Cost: ${agent_run_metrics['cost']:.6f}"
        )
        return agent_run_metrics

    def get_workflow_duration(self, ctx: InvocationContext) -> Optional[float]:
        """Get total workflow execution time."""
        workflow_start_time = ctx.session.state.get("workflow_start_time")
        if not workflow_start_time:
            return None
        return time.time() - workflow_start_time

    def get_workflow_start_iso(self, ctx: InvocationContext) -> Optional[str]:
        """Get workflow start time as ISO 8601 timestamp."""
        return ctx.session.state.get("workflow_start_iso")

    def get_agent_metrics(self, ctx: InvocationContext) -> Dict[str, AgentMetrics]:
        """Get all agent metrics (timing + tokens)."""
        return ctx.session.state.get("agent_metrics", {}).copy()

    def get_agent_timings(self, ctx: InvocationContext) -> Dict[str, float]:
        """Get all agent execution times (legacy compatibility method)."""
        return ctx.session.state.get("agent_timings", {}).copy()

    def get_summary(self, ctx: InvocationContext) -> Dict:
        """
        Get complete metrics summary.

        Returns:
            Dict with workflow_duration, workflow_start_iso, agent_metrics, and totals
        """
        workflow_duration = self.get_workflow_duration(ctx)
        workflow_start_iso = self.get_workflow_start_iso(ctx)
        agent_metrics = self.get_agent_metrics(ctx)

        # Aggregate totals
        total_agent_time = sum(m.get("duration", 0) for m in agent_metrics.values())
        total_tokens = sum(m.get("total_tokens", 0) for m in agent_metrics.values())
        total_prompt_tokens = sum(m.get("prompt_tokens", 0) for m in agent_metrics.values())
        total_candidates_tokens = sum(m.get("candidates_tokens", 0) for m in agent_metrics.values())
        total_thoughts_tokens = sum(m.get("thoughts_tokens", 0) for m in agent_metrics.values())
        total_tool_use_tokens = sum(m.get("tool_use_tokens", 0) for m in agent_metrics.values())
        total_cached_tokens = sum(m.get("cached_tokens", 0) for m in agent_metrics.values())
        total_cost = sum(m.get("cost", 0.0) for m in agent_metrics.values())

        agent_examples = ctx.session.state.get("agent_examples_used", {})
        image_stats = ctx.session.state.get("image_stats")

        return {
            "workflow_duration": workflow_duration,
            "workflow_start_iso": workflow_start_iso,
            "agent_metrics": agent_metrics,
            "agent_examples_used": agent_examples,
            "image_stats": image_stats,
            "totals": {
                "agent_time": total_agent_time,
                "overhead": workflow_duration - total_agent_time if workflow_duration else None,
                "total_tokens": total_tokens,
                "prompt_tokens": total_prompt_tokens,
                "candidates_tokens": total_candidates_tokens,
                "thoughts_tokens": total_thoughts_tokens,
                "tool_use_tokens": total_tool_use_tokens,
                "cached_tokens": total_cached_tokens,
                "cost": total_cost,
            },
            # Legacy format for backward compatibility
            "agent_timings": {name: m.get("duration", 0) for name, m in agent_metrics.items()},
            "total_agent_time": total_agent_time,
        }

    def format_summary(self, ctx: InvocationContext) -> str:
        """
        Get a human-readable formatted summary of workflow metrics.

        Returns:
            Formatted string with workflow metrics summary
        """
        summary = self.get_summary(ctx)
        workflow_duration = summary.get("workflow_duration", 0) or 0
        agent_metrics = summary.get("agent_metrics", {})
        totals = summary.get("totals", {})

        lines = []
        lines.append("")
        lines.append("=" * 80)
        lines.append("                         WORKFLOW METRICS SUMMARY")
        lines.append("=" * 80)
        lines.append("")

        # Workflow duration
        lines.append(f"  Total Workflow Duration: {workflow_duration:.2f}s")
        lines.append("")

        # Agent metrics table
        lines.append("  AGENT BREAKDOWN")
        lines.append("  " + "-" * 76)
        lines.append(f"  {'Agent Name':<40} {'Duration':>10} {'Tokens':>10} {'Cost':>12}")
        lines.append("  " + "-" * 76)

        # Sort agents by duration (descending)
        sorted_agents = sorted(
            agent_metrics.items(), key=lambda x: x[1].get("duration", 0), reverse=True
        )

        for agent_name, metrics in sorted_agents:
            duration = metrics.get("duration", 0)
            tokens = metrics.get("total_tokens", 0)
            cost = metrics.get("cost", 0.0)

            # Truncate long agent names
            display_name = agent_name[:38] + ".." if len(agent_name) > 40 else agent_name
            lines.append(
                f"  {display_name:<40} {duration:>9.2f}s {tokens:>10,} {f'${cost:.4f}':>12}"
            )

        lines.append("  " + "-" * 76)

        # Totals
        total_agent_time = totals.get("agent_time", 0)
        overhead = totals.get("overhead", 0) or 0
        total_tokens = totals.get("total_tokens", 0)
        total_prompt = totals.get("prompt_tokens", 0)
        total_candidates = totals.get("candidates_tokens", 0)
        total_thoughts = totals.get("thoughts_tokens", 0)
        total_tool_use = totals.get("tool_use_tokens", 0)
        total_cached = totals.get("cached_tokens", 0)
        total_cost = totals.get("cost", 0.0)

        lines.append(
            f"  {'TOTALS':<40} {total_agent_time:>9.2f}s {total_tokens:>10,} {f'${total_cost:.4f}':>12}"
        )
        lines.append("")

        # Token breakdown
        lines.append("  TOKEN BREAKDOWN")
        lines.append("  " + "-" * 40)
        lines.append(f"    Prompt Tokens:     {total_prompt:>15,}")
        lines.append(f"    Candidate Tokens:  {total_candidates:>15,}")
        lines.append(f"    Thoughts Tokens:   {total_thoughts:>15,}")
        lines.append(f"    Tool Use Tokens:   {total_tool_use:>15,}")
        lines.append(f"    Cached Tokens:     {total_cached:>15,}")
        lines.append("  " + "-" * 40)
        lines.append(f"    Total Tokens:      {total_tokens:>15,}")
        lines.append("")

        # Timing breakdown
        lines.append("  TIMING BREAKDOWN")
        lines.append("  " + "-" * 40)
        lines.append(f"    Agent Execution:   {total_agent_time:>14.2f}s")
        lines.append(f"    Overhead:          {overhead:>14.2f}s")
        lines.append(f"    Total Duration:    {workflow_duration:>14.2f}s")
        lines.append("")

        # Cost summary
        lines.append("  COST SUMMARY")
        lines.append("  " + "-" * 40)
        lines.append(f"    Total Cost:              ${total_cost:.4f}")
        lines.append("")

        # Image stats
        image_stats = ctx.session.state.get("image_stats")
        if image_stats:
            lines.append("  IMAGE SOURCES")
            lines.append("  " + "-" * 40)
            lines.append(f"    Pexels Images:     {image_stats.get('Pexels', 0):>15}")
            lines.append(f"    Pixabay Images:    {image_stats.get('Pixabay', 0):>15}")
            lines.append(f"    Unsplash Images:   {image_stats.get('Unsplash', 0):>15}")
            lines.append(f"    Openverse Images:  {image_stats.get('Openverse', 0):>15}")
            lines.append(f"    User Images:       {image_stats.get('User', 0):>15}")
            lines.append("")

        # Examples utilized by agents
        agent_examples = summary.get("agent_examples_used", {})
        if agent_examples:
            lines.append("  EXAMPLES UTILIZED BY AGENTS")
            lines.append("  " + "-" * 76)

            for ex_agent_name, examples_map in sorted(agent_examples.items()):
                if not examples_map:
                    continue
                # Collect unique example IDs
                unique_examples = sorted(set(examples_map.values()))
                display_name = (
                    ex_agent_name[:38] + ".." if len(ex_agent_name) > 40 else ex_agent_name
                )
                lines.append(f"  {display_name:<40} {len(unique_examples)} unique example(s)")
                for example_id in unique_examples:
                    # Find which components used this example
                    components = sorted(k for k, v in examples_map.items() if v == example_id)
                    comp_list = ", ".join(components[:3])
                    if len(components) > 3:
                        comp_list += f", +{len(components) - 3} more"
                    lines.append(f"    {example_id:<36} ({comp_list})")

            lines.append("  " + "-" * 76)
            lines.append("")

        # Surveyor Phase 2 — Class B runtime probe telemetry. Each Class B
        # tool wrapper appends to ``runtime_probe_log`` in session state
        # (see surveyor_tools._record_probe). Aggregated here so the per-
        # turn cost-vs-baseline budget stays visible in the same summary
        # the rest of the workflow reports against.
        probe_log = ctx.session.state.get("runtime_probe_log")
        if isinstance(probe_log, list) and probe_log:
            buckets: dict[str, dict[str, Any]] = {}
            for entry in probe_log:
                if not isinstance(entry, dict):
                    continue
                tool_name = str(entry.get("tool", "unknown"))
                bucket = buckets.setdefault(
                    tool_name,
                    {"calls": 0, "total_ms": 0, "errors": 0, "bytes": 0},
                )
                bucket["calls"] += 1
                duration = entry.get("duration_ms")
                if isinstance(duration, (int, float)):
                    bucket["total_ms"] += int(duration)
                if entry.get("error"):
                    bucket["errors"] += 1
                size = entry.get("byte_size")
                if isinstance(size, (int, float)):
                    bucket["bytes"] += int(size)

            total_probe_ms = sum(b["total_ms"] for b in buckets.values())
            lines.append("  RUNTIME PROBES SUMMARY")
            lines.append("  " + "-" * 76)
            lines.append(
                f"  {'Tool':<32} {'Calls':>6} {'Total ms':>10} {'Errors':>8} {'Bytes':>10}"
            )
            lines.append("  " + "-" * 76)
            for tool_name in sorted(buckets):
                b = buckets[tool_name]
                lines.append(
                    f"  {tool_name:<32} {b['calls']:>6} {b['total_ms']:>10} "
                    f"{b['errors']:>8} {b['bytes']:>10}"
                )
            lines.append("  " + "-" * 76)
            lines.append(f"    Total probe overhead: {total_probe_ms / 1000:.2f}s")
            lines.append("")

        lines.append("=" * 80)
        lines.append("")

        return "\n".join(lines)
