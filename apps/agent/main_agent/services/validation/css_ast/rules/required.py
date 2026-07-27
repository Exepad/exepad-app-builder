"""Required-structure rules for theme.css.

Four rules, all ``error`` severity:

- ``style.required.layer_exepad_app`` — the ``@layer exepad-app`` block
  must exist; it scopes Tailwind to the Exepad app shadow.
- ``style.required.tailwind_import`` — either the v4
  ``@import "tailwindcss"`` or the v3 ``@tailwind components/utilities``
  pair must be present.
- ``style.required.root_block`` — a ``:root { ... }`` rule must carry
  the SDK CSS variables.
- ``style.required.sdk_variables`` — every entry in the SDK variable
  catalog must be declared inside ``:root``.

The variable list lives in ``REQUIRED_SDK_VARIABLES`` so Step-11 clean-up
can lift it into the ``tsx_ast.catalog`` without duplicating the literal.
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import (
    content_text,
    find_layer_at_rule,
    find_root_rule,
    iter_at_rules,
    node_start_col,
    node_start_line,
    prelude_text,
)
from .base import CssContext, Finding

REQUIRED_SDK_VARIABLES: tuple[str, ...] = (
    "--background",
    "--foreground",
    "--card",
    "--card-foreground",
    "--popover",
    "--popover-foreground",
    "--primary",
    "--primary-foreground",
    "--secondary",
    "--secondary-foreground",
    "--destructive",
    "--destructive-foreground",
    "--muted",
    "--muted-foreground",
    "--accent",
    "--accent-foreground",
    "--border",
    "--input",
    "--ring",
    "--radius",
    "--sidebar-background",
    "--sidebar-foreground",
    "--sidebar-primary",
    "--sidebar-primary-foreground",
    "--sidebar-accent",
    "--sidebar-accent-foreground",
    "--sidebar-border",
    "--sidebar-ring",
)


class LayerExepadAppRule:
    id = "style.required.layer_exepad_app"
    severity = "error"

    _MESSAGE = (
        "Missing @layer exepad-app { ... } block — theme.css must wrap "
        "Tailwind directives in @layer exepad-app."
    )

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        if find_layer_at_rule(ctx.stylesheet, "exepad-app") is None:
            yield Finding(
                rule_id=self.id,
                severity="error",
                message=self._MESSAGE,
                line=1,
                col=0,
            )


class TailwindImportRule:
    id = "style.required.tailwind_import"
    severity = "error"

    _MESSAGE = (
        'Missing Tailwind import — add @import "tailwindcss" at the top of '
        "the stylesheet, OUTSIDE any @layer block."
    )

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        has_v4_import = False
        has_v3_components = False
        has_v3_utilities = False

        # v4 import can sit at the top level OR inside @layer exepad-app;
        # v3 @tailwind components/utilities typically live inside @layer.
        # tinycss2 only gives us top-level at-rules, so we also scan the
        # layer block content (both node-level for the import keyword and
        # textually for the @tailwind directives).
        for at in iter_at_rules(ctx.stylesheet, "import"):
            if "tailwindcss" in prelude_text(at):
                has_v4_import = True
        layer = find_layer_at_rule(ctx.stylesheet, "exepad-app")
        layer_body = content_text(layer) if layer is not None else ""
        combined = ctx.css + "\n" + layer_body
        if not has_v4_import and re.search(r"""@import\s+["']tailwindcss["']""", combined):
            has_v4_import = True
        if "@tailwind components" in combined:
            has_v3_components = True
        if "@tailwind utilities" in combined:
            has_v3_utilities = True
        if has_v4_import or (has_v3_components and has_v3_utilities):
            return
        yield Finding(
            rule_id=self.id,
            severity="error",
            message=self._MESSAGE,
            line=1,
            col=0,
        )


class RootBlockRule:
    id = "style.required.root_block"
    severity = "error"

    _MESSAGE = (
        "Missing :root { ... } block — theme.css must define SDK CSS custom properties "
        "(--background, --foreground, --primary, etc.) in a :root block."
    )

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        if _find_root_rule_anywhere(ctx) is None:
            yield Finding(
                rule_id=self.id,
                severity="error",
                message=self._MESSAGE,
                line=1,
                col=0,
            )


class SdkVariablesRule:
    id = "style.required.sdk_variables"
    severity = "error"

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        root = _find_root_rule_anywhere(ctx)
        if root is None:
            # RootBlockRule owns that failure mode — don't pile on.
            return
        body = content_text(root)
        missing = [v for v in REQUIRED_SDK_VARIABLES if f"{v}:" not in body]
        if not missing:
            return
        missing_str = ", ".join(missing[:5])
        yield Finding(
            rule_id=self.id,
            severity="error",
            message=(
                f"Missing SDK CSS variables in :root block: {missing_str}. "
                f"These are required for SDK components (Button, Card, etc.) "
                f"to render correctly."
            ),
            line=node_start_line(root),
            col=node_start_col(root),
        )


def _find_root_rule_anywhere(ctx: CssContext):
    """``:root`` may live at the top level OR inside ``@layer exepad-app``.

    tinycss2 only parses declarations inside at-rule content on demand,
    so we walk into the layer block separately when the top-level scan
    misses.
    """
    top = find_root_rule(ctx.stylesheet)
    if top is not None:
        return top
    # Look inside the layer by parsing its content as a new stylesheet slice.
    layer = find_layer_at_rule(ctx.stylesheet, "exepad-app")
    if layer is None:
        return None
    import tinycss2

    inner = tinycss2.parse_rule_list(layer.content or [])
    for node in inner:
        if node.type == "qualified-rule" and prelude_text(node).strip() == ":root":
            return node
    return None
