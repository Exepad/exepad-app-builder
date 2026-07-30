"""Shared helpers for terminal component-generation failures."""

from __future__ import annotations

import re
from datetime import datetime, timezone

from main_agent.constants import StateKeys

# Failure classes that block component save outright — only unparseable
# TSX qualifies. Everything else (wiring, a11y, contrast, forbidden APIs,
# style coverage, generic validation_failed) ships as the LLM's last
# auto-fixed attempt with errors rebranded as warnings.
FATAL_FAILURE_CLASSES: frozenset[str] = frozenset({"jsx_syntax_error"})


def is_fatal_component_failure(failure_class: str | None) -> bool:
    """Return True when a component failure class must abort the whole build."""
    if not failure_class:
        return False
    return failure_class in FATAL_FAILURE_CLASSES


def build_placeholder_component_tsx(
    component_name: str,
    failure_reason: str,
    failure_class: str | None = None,
    component_role: str = "content",
) -> str:
    """Generate a safe placeholder TSX for a component that failed validation.

    The placeholder renders a visible "needs attention" card so the deployed
    app stays interactive. The editor surfaces the same component with its
    ``component_issues`` entry so the user can regenerate / hand-fix it.

    Keeps the hard rules ComponentBuilder itself enforces: single default
    export, ``LightDOMContainer`` wrapper, imports only from ``@exepad/sdk``,
    no forbidden browser APIs, no hooks. Safe to reuse across roles.
    """
    reason = (failure_reason or "This section needs your attention.").strip()
    # Keep the reason short enough to render without overflowing the card.
    if len(reason) > 400:
        reason = f"{reason[:397]}..."
    # JSX-safe: escape braces and backticks defensively.
    reason_jsx = reason.replace("{", "(").replace("}", ")").replace("`", "'")
    class_label = (failure_class or "validation_failed").replace("_", " ")

    return f"""import {{ React, LightDOMContainer }} from "@exepad/sdk";

function {component_name}() {{
  return (
    <LightDOMContainer>
      <div className="flex items-center justify-center p-8">
        <div className="max-w-xl w-full rounded-lg border border-outline bg-surface-container p-6 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-error-container text-on-error-container" aria-hidden="true">!</div>
            <div className="flex-1">
              <h2 className="text-base font-semibold text-on-surface">
                "{component_name}" needs your attention
              </h2>
              <p className="mt-2 text-sm text-on-surface-variant">
                {reason_jsx}
              </p>
              <p className="mt-3 text-xs text-on-surface-variant opacity-70">
                Auto-fix skipped ({class_label}). Open this section in the editor and regenerate it, or describe the fix in chat.
              </p>
            </div>
          </div>
        </div>
      </div>
    </LightDOMContainer>
  );
}}
export default {component_name};
"""


# Distinctive substring emitted ONLY by build_placeholder_component_tsx (see the
# "Auto-fix skipped ({class_label})" line above). Load-bearing: is_placeholder_tsx
# matches it to tell a real ComponentBuilder artifact from a shipped placeholder.
# If you edit that line, update this marker too.
_PLACEHOLDER_MARKER = "Auto-fix skipped ("


def is_placeholder_tsx(source: str | None) -> bool:
    """True when ``source`` is a placeholder produced by
    :func:`build_placeholder_component_tsx` (not a real ComponentBuilder artifact).

    Used by the no-save retry to decide recovery: after a re-dispatch, an artifact
    that no longer matches the placeholder marker means the slot saved real TSX.
    Empty/missing source is NOT a placeholder (returns False) — the caller treats
    "no artifact" separately.
    """
    if not source:
        return False
    return _PLACEHOLDER_MARKER in source


def _js_string_literal_body(text: str) -> str:
    """Escape arbitrary text for embedding inside a JS double-quoted string.

    The salvage component renders every body run as a ``{"..."}`` expression
    (not raw JSX text) so no body character can break JSX parsing. That makes
    the ONLY escaping concern the JS string literal itself: backslash and the
    closing quote must be escaped, and raw control characters (newlines, tabs,
    the U+0000–U+001F range) — which are a hard syntax error inside a ``"..."``
    literal — must be flattened to spaces. (A raw control char slipping into
    generated source is exactly the failure class behind the seed-data JSON
    parse errors, so this is deliberately strict.)
    """
    text = text.replace("\\", "\\\\").replace('"', '\\"')
    # Collapse every C0 control char + DEL to a space (covers \n, \r, \t, etc.).
    text = re.sub(r"[\x00-\x1f\x7f]", " ", text)
    return text


