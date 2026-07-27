"""``component.jsx.fk_id_as_label`` — flag FK ids rendered as labels.

Catches the StayNexus failure mode where the dashboard renders
``#{res.guest_id}`` (a foreign key) inside a ``<TableCell>`` instead of
the human-readable label. The app-backend now auto-expands FKs into
sibling joined rows (``row.guest`` alongside ``row.guest_id``), so the
canonical fix for ``{row.guest_id}`` is ``{row.guest?.full_name}`` —
no manual join needed.

The rule walks every ``jsx_element`` whose opening tag is in a label-y
set: ``TableCell``, ``TableHead``, ``td``, ``th``, ``dt``, ``h1..h6``.
For each, it looks at direct children. If any child expression renders a
member access whose property name ends in ``_id`` AND no sibling child
already renders a ``*_name`` / ``*_label`` / ``*_title`` / ``name`` /
``label`` / ``title`` from the same row, the rule emits a warning
pointing at the FK-id reference.

The dampener is intentionally narrow — sibling presence inside the same
JSX element only. It correctly skips
``<TableCell>{row.guest?.full_name ?? '#' + row.guest_id}</TableCell>``
(displays the joined name with id fallback) but fires on bare
``{row.guest_id}`` inside a label cell.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import find_by_type
from .base import AstContext, Finding


def _text(node, buf: bytes) -> str:
    """Decode a node's byte slice from the source buffer."""
    return buf[node.start_byte : node.end_byte].decode("utf-8")


# Tags whose visible text is a label, not data. Rendering an FK id here
# is almost always a forgotten join.
_LABEL_TAGS: frozenset[str] = frozenset(
    {
        "TableCell",
        "TableHead",
        "td",
        "th",
        "dt",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
    }
)

# Dampener: if a sibling child references one of these property suffixes /
# names from the same row, the FK id is a fallback rather than the
# primary label — skip the warning.
_LABEL_PROPERTY_SUFFIXES = ("_name", "_label", "_title", "_text")
_LABEL_PROPERTY_NAMES = frozenset({"name", "label", "title", "text"})


class FkIdAsLabelRule:
    id = "component.jsx.fk_id_as_label"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf
        for element in find_by_type(ctx.tree.root_node, "jsx_element"):
            opening = element.child_by_field_name("open_tag")
            if opening is None:
                # Older tree-sitter-tsx grammars don't set the field name —
                # fall back to scanning children.
                opening = next(
                    (c for c in element.children if c.type == "jsx_opening_element"),
                    None,
                )
            if opening is None:
                continue
            tag_name = _opening_tag_name(opening, buf)
            if tag_name is None or tag_name not in _LABEL_TAGS:
                continue

            fk_refs = list(_iter_fk_id_member_refs(element, buf))
            if not fk_refs:
                continue
            if _has_sibling_label_ref(element, buf):
                continue

            for member_node, prop_name in fk_refs:
                alias = prop_name[:-3] if prop_name.endswith("_id") else prop_name
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    message=(
                        f"<{tag_name}> renders the foreign-key id "
                        f"`{prop_name}` as its label. `useModel` "
                        f"auto-expands FKs — use the joined object "
                        f"instead: e.g. `row.{alias}?.full_name` "
                        f"(or whatever display column the target model has)."
                    ),
                    line=member_node.start_point[0] + 1,
                    col=member_node.start_point[1],
                    fix_hint=f"replace `{prop_name}` with `{alias}?.<display_field>`",
                )


def _opening_tag_name(opening_node, buf: bytes) -> str | None:
    """Return the tag name of a ``jsx_opening_element`` or
    ``jsx_self_closing_element`` node. Handles both lowercase HTML
    (``td``) and PascalCase component (``TableCell``) cases."""
    for child in opening_node.children:
        if child.type in ("identifier", "nested_identifier"):
            return _text(child, buf)
    return None


def _iter_fk_id_member_refs(element_node, buf: bytes):
    """Yield ``(member_expression_node, property_name)`` for every direct
    child JSX expression whose payload is ``ident.foo_id`` (or deeper).

    "Direct child" here means inside a ``jsx_expression`` that's an
    immediate child of ``element_node`` — not nested inside an inner
    JSX element. We don't traverse into nested elements to keep the
    scope tight (their own FK rendering is checked when the walker
    visits them).
    """
    for child in element_node.children:
        if child.type != "jsx_expression":
            continue
        # The expression body is the inner expression — first non-token child.
        for sub in child.children:
            if sub.type in ("{", "}"):
                continue
            yield from _walk_for_fk_member(sub, buf)


def _walk_for_fk_member(node, buf: bytes):
    """Recursively yield FK-id member expressions inside an expression."""
    if node.type == "member_expression":
        prop = node.child_by_field_name("property")
        if prop is not None and prop.type == "property_identifier":
            name = _text(prop, buf)
            if name and name.endswith("_id"):
                yield (node, name)
    for child in node.children:
        yield from _walk_for_fk_member(child, buf)


def _has_sibling_label_ref(element_node, buf: bytes) -> bool:
    """True if any direct-child JSX expression references a label-y
    property (``*_name``, ``*_label``, ``name``, ``title``, ...)."""
    for child in element_node.children:
        if child.type != "jsx_expression":
            continue
        for sub in child.children:
            if sub.type in ("{", "}"):
                continue
            if _walk_has_label_member(sub, buf):
                return True
    return False


def _walk_has_label_member(node, buf: bytes) -> bool:
    if node.type == "member_expression":
        prop = node.child_by_field_name("property")
        if prop is not None and prop.type == "property_identifier":
            name = _text(prop, buf)
            if name:
                if name in _LABEL_PROPERTY_NAMES:
                    return True
                if any(name.endswith(suffix) for suffix in _LABEL_PROPERTY_SUFFIXES):
                    return True
    for child in node.children:
        if _walk_has_label_member(child, buf):
            return True
    return False
