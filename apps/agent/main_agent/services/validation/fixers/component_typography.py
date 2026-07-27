"""Typography auto-fixes for component TSX.

Currently one fix:

- **Numeric ``font-NNN`` → named utility.** Tailwind v4 ships named
  weight utilities (``font-bold``/``font-extrabold``/``font-black``); the
  numeric form ``font-700``/``font-800`` produces no CSS rule and the
  heading silently falls back to weight 400. The companion AST rule
  ``InvalidFontWeightRule`` (in ``tsx_ast/rules/component_invalid_font_weight``)
  warns when this fixer can't reach (dynamic className expressions).

The fixer rewrites both string-literal and template-literal cooked
className values; it leaves the arbitrary form ``font-[700]`` alone
(Tailwind treats that as a valid arbitrary value).

Regression for the auto-repair-shop website (`8zlorc3n`, 2026-05-10):
13 occurrences of ``font-700``/``font-800`` shipped with bold display
headings rendering at default 400 weight.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext


# Numeric → named font-weight mapping. Mirrors the mapping in
# ``tsx_ast/rules/component_invalid_font_weight.py`` — keep in sync.
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

# Match ``font-NNN`` outside of arbitrary-value brackets and outside of
# longer identifier/dotted forms. The negative lookbehind avoids
# matching inside ``font-[700]`` (arbitrary form, valid Tailwind) and
# the negative lookahead avoids matching prefixes of unrelated tokens
# like ``font-700-foo``.
_INVALID_FONT_WEIGHT_RE = re.compile(
    r"(?<![\[\w-])font-([1-9]00)(?![\w-])"
)

# Match a className attribute and capture its inner string. Two forms
# supported:
#   className="..."             → group 1 is the inner text
#   className={`...`}           → group 2 is the template-literal cooked text
# Anything more dynamic (className={cn(...)}, className={`a-${x}`}) is
# left to the AST rule's warning surface.
_CLASSNAME_RE = re.compile(r'className=(?:"([^"]*)"|\{`([^`]*)`\})')


def apply_component_typography_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Rewrite numeric ``font-NNN`` classes to their named Tailwind utility."""
    del ctx  # unused; FixContext kept for signature uniformity

    rewrites: list[tuple[str, str]] = []  # (numeric, named)

    def _rewrite_classname(class_text: str) -> str:
        """Replace every numeric font-weight token in a className string."""

        def sub(match: re.Match[str]) -> str:
            numeric = match.group(1)
            named = _NUMERIC_TO_NAMED.get(numeric)
            if named is None:  # defensive — regex constrains to the keys above
                return match.group(0)
            rewrites.append((numeric, named))
            return f"font-{named}"

        return _INVALID_FONT_WEIGHT_RE.sub(sub, class_text)

    def _replace_match(m: re.Match[str]) -> str:
        if m.group(1) is not None:
            inner = m.group(1)
            new_inner = _rewrite_classname(inner)
            return f'className="{new_inner}"'
        # Template-literal form
        inner = m.group(2) or ""
        new_inner = _rewrite_classname(inner)
        return f"className={{`{new_inner}`}}"

    new_tsx = _CLASSNAME_RE.sub(_replace_match, tsx)

    if rewrites:
        # De-duplicate by (numeric, named) so the message is concise even
        # when many classes were rewritten.
        unique = sorted(set(rewrites))
        summary = ", ".join(f"font-{n} → font-{name}" for n, name in unique)
        fixes_applied.append(
            f"Rewrote invalid numeric font-weight utilities to named form: {summary}"
        )

    return new_tsx