def _strip_inline_markdown(text: str) -> str:
    """Reduce inline markdown to plain text (links, emphasis, code, images).

    Deterministic salvage renders escaped plain text, so inline markers are
    stripped rather than translated to nested JSX (which would reintroduce the
    escaping surface this path exists to avoid). Block structure (headings,
    lists, paragraphs) is handled by the caller.
    """
    # Images ![alt](url) -> alt ; links [text](url) -> text
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    # Bold / italic / strikethrough markers -> keep the inner text.
    text = text.replace("**", "").replace("__", "").replace("~~", "")
    text = re.sub(r"(?<![\w*])[*_]([^*_]+)[*_](?![\w*])", r"\1", text)
    text = text.replace("`", "")
    return text.strip()


# Indent for emitted body elements (under the wrapper ``<div>``).
_SALVAGE_INDENT = "        "

_SALVAGE_HEADING_CLASS = {
    1: "text-3xl font-bold text-on-surface mb-2",
    2: "text-2xl font-semibold text-on-surface mt-6 mb-2",
    3: "text-xl font-semibold text-on-surface mt-4 mb-1",
}


def _emit_paragraph(out: list[str], paragraph: list[str]) -> None:
    """Flush an accumulated paragraph (if any) into ``out`` as a ``<p>``."""
    if not paragraph:
        return
    joined = _js_string_literal_body(" ".join(paragraph).strip())
    if joined:
        out.append(
            f'{_SALVAGE_INDENT}<p className="text-on-surface-variant '
            f'leading-relaxed">{{"{joined}"}}</p>'
        )
    paragraph.clear()


def _emit_list(out: list[str], items: list[str]) -> None:
    """Flush accumulated list items (if any) into ``out`` as a ``<ul>``."""
    if not items:
        return
    lis = "\n".join(
        f'{_SALVAGE_INDENT}  <li className="text-on-surface-variant">{{"{li}"}}</li>'
        for li in items
    )
    out.append(
        f'{_SALVAGE_INDENT}<ul className="list-disc space-y-1 pl-6 mb-2">\n'
        f"{lis}\n{_SALVAGE_INDENT}</ul>"
    )
    items.clear()


def _append_heading(out: list[str], match: re.Match) -> None:
    """Append an ``<h1>``/``<h2>``/``<h3>`` for a matched ATX heading line."""
    level = min(len(match.group(1)), 3)
    text = _js_string_literal_body(_strip_inline_markdown(match.group(2)))
    if text:
        tag = f"h{level}"
        cls = _SALVAGE_HEADING_CLASS[level]
        out.append(f'{_SALVAGE_INDENT}<{tag} className="{cls}">{{"{text}"}}</{tag}>')


def _markdown_to_jsx_blocks(md: str) -> list[str]:
    """Parse a markdown body into a flat list of JSX element strings.

    Supports the block constructs that make up real content pages — ATX
    headings (``#``–``######``), unordered (``- * +``) and ordered (``1.``)
    list items, and blank-line-delimited paragraphs. Every text run is emitted
    as a ``{"..."}`` JS-string expression via :func:`_js_string_literal_body`.
    Returns ``[]`` when nothing parseable remains (caller keeps the placeholder).
    """
    out: list[str] = []
    paragraph: list[str] = []
    items: list[str] = []

    for raw in md.splitlines():
        stripped = raw.strip()
        if not stripped:
            _emit_paragraph(out, paragraph)
            _emit_list(out, items)
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            _emit_paragraph(out, paragraph)
            _emit_list(out, items)
            _append_heading(out, heading)
            continue

        item = re.match(r"^(?:[-*+]|\d+[.)])\s+(.*)$", stripped)
        if item:
            _emit_paragraph(out, paragraph)
            text = _js_string_literal_body(_strip_inline_markdown(item.group(1)))
            if text:
                items.append(text)
            continue

        _emit_list(out, items)
        cleaned = _strip_inline_markdown(stripped)
        if cleaned:
            paragraph.append(cleaned)

    _emit_paragraph(out, paragraph)
    _emit_list(out, items)
    return out


