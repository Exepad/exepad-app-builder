"""Deterministic rewrites for forbidden browser APIs in component TSX.

Currently covers:

- ``window.location[.href] = X`` and ``window.location = X``
  → ``navigate(X)``. The forbidden-APIs AST rule emits the error
  ``window.location mutation forbidden — use navigate()`` for these
  assignments; rewriting them here lets the save-tool gate clear on the
  first attempt instead of forcing a model retry.

- ``window.location.assign(X)`` and ``window.location.replace(X)``
  → ``navigate(X)``. The AST rule does NOT detect these (it looks at
  assignment_expression nodes only), so the rewrite is preventive: the
  same forbidden pattern in method-call form gets normalised before any
  later check sees it.

- ``console.{log,warn,error,info,debug}(...)`` calls anywhere in the
  source. Uses a paren-balanced scanner so inline calls inside arrow
  bodies (e.g. ``onClick={() => console.log(x)}``) and calls with nested
  arguments (``console.log(fn(a, b))``) are handled correctly. The
  earlier line-anchored regex in ``component_polishing.py`` only
  matched calls at the start of a line and only the ``log`` method.

Read-only access (``window.location.hash``, ``.pathname``, ``.search``)
and ``window.location.reload()`` are intentionally untouched — they're
not in the rule's match set and have legitimate uses.

The rewrite runs *before* ``apply_component_imports_fixes`` in the
dispatcher so the import-injector picks up the freshly-introduced
``navigate(`` calls and adds the missing ``import { navigate } from
'@exepad/sdk'`` automatically.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext

# ``window.location[.href] = <expr>;`` — terminator-required form.
# Capture the RHS up to the next ``;`` on the same logical line. We
# don't try to handle the no-semicolon case: TSX emitted by the LLM is
# semicolon-terminated in practice, and looking past ``;`` risks
# devouring template-string ``}`` braces or block boundaries.
_ASSIGNMENT_RE = re.compile(
    r"window\.location(?:\.href)?\s*=\s*([^;\n]+);",
)

# ``window.location.assign(<args>)`` / ``window.location.replace(<args>)``
# — preserved as call sites because most LLM emits use the assignment
# form, but cover this case for completeness.
_METHOD_CALL_RE = re.compile(
    r"window\.location\.(?:assign|replace)\s*\(([^)]*)\)",
)

# ``console.{log,warn,error,info,debug}`` — match the callee. The opening
# paren is matched immediately after; the actual argument span is found
# by the paren-balancer below, NOT by the regex (which can't handle
# nested parens).
_CONSOLE_CALLEE_RE = re.compile(r"\bconsole\.(?:log|warn|error|info|debug)\s*\(")


def _strip_console_calls(tsx: str, fixes_applied: list[str]) -> str:
    """Remove every ``console.{log,warn,error,info,debug}(...)`` call.

    Walks the source, locates each callee match, then scans forward
    counting parens (respecting string/template literal boundaries) to
    find the matching ``)``. The whole call is replaced — including a
    trailing ``;`` and any leading horizontal whitespace on the same
    line, so the source doesn't end up with a stray ``;`` or ragged
    indentation.

    Returns the rewritten source. Records one human-readable fix per
    method-name removed (``log`` and ``warn`` log separately even if
    both are present) so the per-attempt fix list reflects what
    actually changed.
    """
    out_parts: list[str] = []
    cursor = 0
    method_counts: dict[str, int] = {}

    while True:
        m = _CONSOLE_CALLEE_RE.search(tsx, cursor)
        if m is None:
            out_parts.append(tsx[cursor:])
            break

        # Start of the call expression: include leading horizontal
        # whitespace on the same line so we don't leave a ragged indent
        # behind. ``[^\S\n]`` is whitespace-excluding-newline.
        call_start = m.start()
        line_start = call_start
        while line_start > 0 and tsx[line_start - 1] in (" ", "\t"):
            line_start -= 1

        # Find the matching close paren starting from the ``(`` (which
        # is the last char matched by the regex).
        open_paren = m.end() - 1
        close_paren = _find_matching_paren(tsx, open_paren)
        if close_paren < 0:
            # Unbalanced — bail safely, leave the call alone.
            out_parts.append(tsx[cursor : m.end()])
            cursor = m.end()
            continue

        # Extend past the closing ``)`` to swallow a trailing semicolon
        # and a single trailing newline (so removal collapses cleanly).
        end = close_paren + 1
        while end < len(tsx) and tsx[end] in (" ", "\t"):
            end += 1
        if end < len(tsx) and tsx[end] == ";":
            end += 1
        # If the line is now empty after removal, eat the newline too.
        prefix_was_only_ws = tsx[line_start:call_start].strip() == "" and (
            line_start == 0 or tsx[line_start - 1] == "\n"
        )
        if prefix_was_only_ws and end < len(tsx) and tsx[end] == "\n":
            end += 1
            # When removing the whole line, drop the leading whitespace too.
            call_start = line_start

        # Record the method name for the fixes_applied summary.
        method = tsx[m.start() + len("console.") : m.end() - 1].strip().rstrip("(").strip()
        method_counts[method] = method_counts.get(method, 0) + 1

        out_parts.append(tsx[cursor:call_start])
        cursor = end

    if method_counts:
        for method, count in sorted(method_counts.items()):
            suffix = "" if count == 1 else f" ({count}x)"
            fixes_applied.append(f"Stripped console.{method}() calls{suffix}")

    return "".join(out_parts)


def _find_matching_paren(src: str, open_idx: int) -> int:
    """Return index of the ``)`` matching the ``(`` at ``open_idx``.

    Tracks string and template-literal boundaries so a ``)`` inside
    ``"foo)"`` doesn't close the call. Returns -1 if no match found.
    """
    if open_idx >= len(src) or src[open_idx] != "(":
        return -1
    depth = 0
    i = open_idx
    in_str: str | None = None  # quote char if currently inside a string/template
    n = len(src)
    while i < n:
        ch = src[i]
        if in_str is not None:
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == in_str:
                in_str = None
            elif in_str == "`" and ch == "$" and i + 1 < n and src[i + 1] == "{":
                # Template literal interpolation — recurse on the ``{`` brace
                # span. Find the matching ``}`` while still in template mode
                # OUTSIDE the brace.
                brace_end = _find_matching_brace(src, i + 1)
                if brace_end < 0:
                    return -1
                i = brace_end + 1
                continue
        else:
            if ch in ('"', "'", "`"):
                in_str = ch
            elif ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1


def _find_matching_brace(src: str, open_idx: int) -> int:
    """Like ``_find_matching_paren`` but for ``{ ... }``."""
    if open_idx >= len(src) or src[open_idx] != "{":
        return -1
    depth = 0
    i = open_idx
    in_str: str | None = None
    n = len(src)
    while i < n:
        ch = src[i]
        if in_str is not None:
            if ch == "\\" and i + 1 < n:
                i += 2
                continue
            if ch == in_str:
                in_str = None
        else:
            if ch in ('"', "'", "`"):
                in_str = ch
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return -1


def apply_component_forbidden_api_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Rewrite forbidden browser APIs into platform-supported equivalents.

    Returns the rewritten source. ``ctx`` is accepted for dispatcher
    signature consistency but no fields are read today.
    """
    del ctx  # unused — signature parity with other fixers.

    def _rewrite_assignment(m: re.Match) -> str:
        rhs = m.group(1).strip()
        fixes_applied.append(f"Rewrote forbidden window.location assignment → navigate({rhs})")
        return f"navigate({rhs});"

    def _rewrite_method_call(m: re.Match) -> str:
        args = m.group(1).strip()
        fixes_applied.append(f"Rewrote forbidden window.location.assign/replace → navigate({args})")
        return f"navigate({args})"

    tsx = _ASSIGNMENT_RE.sub(_rewrite_assignment, tsx)
    tsx = _METHOD_CALL_RE.sub(_rewrite_method_call, tsx)
    tsx = _strip_console_calls(tsx, fixes_applied)
    return tsx
