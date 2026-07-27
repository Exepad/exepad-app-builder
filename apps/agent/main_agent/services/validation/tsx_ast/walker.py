"""Generic tree-sitter walk helpers.

These are the small reusable utilities every rule needs: "find every call
expression matching X", "walk to the first ancestor of type Y", "extract
string literal value". They are intentionally stateless — rules wire them
together, not the other way around.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterator

from tree_sitter import Node

from .catalog import M3_BG_TOKENS


def walk(node: Node) -> Iterator[Node]:
    """Depth-first pre-order walk of every node in the subtree."""
    yield node
    for child in node.children:
        yield from walk(child)


def find_by_type(root: Node, node_type: str) -> Iterator[Node]:
    """Yield every descendant (and ``root`` itself) whose ``.type`` matches."""
    for n in walk(root):
        if n.type == node_type:
            yield n


def find_calls(root: Node) -> Iterator[Node]:
    """Yield every ``call_expression`` node in the subtree."""
    return find_by_type(root, "call_expression")


def find_member_expressions(root: Node) -> Iterator[Node]:
    """Yield every ``member_expression`` node in the subtree."""
    return find_by_type(root, "member_expression")


def iter_local_function_declarations(root: Node, buf: bytes) -> Iterator[tuple[str, Node]]:
    """Yield ``(name, declaration_node)`` for every locally declared function.

    Recognises:
      * ``function Name(...) { ... }``                  (``function_declaration``)
      * ``const Name = (...) => ...``                   (arrow ``variable_declarator``)
      * ``const Name = function(...) { ... }``          (function-expr ``variable_declarator``)

    The yielded ``declaration_node`` is the full declaration subtree, so
    callers can walk it (e.g. with :func:`subtree_calls_identifier`) to
    inspect the function body.
    """
    for node in walk(root):
        if node.type == "function_declaration":
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                yield (buf[name_node.start_byte : name_node.end_byte].decode("utf-8"), node)
        elif node.type == "variable_declarator":
            name_node = node.child_by_field_name("name")
            value_node = node.child_by_field_name("value")
            if (
                name_node is not None
                and name_node.type == "identifier"
                and value_node is not None
                and value_node.type in ("arrow_function", "function_expression")
            ):
                yield (buf[name_node.start_byte : name_node.end_byte].decode("utf-8"), node)


def subtree_calls_identifier(node: Node, callee_name: str, buf: bytes) -> bool:
    """True when the subtree contains a call ``callee_name(...)``.

    Only bare-identifier callees match (``submit(...)``), not member calls
    (``form.submit(...)``) — the callee node must be an ``identifier`` whose
    text equals ``callee_name``. ``await submit(...)`` matches because the
    ``await_expression`` wraps the same ``call_expression``.
    """
    for call in find_calls(node):
        fn = call.child_by_field_name("function")
        if fn is not None and fn.type == "identifier":
            if buf[fn.start_byte : fn.end_byte].decode("utf-8") == callee_name:
                return True
    return False


def member_chain(node: Node, source_buf: bytes) -> str:
    """Return the dotted chain for a ``member_expression``.

    ``ctx.db.prepare`` is a nested ``member_expression`` — this helper returns
    the flat dotted form ``"ctx.db.prepare"`` for easy pattern matching in
    rule code. Returns an empty string for non-member-expression nodes.
    """
    if node.type != "member_expression":
        return ""
    return source_buf[node.start_byte : node.end_byte].decode("utf-8")


def string_literal_value(node: Node, source_buf: bytes) -> str | None:
    """Extract the string contents of a ``string`` node.

    Tree-sitter's TSX grammar wraps the quoted text with ``string_fragment``
    children. A plain ``string`` node's value is the concatenation of those
    fragments. Escape sequences are returned as-is (no JS unescape), which
    is fine for SQL keyword extraction — SQL doesn't care about \\n vs \\\\n
    for table-name matching. Returns ``None`` for non-string nodes.
    """
    if node.type != "string":
        return None
    parts: list[str] = []
    for child in node.children:
        if child.type == "string_fragment":
            parts.append(source_buf[child.start_byte : child.end_byte].decode("utf-8"))
    return "".join(parts)


def template_string_static_value(node: Node, source_buf: bytes) -> str | None:
    """Return the static text of a ``template_string`` node with no substitutions.

    If the template contains any ``template_substitution`` (i.e. ``${...}``),
    the value is not statically known and we return ``None``. Otherwise we
    concatenate the raw text inside the backticks.
    """
    if node.type != "template_string":
        return None
    for child in node.children:
        if child.type == "template_substitution":
            return None
    # Strip the surrounding backticks from the raw text.
    raw = source_buf[node.start_byte : node.end_byte].decode("utf-8")
    if raw.startswith("`") and raw.endswith("`"):
        return raw[1:-1]
    return raw


def has_template_substitution(node: Node) -> bool:
    """True iff a ``template_string`` node contains any ``${...}`` interpolation."""
    if node.type != "template_string":
        return False
    return any(c.type == "template_substitution" for c in node.children)


# ---------------------------------------------------------------------------
# JSX helpers — shared across component rules and fixers.
# ---------------------------------------------------------------------------


def iter_jsx_opening_elements(root: Node) -> Iterator[Node]:
    """Yield both opening (``<Foo>``) and self-closing (``<Foo/>``) elements
    in **source order** (depth-first, by ``start_byte``).

    The legacy implementation yielded all opening elements first then all
    self-closing elements, which broke source order whenever a self-closing
    element with a static className was nested inside an opening one and a
    sibling outer element with a className came after. ``rewrite_classname_text``
    consumed those spans left-to-right and produced corrupt splices —
    exactly the ze1ltmf9-class JSX corruption regression-corpus fixture 10
    used to pin. Single source-order walk eliminates the failure mode.
    """
    for node in walk(root):
        if node.type in ("jsx_opening_element", "jsx_self_closing_element"):
            yield node


def jsx_tag_name(element: Node, buf: bytes) -> str:
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


def iter_jsx_attributes(element: Node) -> Iterator[Node]:
    for child in element.children:
        if child.type == "jsx_attribute":
            yield child


def jsx_attribute_value_node(element: Node, attr_name: str, buf: bytes) -> Node | None:
    """Return the value node of ``attr_name`` on this element, or ``None``.

    Tree-sitter-typescript's ``jsx_attribute`` has two named children: a
    ``property_identifier`` (the name) and an optional value node which is
    either a ``string`` literal or a ``jsx_expression`` container. Field
    names are NOT populated on these children in the shipped grammar, so
    we iterate ``named_children`` by position instead of calling
    ``child_by_field_name``.
    """
    for attr in iter_jsx_attributes(element):
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


def jsx_attribute_string_value(element: Node, attr_name: str, buf: bytes) -> str | None:
    """Return the literal string value of ``attr_name``, or ``None``."""
    value = jsx_attribute_value_node(element, attr_name, buf)
    if value is None or value.type != "string":
        return None
    return string_literal_value(value, buf)


def jsx_has_dynamic_attribute(element: Node, attr_name: str, buf: bytes) -> bool:
    """True when ``attr_name`` exists on the element with a ``{expr}`` value."""
    value = jsx_attribute_value_node(element, attr_name, buf)
    return value is not None and value.type == "jsx_expression"


# ---------------------------------------------------------------------------
# JSX bg-context walker (M3 contrast pairing)
# ---------------------------------------------------------------------------
#
# Builds an ``ancestor bg token`` chain for every JSX element so M3 color
# pairing rules (dark-bg + light-text, inverse-surface, …) can resolve the
# nearest enclosing known background without a raw-source regex scan.
#
# The walker is strictly AST-driven:
#
#   - Walk every ``jsx_opening_element`` / ``jsx_self_closing_element``.
#   - Resolve the element's own bg token by reading its ``className`` /
#     ``style`` attributes (see ``_extract_bg_token_from_element``).
#   - Resolve the ancestor bg token by climbing ``node.parent`` up through
#     ``jsx_element`` wrappers and querying their opening element.
#   - The walker is silent (``None`` ancestor) for scopes where the
#     nearest enclosing known ancestor cannot be resolved (e.g. CSS-var
#     sidebars, unknown tokens).
#
# Low-opacity bg tints (``bg-primary/10`` etc. below 60) are treated as
# decorative: they do NOT establish an effective background for children,
# because the rendered color depends on the layer beneath them.


_INLINE_BG_VAR_RE = re.compile(
    r"backgroundColor\s*:\s*['\"]var\(--color-([a-zA-Z0-9_-]+)",
)


@dataclass
class JsxBgScope:
    """One JSX element plus its resolved bg context.

    Attributes
    ----------
    class_str:
        Static className text with ``${...}`` expressions stripped.
        Empty string when the element has no className attribute.
    start_byte:
        Byte offset of the element's opening ``<``. Use for splicing.
    start_point:
        ``(line, col)`` tuple, both 0-based row + column (same as
        tree-sitter's ``start_point``). Rules add 1 to ``line`` when
        emitting a ``Finding`` (1-based line numbers).
    own_bg_token:
        M3 bg token declared on THIS element (e.g. ``primary``,
        ``surface``, ``inverse-surface``), or ``None`` when the element
        has no known bg.
    ancestor_bg_token:
        Nearest enclosing bg token from a parent element's ``className``
        or inline ``style``. ``None`` when no ancestor carries a known
        bg.
    effective_bg_token:
        ``own_bg_token or ancestor_bg_token`` — the token that
        determines what color the text actually renders on.
    class_inner_span:
        ``(start_byte, end_byte)`` byte span of the className value's
        INNER text (excluding surrounding quotes / backticks), or
        ``None`` when the value is opaque (a function call, identifier
        without static fallback, or template with ``${...}``
        substitutions). Splice into this span to mutate only className
        text without disturbing JSX structure. Replaces the hand-rolled
        ``_find_tag_end`` parser the m3_colors fixer used to use.
    """

    class_str: str
    start_byte: int
    start_point: tuple[int, int]
    own_bg_token: str | None
    ancestor_bg_token: str | None
    effective_bg_token: str | None
    class_inner_span: tuple[int, int] | None = None


def _classname_static_value(element: Node, buf: bytes) -> str | None:
    """Return the static className text of ``element`` or ``None``.

    Handles:
    - ``className="..."`` → the literal string.
    - ``className={"expr"}`` / ``className={`tmpl`}`` → extract the
      embedded string/template. Template substitutions (``${...}``) are
      stripped, matching the legacy regex behaviour.
    - ``className={identifier}`` / anything else → ``None`` (opaque).
    """
    value = jsx_attribute_value_node(element, "className", buf)
    if value is None:
        return None
    if value.type == "string":
        return string_literal_value(value, buf)
    if value.type == "jsx_expression":
        # Inner expression lives as the first named child.
        inner: Node | None = None
        for c in value.named_children:
            if c.type != "comment":
                inner = c
                break
        if inner is None:
            return None
        if inner.type == "string":
            return string_literal_value(inner, buf)
        if inner.type == "template_string":
            raw = buf[inner.start_byte : inner.end_byte].decode("utf-8")
            if raw.startswith("`") and raw.endswith("`"):
                raw = raw[1:-1]
            # Strip ${...} interpolations — match legacy regex behaviour.
            return re.sub(r"\$\{[^}]*\}", " ", raw)
    return None


def _classname_value_inner_span(element: Node, buf: bytes) -> tuple[int, int] | None:
    """Return ``(start_byte, end_byte)`` for the static className value's
    inner text region of a JSX element, or ``None`` if the className is
    absent or not statically resolvable.

    The span EXCLUDES surrounding quotes/braces/backticks so callers can
    splice into TSX without disturbing JSX syntax. Concretely:

    - ``className="foo"`` → bytes between the two ``"``
    - ``className={"foo"}`` → bytes between the two ``"``
    - ``className={`foo`}`` → bytes between the two backticks
    - ``className={fn()}`` / opaque → ``None``

    Used by mutating fixers that want to ``re.sub`` only inside className
    text, leaving SVG strings, comments, code, and JSX prose untouched.
    """
    value = jsx_attribute_value_node(element, "className", buf)
    if value is None:
        return None
    if value.type == "string":
        # Strip 1 byte off each end for the surrounding quotes.
        return (value.start_byte + 1, value.end_byte - 1)
    if value.type == "jsx_expression":
        inner: Node | None = None
        for c in value.named_children:
            if c.type != "comment":
                inner = c
                break
        if inner is None:
            return None
        if inner.type == "string":
            return (inner.start_byte + 1, inner.end_byte - 1)
        if inner.type == "template_string":
            # Skip if the template carries ``${...}`` substitutions: a
            # blind sub against the inner span would also rewrite text
            # inside the substitution braces. Restrict to fully-static
            # templates.
            for child in inner.children:
                if child.type == "template_substitution":
                    return None
            return (inner.start_byte + 1, inner.end_byte - 1)
    return None


def collect_static_classnames(tsx: str) -> list[str]:
    """Return every static className text found in ``tsx``.

    Walks the tree-sitter AST and pulls className from every JSX opening
    and self-closing element. Skips opaque dynamic forms
    (``className={fn()}``, identifiers without a static fallback).
    Strips ``${...}`` template substitutions, matching legacy regex
    behaviour.

    Detection-tier validators (``style_coverage``, semantic warnings) use
    this to scan classNames only — never raw TSX text — so SVG kebab
    attributes inside ``dangerouslySetInnerHTML``, comments, or string
    literals never trigger false positives.

    Returns one entry per JSX element with a static className. Callers
    that want a single haystack can ``" ".join(result)``. Returns an
    empty list on parse failure or when no static classNames exist.
    """
    from .parser import parse_tsx

    try:
        tree = parse_tsx(tsx)
    except Exception:
        return []
    buf = tsx.encode("utf-8")
    classnames: list[str] = []
    for element in iter_jsx_opening_elements(tree.root_node):
        text = _classname_static_value(element, buf)
        if text is not None:
            classnames.append(text)
    return classnames


def iter_classname_value_spans(tsx: str) -> list[tuple[int, int]]:
    """Return ``(start_byte, end_byte)`` for every static className inner span.

    Each span covers the bytes between the className's surrounding
    quotes / backticks — inclusive of the inner text, exclusive of the
    delimiters themselves. Spans are returned in **source order** (sorted
    by ``start_byte``) and never overlap — this is a hard contract that
    ``rewrite_classname_text`` consumes. Defensive sort here means any
    future ordering regression in ``iter_jsx_opening_elements`` cannot
    silently corrupt JSX through this code path.

    Mutating fixers (M3 opacity strip / clamp, low-contrast rewrite) use
    these spans to apply ``re.sub`` only inside className text, leaving
    SVG strings, comments, code, and JSX prose untouched.

    Returns an empty list on parse failure or when no static classNames
    exist.
    """
    from .parser import parse_tsx

    try:
        tree = parse_tsx(tsx)
    except Exception:
        return []
    buf = tsx.encode("utf-8")
    spans: list[tuple[int, int]] = []
    for element in iter_jsx_opening_elements(tree.root_node):
        span = _classname_value_inner_span(element, buf)
        if span is not None:
            spans.append(span)
    spans.sort(key=lambda s: s[0])
    return spans


def rewrite_classname_text(tsx: str, rewriter) -> str:
    """Apply ``rewriter`` to the inner text of every static className span.

    ``rewriter`` is a callable ``(class_text: str) -> str`` that receives
    the bytes-decoded inner text of one className value (no quotes /
    backticks) and returns the rewritten replacement. The function takes
    care of byte-offset splicing so callers don't have to convert byte
    offsets to character offsets manually.

    Use this for mutating fixers — opacity rewrites, contrast rewrites,
    token replacements — when you want the fix scoped to className text
    only. Non-className regions of the source pass through verbatim.
    """
    spans = iter_classname_value_spans(tsx)
    if not spans:
        return tsx
    buf = tsx.encode("utf-8")
    out_parts: list[bytes] = []
    last = 0
    for start, end in spans:
        out_parts.append(buf[last:start])
        original = buf[start:end].decode("utf-8")
        out_parts.append(rewriter(original).encode("utf-8"))
        last = end
    out_parts.append(buf[last:])
    return b"".join(out_parts).decode("utf-8")


def _extract_bg_token_from_element(element: Node, buf: bytes) -> str | None:
    """Return the bg token declared on ``element`` (className then style).

    Scan rules (matches the legacy regex helper byte-for-byte):
    1. className tokens of form ``bg-<token>`` or ``bg-<token>/<opacity>``.
    2. Opacities < 60 are decorative tints — skipped.
    3. Later tokens win (Tailwind cascade).
    4. Only tokens listed in :data:`M3_BG_TOKENS` count — unknown bg-*
       classes return ``None``.
    5. If className has no recognized bg, fall back to
       ``style={{ backgroundColor: 'var(--color-X)' }}`` — token = ``X``.
    """
    class_str = _classname_static_value(element, buf)
    last_token: str | None = None
    if class_str is not None:
        for cls in class_str.split():
            if not cls.startswith("bg-"):
                continue
            token_part, _, opacity_part = cls.partition("/")
            if opacity_part and opacity_part.isdigit() and int(opacity_part) < 60:
                continue  # decorative tint
            token_name = token_part.removeprefix("bg-")
            if token_name in M3_BG_TOKENS:
                last_token = token_name
        if last_token is not None:
            return last_token

    # style={{ backgroundColor: 'var(--color-X)' }} — sidebar skill pattern.
    style_value = jsx_attribute_value_node(element, "style", buf)
    if style_value is not None:
        raw = buf[style_value.start_byte : style_value.end_byte].decode("utf-8")
        m = _INLINE_BG_VAR_RE.search(raw)
        if m is not None:
            return m.group(1)

    return None


def _ancestor_bg_token(element: Node, buf: bytes) -> str | None:
    """Walk ``element.parent`` upward and return the nearest known bg token.

    Tree-sitter-TSX wraps content-bearing JSX in a ``jsx_element`` whose
    first child is the ``jsx_opening_element``. Self-closing tags have no
    wrapper — they cannot contain children, so they cannot be ancestors.
    Fragments (``jsx_fragment``) are transparent. Any other ancestor
    (``jsx_expression``, callbacks, etc.) is transparent as well; we
    only read bg tokens from the opening elements we encounter.

    Identity note: tree-sitter returns fresh Node wrappers on every
    access, so we compare nodes by ``start_byte`` instead of ``is``.
    """
    parent = element.parent
    while parent is not None:
        if parent.type == "jsx_element":
            # First child is the opening element.
            opener: Node | None = None
            for c in parent.children:
                if c.type == "jsx_opening_element":
                    opener = c
                    break
            if opener is not None and opener.start_byte != element.start_byte:
                token = _extract_bg_token_from_element(opener, buf)
                if token is not None:
                    return token
        parent = parent.parent
    return None


def iter_jsx_elements_with_bg_context(root: Node, buf: bytes) -> Iterator[JsxBgScope]:
    """Yield one :class:`JsxBgScope` per JSX element with a static className.

    Elements with no className attribute, or with a fully dynamic
    ``className={variable}``, are skipped — the legacy regex walker
    emitted one scope per captured ``className="..."`` / ``className={`...`}``
    literal, and this AST walker preserves that contract.
    """
    for element in iter_jsx_opening_elements(root):
        class_str = _classname_static_value(element, buf)
        if class_str is None:
            continue
        own_bg_token = _extract_bg_token_from_element(element, buf)
        ancestor_bg_token = _ancestor_bg_token(element, buf)
        yield JsxBgScope(
            class_str=class_str,
            start_byte=element.start_byte,
            start_point=element.start_point,
            own_bg_token=own_bg_token,
            ancestor_bg_token=ancestor_bg_token,
            effective_bg_token=own_bg_token or ancestor_bg_token,
            class_inner_span=_classname_value_inner_span(element, buf),
        )