def build_content_salvage_component_tsx(
    component_name: str,
    content_source: str,
    *,
    page_title: str = "",
) -> str:
    """Render an eager-loaded content body (markdown) into a real TSX component.

    Deterministic salvage for a ``role == "content"`` component the model failed
    to save even after the no-save re-rolls. The dominant residual no-save is a
    long legal / policy page: the weak model can't reliably echo ~2.5 KB of
    body text into a single ``save_codefocus_component`` tool call, so it ships
    a "needs attention" placeholder despite the platform already holding the
    full copy (eager-inlined into ``content_source`` at dispatch — see
    ``creation_workflow._build_component_builder_input``). No model is needed:
    parse the markdown into headings / paragraphs / lists and emit a
    self-contained component that obeys the same hard rules ComponentBuilder
    enforces — single default export, ``LightDOMContainer`` wrapper,
    ``@exepad/sdk``-only import, no hooks, no forbidden APIs, M3 theme tokens.

    Returns ``""`` when ``content_source`` yields nothing renderable, so the
    caller keeps the placeholder (never worse than today). The result carries
    no ``_PLACEHOLDER_MARKER``, so the no-save bookkeeping treats it as a real,
    recovered artifact.
    """
    blocks = _markdown_to_jsx_blocks(content_source or "")
    if not blocks:
        return ""
    # If the body carries no heading of its own, lead with the page title so
    # the salvaged page still has a clear H1. Anchor the heading probe to the
    # block start (real heading elements begin at ``_SALVAGE_INDENT + "<h"``);
    # an escaped body run that merely mentions "<h1" lands mid-string inside a
    # {"..."} payload, so a bare ``re.search`` would falsely suppress the title.
    title = _js_string_literal_body(_strip_inline_markdown(page_title or "")).strip()
    if title and not any(re.match(rf"{re.escape(_SALVAGE_INDENT)}<h[1-3]\b", b) for b in blocks):
        blocks.insert(
            0,
            f'{_SALVAGE_INDENT}<h1 className="{_SALVAGE_HEADING_CLASS[1]}">' f'{{"{title}"}}</h1>',
        )
    body = "\n".join(blocks)
    return f"""import {{ React, LightDOMContainer }} from "@exepad/sdk";

function {component_name}() {{
  return (
    <LightDOMContainer>
      <div className="mx-auto max-w-3xl px-4 py-12 space-y-4">
{body}
      </div>
    </LightDOMContainer>
  );
}}
export default {component_name};
"""


def build_component_issues(session_state: dict) -> list[dict]:
    """Return a structured list of component issues for the backend callback.

    Backend / editor can badge the affected components and pre-load them as a
    fix-list on the next edit session.
    """
    unresolved = session_state.get(StateKeys.UNRESOLVED_COMPONENTS, {}) or {}
    details = session_state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {}) or {}
    if not isinstance(unresolved, dict):
        return []

    issues: list[dict] = []
    for name, reason in unresolved.items():
        detail = details.get(name, {}) if isinstance(details, dict) else {}
        failure_class = detail.get("failure_class") if isinstance(detail, dict) else None
        first_error = detail.get("first_error") if isinstance(detail, dict) else None
        issues.append(
            {
                "component_name": name,
                "failure_class": failure_class,
                "failure_reason": first_error or str(reason) if reason else first_error,
                "is_fatal": is_fatal_component_failure(failure_class),
                "placeholder_rendered": not is_fatal_component_failure(failure_class),
            }
        )
    return issues


def build_component_generation_failure(
    unresolved_components: dict[str, str],
    user_request: str,
    *,
    failure_classes: dict[str, str] | None = None,
) -> tuple[dict, str, dict]:
    """Build a fatal failure payload for unresolved component generation."""
    component_names = list(unresolved_components.keys())
    visible_names = ", ".join(component_names[:5])
    extra_count = len(component_names) - 5
    if extra_count > 0:
        visible_names = f"{visible_names}, and {extra_count} more"

    generic_failure_reasons = {"builder_escalated", "validation_failed"}
    normalized_reasons = [
        str(reason).strip() for reason in unresolved_components.values() if reason
    ]
    first_reason = next(
        (
            reason
            for reason in normalized_reasons
            if reason and reason not in generic_failure_reasons
        ),
        normalized_reasons[0] if normalized_reasons else "",
    )
    first_reason = " ".join(first_reason.split())
    if len(first_reason) > 240:
        first_reason = f"{first_reason[:237]}..."

    summary = (
        f"Build failed because {len(component_names)} component(s) could not be safely "
        f"generated: {visible_names}."
    )
    if first_reason:
        summary += f" First failure: {first_reason}"

    assistant_response = (
        "I couldn't finish this app because several components failed validation, "
        "so nothing was saved or deployed."
    )
    if visible_names:
        assistant_response = (
            f"I couldn't finish this app because these components failed validation: "
            f"{visible_names}. Nothing was saved or deployed."
        )

    error_entry = {
        "type": "component_generation_failed",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "components": component_names,
        "sources": unresolved_components,
    }
    if first_reason:
        error_entry["first_failure_reason"] = first_reason
    if failure_classes:
        error_entry["failure_classes"] = failure_classes

    conversation_summary = {
        "user_ask": user_request[:240],
        "assistant_action_and_response": assistant_response,
    }

    return error_entry, assistant_response, conversation_summary


