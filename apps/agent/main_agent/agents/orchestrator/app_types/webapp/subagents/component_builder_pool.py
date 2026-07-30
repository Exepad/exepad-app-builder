"""ComponentBuilder static slot pool — workflow_triage parallel pattern.

Replaces the sequential ComponentBuilder dispatch in CreationWorkflow with
a static N-slot ADK ParallelAgent pool. Slot agents are constructed ONCE
at module import time; CreationWorkflow loops over component plans in
chunks of N, dispatching each chunk through the same pool. ADK handles
branching, event tagging, and session isolation natively — no hand-rolled
asyncio gather, no shallow-copied invocation context.

Selection mechanism mirrors the google/adk-python `workflow_triage`
sample: each slot has a `before_agent_callback` that reads
`state["execution_components"]` and short-circuits with a "Slot N idle"
Content event when its name isn't in the active set this round.

Per-round contract (set by CreationWorkflow before each pool dispatch):
- `state["execution_components"] = ["component_builder_slot_1", ...]`
- `state["component_builder_slot_<N>_input"] = json(ComponentBuilderInput)`
- `state["_expected_component_name__component_builder_slot_<N>"] = component name`

Per-round cleanup (also CreationWorkflow's job): pop the keys above before
the next round.
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
    PARALLEL_BUILD_PHASE_TIMEOUT,
    get_agent_model,
)
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder
from main_agent.agents.utils.prose_save_salvage import _dispatch_snapshot_key
from main_agent.agents.utils.timeout_parallel_agent import TimeoutParallelAgent

from .component_builder import (
    _FRONTEND_SKILL_TOOLSET,
    _MAX_TOTAL_SAVE_CALLS,
    _MODULE_SAVE_TOOL_NAME,
    _SAVE_TOOL_NAME,
    _SAVE_TOOL_NAMES,
    _TERMINAL_LATCH_KEY,
    component_builder_after_model_callback,
    sanitize_save_response,
    single_file_suffix,
    static_authoring_prefix,
)
from .artifact_tools import (
    validate_and_save_tsx_component_artifact_tool,
    validate_and_save_tsx_module_artifact_tool,
)
from .theme_token_tool import add_theme_tokens_tool

logger = structlog.get_logger(__name__)


# =============================================================================
# Slot count — env var resolved ONCE at module import
# =============================================================================

# Default 6: meaningfully wider parallelism than the old 4 (fewer serial
# component-build batches on multi-page apps) while staying conservative enough
# to avoid tripping provider rate limits on a single API key. Operators with
# higher rate limits can raise it to the max (10) via COMPONENT_BUILDER_PARALLELISM.
_DEFAULT_NUM_SLOTS = 6
_PARALLELISM_ENV_VAR = "COMPONENT_BUILDER_PARALLELISM"
_MIN_NUM_SLOTS = 1
_MAX_NUM_SLOTS = 10


def _resolve_slot_count() -> int:
    """Read COMPONENT_BUILDER_PARALLELISM, default 6, clamp to [1, 10].

    Resolved exactly once at module import. Setting the env var to ``1``
    reproduces sequential-equivalent behavior — one slot per round, no
    in-flight overlap.
    """
    raw = os.environ.get(_PARALLELISM_ENV_VAR, "").strip()
    if not raw:
        return _DEFAULT_NUM_SLOTS
    try:
        value = int(raw)
    except ValueError:
        logger.warning(
            "Invalid COMPONENT_BUILDER_PARALLELISM, falling back to default",
            raw=raw,
            default=_DEFAULT_NUM_SLOTS,
        )
        return _DEFAULT_NUM_SLOTS
    return max(_MIN_NUM_SLOTS, min(value, _MAX_NUM_SLOTS))


NUM_SLOTS: int = _resolve_slot_count()
SLOT_NAMES: list[str] = [f"component_builder_slot_{i}" for i in range(1, NUM_SLOTS + 1)]


# =============================================================================
# State key constants and helpers
# =============================================================================

STATE_EXECUTION_COMPONENTS = "execution_components"


def slot_input_state_key(slot_name: str) -> str:
    """State key carrying the JSON-serialized ComponentBuilderInput for the slot."""
    return f"{slot_name}_input"


def slot_expected_name_state_key(slot_name: str) -> str:
    """State key carrying the component name this slot is expected to build this round."""
    return f"_expected_component_name__{slot_name}"


def slot_expected_save_tool_state_key(slot_name: str) -> str:
    """State key carrying the expected save-tool name for this slot's current target.

    Set by CreationWorkflow per round (same shape as the legacy
    ``_expected_save_tool_name`` key in component_builder.py, but per-slot to
    avoid cross-slot bleed under parallel dispatch).
    """
    return f"_expected_save_tool_name__{slot_name}"


# =============================================================================
# Chunking helper — used by CreationWorkflow's round loop
# =============================================================================


def chunk_components(seq: Iterable[Any], n: int) -> Iterator[list[Any]]:
    """Yield successive chunks of size ``n`` from ``seq``.

    Wraps :func:`itertools.batched` (Python 3.12+). The final chunk may
    contain fewer than ``n`` elements. Lives in this module (not the
    workflow file) so unit tests can import it directly.

    Example: ``list(chunk_components(range(11), 4))`` →
    ``[[0,1,2,3], [4,5,6,7], [8,9,10]]``.
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

    Mirrors the workflow_triage sample's ``before_agent_callback_check_relevance``.
    The CreationWorkflow sets ``state[STATE_EXECUTION_COMPONENTS]`` to the slot
    names participating in the current round. A slot whose name is absent
    short-circuits via the ADK contract (returning Content from
    ``before_agent_callback`` skips the LLM call and the rest of the agent body).
    """

    def callback(callback_context: CallbackContext) -> Optional[types.Content]:
        state = callback_context.state
        active = state.get(STATE_EXECUTION_COMPONENTS, []) or []
        if slot_name not in active:
            return types.Content(parts=[types.Part(text=f"Slot {slot_name} idle this round.")])
        # Baseline the per-component save counter for THIS dispatch, so the
        # no-save diagnostic can tell "never saved on this dispatch" from the
        # session-cumulative total (which is only ever reset by the no-save
        # retry). See prose_save_salvage._dispatch_snapshot_key.
        expected = state.get(slot_expected_name_state_key(slot_name)) or ""
        if expected:
            state[_dispatch_snapshot_key(slot_name, expected)] = (
                state.get(f"_save_tool_calls:{expected}", 0) or 0
            )
        return None

    return callback


def slot_save_guardrail(
    tool: BaseTool, args: Dict[str, Any], tool_context: ToolContext
) -> Optional[Dict[str, Any]]:
    """Cross-component bleed prevention + per-component call cap, slot-aware.

    Replaces the sequential path's ``component_save_guardrail`` (which
    reads a single global ``_expected_component_name`` key). Under
    parallel dispatch, the expected component name is keyed by slot
    via :func:`slot_expected_name_state_key`. The slot identity is
    resolved from ``tool_context.agent_name`` (already used elsewhere
    in component_builder.py for logging — confirmed available in the
    ADK version we depend on).

    Per-component call cap (``_save_tool_calls:{component_name}``) is
    keyed by COMPONENT NAME, not slot — so caps follow the component
    across slot reuse between rounds.
    """
    if tool.name not in _SAVE_TOOL_NAMES:
        return None

    slot_name = tool_context.agent_name or ""
    expected = tool_context.state.get(slot_expected_name_state_key(slot_name)) or ""

    # Terminal-latch check (shared key, keyed by component name).
    terminal_latches = tool_context.state.get(_TERMINAL_LATCH_KEY, {})
    if isinstance(terminal_latches, dict) and expected in terminal_latches:
        logger.warning(
            "Terminal save-tool latch hit — short-circuiting repeated tool call",
            component=expected,
            slot=slot_name,
        )
        tool_context.actions.escalate = True
        return {
            "success": False,
            "error": terminal_latches[expected],
            "terminal": True,
        }

    # Per-component call cap (counter keyed by component name, not slot).
    call_key = f"_save_tool_calls:{expected}"
    calls = tool_context.state.get(call_key, 0) + 1
    tool_context.state[call_key] = calls
    if calls > _MAX_TOTAL_SAVE_CALLS:
        logger.warning(
            "Per-component save-tool call cap reached — terminating agent loop",
            calls=calls,
            cap=_MAX_TOTAL_SAVE_CALLS,
            component=expected,
            slot=slot_name,
        )
        tool_context.actions.escalate = True
        return {
            "success": False,
            "error": (
                f"Maximum tool call limit ({_MAX_TOTAL_SAVE_CALLS}) reached for "
                f"'{expected}'. STOP calling this tool and return your final "
                "response immediately."
            ),
            "terminal": True,
        }

    # Cross-component bleed check.
    received = args.get("component_name") or args.get("module_name") or ""
    if expected and received != expected:
        logger.warning(
            "Cross-component bleed blocked by slot guardrail",
            expected=expected,
            received=received,
            slot=slot_name,
        )
        return {
            "success": False,
            "error": (
                f"You are building '{expected}', not '{received}'. "
                f"Generate ONLY the artifact for '{expected}'."
            ),
        }

    # Wrong-tool check (component vs module). Per-slot key avoids
    # cross-slot bleed when one slot targets an entry component while a
    # sibling targets a supporting module in the same round.
    expected_tool = (
        tool_context.state.get(slot_expected_save_tool_state_key(slot_name)) or _SAVE_TOOL_NAME
    )
    if tool.name != expected_tool:
        logger.warning(
            "Wrong save tool blocked by slot guardrail",
            expected_tool=expected_tool,
            received_tool=tool.name,
            slot=slot_name,
        )
        return {
            "success": False,
            "error": (
                f"Wrong save tool: you called {tool.name!r} but this build "
                f"targets a "
                f"{('module' if expected_tool == _MODULE_SAVE_TOOL_NAME else 'component')}; "
                f"call {expected_tool!r} instead. Modules use NAMED exports "
                f"only (no `export default`); components use `export default "
                f"function {expected}()`."
            ),
        }
    return None


# =============================================================================
# Slot instruction provider
# =============================================================================


def _build_cached_prefix() -> str:
    """Pre-resolve the byte-stable system_instruction prefix shared by all slots.

    Composed exactly like
    :func:`component_builder.component_builder_instruction_provider` so
    the slot pool stays prompt-cache-equivalent to the standalone
    ComponentBuilder. Resolved ONCE at module import — closure-captured
    by every slot's instruction provider for cache stability across
    rounds.
    """
    return (
        InstructionBuilder()
        .add(static_authoring_prefix())
        .add(single_file_suffix())
        .add_doc("frontend/component_builder/docs/03_COMPONENT_PATTERNS.md")
        .add_doc("frontend/component_builder/docs/05_CODE_COMPONENTS.md")
        .add_doc("frontend/component_builder/docs/10_COLOR_AND_LAYOUT.md")
        .add_doc("frontend/component_builder/docs/11_IMAGES.md")
        .add_doc("frontend/component_builder/docs/12_ANTI_PATTERNS.md")
        .build()
    )


_CACHED_INSTRUCTION_PREFIX: str = _build_cached_prefix()


def slot_instruction_provider(slot_name: str) -> Callable[[ReadonlyContext], str]:
    """Build the slot's instruction provider.

    The cached prefix is closure-captured (not recomputed per call), so
    every invocation yields a byte-stable prefix region followed by the
    per-round input read from ``state[slot_input_state_key]``. This keeps
    the ADK ContextCacheConfig lookup hitting the same cached prefix
    across all rounds for this slot.
    """
    state_key = slot_input_state_key(slot_name)

    def provider(ctx: Optional[ReadonlyContext]) -> str:
        per_round_input = ""
        if ctx is not None:
            per_round_input = ctx.state.get(state_key, "") or ""
        return _CACHED_INSTRUCTION_PREFIX + "\n\n## YOUR INPUT\n" + per_round_input + "\n"

    return provider


# =============================================================================
# Slot agent factory
# =============================================================================


def make_slot_agent(slot_name: str) -> LlmAgent:
    """Construct one slot LlmAgent.

    Mirrors :data:`component_builder.component_builder_agent` but:
    - ``name = slot_name`` (per-slot identity for branching + telemetry)
    - ``instruction = slot_instruction_provider(slot_name)`` (state-keyed)
    - ``input_schema = None`` (input flows via state, not ADK input binding)
    - ``before_agent_callback = slot_skip_callback(slot_name)`` (relevance gate)
    - ``before_tool_callback = slot_save_guardrail`` (slot-aware bleed check)

    All other fields (model, description, tools, planner,
    after_tool_callback, generate_content_config, include_contents) are
    identical to the standalone agent.
    """
    return LlmAgent(
        name=slot_name,
        model=get_agent_model(AgentName.COMPONENT_BUILDER),
        description=(
            "Slot worker for parallel component build. Builds one layout "
            "component per round when activated via state[execution_components]; "
            "skips otherwise."
        ),
        instruction=slot_instruction_provider(slot_name),
        input_schema=None,
        output_schema=None,
        include_contents="none",
        planner=BuiltInPlanner(thinking_config=types.ThinkingConfig(thinking_budget=0)),
        tools=[
            _FRONTEND_SKILL_TOOLSET,
            validate_and_save_tsx_component_artifact_tool,
            validate_and_save_tsx_module_artifact_tool,
            add_theme_tokens_tool,
            load_artifacts,
        ],
        before_agent_callback=slot_skip_callback(slot_name),
        before_tool_callback=slot_save_guardrail,
        after_tool_callback=sanitize_save_response,
        after_model_callback=component_builder_after_model_callback,
        generate_content_config=types.GenerateContentConfig(
            max_output_tokens=COMPONENT_BUILDER_MAX_OUTPUT_TOKENS,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        ),
    )


# =============================================================================
# Module-level singletons (constructed at import time, frozen for the process)
# =============================================================================

component_builder_slots: list[LlmAgent] = [make_slot_agent(name) for name in SLOT_NAMES]

component_builder_parallel: TimeoutParallelAgent = TimeoutParallelAgent(
    name="component_builder_parallel",
    sub_agents=component_builder_slots,
    timeout_seconds=PARALLEL_BUILD_PHASE_TIMEOUT,
)


logger.info(
    "[ComponentBuilderPool] Slot pool initialized at module import",
    num_slots=NUM_SLOTS,
    slot_names=SLOT_NAMES,
    timeout_seconds=PARALLEL_BUILD_PHASE_TIMEOUT,
)
