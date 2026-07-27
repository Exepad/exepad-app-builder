"""Tree-sitter TSX parser wrapper.

Thin wrapper around ``tree_sitter_typescript.language_tsx()`` so rule modules
don't each import tree_sitter directly. The ``Language`` + ``Parser`` pair is
built once at import time and reused across every ``parse_tsx`` call.

Tree-sitter parses in 1-5ms per average handler, so there is no need to cache
parsed trees across rule runs — the rule runner passes the same ``Tree`` to
every rule in a single invocation via ``AstContext``.
"""

from __future__ import annotations

import tree_sitter_typescript
from tree_sitter import Language, Parser, Tree

_TSX_LANGUAGE: Language = Language(tree_sitter_typescript.language_tsx())
_PARSER: Parser = Parser(_TSX_LANGUAGE)


def parse_tsx(source: str) -> Tree:
    """Parse TSX source to a tree-sitter Tree.

    ``source`` is a regular ``str``; the parser requires ``bytes`` internally
    and we encode once here. The returned ``Tree`` can be walked freely; its
    node byte offsets reference the encoded buffer, which callers should
    re-derive via ``source_bytes()`` if they need text extraction.
    """
    return _PARSER.parse(source.encode("utf-8"))


def source_bytes(source: str) -> bytes:
    """Return the exact ``bytes`` buffer the parser sees.

    Rules that extract node text via ``node.start_byte : node.end_byte`` must
    slice into the same encoded buffer the parser used, otherwise multibyte
    characters break offsets.
    """
    return source.encode("utf-8")


def node_text(node, source_buf: bytes) -> str:
    """Decode the bytes slice covered by a tree-sitter node."""
    return source_buf[node.start_byte : node.end_byte].decode("utf-8")
