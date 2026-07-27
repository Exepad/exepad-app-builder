"""Salvage a weak model's prose-only TSX into a synthetic save tool call.

The dominant off-Gemini ComponentBuilder failure (``deepseek-v4-flash`` and
similar LiteLLM providers) is **no-save sub-case (a)**: the model generates a
complete component but emits it as a fenced ```tsx code block in plain prose
instead of calling ``validate_and_save_tsx_component_artifact``. With automatic
function calling disabled, ADK never runs the save tool, the artifact is never
written, and the component ships as an opaque placeholder — even though the code
was right there in the response.

This module provides an ``after_model_callback`` that detects exactly that shape
(text with a usable TSX block, NO function call) and rewrites the model response
into a **synthetic save function call**. ADK then executes that call through the
unchanged path: the ``before_tool_callback`` guardrail (bleed + per-component
save-call cap), the full validation pipeline (esbuild → tsc → AST → fixers →
semantic → style coverage), and the artifact write. Nothing bypasses validation;
a salvaged-but-invalid component still fails normally and the model gets feedback
to retry, bounded by the same save-call budget.

Design mirrors :mod:`main_agent.agents.utils.tool_call_normalizer`: a small,
conservative response rewrite returned from ``after_model_callback`` (a non-None
return replaces the response). It is a dependency-free leaf module so both the
standalone ComponentBuilder and the parallel slot pool can compose it without an
import cycle (``component_builder`` imports THIS module).
"""

from __future__ import annotations

import re
from typing import Optional

import structlog
from google.genai import types

logger = structlog.get_logger(__name__)

# Canonical save-tool names. Mirror of the constants defined in
# component_builder.py (``_SAVE_TOOL_NAME`` / ``_MODULE_SAVE_TOOL_NAME``) —
# duplicated, not imported, to keep this a dependency-free leaf. Keep in sync.
_SAVE_TOOL_NAME = "validate_and_save_tsx_component_artifact"
_MODULE_SAVE_TOOL_NAME = "validate_and_save_tsx_module_artifact"

# Session-state key bases. The parallel slot pool suffixes these with
# ``__{slot_name}`` (see component_builder_pool.slot_expected_name_state_key /
# slot_expected_save_tool_state_key); the sequential agent uses the bare key
# (component_builder.component_save_guardrail). We try the slot-scoped key first
# (resolved from the agent name), then fall back to the bare key.
_EXPECTED_NAME_KEY = "_expected_component_name"
_EXPECTED_TOOL_KEY = "_expected_save_tool_name"

# Fenced code block: ```lang\n<body>``` (language tag optional).
_FENCE_RE = re.compile(r"```([A-Za-z0-9_+.-]*)[ \t]*\r?\n(.*?)```", re.DOTALL)

# Language tags that denote TSX/JS-family code (empty tag allowed — many models
# fence with a bare ```).
_CODE_LANGS = frozenset({"", "tsx", "jsx", "ts", "typescript", "js", "javascript", "react"})

# Below this length a "code block" is almost certainly a snippet/quote, not a
# real component — don't salvage it.
_MIN_CODE_LEN = 40

_NAMED_EXPORT_RE = re.compile(r"\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|const|class)\b")


def _looks_like_component_code(code: str) -> bool:
    """Heuristic: the block exports something (default or named)."""
    return "export default" in code or bool(_NAMED_EXPORT_RE.search(code))


def extract_tsx_from_prose(text: Optional[str]) -> Optional[str]:
    """Return the most plausible component/module TSX embedded in ``text``.

    Preference order:
      1. A fenced code block (TSX/JS-family or untagged) that has a ``export
         default`` — the component contract.
      2. The longest such fenced block (covers modules, which use named exports).
      3. The whole message, only if it is an unfenced raw code dump that clearly
         imports and exports.

    Returns ``None`` when nothing looks like real code (so non-code prose — a
    question, an apology, a plan — is never salvaged).
    """
    if not text:
        return None

    candidates: list[str] = []
    for lang, body in _FENCE_RE.findall(text):
        body = body.strip()
        if body and lang.lower() in _CODE_LANGS and _looks_like_component_code(body):
            candidates.append(body)

    chosen: Optional[str] = None
    for c in candidates:
        if "export default" in c:
            chosen = c
            break
    if chosen is None and candidates:
        chosen = max(candidates, key=len)

    if chosen is None:
        stripped = text.strip()
        # Unfenced raw code dump: require clear import + export signals.
        if "```" not in stripped and "import " in stripped and _looks_like_component_code(stripped):
            chosen = stripped

    if chosen is None or len(chosen) < _MIN_CODE_LEN:
        return None
    return chosen


def _dispatch_snapshot_key(slot_name: str, component: str) -> str:
    """State key holding ``_save_tool_calls:{component}`` as of this dispatch.

    Written by the dispatcher right before the agent runs (see
    ``component_builder_pool.slot_skip_callback``). Keyed by BOTH slot and
    component so a slot reused for a different component in a later round starts
    from that component's own baseline.
    """
    return f"_save_calls_at_dispatch__{slot_name}__{component}"


def _resolve_expected(state, slot_name: str, base_key: str) -> Optional[str]:
    """Read a slot-scoped state value (``{base_key}__{slot}``) then the bare key."""
    if slot_name:
        slotted = state.get(f"{base_key}__{slot_name}")
        if slotted:
            return slotted
    return state.get(base_key)


