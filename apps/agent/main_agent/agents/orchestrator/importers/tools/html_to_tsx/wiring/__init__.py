"""Phase-2 wiring pass.

Each rule is a small pure function (or a small mutator that writes to
``WiringContext``). The walker calls into this package at three
points:

1. **Tag substitution** — ``try_substitute_full(tag, ctx)`` returns a
   complete JSX replacement string when the wiring rule fully
   replaces a tag (``<img>``, ``<picture>`` → ``<ExepadImage>``).
2. **Open-tag substitution** — ``try_substitute_open_tag(tag, ctx)``
   returns a replacement open-tag string when the wiring rule swaps
   the tag name but keeps the children (``<a href>`` → ``<Link>``).
   Returns the new closing tag too so the walker emits matching tags.
3. **Attribute enrichment** — ``extra_attrs(tag, ctx)`` returns extra
   attribute text the walker appends to the default-emitted open tag.

The transformer reads ``ctx.sdk_imports`` and ``ctx.function_preamble``
after the walk to compose the final TSX.
"""

from __future__ import annotations

from bs4.element import Tag

from . import images, links
from .context import WiringContext
from .imports import compose_import_line

__all__ = [
    "WiringContext",
    "compose_import_line",
    "try_substitute_full",
    "try_substitute_open_tag",
    "extra_attrs",
]


def try_substitute_full(tag: Tag, ctx: WiringContext) -> str | None:
    """Return a complete JSX replacement for ``tag``, or ``None``.

    Currently fires for ``<img>`` and ``<picture>`` — both produce a
    self-closing ``<ExepadImage ... />`` so the walker doesn't need
    to emit children.
    """
    name = (tag.name or "").lower()
    if name == "img":
        return images.substitute_img(tag, ctx)
    if name == "picture":
        return images.substitute_picture(tag, ctx)
    return None


def try_substitute_open_tag(tag: Tag, ctx: WiringContext) -> tuple[str, str] | None:
    """Return ``(open_tag_jsx, closing_tag_jsx)`` when the wiring layer
    swaps the tag name but keeps children, or ``None`` to fall through
    to default emission.

    Currently fires for ``<a href="/internal-slug">`` → ``<Link>``.
    """
    name = (tag.name or "").lower()
    if name == "a":
        result = links.substitute_anchor_open_tag(tag, ctx)
        if result is None:
            return None
        # Determine if the rewrite emitted a ``<Link>`` or stayed at
        # ``<a>`` (the external-anchor path) so we can emit the right
        # close tag. The ``Link`` rewrite is the only case the walker
        # needs to handle differently — for ``<a target="_blank">`` the
        # walker's default close tag (``</a>``) is correct, but we
        # also need to suppress its default open-tag emission so we
        # don't double-emit attrs.
        if result.startswith("<Link"):
            return result, "</Link>"
        return result, "</a>"
    return None


def extra_attrs(tag: Tag, ctx: WiringContext) -> str:
    """Return extra attribute text the walker appends to the default
    open-tag emission. Empty string when no enrichment applies.

    No wiring rule currently enriches attributes; retained as the
    walker's extension point.
    """
    return ""
