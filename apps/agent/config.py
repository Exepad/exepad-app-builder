"""
Centralized configuration management for agent_service.
"""

import asyncio
import json
import logging
import os
import sys
import threading
from contextlib import aclosing
from enum import Enum
from functools import cached_property
from typing import Any, Optional

from google.adk.models import BaseLlm
from google.adk.models.google_llm import Gemini
from google.genai import types

logger = logging.getLogger(__name__)


class AgentName(str, Enum):
    """Agent name constants for type-safe model lookups."""

    # Backend Handler Builder (shared infrastructure)
    BACKEND_HANDLER_BUILDER = "BackendHandlerBuilder"

    # Response Writers
    RESULT_RESPONSE_WRITER = "ResultResponseWriter"

    # Shared Builders (logic, backend, seed)
    LOGIC_BUILDER = "LogicBuilder"
    BACKEND_MODEL_BUILDER = "BackendModelBuilder"
    SEED_DATA_BUILDER = "SeedDataBuilder"

    # Help and Support
    APP_HELP_DESK = "AppHelpDesk"

    # App Building Agents
    CREATOR = "Creator"
    PLANNER = "Planner"  # Deprecated: use CREATOR
    COMPONENT_BUILDER = "ComponentBuilder"
    COMPONENT_BUILDER_MULTIPLE = "ComponentBuilderMultiple"
    # Narrow polish-mode variant dispatched only from DesignImportWorkflow
    # (see EditingWorkflow._run_phase_frontend_build routing). Shares the
    # input schema, output key, and validation chain with COMPONENT_BUILDER_MULTIPLE,
    # but loads a 3-skill catalogue (`component-editing`, `state-hooks`,
    # `theme-token-migration`) and a "translation polish" prompt that forbids
    # invention/regeneration of source design content. Edit-only tools (no
    # `validate_and_save_*` full-file writes; `edit_artifact_tool` only). See
    # ~/.claude/plans/create-a-full-fix-modular-horizon.md Track 3.
    COMPONENT_BUILDER_MULTIPLE_POLISH = "ComponentBuilderMultiplePolish"
    DESIGN_SYSTEM_BUILDER = "DesignSystemBuilder"
    EDITOR = "Editor"

    # Blog
    BLOG_POST_CREATOR = "BlogPostCreator"

    # Pre-processing
    PRE_CREATOR = "PreCreator"

    # Design-bundle imports (Stitch, Claude Design)
    DESIGN_IMPORTER = "DesignImporter"

    # Diagnostic grounding pre-pass for the Editor (read-only).
    # Loads an AgentSkills.io-spec SKILL.md profile chosen by AppHelpDesk
    # (bug-root-cause / integration-context / referent-and-current-state /
    # cascade-enumeration), runs the field-mismatch sweep + prior-turn
    # diff, emits a DiagnosticReport that the Editor consumes.
    SURVEYOR = "Surveyor"

    # Data Ingester — slim LlmAgent that turns backend-typed sidecar JSONL
    # (Excel/CSV today; PDF/DOCX/PPTX post BE-1/BE-3) into ProposedModel
    # records the Creator/Editor flow consumes. Structured-input only;
    # no tools, no skills, no code executor. Single-call agent.
    DATA_INGESTER = "DataIngester"


# Default model per agent — overridable via env var {AGENT_NAME}_MODEL
# e.g. CREATOR_MODEL=gemini-3-pro-preview overrides the default
_AGENT_MODEL_DEFAULTS = {
    # Backend Handler Builder (shared infrastructure)
    # Promoted to pro tier — handler SQL generation requires reasoning about
    # ownerScope ("shared" vs "user") to avoid emitting `WHERE owner_id = ?`
    # on shared-scope models (r3hfcgx5 + 1jr5js68 regressions, 2026-05-14).
    AgentName.BACKEND_HANDLER_BUILDER: "gemini-3.1-pro-preview",
    # Response Writer Models
    AgentName.RESULT_RESPONSE_WRITER: "gemini-3-flash-preview",
    # Shared Builder Models
    AgentName.LOGIC_BUILDER: "gemini-3-flash-preview",
    AgentName.BACKEND_MODEL_BUILDER: "gemini-3-flash-preview",
    AgentName.SEED_DATA_BUILDER: "gemini-3-flash-preview",
    # Help and Support Models
    AgentName.APP_HELP_DESK: "gemini-3-flash-preview",
    # App Building Models
    AgentName.CREATOR: "gemini-3-flash-preview",
    AgentName.PLANNER: "gemini-3-flash-preview",  # Deprecated alias
    # Promoted to pro tier (2026-05-14) — single-component TSX generation
    # was regressing on data-display correctness (r3hfcgx5: Math.random in
    # DashboardContent, dead Export CSV button, arbitrary hex colors,
    # navigate('/logout') to a non-existent route). Flash kept catching
    # syntax + style coverage but the semantic/intent quality dropped.
    AgentName.COMPONENT_BUILDER: "gemini-3-flash-preview",
    # ComponentBuilderMultiple is the multi-file worker (cross-file refactors).
    # Pro tier — autonomous discovery + cross-file edits benefit materially
    # from reasoning-heavy capacity.
    AgentName.COMPONENT_BUILDER_MULTIPLE: "gemini-3-flash-preview",
    # Same model as COMPONENT_BUILDER_MULTIPLE — only the toolset + prompt
    # differ. Override independently via `COMPONENT_BUILDER_MULTIPLE_POLISH_MODEL`.
    AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH: "gemini-3-flash-preview",
    AgentName.DESIGN_SYSTEM_BUILDER: "gemini-3-flash-preview",
    # Editor is the planner-side reasoning seat in the new architecture
    # (synthesizes natural-language prompts, decides when to pair handler/model
    # actions with FrontendBuildAction, performs cross-domain orchestration).
    AgentName.EDITOR: "gemini-3-flash-preview",
    # Blog
    AgentName.BLOG_POST_CREATOR: "gemini-3-flash-preview",
    # Pre-processing
    AgentName.PRE_CREATOR: "gemini-3-flash-preview",
    # Design-bundle imports — uses the same flash tier as other builders.
    AgentName.DESIGN_IMPORTER: "gemini-3-flash-preview",
    # Surveyor — investigation is structured and tool-call-heavy rather than
    # reasoning-heavy. Flash is intentional; promote to pro only if eval data
    # shows confabulation or weak evidence selection on the bug-root-cause
    # profile.
    AgentName.SURVEYOR: "gemini-3-flash-preview",
    # DataIngester — judgment task (rename / target / domain_hints / notes)
    # over a structured input. Flash is intentional; no tools, no skills.
    AgentName.DATA_INGESTER: "gemini-3-flash-preview",
}


# Explicit env var mapping — no fragile PascalCase→UPPER_SNAKE_CASE conversion
_ENV_KEY_MAP: dict[AgentName, str] = {
    AgentName.BACKEND_HANDLER_BUILDER: "BACKEND_HANDLER_BUILDER_MODEL",
    AgentName.RESULT_RESPONSE_WRITER: "RESULT_RESPONSE_WRITER_MODEL",
    AgentName.LOGIC_BUILDER: "LOGIC_BUILDER_MODEL",
    AgentName.BACKEND_MODEL_BUILDER: "BACKEND_MODEL_BUILDER_MODEL",
    AgentName.SEED_DATA_BUILDER: "SEED_DATA_BUILDER_MODEL",
    AgentName.APP_HELP_DESK: "APP_HELP_DESK_MODEL",
    AgentName.CREATOR: "CREATOR_MODEL",
    AgentName.PLANNER: "PLANNER_MODEL",  # Deprecated alias
    AgentName.COMPONENT_BUILDER: "COMPONENT_BUILDER_MODEL",
    AgentName.COMPONENT_BUILDER_MULTIPLE: "COMPONENT_BUILDER_MULTIPLE_MODEL",
    AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH: "COMPONENT_BUILDER_MULTIPLE_POLISH_MODEL",
    AgentName.DESIGN_SYSTEM_BUILDER: "DESIGN_SYSTEM_BUILDER_MODEL",
    AgentName.EDITOR: "EDITOR_MODEL",
    # Blog
    AgentName.BLOG_POST_CREATOR: "BLOG_POST_CREATOR_MODEL",
    # Pre-processing
    AgentName.PRE_CREATOR: "PRE_CREATOR_MODEL",
    # Design-bundle imports
    AgentName.DESIGN_IMPORTER: "DESIGN_IMPORTER_MODEL",
    # Surveyor (diagnostic pre-pass)
    AgentName.SURVEYOR: "SURVEYOR_MODEL",
    # DataIngester (pre-pass for create/edit when tabular uploads present)
    AgentName.DATA_INGESTER: "DATA_INGESTER_MODEL",
}


