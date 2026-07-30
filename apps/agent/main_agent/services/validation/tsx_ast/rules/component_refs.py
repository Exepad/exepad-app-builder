"""Cross-reference rules for component TSX.

Most rules in this file (``UseModelUnknownRule``, ``UseHandlerUnknownRule``,
``SetStateUnknownRule``, ``NavigateUnknownPathRule``, ``ModelPayloadFieldsRule``)
were superseded by the tsc Stage-1.5 gate, which catches the same typo classes
via per-app generated TypeScript declarations. The remaining rule —
``IconsUnknownRule`` — stays because the tsc gate types ``Icons`` as ``any``
(staging the curated lucide subset would duplicate the catalog with no
maintenance benefit).

Rule IDs:

- ``component.refs.unknown_icon`` (**error** — crash-class)

Severity policy: unknown ``Icons.X`` references are crash-class because they
render as ``undefined``, triggering React error #130 ("element type is
invalid: got undefined") at component mount. Three rescue layers run before
this rule fires:

1. In-pipeline rewrite via ``component_urls_images.apply_icon_fallback_only``
   (called from the urls_images fixer category).
2. Tier B fallback rescue in ``artifact_tools._apply_post_fix_syntax_gate``
   when the fixer pass corrupts JSX and we revert to the LLM original.
3. Unconditional save-path rescue in
   ``artifact_tools._apply_unconditional_icon_rescue``.

The elevated severity is a backstop for edge cases the rescue regex doesn't
reach (bracket access, re-aliased ``Icons`` references). See
``apps/agent/docs/validation/severity-policy.md``.
"""

from __future__ import annotations

from difflib import get_close_matches
from typing import Iterator

from ..catalog import load_lucide_icons
from ..walker import find_member_expressions, member_chain
from .base import AstContext, Finding


class IconsUnknownRule:
    """``<Icons.Foo />`` — flag when ``Foo`` is not a valid lucide-react icon.

    Severity is ``error`` (crash-class): unknown icons render as ``undefined``
    and trigger React error #130 at component mount. The three rescue layers
    described in the module docstring run before this rule fires, so in
    practice a finding here only occurs when the rescue regex couldn't reach
    a reference (bracket access, re-aliased ``Icons``). The error severity
    then correctly blocks save until the LLM regenerates with valid icon
    names.
    """

    id = "component.refs.unknown_icon"
    severity = "error"

    def _chained_icon_finding(self, member, prop, buf, seen: set) -> "Finding | None":
        """Crash-class finding for ``Icons.<PascalCase>.<X>`` chains, else None.

        Icon components have no sub-properties, so the whole chain renders
        ``undefined`` → React #130 at mount (app ``mr5czdwj``:
        ``Icons.X.Pinterest`` blanked the footer on every page because
        ``Icons.X`` resolves valid and the chained ``.Pinterest`` was invisible
        to the single-segment check). Only the PascalCase-inner shape is handled
        here; the ``Icons.<lowercase>.<X>`` loop-variable case
        (``Icons.stat.icon``) is caught by the single-segment branch when it
        iterates the inner ``Icons.stat`` member, so skipping it here avoids a
        duplicate finding.
        """
        obj = member.child_by_field_name("object")
        inner_obj = obj.child_by_field_name("object")
        inner_prop = obj.child_by_field_name("property")
        if inner_obj is None or inner_prop is None or inner_obj.type != "identifier":
            return None
        if buf[inner_obj.start_byte : inner_obj.end_byte].decode("utf-8") != "Icons":
            return None
        inner_name = buf[inner_prop.start_byte : inner_prop.end_byte].decode("utf-8")
        if not inner_name or not inner_name[0].isupper():
            return None
        chain = member_chain(member, buf)
        if chain in seen:
            return None
        seen.add(chain)
        leaf = buf[prop.start_byte : prop.end_byte].decode("utf-8")
        return Finding(
            rule_id=self.id,
            severity="error",
            message=(
                f"Invalid chained icon access: {chain} — icons have no "
                f"sub-properties; use a single segment like Icons.{leaf}"
            ),
            line=prop.start_point[0] + 1,
            col=prop.start_point[1],
        )

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        icons = load_lucide_icons()
        if not icons:
            return
        buf = ctx.source_buf

        seen: set[str] = set()
        for member in find_member_expressions(ctx.tree.root_node):
            obj = member.child_by_field_name("object")
            prop = member.child_by_field_name("property")
            if obj is None or prop is None or prop.type != "property_identifier":
                continue

            if obj.type == "member_expression":
                finding = self._chained_icon_finding(member, prop, buf, seen)
                if finding is not None:
                    yield finding
                continue

            if obj.type != "identifier":
                continue
            if buf[obj.start_byte : obj.end_byte].decode("utf-8") != "Icons":
                continue
            name = buf[prop.start_byte : prop.end_byte].decode("utf-8")
            if not name or name in seen:
                continue
            seen.add(name)

            # Lucide icons are PascalCase. A lowercase property on ``Icons``
            # is always wrong; the common cause is loop-variable confusion
            # (``[{icon: Icons.Foo}].map(stat => <Icons.stat.icon/>)`` where
            # the author meant ``<stat.icon/>``). Detect the chained access
            # so the error message can point at the swap.
            if not name[0].isupper():
                parent = member.parent
                chained = parent is not None and parent.type == "member_expression"
                hint = (
                    f" — `{name}` looks like a local variable; did you mean "
                    f"`<{name}.icon …/>` instead of `<Icons.{name}.…/>`?"
                    if chained
                    else ""
                )
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=f"Invalid icon access: Icons.{name}{hint}",
                    line=prop.start_point[0] + 1,
                    col=prop.start_point[1],
                )
                continue

            if name in icons:
                continue
            close = get_close_matches(name, list(icons), n=1, cutoff=0.8)
            hint = f' — did you mean "Icons.{close[0]}"?' if close else ""
            yield Finding(
                rule_id=self.id,
                severity="error",
                message=f"Invalid icon: Icons.{name}{hint}",
                line=prop.start_point[0] + 1,
                col=prop.start_point[1],
            )
