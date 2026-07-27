"""Hero-image contrast rule.

Flags hero sections where light-text headings sit on top of an image
background without sufficient darkening to keep the text readable.

Pattern detected:

- A ``<section>`` (or ``<div>`` / ``<header>``) that is positioned
  ``relative`` AND contains both:
  - An image element (``<ExepadImage>`` or ``<img>``) sized with
    ``object-cover`` (or absolutely positioned to fill the parent).
  - A heading (``h1``..``h6``) carrying a light-text token —
    ``text-white``, ``text-on-primary``, ``text-inverse-on-surface``.

Acceptable when AT LEAST ONE of the following darkening techniques is
applied:

1. The image className includes a strong filter — ``brightness-[0.X]``
   with X<=0.6, ``grayscale-*``, or ``opacity-[0.X]`` with X<0.7.
2. A sibling overlay div fills the section with a strong dark layer:
   ``bg-black/N`` with N>=50, ``bg-primary/N`` with N>=60, or any
   ``bg-gradient-*`` token.

Either alone counts. Fire warning only when BOTH are absent or below
threshold.

Regression source: in app ``6z5k25jk``, ReservationsContent rendered the
white H2 "Secure Your Table" over a busy bar/lounge stock image with
only a ``bg-black/40`` overlay — the title was practically invisible
because the underlying image had bright bottle/bar reflections that the
40 % overlay couldn't dim enough. HomeContent's hero used both a
``brightness-[0.4]`` image filter and a ``bg-black/50`` overlay, which
worked. This rule encodes the working pattern.
"""

from __future__ import annotations

import re
from typing import Iterator

from ..walker import find_by_type
from .base import AstContext, Finding
from .component_jsx import (
    _iter_jsx_opening_elements,
    _jsx_attribute_string_value,
    _jsx_tag_name,
)


_LIGHT_TEXT_TOKENS = frozenset(
    {
        "text-white",
        "text-on-primary",
        "text-on-secondary",
        "text-on-tertiary",
        "text-inverse-on-surface",
        "text-inverse-primary",
    }
)

_IMAGE_TAG_NAMES = frozenset({"ExepadImage", "img"})

# brightness-[0.X] / brightness-[0]  — strong dim is X <= 6 (i.e., 0.0–0.6).
_BRIGHTNESS_FILTER_RE = re.compile(r"brightness-\[0?\.([0-6])\b|brightness-\[0\]")
# grayscale-[N] / grayscale  — any grayscale token counts.
_GRAYSCALE_FILTER_RE = re.compile(r"\bgrayscale(?:-\[[^\]]+\])?\b")
# opacity-[0.X]  — X<7 dims enough.
_OPACITY_FILTER_RE = re.compile(r"opacity-\[0?\.([0-6])\b")
# bg-black/N where N>=50.
_BLACK_OVERLAY_RE = re.compile(r"bg-black/(\d{2,3})\b")
# bg-primary/N where N>=60.
_PRIMARY_OVERLAY_RE = re.compile(r"bg-primary/(\d{2,3})\b")
# bg-gradient-* — assume dark gradient.
_GRADIENT_OVERLAY_RE = re.compile(r"\bbg-gradient-(?:to-[a-z]+|radial)\b")