# Deprecated env var aliases kept for backwards compatibility with older deploy
# files. These are warnings-only aliases: the current key should always be used
# going forward.
_LEGACY_ENV_KEY_ALIASES: dict[AgentName, tuple[str, ...]] = {
    AgentName.CREATOR: ("APP_CREATOR_MODEL", "CODEFOCUS_CREATOR_MODEL"),
    AgentName.EDITOR: ("APP_EDITOR_MODEL", "APP_EDITOR_QUICK_MODEL", "CODEFOCUS_EDITOR_MODEL"),
    AgentName.COMPONENT_BUILDER: (
        "TSX_COMPONENT_BUILDER_MODEL",
        "PARALLEL_TSX_COMPONENT_BUILDER_MODEL",
        "CODEFOCUS_COMPONENT_BUILDER_MODEL",
    ),
    AgentName.DESIGN_SYSTEM_BUILDER: (
        "THEME_BUILDER_MODEL",
        "THEME_CREATOR_MODEL",
        "CODEFOCUS_DESIGN_SYSTEM_BUILDER_MODEL",
    ),
    AgentName.LOGIC_BUILDER: ("CODEFOCUS_LOGIC_BUILDER_MODEL",),
    AgentName.BACKEND_MODEL_BUILDER: (
        "BACKEND_PROPS_BUILDER_MODEL",
        "CODEFOCUS_BACKEND_PROPS_BUILDER_MODEL",
    ),
    AgentName.SEED_DATA_BUILDER: ("CODEFOCUS_SEED_DATA_BUILDER_MODEL",),
    AgentName.BLOG_POST_CREATOR: (
        "APP_BLOGGER_MODEL",
        "APP_BLOG_WRITER_MODEL",
        "BLOGGING_MANAGER_MODEL",
    ),
}


_IGNORED_LEGACY_MODEL_ENV_KEYS = frozenset(
    {
        "APP_BUILDER_MODEL",
        "APP_PAGE_BUILDER_MODEL",
        "WEB_APP_BUILDER_MODEL",
        "WEB_APP_PAGE_BUILDER_MODEL",
        "WEBAPP_SKELETON_BUILDER_MODEL",
        "JSON_COMPONENT_BUILDER_MODEL",
        "PARALLEL_JSON_COMPONENT_BUILDER_MODEL",
        "APP_JSON_REPAIRER_MODEL",
        "APP_CONTENT_WRITER_MODEL",
        "APP_PAGE_PLANNER_MODEL",
        "CHAT_RESPONSE_WRITER_MODEL",
        "IMAGE_FINDER_MODEL",
        "ICON_FINDER_MODEL",
        "NAVIGATION_RESOLVER_MODEL",
        "APP_EXAMPLE_SELECTOR_MODEL",
    }
)


def _get_model_override(agent_name: AgentName, default_model: str) -> str:
    """Resolve model override from the current key, then deprecated aliases."""
    env_key = _ENV_KEY_MAP[agent_name]
    current_value = os.environ.get(env_key)
    if current_value:
        return current_value

    for legacy_key in _LEGACY_ENV_KEY_ALIASES.get(agent_name, ()):
        legacy_value = os.environ.get(legacy_key)
        if legacy_value:
            logger.warning(
                "Deprecated model env var %s is set for %s; rename it to %s.",
                legacy_key,
                agent_name.value,
                env_key,
            )
            return legacy_value

    return default_model


def _warn_on_ignored_legacy_model_keys() -> None:
    """Warn about legacy model env vars that no longer map to any live agent."""
    for legacy_key in sorted(_IGNORED_LEGACY_MODEL_ENV_KEYS):
        if os.environ.get(legacy_key):
            logger.warning(
                "Ignoring deprecated model env var %s; no current agent consumes it.",
                legacy_key,
            )


def _build_agent_models() -> dict:
    """Build AGENT_MODELS dict, allowing env var overrides per agent.

    For each agent, checks for an env var named per _ENV_KEY_MAP
    (e.g. CREATOR_MODEL, COMPONENT_BUILDER_MODEL).
    Falls back to the hardcoded default if no env var is set.
    """
    models = {}
    for agent_name, default_model in _AGENT_MODEL_DEFAULTS.items():
        models[agent_name] = _get_model_override(agent_name, default_model)
    _warn_on_ignored_legacy_model_keys()
    return models


AGENT_MODELS = _build_agent_models()

# Validation settings
MAX_REPAIR_ATTEMPTS = 6
MAX_RETRY_ATTEMPTS = 6

# Surveyor (read-only diagnostic pre-pass) attempt budget. Mirrors
# MAX_CREATOR_ATTEMPTS=2: a weak/non-Gemini model routinely returns a malformed
# or empty DiagnosticReport on attempt 1 (e.g. an empty `symptom` → pydantic
# ValidationError), which the retry machinery now classifies as retryable
# (is_output_schema_error). With only 1 attempt the Surveyor raised on the first
# bad roll and the Editor fell back to an EMPTY report on every off-Gemini edit —
# losing all diagnostic grounding. 2 lets the model self-correct on a re-roll
# (the same recovery proven for the Creator). The Surveyor is read-only, so a
# re-roll cannot mutate state or convert a refusal into a build.
MAX_SURVEYOR_ATTEMPTS = int(os.environ.get("MAX_SURVEYOR_ATTEMPTS", "2"))

# Timing settings
PER_PAGE_BUILDING_TIME = 60  # seconds
# Sessions are always cleaned up immediately after workflow completion
# (see cleanup() in agent_api.py). No expiry-based cleanup is needed.

# Parallel execution settings
MAX_CONCURRENT_SUB_AGENTS = 10  # Maximum concurrent sub-agents per batch


# Rate limit retry settings (for 429 RESOURCE_EXHAUSTED errors)
# These settings control exponential backoff behavior when hitting Vertex AI rate limits
RATE_LIMIT_MAX_RETRIES = 5  # Maximum retry attempts for 429 errors
RATE_LIMIT_INITIAL_DELAY = 2.0  # Initial delay in seconds before first retry
RATE_LIMIT_MAX_DELAY = 60.0  # Maximum delay between retries (cap for exponential backoff)
RATE_LIMIT_BACKOFF_MULTIPLIER = 2.0  # Multiplier for exponential backoff (delay doubles each retry)
RATE_LIMIT_JITTER = True  # Add random jitter to prevent thundering herd
RATE_LIMIT_BATCH_DELAY = (
    1.0  # Delay in seconds between batch processing to reduce rate limit pressure
)

# Failed batch retry: after all batches complete, failed ones get ONE additional retry pass
RETRY_FAILED_BATCHES_ENABLED = (
    os.environ.get("RETRY_FAILED_BATCHES_ENABLED", "true").lower() == "true"
)
RETRY_FAILED_BATCHES_DELAY = float(os.environ.get("RETRY_FAILED_BATCHES_DELAY", "30.0"))
RETRY_FAILED_BATCHES_INITIAL_DELAY = float(
    os.environ.get("RETRY_FAILED_BATCHES_INITIAL_DELAY", "10.0")
)

# BackendHandlerBuilder no-save resilience. A handler turn that ends on plain text
# leaves no `handler_code:{name}.tsx` artifact; without these, ONE such no-save
# aborts the entire build (BuilderError "produced N/M handlers"). See the live
# brewery build abzgxeo0 (getUpcomingEvents, 2026-05-21).
#
# Lever B — re-dispatch each no-artifact handler ONCE (fresh save budget) before
# giving up. Set false to disable the retry.
BACKEND_HANDLER_ESCALATION_RETRY = (
    os.environ.get("BACKEND_HANDLER_ESCALATION_RETRY", "true").lower() == "true"
)
# Lever C — when a handler is STILL missing after the retry, write a deterministic
# crash-safe stub handler (returns an empty result) so the artifact exists and the
# build continues to the frontend instead of aborting. Set false to restore the
# strict fail-fast (raise BuilderError on any missing handler).
BACKEND_HANDLER_STUB_FALLBACK = (
    os.environ.get("BACKEND_HANDLER_STUB_FALLBACK", "true").lower() == "true"
)

# Lever A — ComponentBuilder no-save retry.
# When a ComponentBuilder slot returns no artifact (gemini-3-flash single-turn
# no-save: a text-only/empty reply with no validate_and_save tool call), re-dispatch
# the affected component(s) once. Each retry is an INDEPENDENT re-roll — the slots
# use model-default sampling (no temperature/seed set, temperature>0), so a fresh
# turn on the same input has independent odds: failure rate p → p^(1+attempts).
# Recovered components overwrite their placeholder; ones still missing after the
# retries keep the placeholder (partial-ship ships them). First surfaced as
# MainFooter no-save aborting the whole build on y0o1ltmw (2026-05-24).
COMPONENT_BUILDER_ESCALATION_RETRY = (
    os.environ.get("COMPONENT_BUILDER_ESCALATION_RETRY", "true").lower() == "true"
)
# Number of extra re-dispatch passes for still-unresolved components (each pass is
# an independent re-roll). 1 → p^2; 2 → p^3 (flash is cheap enough to afford 2).
# Default 2: self-host runs on operator-chosen models (OpenRouter/LiteLLM, local
# models) whose tool-calling adherence varies — a model that ends its turn with a
# text reply and no save tool call (seen on deepseek-v4-flash) needs more
# independent re-rolls than native Gemini did to converge.
COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS = int(
    os.environ.get("COMPONENT_BUILDER_ESCALATION_RETRY_ATTEMPTS", "2")
)

# Parallel agent timeout settings (seconds)
# Prevents indefinite hangs when a sub-agent's async generator stalls inside ParallelAgent.
# The ADK ParallelAgent uses asyncio.TaskGroup internally and blocks until ALL sub-agents
# complete. These timeouts ensure the workflow can recover if a sub-agent hangs.
PARALLEL_INITIAL_BUILDERS_TIMEOUT = float(
    os.environ.get("PARALLEL_INITIAL_BUILDERS_TIMEOUT", "300")
)
PARALLEL_TSX_BUILDER_TIMEOUT = float(os.environ.get("PARALLEL_TSX_BUILDER_TIMEOUT", "300"))
PARALLEL_BUILD_PHASE_TIMEOUT = float(os.environ.get("PARALLEL_BUILD_PHASE_TIMEOUT", "600"))

