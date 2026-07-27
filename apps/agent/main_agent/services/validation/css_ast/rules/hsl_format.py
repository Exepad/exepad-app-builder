"""HSL-format advisory rules for SDK variables in ``:root``.

Two rules, ``warning`` severity:

- ``style.hsl.hex_instead_of_hsl`` — ``--primary: #6750a4`` prevents
  Tailwind's opacity modifier from working.
- ``style.hsl.hsl_fn_wrapper`` — ``--primary: hsl(221, 83%, 53%)``
  breaks the same modifier; the raw space-separated form
  ``221 83% 53%`` is what the SDK's opacity math expects.
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import content_text, node_start_col, node_start_line
from .base import CssContext, Finding
from .required import REQUIRED_SDK_VARIABLES, _find_root_rule_anywhere


class HslHexInsteadRule:
    id = "style.hsl.hex_instead_of_hsl"
    severity = "warning"

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        root = _find_root_rule_anywhere(ctx)
        if root is None:
            return
        body = content_text(root)
        for var in REQUIRED_SDK_VARIABLES:
            if re.search(rf"{re.escape(var)}\s*:\s*#[0-9a-fA-F]{{3,8}}", body):
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    message=(
                        f"SDK variable {var} uses hex format — should be "
                        f'space-separated HSL (e.g., "221 83% 53%") because '
                        f"Tailwind applies opacity modifiers."
                    ),
                    line=node_start_line(root),
                    col=node_start_col(root),
                )
                return


class HslFnWrapperRule:
    id = "style.hsl.hsl_fn_wrapper"
    severity = "warning"

    def check(self, ctx: CssContext) -> Iterator[Finding]:
        root = _find_root_rule_anywhere(ctx)
        if root is None:
            return
        body = content_text(root)
        for var in REQUIRED_SDK_VARIABLES:
            if re.search(rf"{re.escape(var)}\s*:\s*hsl\(", body):
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    message=(
                        f"SDK variable {var} uses hsl() wrapper — should be "
                        f"space-separated HSL without the hsl() function "
                        f'(e.g., "221 83% 53%" not "hsl(221, 83%, 53%)").'
                    ),
                    line=node_start_line(root),
                    col=node_start_col(root),
                )
                return
