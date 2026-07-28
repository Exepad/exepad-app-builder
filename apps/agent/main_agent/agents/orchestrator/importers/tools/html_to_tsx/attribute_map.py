"""HTML attribute → JSX prop translation table.

The transformer applies these rules to every attribute on every element
during the BeautifulSoup walk. Three categories:

1. **Renames** — HTML attribute name differs from the JSX prop name.
   ``class`` → ``className``, ``for`` → ``htmlFor``, ``tabindex`` →
   ``tabIndex``, etc.

2. **Passthrough** — attribute kept as-is. ``data-*``, ``aria-*``,
   ``role``, ``href``, ``id``, ``alt``, ``title``, etc.

3. **Boolean** — HTML boolean attributes (``disabled``, ``required``,
   ``checked``, ``selected``, ``readonly``, ``hidden``, ``autofocus``,
   ``novalidate``, ``multiple``, ``open``, ``controls``, ``loop``,
   ``muted``, ``autoplay``, ``default``, ``defer``, ``async``,
   ``ismap``, ``nomodule``, ``reversed``, ``itemscope``,
   ``allowfullscreen``, ``inert``). When present without value, emit
   as ``attr={true}``. With explicit value, follow rename + value rules.

SVG attributes get extra special-casing because many are kebab in HTML
but camel in JSX (`stroke-width` → `strokeWidth`), while some are
already camel and pass through (``viewBox``, ``baseFrequency``,
``stitchTiles``).

Edge cases handled here:

- ``value``/``checked`` on form inputs are rewritten to
  ``defaultValue``/``defaultChecked`` UNLESS the source has an
  ``onChange`` (in which case the value is keep-as-is and React will
  treat it as controlled). Caller signals this via the
  ``has_onchange_sibling`` flag on :func:`translate_attribute`.

- ``style="..."`` is NOT translated here. The walker calls into
  :mod:`style_converter` for that.

- Unknown attributes (typos, truly custom) pass through with their
  original name. The transformer logs a warning but doesn't fail —
  React will silently drop unknown DOM props at runtime.
"""

from __future__ import annotations

from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Static rename tables. Keys are lowercase HTML attribute names exactly as
# BeautifulSoup yields them (BS4 lowercases attribute names by default in
# ``html.parser`` mode). Values are the JSX prop names.
# ---------------------------------------------------------------------------

# Common HTML attributes that need renaming for JSX.
_HTML_RENAMES: dict[str, str] = {
    "class": "className",
    "for": "htmlFor",
    "tabindex": "tabIndex",
    "colspan": "colSpan",
    "rowspan": "rowSpan",
    "maxlength": "maxLength",
    "minlength": "minLength",
    "readonly": "readOnly",
    "spellcheck": "spellCheck",
    "contenteditable": "contentEditable",
    "crossorigin": "crossOrigin",
    "datetime": "dateTime",
    "enterkeyhint": "enterKeyHint",
    "inputmode": "inputMode",
    "accesskey": "accessKey",
    "autocapitalize": "autoCapitalize",
    "autocomplete": "autoComplete",
    "autocorrect": "autoCorrect",
    "autofocus": "autoFocus",
    "autoplay": "autoPlay",
    "autosave": "autoSave",
    "allowfullscreen": "allowFullScreen",
    "frameborder": "frameBorder",
    "marginheight": "marginHeight",
    "marginwidth": "marginWidth",
    "novalidate": "noValidate",
    "nowrap": "noWrap",
    "playsinline": "playsInline",
    "radiogroup": "radioGroup",
    "referrerpolicy": "referrerPolicy",
    "srcdoc": "srcDoc",
    "srclang": "srcLang",
    "srcset": "srcSet",
    "usemap": "useMap",
    "imagesrcset": "imageSrcSet",
    "imagesizes": "imageSizes",
    "formaction": "formAction",
    "formenctype": "formEncType",
    "formmethod": "formMethod",
    "formnovalidate": "formNoValidate",
    "formtarget": "formTarget",
    "enctype": "encType",
    "acceptcharset": "acceptCharset",
    "httpequiv": "httpEquiv",
    "itemprop": "itemProp",
    "itemref": "itemRef",
    "itemscope": "itemScope",
    "itemtype": "itemType",
    "itemid": "itemID",
    "keyparams": "keyParams",
    "keytype": "keyType",
    "mediagroup": "mediaGroup",
    "hreflang": "hrefLang",
}

