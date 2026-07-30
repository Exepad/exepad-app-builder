"""BeautifulSoup → JSX emitter.

Walks a parsed HTML tree and writes JSX text into an accumulator. This
is the structural core of the mechanical transformer: every other
module in :mod:`html_to_tsx` provides primitives the walker calls
into (attribute translation, style conversion, text escaping, void
element handling).

Locked to ``html.parser`` per the existing decomposition convention
(:mod:`...decomposition.html_cleaner` line 67) — ``lxml`` and
``html5lib`` rewrite whitespace and entities, breaking byte-faithfulness.

Public entry: :func:`walk` accepts a BeautifulSoup ``Tag`` or
``BeautifulSoup`` instance and returns the JSX body. The transformer
wraps that body in ``<LightDOMContainer>`` + a function declaration.

Comments policy: HTML comments (``<!-- ... -->``) are preserved as JSX
comments (``{/* ... */}``). They don't render but remain useful for
grep/provenance. Conditional comments (``<!--[if IE]> ... <![endif]-->``)
are dropped.

The walker DOES NOT call ``script_extractor`` / ``style_extractor`` —
the transformer entry point runs those *before* invoking the walker so
the tree it walks is already script/style-free.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from bs4 import BeautifulSoup, Comment, NavigableString, Tag
from bs4.element import PreformattedString

from . import wiring
from .attribute_map import translate_attribute
from .style_converter import convert_inline_style
from .text_emitter import emit_text, is_block_element
from .wiring.context import WiringContext

# HTML5 void elements — emit self-closing tags. Per spec these have no
# children; ``<canvas>`` and ``<iframe>`` are NOT void (they may carry
# fallback content), so they emit paired tags even when empty.
_VOID_TAGS: frozenset[str] = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "keygen",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)

# Elements the HTML tokenizer parses in RAWTEXT mode whose payload is
# really *fallback markup*, not literal text. Python's ``html.parser``
# lists them in ``CDATA_CONTENT_ELEMENTS``, so BeautifulSoup hands their
# whole body back as one undivided ``NavigableString``. Left alone the
# walker would run that string through :func:`emit_text` and every ``<``
# would ship as ``{'<'}`` — the fallback markup would render as visible
# angle-bracket soup instead of becoming JSX children.
#
# Deliberately excluded from this set:
# * ``script`` / ``style`` — their bodies genuinely ARE raw text, and
#   the transformer extracts them into sidecars before the walk.
# * ``xmp`` — a deprecated element whose content is literal text by
#   definition (it renders its markup verbatim, like ``<pre>``).
_RAWTEXT_FALLBACK_TAGS: frozenset[str] = frozenset({"iframe", "noembed", "noframes"})

# Safety bound on the re-parse loop below. Nested fallback markup
# (``<iframe><iframe>…``) needs one pass per nesting level; the loop
# terminates on its own because each pass strictly consumes one level,
# but the cap keeps a pathological input from spinning.
_RAWTEXT_REPARSE_MAX_PASSES = 10

# Tags that drop into SVG-attribute mode for their entire subtree.
_SVG_ROOT_TAGS: frozenset[str] = frozenset(
    {"svg", "math"}  # MathML attrs share most rules with SVG; future-proof
)

# Tag names that signal mechanical-transformer can't handle this input
# safely. Web-components (any tag name with a hyphen that isn't a known
# HTML element), MathML extensions, foreignObject. The transformer
# raises confidence to "low" and the workflow falls back to the legacy
# LLM ComponentBuilder path.
_KNOWN_HTML_TAGS_WITH_HYPHEN: frozenset[str] = frozenset(
    {
        # Standard HTML elements that contain a hyphen — none, as of
        # HTML5. Web components are detected by ``"-" in tag_name``.
    }
)


@dataclass
class WalkResult:
    """Outcome of walking an HTML tree to JSX."""

    jsx: str
    """The emitted JSX body."""

    warnings: list[str] = field(default_factory=list)
    """Non-fatal issues encountered (unknown attributes, dropped
    elements, etc.)."""

    low_confidence: bool = False
    """True when the tree contained patterns the mechanical
    transformer can't reliably translate (web-components, foreignObject,
    etc.). The caller should consider falling back to the LLM path."""


def walk(root, *, ctx: WiringContext | None = None) -> WalkResult:
    """Walk a BS4 root (BeautifulSoup or Tag) and emit JSX.

    Args:
        root: BeautifulSoup or Tag instance to serialize. The walker
            does not mutate the tree.
        ctx: Optional :class:`WiringContext`. When provided, the
            Phase-2 wiring rules run during the walk: ``<img>`` →
            ``<ExepadImage>`` and ``<a>`` → ``<Link>`` (slug match).
            When ``None``, an empty context is created and wiring
            rules become no-ops (``<img>`` stays as ``<img>``, etc.).

    Returns:
        :class:`WalkResult` with the emitted JSX and diagnostics.
    """
    if ctx is None:
        ctx = WiringContext()
    state = _WalkState(wiring_ctx=ctx)
    children = _children_of(root)
    body = _emit_children(children, state, in_svg=False, parent_is_block=True)
    state.warnings.extend(ctx.warnings)
    return WalkResult(
        jsx=body,
        warnings=state.warnings,
        low_confidence=state.low_confidence,
    )


# ---------------------------------------------------------------------------
# Internal walk machinery
# ---------------------------------------------------------------------------


@dataclass
class _WalkState:
    """Mutable state carried through the recursive walk."""

    warnings: list[str] = field(default_factory=list)
    low_confidence: bool = False
    wiring_ctx: WiringContext | None = None


def _children_of(node) -> list:
    """Return the iterable of children for either a Tag or a
    BeautifulSoup root.

    BS4 ``BeautifulSoup`` instances are themselves Tag-like and expose
    ``.contents``. A bare ``Tag`` does too. This indirection isolates
    callers from the BS4 typing surface.
    """
    return list(getattr(node, "contents", []) or [])


def _emit_children(
    children: list,
    state: _WalkState,
    *,
    in_svg: bool,
    parent_is_block: bool,
) -> str:
    """Emit a JSX serialization for an ordered list of BS4 child nodes."""
    parts: list[str] = []
    for child in children:
        emitted = _emit_node(child, state, in_svg=in_svg, parent_is_block=parent_is_block)
        if emitted:
            parts.append(emitted)
    return "".join(parts)


def _emit_node(
    node,
    state: _WalkState,
    *,
    in_svg: bool,
    parent_is_block: bool,
) -> str:
    """Dispatch a single BS4 node to its emitter (text / comment / tag)."""
    # Order matters: Comment is a subclass of NavigableString in BS4.
    if isinstance(node, Comment):
        return _emit_comment(node)
    if isinstance(node, NavigableString):
        return emit_text(str(node), in_block_context=parent_is_block)
    if isinstance(node, Tag):
        return _emit_tag(node, state, in_svg=in_svg)
    # Unknown node type — skip.
    return ""


def _emit_comment(comment: Comment) -> str:
    """Translate an HTML comment to a JSX comment.

    Conditional comments (``<!--[if IE]> ... <![endif]-->``) are
    dropped — they're vendor-specific and don't translate.
    """
    text = str(comment).strip()
    if text.startswith("[if") or text.startswith("![endif]"):
        return ""
    # Escape any ``*/`` inside the comment to keep the JSX comment closed
    # at the right place.
    safe = text.replace("*/", "*\\/")
    return f"{{/* {safe} */}}"


def _flag_unsupported_tags(tag: Tag, state: _WalkState) -> None:
    """Set ``state.low_confidence`` + warn for tag patterns the
    mechanical pipeline can't handle reliably.

    Currently flags:
    - Web-component-like tag names (any hyphenated tag name not in
      :data:`_KNOWN_HTML_TAGS_WITH_HYPHEN`).
    - ``<foreignObject>`` inside SVG (carries arbitrary HTML which may
      not translate cleanly).
    """
    name = tag.name or ""
    if "-" in name and name not in _KNOWN_HTML_TAGS_WITH_HYPHEN:
        state.low_confidence = True
        state.warnings.append(f"web-component-like tag <{name}> emitted as custom element")
    if name.lower() == "foreignobject":
        state.low_confidence = True
        state.warnings.append("<foreignObject> encountered — content may not translate cleanly")


def _emit_tag(tag: Tag, state: _WalkState, *, in_svg: bool) -> str:
    """Emit a JSX serialization of a BS4 ``Tag``."""
    name = tag.name
    if not name:
        return ""

    _flag_unsupported_tags(tag, state)

    # Detect SVG context for the subtree.
    entering_svg = in_svg or name.lower() in _SVG_ROOT_TAGS

    # ── Phase-2 wiring: full-replacement substitution ───────────────────
    # Some tags (``<img>``, ``<picture>``) get fully replaced with a
    # different JSX element that emits no children. The walker hands
    # control to the wiring layer; if a replacement string comes back,
    # we use it directly.
    full_sub = (
        wiring.try_substitute_full(tag, state.wiring_ctx) if state.wiring_ctx is not None else None
    )
    if full_sub is not None:
        return full_sub

    # ── Phase-2 wiring: open-tag substitution ──────────────────────────
    # Some tags (``<a>`` → ``<Link>``) keep their children but swap the
    # tag name. The wiring layer returns ``(open_jsx, close_jsx)``.
    open_close = (
        wiring.try_substitute_open_tag(tag, state.wiring_ctx)
        if state.wiring_ctx is not None
        else None
    )
    if open_close is not None:
        children_jsx = _emit_children(
            _children_of(tag),
            state,
            in_svg=entering_svg,
            parent_is_block=is_block_element(name),
        )
        open_jsx, close_jsx = open_close
        return f"{open_jsx}{children_jsx}{close_jsx}"

    attrs_text = _emit_attributes(tag, state, is_svg=entering_svg)

    # ── Phase-2 wiring: attribute enrichment ───────────────────────────
    # Extension point for attribute enrichment; no wiring rule currently
    # appends extra attributes.
    if state.wiring_ctx is not None:
        extra = wiring.extra_attrs(tag, state.wiring_ctx)
        if extra:
            attrs_text = (attrs_text + " " + extra).strip()

    # Void elements emit self-closing tags. BeautifulSoup with html.parser
    # mis-parses ``<br>`` (no slash) by synthesizing a closing tag and
    # absorbing trailing siblings into the element's children. We unwrap
    # those children as siblings of the void element so no content is
    # lost.
    if name.lower() in _VOID_TAGS:
        if attrs_text:
            self_close = f"<{name} {attrs_text} />"
        else:
            self_close = f"<{name} />"
        children = _children_of(tag)
        if not children:
            return self_close
        unwrapped = _emit_children(
            children,
            state,
            in_svg=entering_svg,
            parent_is_block=False,
        )
        return self_close + unwrapped

    # All other tags emit paired open/close even when empty (preserves
    # the source structural shape, e.g. <canvas></canvas>).
    children = _children_of(tag)
    children_jsx = _emit_children(
        children,
        state,
        in_svg=entering_svg,
        parent_is_block=is_block_element(name),
    )

    open_tag = f"<{name} {attrs_text}>" if attrs_text else f"<{name}>"
    return f"{open_tag}{children_jsx}</{name}>"


def _emit_attributes(tag: Tag, state: _WalkState, *, is_svg: bool) -> str:
    """Emit the JSX attribute list for a tag (without leading whitespace)."""
    parts: list[str] = []

    # Determine whether this element has an onChange / onclick handler so
    # value/checked translation can decide controlled vs uncontrolled.
    # The mechanical pipeline doesn't add handlers itself (that's Pass 2
    # for forms, Pass 3 for JS-derived hooks); but if the source HTML
    # already had ``onclick=`` or ``onchange=``, the value rewrite must
    # respect it.
    has_change_handler = any(
        attr_name.lower() in ("onchange", "oninput") for attr_name in (tag.attrs or {}).keys()
    )

    for raw_name, raw_value in (tag.attrs or {}).items():
        # Inline style — handled separately; still respects the
        # ``has_onchange_sibling`` decision pathway implicitly.
        if raw_name.lower() == "style":
            style_text = _stringify_style_value(raw_value)
            if style_text.strip():
                parts.append(convert_inline_style(style_text))
            else:
                parts.append("style={{}}")
            continue

        # Event handler attributes from source HTML (``onclick="..."``,
        # ``onchange="..."``) are NOT translated to JSX onXxx — the
        # mechanical pipeline drops them; Pass 3 (JS→hooks) will add
        # the equivalent React handlers via building_plan items. Drop
        # silently here. ``onchange`` stays read above to control the
        # value/checked decision before drop.
        if raw_name.lower().startswith("on"):
            continue

        translated = translate_attribute(
            raw_name,
            raw_value,
            is_svg=is_svg,
            has_onchange_sibling=has_change_handler,
            parent_tag=tag.name or "",
        )
        if translated is None:
            continue

        if translated.warning:
            state.warnings.append(translated.warning)

        if translated.jsx_value is None:
            # Bare boolean attribute form (currently unused — boolean
            # attrs always emit ``={true}`` for explicitness).
            parts.append(translated.jsx_name)
        else:
            parts.append(f"{translated.jsx_name}={translated.jsx_value}")

    return " ".join(parts)


def _stringify_style_value(value) -> str:
    """Coerce a BS4 style attribute value to a string."""
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(value)
    return str(value)


def parse_html(html: str) -> BeautifulSoup:
    """Parse HTML with the byte-faithful parser config the rest of the
    importer pipeline already uses.

    Always uses ``html.parser`` — ``lxml`` and ``html5lib`` rewrite
    whitespace and entities and would break byte-faithful preservation.

    One post-parse normalization runs here: the RAWTEXT bodies of
    fallback-markup elements (:data:`_RAWTEXT_FALLBACK_TAGS`) are
    re-parsed into real subtrees. See
    :func:`_reparse_rawtext_fallback_markup`. Doing it at parse time —
    rather than inside the walker — means the transformer's
    ``extract_scripts`` / ``extract_styles`` passes, which run between
    ``parse_html`` and ``walk``, still see (and strip) any ``<script>``
    or ``<style>`` hiding inside that fallback markup.
    """
    soup = BeautifulSoup(html, "html.parser")
    _reparse_rawtext_fallback_markup(soup)
    return soup


def _reparse_rawtext_fallback_markup(soup: BeautifulSoup) -> None:
    """Turn RAWTEXT fallback bodies back into real element subtrees.

    ``<iframe src="…"><p>fallback</p></iframe>`` arrives from
    ``html.parser`` as an ``<iframe>`` holding the single string
    ``"<p>fallback</p>"``, because ``iframe`` is one of the stdlib
    parser's ``CDATA_CONTENT_ELEMENTS``. ``iframe`` is not a void
    element and its children are legal markup, so we re-parse that
    string and splice the resulting nodes in as real children — the
    walker then emits them as JSX children, and the wiring layer
    (``<img>`` → ``<ExepadImage>``, ``<a>`` → ``<Link>``) applies to
    them like any other subtree.

    Mutates ``soup`` in place. Idempotent: a second call finds nothing
    left to re-parse.
    """
    for _ in range(_RAWTEXT_REPARSE_MAX_PASSES):
        pending = [
            tag
            # ``sorted`` (not bare ``list``) so the name filter is stable
            # across interpreter runs — the fixture harness asserts the
            # transformer is byte-deterministic.
            for tag in soup.find_all(sorted(_RAWTEXT_FALLBACK_TAGS))
            if any(_is_reparsable_markup_string(child) for child in tag.contents)
        ]
        if not pending:
            return
        for tag in pending:
            _reparse_children_in_place(tag)


def _is_reparsable_markup_string(node) -> bool:
    """True for a plain text node that still carries unparsed markup.

    Comments, CDATA, doctypes and the other ``PreformattedString``
    subclasses are left alone — their ``<`` is not element markup. The
    ``"<"`` gate also keeps genuine text fallbacks
    (``<iframe>Your browser…</iframe>``) on the untouched path, so their
    entities are emitted exactly as they are today.
    """
    if not isinstance(node, NavigableString) or isinstance(node, PreformattedString):
        return False
    return "<" in str(node)


def _reparse_children_in_place(tag: Tag) -> None:
    """Replace ``tag``'s reparsable string children with parsed nodes."""
    new_children: list = []
    for child in list(tag.contents):
        if _is_reparsable_markup_string(child):
            fragment = BeautifulSoup(str(child), "html.parser")
            new_children.extend(list(fragment.contents))
        else:
            new_children.append(child.extract())
    tag.clear()
    for node in new_children:
        tag.append(node)
