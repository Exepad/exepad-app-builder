"""``component.colors.arbitrary_hex`` — forbid arbitrary Tailwind hex
classes (``bg-[#hex]`` / ``text-[#hex]`` / ``border-[#hex]``) in
component classNames.

The bug this catches
--------------------

App ``r3hfcgx5`` (2026-05-14): OrdersContent shipped five status
badges hand-coded with arbitrary Tailwind hex classes:

::

    <Badge className="bg-[#0d9488] text-white ...">Paid</Badge>
    <Badge className="bg-[#2563eb] text-white ...">Shipped</Badge>
    ...

The colors were lifted from the design system's palette by eye —
roughly matching the teal/blue/grey/red/amber sequence that the M3
tokens already provide as ``bg-primary`` / ``bg-secondary`` /
``bg-warning`` / ``bg-error`` / ``bg-outline``. The arbitrary form
bypasses the theme: a future theme swap (dark mode, white-label
rebrand) leaves the badges stuck in the original palette. Tailwind
also bloats the compiled CSS with a one-off rule per arbitrary class.

The fix on the prompt side is the new status-badge recipe in
``10_COLOR_AND_LAYOUT.md`` (P2.3). This rule is the backstop.

Severity
--------

Warning. The output renders correctly — the bug is design-system
discipline, not runtime correctness. Demoting to ``warning`` keeps
the build green; the LLM treats warnings as soft guidance on the
next turn rather than blocking save.

Scope
-----

We match the three commonly-misused Tailwind utility families:

- ``bg-[#...]`` — background color
- ``text-[#...]`` — text color
- ``border-[#...]`` — border color (single-side variants too:
  ``border-t-`` etc.)
- ``ring-[#...]`` / ``outline-[#...]`` — focus / outline color

We do NOT match arbitrary RGB / OKLCH / HSL forms — those are
proportionally rare in agent output and the false-positive risk on
``rgb(var(--...))`` patterns isn't worth the catch rate. Hex is the
LLM's tell.
"""

from __future__ import annotations

import re
from typing import Iterator

from .base import AstContext, Finding


_RULE_ID = "component.colors.arbitrary_hex"


# Match Tailwind arbitrary-value classes with a hex color literal.
# Variants and modifiers are matched on the LEFT (``hover:`` /
# ``md:`` / ``dark:`` / ``group-hover:`` etc. — any ``\w+:`` chain),
# the utility prefix is one of the color-bearing families, then
# ``-[#hex]`` with 3 / 4 / 6 / 8 hex digits.
_ARBITRARY_HEX_RE = re.compile(
    r"(?<![\w-])"  # not preceded by a word char or hyphen
    r"(?:[\w-]+:)*"  # optional variants (hover: / md: / ...)
    r"(bg|text|border(?:-[trblxy])?|ring|outline|fill|stroke|"
    r"from|via|to|placeholder|caret|accent|decoration|divide|"
    r"shadow)"
    r"-\[#[0-9a-fA-F]{3,8}\]"
)

# className attribute parser — handles both string-literal and template-
# literal forms. Mirrors the pattern in ``component_invalid_font_weight``.
_CLASSNAME_RE = re.compile(r'className=(?:"([^"]*)"|\{`([^`]*)`\})')


class ArbitraryHexColorRule:
    """Warn on ``bg-[#hex]`` / ``text-[#hex]`` / ... arbitrary classes.

    Arbitrary hex colors bypass the M3 theme tokens. Theme swaps and
    palette overrides have no effect on them, and the compiled CSS
    gains a one-off rule per occurrence.
    """

    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        tsx = ctx.tsx
        for m in _CLASSNAME_RE.finditer(tsx):
            classes = m.group(1) or m.group(2) or ""
            for hit in _ARBITRARY_HEX_RE.finditer(classes):
                token = hit.group(0)
                util = hit.group(1)
                line = tsx[: m.start()].count("\n") + 1
                yield Finding(
                    rule_id=_RULE_ID,
                    severity="warning",
                    line=line,
                    col=0,
                    message=(
                        f"`{token}` uses an arbitrary hex color — this "
                        f"bypasses the M3 theme tokens. Theme swaps and "
                        f"white-label palette overrides won't affect it, "
                        f"and the compiled CSS gains a one-off rule per "
                        f"occurrence. Use a theme token: `{util}-primary` "
                        f"/ `{util}-secondary` / `{util}-error` / "
                        f"`{util}-surface-container` etc. See "
                        f"10_COLOR_AND_LAYOUT.md for the status-badge "
                        f"recipe."
                    ),
                    fix_hint=(
                        f"replace `{token}` with the closest theme token "
                        f"of the same kind (`{util}-primary` / "
                        f"`{util}-secondary` / `{util}-error` etc.)."
                    ),
                )