# Feature flags for parallel execution stages
PARALLEL_PRE_BUILD = os.environ.get("PARALLEL_PRE_BUILD", "true").lower() == "true"
PARALLEL_POST_BUILD = os.environ.get("PARALLEL_POST_BUILD", "true").lower() == "true"

# Pattern C — Partial-Ship mode.
# When enabled, builds with ONLY recoverable component failures (validation_failed,
# wiring/a11y/contrast issues, forbidden API uses, or a builder that returned no
# artifact) ship with placeholder TSX for the affected components instead of
# aborting the whole workflow. Builds with ANY fatal failure (jsx_syntax_error,
# jsx_tag_corruption, missing_model, etc.) still abort.
# Defaults ON for self-host: the operator picks the model (OpenRouter/LiteLLM,
# local models), and weaker models occasionally fail a component or two. Shipping
# a working app with a couple of placeholder pages (which the operator can fix via
# an edit turn) plus a surfaced warning is strictly better than discarding every
# successfully-built component and returning nothing.
ENABLE_PARTIAL_SHIP = os.environ.get("ENABLE_PARTIAL_SHIP", "true").lower() == "true"

# Pattern G — Failure telemetry. Emit a structured `agent_outcome` log line on
# every workflow terminal (success / abort / partial_ship) so Cloud Logging
# can sink it into BigQuery for weekly aggregation. Defaults on — schema is
# non-PII (categories only, no raw TSX or user prompts).
ENABLE_FAILURE_TELEMETRY = os.environ.get("ENABLE_FAILURE_TELEMETRY", "true").lower() == "true"

# Surveyor Phase 2 — Class B runtime probes. When True, the Surveyor's
# tool list is augmented with execute_handler_tool, query_db_tool,
# sample_table_tool, screenshot_preview_tool, read_browser_state_tool.
# Defaults OFF for the dark-ship rollout; flip to "true" for staged
# rollout (10% via session_id hash → 100%) once cost telemetry confirms
# ≤2x baseline turn cost. Requires PLATFORM_DIAGNOSTIC_SECRET to be
# provisioned and the runtime worker's diagnostic.ts route deployed.
SURVEYOR_RUNTIME_PROBES_ENABLED = (
    os.environ.get("SURVEYOR_RUNTIME_PROBES_ENABLED", "false").lower() == "true"
)

# Per-HTTP-request timeout for Vertex AI calls (milliseconds).
# Prevents individual generate_content() calls from hanging indefinitely.
# Vertex AI server-side hard limit is ~300s; this matches the client wait time.
LLM_REQUEST_TIMEOUT_MS = int(os.environ.get("LLM_REQUEST_TIMEOUT_MS", "300000"))  # 300s

# LiteLLM (non-Gemini) per-call resilience — deliberately BOUNDED.
# litellm raises transient provider errors (rate limits, timeouts, and
# OpenRouter's "Unable to get json response") as exceptions that otherwise abort
# the whole parallel build, so a couple of quick retries are worth it. But long
# retry chains / long per-call timeouts are worse than failing fast: a single
# stuck call blocks the parallel component phase (the build looks "frozen"), can
# exceed PARALLEL_BUILD_PHASE_TIMEOUT, and leaves an orphaned retry that outlives
# the request (logs "Failed to append event ... session not in sessions"). Keep
# retries few and the timeout well under the phase budget so a stuck call fails
# quickly and the component no-save-retry / partial-ship path takes over.
LITELLM_NUM_RETRIES = int(os.environ.get("LITELLM_NUM_RETRIES", "2"))
LITELLM_TIMEOUT_SECONDS = float(os.environ.get("LITELLM_TIMEOUT_SECONDS", "90"))

# Total wall-clock ceiling for ONE non-stream model call (RetryingLiteLlm).
#
# ``LITELLM_TIMEOUT_SECONDS`` above does NOT deliver the bound the comment
# describes: litellm passes it to httpx, whose timeouts are PER-OPERATION
# (connect / read / write / pool), not total-elapsed. A provider that dribbles
# bytes resets the read clock on every chunk, so a "slow but steady" response
# runs UNBOUNDED under any value here — measured directly: a 30 s trickle with
# 2 s between chunks sailed past ``timeout=5`` and returned at 32.2 s, while the
# same endpoint stalling silently DID raise at 5.5 s. That is how a single
# OpenRouter call once ran 14.5 min (2026-07-13) past a 90 s timeout, blowing the
# PARALLEL_BUILD_PHASE_TIMEOUT budget and taking the whole parallel round with it
# instead of degrading one component.
#
# An outer ``asyncio.timeout`` DOES cancel such a call cleanly (verified, and it
# is not swallowed by ``num_retries``), so RetryingLiteLlm wraps the non-stream
# call in one.
#
# This budget is TOTAL across the empty-provider re-roll attempts, not per
# attempt. That distinction is the whole point: a per-attempt bound is multiplied
# by ``LITELLM_ERROR_FINISH_RETRIES`` (a wall-clock abandon carries an
# ``error_code``, which ``_is_empty_provider_error`` treats as retryable), so a
# 300 s per-attempt bound actually permits 300+3+300+6+300 = 909 s in one call —
# past BOTH phase budgets it is supposed to stay under, turning a slow call into
# a whole-round abort. ``_collect_bounded`` therefore spends a single shared
# deadline: each attempt gets only the time remaining.
#
# The default is DERIVED from the tightest enclosing phase budget rather than
# hardcoded, so it cannot drift out from under those timeouts: the call must fail
# first, leaving the no-save-retry / partial-ship path to take over — which is
# exactly the invariant the block above intends. 0 disables the bound.
LITELLM_CALL_WALL_CLOCK_SECONDS = float(
    os.environ.get(
        "LITELLM_CALL_WALL_CLOCK_SECONDS",
        str(round(0.8 * min(PARALLEL_INITIAL_BUILDERS_TIMEOUT, PARALLEL_BUILD_PHASE_TIMEOUT))),
    )
)

# Empty-body / provider-error retry (RetryingLiteLlm).
# ``num_retries`` only fires on EXCEPTIONS. A provider can also return a normal
# 200 whose body carries ``finish_reason='error'`` (OpenRouter/deepseek upstream
# generation error) → an empty LlmResponse (FinishReason.OTHER, no parts) that
# slips past num_retries and silently becomes a component no-save / placeholder.
# RetryingLiteLlm re-rolls the (non-stream) call a few times with backoff when the
# terminal response is such an empty provider error. Bounded so a persistently
# failing call still fails fast into the no-save-retry / partial-ship path.
LITELLM_ERROR_FINISH_RETRIES = int(os.environ.get("LITELLM_ERROR_FINISH_RETRIES", "2"))
LITELLM_ERROR_FINISH_INITIAL_DELAY = float(
    os.environ.get("LITELLM_ERROR_FINISH_INITIAL_DELAY", "3.0")
)

# Per-agent-operation timeout (seconds).
# Caps the total time for a single agent run including all retries and delays.
# Set higher than LLM_REQUEST_TIMEOUT_MS to allow room for retries.
LLM_AGENT_OPERATION_TIMEOUT = float(os.environ.get("LLM_AGENT_OPERATION_TIMEOUT", "480"))

# Hard cap on ComponentBuilder LLM output tokens. Stops degenerate-repetition
# loops at the inference layer — when the model gets stuck emitting the same
# block N times (see ``xdk89qba`` post-mortem: a single MainHeader was 32×
# duplicated, ~40,000 output tokens), the cap truncates the response and the
# downstream esbuild stage rejects the unbalanced JSX, triggering the
# existing retry-with-feedback flow.
#
# 12,000 tokens ≈ ~36 KB ≈ ~800 lines — a generous upper bound for any
# single component. Bump for skills like ``game_arcade`` that legitimately
# emit larger components if MAX_TOKENS finish reasons start firing on them.
COMPONENT_BUILDER_MAX_OUTPUT_TOKENS = int(
    os.environ.get("COMPONENT_BUILDER_MAX_OUTPUT_TOKENS", "12000")
)

# Tier-2 fix-up retry cap for ComponentBuilderMultiple's end-of-turn
# dirty-file sweep. After the agent's final response, the dispatcher
# runs the full validation pipeline against every dirty file (created /
# modified this turn + their importers); if any errors remain, the
# dispatcher re-invokes ComponentBuilderMultiple with a fix-up prompt
# up to N times before failing the phase. Default: 1 retry.
COMPONENT_BUILDER_MULTIPLE_FIX_UP_RETRIES = int(
    os.environ.get("COMPONENT_BUILDER_MULTIPLE_FIX_UP_RETRIES", "1")
)

# Per-invocation safety caps for ComponentBuilderMultiple. ADK's
# `LlmAgent.run_async` has no built-in iteration limit — its only stop
# condition is the LLM emitting a final-text response. When the model
# instead keeps making tool calls (Read / Grep / describe loops), the
# agent runs until Cloud Run's request timeout (3600s) or the SSE
# stream is forcibly closed. These caps wrap the dispatch with both a
# tool-call counter and a wall-clock timeout so the workflow finalizes
# cleanly with whatever was already saved.
#
# Reasoning for defaults:
#   25 tool calls — typical convergent runs land in 4-12 (read a few
#                   files, edit, save, done). 25 leaves headroom for
#                   complex cross-file cascades while still cutting off
#                   pathological loops at ~3-5 minutes.
#   600 seconds   — 10 min ceiling: covers slow Pro-model responses
#                   (we've seen single calls take 2 min) plus 429
#                   backoff retries, while staying well under the 60-min
#                   Cloud Run hard kill.
COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS = int(
    os.environ.get("COMPONENT_BUILDER_MULTIPLE_MAX_TOOL_CALLS", "25")
)
COMPONENT_BUILDER_MULTIPLE_TIMEOUT_SECONDS = int(
    os.environ.get("COMPONENT_BUILDER_MULTIPLE_TIMEOUT_SECONDS", "600")
)

