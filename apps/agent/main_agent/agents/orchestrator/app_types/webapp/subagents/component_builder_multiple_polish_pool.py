"""ComponentBuilderMultiplePolish static slot pool — workflow_triage parallel pattern.

Replaces the sequential per-action ComponentBuilderMultiplePolish dispatch
inside ``EditingWorkflow._run_phase_frontend_build`` when the workflow is
driven by ``EDIT_PLAN_SOURCE == "design_import"`` and there is more than
one FrontendBuildAction (i.e. multi-page design imports). Slot agents are
constructed ONCE at module import time; the workflow loops over the
synthesized actions in chunks of N, dispatching each chunk through the
same pool. ADK handles branching, event tagging, and session isolation
natively — no hand-rolled asyncio gather.

Selection mechanism mirrors :mod:`component_builder_pool`: each slot has
a ``before_agent_callback`` that reads ``state["execution_components_polish"]``
and short-circuits with a "Slot N idle" ``Content`` event when its name
isn't in the active set this round.

Tool-call cap enforcement migrates INTO the slot agent — under the
sequential path the outer ``_run_cbm_with_caps`` wrapper counts function
calls and breaks at ``COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS``;
under parallel dispatch each slot has its OWN cap via
``slot_polish_tool_cap_guardrail`` (a ``before_tool_callback`` keyed by
``tool_context.agent_name``).

Per-round contract (set by the workflow before each pool dispatch):
- ``state["execution_components_polish"] = ["polish_slot_1", ...]``
- ``state["component_builder_multiple_polish_slot_<N>_input"] = json(ComponentBuilderMultipleInput)``
- ``state["_expected_component_name__component_builder_multiple_polish_slot_<N>"] = entry name``
- ``state["component_builder_multiple_polish_slot_<N>_tool_calls"] = 0``
- ``state["_files_modified_this_turn__component_builder_multiple_polish_slot_<N>"] = []``

Per-round cleanup (also the workflow's job): pop the keys above before
the next round so a short final round (e.g. 3+2 split for 5 actions
at NUM_SLOTS=3) doesn't leave stale entries that an idle slot could see.

The narrow polish toolset (no ``validate_and_save_*``, no
``delete_artifact_tool``) means the only state-key collision risk under
parallel is the ``_files_modified_this_turn`` list that ``edit_artifact_tool``
writes through ``_record_artifact_write_kind``. That function is
slot-aware via ``tool_context.agent_name`` — see
:func:`artifact_tools._record_artifact_write_kind`.

Sized-down design choice: ``COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM``
defaults to **3** (clamped 1-5), one notch lower than
``COMPONENT_BUILDER_PARALLELISM`` (default 4). Each polish dispatch is
heavier than a single-file ComponentBuilder build (the polish agent
reads multiple sibling modules before issuing edits), so a smaller pool
trades off marginally less throughput for safer Vertex RPM headroom.
"""

from __future__ import annotations

import os
from itertools import batched
from typing import Any, Callable, Dict, Iterable, Iterator, Optional

import structlog
from google.adk.agents import LlmAgent
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.planners import BuiltInPlanner
from google.adk.tools import load_artifacts
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types

from config import (
    AgentName,
    COMPONENT_BUILDER_MAX_OUTPUT_TOKENS,
    COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS,
    PARALLEL_BUILD_PHASE_TIMEOUT,
    get_agent_model,
)
from main_agent.agents.utils.timeout_parallel_agent import TimeoutParallelAgent

from .artifact_tools import (
    describe_artifact_tool,
    discover_dependencies_tool,
    edit_artifact_tool,
    find_symbol_references_tool,
    inspect_app_state_tool,
    list_artifacts_tool,
    search_artifacts_tool,
)
from .component_builder_multiple import (
    _FRONTEND_POLISH_SKILL_TOOLSET,
    component_builder_polish_instruction_provider,
)

logger = structlog.get_logger(__name__)


# =============================================================================
# Slot count — env var resolved ONCE at module import
# =============================================================================

_DEFAULT_NUM_SLOTS = 3
_PARALLELISM_ENV_VAR = "COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM"
_MIN_NUM_SLOTS = 1
_MAX_NUM_SLOTS = 5


def _resolve_slot_count() -> int:
    """Read COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM, default 3, clamp to [1, 5].

    Resolved exactly once at module import. Setting the env var to ``1``
    reproduces the pre-parallel sequential-equivalent behavior — one
    slot per round, no in-flight overlap.
    """
    raw = os.environ.get(_PARALLELISM_ENV_VAR, "").strip()
    if not raw:
        return _DEFAULT_NUM_SLOTS
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "Invalid COMPONENT_BUILDER_MULTIPLE_POLISH_PARALLELISM, falling back to default",
            raw=raw,
            default=_DEFAULT_NUM_SLOTS,
        )
        return _DEFAULT_NUM_SLOTS
    return max(_MIN_NUM_SLOTS, min(value, _MAX_NUM_SLOTS))


NUM_SLOTS: int = _resolve_slot_count()
SLOT_NAMES: list[str] = [
    f"component_builder_multiple_polish_slot_{i}" for i in range(1, NUM_SLOTS + 1)
]


