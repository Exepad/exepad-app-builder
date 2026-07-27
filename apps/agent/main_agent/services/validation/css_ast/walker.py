"""Generic tinycss2 navigation helpers.

Stateless utilities used by CSS rules:

- ``iter_at_rules(stylesheet, name=None)`` — yield at-rule nodes,
  optionally filtered by name (e.g. ``"layer"``, ``"import"``).
- ``iter_qualified_rules(stylesheet)`` — yield ``QualifiedRule`` nodes
  (the ones that look like ``selector { declarations }``).
- ``prelude_text(node)`` — serialize the prelude tokens back to source
  text (used to match selectors like ``:root`` or ``*, *::before``).
- ``content_text(node)`` — serialize the content tokens (for substring
  / regex fall-backs on block bodies).
- ``is_rule_selector(node, selector)`` — stripped-string compare.
"""

from __future__ import annotations

from typing import Any, Iterator

import tinycss2


def iter_at_rules(stylesheet: list[Any], name: str | None = None) -> Iterator[Any]:
    """Yield ``AtRule`` nodes; when ``name`` is given, filter by lower-case keyword."""
    for node in stylesheet:
        if node.type != "at-rule":
            continue
        if name is None or node.lower_at_keyword == name:
            yield node


def iter_qualified_rules(stylesheet: list[Any]) -> Iterator[Any]:
    for node in stylesheet:
        if node.type == "qualified-rule":
            yield node


def prelude_text(node: Any) -> str:
    """Serialize the prelude token stream back to source text."""
    tokens = getattr(node, "prelude", None)
    if tokens is None:
        return ""
    return tinycss2.serialize(tokens).strip()


def content_text(node: Any) -> str:
    tokens = getattr(node, "content", None)
    if tokens is None:
        return ""
    return tinycss2.serialize(tokens)


def is_rule_selector(node: Any, selector: str) -> bool:
    """True when a qualified rule's prelude normalizes to ``selector``."""
    return prelude_text(node) == selector


def find_layer_at_rule(stylesheet: list[Any], name: str) -> Any | None:
    """Return the first ``@layer <name> { ... }`` node, or ``None``."""
    for node in iter_at_rules(stylesheet, "layer"):
        if prelude_text(node).strip() == name:
            return node
    return None


def find_root_rule(stylesheet: list[Any]) -> Any | None:
    """Return the first top-level ``:root { ... }`` qualified rule, or ``None``."""
    for node in iter_qualified_rules(stylesheet):
        if is_rule_selector(node, ":root"):
            return node
    return None


def node_start_line(node: Any) -> int:
    """Best-effort 1-based source line for a node.

    tinycss2 exposes ``source_line`` on most node kinds; when it's
    missing we fall back to 1 so the shared ``Finding`` contract
    (1-based line) stays honoured.
    """
    return getattr(node, "source_line", None) or 1


def node_start_col(node: Any) -> int:
    return getattr(node, "source_column", None) or 0
