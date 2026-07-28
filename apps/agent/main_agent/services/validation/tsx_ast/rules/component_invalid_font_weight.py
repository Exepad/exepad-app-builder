"""Component invalid-font-weight rule.

Tailwind v4 ships named weight utilities (``font-thin`` / ``font-light``
/ ``font-bold`` / ``font-extrabold`` / ``font-black`` …) — the bare
numeric form ``font-700`` / ``font-800`` is NOT a Tailwind utility and
no rule is emitted in the compiled CSS, so headings using those classes
silently fall back to the parent's font-weight (typically 400).

The same name happens to be a custom property pattern (``--font-700``)
that an app could theoretically define in its theme; the platform's
``style_coverage`` does not check font-weight token coverage either, so
the misuse ships completely undetected.

Companion auto-fixer (``fixers/component_typography.py``) deterministically
rewrites the numeric form to the named utility, mirroring the convention
the design-import flow follows. This rule fires only when the fixer
can't reach (e.g. dynamic className expressions).

Regression for the auto-repair-shop website (`8zlorc3n`, 2026-05-10):
13 occurrences of ``font-700`` / ``font-800`` across 3 components shipped
with their bold display headings rendering at weight 400.
"""

from __future__ import annotations

import re
from typing import Iterator

from .base import AstContext, Finding


# Numeric font-weight utilities (`font-100` … `font-900`). The arbitrary
# form `font-[700]` is intentionally NOT matched — Tailwind treats it as
# a valid arbitrary value and emits the corresponding rule. The negative
# lookbehind ``(?<![\[\w-])`` avoids matching inside `font-[700]` and
# inside dotted/bracket-suffixed identifiers.
_INVALID_FONT_WEIGHT_RE = re.compile(
    r"(?<![\[\w-])font-([1-9]00)(?![\w-])"
)

# className attribute parser — handles both string-literal and template-
# literal forms. Mirrors the pattern in ``component_layout_policy.py``.
_CLASSNAME_RE = re.compile(r'className=(?:"([^"]*)"|\{`([^`]*)`\})')


_NUMERIC_TO_NAMED: dict[str, str] = {
    "100": "thin",
    "200": "extralight",
    "300": "light",
    "400": "normal",
    "500": "medium",
    "600": "semibold",
    "700": "bold",
    "800": "extrabold",
    "900": "black",
}


class InvalidFontWeightRule:
    """Warn on numeric ``font-NNN`` classNames; suggest the named utility.

    Numeric weight utilities (``font-100`` … ``font-900``) are not part
    of Tailwind v4's default theme and produce no CSS rule. Use the named
    utilities (``font-thin`` / ``font-light`` / ``font-bold`` etc.) so the
    compiled stylesheet actually carries a font-weight declaration.
    """

    id = "component.css.invalid_font_weight"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        tsx = ctx.tsx
        for m in _CLASSNAME_RE.finditer(tsx):
            classes = m.group(1) or m.group(2) or ""
            for hit in _INVALID_FONT_WEIGHT_RE.finditer(classes):
                numeric = hit.group(1)
                named = _NUMERIC_TO_NAMED[numeric]
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    message=(
                        f"`font-{numeric}` is not a Tailwind utility — "
                        f"the compiled CSS has no rule for it and the "
                        f"heading silently falls back to weight 400. "
                        f"Use `font-{named}` instead. The companion "
                        f"auto-fixer rewrites this when reachable; if "
                        f"you see this warning, the className is dynamic "
                        f"(template literal with interpolation) — rewrite "
                        f"by hand."
                    ),
                    line=tsx[: m.start()].count("\n") + 1,
                    col=0,
                )