# =============================================================================
# State key constants and helpers
# =============================================================================

# Distinct from CreationWorkflow's STATE_EXECUTION_COMPONENTS so the two
# pools cannot clobber each other even if both were ever active in the
# same session (they currently aren't, but defensive separation is cheap).
STATE_EXECUTION_COMPONENTS_POLISH = "execution_components_polish"


def slot_input_state_key(slot_name: str) -> str:
    """State key carrying the JSON-serialized ComponentBuilderMultipleInput for the slot."""
    return f"{slot_name}_input"


def slot_expected_name_state_key(slot_name: str) -> str:
    """State key carrying the entry-component name this slot is expected to polish this round.

    Read by the slot's instruction provider (surfaced to the LLM as
    ``## YOUR INPUT``) and — defensively — by guardrails. Polish has no
    save tools so the bleed guard fires only on ``edit_artifact_tool``.
    The cross-slot module overlap risk documented in the v1 plan is NOT
    enforced here; this key exists for logging/diagnostics + future v3.
    """
    return f"_expected_component_name__{slot_name}"


def slot_tool_call_state_key(slot_name: str) -> str:
    """State key carrying the per-slot tool-call counter for the cap guardrail."""
    return f"{slot_name}_tool_calls"


def slot_files_modified_state_key(slot_name: str) -> str:
    """State key carrying the per-slot ``_files_modified_this_turn`` accumulator.

    Written by :func:`artifact_tools._record_artifact_write_kind` when
    the calling agent is one of this pool's slots. Read by the workflow
    at round end to construct the union dirty set for the tier-2 sweep.
    """
    return f"_files_modified_this_turn__{slot_name}"


# =============================================================================
# Chunking helper — re-exported so the workflow can `from .component_builder_multiple_polish_pool import chunk_components`
# without also importing the sibling component_builder_pool module.
# =============================================================================


def chunk_components(seq: Iterable[Any], n: int) -> Iterator[list[Any]]:
    """Yield successive chunks of size ``n`` from ``seq``.

    Wraps :func:`itertools.batched` (Python 3.12+). The final chunk may
    contain fewer than ``n`` elements.

    Mirrors :func:`component_builder_pool.chunk_components` — same
    behavior, kept here so the polish pool stays self-contained.
    """
    if n < 1:
        raise ValueError(f"chunk size must be >= 1, got {n}")
    for batch in batched(seq, n):
        yield list(batch)


# =============================================================================
# Slot callbacks
# =============================================================================


def slot_skip_callback(slot_name: str) -> Callable[[CallbackContext], Optional[types.Content]]:
    """Build a ``before_agent_callback`` that idles the slot when not in the active set.

    Mirrors :func:`component_builder_pool.slot_skip_callback` but reads
    ``STATE_EXECUTION_COMPONENTS_POLISH``. Returning ``Content`` from
    ``before_agent_callback`` short-circuits ADK's agent loop (skips the
    LLM call and the rest of the agent body); returning ``None`` lets
    the agent run.
    """

    def callback(callback_context: CallbackContext) -> Optional[types.Content]:
        active = callback_context.state.get(STATE_EXECUTION_COMPONENTS_POLISH, []) or []
        if slot_name not in active:
            return types.Content(
                parts=[types.Part(text=f"Slot {slot_name} idle this round.")]
            )
        return None

    return callback


