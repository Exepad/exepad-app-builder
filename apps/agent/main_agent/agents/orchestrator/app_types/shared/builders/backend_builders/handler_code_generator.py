"""
Handler Code Generator -- generates backend handler TSX artifacts.

Takes handler plans + model plans from the creator and runs
``backend_handler_builder_agent`` ONCE PER HANDLER, sequentially, with a
singular ``BackendHandlerBuilderInput``. A short-lived batched LLM-driven
loop (commits af553249→cd07d957 on 2026-04-02) was reverted on
2026-05-19 after Pro started bailing mid-batch on the 1ybz1p4n build.
See ``generate_handler_code_artifacts`` for the dispatch loop.

Output: handler_code:*.tsx artifacts.
"""

import json
from typing import AsyncGenerator, List, Tuple

from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event

from google.genai import types as genai_types

from .backend_handler_builder import (
    BackendHandlerBuilderInput,
    backend_handler_builder_agent,
)
from .artifact_tools import HANDLER_ARTIFACT_PREFIX
from .handler_failure_service import build_placeholder_handler_tsx
from ...models.plan_models import HandlerPlan, ModelPlan
from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.agents.utils.helpers import push_prompt_to_next_agent
from main_agent.agents.orchestrator.models import MetricsTracker
from main_agent.errors import BuilderError, ErrorSeverity
from config import (
    AgentName,
    BACKEND_HANDLER_ESCALATION_RETRY,
    BACKEND_HANDLER_STUB_FALLBACK,
    get_agent_model_name,
)

import structlog

logger = structlog.get_logger(__name__)


def _get_expected_artifact_filename(handler_input: BackendHandlerBuilderInput) -> str:
    """Compute the expected artifact filename for a handler input."""
    return f"{HANDLER_ARTIFACT_PREFIX}{handler_input.output_artifact_name}.tsx"


async def _check_saved_artifacts(
    ctx: InvocationContext,
    inputs: List[BackendHandlerBuilderInput],
    agent_label: str,
) -> Tuple[List[str], List[BackendHandlerBuilderInput]]:
    """Verify which artifacts were actually saved after agent execution."""
    saved: List[str] = []
    missing: List[BackendHandlerBuilderInput] = []

    for handler_input in inputs:
        filename = _get_expected_artifact_filename(handler_input)
        artifact = await ArtifactManager.load_artifact_as_string(ctx, filename)
        if artifact is not None:
            saved.append(filename)
        else:
            missing.append(handler_input)

    if saved:
        logger.info(
            f"[{agent_label}] Artifact verification: {len(saved)}/{len(inputs)} saved",
            saved=[s.split(":")[-1] for s in saved],
        )
    if missing:
        missing_names = [h.output_artifact_name for h in missing]
        logger.warning(
            f"[{agent_label}] Artifact verification: {len(missing)}/{len(inputs)} MISSING",
            missing=missing_names,
        )

    return saved, missing


async def _run_one_handler(
    ctx: InvocationContext,
    handler_input: BackendHandlerBuilderInput,
    sub_label: str,
    metrics_tracker: MetricsTracker,
    agent_label: str,
) -> AsyncGenerator[Event, None]:
    """Dispatch ONE handler build (fresh save budget) and yield its ADK events.

    Resets the per-handler ``_save_tool_calls`` counter so the
    ``_MAX_TOTAL_SAVE_CALLS`` cap applies per dispatch (and the escalation retry
    gets a fresh budget). Swallows + logs agent exceptions; the post-loop
    artifact verification surfaces a missing artifact. Shared by the main loop
    and the Lever-B escalation retry so both dispatch identically.
    """
    handler_name = handler_input.output_artifact_name
    logger.info(f"[{sub_label}] Starting handler build")
    ctx.session.state[f"_save_tool_calls:{handler_name}"] = 0
    await push_prompt_to_next_agent(ctx, json.dumps(handler_input.model_dump()))
    try:
        async for event in backend_handler_builder_agent.run_async(ctx):
            if hasattr(event, "usage_metadata") and event.usage_metadata:
                await metrics_tracker.record_tokens(ctx, event.usage_metadata, agent_label)
            yield event
    except Exception as e:  # noqa: BLE001
        # Continue with the remaining handlers; artifact verification surfaces
        # the missing artifact (then retry / stub / abort handles it).
        logger.error(f"[{sub_label}] handler invocation raised", error=str(e))


async def _save_placeholder_handler(ctx: InvocationContext, handler_name: str) -> None:
    """Write a deterministic crash-safe stub handler artifact (Lever C).

    Mirrors the handler save tool's write (``handler_code:{name}.tsx``,
    ``text/plain``) so deploy provisions it normally — upholding the 1ybz1p4n
    guarantee that the artifact always exists.
    """
    code = build_placeholder_handler_tsx(handler_name)
    filename = f"{HANDLER_ARTIFACT_PREFIX}{handler_name}.tsx"
    await ctx.artifact_service.save_artifact(
        session_id=ctx.session.id,
        user_id=ctx.session.user_id,
        app_name=ctx.session.app_name,
        filename=filename,
        artifact=genai_types.Part.from_bytes(data=code.encode("utf-8"), mime_type="text/plain"),
    )


