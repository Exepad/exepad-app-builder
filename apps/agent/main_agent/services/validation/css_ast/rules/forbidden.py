"""Forbidden-pattern rules for theme.css.

Five rules, all ``error`` severity, each flagging a pattern that must
NOT appear in generated ``theme.css``. Four use the tinycss2 node tree
to inspect structure (``@font-face``, ``:host`` qualified rules,
``@tailwind base``, bootstrap-inside-layer ordering) and one keeps a
substring fall-back for the pattern that doesn't benefit from AST
walking (the global reset).

Rule IDs:

- ``style.forbidden.host_selector``
- ``style.forbidden.v3_tailwind_directive``
- ``style.forbidden.global_reset``
- ``style.forbidden.font_face``
- ``style.forbidden.bootstrap_inside_layer``
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import (
    content_text,
    iter_at_rules,
    iter_qualified_rules,
    node_start_col,
    node_start_line,
    prelude_text,
)
from .base import CssContext, Finding


class HostSelectorRule:
    id = "style.forbidden.host_selector"
    severity = "error"

    _MESSAGE = (
        ":host selector is forbidden — components render in Light DOM, not Shadow DOM. "
        "Remove all :host rules."
    )

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        for rule in iter_qualified_rules(ctx.stylesheet):
            selector = prelude_text(rule)
            if selector.startswith(":host"):
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=self._MESSAGE,
                    line=node_start_line(rule),
                    col=node_start_col(rule),
                )
                return


class V3TailwindBaseRule:
    id = "style.forbidden.v3_tailwind_directive"
    severity = "error"

    _MESSAGE = (
        "@tailwind base is forbidden — the runtime provides its own CSS reset. "
        "Remove @tailwind base."
    )

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        for at in iter_at_rules(ctx.stylesheet, "tailwind"):
            prelude = prelude_text(at)
            if prelude.startswith("base"):
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=self._MESSAGE,
                    line=node_start_line(at),
                    col=node_start_col(at),
                )
                return


class GlobalResetRule:
    id = "style.forbidden.global_reset"
    severity = "error"

    _MESSAGE = (
        "Global reset (* { margin: 0 }) is forbidden — it strips margins/padding from "
        "the platform layout. The runtime's Tailwind v4 provides box-sizing: border-box."
    )
    # Use the raw source here — tinycss2 splits the pseudo-element selectors
    # into many tokens and rebuilding the exact combinator is brittle. A
    # focused regex over the CSS text is both simpler and faithful to the
    # original design_system_validator behaviour.
    _PATTERN = re.compile(r"\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*margin\s*:\s*0")

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        if self._PATTERN.search(ctx.css):
            yield Finding(
                rule_id=self.id,
                severity="error",
                message=self._MESSAGE,
                line=1,
                col=0,
            )


class FontFaceRule:
    id = "style.forbidden.font_face"
    severity = "error"

    _MESSAGE = (
        "@font-face rules are forbidden — font loading is handled by DynamicFontLoader. "
        "Remove @font-face and use Google Fonts URLs instead."
    )

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        for at in iter_at_rules(ctx.stylesheet, "font-face"):
            yield Finding(
                rule_id=self.id,
                severity="error",
                message=self._MESSAGE,
                line=node_start_line(at),
                col=node_start_col(at),
            )
            return


class BootstrapInsideLayerRule:
    """Reject `@import "..."` and `@source "..."` directives nested inside any
    `@layer { ... }` block.

    Tailwind v4 inlines `@import "<pkg>"` content at the import site. If the
    import is wrapped in `@layer exepad-app { ... }`, any `@utility`
    declarations the imported package contains end up nested in the layer
    and Tailwind aborts with `@utility cannot be nested.`. The same holds
    for `@source`, which Tailwind itself rejects with `@source cannot be
    nested.`. Both errors abort the entire compile.

    The deterministic ``_lift_nested_bootstrap_directives`` healer in
    ``final_compile_gate`` rewrites this shape before compilation, but
    catching it at save time gives the LLM faster signal.
    """

    id = "style.forbidden.bootstrap_inside_layer"
    severity = "error"

    _MESSAGE = (
        '@import "..." and @source "..." must live at the top of the '
        "stylesheet, OUTSIDE any @layer block. Tailwind v4 inlines package "
        "content (notably tw-animate-css) at the import site; nesting the "
        "import inside @layer makes the package's internal @utility "
        "declarations nest too, which Tailwind rejects with "
        "'@utility cannot be nested.'"
    )

    _BOOTSTRAP_RE = re.compile(r"@(?:import|source)\b")

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        for layer in iter_at_rules(ctx.stylesheet, "layer"):
            body = content_text(layer)
            if self._BOOTSTRAP_RE.search(body):
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=self._MESSAGE,
                    line=node_start_line(layer),
                    col=node_start_col(layer),
                )
                return