# Polish-mode (design-import) cap escalation. The polish agent processes
# 4-6 components per dispatch with multiple edits per component, so it
# routinely brushes the standard 25 cap. App rdzn62gx (2026-05-16) hit
# the cap twice in five polish dispatches (initial + tier2_retry_1),
# leaving the last component partially polished — that's why this was
# raised from 25.
#
# Lowered from 45 → 30 in concert with the dirty_file_sweeper.render_fix_up_prompt
# fix that strips warning-level findings from the fix-up prompt (ckfk4mun
# 2026-05-18: polish dispatch hit the 45 cap iterating on `<button>`
# warnings the LLM couldn't fix; semantic-check error_count stayed at 0
# throughout, but the warnings kept feeding the LLM more "things to fix").
# With warnings out of the prompt, observed polish runs converge in
# ~10-20 calls; 30 keeps headroom for the legitimate p99 while halving
# the worst-case cost ($0.42 → ~$0.28 per cap-hit dispatch).
# Wall-clock cap stays shared since the polish dispatch is one LLM turn
# like the full agent.
COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS = int(
    os.environ.get("COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS", "30")
)

# Polish-mode parallelism (N concurrent slots). Mirrors
# COMPONENT_BUILDER_PARALLELISM but defaults lower (3) because each polish
# dispatch is heavier than a single-file ComponentBuilder build, and the
# polish flow only fires under DesignImportWorkflow where the action count
# tracks page count (5+ for multi-page imports). Setting to 1 reproduces
# the sequential pre-parallel behavior. Resolved by the pool module's
# ``_resolve_slot_count`` (clamped to [1, 5]). App fv83uavm (2026-05-18)
# was a 5-page Claude-Design import that timed out at the 1200s workflow
# cap on sequential dispatch — see app-files/fv83uavm/_report.md.
#
# DO NOT raise this default without first verifying gemini-3-flash-preview
# RPM project quota on Vertex AI. Production app b9kwhxdv (2026-05-18,
# 10-page Claude-Design import) hit ``429 RESOURCE_EXHAUSTED`` at
# NUM_SLOTS=3 with concurrent retry storms on cache misses — bumping to
# 5 without quota headroom would only worsen the throttle. See
# app-files/b9kwhxdv/_report.md.
COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM = int(
    os.environ.get("COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM", "3")
)

# =============================================================================
# Content Handling Configuration
# =============================================================================

# Document artifact settings
# Documents larger than this will use Vertex AI Search instead of artifacts
DOCUMENT_MAX_SIZE_CHARS = int(os.environ.get("DOCUMENT_MAX_SIZE_CHARS", 50000))

# Image catalog summary settings
# Maximum number of images to include in the summary for planner agents
IMAGE_CATALOG_SUMMARY_LIMIT = int(os.environ.get("IMAGE_CATALOG_SUMMARY_LIMIT", 10))
# Maximum length of image descriptions in the summary (characters)
IMAGE_DESCRIPTION_MAX_LENGTH = int(os.environ.get("IMAGE_DESCRIPTION_MAX_LENGTH", 60))

# Document fetch retry settings (for fetching documents from content_url)
DOCUMENT_FETCH_MAX_RETRIES = int(os.environ.get("DOCUMENT_FETCH_MAX_RETRIES", 3))
DOCUMENT_FETCH_INITIAL_DELAY = float(os.environ.get("DOCUMENT_FETCH_INITIAL_DELAY", 1.0))
DOCUMENT_FETCH_BACKOFF_MULTIPLIER = float(os.environ.get("DOCUMENT_FETCH_BACKOFF_MULTIPLIER", 2.0))
DOCUMENT_FETCH_TIMEOUT = int(os.environ.get("DOCUMENT_FETCH_TIMEOUT", 30))

# Skip document fetching in test mode
# When True, _fetch_and_save_document returns True without making HTTP requests
# Set to "true" when running E2E tests with mock document catalogs
SKIP_DOCUMENT_FETCH = os.environ.get("SKIP_DOCUMENT_FETCH", "false").lower() == "true"

# =============================================================================
# Data Ingester (DataIngester pre-pass)
# =============================================================================

# Master gate for the DataIngester pre-pass. When False, CreationWorkflow
# and EditingWorkflow behave identically to today — no sidecar fetches,
# no LLM call, no seed extraction from user uploads. Defaults OFF until
# the backend ships BE-1 (PDF tables), BE-2 (catalog enrichment), and
# BE-3 (DOCX/PPTX sidecar). Excel/CSV ingest works today against the
# existing sidecar.
DATA_INGEST_ENABLED = os.environ.get("DATA_INGEST_ENABLED", "false").lower() == "true"

# Wall-clock timeout (seconds) for the full DataIngester pre-pass —
# sidecar fetches + LLM call. Mirrors PARALLEL_*_TIMEOUT shape.
DATA_INGEST_TIMEOUT_SECONDS = float(os.environ.get("DATA_INGEST_TIMEOUT_SECONDS", "60"))

# Hard row cap per uploaded table. When the backend's sidecar JSONL
# exceeds this, the fetcher keeps the first N rows and the workflow
# surfaces a `row_cap_exceeded` warning. NEVER silent truncation.
DATA_INGEST_ROW_CAP = int(os.environ.get("DATA_INGEST_ROW_CAP", "50000"))


class TimedGemini(Gemini):
    """Gemini model adapter with per-request HTTP timeout.

    The base Gemini class creates its api_client without HttpOptions.timeout,
    so individual generate_content() calls can hang indefinitely when Vertex AI
    returns slow 503 responses. This subclass injects a timeout.
    """

    request_timeout_ms: Optional[int] = None

    @cached_property
    def api_client(self):
        from google.genai import Client

        kwargs: dict[str, Any] = {
            "http_options": types.HttpOptions(
                headers=self._tracking_headers(),
                retry_options=self.retry_options,
                base_url=self.base_url,
                timeout=self.request_timeout_ms,
            )
        }
        if self.model.startswith("projects/") or os.getenv(
            "GOOGLE_GENAI_USE_VERTEXAI", ""
        ).lower() in ("true", "1"):
            kwargs["vertexai"] = True

        return Client(**kwargs)


def get_agent_model_name(agent_name: AgentName | str) -> str:
    """
    Get model name string for a specific agent.

    Use this when you need the raw model name (e.g., for pricing calculations,
    logging, or display). For passing to LlmAgent, use get_agent_model() instead.

    Args:
        agent_name: Name of the agent (AgentName enum or string)

    Returns:
        Model name string (e.g., 'gemini-3-flash-preview')

    Raises:
        KeyError: If agent_name is not found in AGENT_MODELS
    """
    key = agent_name.value if isinstance(agent_name, AgentName) else agent_name
    if key not in AGENT_MODELS:
        raise KeyError(f"Unknown agent: '{key}'. Available: {list(AGENT_MODELS.keys())}")
    return AGENT_MODELS[key]


# ── Provider-agnostic model resolution ──────────────────────────────────────
# Self-host accepts any LLM vendor. EXEPAD_LLM_PROVIDER selects the backend;
# Gemini/Vertex stay on the native ADK path, everything else goes through ADK's
# LiteLlm. OpenAI-compatible endpoints (custom gateways, vLLM, LM Studio, …) use
# the "openai" prefix plus EXEPAD_LLM_BASE_URL.
_LITELLM_PROVIDER_PREFIX = {
    "anthropic": "anthropic",
    "openai": "openai",
    "openrouter": "openrouter",
    "ollama": "ollama_chat",
    "groq": "groq",
    "mistral": "mistral",
    "deepseek": "deepseek",
    "custom": "openai",
    "openai-compatible": "openai",
}

_NATIVE_GEMINI_PROVIDERS = {"", "gemini", "google", "vertex", "vertexai"}


def is_native_gemini_provider() -> bool:
    """True when the active provider uses the native ADK Gemini path.

    Native Gemini gets controlled-generation ``output_schema`` plus a working
    ``save_plan_artifact`` tool flow, so the Creator offloads building plans to
    artifacts (keeping the structured payload under the combined token cap).
    LiteLLM providers (deepseek / openrouter / ollama / ...) do not reliably run
    the multi-turn tool flow, so the Creator must emit ``building_plan`` inline.
    Read per-request from ``EXEPAD_LLM_PROVIDER`` (``apply_runtime_settings``
    sets it before each build), so it reflects the operator's current selection.
    """
    provider = os.environ.get("EXEPAD_LLM_PROVIDER", "gemini").strip().lower()
    return provider in _NATIVE_GEMINI_PROVIDERS


# Remembers the value _sync_native_gemini_key() itself wrote, so it can tell its
# own mirror from a key the operator set deliberately — and can therefore keep
# the mirror current when the operator CHANGES their key, without ever
# clobbering an explicit GEMINI_API_KEY / GOOGLE_API_KEY.
_MIRRORED_GEMINI_KEY: Optional[str] = None