async def _retry_missing_handlers(
    ctx: InvocationContext,
    missing: List[BackendHandlerBuilderInput],
    agent_label: str,
) -> AsyncGenerator[Event, None]:
    """Lever B — re-dispatch each no-artifact handler ONCE. Yields ADK events."""
    retry_names = [h.output_artifact_name for h in missing]
    logger.warning(
        f"[{agent_label}] Escalation retry: re-dispatching "
        f"{len(missing)} handler(s) that produced no artifact",
        handlers=retry_names,
    )
    retry_metrics = MetricsTracker()
    await retry_metrics.start_agent(
        ctx, agent_label, model=get_agent_model_name(AgentName.BACKEND_HANDLER_BUILDER)
    )
    try:
        for handler_input in list(missing):
            sub_label = f"{agent_label}[retry:{handler_input.output_artifact_name}]"
            async for event in _run_one_handler(
                ctx, handler_input, sub_label, retry_metrics, agent_label
            ):
                yield event
    finally:
        await retry_metrics.stop_agent(ctx)


async def _finalize_handler_outcome(
    ctx: InvocationContext,
    saved_artifacts: List[str],
    missing: List[BackendHandlerBuilderInput],
    output_summary: dict,
    total_requested: int,
    agent_label: str,
) -> None:
    """Record built/missing, then ship stubs (Lever C) or raise (strict abort).

    Stub fallback writes a crash-safe stub for each still-missing handler so the
    artifact exists at deploy (upholds 1ybz1p4n) and the build continues to the
    frontend. Strict mode (stub fallback off) preserves the original fail-fast.
    """
    output_summary["handlers_built"] = [
        a.split(":")[-1].removesuffix(".tsx") for a in saved_artifacts
    ]
    output_summary["missing"] = [h.output_artifact_name for h in missing]

    if not missing:
        output_summary["status"] = "success"
        logger.info(
            f"[{agent_label}] Code generation complete: "
            f"{len(saved_artifacts)}/{total_requested} handlers built"
        )
        return

    missing_names = output_summary["missing"]
    if BACKEND_HANDLER_STUB_FALLBACK:
        for handler_input in missing:
            await _save_placeholder_handler(ctx, handler_input.output_artifact_name)
        output_summary["stubbed"] = missing_names
        output_summary["status"] = "partial"
        logger.warning(
            f"[{agent_label}] {len(missing_names)} handler(s) failed to generate "
            f"after retry — shipped crash-safe stub(s); build continues",
            stubbed=missing_names,
            built=output_summary["handlers_built"],
        )
        return

    output_summary["status"] = "failed"
    logger.error(
        f"[{agent_label}] {len(missing)} handlers failed to generate",
        missing=missing_names,
    )
    # Strict-abort mode (stub fallback off): preserve the original fail-fast.
    # Without a stub or raise, deploy would later abort at `provision` with
    # "Handler not found in R2" while the user was told the build succeeded
    # (1ybz1p4n, 2026-05-19).
    raise BuilderError(
        (
            f"BackendHandlerBuilder produced "
            f"{len(saved_artifacts)}/{total_requested} handlers; "
            f"missing: {missing_names}. Cannot continue — "
            f"components would have no backend."
        ),
        builder_name="BackendHandlerBuilder",
        severity=ErrorSeverity.FATAL,
        context={
            "built": output_summary["handlers_built"],
            "missing": missing_names,
            "total_requested": total_requested,
        },
    )


def _coerce_plans(
    handler_plans: list[dict] | list[HandlerPlan],
    model_plans: list[dict] | list[ModelPlan],
) -> tuple[list[HandlerPlan], list[ModelPlan]]:
    """Coerce dict lists to typed Pydantic models if needed."""
    handlers = [
        h if isinstance(h, HandlerPlan) else HandlerPlan.model_validate(h) for h in handler_plans
    ]
    models = [m if isinstance(m, ModelPlan) else ModelPlan.model_validate(m) for m in model_plans]
    return handlers, models


