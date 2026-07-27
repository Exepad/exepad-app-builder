"""Contrast-pair advisory rules for theme.css.

Delegates to the existing ``style_coverage.validate_contrast_pairs``
for the underlying color math (hex/HSL → WCAG AA ratio) and wraps the
result in the shared ``Finding`` shape. The existing helper returns a
combined warning list for both M3 semantic pairs and SDK ``:root``
pairs — we split them back apart by message prefix so each rule
surfaces only its own set.

Rule IDs:

- ``style.contrast.m3_pairs``
- ``style.contrast.sdk_pairs``
"""

from __future__ import annotations

from typing import Iterator

from ...style_coverage import validate_contrast_pairs
from .base import CssContext, Finding


class M3ContrastPairsRule:
    id = "style.contrast.m3_pairs"
    severity = "error"

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        for msg in validate_contrast_pairs(ctx.css):
            # M3 warnings begin with ``Contrast fail: "token"`` — the
            # SDK pair variant begins with ``Contrast fail: SDK "token"``.
            if (
                msg.startswith("Contrast fail:")
                and "SDK " not in msg.split("Contrast fail:", 1)[1][:6]
            ):
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=msg,
                    line=1,
                    col=0,
                )


class SdkContrastPairsRule:
    id = "style.contrast.sdk_pairs"
    severity = "error"

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        for msg in validate_contrast_pairs(ctx.css):
            head = msg.split("Contrast fail:", 1)
            if len(head) == 2 and "SDK " in head[1][:6]:
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=msg,
                    line=1,
                    col=0,
                )
