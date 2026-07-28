"""Decode literal unicode escape sequences that land in JSX text.

Production trace evidence (app ``mr5czdwj``, HomeContent): the
ComponentBuilder LLM emitted typographic characters as ``\\uXXXX``
escape sequences inside JSX text children::

    <p>\\u201CThe smell of this bakery...\\u201D</p>
    <span>Open Daily: 7:00 AM \\u2014 4:00 PM</span>

Unicode escapes only decode inside JS **string / template literals**.
As JSX *text children* they render verbatim — the user sees the literal
``\\u201C`` / ``\\u2014`` characters instead of the curly quote / em-dash.

This fixer parses the TSX and decodes ``\\uXXXX``, ``\\u{...}`` and
``\\xXX`` sequences **only inside ``jsx_text`` nodes**. String literals,
template literals, attribute values and ``{...}`` expression containers
are left untouched (their escapes are already correct), so the rewrite
has a near-zero false-positive surface.

Public entry: :func:`apply_component_jsx_text_escape_fixes`.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.tsx_ast.parser import parse_tsx
from main_agent.services.validation.tsx_ast.walker import find_by_type

# ``\uXXXX`` (BMP), ``\u{...}`` (ES6 code point) and ``\xXX`` (Latin-1).
# Scoped to unicode/hex escapes only — ``\n``/``\t`` are deliberately NOT
# decoded here because turning a literal ``\n`` in JSX text into a real
# newline could change layout, and that is not the observed bug.
_ESCAPE_RE = re.compile(r"\\u\{([0-9a-fA-F]+)\}|\\u([0-9a-fA-F]{4})|\\x([0-9a-fA-F]{2})")


def _decode_escapes(text: str) -> tuple[str, int]:
    """Decode unicode/hex escapes in a single JSX-text fragment."""
    count = 0

    def _sub(m: re.Match) -> str:
        nonlocal count
        hex_digits = m.group(1) or m.group(2) or m.group(3)
        try:
            ch = chr(int(hex_digits, 16))
        except (ValueError, OverflowError):
            return m.group(0)
        count += 1
        return ch

    return _ESCAPE_RE.sub(_sub, text), count


def apply_component_jsx_text_escape_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Decode ``\\uXXXX`` / ``\\u{...}`` / ``\\xXX`` inside JSX text nodes."""
    if "\\u" not in tsx and "\\x" not in tsx:
        return tsx

    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx

    buf = tsx.encode("utf-8")
    # Collect (start_byte, end_byte, new_bytes) for changed jsx_text nodes,
    # then splice from right to left so earlier offsets stay valid.
    edits: list[tuple[int, int, bytes]] = []
    total = 0
    for node in find_by_type(tree.root_node, "jsx_text"):
        original = buf[node.start_byte : node.end_byte].decode("utf-8")
        if "\\u" not in original and "\\x" not in original:
            continue
        decoded, count = _decode_escapes(original)
        if count and decoded != original:
            edits.append((node.start_byte, node.end_byte, decoded.encode("utf-8")))
            total += count

    if not edits:
        return tsx

    for start, end, new_bytes in sorted(edits, key=lambda e: e[0], reverse=True):
        buf = buf[:start] + new_bytes + buf[end:]

    fixes_applied.append(
        f"Decoded {total} unicode escape(s) in JSX text "
        "(\\uXXXX renders literally as text — only string literals decode escapes)"
    )
    return buf.decode("utf-8")
