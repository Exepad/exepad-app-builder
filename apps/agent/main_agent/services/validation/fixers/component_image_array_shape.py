"""Auto-fixer that normalizes data-array image shapes to the canonical form.

The image resolver's array-aware regex
(``_ARRAY_EXEPAD_IMAGE_OBJ_PATTERN`` in ``codefocus_image_resolver.py``)
matches keywords only when nested under an image-shaped parent key
(``image|before|after|photo|thumbnail|cover|avatar|src``). When the LLM
emits a data array with bare top-level ``keywords:`` and consumes it via
``<ExepadImage keywords={item.keywords}/>``, the resolver misses every
element and the gallery / list page renders empty placeholders.

This fixer rewrites those bare arrays into the canonical nested shape
documented in
``packages/schemas/data/agent_docs/frontend/component_builder/docs/11_IMAGES.md``::

    // before (resolver misses)
    const ITEMS = [{ id: "1", keywords: "italian pasta", caption: "…" }];
    {ITEMS.map(item => <ExepadImage keywords={item.keywords} importance={6} … />)}

    // after (resolver matches)
    const ITEMS = [{ id: "1", image: { keywords: "italian pasta", importance: 5 }, caption: "…" }];
    {ITEMS.map(item => <ExepadImage {...item.image} … />)}

Detection requires both signals (bare-keywords array + ExepadImage
consumer over that array) so we never rewrite arrays whose ``keywords``
field belongs to an unrelated domain (search filters, SEO meta).
"""

from __future__ import annotations

from tree_sitter import Node

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import (
    find_by_type,
    iter_jsx_attributes,
    iter_jsx_opening_elements,
    jsx_tag_name,
)


_DEFAULT_IMPORTANCE = 5

# Image-like field names whose string value should be wrapped into a
# nested ``{ keywords, importance }`` object. Mirrors the
# ``codefocus_image_resolver``'s nesting-key allow-list so the resolver
# can match the rewritten shape.
_STRING_IMAGE_FIELD_NAMES = frozenset({
    "image",
    "avatar",
    "logo",
    "photo",
    "thumbnail",
    "picture",
    "headshot",
    "cover",
})


