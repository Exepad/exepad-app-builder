"""Translate an extracted JS body into a single React.useEffect block.

Approach:

1. The whole JS body becomes the inner body of one
   ``React.useEffect(() => { ... }, [])`` block.
2. Top-level IIFE wrapping (``(function() { ... })();``) is preserved
   verbatim — IIFEs are valid JS inside a useEffect and run once when
   the effect runs (which, with the empty dep array, is once on
   mount).
3. The :mod:`cleanup_synthesizer` scans for patterns that need
   teardown on unmount and emits a matching ``return () => { ... };``
   inside the useEffect.

This intentionally does NOT translate ``getElementById`` to ``useRef``,
nor ``elementHandle.addEventListener`` to JSX ``onXxx`` props. Those
idiomatic conversions can land in a follow-up phase; the wrap-in-
useEffect approach is enough to make Onix-style behaviors run in the
deployed React tree.

Edge cases:

* Empty JS body → returns no useEffect block (the wiring layer
  silently skips it).
* JS body that's already a single function declaration (no
  imperative top level) → wrapped anyway; React.useEffect's body
  containing a function declaration is valid (the function exists,
  isn't called).
* JS body with template-literal backticks → preserved verbatim.

Public entry: :func:`transform_scripts_to_hooks`.
"""

from __future__ import annotations

import textwrap
from dataclasses import dataclass, field

from .cleanup_synthesizer import synthesize_cleanup_body


@dataclass
class JsToHooksResult:
    """Outcome of running the JS-body through the hooks translator."""

    useeffect_blocks: list[str] = field(default_factory=list)
    """Top-level code blocks (each one a complete
    ``React.useEffect(() => { ... }, []);`` statement) ready to splice
    into the function-body preamble."""

    residual_js: str = ""
    """Reserved for Phase 5 (plan-builder). Empty for the Phase 3 MVP
    — the whole JS body goes into the useEffect."""

    warnings: list[str] = field(default_factory=list)


def transform_scripts_to_hooks(scripts_js: str) -> JsToHooksResult:
    """Translate a concatenated JS body into a useEffect block.

    Args:
        scripts_js: The JS body produced by
            :func:`...script_extractor.extract_scripts` — concatenated
            ``<script>`` bodies with analytics already stripped.

    Returns:
        :class:`JsToHooksResult` carrying the useEffect block(s) and
        any warnings.
    """
    body = scripts_js.strip()
    if not body:
        return JsToHooksResult()

    cleanup_body = synthesize_cleanup_body(body)

    indented_body = textwrap.indent(body, "  ")
    if cleanup_body:
        indented_cleanup = textwrap.indent(cleanup_body, "    ")
        block = (
            "React.useEffect(() => {\n"
            f"{indented_body}\n"
            "  return () => {\n"
            f"{indented_cleanup}\n"
            "  };\n"
            "}, []);"
        )
    else:
        block = "React.useEffect(() => {\n" f"{indented_body}\n" "}, []);"

    return JsToHooksResult(useeffect_blocks=[block])
