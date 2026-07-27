"""Component JSX rules.

Rules that inspect individual JSX elements:

- ``component.jsx.raw_img_tag`` — warn on a raw ``<img>`` whose ``src``
  is empty, ``__PLACEHOLDER__``, or a ``data:`` URI. Tags with dynamic
  ``src={...}`` or a licensed domain URL are intentionally left alone.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_by_type, string_literal_value
from .base import AstContext, Finding


class RawImgTagRule:
    """Warn on ``<img>`` JSX tags with placeholder/empty/data-URI ``src``."""

    id = "component.jsx.raw_img_tag"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        reported = False
        for el in _iter_jsx_opening_elements(ctx.tree.root_node):
            name = _jsx_tag_name(el, ctx.source_buf)
            if name != "img":
                continue
            src = _jsx_attribute_string_value(el, "src", ctx.source_buf)
            # Dynamic ``src={expr}`` → ``src`` is None and the attribute
            # exists with a non-string value. We only flag empty-string,
            # placeholder, or data-URI literal values.
            if _jsx_has_dynamic_attribute(el, "src", ctx.source_buf):
                continue
            if src is None:
                # No ``src`` attr at all — still a missing-fallback smell.
                src = ""
            if src and src != "__PLACEHOLDER__" and not src.startswith("data:"):
                continue
            if reported:
                continue
            reported = True
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=(
                    "Found raw <img> tag — prefer <ExepadImage> from @exepad/sdk "
                    "for automatic stock image resolution with importance-based quality"
                ),
                line=el.start_point[0] + 1,
                col=el.start_point[1],
            )


# ---------------------------------------------------------------------------
# JSX helpers — shared with other component rules in this file and, in
# future, ``component_a11y.py``.
# ---------------------------------------------------------------------------


def _iter_jsx_opening_elements(root):
    """Yield both opening (``<Foo>``) and self-closing (``<Foo/>``) elements."""
    yield from find_by_type(root, "jsx_opening_element")
    yield from find_by_type(root, "jsx_self_closing_element")


def _jsx_tag_name(element, buf: bytes) -> str:
    """Return the tag name of a JSX element node (opening or self-closing).

    Handles:
    - ``<Foo>`` where the name is an ``identifier``.
    - ``<foo>`` for lowercase HTML tags (same ``identifier`` node type).
    - ``<Foo.Bar>`` where the name is a ``member_expression`` — the
      returned text is the full dotted form.
    """
    name_node = element.child_by_field_name("name")
    if name_node is None:
        for child in element.children:
            if child.type in ("identifier", "nested_identifier", "member_expression"):
                name_node = child
                break
    if name_node is None:
        return ""
    return buf[name_node.start_byte : name_node.end_byte].decode("utf-8")


def _iter_jsx_attributes(element):
    for child in element.children:
        if child.type == "jsx_attribute":
            yield child


def _jsx_attribute_value_node(element, attr_name: str, buf: bytes):
    """Return the value node of ``attr_name`` on this element, or ``None``.

    Tree-sitter-typescript's ``jsx_attribute`` has two named children: a
    ``property_identifier`` (the name) and an optional value node which is
    either a ``string`` literal or a ``jsx_expression`` container. Field
    names are NOT populated on these children in the shipped grammar, so
    we iterate ``named_children`` by position instead of calling
    ``child_by_field_name``.
    """
    for attr in _iter_jsx_attributes(element):
        if attr.named_child_count == 0:
            continue
        name_node = attr.named_children[0]
        if buf[name_node.start_byte : name_node.end_byte].decode("utf-8") != attr_name:
            continue
        if attr.named_child_count == 1:
            # Flag attribute with no value — ``<img disabled>``.
            return None
        return attr.named_children[1]
    return None


def _jsx_attribute_string_value(element, attr_name: str, buf: bytes) -> str | None:
    """Return the literal string value of ``attr_name``, or ``None``."""
    value = _jsx_attribute_value_node(element, attr_name, buf)
    if value is None or value.type != "string":
        return None
    return string_literal_value(value, buf)


def _jsx_has_dynamic_attribute(element, attr_name: str, buf: bytes) -> bool:
    """True when ``attr_name`` exists on the element with a ``{expr}`` value."""
    value = _jsx_attribute_value_node(element, attr_name, buf)
    return value is not None and value.type == "jsx_expression"


def _jsx_has_attribute(element, attr_name: str, buf: bytes) -> bool:
    """True iff ``attr_name`` is present on ``element`` (with or without value)."""
    for attr in _iter_jsx_attributes(element):
        if attr.named_child_count == 0:
            continue
        name_node = attr.named_children[0]
        if buf[name_node.start_byte : name_node.end_byte].decode("utf-8") == attr_name:
            return True
    return False


def _opening_element(jsx_element_node):
    """Return the ``jsx_opening_element`` child of a paired ``jsx_element``."""
    for child in jsx_element_node.children:
        if child.type == "jsx_opening_element":
            return child
    return None


def _jsx_element_text_content(jsx_element_node, buf: bytes) -> str:
    """Concatenate visible ``jsx_text`` descendants — including spans / wrappers."""
    parts: list[str] = []
    for text_node in find_by_type(jsx_element_node, "jsx_text"):
        text = buf[text_node.start_byte : text_node.end_byte].decode("utf-8")
        stripped = text.strip()
        if stripped:
            parts.append(stripped)
    return " ".join(parts).strip()


def _has_form_ancestor(jsx_element_node, buf: bytes) -> bool:
    """Walk up looking for an enclosing ``<form>`` JSX element."""
    cursor = jsx_element_node.parent
    while cursor is not None:
        if cursor.type == "jsx_element":
            opener = _opening_element(cursor)
            if opener is not None and _jsx_tag_name(opener, buf) == "form":
                return True
        cursor = cursor.parent
    return False


def _inside_map_callback(node, buf: bytes) -> bool:
    """Walk up from ``node`` and report whether an enclosing ``.map()`` call exists.

    ``.map()`` callbacks are the primary context where static
    ``<img src="..."/>`` becomes a bug (every row renders the same
    image). Any ancestor ``call_expression`` with a member-expression
    callee named ``map`` triggers the flag.
    """
    cursor = node.parent
    while cursor is not None:
        if cursor.type == "call_expression":
            callee = cursor.child_by_field_name("function")
            if callee is not None and callee.type == "member_expression":
                prop = callee.child_by_field_name("property")
                if prop is not None:
                    if buf[prop.start_byte : prop.end_byte].decode("utf-8") == "map":
                        return True
        cursor = cursor.parent
    return False