def apply_component_image_array_shape_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Wrap bare top-level ``keywords:`` array elements under ``image: {…}``.

    Fires only when:
    1. The file uses ``<ExepadImage>`` (otherwise nothing to resolve).
    2. There is at least one ``const NAME = [{…}]`` array literal whose
       elements carry bare top-level ``keywords:`` string-literals AND no
       ``image:`` field.
    3. There is a consumer ``<ExepadImage keywords={P.keywords} … />``
       inside a ``.map((P) => …)`` (or filter/sort chain) rooted on
       ``NAME`` — confirming this array feeds an ExepadImage.

    Returns the rewritten TSX. No-op when the file already follows the
    canonical shape, or when the bare-keywords array isn't consumed by
    any ExepadImage.
    """
    if "<ExepadImage" not in tsx:
        return tsx

    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx

    buf = source_bytes(tsx)

    # Phase 1: discover candidate arrays. The canonical-bare-keywords path
    # and the string-shape path are checked independently — either signal
    # alone is enough to keep processing the file.
    candidates = _find_bare_keyword_arrays(tree.root_node, buf)
    string_candidates = _find_string_image_field_arrays(tree.root_node, buf)
    if not candidates and not string_candidates:
        return tsx

    # Phase 2: confirm there's an <ExepadImage keywords={p.keywords}/> consumer
    # inside ANY .map() callback in the file. The consumer doesn't have to map
    # directly over the candidate array — useMemo/filter/sort intermediates are
    # common (filteredItems = useMemo(() => ITEMS.filter(...)) then
    # filteredItems.map(...)). Tracing the dataflow back to the source array
    # would need full scope analysis; instead, the bare-keywords-array shape
    # plus the keyword-prop ExepadImage consumer is a strong-enough joint
    # signal that the rewrite is safe — even if we mis-pair them in a
    # multi-array file, normalising shape doesn't break runtime.
    consumed_names = _find_arrays_consumed_by_exepad_image(tree.root_node, buf)
    has_keyword_consumer = _has_any_keyword_consumer(tree.root_node, buf)

    # Phase 3: collect edits — canonical-bare-keywords path. May yield zero
    # edits when only the string-shape variant (Phase B below) applies.
    array_edits: list[tuple[int, int, str]] = []
    jsx_edits: list[tuple[int, int, str]] = []
    array_elements_rewritten = 0
    jsx_consumers_rewritten = 0

    if candidates and (consumed_names or has_keyword_consumer):
        confirmed = [c for c in candidates if c.array_name in consumed_names]
        # Lenient fallback: rewrite ALL bare-keywords candidates when at
        # least one keyword consumer exists somewhere in the file but doesn't
        # map directly over a candidate (filter / useMemo intermediates).
        use_lenient = has_keyword_consumer and not confirmed
        if use_lenient:
            confirmed = candidates
        if confirmed:
            for cand in confirmed:
                for element in cand.elements_with_bare_keywords:
                    edit = _rewrite_array_element_keywords(element, buf)
                    if edit is not None:
                        array_edits.append(edit)
                        array_elements_rewritten += 1

            j_edits, j_count = _rewrite_jsx_consumers(
                tree.root_node,
                buf,
                target_arrays={c.array_name for c in confirmed},
                lenient=use_lenient,
            )
            jsx_edits.extend(j_edits)
            jsx_consumers_rewritten += j_count

    # Phase B: string-shape variant. Some arrays use a flat
    # ``{image: "string"}`` (or ``{logo: "..."}``, ``{avatar: "..."}``)
    # shape that the canonical detector abandons because ``image:`` is
    # present. The resolver still misses these because the value is a
    # string instead of the canonical ``{keywords, importance}`` object.
    # Wrap them into the canonical shape and switch consumers to
    # ``<ExepadImage {...p.image}/>`` (or the matching field).
    string_elements_rewritten = 0
    string_consumers_rewritten = 0
    for cand in string_candidates:
        if not _has_string_image_consumer(tree.root_node, buf, cand.field_name):
            continue
        for el in cand.string_image_elements:
            edit = _rewrite_string_image_element_pair(el, cand.field_name, buf)
            if edit is not None:
                array_edits.append(edit)
                string_elements_rewritten += 1
        s_jsx_edits, s_count = _rewrite_string_image_jsx_consumers(
            tree.root_node,
            buf,
            field_name=cand.field_name,
            target_arrays={cand.array_name},
            lenient=True,
        )
        jsx_edits.extend(s_jsx_edits)
        string_consumers_rewritten += s_count

    edits = array_edits + jsx_edits
    if not edits:
        return tsx

    # Apply right-to-left so earlier byte offsets stay valid.
    edits.sort(key=lambda e: e[0], reverse=True)
    out = buf
    for start, end, replacement in edits:
        out = out[:start] + replacement.encode("utf-8") + out[end:]

    if array_elements_rewritten:
        fixes_applied.append(
            f"Wrapped bare top-level keywords in image: {{ keywords, importance }} "
            f"for {array_elements_rewritten} array element(s)"
        )
    if jsx_consumers_rewritten:
        fixes_applied.append(
            f"Rewrote {jsx_consumers_rewritten} <ExepadImage> consumer(s) to "
            f"spread {{...item.image}}"
        )
    if string_elements_rewritten:
        fixes_applied.append(
            f"Wrapped {string_elements_rewritten} string-shape image field(s) into "
            "nested { keywords, importance }"
        )
    if string_consumers_rewritten:
        fixes_applied.append(
            f"Rewrote {string_consumers_rewritten} <ExepadImage> string-shape "
            "consumer(s) to spread {...item.<field>}"
        )

    return out.decode("utf-8")


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


class _ArrayCandidate:
    """One ``const NAME = [{…}]`` array candidate for shape rewriting."""

    __slots__ = ("array_name", "elements_with_bare_keywords")

    def __init__(self, array_name: str, elements: list[Node]) -> None:
        self.array_name = array_name
        self.elements_with_bare_keywords = elements


def _find_bare_keyword_arrays(root: Node, buf: bytes) -> list[_ArrayCandidate]:
    """Find ``const NAME = [{…}]`` arrays where most elements carry bare keywords.

    A candidate must satisfy:
    - The variable's value is an ``array`` node.
    - At least 50% of element objects have a top-level ``keywords:`` string-literal pair.
    - No element object has a top-level ``image:`` pair (otherwise the
      array is already in canonical shape, partially or fully).
    """
    out: list[_ArrayCandidate] = []
    for declarator in find_by_type(root, "variable_declarator"):
        name_node = declarator.child_by_field_name("name")
        value_node = declarator.child_by_field_name("value")
        if name_node is None or value_node is None:
            continue
        if name_node.type != "identifier":
            continue
        if value_node.type != "array":
            continue
        array_name = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")

        elements_with_bare_keywords: list[Node] = []
        any_image_field = False
        total_object_elements = 0
        for child in value_node.named_children:
            if child.type != "object":
                continue
            total_object_elements += 1
            has_keywords_string = False
            has_image = False
            for pair in child.named_children:
                if pair.type != "pair":
                    continue
                key = pair.child_by_field_name("key")
                if key is None:
                    continue
                key_name = buf[key.start_byte : key.end_byte].decode("utf-8")
                if key_name == "image":
                    has_image = True
                    break
                if key_name == "keywords":
                    val = pair.child_by_field_name("value")
                    if val is not None and val.type == "string":
                        has_keywords_string = True
            if has_image:
                any_image_field = True
                break
            if has_keywords_string:
                elements_with_bare_keywords.append(child)

        if any_image_field:
            continue
        if total_object_elements < 1:
            continue
        if len(elements_with_bare_keywords) * 2 < total_object_elements:
            continue  # less than 50% bare-keywords coverage

        out.append(_ArrayCandidate(array_name, elements_with_bare_keywords))
    return out


def _find_arrays_consumed_by_exepad_image(root: Node, buf: bytes) -> set[str]:
    """Return identifier names of arrays whose .map() callback contains an <ExepadImage>.

    Walks every ``call_expression`` whose function is ``X.map`` (member
    expression) and whose argument is an arrow function. If the arrow
    body contains a ``<ExepadImage>`` JSX element AND the receiver
    chain's ROOT identifier is an in-scope array name, record that name.

    The receiver chain handling is intentionally lenient — supports both
    direct ``ITEMS.map(...)`` and chained ``ITEMS.filter(...).map(...)``
    so derived arrays still get matched to their source.
    """
    out: set[str] = set()
    for call in find_by_type(root, "call_expression"):
        func = call.child_by_field_name("function")
        args = call.child_by_field_name("arguments")
        if func is None or args is None:
            continue
        if func.type != "member_expression":
            continue
        prop = func.child_by_field_name("property")
        if prop is None or buf[prop.start_byte : prop.end_byte].decode("utf-8") != "map":
            continue

        # The arrow body must contain an <ExepadImage>.
        if not _arrow_contains_exepad_image(args, buf):
            continue

        # Resolve the root identifier of the receiver chain.
        root_name = _root_identifier_of_chain(func.child_by_field_name("object"), buf)
        if root_name is not None:
            out.add(root_name)
    return out


def _arrow_contains_exepad_image(arguments_node: Node, buf: bytes) -> bool:
    """True iff the .map() callback contains a JSX ``<ExepadImage>`` element."""
    for arg in arguments_node.named_children:
        if arg.type != "arrow_function":
            continue
        body = arg.child_by_field_name("body")
        if body is None:
            continue
        for el in iter_jsx_opening_elements(body):
            if jsx_tag_name(el, buf) == "ExepadImage":
                return True
    return False


def _has_any_keyword_consumer(root: Node, buf: bytes) -> bool:
    """True iff the file has any ``<ExepadImage keywords={p.keywords}/>``
    inside a ``.map((p) => …)`` callback.

    This is the joint signal that authorises the lenient rewrite path —
    when an array has bare top-level ``keywords:`` AND such a consumer
    exists somewhere, we normalise even when the .map receiver isn't a
    direct identifier reference to the source array (filter/useMemo
    intermediates).
    """
    for call in find_by_type(root, "call_expression"):
        func = call.child_by_field_name("function")
        args = call.child_by_field_name("arguments")
        if func is None or args is None or func.type != "member_expression":
            continue
        prop = func.child_by_field_name("property")
        if prop is None or buf[prop.start_byte : prop.end_byte].decode("utf-8") != "map":
            continue
        for arg in args.named_children:
            if arg.type != "arrow_function":
                continue
            param_name = _arrow_first_param_name(arg, buf)
            if param_name is None:
                continue
            body = arg.child_by_field_name("body")
            if body is None:
                continue
            for el in iter_jsx_opening_elements(body):
                if jsx_tag_name(el, buf) != "ExepadImage":
                    continue
                if _find_attr_referencing_param(el, "keywords", buf, param_name):
                    return True
    return False


def _root_identifier_of_chain(node: Node | None, buf: bytes) -> str | None:
    """Walk a member/call chain to find its root identifier name.

    ``ITEMS`` → ``"ITEMS"``
    ``ITEMS.filter(p)`` → ``"ITEMS"``
    ``useMemo(...)`` → ``None`` (root is not a plain identifier)
    """
    cursor: Node | None = node
    while cursor is not None:
        if cursor.type == "identifier":
            return buf[cursor.start_byte : cursor.end_byte].decode("utf-8")
        if cursor.type == "member_expression":
            cursor = cursor.child_by_field_name("object")
            continue
        if cursor.type == "call_expression":
            cursor = cursor.child_by_field_name("function")
            continue
        return None
    return None


# ---------------------------------------------------------------------------
# Rewrites
# ---------------------------------------------------------------------------


def _rewrite_array_element_keywords(
    element: Node, buf: bytes
) -> tuple[int, int, str] | None:
    """Rewrite a single object literal's ``keywords:`` (+ optional ``importance:``)
    pair(s) into a single ``image: { keywords, importance }`` pair.

    Edits the object in place: replaces the byte span of the source
    ``keywords:`` pair with the new ``image:`` pair, and removes the
    ``importance:`` pair if it was siblinged.

    Returns a single ``(start_byte, end_byte, replacement)`` edit. If
    ``importance:`` is also present, it gets removed via the same edit
    by extending the span to cover both pairs (when adjacent) or via a
    second edit returned in the next caller iteration. To keep the call
    site simple, we only handle the contiguous case here; non-contiguous
    ``importance:`` pairs fall back to the default importance value.
    """
    keywords_pair: Node | None = None
    keywords_value_text: str | None = None
    importance_pair: Node | None = None
    importance_value_text: str | None = None

    for pair in element.named_children:
        if pair.type != "pair":
            continue
        key = pair.child_by_field_name("key")
        val = pair.child_by_field_name("value")
        if key is None or val is None:
            continue
        key_name = buf[key.start_byte : key.end_byte].decode("utf-8")
        if key_name == "keywords" and val.type == "string":
            keywords_pair = pair
            keywords_value_text = buf[val.start_byte : val.end_byte].decode("utf-8")
        elif key_name == "importance":
            importance_pair = pair
            importance_value_text = buf[val.start_byte : val.end_byte].decode("utf-8")

    if keywords_pair is None or keywords_value_text is None:
        return None

    importance_literal = importance_value_text or str(_DEFAULT_IMPORTANCE)
    nested = (
        "image: { "
        f"keywords: {keywords_value_text}, importance: {importance_literal}"
        " }"
    )

    # Coalesce when importance pair is adjacent (no other pair in between)
    # so the edit becomes a single contiguous replacement.
    if importance_pair is not None and _pairs_adjacent(
        keywords_pair, importance_pair, element
    ):
        start = min(keywords_pair.start_byte, importance_pair.start_byte)
        end = max(keywords_pair.end_byte, importance_pair.end_byte)
        return (start, end, nested)

    # Importance pair is non-adjacent (or absent). Replace only the keywords pair.
    # If importance lived elsewhere, leave it in place; the caller's downstream
    # consumer rewrite already drops the importance prop on the JSX side, so the
    # extra top-level ``importance:`` is harmless. Auto-fixers stay idempotent
    # by checking ``image:`` presence on rerun.
    return (keywords_pair.start_byte, keywords_pair.end_byte, nested)


def _pairs_adjacent(a: Node, b: Node, parent_object: Node) -> bool:
    """True when ``a`` and ``b`` are immediate siblings in ``parent_object``
    with only whitespace / comma between them.
    """
    pairs_in_order = [c for c in parent_object.named_children if c.type == "pair"]
    try:
        idx_a = pairs_in_order.index(a)
        idx_b = pairs_in_order.index(b)
    except ValueError:
        return False
    return abs(idx_a - idx_b) == 1


def _rewrite_jsx_consumers(
    root: Node,
    buf: bytes,
    target_arrays: set[str],
    lenient: bool,
) -> tuple[list[tuple[int, int, str]], int]:
    """Rewrite ``<ExepadImage keywords={p.keywords} …/>`` consumers inside
    ``.map((p) => …)`` callbacks.

    When ``lenient`` is False, only ``.map()`` chains rooted directly on
    a name in ``target_arrays`` are eligible. When True, ALL ``.map()``
    callbacks containing the keyword-prop pattern are rewritten — used
    when the source array is reached via useMemo/filter intermediates so
    the receiver chain root doesn't match.

    Replaces ``keywords={p.keywords}`` and any sibling
    ``importance={p.importance}`` with ``{...p.image}`` spread, leaving
    other props (className, width/height as literals, alt, etc.) untouched.

    Returns ``(edits, count)`` where edits is a list of byte-span
    replacements and count is the number of <ExepadImage> elements
    rewritten.
    """
    edits: list[tuple[int, int, str]] = []
    count = 0

    for call in find_by_type(root, "call_expression"):
        func = call.child_by_field_name("function")
        args = call.child_by_field_name("arguments")
        if func is None or args is None or func.type != "member_expression":
            continue
        prop = func.child_by_field_name("property")
        if prop is None or buf[prop.start_byte : prop.end_byte].decode("utf-8") != "map":
            continue
        if not lenient:
            root_name = _root_identifier_of_chain(func.child_by_field_name("object"), buf)
            if root_name is None or root_name not in target_arrays:
                continue

        # Walk arrow callbacks for ExepadImage consumers.
        for arg in args.named_children:
            if arg.type != "arrow_function":
                continue
            param_name = _arrow_first_param_name(arg, buf)
            if param_name is None:
                continue
            body = arg.child_by_field_name("body")
            if body is None:
                continue
            for el in iter_jsx_opening_elements(body):
                if jsx_tag_name(el, buf) != "ExepadImage":
                    continue
                edit = _rewrite_exepad_image_attrs(el, buf, param_name)
                if edit is not None:
                    edits.append(edit)
                    count += 1
    return edits, count


def _arrow_first_param_name(arrow_fn: Node, buf: bytes) -> str | None:
    """Return the single identifier name of an arrow's first parameter.

    Handles ``p => …``, ``(p) => …``, ``(p, i) => …`` (returns ``p``).
    """
    for child in arrow_fn.children:
        if child.type == "identifier":
            return buf[child.start_byte : child.end_byte].decode("utf-8")
        if child.type == "formal_parameters":
            for grand in child.named_children:
                if grand.type == "identifier":
                    return buf[grand.start_byte : grand.end_byte].decode("utf-8")
                if grand.type == "required_parameter":
                    pat = grand.child_by_field_name("pattern")
                    if pat is None:
                        for c in grand.children:
                            if c.type == "identifier":
                                pat = c
                                break
                    if pat is not None and pat.type == "identifier":
                        return buf[pat.start_byte : pat.end_byte].decode("utf-8")
            break
    return None


def _rewrite_exepad_image_attrs(
    element: Node, buf: bytes, param_name: str
) -> tuple[int, int, str] | None:
    """Replace ``keywords={p.keywords}`` (and CONTIGUOUS sibling
    ``importance={p.importance}``) with ``{...p.image}`` on this
    <ExepadImage> element.

    Only folds a contiguous run of foldable attrs starting at the
    keywords attr. If a non-foldable attr (literal, unrelated member
    access, className) sits between two foldable attrs, the run stops at
    the first non-foldable — otherwise the byte-span replacement would
    swallow that attribute. Other props pass through unchanged.

    Returns ``None`` when this element doesn't reference ``p.keywords``
    (so the rewrite is a no-op).
    """
    foldable_attr_names = frozenset({"keywords", "importance"})

    # Collect (attr_node, is_foldable) for every JSX attribute on this
    # element, in source order.
    annotated: list[tuple[Node, bool]] = []
    for attr in iter_jsx_attributes(element):
        if attr.named_child_count == 0:
            continue
        name_node = attr.named_children[0]
        name = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
        is_foldable = name in foldable_attr_names and _attr_value_references_param(
            attr, buf, param_name, name
        )
        annotated.append((attr, is_foldable))

    # Find the contiguous run of foldable attrs that contains the keywords
    # attr — this is the span we replace with `{...param.image}`.
    keywords_idx: int | None = None
    for idx, (attr, _) in enumerate(annotated):
        if attr.named_child_count == 0:
            continue
        name_node = attr.named_children[0]
        name = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
        if name != "keywords":
            continue
        if not _attr_value_references_param(attr, buf, param_name, "keywords"):
            continue
        keywords_idx = idx
        break

    if keywords_idx is None:
        return None

    # Expand left and right from keywords_idx through contiguous foldable attrs.
    left = keywords_idx
    while left - 1 >= 0 and annotated[left - 1][1]:
        left -= 1
    right = keywords_idx
    while right + 1 < len(annotated) and annotated[right + 1][1]:
        right += 1

    span_start = annotated[left][0].start_byte
    span_end = annotated[right][0].end_byte
    replacement = f"{{...{param_name}.image}}"
    return (span_start, span_end, replacement)


def _find_attr_referencing_param(
    element: Node, attr_name: str, buf: bytes, param_name: str
) -> Node | None:
    """Return the jsx_attribute node for ``attr_name`` if its value is
    ``{param.attr_name}`` (a member expression on the map param). Else None.
    """
    for attr in iter_jsx_attributes(element):
        if attr.named_child_count == 0:
            continue
        name_node = attr.named_children[0]
        if buf[name_node.start_byte : name_node.end_byte].decode("utf-8") != attr_name:
            continue
        if _attr_value_references_param(attr, buf, param_name, attr_name):
            return attr
    return None


def _attr_value_references_param(
    attr: Node, buf: bytes, param_name: str, attr_name: str
) -> bool:
    """True iff this jsx_attribute's value is ``{param_name.attr_name}``.

    Specifically: a ``jsx_expression`` wrapping a ``member_expression``
    whose object is ``param_name`` and property is ``attr_name``.
    """
    if attr.named_child_count < 2:
        return False
    value = attr.named_children[1]
    if value.type != "jsx_expression":
        return False
    inner: Node | None = None
    for c in value.named_children:
        if c.type != "comment":
            inner = c
            break
    if inner is None or inner.type != "member_expression":
        return False
    obj = inner.child_by_field_name("object")
    prop = inner.child_by_field_name("property")
    if obj is None or prop is None:
        return False
    if obj.type != "identifier" or buf[obj.start_byte : obj.end_byte].decode("utf-8") != param_name:
        return False
    if buf[prop.start_byte : prop.end_byte].decode("utf-8") != attr_name:
        return False
    return True


# ---------------------------------------------------------------------------
# String-shape variant: ``{image: "string"}`` arrays + ``<ExepadImage
# keywords={p.image}/>`` consumers. Same intent as the canonical-broken
# detector above, but for the case where the LLM picked a sensible field
# name (``image|avatar|logo|...``) and assigned a keyword-like string
# directly instead of the canonical ``{keywords, importance}`` object.
# ---------------------------------------------------------------------------


class _StringImageCandidate:
    """Array where elements use ``<field>: "string"`` shape requiring wrap."""

    __slots__ = ("array_name", "field_name", "string_image_elements")

    def __init__(self, array_name: str, field_name: str, elements: list[Node]) -> None:
        self.array_name = array_name
        self.field_name = field_name
        self.string_image_elements = elements


def _find_string_image_field_arrays(root: Node, buf: bytes) -> list[_StringImageCandidate]:
    """Find ``const NAME = [{…}]`` arrays where an image-like field is
    a bare string instead of a nested ``{keywords, importance}`` object.

    A candidate requires:
    - At least one element object with a field in ``_STRING_IMAGE_FIELD_NAMES``
      whose value is a string literal.
    - Every element that has that field uses the string shape (no mixed
      object/string within the same array — that would suggest the user
      intentionally varied and we shouldn't rewrite partial).
    """
    out: list[_StringImageCandidate] = []
    for declarator in find_by_type(root, "variable_declarator"):
        name_node = declarator.child_by_field_name("name")
        value_node = declarator.child_by_field_name("value")
        if name_node is None or value_node is None:
            continue
        if name_node.type != "identifier" or value_node.type != "array":
            continue
        array_name = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")

        # field_name -> list of (element_node, value_is_string)
        per_field: dict[str, list[tuple[Node, bool]]] = {}
        any_object_element = False
        for child in value_node.named_children:
            if child.type != "object":
                continue
            any_object_element = True
            for pair in child.named_children:
                if pair.type != "pair":
                    continue
                key = pair.child_by_field_name("key")
                val = pair.child_by_field_name("value")
                if key is None or val is None:
                    continue
                key_name = buf[key.start_byte : key.end_byte].decode("utf-8")
                if key_name not in _STRING_IMAGE_FIELD_NAMES:
                    continue
                per_field.setdefault(key_name, []).append((child, val.type == "string"))

        if not any_object_element:
            continue

        for field_name, entries in per_field.items():
            if not all(is_string for (_el, is_string) in entries):
                continue  # mixed shape — skip
            string_elements = [el for (el, _is) in entries]
            if not string_elements:
                continue
            out.append(_StringImageCandidate(array_name, field_name, string_elements))
    return out


def _has_string_image_consumer(root: Node, buf: bytes, field_name: str) -> bool:
    """True iff some ``.map((p) => …)`` callback contains
    ``<ExepadImage keywords={p.<field_name>}/>``.
    """
    for call in find_by_type(root, "call_expression"):
        func = call.child_by_field_name("function")
        args = call.child_by_field_name("arguments")
        if func is None or args is None or func.type != "member_expression":
            continue
        prop = func.child_by_field_name("property")
        if prop is None or buf[prop.start_byte : prop.end_byte].decode("utf-8") != "map":
            continue
        for arg in args.named_children:
            if arg.type != "arrow_function":
                continue
            param_name = _arrow_first_param_name(arg, buf)
            if param_name is None:
                continue
            body = arg.child_by_field_name("body")
            if body is None:
                continue
            for el in iter_jsx_opening_elements(body):
                if jsx_tag_name(el, buf) != "ExepadImage":
                    continue
                # Look for a ``keywords={param_name.<field_name>}`` attribute.
                for attr in iter_jsx_attributes(el):
                    if attr.named_child_count == 0:
                        continue
                    name_node = attr.named_children[0]
                    if (
                        buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
                        != "keywords"
                    ):
                        continue
                    if _attr_value_references_param(attr, buf, param_name, field_name):
                        return True
    return False


def _rewrite_string_image_element_pair(
    element: Node, field_name: str, buf: bytes
) -> tuple[int, int, str] | None:
    """Rewrite ``<field_name>: "STRING"`` → ``<field_name>: { keywords, importance }``."""
    for pair in element.named_children:
        if pair.type != "pair":
            continue
        key = pair.child_by_field_name("key")
        val = pair.child_by_field_name("value")
        if key is None or val is None:
            continue
        if buf[key.start_byte : key.end_byte].decode("utf-8") != field_name:
            continue
        if val.type != "string":
            return None
        string_value_text = buf[val.start_byte : val.end_byte].decode("utf-8")
        replacement = (
            f"{field_name}: {{ "
            f"keywords: {string_value_text}, importance: {_DEFAULT_IMPORTANCE}"
            " }"
        )
        return (pair.start_byte, pair.end_byte, replacement)
    return None


def _rewrite_string_image_jsx_consumers(
    root: Node,
    buf: bytes,
    field_name: str,
    target_arrays: set[str],
    lenient: bool,
) -> tuple[list[tuple[int, int, str]], int]:
    """Rewrite ``<ExepadImage keywords={p.<field_name>} ...>`` consumers to
    ``<ExepadImage {...p.<field_name>} ...>``. Mirrors
    :func:`_rewrite_jsx_consumers` but parameterised on field name.
    """
    edits: list[tuple[int, int, str]] = []
    count = 0
    for call in find_by_type(root, "call_expression"):
        func = call.child_by_field_name("function")
        args = call.child_by_field_name("arguments")
        if func is None or args is None or func.type != "member_expression":
            continue
        prop = func.child_by_field_name("property")
        if prop is None or buf[prop.start_byte : prop.end_byte].decode("utf-8") != "map":
            continue
        if not lenient:
            root_name = _root_identifier_of_chain(func.child_by_field_name("object"), buf)
            if root_name is None or root_name not in target_arrays:
                continue
        for arg in args.named_children:
            if arg.type != "arrow_function":
                continue
            param_name = _arrow_first_param_name(arg, buf)
            if param_name is None:
                continue
            body = arg.child_by_field_name("body")
            if body is None:
                continue
            for el in iter_jsx_opening_elements(body):
                if jsx_tag_name(el, buf) != "ExepadImage":
                    continue
                edit = _rewrite_string_image_exepad_attrs(el, buf, param_name, field_name)
                if edit is not None:
                    edits.append(edit)
                    count += 1
    return edits, count


def _rewrite_string_image_exepad_attrs(
    element: Node, buf: bytes, param_name: str, field_name: str
) -> tuple[int, int, str] | None:
    """Replace ``keywords={p.<field_name>}`` + contiguous foldable sibling
    attrs (``importance={…}``) with ``{...p.<field_name>}``.

    Foldable siblings for this variant include literal-value
    ``importance={6}`` (numeric literal) since the LLM commonly hardcodes
    importance when using the string shape — folding into the spread
    avoids the double-importance JSX.
    """
    annotated: list[tuple[Node, bool, str]] = []
    for attr in iter_jsx_attributes(element):
        if attr.named_child_count == 0:
            continue
        name_node = attr.named_children[0]
        name = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
        if name == "keywords":
            is_foldable = _attr_value_references_param(attr, buf, param_name, field_name)
        elif name == "importance":
            is_foldable = _attr_value_is_numeric_literal_or_param_member(
                attr, buf, param_name
            )
        else:
            is_foldable = False
        annotated.append((attr, is_foldable, name))

    keywords_idx: int | None = None
    for idx, (_attr, foldable, name) in enumerate(annotated):
        if name == "keywords" and foldable:
            keywords_idx = idx
            break

    if keywords_idx is None:
        return None

    left = keywords_idx
    while left - 1 >= 0 and annotated[left - 1][1]:
        left -= 1
    right = keywords_idx
    while right + 1 < len(annotated) and annotated[right + 1][1]:
        right += 1

    span_start = annotated[left][0].start_byte
    span_end = annotated[right][0].end_byte
    replacement = f"{{...{param_name}.{field_name}}}"
    return (span_start, span_end, replacement)


def _attr_value_is_numeric_literal_or_param_member(
    attr: Node, buf: bytes, param_name: str
) -> bool:
    """True for ``importance={6}`` (numeric literal) or
    ``importance={p.importance}`` (member access on map param).
    """
    if attr.named_child_count < 2:
        return False
    value = attr.named_children[1]
    if value.type != "jsx_expression":
        return False
    for c in value.named_children:
        if c.type == "comment":
            continue
        if c.type == "number":
            return True
        if c.type == "member_expression":
            obj = c.child_by_field_name("object")
            if obj is None:
                return False
            if (
                obj.type == "identifier"
                and buf[obj.start_byte : obj.end_byte].decode("utf-8") == param_name
            ):
                return True
            return False
        return False
    return False