def _sync_native_gemini_key() -> bool:
    """Make ``EXEPAD_LLM_API_KEY`` actually work on the native-Gemini path.

    ``EXEPAD_LLM_API_KEY`` is the LiteLLM path's variable: it is read at
    ``create_model``'s non-Gemini branch, *after* the native-Gemini early return.
    google-genai's ``Client`` is constructed with no ``api_key`` and falls back to
    reading ``GEMINI_API_KEY`` / ``GOOGLE_API_KEY`` from the environment, and
    nothing knows about ``EXEPAD_LLM_API_KEY``.

    So on the DEFAULT provider the key an operator sets is silently ignored, and
    every build fails to authenticate. Both first-run routes hit this: ``.env``
    (the container entrypoint warns only when *both* variables are missing,
    implying either suffices) and the Settings UI, which stores whatever you type
    as ``EXEPAD_LLM_API_KEY`` regardless of the provider you picked
    (``worker/src/routes/settings.ts``) and ships it here as
    ``runtime_settings.llm.api_key``.

    This bridges the two. An explicit ``GEMINI_API_KEY`` / ``GOOGLE_API_KEY``
    always wins and is never overwritten. Returns True when the environment
    changed, so callers can trigger a model rebind.
    """
    global _MIRRORED_GEMINI_KEY

    if not is_native_gemini_provider():
        return False

    key = os.environ.get("EXEPAD_LLM_API_KEY", "").strip()
    if not key:
        return False

    # Anything the operator set themselves is authoritative. Our own previous
    # mirror is not "theirs", which is what lets a key change propagate.
    for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"):
        existing = os.environ.get(name, "").strip()
        if existing and existing != _MIRRORED_GEMINI_KEY:
            return False

    if os.environ.get("GEMINI_API_KEY", "").strip() == key:
        return False

    os.environ["GEMINI_API_KEY"] = key
    _MIRRORED_GEMINI_KEY = key
    logger.info(
        "native Gemini provider: mirrored EXEPAD_LLM_API_KEY into GEMINI_API_KEY "
        "(no explicit GEMINI_API_KEY/GOOGLE_API_KEY was set)"
    )
    return True


def _litellm_model_id(provider: str, model_name: str) -> str:
    """Build a LiteLLM model id (`provider/model`).

    OpenRouter is special: its model ids are themselves ``vendor/model``
    (e.g. ``anthropic/claude-3.5-sonnet``), so the slash is part of the id, not a
    provider tag — they must keep the ``openrouter/`` routing prefix. For other
    providers a slash means the id already carries its own provider prefix and is
    passed through untouched.
    """
    prefix = _LITELLM_PROVIDER_PREFIX.get(provider, provider)
    if model_name.startswith(f"{prefix}/"):
        return model_name
    if provider == "openrouter":
        return f"openrouter/{model_name}"
    if "/" in model_name:
        return model_name
    return f"{prefix}/{model_name}"


def _openrouter_provider_routing() -> Optional[dict[str, Any]]:
    """Build an OpenRouter ``provider`` routing block from the environment.

    OpenRouter *load-balances* every request across the providers that serve a
    model, re-selecting on each call. On the first calls of a run that pays a
    cold routing/queue latency spike (observed on this rig: 25–144 s first-call
    latency vs 2–9 s once warm — the model itself generates fast). Pinning the
    routing (an explicit ``order`` and/or a ``sort`` axis) disables that per-call
    load-balancing so a consistently-fast provider is used from the first call.

    Env knobs (all optional; only meaningful for the ``openrouter`` provider):
      * ``EXEPAD_LLM_PROVIDER_ORDER`` — comma-separated provider slugs, tried in
        order (e.g. ``"Makora,DeepSeek,Novita"``).
      * ``EXEPAD_LLM_PROVIDER_SORT`` — ``price`` | ``throughput`` | ``latency``.
        ``throughput`` (OpenRouter's ``:nitro``) maximises sustained token rate
        and is the RECOMMENDED axis for this agent: build cost is dominated by
        long reasoning/codegen generations, which are throughput-bound. Measured
        on the OSS rig (deepseek-v4-flash), switching one create build from
        ``latency`` to ``throughput`` cut total build 1075s→297s — the Creator
        call alone 439s→75s. ``latency`` minimises time-to-first-token: good for
        short/interactive calls, but it can route a long generation to a
        low-throughput provider and be far slower overall.
      * ``EXEPAD_LLM_PROVIDER_ALLOW_FALLBACKS`` — ``0``/``false``/``no``/``off``
        forbids falling back past the top choice. Only takes effect ALONGSIDE an
        ``order``/``sort`` pin (with no pin there is nothing to fall back from,
        so this knob alone yields no routing block). Default keeps fallbacks on,
        so a momentary outage of the top provider degrades to another provider
        rather than failing the whole build.

    Returns the dict to pass as ``extra_body={"provider": <this>}``, or ``None``
    when no routing knob is configured (leaves OpenRouter's default routing).
    """
    routing: dict[str, Any] = {}

    order_raw = os.environ.get("EXEPAD_LLM_PROVIDER_ORDER", "").strip()
    if order_raw:
        slugs = [s.strip() for s in order_raw.split(",") if s.strip()]
        if slugs:
            routing["order"] = slugs

    sort_raw = os.environ.get("EXEPAD_LLM_PROVIDER_SORT", "").strip().lower()
    if sort_raw in ("price", "throughput", "latency"):
        routing["sort"] = sort_raw

    if not routing:
        return None

    fallbacks_raw = os.environ.get("EXEPAD_LLM_PROVIDER_ALLOW_FALLBACKS", "").strip().lower()
    if fallbacks_raw in ("0", "false", "no", "off"):
        routing["allow_fallbacks"] = False

    return routing


_LITELLM_PATCHED = False


def _patch_litellm_tool_arg_parsing() -> None:
    """Make ADK's LiteLlm tolerant of malformed tool-call argument JSON.

    Weaker / non-Gemini models (several OpenRouter providers, e.g.
    ``deepseek-v4-flash``) occasionally return tool-call ``arguments`` that are a
    valid JSON value followed by trailing junk or a second concatenated object,
    so Python's ``json.loads`` raises ``JSONDecodeError: Extra data``. ADK's
    built-in repair only covers dict-literals / unquoted keys, so this otherwise
    crashes the whole parallel component build (TaskGroup abort).

    We wrap ADK's parser: try its logic first, then salvage the first valid JSON
    value via ``raw_decode`` (ignoring trailing data), and as a last resort
    return ``{}`` so a fumbled tool call degrades to a recoverable component
    failure (no-save-retry / partial-ship) instead of aborting the build.
    Idempotent; applied lazily the first time a LiteLLM model is built.
    """
    global _LITELLM_PATCHED
    if _LITELLM_PATCHED:
        return
    try:
        from google.adk.models import lite_llm as _ll
    except Exception as exc:  # pragma: no cover - import shape guard
        logger.warning("could not patch litellm tool-arg parsing: %s", exc)
        return
    original = getattr(_ll, "_parse_tool_call_arguments", None)
    if not callable(original):
        _LITELLM_PATCHED = True
        return

    def _tolerant_parse_tool_call_arguments(arguments: Any) -> Any:
        try:
            return original(arguments)
        except Exception:
            pass
        if isinstance(arguments, str):
            try:
                obj, _end = json.JSONDecoder().raw_decode(arguments.strip())
                logger.warning("litellm tool-call args salvaged via raw_decode")
                return obj
            except Exception:
                pass
        logger.warning("litellm tool-call args unparseable; using empty args")
        return {}

    _ll._parse_tool_call_arguments = _tolerant_parse_tool_call_arguments
    _LITELLM_PATCHED = True
    logger.info("patched litellm tool-arg parsing for malformed-JSON tolerance")


_ADK_OUTPUT_SCHEMA_PATCHED = False

# LiteLLM providers whose transport natively binds tool-calling + structured
# ``response_format`` together (so ADK's native output_schema path is reliable
# and ``SetModelResponseTool`` is unnecessary). Everything else gets the
# deterministic set_model_response emission gate.
_NATIVE_STRUCTURED_LITELLM_PREFIXES = ("openai/", "azure/", "azure_ai/")