# SVG attributes. Many are kebab in HTML but camel in JSX. Some are
# already camel in the spec and pass through. The list below covers
# every SVG attribute that requires renaming for JSX 16+. Attributes
# already camel in the SVG spec (viewBox, baseFrequency, etc.) are
# emitted by BS4 in lowercase form (``viewbox``) — we re-camelize them
# here.
_SVG_RENAMES: dict[str, str] = {
    # Already-camel SVG attributes that BS4 lowercases — restore camel.
    "viewbox": "viewBox",
    "preserveaspectratio": "preserveAspectRatio",
    "basefrequency": "baseFrequency",
    "stitchtiles": "stitchTiles",
    "numoctaves": "numOctaves",
    "kernelmatrix": "kernelMatrix",
    "kernelunitlength": "kernelUnitLength",
    "edgemode": "edgeMode",
    "tablevalues": "tableValues",
    "specularconstant": "specularConstant",
    "specularexponent": "specularExponent",
    "limitingconeangle": "limitingConeAngle",
    "diffuseconstant": "diffuseConstant",
    "surfacescale": "surfaceScale",
    "pointsatx": "pointsAtX",
    "pointsaty": "pointsAtY",
    "pointsatz": "pointsAtZ",
    "patternunits": "patternUnits",
    "patterncontentunits": "patternContentUnits",
    "patterntransform": "patternTransform",
    "filterunits": "filterUnits",
    "primitiveunits": "primitiveUnits",
    "gradientunits": "gradientUnits",
    "gradienttransform": "gradientTransform",
    "spreadmethod": "spreadMethod",
    "maskunits": "maskUnits",
    "maskcontentunits": "maskContentUnits",
    "markerunits": "markerUnits",
    "markerheight": "markerHeight",
    "markerwidth": "markerWidth",
    "markerstart": "markerStart",
    "markermid": "markerMid",
    "markerend": "markerEnd",
    "clippath": "clipPath",
    "clippathunits": "clipPathUnits",
    "lengthadjust": "lengthAdjust",
    "textlength": "textLength",
    "startoffset": "startOffset",
    "pathlength": "pathLength",
    # Kebab → camel SVG presentation attributes.
    "stroke-width": "strokeWidth",
    "stroke-linecap": "strokeLinecap",
    "stroke-linejoin": "strokeLinejoin",
    "stroke-miterlimit": "strokeMiterlimit",
    "stroke-dasharray": "strokeDasharray",
    "stroke-dashoffset": "strokeDashoffset",
    "stroke-opacity": "strokeOpacity",
    "fill-opacity": "fillOpacity",
    "fill-rule": "fillRule",
    "stop-color": "stopColor",
    "stop-opacity": "stopOpacity",
    "flood-color": "floodColor",
    "flood-opacity": "floodOpacity",
    "lighting-color": "lightingColor",
    "color-interpolation": "colorInterpolation",
    "color-interpolation-filters": "colorInterpolationFilters",
    "color-profile": "colorProfile",
    "color-rendering": "colorRendering",
    "image-rendering": "imageRendering",
    "shape-rendering": "shapeRendering",
    "text-rendering": "textRendering",
    "font-family": "fontFamily",
    "font-size": "fontSize",
    "font-size-adjust": "fontSizeAdjust",
    "font-stretch": "fontStretch",
    "font-style": "fontStyle",
    "font-variant": "fontVariant",
    "font-weight": "fontWeight",
    "letter-spacing": "letterSpacing",
    "word-spacing": "wordSpacing",
    "alignment-baseline": "alignmentBaseline",
    "baseline-shift": "baselineShift",
    "dominant-baseline": "dominantBaseline",
    "text-anchor": "textAnchor",
    "text-decoration": "textDecoration",
    "writing-mode": "writingMode",
    "vector-effect": "vectorEffect",
    "pointer-events": "pointerEvents",
    "marker-start": "markerStart",
    "marker-mid": "markerMid",
    "marker-end": "markerEnd",
    "clip-path": "clipPath",
    "clip-rule": "clipRule",
    "enable-background": "enableBackground",
    "glyph-orientation-horizontal": "glyphOrientationHorizontal",
    "glyph-orientation-vertical": "glyphOrientationVertical",
    "horiz-adv-x": "horizAdvX",
    "horiz-origin-x": "horizOriginX",
    "overline-position": "overlinePosition",
    "overline-thickness": "overlineThickness",
    "panose-1": "panose1",
    "rendering-intent": "renderingIntent",
    "strikethrough-position": "strikethroughPosition",
    "strikethrough-thickness": "strikethroughThickness",
    "underline-position": "underlinePosition",
    "underline-thickness": "underlineThickness",
    "unicode-bidi": "unicodeBidi",
    "unicode-range": "unicodeRange",
    "units-per-em": "unitsPerEm",
    "v-alphabetic": "vAlphabetic",
    "v-hanging": "vHanging",
    "v-ideographic": "vIdeographic",
    "v-mathematical": "vMathematical",
    "vert-adv-y": "vertAdvY",
    "vert-origin-x": "vertOriginX",
    "vert-origin-y": "vertOriginY",
    "x-height": "xHeight",
    # xlink: prefix — kept as-is per modern SVG; React deprecates xlinkHref
    # but accepts it for back-compat. Translate the colon form.
    "xlink:href": "xlinkHref",
    "xlink:role": "xlinkRole",
    "xlink:show": "xlinkShow",
    "xlink:title": "xlinkTitle",
    "xlink:type": "xlinkType",
    "xlink:arcrole": "xlinkArcrole",
    "xml:base": "xmlBase",
    "xml:lang": "xmlLang",
    "xml:space": "xmlSpace",
}

