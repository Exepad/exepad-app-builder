"""SDK prop-rename fixes for component TSX.

When the LLM hallucinates a prop name on a known SDK component, rewrite
it to the canonical one before validation surfaces an error. Pairs with
``component_sdk_required_props.py`` (AST rule) which would otherwise
flag the result as a missing required prop.

Current allowlist:

- ``<AnimatedCounter value={N}>`` → ``<AnimatedCounter to={N}>``. The
  SDK source at ``packages/exepad-sdk/src/motion.tsx::AnimatedCounter``
  declares ``to: number`` (required); there is no ``value`` prop. The
  LLM emits ``value=`` regularly because that's the conventional React
  shape for a counter; the SDK chose ``to`` to match motion library
  convention.

Extending the allowlist: add a regex pair below + a one-line test
fixture. Each rewrite is best-effort literal substitution on a single
opening tag; the dispatcher's per-fixer rollback gate reverts the
mutation if the result fails esbuild parse.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext


# Pattern matches the opening `<AnimatedCounter ...>` (or self-closing
# `<AnimatedCounter ... />`) — non-greedy up to the first `>` so nested
# JSX inside expressions doesn't get swallowed. The inner attribute body
# is examined for `to=` presence before substitution.
_ANIMATED_COUNTER_TAG = re.compile(
    r"<AnimatedCounter\b([^>]*?)(/?>)",
    re.DOTALL,
)

# Matches the `value=` attribute on `AnimatedCounter`. The value can be:
#   - {expression}
#   - "string"
#   - 'string'
#   - bare number (rare but valid JSX)
# We capture both the prop name span and its value span so the rewrite
# can preserve formatting.
_VALUE_ATTR = re.compile(
    r"(\bvalue)\s*=\s*(\{[^{}]*\}|\"[^\"]*\"|'[^']*'|\w+)",
)

# Detect existing `to=` so we don't double-rewrite when both props are
# already present (the AST rule would still warn — that's the right
# escalation path, not silent collision).
_TO_ATTR = re.compile(r"\bto\s*=")


def apply_component_sdk_prop_renames_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Rewrite SDK component prop hallucinations to canonical names.

    Conforms to the fixer signature used by ``fixers.dispatcher``:
    returns the rewritten ``tsx`` string and mutates ``fixes_applied``
    in place (the dispatcher prefixes each entry with ``[<fixer>]`` and
    handles per-fixer rollback if our output fails esbuild parse).

    ``ctx`` is accepted for signature stability but currently unused —
    rewrites are pure-syntactic and need no symbol context.
    """
    _ = ctx  # unused

    def _rewrite_animated_counter(match: re.Match[str]) -> str:
        attrs = match.group(1)
        tail = match.group(2)
        # Skip if `to=` is already present — let the AST rule surface
        # the collision instead of silently dropping one prop.
        if _TO_ATTR.search(attrs):
            return match.group(0)
        # Only rewrite the first `value=` occurrence inside this opening
        # tag (there should never be more than one on a single element).
        new_attrs, n = _VALUE_ATTR.subn(r"to=\2", attrs, count=1)
        if n == 0:
            return match.group(0)
        fixes_applied.append(
            "Rewrote AnimatedCounter prop value= → to= "
            "(SDK requires `to` per motion.tsx:196)"
        )
        return f"<AnimatedCounter{new_attrs}{tail}"

    return _ANIMATED_COUNTER_TAG.sub(_rewrite_animated_counter, tsx)