class HeroImageContrastRule:
    """Warn when a light-text heading hero image lacks sufficient darkening."""

    id = "component.layout.hero_image_contrast"
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf

        for section in find_by_type(ctx.tree.root_node, "jsx_element"):
            opener = _opening_element_of(section)
            if opener is None:
                continue
            tag = _jsx_tag_name(opener, buf)
            # Only inspect typical container tags; bail otherwise.
            if tag not in ("section", "div", "header", "main", "article"):
                continue
            classes = _jsx_attribute_string_value(opener, "className", buf) or ""
            if "relative" not in classes.split():
                continue

            # Must contain at least one image-shaped descendant.
            image_el = _find_descendant_image(section, buf)
            if image_el is None:
                continue
            image_classes = (
                _jsx_attribute_string_value(image_el, "className", buf) or ""
            )
            if not _looks_like_full_cover_image(image_classes):
                continue

            # Must contain at least one heading whose className references a
            # light-text token. If no such heading exists, this isn't a
            # light-text hero pattern and the rule doesn't apply.
            heading_el = _find_light_text_heading(section, buf)
            if heading_el is None:
                continue

            # Either darkening technique satisfies the rule.
            if _has_strong_image_filter(image_classes):
                continue
            if _has_strong_overlay(section, buf):
                continue

            yield Finding(
                rule_id=self.id,
                severity="warning",
                message=(
                    "Hero with light-text heading on an image background — "
                    "white text on a busy image is unreadable without strong "
                    "darkening. Apply ONE of: (1) `brightness-[0.4]` (or "
                    "`grayscale-[0.5]`) on the ExepadImage className, or "
                    "(2) a sibling overlay `<div className=\"absolute "
                    "inset-0 bg-black/50\"/>`. The current overlay (if any) "
                    "is too weak (<50%) to mask underlying highlights."
                ),
                line=opener.start_point[0] + 1,
                col=opener.start_point[1],
            )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _opening_element_of(jsx_element):
    for c in jsx_element.children:
        if c.type == "jsx_opening_element":
            return c
    return None


def _find_descendant_image(section, buf: bytes):
    for el in _iter_jsx_opening_elements(section):
        name = _jsx_tag_name(el, buf)
        if name in _IMAGE_TAG_NAMES:
            return el
    return None


def _find_light_text_heading(section, buf: bytes):
    for el in _iter_jsx_opening_elements(section):
        name = _jsx_tag_name(el, buf)
        if not (len(name) == 2 and name[0] == "h" and name[1].isdigit()):
            continue
        classes = _jsx_attribute_string_value(el, "className", buf) or ""
        tokens = set(classes.split())
        # Strip Tailwind responsive / state prefixes — `md:text-white` still
        # counts as light-text on the breakpoints where the hero shows.
        for tok in classes.split():
            base = tok.split(":")[-1]
            if base in _LIGHT_TEXT_TOKENS:
                return el
        if tokens & _LIGHT_TEXT_TOKENS:
            return el
    return None


def _looks_like_full_cover_image(class_str: str) -> bool:
    """Heuristic: image acts as the section background.

    Either fills via ``object-cover`` + sized class, or is absolutely
    positioned (``absolute inset-0`` etc.). Rules out small inline images
    (icons, decorative thumbnails) that sit alongside text but aren't the
    background.
    """
    tokens = set(class_str.split())
    if "object-cover" in tokens:
        return True
    if "absolute" in tokens and ("inset-0" in tokens or "inset-x-0" in tokens):
        return True
    return False


def _has_strong_image_filter(class_str: str) -> bool:
    """True iff the image className applies enough darkening to read white text."""
    if _GRAYSCALE_FILTER_RE.search(class_str):
        return True
    if _BRIGHTNESS_FILTER_RE.search(class_str):
        return True
    m = _OPACITY_FILTER_RE.search(class_str)
    if m and int(m.group(1)) <= 6:
        return True
    return False


def _has_strong_overlay(section, buf: bytes) -> bool:
    """True iff the section contains a sibling overlay strong enough to dim a
    busy image: ``bg-black/N`` with N>=50, ``bg-primary/N`` with N>=60, or
    any ``bg-gradient-*`` token. Ignores image-element classNames (the
    overlay must be a separate div).
    """
    for el in _iter_jsx_opening_elements(section):
        name = _jsx_tag_name(el, buf)
        if name in _IMAGE_TAG_NAMES:
            continue
        classes = _jsx_attribute_string_value(el, "className", buf) or ""
        m = _BLACK_OVERLAY_RE.search(classes)
        if m and int(m.group(1)) >= 50:
            return True
        m = _PRIMARY_OVERLAY_RE.search(classes)
        if m and int(m.group(1)) >= 60:
            return True
        if _GRADIENT_OVERLAY_RE.search(classes):
            return True
    return False
