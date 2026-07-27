"""Synthesize a useEffect-cleanup body from a JS body.

Scans the JS for patterns that need React-style cleanup when the
component unmounts, and emits matching ``return () => { ... };``
statements for inclusion in the useEffect.

Patterns handled:

* ``window.addEventListener('event', handlerExpr, opts?)`` →
  ``window.removeEventListener('event', handlerExpr);``
* ``document.addEventListener('event', handlerExpr, opts?)`` →
  ``document.removeEventListener('event', handlerExpr);``
* ``const NAME = new IntersectionObserver(...)`` → ``NAME.disconnect();``
* ``const NAME = setInterval(...)`` → ``clearInterval(NAME);``
* ``raf = requestAnimationFrame(...)`` (when assigned to a top-level
  binding named ``raf``, ``rafId``, etc.) → ``cancelAnimationFrame(raf);``

The synthesizer is intentionally conservative: it never invents
cleanup for patterns it can't see. False-negatives leak listeners on
unmount; false-positives would crash. For full-page imports (the
common case), the listeners are typically global and the leak is
inconsequential because the component lives for the whole page.

Public entry: :func:`synthesize_cleanup_body`.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Patterns
# ---------------------------------------------------------------------------

# Match ``window.addEventListener('foo', handler, opts?)``. The handler
# group is *non-greedy* and stops at the first comma followed by an
# options object literal `{...}` OR at the closing paren. Real JS
# parsing is overkill here; the pattern handles 95% of marketing-page
# scripts.
_ADD_EVT_RE = re.compile(
    r"""
    (?P<target>window|document)
    \s*\.\s*addEventListener
    \s*\(
      \s*['"](?P<event>[^'"]+)['"]\s*,
      \s*(?P<handler>[A-Za-z_$][A-Za-z0-9_$]*)   # named handler reference
      \s*(?:,\s*\{[^}]*\})?                       # optional options literal
    \s*\)
    """,
    re.VERBOSE,
)

# Match ``const NAME = new IntersectionObserver(...)`` (or ``let``/``var``).
_IO_RE = re.compile(
    r"""
    (?:const|let|var)
    \s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)
    \s*=\s*
    new\s+IntersectionObserver\b
    """,
    re.VERBOSE,
)

# Match ``const NAME = setInterval(...)``.
_INTERVAL_RE = re.compile(
    r"""
    (?:const|let|var)
    \s+(?P<name>[A-Za-z_$][A-Za-z0-9_$]*)
    \s*=\s*
    setInterval\s*\(
    """,
    re.VERBOSE,
)

# Match assignments to ``raf``/``rafId`` from requestAnimationFrame.
# Recognises both ``let raf = 0`` declaration form and ``raf = requestAnimationFrame(...)``
# assignment form. We scan for the *declaration* and emit cancel in cleanup.
_RAF_DECL_RE = re.compile(
    r"""
    (?:let|var)
    \s+(?P<name>raf|rafId|animationFrame|frameId|rafHandle|animFrame)
    \b
    """,
    re.VERBOSE,
)


def synthesize_cleanup_body(js_body: str) -> str:
    """Return the body of a ``return () => { ... };`` cleanup block.

    Empty string when no cleanup-worthy patterns were detected.
    """
    if not js_body.strip():
        return ""

    cleanup_lines: list[str] = []
    seen: set[str] = set()  # dedupe identical cleanup statements

    for m in _ADD_EVT_RE.finditer(js_body):
        target = m.group("target")
        event = m.group("event")
        handler = m.group("handler")
        line = f"{target}.removeEventListener('{event}', {handler});"
        if line not in seen:
            cleanup_lines.append(line)
            seen.add(line)

    for m in _IO_RE.finditer(js_body):
        name = m.group("name")
        line = f"{name}.disconnect();"
        if line not in seen:
            cleanup_lines.append(line)
            seen.add(line)

    for m in _INTERVAL_RE.finditer(js_body):
        name = m.group("name")
        line = f"clearInterval({name});"
        if line not in seen:
            cleanup_lines.append(line)
            seen.add(line)

    for m in _RAF_DECL_RE.finditer(js_body):
        name = m.group("name")
        line = f"cancelAnimationFrame({name});"
        if line not in seen:
            cleanup_lines.append(line)
            seen.add(line)

    return "\n".join(cleanup_lines)
