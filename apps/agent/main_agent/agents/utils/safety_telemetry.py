"""Passive forbidden-term detector for chat-emission output.

Telemetry-only safety net (Option 4 in the safety-refactor plan): scans
text headed for the user-visible chat channel for any term forbidden by
``packages/schemas/data/agent_docs/common/docs/00_REFUSAL_RULES.md`` Layers
B-G, and emits a structured WARNING log when one is found. Output is
NEVER modified or blocked.

The doc-side rules are the primary defense — a well-prompted agent
should never emit these terms. This module exists to (a) catch doc-edit
regressions, (b) catch model drift, and (c) measure the real leak rate
under production traffic so we can decide later whether to escalate to
active filtering.

Layer A (agent / routing internals) is already covered by the verb
humanizer at ``orchestrator/core.py``; we keep a few Layer A terms in
the regex anyway as a backstop. Source agents (``app_help_desk``,
``pre_creator``, ``chat_response_writer``) tag every emission so
``terms_detected`` × ``source_agent`` can be aggregated downstream.

Whitelist: the literal phrase ``Claude Design`` is allowed (vendor
export format per safety doc § 4 vendor disclosure policy) — a bare
``Claude`` not followed by ``Design`` is still flagged.

Public API:
    detect_forbidden_terms(text) -> list[str]
    log_chat_emission(text, *, source_agent, session_id, user_prompt)
"""

from __future__ import annotations

import re
from typing import Optional

import structlog

logger = structlog.get_logger(__name__)


# Layers B-G from common/docs/00_REFUSAL_RULES.md § 1, plus a small subset of
# Layer A as a backstop in case the verb humanizer in core.py misses.
# Order is irrelevant for correctness (regex alternation tries all);
# kept loosely grouped by layer for readability.
_FORBIDDEN_TERMS: tuple[str, ...] = (
    # Layer A — agent / routing internals (backstop; humanizer is primary)
    "AppHelpDeskAgent",
    "AppEditorAgent",
    "AppBloggerAgent",
    "PreCreator",
    "ComponentBuilder",
    "DesignSystemBuilder",
    "branch_label",
    "sub_action",
    # Layer B — hosting & infrastructure
    "Cloudflare",
    "Workers",
    "WfP",
    "D1",
    "R2",
    "KV",
    # Layer C — tech stack
    "React",
    "Vite",
    "Hono",
    "Tailwind",
    "Zustand",
    "Radix",
    "shadcn",
    "Turborepo",
    "pnpm",
    "Vitest",
    "Playwright",
    # Layer D — AI / model provider (note: bare "Claude" handled with
    # whitelist below; "AI assistant" is allowed and not listed here)
    "Claude",
    "Anthropic",
    "Opus",
    "Sonnet",
    "Haiku",
    "OpenAI",
    "GPT",
    "Gemini",
    "ADK",
    "LLM",
    # Layer E — build modes / pipeline internals
    "Code Focus",
    "DynamicRenderer",
    # Layer F — repo / file paths (high-signal markers; we don't try to
    # match arbitrary paths here, just the directory roots)
    "monorepo",
    # Layer G — backend protocol / auth internals
    "RPC",
    "MCP",
    "JWT",
    "sys_create",
    "sys_read",
    "sys_list",
    "sys_update",
    "sys_delete",
)


# Single compiled regex, case-insensitive, word-boundary on both sides.
# Word boundaries are essential: prevents `D1`/`R2`/`KV` from matching
# inside identifiers, and prevents `KV` from matching inside `know`-like
# text. `re.escape` defends against any term that ever contains a regex
# metacharacter.
_FORBIDDEN_PATTERN = re.compile(
    r"\b(?:" + "|".join(re.escape(t) for t in _FORBIDDEN_TERMS) + r")\b",
    re.IGNORECASE,
)


def detect_forbidden_terms(text: str) -> list[str]:
    """Return the list of forbidden terms found in ``text``.

    Case-insensitive, word-boundary matched. The ``Claude Design``
    whitelist is applied: a ``Claude`` match whose immediately following
    word is ``Design`` is dropped.

    Empty list = clean. Returns surface-form matches (preserving the
    case the caller used) so logs are readable.
    """
    if not text:
        return []
    hits: list[str] = []
    for match in _FORBIDDEN_PATTERN.finditer(text):
        end = match.end()
        # Whitelist: "Claude Design" (vendor export format).
        if match.group(0).lower() == "claude":
            tail = text[end : end + 8]
            if tail.lstrip().lower().startswith("design"):
                continue
        hits.append(match.group(0))
    return hits


def _truncate(s: Optional[str], limit: int) -> Optional[str]:
    if s is None:
        return None
    if len(s) <= limit:
        return s
    return s[:limit] + "…"


def log_chat_emission(
    text: str,
    *,
    source_agent: str,
    session_id: Optional[str] = None,
    user_prompt: Optional[str] = None,
) -> None:
    """Scan ``text`` for forbidden terms; if any, emit one WARNING log event.

    Never raises. Never modifies ``text``. Safe to call from any chat
    write path — failures (e.g., logger misconfiguration) are swallowed
    so user-visible flow can never break because of telemetry.

    The structured event payload (``event="chat_safety_leak"``) is
    designed to be aggregated by ``terms_detected`` × ``source_agent``
    in downstream log analysis.
    """
    try:
        if not text:
            return
        hits = detect_forbidden_terms(text)
        if not hits:
            return
        logger.warning(
            "chat_safety_leak",
            terms_detected=hits,
            source_agent=source_agent,
            session_id=session_id,
            user_prompt=_truncate(user_prompt, 500),
            chat_text=_truncate(text, 1000),
        )
    except Exception:  # pragma: no cover — telemetry must never raise
        # Swallow. Logger misconfiguration must not break chat emission.
        pass