def _patch_adk_output_schema_for_litellm() -> None:
    """Force ADK to use its provider-agnostic ``SetModelResponseTool`` emission
    gate for non-native LiteLLM providers (deepseek / OpenRouter / ollama / ...).

    **Why (the root-cause fix, F1).** ADK 2.2.0's
    ``google/adk/utils/output_schema_utils.py:can_use_output_schema_with_tools``
    returns ``True`` for *every* ``LiteLlm`` instance. So an ``LlmAgent`` with
    ``output_schema`` + ``tools`` (Creator, Editor, DesignImporter, any
    PreCreator-with-tools) has both function declarations AND an OpenAI
    ``response_format`` hint sent at once, and ADK *skips* injecting
    ``SetModelResponseTool``
    (``flows/llm_flows/_output_schema_processor.py`` early-returns). Native
    Gemini enforces ``output_schema`` server-side (controlled generation), so
    "call a tool, then emit final JSON" is mechanically guaranteed. OpenAI
    ``json_schema`` ``strict:true`` only constrains JSON *shape*, not exclusive
    mode — so weaker providers emit text-only (no tool call), JSON without the
    tool, or interleave, and the emission contract evaporates. This is the
    documented "text reply and no save tool call (seen on deepseek-v4-flash)"
    failure, plus empty ``building_plan`` and hallucinated/malformed tool calls.

    **The fix.** Override the gate to return ``False`` for LiteLLM providers that
    don't natively bind tools+response_format (everything except openai/azure).
    ``_OutputSchemaRequestProcessor`` then injects ``SetModelResponseTool`` and
    its explicit "after using any other tools, always call set_model_response
    with your final answer" instruction — turning final structured emission into
    a deterministic, *named* tool call on every provider. Native Gemini
    (``TimedGemini``, not ``LiteLlm``) and openai/azure keep their native path
    untouched (we defer to the original function for them).

    Idempotent; applied lazily the first time a LiteLLM model is built.
    """
    global _ADK_OUTPUT_SCHEMA_PATCHED
    if _ADK_OUTPUT_SCHEMA_PATCHED:
        return
    try:
        from google.adk.utils import output_schema_utils as _osu
        from google.adk.flows.llm_flows import _output_schema_processor as _osp
        from google.adk.models.lite_llm import LiteLlm
    except Exception as exc:  # pragma: no cover - import shape guard
        logger.warning("could not patch ADK output-schema gate: %s", exc)
        return

    original = getattr(_osu, "can_use_output_schema_with_tools", None)
    if not callable(original):
        _ADK_OUTPUT_SCHEMA_PATCHED = True
        return

    def _patched_can_use_output_schema_with_tools(model: Any) -> bool:
        if isinstance(model, LiteLlm):
            model_str = getattr(model, "model", "") or ""
            if model_str.startswith(_NATIVE_STRUCTURED_LITELLM_PREFIXES):
                return True
            # deepseek / openrouter / ollama / mistral / groq / custom →
            # force the deterministic SetModelResponseTool emission gate.
            return False
        return original(model)

    _osu.can_use_output_schema_with_tools = _patched_can_use_output_schema_with_tools
    # The request processor imported the symbol by value at module import time, so
    # its own bound name must be replaced too (the module-level singleton's
    # ``run_async`` reads this global, not a captured copy).
    if hasattr(_osp, "can_use_output_schema_with_tools"):
        _osp.can_use_output_schema_with_tools = _patched_can_use_output_schema_with_tools
    _ADK_OUTPUT_SCHEMA_PATCHED = True
    logger.info(
        "patched ADK output-schema gate: non-native LiteLLM providers now use "
        "the deterministic SetModelResponseTool emission gate"
    )


_LITELLM_REGISTERED_MODELS: set[str] = set()


def _register_litellm_model(litellm_model_id: str) -> None:
    """Teach litellm that the configured model supports function-calling and
    structured ``response_format``, for ids litellm doesn't ship in its static
    registry.

    litellm 1.83.7 has no entry for many current OpenRouter ids (e.g.
    ``openrouter/deepseek/deepseek-v4-flash`` → "This model isn't mapped yet"),
    so ``supports_function_calling`` / ``supports_response_schema`` default to
    ``False`` and litellm may drop the ``tools`` / ``response_format`` params
    when ``drop_params`` is active. Registering the id with the capabilities the
    underlying model actually has keeps the param path intact so ADK's tool
    declarations (including ``set_model_response``) reach the provider.

    Best-effort and idempotent. ``max_*`` values are advisory hints; the actual
    per-request token caps still come from each agent's ``generate_content_config``.
    """
    if not litellm_model_id or litellm_model_id in _LITELLM_REGISTERED_MODELS:
        return
    _LITELLM_REGISTERED_MODELS.add(litellm_model_id)
    try:
        import litellm
    except Exception:  # pragma: no cover - litellm optional on gemini-only installs
        return
    try:
        litellm.get_model_info(litellm_model_id)
        return  # already known to litellm — leave its real metadata alone
    except Exception:
        pass
    try:
        provider = litellm_model_id.split("/", 1)[0]
        litellm.register_model(
            {
                litellm_model_id: {
                    "max_tokens": 8192,
                    "max_input_tokens": 65536,
                    "max_output_tokens": 8192,
                    "litellm_provider": provider,
                    "mode": "chat",
                    "supports_function_calling": True,
                    "supports_response_schema": True,
                    "supports_tool_choice": True,
                }
            }
        )
        logger.info(
            "registered unmapped litellm model for capability detection: %s",
            litellm_model_id,
        )
    except Exception as exc:  # pragma: no cover - registry shape guard
        logger.warning("could not register litellm model %s: %s", litellm_model_id, exc)


def _is_empty_provider_error(responses: list) -> bool:
    """True when the terminal non-stream LlmResponse is an empty provider error.

    A provider can return a 200 whose body carries ``finish_reason='error'`` (e.g.
    OpenRouter/deepseek upstream generation error). ADK maps the unknown reason to
    ``FinishReason.OTHER`` and yields an LlmResponse with no text and no function
    call. Because it is not an exception, litellm's ``num_retries`` never sees it,
    so it silently becomes a component no-save. We retry only this specific shape
    (empty + OTHER, or an explicit ``error_code``) so legitimate empty/stop/safety
    responses for any agent are left untouched.
    """
    if not responses:
        return False
    resp = responses[-1]
    if getattr(resp, "error_code", None):
        return True
    content = getattr(resp, "content", None)
    parts = (getattr(content, "parts", None) or []) if content is not None else []
    has_function_call = any(getattr(p, "function_call", None) for p in parts)
    has_text = any((getattr(p, "text", None) or "").strip() for p in parts)
    if has_function_call or has_text:
        return False
    return getattr(resp, "finish_reason", None) == types.FinishReason.OTHER


async def _collect_within_budget(agen, budget: float) -> Optional[list]:
    """Drain an async generator under a wall clock of ``budget`` seconds.

    Returns the buffered items, or ``None`` when the budget expired (including
    when it was already exhausted on entry — a caller sharing one deadline across
    retries must not get a free extra attempt). Lives at module level (not inside
    :func:`_get_retrying_litellm_class`) so the litellm subclass stays small —
    and because it needs no litellm import, Gemini-only installs still never load
    that extra.

    ``aclosing`` closes an abandoned generator deterministically rather than
    leaving the provider connection to GC.
    """
    if budget < 0:
        # Shared deadline already spent — refuse without opening a connection.
        await agen.aclose()
        return None
    buffered: list = []
    try:
        async with aclosing(agen) as it:
            if budget > 0:
                async with asyncio.timeout(budget):
                    async for item in it:
                        buffered.append(item)
            else:
                async for item in it:
                    buffered.append(item)
    except (asyncio.TimeoutError, TimeoutError):
        return None
    return buffered


def _deadline_remaining(deadline: Optional[float]) -> float:
    """Seconds left on a shared call deadline; 0.0 means "unbounded" (no deadline).

    Mirrors :func:`_collect_within_budget`'s convention: 0 disables the bound,
    negative means the budget is already spent.
    """
    if deadline is None:
        return 0.0
    return deadline - asyncio.get_running_loop().time()


def _re_roll_fits(deadline: Optional[float], delay: float) -> bool:
    """Whether another attempt plus its backoff still fits the shared deadline.

    Without this a re-roll only delays the inevitable past the enclosing phase
    timeout, which is what turns one slow call into a whole-round abort.
    """
    if deadline is None:
        return True
    return _deadline_remaining(deadline) - delay > 0


_RETRYING_LITELLM_CLASS: Any = None


def _get_retrying_litellm_class() -> Any:
    """Lazily build (and cache) a LiteLlm subclass that re-rolls empty provider
    errors. Defined inside the function so Gemini-only installs never import
    litellm. See ``_is_empty_provider_error`` + ``LITELLM_ERROR_FINISH_RETRIES``.
    """
    global _RETRYING_LITELLM_CLASS
    if _RETRYING_LITELLM_CLASS is not None:
        return _RETRYING_LITELLM_CLASS

    from google.adk.models.lite_llm import LiteLlm
    from google.adk.models.llm_response import LlmResponse

    class RetryingLiteLlm(LiteLlm):
        """LiteLlm that retries a non-stream call when the provider returns an
        empty ``finish_reason='error'`` body (slips past ``num_retries``), and
        bounds each non-stream call by a TOTAL wall clock (see
        ``LITELLM_CALL_WALL_CLOCK_SECONDS`` — litellm's own ``timeout`` is
        per-read and cannot cap a trickling provider)."""

        async def _collect_bounded(
            self, llm_request, attempt: int, attempts: int, remaining: float
        ) -> list:
            """One non-stream call, drawing on the call's SHARED wall clock.

            ``remaining`` is what is left of ``LITELLM_CALL_WALL_CLOCK_SECONDS``
            for the whole call (all re-roll attempts + their backoff), so the
            ceiling is total, not per attempt — see the constant's comment for
            why per-attempt silently multiplied past both phase budgets.

            On expiry returns the empty-provider-error shape instead of raising.
            That is deliberate: inside ADK's ParallelAgent TaskGroup an exception
            cancels every sibling slot, so one trickling provider would kill the
            whole component round. Degrading keeps the failure contained to this
            component, and the caller already handles the shape (re-roll here
            while budget remains, then builder_no_save -> no-save retry ->
            partial ship).
            """
            buffered = await _collect_within_budget(
                super().generate_content_async(llm_request, stream=False), remaining
            )
            if buffered is not None:
                return buffered
            logger.warning(
                "litellm call exhausted its %.0fs total wall clock - abandoning "
                "(attempt %d/%d, %.0fs of budget left for this attempt). "
                "litellm's own timeout is per-read and cannot bound a "
                "trickling provider.",
                LITELLM_CALL_WALL_CLOCK_SECONDS,
                attempt + 1,
                attempts + 1,
                max(0.0, remaining),
            )
            return [
                LlmResponse(
                    error_code="EXEPAD_CALL_WALL_CLOCK_TIMEOUT",
                    error_message=(
                        "Model call exceeded the "
                        f"{LITELLM_CALL_WALL_CLOCK_SECONDS:.0f}s wall-clock budget."
                    ),
                )
            ]

        async def generate_content_async(self, llm_request, stream: bool = False):
            # Streaming responses are yielded incrementally; retry only makes
            # sense for the single terminal non-stream response. A total
            # wall-clock bound is also wrong for a stream — a long stream that
            # is actively delivering tokens is healthy, and the caller already
            # sees progress. Pass through.
            if stream:
                async for resp in super().generate_content_async(llm_request, stream=True):
                    yield resp
                return

            attempts = max(0, LITELLM_ERROR_FINISH_RETRIES)
            delay = LITELLM_ERROR_FINISH_INITIAL_DELAY
            budget = LITELLM_CALL_WALL_CLOCK_SECONDS
            # ONE deadline for the whole call. Every attempt and every backoff
            # spends from it, so N re-rolls can never multiply the ceiling.
            deadline = (asyncio.get_running_loop().time() + budget) if budget > 0 else None

            for attempt in range(attempts + 1):
                buffered = await self._collect_bounded(
                    llm_request, attempt, attempts, _deadline_remaining(deadline)
                )
                retryable = attempt < attempts and _is_empty_provider_error(buffered)
                if retryable and _re_roll_fits(deadline, delay):
                    logger.warning(
                        "litellm empty provider error (finish_reason=error) — "
                        "re-rolling call (attempt %d/%d) after %.1fs",
                        attempt + 1,
                        attempts,
                        delay,
                    )
                    await asyncio.sleep(delay)
                    delay *= 2
                    continue
                if retryable:
                    logger.warning(
                        "litellm wall clock leaves no room for a re-roll "
                        "(attempt %d/%d) — settling now.",
                        attempt + 1,
                        attempts,
                    )
                for resp in buffered:
                    yield resp
                return

    _RETRYING_LITELLM_CLASS = RetryingLiteLlm
    return _RETRYING_LITELLM_CLASS