def salvage_prose_into_save_call(callback_context, llm_response) -> Optional[types.LlmResponse]:
    """``after_model_callback`` — convert prose-only TSX into a synthetic save call.

    No-op (returns ``None``) unless ALL hold:
      - the response has parts but NONE is a function call (the model didn't try
        to save), and
      - the text carries an extractable component/module TSX block, and
      - the expected component/module name is resolvable from session state.

    When it fires it replaces the response parts with a single synthetic
    ``validate_and_save_tsx_*`` function call; ADK executes it through the normal
    guardrail + validation + save path. Returning the (mutated) response is the
    ADK contract for replacing it.
    """
    if llm_response is None or getattr(llm_response, "content", None) is None:
        return None
    parts = llm_response.content.parts or []
    if not parts:
        return None
    # The model already tried a tool call — leave the normal path alone.
    if any(getattr(p, "function_call", None) for p in parts):
        return None

    text = "\n".join(p.text for p in parts if getattr(p, "text", None))
    code = extract_tsx_from_prose(text)
    if not code:
        return None

    state = getattr(callback_context, "state", None)
    if state is None:
        return None
    slot_name = getattr(callback_context, "agent_name", "") or ""
    expected = _resolve_expected(state, slot_name, _EXPECTED_NAME_KEY)
    if not expected:
        # Can't attribute the code to a target component — bail rather than guess.
        return None

    expected_tool = _resolve_expected(state, slot_name, _EXPECTED_TOOL_KEY) or _SAVE_TOOL_NAME
    arg_name = "module_name" if expected_tool == _MODULE_SAVE_TOOL_NAME else "component_name"

    logger.warning(
        "salvaged_prose_tsx_into_save_call",
        agent=slot_name or "?",
        component=expected,
        tool=expected_tool,
        code_len=len(code),
    )

    llm_response.content.parts = [
        types.Part(
            function_call=types.FunctionCall(
                name=expected_tool,
                args={"code": code, arg_name: expected},
            )
        )
    ]
    return llm_response


# Enough of the model's message to classify the refusal/deflection shape without
# dumping a whole component into the log.
_NO_SAVE_PREVIEW_CHARS = 600


def log_unsalvageable_no_save(callback_context, llm_response) -> bool:
    """Log the evidence when a builder turn ends with NO save attempt at all.

    :func:`salvage_prose_into_save_call` declines silently whenever the response
    carries no extractable TSX, so the *dominant* weak-model failure — the model
    replies with a short non-code message and never calls the save tool — reaches
    the workflow as a bare ``builder_no_save`` with **no record of what the model
    actually said**. That leaves the platform's most common off-Gemini failure
    undiagnosable: on a self-hosted rig the rig log is the only forensic surface,
    and it currently shows the symptom (`Component X has no artifact after
    builder`) with nothing about the cause.

    Fires only on a genuinely terminal no-save turn:
      - the response has parts and NONE is a function call (nothing was invoked),
      - the expected component name resolves from session state, and
      - ``_save_tool_calls:{component}`` is 0 — the save tool was never attempted
        for this component, so this is not the trailing "saved successfully"
        message that normally follows a good save.

    Purely diagnostic: never mutates the response. Returns True when it logged
    (for tests).
    """
    if llm_response is None or getattr(llm_response, "content", None) is None:
        return False
    parts = llm_response.content.parts or []
    if not parts:
        return False
    if any(getattr(p, "function_call", None) for p in parts):
        return False

    state = getattr(callback_context, "state", None)
    if state is None:
        return False
    slot_name = getattr(callback_context, "agent_name", "") or ""
    expected = _resolve_expected(state, slot_name, _EXPECTED_NAME_KEY)
    if not expected:
        return False
    # A trailing text turn AFTER a successful save is normal — only the turn that
    # never reached the save tool is a failure worth reporting.
    #
    # `_save_tool_calls:{component}` is SESSION-cumulative and is reset in exactly
    # one place (creation_workflow._retry_unresolved_components). Comparing it to
    # zero would therefore silence this diagnostic forever for any component that
    # ever saved once — including on a later re-dispatch that genuinely no-saves.
    # So compare against the count as it stood when THIS dispatch began: the
    # dispatcher records that snapshot, and only a dispatch that has not advanced
    # the counter is a no-save. Falls back to the cumulative check when no
    # snapshot exists (the sequential builder path, which dispatches a component
    # once).
    calls = state.get(f"_save_tool_calls:{expected}", 0) or 0
    snapshot = state.get(_dispatch_snapshot_key(slot_name, expected))
    if snapshot is None:
        if calls:
            return False
    elif calls > snapshot:
        return False

    text = "\n".join(p.text for p in parts if getattr(p, "text", None))
    # Distinguishes the two sub-shapes: a fenced block that the salvage
    # heuristics rejected (fixable in the extractor) vs no code at all (a
    # deflection/refusal — fixable only by re-prompting).
    fenced = bool(_FENCE_RE.search(text or ""))
    logger.warning(
        "builder_no_save_response",
        agent=slot_name or "?",
        component=expected,
        finish_reason=str(getattr(llm_response, "finish_reason", "") or ""),
        text_len=len(text or ""),
        had_code_fence=fenced,
        preview=(text or "")[:_NO_SAVE_PREVIEW_CHARS],
    )
    return True
