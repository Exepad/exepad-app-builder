"""``component.nav.raw_internal_anchor`` — in-app navigation must use the SDK
``<Link to="…">``, not a raw ``<a href="/path">``.

The bug this catches
--------------------

A generated app never sits at the origin root: the runtime serves it under a
basePath (``/a/preview-<id>/``, ``/a/<slug>/``) unless it is on its own domain.
A raw ``<a href="/rooms">`` therefore resolves against the ORIGIN, not the app —
so the link points at the studio, not the page.

Live example (Cedar Ridge Lodge MainHeader, 2026-07-25): every header nav item
was ``<a href="/rooms" onClick={() => navigate("/rooms")}>``. Measured in the
browser, each one resolved to ``https://localhost/rooms`` while the app lived at
``/a/preview-a4q2n7oeb/``. Left-click still worked — the onClick routes — which
is exactly why this hides: the failure only shows up on the paths that DON'T go
through onClick. Middle-click / Ctrl- / Cmd-click ("Open in new tab"), "Copy
link address", and any crawler all take the href and land on the wrong app.

The SDK already solves this: ``Link`` (``packages/exepad-sdk/src/components/
Link.tsx``) renders ``<a href={resolveAppPath(to)}>`` and intercepts plain
left-clicks, and its docstring states the contract verbatim — "so crawlers,
modifier clicks (Ctrl/Cmd/middle — 'Open in new tab'), and 'Copy link' all
produce a working absolute URL". The same app's MainFooter used ``<Link to=…>``
and emitted correct basePath-prefixed URLs, so this is a per-component miss, not
a platform gap.

Resolution shape
----------------

Flag a raw ``<a>`` when:

1. ``href`` is a string literal beginning with a single ``/`` (app-internal
   absolute), or
2. ``href`` is a dynamic expression AND the element's ``onClick`` calls
   ``navigate(`` — an unambiguous in-app navigation intent.

Never flagged: external/scheme URLs (``http:``, ``//``, ``mailto:``, ``tel:``),
in-page anchors (``#``), relative paths, ``target="_blank"`` links, and dynamic
hrefs with no navigate handler (not statically knowable).

Severity
--------

Warning. The page still works for ordinary left-clicks, so this must not block a
save; it is a correctness/SEO/accessibility defect, not a crash.
"""

from __future__ import annotations

from typing import Iterator

from tree_sitter import Node

from ..walker import (
    iter_jsx_opening_elements,
    jsx_attribute_string_value,
    jsx_attribute_value_node,
    jsx_tag_name,
)
from .base import AstContext, Finding

_RULE_ID = "component.nav.raw_internal_anchor"

# Schemes / shapes that are NOT app-internal navigation.
_EXTERNAL_PREFIXES: tuple[str, ...] = (
    "//",
    "http://",
    "https://",
    "mailto:",
    "tel:",
    "sms:",
    "data:",
    "blob:",
    "#",
)


def _is_app_internal_path(href: str) -> bool:
    """True for an absolute in-app path like ``/rooms`` (not ``//cdn``, not a
    scheme, not an in-page ``#anchor``, not a relative path)."""
    if not href.startswith("/"):
        return False
    return not href.startswith(_EXTERNAL_PREFIXES)


def _attr_source(element: Node, attr_name: str, buf: bytes) -> str:
    node = jsx_attribute_value_node(element, attr_name, buf)
    if node is None:
        return ""
    return buf[node.start_byte : node.end_byte].decode("utf-8", "replace")


class RawInternalAnchorRule:
    """In-app ``<a href="/x">`` should be the SDK ``<Link to="/x">``."""

    id = _RULE_ID
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        buf = ctx.source_buf
        for element in iter_jsx_opening_elements(ctx.tree.root_node):
            if jsx_tag_name(element, buf) != "a":
                continue
            # An explicit new-tab link is a deliberate full navigation; leave it.
            if (jsx_attribute_string_value(element, "target", buf) or "") == "_blank":
                continue

            href_literal = jsx_attribute_string_value(element, "href", buf)
            if href_literal is not None:
                if not _is_app_internal_path(href_literal):
                    continue
                target = href_literal
            else:
                # Dynamic href — only actionable when the element itself declares
                # in-app navigation intent via navigate(...).
                if jsx_attribute_value_node(element, "href", buf) is None:
                    continue
                if "navigate(" not in _attr_source(element, "onClick", buf):
                    continue
                target = _attr_source(element, "href", buf).strip("{}").strip()

            yield Finding(
                rule_id=_RULE_ID,
                severity="warning",
                line=element.start_point[0] + 1,
                col=element.start_point[1],
                message=(
                    f'<a href="{target}"> is app-internal navigation written as a raw '
                    f"anchor. The app is served under a basePath (e.g. "
                    f"/a/preview-<id>/), so this href resolves against the ORIGIN and "
                    f"points outside the app: middle-click / Cmd-click "
                    f'"Open in new tab", "Copy link address" and crawlers all break '
                    f"(a navigate() onClick only fixes plain left-click). Use the SDK "
                    f"<Link>, which resolves the basePath."
                ),
                fix_hint=(
                    f"replace <a href={{{target}}} …> with <Link to={{{target}}} …> "
                    f"(import Link from '@exepad/sdk/core') and drop the navigate() "
                    f"onClick — Link handles routing itself"
                ),
            )
