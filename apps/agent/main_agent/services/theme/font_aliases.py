"""Symmetric font-alias derivation for the DesignImporter runner.

The runner already calls :func:`compute_m3_palette` to derive the full
30-token M3 color set from 4 seed colors — a one-shot deterministic
computation that guarantees both raw bundle colors AND the canonical
M3 names coexist in ``@theme``. This module is the missing fonts
counterpart.

Code Focus components use **two parallel naming conventions**:

- **M3 names** — ``--font-headline``, ``--font-body`` (used in
  ``packages/schemas/data/agent_docs/frontend/component_builder/...``
  examples and what ``build_design_system_context`` advertises to the
  LLM).
- **Tailwind/runtime names** — ``--font-heading``, ``--font-sans``
  (what ``packages/ui-core/src/globals.css`` declares for ``h1...h6``
  and Tailwind's default body). DesignSystemBuilder always emits both
  M3 and Tailwind names so either alias resolves.

DesignImporter mirrors raw bundle tokens but, before this module
existed, only emitted a one-direction bridge (headline → heading,
body → sans). When the bundle had ``--font-heading`` but not
``--font-headline``, the M3-named class the model produced
(``font-headline``) had no token to bind to.

:func:`compute_font_aliases` closes the gap by emitting the missing
half of each canonical pair in EITHER direction. Idempotent — if both
halves of a pair already exist, no alias is added.

Aliases use ``var(--font-X)`` so the original bundle font is preserved
verbatim. The user's design fidelity is never overridden — we add a
NAME, not a VALUE.
"""

from __future__ import annotations

from collections.abc import Mapping

# Canonical font pairs. Each tuple (left, right) is a bidirectional
# alias — if ONE side exists, the other should too. The order doesn't
# matter for correctness; it's only stable for deterministic test output.
#
# Adding a pair here is the only edit needed to wire a new alias into
# both DesignImporter and any downstream that reads via ``ThemeView``.
CANONICAL_FONT_PAIRS: tuple[tuple[str, str], ...] = (
    # M3 ↔ Tailwind/runtime
    ("headline", "heading"),
    ("body", "sans"),
)


def compute_font_aliases(theme_tokens: Mapping[str, str]) -> list[str]:
    """Return ``@theme`` lines that fill in missing aliases.

    Args:
        theme_tokens: Map of CSS custom-property names to values, e.g.
            ``{"--font-heading": '"Fraunces", serif'}``. Tokens for the
            color/radius/etc. namespaces may be present too — they're
            ignored here.

    Returns:
        A list of CSS declarations (``"--font-X: var(--font-Y)"``) ready
        to splice into the ``@theme {}`` block. Empty when both sides
        of every canonical pair are already defined.

    Examples:
        >>> compute_font_aliases({"--font-heading": "'X', serif"})
        ['--font-headline: var(--font-heading)']

        >>> compute_font_aliases({"--font-headline": "'X', serif"})
        ['--font-heading: var(--font-headline)']

        >>> compute_font_aliases({
        ...     "--font-heading": "'X', serif",
        ...     "--font-headline": "'X', serif",
        ... })
        []

        >>> compute_font_aliases({})
        []
    """
    out: list[str] = []
    for left, right in CANONICAL_FONT_PAIRS:
        left_key = f"--font-{left}"
        right_key = f"--font-{right}"
        has_left = left_key in theme_tokens
        has_right = right_key in theme_tokens
        if has_left and not has_right:
            out.append(f"--font-{right}: var(--font-{left})")
        elif has_right and not has_left:
            out.append(f"--font-{left}: var(--font-{right})")
        # If both or neither — nothing to do.
    return out


def alias_aware_font_lookup(
    theme_tokens: Mapping[str, str],
    name: str,
) -> str | None:
    """Look up a font value, falling through canonical aliases.

    ``theme_view.ThemeView.get_font`` and ``_pick_fonts`` in the runner
    both need this fallthrough: if the caller asks for ``"headline"``
    but the theme only has ``--font-heading``, return that value rather
    than ``None``.

    Returns the raw value (e.g. ``'"Fraunces", serif'``) or ``None`` if
    no alias resolves.
    """
    direct = theme_tokens.get(f"--font-{name}")
    if direct is not None:
        return direct
    for left, right in CANONICAL_FONT_PAIRS:
        if name == left:
            return theme_tokens.get(f"--font-{right}")
        if name == right:
            return theme_tokens.get(f"--font-{left}")
    return None