async def generate_handler_code_artifacts(
    ctx: InvocationContext,
    handler_plans: list[dict] | list[HandlerPlan],
    model_plans: list[dict] | list[ModelPlan],
    agent_label: str = "CodeGenerator",
) -> AsyncGenerator[Event, None]:
    """Generate handler TSX code artifacts.

    Args:
        ctx: The invocation context
        handler_plans: Handler definitions (dicts or HandlerPlan objects)
        model_plans: All model definitions (dicts or ModelPlan objects)
        agent_label: Label for logging

    Yields:
        Events from per-handler code generation.

    Dispatch is one LLM invocation per handler with a singular
    ``BackendHandlerBuilderInput`` — matching ComponentBuilder's
    per-component pattern. A batched LLM-driven loop was tried briefly
    (commits af553249→cd07d957 on 2026-04-02) and reverted on 2026-05-19
    after Pro started bailing mid-batch on the 1ybz1p4n build (5 handlers
    planned, 0 saved, deploy aborted at provision).
    """
    handlers, models = _coerce_plans(handler_plans, model_plans)
    tsx_inputs: list[BackendHandlerBuilderInput] = []

    for handler in handlers:
        tsx_inputs.append(
            BackendHandlerBuilderInput(
                handler_plan=handler,
                model_plans=models,
                output_artifact_name=handler.name,
            )
        )
        logger.info(f"[{agent_label}] Prepared handler task: {handler.name}")

    if not tsx_inputs:
        logger.info(f"[{agent_label}] No handlers to generate -- skipping")
        return

    total_requested = len(tsx_inputs)
    logger.info(f"[{agent_label}] Generating {total_requested} handler code artifacts")

    # Inject full model shape (name + columns) for semantic validation so the
    # handler SQL column-reference + enum-case rules can see the schema, not
    # just table names. The import auto-fixer derives names from this in the
    # save tool.
    ctx.session.state["_validation_context_models"] = [m.model_dump() for m in models if m.name]

    # Inject per-handler expected outputs for return-field validation
    handler_expected_outputs: dict[str, list[str]] = {}
    for handler in handlers:
        handler_expected_outputs[handler.name] = handler.outputs
    ctx.session.state["_validation_handler_expected_outputs"] = handler_expected_outputs

    # Snapshot the BackendBuilder input for post-mortem debugging. Mirrors
    # the agent_io_*.json files Creator / DesignSystemBuilder / PreCreator
    # persist via base_workflow._run_agent_with_metrics. BackendBuilder
    # bypasses that wrapper, so we persist here at the dispatch layer.
    await ArtifactManager.save_agent_io_artifact(
        ctx,
        "BackendBuilder",
        "input",
        {
            "handlers": [inp.model_dump() for inp in tsx_inputs],
            "total_requested": total_requested,
            "agent_label": agent_label,
        },
    )

    # Track outcome for the output snapshot — populated incrementally so
    # the finally block has a meaningful payload even on raised exceptions
    # (cancellation, BuilderError, transient agent crash).
    output_summary: dict = {
        "handlers_requested": [inp.output_artifact_name for inp in tsx_inputs],
        "handlers_built": [],
        "missing": [],
        "total_requested": total_requested,
        "status": "in_progress",
    }

    try:
        # Per-handler sequential dispatch: one fresh LLM invocation per
        # handler. Total metrics aggregate across all invocations within
        # this single start_agent/stop_agent pair.
        metrics_tracker = MetricsTracker()
        # Read the actual configured model (env-overrideable per agent) so the
        # metric label matches what the LLM is actually being called with.
        # The previous hardcoded "gemini-3-flash-preview" misled 1ybz1p4n
        # diagnosis since the configured default flipped to Pro on
        # 2026-05-14 (commit c95559a1).
        await metrics_tracker.start_agent(
            ctx,
            agent_label,
            model=get_agent_model_name(AgentName.BACKEND_HANDLER_BUILDER),
        )

        try:
            for idx, handler_input in enumerate(tsx_inputs, start=1):
                sub_label = (
                    f"{agent_label}[{idx}/{total_requested}:"
                    f"{handler_input.output_artifact_name}]"
                )
                async for event in _run_one_handler(
                    ctx, handler_input, sub_label, metrics_tracker, agent_label
                ):
                    yield event
        finally:
            agent_metrics = await metrics_tracker.stop_agent(ctx)
            if agent_metrics:
                logger.info(
                    f"[{agent_label}] Total execution time: " f"{agent_metrics['duration']:.2f}s"
                )

        # Verify which artifacts were saved.
        saved_artifacts, missing = await _check_saved_artifacts(ctx, tsx_inputs, agent_label)

        # Lever B — one-shot retry of any handler that produced NO artifact
        # (single-turn no-save), then re-verify. Mirrors the frontend Fix 1C.
        if missing and BACKEND_HANDLER_ESCALATION_RETRY:
            async for event in _retry_missing_handlers(ctx, missing, agent_label):
                yield event
            saved_artifacts, missing = await _check_saved_artifacts(ctx, tsx_inputs, agent_label)

        # Lever C (or strict abort) — stub the still-missing handlers and
        # continue, or raise. Updates output_summary in place.
        await _finalize_handler_outcome(
            ctx, saved_artifacts, missing, output_summary, total_requested, agent_label
        )
    finally:
        # Persist the output snapshot regardless of success / fail-fast /
        # unexpected exception. The non-blocking save_agent_io_artifact
        # swallows its own errors internally.
        await ArtifactManager.save_agent_io_artifact(
            ctx, "BackendBuilder", "output", output_summary
        )
