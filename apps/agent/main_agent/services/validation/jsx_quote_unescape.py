"""Pre-Stage-1 healer for systematically over-escaped JSX quotes.

Production trace evidence (Onix Studio runs 4 and 5) showed the
ComponentBuilder LLM occasionally emitting TSX with literal ``\\"``
instead of ``"`` in JSX attribute positions:

    <section className=\\"hero\\" id=\\"top\\">  ← syntax error

This is a Gemini SDK serialization quirk — the model is over-escaping
quotes when emitting TSX inside a JSON tool-call response. The
artifact saved to the artifact store contains the literal backslash-
quote characters, and esbuild can't parse it.

The healer scans for at least one ``=\\"<attr-value>\\"`` pattern that
resembles a JSX attribute (followed by whitespace or ``>``). When found,
it unescapes EVERY ``\\"`` in the file — the bug is systemic, not local;
partial unescape would leave the file in a half-broken state.

When the broken pattern is NOT detected, the file is returned unchanged
even if it contains ``\\"`` inside JS string literals (legitimate
escapes). Only the systematic-bug shape triggers the rewrite.

Public entry: :func:`unescape_jsx_quotes`.
"""

from __future__ import annotations

import re

# Detect: ``=\\"<value>\\"`` followed by whitespace or ``>``. The value
# may contain word chars, spaces, hyphens, colons, hashes, dots, slashes,
# parens — the typical CSS-class / id / aria-attribute alphabet. The
# trailing lookahead anchors against the end of a JSX attribute or tag.
_BROKEN_JSX_ATTR_PROBE = re.compile(r'=\\"[\w \-:#./()]*\\"(?=\s|>)')


def unescape_jsx_quotes(tsx: str) -> tuple[str, int]:
    """Detect and repair systematic JSX quote over-escaping.

    Args:
        tsx: Component source — possibly with literal ``\\"`` in JSX
            attribute positions.

    Returns:
        ``(rewritten_tsx, count_of_unescapes)`` — when no broken JSX
        pattern is detected, returns ``(tsx, 0)`` unchanged. When a
        broken pattern fires, ALL ``\\"`` in the file are unescaped to
        ``"`` and the count reflects the total number of replacements.
    """
    if not _BROKEN_JSX_ATTR_PROBE.search(tsx):
        return tsx, 0
    count = tsx.count('\\"')
    if count == 0:
        return tsx, 0
    return tsx.replace('\\"', '"'), count
