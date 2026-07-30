"""Required-prop checks for known SDK components.

The agent's tsc gate at ``agent_sdk_gate.d.ts`` intentionally types JSX
components as ``any`` (header comment lines 11-19: "JSX components are
typed as `any` — the gate does not validate JSX shape, only identifier
names and cross-reference constraints"). Missing-prop checks live in
the AST rule layer instead.

Current allowlist (kept narrow on purpose — each addition is a small
regression-test commitment):

- ``AnimatedCounter`` — requires ``to``. SDK source at
  ``packages/exepad-sdk/src/motion.tsx:196`` declares ``to: number``;
  there is no ``value`` prop. The companion fixer
  ``component_sdk_prop_renames`` auto-corrects the common
  ``value=`` → ``to=`` hallucination, so under normal save flow this
  rule only fires when neither prop is present.

Extending the allowlist: add a row to ``_SDK_COMPONENT_REQUIRED_PROPS``
and a unit-test fixture. Keep allow-list narrow — false positives are
costly because each fires an LLM retry.
"""

from __future__ import annotations

from typing import Iterator

from .base import AstContext, Finding
from .component_jsx import (
    _iter_jsx_opening_elements,
    _jsx_has_attribute,
    _jsx_tag_name,
)


# Map of SDK component name → tuple of required prop names. Membership
# in this map is the gate; absence of every listed prop on a matching
# element yields a single Finding (no per-prop noise).
_SDK_COMPONENT_REQUIRED_PROPS: dict[str, tuple[str, ...]] = {
    "AnimatedCounter": ("to",),
}


class SdkRequiredPropsRule:
    """Error when a known SDK component is missing its required prop(s)."""

    id = "component.sdk.required_prop_missing"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        for el in _iter_jsx_opening_elements(ctx.tree.root_node):
            name = _jsx_tag_name(el, ctx.source_buf)
            required = _SDK_COMPONENT_REQUIRED_PROPS.get(name)
            if not required:
                continue
            missing = [p for p in required if not _jsx_has_attribute(el, p, ctx.source_buf)]
            if not missing:
                continue
            yield Finding(
                rule_id=self.id,
                severity="error",
                message=(
                    f"<{name}> is missing required prop(s): "
                    f"{', '.join(missing)}. "
                    f"See packages/exepad-sdk/src/motion.tsx for the typed signature."
                ),
                line=el.start_point[0] + 1,
                col=el.start_point[1],
            )
