import structlog

from .agents.orchestrator import PipelineOrchestrator
from google.adk.apps.app import App
from google.adk.plugins.save_files_as_artifacts_plugin import SaveFilesAsArtifactsPlugin
from google.adk.plugins import ReflectAndRetryToolPlugin
from google.adk.agents.context_cache_config import ContextCacheConfig

from .agents.orchestrator.app_types.shared.subagents import (
    app_help_desk_agent,
    result_response_writer_agent,
)

logger = structlog.get_logger(__name__)

logger.info("initializing_pipeline_orchestrator")

root_agent = PipelineOrchestrator(
    name="ExepadMasterAgent",
    app_help_desk_agent=app_help_desk_agent,
    result_response_writer_agent=result_response_writer_agent,
)

app = App(
    name="orchestrator",
    root_agent=root_agent,
    # ReflectAndRetry is disabled (max_retries=0). Validation runs once at
    # save; failures ship as warnings or stubs per the simplification's
    # single-attempt contract. Auto-retry contradicts that — the prior
    # ``max_retries=3`` amplified false-positive validation errors into
    # 6+ minute, $0.20+ retry loops on a single failed component.
    #
    # throw_exception_if_retry_exceeded=False: a tool error (e.g. an LLM calling
    # a tool that isn't registered) returns a guidance message to the model
    # instead of re-raising. The default (True) re-raises and aborts the entire
    # SSE stream, surfacing as a generic "Something went wrong" with no recovery
    # (mw4h37zf 2026-05-20: a missing load_artifacts tool crashed the whole
    # handler-edit turn).
    plugins=[
        SaveFilesAsArtifactsPlugin(),
        ReflectAndRetryToolPlugin(max_retries=0, throw_exception_if_retry_exceeded=False),
    ],
    context_cache_config=ContextCacheConfig(
        min_tokens=2048,
        ttl_seconds=1800,
        cache_intervals=10,
    ),
)