# HTML5 boolean attributes. When BS4 yields these with empty-string value
# or with the attribute name as the value (older HTML4 style), we emit
# ``attr={true}``. With an explicit non-empty value, the standard rename +
# string-value path applies.
_BOOLEAN_ATTRS: frozenset[str] = frozenset(
    {
        "disabled",
        "required",
        "checked",
        "selected",
        "readonly",
        "hidden",
        "autofocus",
        "novalidate",
        "multiple",
        "open",
        "controls",
        "loop",
        "muted",
        "autoplay",
        "default",
        "defer",
        "async",
        "ismap",
        "nomodule",
        "reversed",
        "itemscope",
        "allowfullscreen",
        "inert",
        "formnovalidate",
        "playsinline",
    }
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class TranslatedAttribute:
    """Single attribute translation result.

    Attributes:
        jsx_name: The JSX prop name to emit.
        jsx_value: Already-formatted JSX value text (e.g. ``"foo"``,
            ``{true}``, ``{42}``). The walker concatenates this verbatim
            after ``{jsx_name}=``. ``None`` means emit the prop bare
            (no ``=value``); used for HTML5 boolean attributes when the
            walker prefers the bare form, currently always the
            ``{true}`` form is used for explicitness.
        warning: Optional warning message the walker can collect (e.g.
            ``"unknown attribute 'foo' passed through"``).
    """

    jsx_name: str
    jsx_value: str | None
    warning: str | None = None


# Form-control tags whose ``value`` / ``checked`` attributes carry
# controlled-component semantics in React. ``<option value="a">`` is
# NOT in this set — option ``value`` is the option's identifier, not a
# controlled state. Same for ``<button value=...>`` (button identity in
# form submission).
_CONTROLLED_INPUT_TAGS: frozenset[str] = frozenset({"input", "select", "textarea"})


def translate_attribute(
    name: str,
    value: str | list[str] | None,
    *,
    is_svg: bool = False,
    has_onchange_sibling: bool = False,
    parent_tag: str = "",
) -> TranslatedAttribute | None:
    """Translate a single HTML attribute to its JSX form.

    Args:
        name: HTML attribute name as BS4 yields it (lowercase for HTML
            elements; preserved-case for embedded XML/SVG when the
            parser keeps it — but ``html.parser`` lowercases everything,
            so callers can assume lowercase).
        value: Attribute value. BS4 yields ``str`` for normal attributes,
            ``list[str]`` for the ``class`` attribute (and the rare
            multi-value attribute), or ``None`` for valueless boolean
            attributes (``<input disabled>``).
        is_svg: True when the element is part of an SVG subtree. Enables
            the SVG rename table.
        has_onchange_sibling: True when the element ALSO has an
            ``onchange`` attribute. Suppresses the ``value`` →
            ``defaultValue`` rewrite (the input is meant to be
            controlled).
        parent_tag: Lowercase tag name of the element this attribute
            belongs to. Required for the value/checked controlled-input
            decision: ``<option value=...>`` is identifier, not state,
            so the rewrite skips ``<option>``.

    Returns:
        Translated attribute, or ``None`` to drop the attribute (e.g.
        ``style`` is handled separately by :mod:`style_converter`).
    """
    name_lower = name.lower()
    parent_lower = parent_tag.lower()

    # Style handled outside this module.
    if name_lower == "style":
        return None

    # Class attribute — BS4 returns a list; join with spaces.
    if name_lower == "class":
        if isinstance(value, list):
            joined = " ".join(value)
        else:
            joined = value or ""
        return TranslatedAttribute(jsx_name="className", jsx_value=_quote_string(joined))

    # value/checked → defaultValue/defaultChecked for uncontrolled inputs.
    # Runs BEFORE the boolean path so ``<input checked>`` becomes
    # ``defaultChecked={true}`` rather than ``checked={true}``. Only
    # applies to controlled-input tags (input/select/textarea) — option's
    # ``value`` is identifier, not state.
    if (
        name_lower == "value"
        and parent_lower in _CONTROLLED_INPUT_TAGS
        and not has_onchange_sibling
    ):
        return TranslatedAttribute(
            jsx_name="defaultValue",
            jsx_value=_quote_string(_stringify(value)),
        )
    if (
        name_lower == "checked"
        and parent_lower in _CONTROLLED_INPUT_TAGS
        and not has_onchange_sibling
    ):
        return TranslatedAttribute(jsx_name="defaultChecked", jsx_value="{true}")

    # Boolean attributes when value is missing or matches the attr name.
    if name_lower in _BOOLEAN_ATTRS:
        if value is None or value == "" or _is_boolean_self_value(name_lower, value):
            jsx_name = _HTML_RENAMES.get(name_lower, name_lower)
            return TranslatedAttribute(jsx_name=jsx_name, jsx_value="{true}")
        # Boolean attr with an explicit non-empty value falls through to
        # the standard rename + string path.

    # SVG renames take precedence inside SVG subtrees.
    if is_svg and name_lower in _SVG_RENAMES:
        return TranslatedAttribute(
            jsx_name=_SVG_RENAMES[name_lower],
            jsx_value=_quote_string(_stringify(value)),
        )

    # Standard HTML renames.
    if name_lower in _HTML_RENAMES:
        return TranslatedAttribute(
            jsx_name=_HTML_RENAMES[name_lower],
            jsx_value=_quote_string(_stringify(value)),
        )

    # data-* and aria-* pass through verbatim.
    if name_lower.startswith("data-") or name_lower.startswith("aria-"):
        return TranslatedAttribute(
            jsx_name=name,  # preserve original casing the source authored
            jsx_value=_quote_string(_stringify(value)),
        )

    # role, lang, dir, id, src, href, alt, title, name, type, target, rel,
    # accept, action, method, placeholder, etc. — already JSX-compatible.
    # Pass through unchanged.
    return TranslatedAttribute(
        jsx_name=name_lower,
        jsx_value=_quote_string(_stringify(value)),
    )


def is_boolean_attribute(name: str) -> bool:
    """Return True when ``name`` is an HTML5 boolean attribute."""
    return name.lower() in _BOOLEAN_ATTRS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _stringify(value: str | list[str] | None) -> str:
    """Coerce a BS4 attribute value to a string."""
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(value)
    return value


def _is_boolean_self_value(name: str, value: str | list[str]) -> bool:
    """Return True for HTML4-style ``<option selected="selected">`` form."""
    if isinstance(value, list):
        return False
    return value.strip().lower() == name


def _quote_string(value: str) -> str:
    """Format a string value as a JSX attribute literal: ``"value"``.

    Escapes embedded double quotes by switching to single quotes when
    the value contains ``"`` but not ``'``. When the value contains
    both, escape the double quotes with ``&quot;`` (JSX attribute string
    rules permit the entity reference).
    """
    has_dq = '"' in value
    has_sq = "'" in value
    if has_dq and not has_sq:
        return f"'{value}'"
    if has_dq and has_sq:
        return '"' + value.replace('"', "&quot;") + '"'
    return f'"{value}"'