def slot_polish_tool_cap_guardrail(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> Optional[Dict[str, Any]]:
    """Per-slot tool-call cap. Shared callable; reads slot identity from ``tool_context.agent_name``.

    Replaces the outer-wrapper cap counter in
    :func:`editing_workflow.EditingWorkflow._run_cbm_with_caps` (which
    wraps a SINGLE agent's ``run_async`` event stream and is therefore
    incompatible with N parallel slots). Each slot now enforces its own
    ``COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS`` ceiling.

    On overrun:
      * returns a terminal-flagged error dict so the LLM sees the cap
        message in its tool response and stops calling tools;
      * sets ``tool_context.actions.escalate = True`` so ADK's loop
        exits the slot promptly.

    Counts EVERY tool call (read or write) — mirrors the sequential
    wrapper's behavior of counting every ``event.get_function_calls()``.
    """
    slot = tool_context.agent_name or ""
    if not slot.startswith("component_builder_multiple_polish_slot_"):
        # Not one of our slots — leave the call alone. Defensive: this
        # callback only matters when the slot agent is the caller.
        return None

    cap_key = slot_tool_call_state_key(slot)
    calls = int(tool_context.state.get(cap_key, 0) or 0) + 1
    tool_context.state[cap_key] = calls

    if calls > COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS:
        logger.warning(
            "Per-slot polish tool-call cap reached — terminating slot agent loop",
            calls=calls,
            cap=COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS,
            slot=slot,
            tool=tool.name,
        )
        tool_context.actions.escalate = True
        return {
            "success": False,
            "error": (
                f"Tool-call cap ({COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS}) "
                f"reached for this slot. STOP calling tools and return your final "
                f"response immediately."
            ),
            "terminal": True,
        }
    return None


# =============================================================================
# Slot instruction provider — byte-stable prefix + per-round input from state
# =============================================================================


def _build_cached_polish_prefix() -> str:
    """Resolve the byte-stable polish system_instruction prefix.

    The existing ``component_builder_polish_instruction_provider`` is
    already byte-stable across components (per-component data flows
    through the input schema's ``prompt`` field, not into the system
    instruction). Calling it once with ``None`` captures that prefix for
    every slot's instruction provider to reuse, keeping the Vertex
    prompt cache hitting the same key across rounds and slots.
    """
    return component_builder_polish_instruction_provider(None)


_CACHED_INSTRUCTION_PREFIX: str = _build_cached_polish_prefix()


def slot_instruction_provider(slot_name: str) -> Callable[[ReadonlyContext], str]:
    """Build the slot's instruction provider.

    The cached prefix is closure-captured (not recomputed per call), so
    every invocation yields a byte-stable prefix region followed by the
    per-round input read from ``state[slot_input_state_key]``. Vertex
    sees the same cache key for the prefix across rounds and slots.

    Slot agents have ``input_schema=None`` (no ADK input binding); the
    per-round input flows through state, the same routing the
    CreationWorkflow ComponentBuilder pool uses (see
    component_builder_pool.py:316-338).
    """
    state_key = slot_input_state_key(slot_name)

    def provider(ctx: Optional[ReadonlyContext]) -> str:
        per_round_input = ""
        if ctx is not None:
            per_round_input = ctx.state.get(state_key, "") or ""
        return (
            _CACHED_INSTRUCTION_PREFIX
            + "\n\n## YOUR INPUT\n"
            + per_round_input
            + "\n"
        )

    return provider


# =============================================================================
# Slot agent factory
# =============================================================================


def make_slot_agent(slot_name: str) -> LlmAgent:
    """Construct one polish slot LlmAgent.

    Mirrors :data:`component_builder_multiple.component_builder_polish_agent`
    but:
      * ``name = slot_name`` — per-slot identity for branching + telemetry,
        ALSO the value read from ``tool_context.agent_name`` by
        :func:`artifact_tools._record_artifact_write_kind` to route writes
        to the per-slot ``_files_modified_this_turn__{slot}`` key.
      * ``instruction = slot_instruction_provider(slot_name)`` — state-keyed
        input (no ADK input binding).
      * ``input_schema = None`` — input flows via state.
      * ``before_agent_callback = slot_skip_callback(slot_name)`` —
        workflow_triage relevance gate.
      * ``before_tool_callback = slot_polish_tool_cap_guardrail`` —
        per-slot cap counter (shared callable; reads slot identity from
        ``tool_context.agent_name``).

    All other fields (model, description, planner, tools,
    generate_content_config) are identical to the sequential polish agent.
    The narrow toolset is the key architectural guardrail —
    ``edit_artifact_tool`` is the only write surface, so the only state
    key that needs per-slot namespacing is ``_files_modified_this_turn``.
    """
    return LlmAgent(
        name=slot_name,
        model=get_agent_model(AgentName.COMPONENT_BUILDER_MULTIPLE_POLISH),
        description=(
            "Slot worker for parallel multi-page polish. Polishes one "
            "page entry component per round when activated via "
            "state[execution_components_polish]; idles otherwise."
        ),
        instruction=slot_instruction_provider(slot_name),
        input_schema=None,
        output_schema=None,
        include_contents="none",
        planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=8000)),
        tools=[
            _FRONTEND_POLISH_SKILL_TOOLSET,
            load_artifacts,
            list_artifacts_tool,
            search_artifacts_tool,
            describe_artifact_tool,
            discover_dependencies_tool,
            find_symbol_references_tool,
            inspect_app_state_tool,
            edit_artifact_tool,
        ],
        before_agent_callback=slot_skip_callback(slot_name),
        before_tool_callback=slot_polish_tool_cap_guardrail,
        generate_content_config=types.GenerateContentConfig(
            max_output_tokens=COMPONENT_BUILDER_MAX_OUTPUT_TOKENS,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                disable=True
            ),
        ),
    )


# =============================================================================
# Module-level singletons (constructed at import time, frozen for the process)
# =============================================================================

component_builder_multiple_polish_slots: list[LlmAgent] = [
    make_slot_agent(name) for name in SLOT_NAMES
]

component_builder_multiple_polish_parallel: TimeoutParallelAgent = TimeoutParallelAgent(
    name="component_builder_multiple_polish_parallel",
    sub_agents=component_builder_multiple_polish_slots,
    timeout_seconds=PARALLEL_BUILD_PHASE_TIMEOUT,
)


logger.info(
    "[ComponentBuilderMultiplePolishPool] Slot pool initialized at module import",
    num_slots=NUM_SLOTS,
    slot_names=SLOT_NAMES,
    timeout_seconds=PARALLEL_BUILD_PHASE_TIMEOUT,
    max_tool_calls_per_slot=COMPONENT_BUILDER_MULTIPLE_POLISH_MAX_TOOL_CALLS,
)
