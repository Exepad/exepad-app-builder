"""``component.image.dynamic_keywords_no_src`` — forbid bare dynamic
``keywords={...}`` on ``<ExepadImage>`` without a ``src=`` attribute.

The bug this catches
--------------------

App ``9vvnqllg`` (chick-farm4017, 2026-05-16): HomeContent "Latest
Products" iterated ``useModel('products')`` and emitted::

    {(products ?? []).map((product) => (
      <ExepadImage
        keywords={`Farm fresh ${product.name} ${product.category}`}
        importance={8}
        className="..."
        width={800} height={600}
      />
    ))}

No ``src``, no ``vendor="catalog"``. The runtime resolver renders the
placeholder skeleton (``ExepadImage.tsx:112-120``) because dynamic
keywords have no deterministic mapping to a deployed asset. Catalog
cards shipped with empty image boxes on the home page.

When the agent emits ``<ExepadImage>`` inside ``.map(...)``, dynamic
``keywords`` can never resolve (the build resolver reads only static
literals; there is no runtime keyword resolution). Two correct shapes,
depending on where the iterated data comes from:

1. **Static data array** (quiz options, feature cards, …) — give each
   item an ``image`` object with literal keywords and spread it; the
   resolver injects ``src`` per item at build time
   (``_resolve_exepad_image_arrays`` matches ``image: { keywords: "..." }``)::

       const OPTIONS = [
         { label: "Zen room", image: { keywords: "minimalist white interior room", importance: 6 } },
         ...
       ];
       {OPTIONS.map((o) => <ExepadImage {...o.image} />)}

2. **Backend-model row** — bind ``src`` to the row's image column, and
   seed that column with a deployed-asset URL (a NULL column renders
   nothing): ``<ExepadImage src={product.image_url} keywords={product.name} ... />``

``vendor="catalog"`` is NOT a fix for dynamic keywords: there is no
runtime catalog fetch (``ExepadImage.tsx`` only renders ``src`` or a
skeleton), so it silences this check but still ships a blank box.

Static ``keywords="..."`` (string literal) is fine; the polish-emitted
hero/section images take that path and the resolver looks up a stable
asset by literal-keyword hash.

Severity
--------

**Error.** The user sees blank boxes where catalog imagery should be —
a load-bearing visual defect.
"""

from __future__ import annotations

from typing import Iterator

from ..walker import (
    iter_jsx_opening_elements,
    jsx_attribute_string_value,
    jsx_attribute_value_node,
    jsx_has_dynamic_attribute,
    jsx_tag_name,
)
from .base import AstContext, Finding

_RULE_ID = "component.image.dynamic_keywords_no_src"


class ExepadImageDynamicKeywordsNoSrcRule:
    """Reject ``<ExepadImage keywords={...} />`` without ``src=`` or
    ``vendor="catalog"`` — the runtime can't resolve dynamic keywords
    to a deployed asset, so the user sees a blank skeleton.
    """

    id = _RULE_ID
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        tree = ctx.tree
        if tree is None:
            return

        buf = ctx.source_buf
        for element in iter_jsx_opening_elements(tree.root_node):
            tag = jsx_tag_name(element, buf)
            if tag != "ExepadImage":
                continue

            # `src=` of any shape (string OR dynamic expression) is the
            # primary escape hatch — assume the agent bound the per-row
            # field.
            if jsx_attribute_value_node(element, "src", buf) is not None:
                continue

            # `vendor="catalog"` lets the resolver hit the catalog API
            # instead of the deployed-asset map; explicit + safe.
            vendor = jsx_attribute_string_value(element, "vendor", buf)
            if vendor and vendor.strip().lower() == "catalog":
                continue

            # Only fire when keywords are dynamic. Static `keywords="..."`
            # resolves through the polish-emitted asset hash and is fine.
            if not jsx_has_dynamic_attribute(element, "keywords", buf):
                continue

            line = element.start_point[0] + 1
            col = element.start_point[1]
            yield Finding(
                rule_id=_RULE_ID,
                severity="error",
                line=line,
                col=col,
                message=(
                    "`<ExepadImage keywords={...} />` has dynamic keywords "
                    "but no `src=`. Dynamic `keywords` cannot be resolved to "
                    "an image: the build-time resolver only reads STATIC "
                    "string-literal keywords, and there is NO runtime keyword "
                    "resolution — so every rendered instance falls back to a "
                    "blank skeleton."
                ),
                fix_hint=(
                    "Pick the shape that matches where the data comes from. "
                    "(1) STATIC data array (e.g. quiz options, feature cards): "
                    'give each item an `image: { keywords: "<5+ literal '
                    'words>", importance: N }` object and spread it — '
                    "`<ExepadImage {...item.image} />` — so the build resolver "
                    "injects `src` per item (see 11_IMAGES.md 'Array / .map() "
                    "Images'). (2) BACKEND-MODEL row: bind `src` to the row's "
                    "image column — `<ExepadImage src={row.image_url} "
                    "keywords={row.name} ... />` — and make sure that column "
                    "is seeded with a deployed-asset URL (a NULL column "
                    'renders nothing). Do NOT use `vendor="catalog"` with '
                    "dynamic keywords: it silences this check but still "
                    "renders a skeleton (no runtime catalog fetch exists)."
                ),
            )
