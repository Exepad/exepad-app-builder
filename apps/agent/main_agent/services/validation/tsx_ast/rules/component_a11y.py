"""Accessibility and a11y-adjacent component rules.

Three rules:

- ``component.a11y.heading_order`` — heading levels must descend
  sequentially; gaps of 2+ (``h1 → h4``) are errors, single skips are
  warnings, and a non-h1/h2 first heading is also a warning.
- ``component.a11y.button_aria_label`` — icon-only ``<button>`` /
  ``<Button>`` / ``<IconButton>`` / ``<a>`` elements must carry
  ``aria-label``, ``aria-labelledby``, or ``title`` for screen readers
  (or, for links, visible/sr-only text). Anchors that wrap an
  ``<img alt="…">`` or a descendant carrying an aria label are exempt,
  so logo links aren't false-flagged.
- ``component.a11y.dialog_description`` — a ``<DialogContent>`` tree
  must include a ``<DialogDescription>`` (or set ``aria-describedby``
  on the content) per Radix's a11y contract.
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import find_by_type, walk
from .base import AstContext, Finding
from .component_jsx import (
    _iter_jsx_opening_elements,
    _jsx_attribute_string_value,
    _jsx_attribute_value_node,
    _jsx_tag_name,
)


class HeadingOrderRule:
    """Flag non-sequential heading level descents inside JSX."""

    id = "component.a11y.heading_order"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf
        levels: list[tuple[int, object]] = []
        for el in _iter_jsx_opening_elements(ctx.tree.root_node):
            name = _jsx_tag_name(el, buf)
            if len(name) == 2 and name[0] == "h" and name[1].isdigit():
                levels.append((int(name[1]), el))

        if not levels:
            return

        first_level, first_el = levels[0]
        if first_level > 2:
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=(
                    f"Heading order: first heading is h{first_level} — "
                    f"start with h1 (page title) or h2 (section title), "
                    f"not h{first_level}"
                ),
                line=first_el.start_point[0] + 1,
                col=first_el.start_point[1],
            )

        for (prev, _), (curr, curr_el) in zip(levels, levels[1:]):
            gap = curr - (prev + 1)
            if gap <= 0:
                continue
            msg = (
                f"Heading order: jumped from h{prev} to h{curr} "
                f"(skipped h{prev + 1}). Headings must descend sequentially "
                f"— use h{prev + 1} instead of h{curr}."
            )
            severity = "error" if gap >= 2 else "warning"
            yield Finding(
                rule_id=self.id,
                severity=severity,
                message=msg,
                line=curr_el.start_point[0] + 1,
                col=curr_el.start_point[1],
            )


class ButtonAriaLabelRule:
    """Flag icon-only ``<button>`` / ``<Button>`` / ``<IconButton>`` / ``<a>`` tags."""

    id = "component.a11y.button_aria_label"
    severity = "warning"

    _TAG_NAMES = frozenset({"button", "Button", "IconButton", "a"})
    _A11Y_ATTRS = ("aria-label", "aria-labelledby", "title")

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf
        emitted: set[tuple[int, int]] = set()

        for el in _iter_jsx_opening_elements(ctx.tree.root_node):
            name = _jsx_tag_name(el, buf)
            if name not in self._TAG_NAMES:
                continue
            if self._has_accessible_name(el, buf):
                continue

            self_closing = el.type == "jsx_self_closing_element"
            if self_closing:
                key = (el.start_point[0] + 1, el.start_point[1])
                if key in emitted:
                    continue
                emitted.add(key)
                yield Finding(
                    rule_id=self.id,
                    severity="warning",
                    message=self._message(name, self_closing=True),
                    line=el.start_point[0] + 1,
                    col=el.start_point[1],
                )
                continue

            # Opening tag — find the matching ``jsx_element`` wrapper and
            # inspect its visible-text content.
            jsx_element = el.parent
            if jsx_element is None or jsx_element.type != "jsx_element":
                continue
            if self._element_has_visible_text(jsx_element, buf):
                continue
            # An <img alt="…"> child or a descendant with its own aria label
            # supplies an accessible name the link/button can borrow — don't
            # flag e.g. `<a href="/"><img alt="Acme"/></a>` (logo links).
            if _subtree_provides_accessible_name(jsx_element, buf):
                continue
            key = (el.start_point[0] + 1, el.start_point[1])
            if key in emitted:
                continue
            emitted.add(key)
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=self._message(name, self_closing=False),
                line=el.start_point[0] + 1,
                col=el.start_point[1],
            )

    @staticmethod
    def _message(name: str, *, self_closing: bool) -> str:
        if name == "a":
            tag = "<a/>" if self_closing else "<a>"
            return (
                f"Icon-only {tag} link missing accessible name — children "
                f"contain only icons, no visible text. Add `aria-label="
                f'"describe where it goes"`, an sr-only <span>, or a real '
                f"href with text so screen readers can announce the link."
            )
        if self_closing:
            return (
                f"Icon-only <{name}/> missing accessible name — "
                f'add `aria-label="describe the action"` so screen '
                f"readers can announce it."
            )
        return (
            f"Icon-only <{name}> missing accessible name — "
            f"children contain only icons/tags, no visible text. "
            f'Add `aria-label="describe the action"`.'
        )

    def _has_accessible_name(self, opening, buf: bytes) -> bool:
        for attr in self._A11Y_ATTRS:
            if _jsx_attribute_value_node(opening, attr, buf) is not None:
                return True
            # ``aria-label`` can also appear with no value assigned (flag
            # attribute) — accept that as a best-effort pass.
            if _jsx_attribute_string_value(opening, attr, buf) is not None:
                return True
        return False

    @staticmethod
    def _element_has_visible_text(jsx_element, buf: bytes) -> bool:
        """True when the element's body contains any non-whitespace
        ``jsx_text`` OR any ``jsx_expression`` that resolves to
        renderable content (e.g. ``{link.label}``, ``{filter}``,
        ``{loading ? "..." : "Save"}``).

        Only BODY descendants are considered — attribute expressions
        like ``className={x}`` or ``onClick={h}`` are scoped out so a
        handler reference doesn't masquerade as visible text.

        Expressions whose body is only JSX (e.g. ``{showIcon && <Icon/>}``)
        or only comments don't count — those are decorative, so the
        button is still icon-only.
        """
        return _body_yields_visible_text(jsx_element, buf)


def _body_yields_visible_text(jsx_element, buf: bytes) -> bool:
    """Walk only the body children of ``jsx_element`` (skip opening /
    closing / attribute subtrees). Recurses through nested jsx_element
    bodies so deeply-wrapped text counts too."""
    for child in jsx_element.named_children:
        if child.type in ("jsx_opening_element", "jsx_closing_element"):
            continue
        if child.type == "jsx_text":
            text = buf[child.start_byte : child.end_byte].decode("utf-8")
            if text.strip():
                return True
        elif child.type == "jsx_expression":
            if _expression_yields_text(child):
                return True
        elif child.type == "jsx_element":
            if _body_yields_visible_text(child, buf):
                return True
    return False


def _expression_yields_text(jsx_expression_node) -> bool:
    """True when the ``{expr}`` body is something other than pure
    JSX, comments, or whitespace.

    Treated as renderable text: identifiers (``{label}``), member
    expressions (``{link.label}``), ternaries (``{a ? "x" : "y"}``),
    string literals, template strings — anything that would emit a
    text value when React renders it.

    Treated as decorative: ``{<Icon/>}``, ``{showIcon && <Icon/>}``,
    ``{/* comment */}`` — these contribute no accessible name.
    """
    for child in jsx_expression_node.named_children:
        if child.type == "comment":
            continue
        if child.type in (
            "jsx_element",
            "jsx_self_closing_element",
            "jsx_fragment",
        ):
            return False
        if child.type == "binary_expression":
            # ``showIcon && <Icon/>`` — inspect the operands; if any
            # operand is JSX, treat the whole expression as decorative.
            if _binary_yields_text(child):
                return True
            return False
        return True
    return False


def _binary_yields_text(binary_expression_node) -> bool:
    """For ``{a && <Icon/>}`` style guards: every JSX-yielding operand
    is decorative. The whole expression yields text only if NO operand
    is a JSX element."""
    for child in binary_expression_node.named_children:
        if child.type in (
            "jsx_element",
            "jsx_self_closing_element",
            "jsx_fragment",
        ):
            return False
    return True


_NAME_PROVIDING_ATTRS = ("aria-label", "aria-labelledby", "title")


def _subtree_provides_accessible_name(jsx_element, buf: bytes) -> bool:
    """True when a descendant supplies an accessible name the wrapping
    interactive element (``<a>`` / ``<button>``) can borrow:

    - an ``<img>`` / ``<Image>`` with a non-empty ``alt`` (a literal
      ``alt="Acme"`` or a dynamic ``alt={x}``; an explicit ``alt=""``
      is decorative and does NOT count), or
    - any descendant carrying ``aria-label`` / ``aria-labelledby`` /
      ``title``.

    This keeps the common ``<a href="/"><img alt="Acme"/></a>`` logo-link
    pattern from being flagged as icon-only. The wrapper's own opening
    element is harmlessly included — by the time this runs it's already
    known to carry none of these attributes.
    """
    for el in _iter_jsx_opening_elements(jsx_element):
        for attr in _NAME_PROVIDING_ATTRS:
            if _jsx_attribute_value_node(el, attr, buf) is not None:
                return True
        tag = _jsx_tag_name(el, buf)
        base = tag.rsplit(".", 1)[-1] if "." in tag else tag
        if base in ("img", "Image"):
            if _jsx_attribute_value_node(el, "alt", buf) is not None:
                alt_str = _jsx_attribute_string_value(el, "alt", buf)
                # alt_str is None for a dynamic `alt={x}` (assume it names
                # the image); non-empty for a literal that isn't `alt=""`.
                if alt_str is None or alt_str.strip():
                    return True
    return False


class DialogDescriptionRule:
    """Flag ``<DialogContent>`` without ``<DialogDescription>`` / aria-describedby."""

    id = "component.a11y.dialog_description"
    severity = "warning"

    _MESSAGE = (
        "DialogContent is missing a DialogDescription. Radix requires either "
        "a <DialogDescription> child or aria-describedby prop for accessibility"
    )

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf
        reported = False
        for el in _iter_jsx_opening_elements(ctx.tree.root_node):
            if reported:
                return
            if _jsx_tag_name(el, buf) != "DialogContent":
                continue
            if _jsx_attribute_value_node(el, "aria-describedby", buf) is not None:
                continue
            # Walk the rest of the tree — DialogDescription doesn't have to
            # be a child of this particular <DialogContent> to satisfy the
            # a11y contract; some layouts share a single description node.
            if _tree_has_tag(ctx.tree.root_node, "DialogDescription", buf):
                continue
            reported = True
            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=self._MESSAGE,
                line=el.start_point[0] + 1,
                col=el.start_point[1],
            )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _tree_has_tag(root, tag_name: str, buf: bytes) -> bool:
    """Does any JSX opening / self-closing element in ``root`` use ``tag_name``?"""
    for el in _iter_jsx_opening_elements(root):
        if _jsx_tag_name(el, buf) == tag_name:
            return True
    # Also look for closing elements (``</DialogDescription>`` without a
    # matching opening child); tree-sitter still emits the tag name node.
    for el in find_by_type(root, "jsx_closing_element"):
        name_node = el.child_by_field_name("name")
        if name_node is None and el.named_child_count:
            name_node = el.named_children[0]
        if name_node is None:
            continue
        if buf[name_node.start_byte : name_node.end_byte].decode("utf-8") == tag_name:
            return True
    return False