def build_component_generation_warning(
    unresolved_components: dict[str, str],
    *,
    failure_classes: dict[str, str] | None = None,
) -> tuple[dict, str, dict]:
    """Build a non-terminal warning payload for components that shipped as placeholders.

    The workflow continues through assembly + save; the user gets a deployed
    app plus a visible note about which sections need regeneration.
    """
    component_names = list(unresolved_components.keys())
    visible_names = ", ".join(component_names[:5])
    extra_count = len(component_names) - 5
    if extra_count > 0:
        visible_names = f"{visible_names}, and {extra_count} more"

    summary = (
        f"{len(component_names)} component(s) shipped as placeholders because "
        f"auto-fix couldn't resolve validator errors: {visible_names}."
    )
    assistant_response = (
        "I finished your app, but some sections need a second pass: "
        f"{visible_names}. They render a placeholder card for now — "
        "open each one in the editor and ask for a regeneration, or describe "
        "the fix in chat and I'll patch it."
    )

    warning_entry = {
        "type": "component_generation_warning",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
        "components": component_names,
        "sources": unresolved_components,
    }
    if failure_classes:
        warning_entry["failure_classes"] = failure_classes

    conversation_summary = {
        "user_ask": "",
        "assistant_action_and_response": assistant_response,
    }

    return warning_entry, assistant_response, conversation_summary


# Mirror of artifact_tools._TSX_VALIDATION_LOG_KEY (artifact_tools.py:33).
# Duplicated (not imported) to avoid an import cycle — artifact_tools imports
# build_placeholder_component_tsx from THIS module. Keep the two in sync.
_TSX_VALIDATION_LOG_KEY = "tsx_component_validation_log"

# Returned when a component never produced a saveable artifact AND left no
# validator trace (the true no-tool-call case: a weak model emitted prose instead
# of calling save_codefocus_component). NOT in FATAL_FAILURE_CLASSES, so the
# component still ships as a placeholder rather than aborting the build.
_NO_SAVE_FAILURE_CLASS = "builder_no_save"
_NO_SAVE_REASON = "Model produced no component code (no save tool call after retries)."


def _failure_from_validation_log(
    session_state: dict,
    component_name: str,
) -> tuple[str | None, str | None]:
    """Recover the last failed save-attempt detail from the per-save validation log.

    ``tsx_component_validation_log`` is written by ``artifact_tools._record_tsx_validation``
    on every save attempt (shape: ``artifact_filename``, ``is_valid``,
    ``validation_errors``, ``error_message``, ``failure_class``). It is the only
    place the real validator errors survive when a build burned its save budget
    without ever clearing a gate (so COMPONENT_FAILURE_DETAILS was never populated).

    The log is shared across all components and capped at 50 entries, so match on
    the component-name-suffixed ``artifact_filename`` and take the LAST failed entry
    to avoid attributing a sibling's error. Returns ``(None, None)`` when the log
    holds no failed entry for this component (e.g. the model never called save).
    """
    log = session_state.get(_TSX_VALIDATION_LOG_KEY, [])
    if not isinstance(log, list):
        return None, None
    suffix = f"{component_name}.tsx"
    for entry in reversed(log):
        if not isinstance(entry, dict) or entry.get("is_valid"):
            continue
        filename = entry.get("artifact_filename", "")
        if not isinstance(filename, str) or not filename.endswith(suffix):
            continue
        errors = entry.get("validation_errors")
        first = errors[0] if isinstance(errors, list) and errors else entry.get("error_message")
        if first:
            return str(first), entry.get("failure_class")
    return None, None


def get_component_failure_metadata(
    session_state: dict,
    component_name: str,
) -> tuple[str, str | None]:
    """Return the best known unresolved-component reason and normalized class.

    Precedence (first non-empty wins):
      1. The save tool's recorded failure detail (``first_error`` + ``failure_class``)
         — present only when the model called save and a validation gate ran.
      2. The last *failed* entry for this component in ``tsx_component_validation_log``
         — recovers the real validator errors when the build burned its save budget
         without ever clearing a gate.
      3. A specific "no save tool call" message — the true no-tool-call case, where a
         weak model returned prose instead of calling ``save_codefocus_component`` and
         left nothing in COMPONENT_FAILURE_DETAILS or the log.

    Never returns the opaque legacy ``"builder_escalated"`` literal: that string was
    undiagnosable from the placeholder card and was stripped from the chat summary
    (it lives in ``generic_failure_reasons``), so it made every no-save failure
    impossible to act on.
    """
    details = session_state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {})
    detail = details.get(component_name, {}) if isinstance(details, dict) else {}
    if not isinstance(detail, dict):
        detail = {}

    # 1. Save-tool failure detail (in-save validation gates).
    first_error = detail.get("first_error")
    if first_error:
        return str(first_error), detail.get("failure_class")

    # 2. Last failed save attempt recovered from the shared validation log.
    log_error, log_class = _failure_from_validation_log(session_state, component_name)
    if log_error:
        return log_error, log_class

    # 3. True no-save — the model never produced a saveable component.
    return _NO_SAVE_REASON, _NO_SAVE_FAILURE_CLASS
