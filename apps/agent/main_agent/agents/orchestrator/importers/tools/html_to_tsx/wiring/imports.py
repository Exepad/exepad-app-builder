"""Compose the SDK ``import { ... } from "@exepad/sdk";`` line.

Base imports are always present; wiring rules add to the set during
the walk. The transformer reads the final set and renders it
deterministically (alphabetical order, with ``React`` and
``LightDOMContainer`` always first for readability).
"""

from __future__ import annotations

from .context import WiringContext

# Always-imported members. Generated TSX must compile even when the
# component does no wiring at all.
_BASE_IMPORTS: tuple[str, ...] = ("React", "LightDOMContainer")

# Recommended ordering: ``React`` first (matches the convention used by
# every existing scratch-creation component), ``LightDOMContainer``
# second, then alphabetized wiring members.
_PRIORITY_ORDER: tuple[str, ...] = ("React", "LightDOMContainer")


def compose_import_line(ctx: WiringContext) -> str:
    """Return the canonical ``import { ... } from "@exepad/sdk";`` line.

    Combines :data:`_BASE_IMPORTS` with ``ctx.sdk_imports``, sorts
    deterministically, and emits a single import statement matching
    the pattern existing ComponentBuilder output uses.
    """
    members = set(_BASE_IMPORTS) | set(ctx.sdk_imports)
    ordered = _ordered_members(members)
    joined = ", ".join(ordered)
    return f'import {{ {joined} }} from "@exepad/sdk";'


def _ordered_members(members: set[str]) -> list[str]:
    """Order ``members`` with priority items first, then alphabetical."""
    priority = [m for m in _PRIORITY_ORDER if m in members]
    rest = sorted(members - set(_PRIORITY_ORDER))
    return priority + rest