def _build_model_for_name(model_name: str) -> BaseLlm:
    """Build the provider-appropriate model adapter for a resolved model name.

    Factored out of :func:`get_agent_model` so the per-request rebinder can
    re-resolve ANY agent — including pool slot agents whose ``name`` is not in
    ``AGENT_MODELS`` — from its original model name under the current provider
    settings.

    Provider is selected by ``EXEPAD_LLM_PROVIDER`` (default ``gemini``):
    - ``gemini`` / ``vertex`` → native ADK Gemini (``TimedGemini``).
    - everything else → ADK ``LiteLlm`` keyed by ``EXEPAD_LLM_API_KEY``
      (+ ``EXEPAD_LLM_BASE_URL``). A ``gemini-*`` default on a non-Gemini
      provider falls back to ``EXEPAD_LLM_MODEL_DEFAULT``.
    """
    provider = os.environ.get("EXEPAD_LLM_PROVIDER", "gemini").strip().lower()

    if provider in _NATIVE_GEMINI_PROVIDERS:
        # google-genai reads GEMINI_API_KEY/GOOGLE_API_KEY from the environment
        # and never sees EXEPAD_LLM_API_KEY; mirror it so a key set in .env or in
        # the Settings UI authenticates instead of being silently dropped.
        _sync_native_gemini_key()
        return TimedGemini(
            model=model_name,
            request_timeout_ms=LLM_REQUEST_TIMEOUT_MS,
            retry_options=types.HttpRetryOptions(
                initial_delay=RATE_LIMIT_INITIAL_DELAY,
                attempts=RATE_LIMIT_MAX_RETRIES,
                max_delay=RATE_LIMIT_MAX_DELAY,
            ),
        )

    # Non-Gemini provider via LiteLLM. Imported lazily so Gemini-only installs
    # don't require the `google-adk[extensions]` (litellm) extra.
    from google.adk.models.lite_llm import LiteLlm

    # Harden ADK's tool-call argument parsing against malformed JSON from weaker
    # providers (idempotent; only matters on the LiteLLM path).
    _patch_litellm_tool_arg_parsing()
    # Force the deterministic SetModelResponseTool emission gate for non-native
    # providers so output_schema + tools agents (Creator/Editor/...) emit
    # correctly off-Gemini (F1; see _patch_adk_output_schema_for_litellm).
    _patch_adk_output_schema_for_litellm()

    if model_name.startswith("gemini-"):
        model_name = os.environ.get("EXEPAD_LLM_MODEL_DEFAULT") or model_name

    # ``num_retries`` + ``timeout`` are forwarded by ADK's LiteLlm straight to
    # ``litellm.acompletion``. They ride out transient provider failures (rate
    # limits, timeouts, malformed/empty bodies like OpenRouter's "Unable to get
    # json response") that would otherwise abort the whole parallel build — but
    # are BOUNDED (see config) so a stuck call fails fast instead of freezing the
    # build behind a long retry chain.
    litellm_model_id = _litellm_model_id(provider, model_name)
    # Register unmapped ids (e.g. current OpenRouter models) so litellm's
    # capability gates report function-calling/response-schema support and don't
    # drop the tool/response_format params ADK relies on.
    _register_litellm_model(litellm_model_id)
    kwargs: dict[str, Any] = {
        "model": litellm_model_id,
        "num_retries": LITELLM_NUM_RETRIES,
        "timeout": LITELLM_TIMEOUT_SECONDS,
    }
    api_key = os.environ.get("EXEPAD_LLM_API_KEY")
    base_url = os.environ.get("EXEPAD_LLM_BASE_URL")
    if api_key:
        kwargs["api_key"] = api_key
    if base_url:
        kwargs["api_base"] = base_url
    # OpenRouter-only: pin provider routing so OpenRouter stops load-balancing
    # (and paying a cold routing spike) on every call. ADK's LiteLlm forwards
    # unknown kwargs verbatim into litellm.acompletion, and litellm merges
    # ``extra_body`` into the OpenRouter request body, so ``provider`` lands where
    # OpenRouter reads it. See _openrouter_provider_routing.
    if provider == "openrouter":
        routing = _openrouter_provider_routing()
        if routing:
            kwargs["extra_body"] = {"provider": routing}
            logger.info("openrouter provider routing pinned: %s", routing)
    # RetryingLiteLlm adds an empty-provider-error re-roll on top of LiteLlm's
    # exception-only ``num_retries`` (see _get_retrying_litellm_class). Falls back
    # to plain LiteLlm if the subclass can't be built.
    try:
        return _get_retrying_litellm_class()(**kwargs)
    except Exception as exc:  # pragma: no cover - defensive fallback
        logger.warning("RetryingLiteLlm unavailable (%s); using plain LiteLlm", exc)
        return LiteLlm(**kwargs)


def get_agent_model(agent_name: AgentName | str) -> BaseLlm:
    """
    Resolve the model adapter for an agent, provider-agnostically.

    Provider is selected by ``EXEPAD_LLM_PROVIDER`` (default ``gemini``); see
    :func:`_build_model_for_name`. Per-agent ``{AGENT}_MODEL`` overrides still
    apply (they shape the model name returned by ``get_agent_model_name``).

    Raises:
        KeyError: If agent_name is not found in AGENT_MODELS
    """
    return _build_model_for_name(get_agent_model_name(agent_name))


def get_effective_model_name(agent_name: AgentName | str) -> str:
    """Model id that will ACTUALLY serve this agent under the current provider.

    ``get_agent_model_name`` returns the per-agent *base* name, which stays
    ``gemini-*`` by default even when the operator runs a non-Gemini provider —
    so pricing keyed off it mis-attributes cost. This mirrors
    :func:`_build_model_for_name`'s name resolution (without building the
    adapter) to return the real served id, e.g. ``openrouter/deepseek/deepseek-chat``
    on an OpenRouter provider, or the unchanged ``gemini-*`` name on native
    Gemini. Used for cost attribution.

    Raises:
        KeyError: If agent_name is not found in AGENT_MODELS.
    """
    base = get_agent_model_name(agent_name)
    provider = os.environ.get("EXEPAD_LLM_PROVIDER", "gemini").strip().lower()
    if provider in _NATIVE_GEMINI_PROVIDERS:
        return base
    # Non-Gemini provider: a gemini-* default can't run on it, so it would be
    # swapped for EXEPAD_LLM_MODEL_DEFAULT (see _build_model_for_name).
    if base.startswith("gemini-"):
        base = os.environ.get("EXEPAD_LLM_MODEL_DEFAULT") or base
    return _litellm_model_id(provider, base)


# ── Runtime (per-request) LLM settings ───────────────────────────────────────-
# The self-hosted runtime lets the operator set the LLM provider/key/model in the
# UI; those are sent on each build in the `/r` payload's `runtime_settings` block.
# We apply them to ``os.environ`` (so per-run agents pick them up) and rebind the
# already-constructed module-level singleton agents, since their model objects
# were resolved from the environment at import time and would otherwise be stale.

_RUNTIME_SETTING_ENV = {
    "provider": "EXEPAD_LLM_PROVIDER",
    "api_key": "EXEPAD_LLM_API_KEY",
    "base_url": "EXEPAD_LLM_BASE_URL",
    "model": "EXEPAD_LLM_MODEL_DEFAULT",
    # OpenRouter provider-routing pin (optional; see _openrouter_provider_routing).
    # A change here trips ``changed`` → rebind_runtime_models() so already-built
    # singleton agents pick up the new extra_body on the next build (no restart).
    "provider_order": "EXEPAD_LLM_PROVIDER_ORDER",
    "provider_sort": "EXEPAD_LLM_PROVIDER_SORT",
}

