"""``<img>`` and ``<picture>`` → ``<ExepadImage>`` substitution.

Every imported ``<img>`` becomes ``<ExepadImage>`` so the
post-component-build image resolver
(``app_types/webapp/services/codefocus_image_resolver.py``) can
populate the ``src`` URL — either by preserving the imported asset
(via ``data-asset-relpath``) or by fetching a stock photo (via
``keywords``).

Substitution rules:

* ``alt`` → ``keywords`` prop (5+ word search query). When ``alt`` is
  empty or the single word ``image``, fall back to a generic
  ``"placeholder image"`` keyword set with a warning.
* ``data-asset-relpath`` is preserved verbatim — the resolver reads it
  to emit the ``__ASSET_IMG:`` placeholder during deploy.
* ``width`` / ``height`` are read from attributes; numeric values
  emit as ``{N}`` JSX expressions, non-numeric values stay as strings.
* ``importance`` is hardcoded to ``5`` — it no longer routes providers
  (the resolver tries each configured free provider in turn); Phase 5
  (plan-builder) may later upgrade specific images via plan items.
* ``className`` is preserved.
* ``loading="lazy"``, ``decoding`` etc. are dropped — ExepadImage
  controls these.
* ``<picture><source/><img/></picture>`` collapses to a single
  ``<ExepadImage>`` based on the inner ``<img>``. The ``<source>``
  variants are dropped with a warning.
"""

from __future__ import annotations

from bs4.element import Tag

from .context import WiringContext

_DEFAULT_IMPORTANCE = 5
_GENERIC_KEYWORDS = "placeholder image"


def substitute_img(tag: Tag, ctx: WiringContext) -> str | None:
    """Return the ``<ExepadImage ... />`` JSX for an ``<img>`` tag.

    Returns ``None`` when the tag isn't an ``<img>`` or when the
    walker should fall through to default emission (currently never —
    every ``<img>`` becomes ``<ExepadImage>``).
    """
    if (tag.name or "").lower() != "img":
        return None

    # Prefer the richer `data-alt` caption (Stitch fixtures put a descriptive
    # phrase here, e.g. "Portrait of a friendly middle-aged farmer in a straw
    # hat"), falling back to `alt` (often just the name, e.g. "Farmer John").
    # Matches the precedent at design_importer.py:148.
    alt = (tag.get("data-alt") or tag.get("alt") or "").strip()
    relpath = (tag.get("data-asset-relpath") or "").strip()
    classes = _stringify_classes(tag.get("class"))
    width_text = _format_number_or_string(tag.get("width"))
    height_text = _format_number_or_string(tag.get("height"))

    keywords = alt or _GENERIC_KEYWORDS
    if not alt:
        ctx.warnings.append("image had no alt text — using generic 'placeholder image' keywords")

    parts: list[str] = [
        f'keywords="{_escape_attr(keywords)}"',
        f"importance={{{_DEFAULT_IMPORTANCE}}}",
    ]
    if width_text:
        parts.append(f"width={width_text}")
    if height_text:
        parts.append(f"height={height_text}")
    if relpath:
        # Emit the canonical `__ASSET_IMG:` placeholder + `vendor="design_import"`
        # directly. This is the form documented in agent docs
        # (`11_IMAGES.md:87-97`) and what the LLM cleanup phase expects to
        # see as a "pinned design asset, preserve byte-for-byte." The
        # codefocus_image_resolver still keeps a `data-asset-relpath`
        # short-circuit path for any in-flight bundle that was translated
        # before this change, but new translations bypass the rewrite step
        # entirely — the resolver's `_needs_resolution` returns False for
        # `__ASSET_IMG:` placeholders (treats as already-resolved) and the
        # deploy pipeline expands them to repo URLs at publish time.
        # Previously: emitted `data-asset-relpath="..."` data attribute,
        # which the LLM stripped as unknown → stock refetch (RC#4).
        parts.append(f'src="__ASSET_IMG:assets/{_escape_attr(relpath)}__"')
        parts.append('vendor="design_import"')
    if classes:
        parts.append(f'className="{_escape_attr(classes)}"')

    ctx.sdk_imports.add("ExepadImage")
    return "<ExepadImage " + " ".join(parts) + " />"


def substitute_picture(tag: Tag, ctx: WiringContext) -> str | None:
    """Collapse ``<picture><source/>...<img/></picture>`` to a single
    ``<ExepadImage>``.

    Returns ``None`` when the tag isn't ``<picture>`` or when no inner
    ``<img>`` is present (rare but possible — leave as-is then).
    """
    if (tag.name or "").lower() != "picture":
        return None

    inner_img = tag.find("img")
    if inner_img is None:
        return None

    ctx.warnings.append(
        "<picture> collapsed to inner <img> as <ExepadImage> — " "<source> variants discarded"
    )
    return substitute_img(inner_img, ctx)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _stringify_classes(value) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(value)
    return str(value)


def _format_number_or_string(value) -> str:
    """Return a JSX attribute value text for a width/height-style attr.

    Numeric values emit as ``{N}`` JSX expressions; non-numeric values
    (e.g. ``"100%"``) emit as quoted strings. Empty value returns an
    empty string so the caller skips the attribute.
    """
    if value is None:
        return ""
    text = str(value).strip()
    if not text:
        return ""
    try:
        # Integer or float — emit as JSX expression
        n = int(text) if text.isdigit() else float(text)
        return f"{{{n}}}"
    except ValueError:
        return f'"{_escape_attr(text)}"'


def _escape_attr(value: str) -> str:
    """Escape a string for use inside a double-quoted JSX attribute."""
    return value.replace('"', "&quot;")