# Serializes the read-modify-rebind sequence below. os.environ and the singleton
# agents' `.model` are process globals shared by every in-flight /r coroutine, so
# without this lock two concurrent builds could interleave the environ writes and
# the rebind (one build swapping the model object another is actively using).
# CONTAMINATION CAVEAT: this lock only makes the mutation atomic — it does NOT
# isolate settings per build. In the self-host topology every build reads the same
# operator-configured global settings, so an actual mid-flight provider switch is
# the only way to affect an in-flight build; true per-request isolation would
# require threading the settings through each agent invocation instead of env
# globals (a larger refactor tracked as future work).
_RUNTIME_SETTINGS_LOCK = threading.Lock()


def apply_runtime_settings(settings: Optional[dict]) -> None:
    """Overlay UI-provided settings onto the environment for this process.

    Idempotent and safe to call every request. Only non-empty values are applied;
    anything omitted keeps the existing environment value (the first-boot seed).
    Rebinds singleton agent models when the LLM environment actually changes.
    """
    if not isinstance(settings, dict):
        return

    with _RUNTIME_SETTINGS_LOCK:
        llm = settings.get("llm")
        changed = False
        if isinstance(llm, dict):
            for field, env_key in _RUNTIME_SETTING_ENV.items():
                value = llm.get(field)
                if isinstance(value, str) and value.strip():
                    value = value.strip()
                    if os.environ.get(env_key) != value:
                        os.environ[env_key] = value
                        changed = True

        # Must run AFTER the loop above (it depends on the provider and key just
        # applied) and BEFORE the rebind below, so a rebuilt Gemini client picks
        # up the mirrored key — TimedGemini.api_client is a cached_property, so a
        # client built without it would keep failing until the process restarts.
        if _sync_native_gemini_key():
            changed = True

        # Stock images: exactly ONE active provider. When the UI sends an
        # explicit ``image_provider`` it is authoritative — set IMAGE_PROVIDER and
        # activate only the selected keyed provider's env var, clearing the other
        # keyed providers so image_generation_utils' fallback chain collapses to
        # the single choice (keyless Openverse stays as its last resort). An
        # ``openverse`` selection clears all keyed vars → the keyless path.
        # Without an explicit provider (legacy payloads) keep the old behaviour:
        # set whatever provider keys arrive, clearing none.
        keyed_image_env = {
            "pexels": ("pexels_api_key", "PEXELS_API_KEY"),
            "unsplash": ("unsplash_api_key", "UNSPLASH_API_KEY"),
            "pixabay": ("pixabay_api_key", "PIXABAY_API_KEY"),
        }
        provider = settings.get("image_provider")
        if isinstance(provider, str) and provider.strip():
            provider = provider.strip().lower()
            os.environ["IMAGE_PROVIDER"] = provider
            for name, (settings_key, env_key) in keyed_image_env.items():
                if name == provider:
                    value = settings.get(settings_key)
                    if isinstance(value, str) and value.strip():
                        os.environ[env_key] = value.strip()
                    # else: keep any existing env value (the first-boot seed or a
                    # key applied on a previous build) — it's the active provider.
                else:
                    # Non-selected keyed provider must not fire. Drop it so only
                    # the selected provider (then keyless Openverse) is tried.
                    os.environ.pop(env_key, None)
        else:
            for settings_key, env_key in (
                ("pexels_api_key", "PEXELS_API_KEY"),
                ("unsplash_api_key", "UNSPLASH_API_KEY"),
                ("pixabay_api_key", "PIXABAY_API_KEY"),
            ):
                value = settings.get(settings_key)
                if isinstance(value, str) and value.strip():
                    os.environ[env_key] = value.strip()

        # Operator toggle: whether generated apps may keep LLM-suggested image
        # URLs (default ON). Only overlaid when the UI sends an explicit boolean;
        # image_generation_utils.keep_llm_image_urls() reads KEEP_LLM_IMAGE_URLS
        # and defaults to keep when unset.
        keep_llm_urls = settings.get("keep_llm_image_urls")
        if isinstance(keep_llm_urls, bool):
            os.environ["KEEP_LLM_IMAGE_URLS"] = "true" if keep_llm_urls else "false"

        # Observability: record the effective image sourcing config the build
        # will run under (provider + keep-LLM-URLs), so a build's image
        # behavior is traceable in the logs. Only when an image block was sent.
        if (isinstance(provider, str) and provider) or isinstance(keep_llm_urls, bool):
            logger.info(
                "applied image runtime settings: provider=%s keep_llm_image_urls=%s",
                os.environ.get("IMAGE_PROVIDER", "(unset)"),
                os.environ.get("KEEP_LLM_IMAGE_URLS", "(unset→keep)"),
            )

        if changed:
            rebind_runtime_models()


# Remembers each agent's ORIGINAL model-name string (keyed by object id) the
# first time it's rebound, so repeated provider switches always re-resolve from
# the true default (e.g. "gemini-3-flash-preview") rather than a previously
# rewritten id like "openrouter/deepseek/...". Agents live for the whole process
# so id() is stable for the registry's lifetime.
_ORIGINAL_MODEL_NAME: dict[int, str] = {}


def _model_name_of(model: Any) -> Optional[str]:
    """The model-name string of a model adapter (or a bare string), without
    touching any cached_property (e.g. TimedGemini.api_client)."""
    if isinstance(model, str):
        return model
    name = getattr(model, "model", None)
    return name if isinstance(name, str) else None


def _original_model_name(agent: Any) -> Optional[str]:
    key = id(agent)
    cached = _ORIGINAL_MODEL_NAME.get(key)
    if cached:
        return cached
    name = _model_name_of(getattr(agent, "model", None))
    if name:
        _ORIGINAL_MODEL_NAME[key] = name
    return name


def _collect_llm_agents(LlmAgent: Any, BaseAgent: Any) -> list:
    """Find every live LlmAgent reachable from the imported ``main_agent`` modules.

    Covers module-level singletons, module-level lists of agents, ParallelAgent /
    SequentialAgent ``sub_agents``, and slot agents stored as attributes of our
    own pool/wrapper objects (e.g. ``component_builder_slots``). Traversal is
    bounded (visited-set + cap) and only reads raw ``__dict__`` + ``sub_agents``,
    so it never triggers a cached_property like ``TimedGemini.api_client``.
    """
    found: list = []
    seen: set[int] = set()
    stack: list = []

    for mod_name, module in list(sys.modules.items()):
        if module is None or not mod_name.startswith("main_agent"):
            continue
        mod_dict = getattr(module, "__dict__", None)
        if isinstance(mod_dict, dict):
            stack.extend(mod_dict.values())

    while stack:
        obj = stack.pop()
        oid = id(obj)
        if oid in seen:
            continue
        seen.add(oid)
        if len(seen) > 200_000:  # backstop — never expected to hit
            break

        if obj is None or isinstance(obj, (str, bytes, bytearray, int, float, bool, type)):
            continue
        if isinstance(obj, dict):
            stack.extend(obj.values())
            continue
        if isinstance(obj, (list, tuple, set, frozenset)):
            stack.extend(obj)
            continue
        if isinstance(obj, BaseAgent):
            if isinstance(obj, LlmAgent):
                found.append(obj)
            sub_agents = getattr(obj, "sub_agents", None)
            if isinstance(sub_agents, (list, tuple)):
                stack.extend(sub_agents)
            continue
        # Our own pool/wrapper objects may hold agents in plain attributes
        # (e.g. a slots list). Descend into their raw __dict__ only — never
        # third-party/library objects, to keep traversal small and side-effect free.
        if (getattr(type(obj), "__module__", "") or "").startswith("main_agent"):
            inst_dict = getattr(obj, "__dict__", None)
            if isinstance(inst_dict, dict):
                stack.extend(inst_dict.values())

    return found


def rebind_runtime_models() -> int:
    """Re-resolve ``.model`` on EVERY live agent after the LLM settings change.

    Static singletons (Creator, Editor, …) AND pool slot agents
    (``component_builder_slot_N``, …) are built from the environment at import
    time and would otherwise keep a stale adapter — e.g. a ``TimedGemini`` with
    no API key after the operator selects OpenRouter, which crashes the parallel
    component build with "No API key was provided". We rebuild each agent's
    adapter from its ORIGINAL model name under the current provider settings.

    Slot agents' names (``component_builder_slot_1``) are NOT in ``AGENT_MODELS``,
    so we key off each agent's original model name rather than its agent name.
    """
    try:
        from google.adk.agents import LlmAgent
        from google.adk.agents.base_agent import BaseAgent
    except Exception as exc:  # pragma: no cover - import shape guard
        logger.warning("rebind_runtime_models: cannot import agents: %s", exc)
        return 0

    count = 0
    for agent in _collect_llm_agents(LlmAgent, BaseAgent):
        model_name = _original_model_name(agent)
        if not model_name:
            continue
        try:
            agent.model = _build_model_for_name(model_name)
            count += 1
        except Exception as exc:
            logger.warning(
                "rebind_runtime_models: failed to rebind %s: %s",
                getattr(agent, "name", "?"),
                exc,
            )
    logger.info("rebind_runtime_models: rebound %d agent models", count)
    return count
