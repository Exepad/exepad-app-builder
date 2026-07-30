"""Field-level shape inference for the Surveyor agent.

Three deterministic AST passes that the Surveyor's diagnostic tools call to
detect frontend↔backend field-name mismatches without invoking an LLM:

* :func:`infer_handler_return_shape` — what fields a handler returns.
* :func:`infer_consumer_field_reads` — what fields a component reads from
  each ``useHandler`` / ``useModel`` it calls.
* :func:`field_mismatch_report` — diff producer shapes vs consumer reads,
  yielding ``Mismatch`` records that root-cause the on-2026-05-08 ``tfluo79j``
  bug class deterministically (chart ``dataKey="rate"`` while handler returns
  ``percentage``).

The module is pure: no ADK, no session state, no I/O. Reusable from anywhere
(tools, validators, future Verifier). Tree-sitter primitives come from the
sibling :mod:`parser` and :mod:`walker` modules.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Iterator, Literal

from tree_sitter import Node

from .parser import parse_tsx, source_bytes
from .walker import (
    find_by_type,
    iter_jsx_opening_elements,
    jsx_attribute_string_value,
    jsx_attribute_value_node,
    string_literal_value,
    walk,
)


# ---------------------------------------------------------------------------
# Public dataclasses
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConsumerSite:
    """One ``useHandler`` / ``useModel`` consumer + the fields it reads.

    ``producer`` is the handler name (``useHandler('X')``) or model name
    (``useModel('Y')``). ``fields_read`` is the union of every field the
    component reads off this producer's response — destructured names,
    member-access keys, and JSX ``dataKey`` / ``nameKey`` attrs that
    statically trace back to this producer.

    ``producer_kind`` is ``"handler"`` for ``useHandler``, ``"model"`` for
    ``useModel``, or ``"unknown"`` when a ``dataKey`` cannot be statically
    attributed (multi-producer file, opaque chart data prop). The mismatch
    reporter handles ``"unknown"`` by cross-referencing against every
    producer in the file.

    ``sites`` is a list of (line, col) tuples (1-based line, 0-based col)
    for each read site. The Surveyor uses these to cite specific source
    locations in ``Evidence``.
    """

    producer: str
    producer_kind: Literal["handler", "model", "unknown"]
    fields_read: tuple[str, ...]
    sites: tuple[tuple[int, int], ...] = field(default_factory=tuple)


@dataclass(frozen=True)
class Mismatch:
    """One frontend↔backend field contract violation.

    ``kind`` semantics:

    * ``missing_in_producer`` — consumer reads a field the producer never
      returns. This is the rate/percentage bug class.
    * ``dead_in_consumer`` — producer returns a field nothing reads. Often
      benign (forward-compat, future use), but flagged so the agent can
      decide whether the producer is over-allocating.
    * ``type_mismatch`` — producer returns ``string`` for a field, consumer
      treats it as ``number`` (or vice versa). MVP type inference is shallow,
      so this fires only on obvious cases.
    """

    producer: str
    consumer: str
    field: str
    kind: Literal["missing_in_producer", "dead_in_consumer", "type_mismatch"]
    sites: tuple[tuple[int, int], ...] = field(default_factory=tuple)
    detail: str = ""


# ---------------------------------------------------------------------------
# Public API — handler return-shape inference
# ---------------------------------------------------------------------------


def infer_handler_return_shape(handler_tsx: str) -> dict[str, str]:
    """Walk every ``return <object-literal>`` and produce ``{field: type_hint}``.

    Type hints are best-effort: ``"string"``, ``"number"``, ``"boolean"``,
    ``"null"``, ``"array"``, ``"object"``, or ``"unknown"`` (identifier,
    call, member access — all opaque without a full type checker).

    When multiple ``return`` statements yield different types for the same
    field, the type hint becomes ``"mixed"``. Bare ``return identifier``
    forms are skipped — symbol resolution is out of scope.

    Returns ``{}`` on parse failure or when no return-object literals exist.
    """
    try:
        tree = parse_tsx(handler_tsx)
    except Exception:
        return {}
    buf = source_bytes(handler_tsx)
    shape: dict[str, str] = {}
    for ret in find_by_type(tree.root_node, "return_statement"):
        obj = _return_object_literal(ret)
        if obj is None:
            continue
        for key, type_hint in _iter_object_field_types(obj, buf):
            existing = shape.get(key)
            if existing is None:
                shape[key] = type_hint
            elif existing != type_hint:
                shape[key] = "mixed"
    return shape


def infer_handler_emitted_keys(handler_tsx: str) -> set[str]:
    """Return every property key that could plausibly appear on objects
    returned by this handler. Permissive over-approximation by design.

    Three sources are scanned:

    1. **JS object-literal property keys** anywhere in the source —
       covers ``return {a: b}``, ``arr.push({c: d})``, helper-builder
       patterns, etc.
    2. **JS shorthand property identifiers** — covers ``return {x, y}``.
    3. **SQL column aliases** in template strings — ``SELECT col AS
       aliasName`` patterns in any embedded SQL. The agent's auto-CRUD
       handlers very often skip JS object literals entirely and rely on
       D1's row shape, so missing this source would force the rule to
       fail open on every SQL-style handler. The pattern is matched
       case-insensitively (`AS` / `as`) and accepts both bare-identifier
       and quoted aliases (``AS "x"`` / `` AS `x` ``).

    The chart-mismatch rule uses this as the universe of valid
    ``dataKey`` / ``nameKey`` values for any chart consuming this
    handler. False negatives only occur when the handler returns a key
    that doesn't appear via any of the three scans (e.g. a name dynamically
    constructed at runtime) — uncommon enough to accept.

    Returns ``set()`` on parse failure when there is also no SQL pattern
    to fall back on.
    """
    keys: set[str] = set()

    # Source 1 + 2 — walk the AST.
    try:
        tree = parse_tsx(handler_tsx)
    except Exception:
        tree = None

    if tree is not None:
        buf = source_bytes(handler_tsx)
        for obj in find_by_type(tree.root_node, "object"):
            for direct in obj.named_children:
                if direct.type == "pair":
                    key_node = direct.child_by_field_name("key")
                    if key_node is None:
                        continue
                    name = _key_name(key_node, buf)
                    if name:
                        keys.add(name)
                elif direct.type == "shorthand_property_identifier":
                    keys.add(_text(direct, buf))

    # Source 3 — SQL aliases. Scan the raw string instead of walking
    # template_string nodes because aliases can appear in plain string
    # literals too, and a naive regex over the whole source is correct
    # enough for this conservative over-approximation.
    keys |= _extract_sql_aliases(handler_tsx)

    return keys


# Match ``AS aliasName`` or ``AS "aliasName"`` or ``AS `aliasName` `` —
# the alias is a plain JS identifier shape (letter/underscore start,
# alphanumeric thereafter). The lookbehind ensures ``AS`` is a word
# boundary, not part of a longer identifier (``CASE`` etc). Anchoring at
# whitespace before AS keeps false positives off ``AS`` substrings inside
# words. Case-insensitive.
_SQL_ALIAS_RE = __import__("re").compile(
    r"\bAS\s+(?:`([^`]+)`|\"([^\"]+)\"|([A-Za-z_][A-Za-z0-9_]*))",
    flags=__import__("re").IGNORECASE,
)


def _extract_sql_aliases(source: str) -> set[str]:
    """Pull every ``AS aliasName`` from the raw source string. Returns
    just the alias names (the column expressions themselves are
    ignored)."""
    out: set[str] = set()
    for backtick, quoted, bare in _SQL_ALIAS_RE.findall(source):
        alias = backtick or quoted or bare
        if alias:
            out.add(alias)
    return out


# ---------------------------------------------------------------------------
# Public API — consumer field-read inference
# ---------------------------------------------------------------------------


def infer_consumer_field_reads(component_tsx: str) -> list[ConsumerSite]:
    """Detect every field-name a component reads from each producer it calls.

    Recognises four patterns (in source-order, deduplicated):

    1. **Inline destructure** — ``const { a, b } = useHandler('X')``
       Extracts the destructured property names; producer = ``'X'``.

    2. **Inline destructure off a property chain** —
       ``const { a } = useHandler('X').data``. The ``.data`` and ``.something``
       chains are stripped; producer = ``'X'``.

    3. **Member access on a hook binding** — ``const trend = useHandler('X')``
       followed by ``trend.data.percentage`` / ``trend.percentage``. The
       trailing identifier is captured as a field of producer ``'X'``.

    4. **JSX ``dataKey="X"`` / ``nameKey="X"``** — captures X. Producer
       attribution: if the file has exactly one ``useHandler`` / ``useModel``
       call, the dataKey is attributed to it; otherwise the dataKey is
       returned with producer kind ``"unknown"`` (mismatch reporter
       cross-references against every producer in the file).

    Returns sites with **producer-grouped** reads (one site per producer
    that has at least one read). Ordered by first-seen byte offset.
    """
    try:
        tree = parse_tsx(component_tsx)
    except Exception:
        return []
    buf = source_bytes(component_tsx)

    # Step 1: walk lexical_declaration nodes to build (a) producer bindings
    # (binding_name → producer_name + kind) and (b) immediate-destructure
    # readings.
    bindings: dict[str, tuple[str, Literal["handler", "model"]]] = {}
    reads: dict[tuple[str, str], list[tuple[int, int]]] = {}  # (producer, field) → sites
    producer_kinds: dict[str, Literal["handler", "model", "unknown"]] = {}

    def _record(producer: str, field_name: str, kind: Literal["handler", "model", "unknown"], pt: tuple[int, int]) -> None:
        key = (producer, field_name)
        reads.setdefault(key, []).append(pt)
        # First seen kind wins; "unknown" never overwrites a known kind.
        existing = producer_kinds.get(producer)
        if existing is None or (existing == "unknown" and kind != "unknown"):
            producer_kinds[producer] = kind

    for decl in find_by_type(tree.root_node, "lexical_declaration"):
        for declarator in decl.named_children:
            if declarator.type != "variable_declarator":
                continue
            name_node = declarator.child_by_field_name("name")
            value_node = declarator.child_by_field_name("value")
            if name_node is None or value_node is None:
                continue
            hook = _resolve_use_hook(value_node, buf)
            if hook is None:
                continue
            producer, kind = hook
            if name_node.type == "identifier":
                # Pattern 3: const trend = useHandler('X')
                bindings[_text(name_node, buf)] = (producer, kind)
            elif name_node.type == "object_pattern":
                # Patterns 1+2: const { a, b } = useHandler('X')[.data]
                # PLUS track local-name aliases for renamed destructures so
                # that `const { data: trend } = useHandler('X')` lets us
                # later attribute `trend.something` member-access reads to
                # producer X. This is the load-bearing case for the
                # tfluo79j fixture — every useHandler call there destructures
                # `data` to a domain-specific local name.
                pt = (name_node.start_point[0] + 1, name_node.start_point[1])
                for fld in _iter_destructured_keys(name_node, buf):
                    _record(producer, fld, kind, pt)
                for local_name in _iter_destructured_local_aliases(name_node, buf):
                    bindings[local_name] = (producer, kind)

    # Step 2: walk member_expression nodes for binding.X / binding.data.X
    # patterns. Skip ones inside a destructure value (already handled above).
    for member in find_by_type(tree.root_node, "member_expression"):
        info = _root_binding_and_terminal(member, buf)
        if info is None:
            continue
        root_name, terminal_name = info
        if root_name not in bindings:
            continue
        producer, kind = bindings[root_name]
        # Skip 'data' / 'error' / 'loading' — they are SDK-defined, not handler fields.
        if terminal_name in _SDK_HOOK_FIELDS:
            continue
        _record(producer, terminal_name, kind, (member.start_point[0] + 1, member.start_point[1]))

    # Step 3: walk JSX `dataKey="X"` / `nameKey="X"`. Try to attribute via
    # binding-aware tracing of the chart's `data` prop; otherwise fall back
    # to single-producer file heuristic.
    for element in iter_jsx_opening_elements(tree.root_node):
        for attr_name in ("dataKey", "nameKey"):
            value = jsx_attribute_string_value(element, attr_name, buf)
            if value is None:
                continue
            line_col = (element.start_point[0] + 1, element.start_point[1])
            attributed = _attribute_jsx_data_key(element, bindings, buf)
            if attributed is not None:
                producer, kind = attributed
                _record(producer, value, kind, line_col)
            elif len(bindings) == 1:
                # Single producer in file — attribute to it.
                only_producer, only_kind = next(iter(bindings.values()))
                _record(only_producer, value, only_kind, line_col)
            elif len(bindings) == 0 and not reads:
                # No useHandler/useModel calls at all — record under "unknown".
                # The mismatch reporter has nothing to compare against; this is
                # benign noise but preserved for completeness.
                _record("unknown", value, "unknown", line_col)
            else:
                # Multiple producers and we can't statically attribute. Mark
                # as unknown — the mismatch reporter cross-references it
                # against every producer in the file.
                _record("unknown", value, "unknown", line_col)

    # Step 4: collapse into ConsumerSites, one per producer.
    sites_by_producer: dict[str, list[tuple[str, tuple[int, int]]]] = {}
    for (producer, fld), pts in reads.items():
        for pt in pts:
            sites_by_producer.setdefault(producer, []).append((fld, pt))

    out: list[ConsumerSite] = []
    for producer, entries in sites_by_producer.items():
        unique_fields: list[str] = []
        seen_fields: set[str] = set()
        sites: list[tuple[int, int]] = []
        for fld, pt in entries:
            if fld not in seen_fields:
                seen_fields.add(fld)
                unique_fields.append(fld)
            sites.append(pt)
        out.append(
            ConsumerSite(
                producer=producer,
                producer_kind=producer_kinds.get(producer, "unknown"),
                fields_read=tuple(unique_fields),
                sites=tuple(sorted(set(sites))),
            )
        )
    out.sort(key=lambda s: (s.producer_kind, s.producer))
    return out


# ---------------------------------------------------------------------------
# Public API — mismatch report
# ---------------------------------------------------------------------------


def field_mismatch_report(
    producer_shapes: dict[str, dict[str, str]],
    consumer_sites: Iterable[ConsumerSite],
    *,
    consumer_label: str = "",
) -> list[Mismatch]:
    """Diff fields read by ONE consumer against producer shapes.

    Emits ``missing_in_producer`` mismatches only — the per-consumer
    contract violations the Surveyor cares about most. ``dead_in_consumer``
    requires aggregating reads across every consumer in the app and is
    emitted by :func:`field_mismatch_report_global` instead. Calling
    this function alone would over-flag dead fields whenever one component
    reads only some of a producer's fields and a sibling component reads
    the rest.

    ``producer_shapes`` maps producer name to the field-name → type-hint
    dict from :func:`infer_handler_return_shape` (handlers) or the model
    column set (models — pass ``{column_name: "unknown"}`` for each).

    ``consumer_sites`` is the iterable returned by
    :func:`infer_consumer_field_reads` for ONE component file.

    ``consumer_label`` is a free-form name (typically the component
    filename) used in the ``Mismatch.consumer`` field.
    """
    sites_list = list(consumer_sites)
    out: list[Mismatch] = []

    for site in sites_list:
        if site.producer == "unknown":
            # Cross-check against every producer in the file. A field is
            # "missing" only if NO producer declares it. Otherwise we don't
            # know which producer it belongs to and emit nothing.
            for fld in site.fields_read:
                if not any(fld in shape for shape in producer_shapes.values()):
                    out.append(
                        Mismatch(
                            producer="<unknown>",
                            consumer=consumer_label,
                            field=fld,
                            kind="missing_in_producer",
                            sites=site.sites,
                            detail=(
                                f"Field '{fld}' is read in JSX (e.g., dataKey/nameKey) "
                                f"but no producer in this component declares it. "
                                f"Producers seen: {sorted(producer_shapes.keys()) or '[none]'}."
                            ),
                        )
                    )
            continue
        shape = producer_shapes.get(site.producer)
        if shape is None:
            # Unknown producer (possibly a model name we didn't pre-compute).
            # Skip silently rather than over-report.
            continue
        for fld in site.fields_read:
            if fld not in shape:
                out.append(
                    Mismatch(
                        producer=site.producer,
                        consumer=consumer_label,
                        field=fld,
                        kind="missing_in_producer",
                        sites=site.sites,
                        detail=(
                            f"Consumer reads '{fld}' from {site.producer_kind} "
                            f"'{site.producer}', but the {site.producer_kind} only returns "
                            f"{sorted(shape.keys()) or '[no fields]'}."
                        ),
                    )
                )

    return out


def field_mismatch_report_global(
    producer_shapes: dict[str, dict[str, str]],
    consumer_sites_by_component: dict[str, Iterable[ConsumerSite]],
) -> list[Mismatch]:
    """Whole-app mismatch report — both ``missing_in_producer`` and
    ``dead_in_consumer``, aggregated across every consumer component.

    ``consumer_sites_by_component`` maps a free-form component label
    (typically ``"DashboardContent.tsx"``) to the consumer sites
    :func:`infer_consumer_field_reads` returned for that component.

    The function:

    1. Runs :func:`field_mismatch_report` per-component for the
       ``missing_in_producer`` (and unknown-producer fallback) checks.
    2. Aggregates field reads across ALL components per producer.
    3. For each producer with at least one consumer in the app, flags
       declared fields that no consumer reads as ``dead_in_consumer``.

    This eliminates the false-positive class where one component reads
    half a handler's fields and a sibling component reads the rest.
    """
    out: list[Mismatch] = []

    # 1. Per-component missing_in_producer.
    for label, sites in consumer_sites_by_component.items():
        out.extend(
            field_mismatch_report(producer_shapes, sites, consumer_label=label)
        )

    # 2. Aggregate reads across all components.
    fields_consumed_per_producer: dict[str, set[str]] = {}
    for sites in consumer_sites_by_component.values():
        for site in sites:
            if site.producer == "unknown":
                continue
            fields_consumed_per_producer.setdefault(site.producer, set()).update(
                site.fields_read
            )

    # 3. dead_in_consumer — global.
    for producer, shape in producer_shapes.items():
        consumed = fields_consumed_per_producer.get(producer, set())
        if not consumed:
            # Producer with zero consumers anywhere — silent. Probably used
            # elsewhere we can't see (different app instance, future code).
            continue
        for fld in sorted(shape.keys()):
            if fld not in consumed:
                out.append(
                    Mismatch(
                        producer=producer,
                        consumer="<global>",
                        field=fld,
                        kind="dead_in_consumer",
                        sites=tuple(),
                        detail=(
                            f"Producer '{producer}' returns '{fld}' but no consumer "
                            f"component in the app reads it."
                        ),
                    )
                )

    return out


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


_SDK_HOOK_FIELDS: frozenset[str] = frozenset({"data", "loading", "error", "refetch", "mutate"})


def _text(node: Node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")


def _return_object_literal(return_node: Node) -> Node | None:
    """Return the immediate ``object`` literal a ``return_statement`` yields,
    unwrapping a single ``parenthesized_expression`` if present.

    Returns ``None`` for ``return identifier``, ``return funcCall()``, etc.
    """
    for child in return_node.named_children:
        if child.type == "object":
            return child
        if child.type == "parenthesized_expression":
            for inner in child.named_children:
                if inner.type == "object":
                    return inner
            break
    return None


def _iter_object_field_types(obj: Node, buf: bytes) -> Iterator[tuple[str, str]]:
    """Yield ``(key, type_hint)`` for every direct property of an ``object``.

    Spread elements, computed property names, and method shorthand are
    skipped — there is no static key to extract.
    """
    for direct in obj.named_children:
        if direct.type == "pair":
            key_node = direct.child_by_field_name("key")
            value_node = direct.child_by_field_name("value")
            if key_node is None or value_node is None:
                continue
            key_name = _key_name(key_node, buf)
            if key_name is None:
                continue
            yield key_name, _expression_type_hint(value_node)
        elif direct.type == "shorthand_property_identifier":
            # ``return { rate, count }`` — we have the key but not its type.
            yield _text(direct, buf), "unknown"


def _key_name(key_node: Node, buf: bytes) -> str | None:
    if key_node.type in ("property_identifier", "identifier"):
        return _text(key_node, buf)
    if key_node.type == "string":
        return string_literal_value(key_node, buf)
    return None


def _expression_type_hint(node: Node) -> str:
    """Best-effort static type of an expression node. ``"unknown"`` when
    we'd need symbol resolution to do better."""
    t = node.type
    if t == "string":
        return "string"
    if t == "template_string":
        return "string"
    if t == "number":
        return "number"
    if t in ("true", "false"):
        return "boolean"
    if t == "null":
        return "null"
    if t == "array":
        return "array"
    if t == "object":
        return "object"
    if t == "unary_expression":
        # ``-1`` parses as unary_expression(-, number). Treat the result type
        # as the operand's type when it's number/boolean.
        for child in node.named_children:
            return _expression_type_hint(child)
        return "unknown"
    if t == "binary_expression":
        # ``a + b`` is number-or-string. We don't know which, so return "unknown".
        return "unknown"
    if t == "ternary_expression":
        # Try the consequent and alternate; if they agree, use that.
        children = [c for c in node.named_children if c is not None]
        if len(children) >= 3:
            consequent_t = _expression_type_hint(children[1])
            alternate_t = _expression_type_hint(children[2])
            if consequent_t == alternate_t:
                return consequent_t
        return "unknown"
    if t == "parenthesized_expression":
        for inner in node.named_children:
            return _expression_type_hint(inner)
        return "unknown"
    # identifier, call_expression, member_expression, await_expression, ...
    return "unknown"


def _resolve_use_hook(value_node: Node, buf: bytes) -> tuple[str, Literal["handler", "model"]] | None:
    """Strip optional property/await chains and return ``(producer_name, kind)``
    for a ``useHandler('X')`` / ``useModel('Y')`` call expression. ``None``
    when the value isn't one of those.

    Recognised forms (each is the right-hand side of ``const … = …``):

    * ``useHandler('X')``
    * ``useHandler('X').data``
    * ``useHandler('X').data.something`` — same producer
    * ``await useHandler('X')`` — collapsed
    * ``useModel('Y', opts)`` — opts are ignored for shape purposes
    """
    cur = value_node
    # Unwrap await + member chains.
    while True:
        if cur.type == "await_expression":
            inner = next((c for c in cur.named_children), None)
            if inner is None:
                return None
            cur = inner
            continue
        if cur.type == "member_expression":
            obj = cur.child_by_field_name("object")
            if obj is None:
                return None
            cur = obj
            continue
        if cur.type == "non_null_expression":
            inner = next((c for c in cur.named_children), None)
            if inner is None:
                return None
            cur = inner
            continue
        if cur.type == "parenthesized_expression":
            inner = next((c for c in cur.named_children), None)
            if inner is None:
                return None
            cur = inner
            continue
        break

    if cur.type != "call_expression":
        return None
    callee = cur.child_by_field_name("function")
    if callee is None:
        return None
    callee_name = _text(callee, buf)
    if callee_name == "useHandler":
        kind: Literal["handler", "model"] = "handler"
    elif callee_name == "useModel":
        kind = "model"
    else:
        return None
    args = cur.child_by_field_name("arguments")
    if args is None or args.named_child_count == 0:
        return None
    first = args.named_children[0]
    if first.type != "string":
        return None
    name = string_literal_value(first, buf)
    if not name:
        return None
    return name, kind


def _iter_destructured_keys(object_pattern: Node, buf: bytes) -> Iterator[str]:
    """Yield every property name from an object_pattern destructure.

    Handles:
    * ``{ a, b }`` — shorthand
    * ``{ a: localName }`` — renamed
    * ``{ a = default }`` — assignment pattern
    * ``{ a: { nested } }`` — only the outer key (``a``) is yielded; the
      Surveyor doesn't trace nested shape MVP. The nested fields would be
      attributed to a different producer anyway.

    Spread (``...rest``) and computed keys are skipped.
    """
    for child in object_pattern.named_children:
        if child.type == "shorthand_property_identifier_pattern":
            yield _text(child, buf)
        elif child.type == "pair_pattern":
            key = child.child_by_field_name("key")
            if key is not None:
                key_name = _key_name(key, buf)
                if key_name is not None:
                    yield key_name
        elif child.type == "object_assignment_pattern":
            # ``{ a = default }`` — the key is the first child's text.
            for inner in child.named_children:
                if inner.type == "shorthand_property_identifier_pattern":
                    yield _text(inner, buf)
                    break


def _iter_destructured_local_aliases(
    object_pattern: Node, buf: bytes
) -> Iterator[str]:
    """Yield every LOCAL name introduced by a destructure pattern.

    For renamed destructures only — ``const { data: trend } = useHandler(X)``
    yields ``"trend"`` because the chart's ``data={trend?.X}`` later traces
    through that binding. Shorthand patterns (``{ data }``) introduce
    ``data`` as the local name, but ``data`` is in :data:`_SDK_HOOK_FIELDS`
    and is filtered when traced — we'd never get a useful field read out of
    a ``data`` binding. Skip those.

    The point of this helper is to make destructure-rename consumer code
    look like the simple-binding case for downstream attribution. Without
    it, JSX dataKey attribution fails on the tfluo79j-style code where
    every useHandler is destructured.
    """
    for child in object_pattern.named_children:
        if child.type == "pair_pattern":
            value = child.child_by_field_name("value")
            if value is not None and value.type == "identifier":
                yield _text(value, buf)
            elif value is not None and value.type == "assignment_pattern":
                # ``{ data: trend = [] }`` — peel one layer.
                for inner in value.named_children:
                    if inner.type == "identifier":
                        yield _text(inner, buf)
                        break
        # shorthand_property_identifier_pattern introduces a local name
        # equal to the key — same name, no alias. The plain destructure
        # path already records the field as a read.


def _root_binding_and_terminal(member_node: Node, buf: bytes) -> tuple[str, str] | None:
    """For ``a.b.c``, return ``("a", "c")``.

    The terminal name is the last property in the chain. We walk down the
    ``object`` field of nested member_expressions until we hit the root
    identifier. Returns ``None`` if the root isn't a plain identifier
    (e.g. ``foo().bar`` — the root is a call).

    The ``c`` we return may be ``"data"`` — caller filters
    SDK-defined names via :data:`_SDK_HOOK_FIELDS`.
    """
    if member_node.type != "member_expression":
        return None
    # Skip nested member_expressions — only the OUTERMOST one represents the
    # full a.b.c chain. If our parent is also a member_expression and we are
    # its `object`, we are NOT the outermost — bail out so the outer iteration
    # records the chain once.
    parent = member_node.parent
    if parent is not None and parent.type == "member_expression":
        parent_obj = parent.child_by_field_name("object")
        if parent_obj is not None and parent_obj.start_byte == member_node.start_byte:
            return None

    # Walk down to the root.
    cur = member_node
    terminal = None
    while cur.type == "member_expression":
        prop = cur.child_by_field_name("property")
        if terminal is None and prop is not None and prop.type == "property_identifier":
            terminal = _text(prop, buf)
        obj = cur.child_by_field_name("object")
        if obj is None:
            return None
        if obj.type == "identifier":
            if terminal is None:
                # Walk back up to find the leaf property — happens when the
                # leftmost member node was the outer-most member but its
                # property was opaque. Use the outer property in that case.
                outer_prop = member_node.child_by_field_name("property")
                if outer_prop is not None and outer_prop.type == "property_identifier":
                    terminal = _text(outer_prop, buf)
                if terminal is None:
                    return None
            return _text(obj, buf), terminal
        cur = obj
    return None


def _attribute_jsx_data_key(
    element: Node,
    bindings: dict[str, tuple[str, Literal["handler", "model"]]],
    buf: bytes,
) -> tuple[str, Literal["handler", "model"]] | None:
    """Walk ancestors for the nearest enclosing chart-like JSX element with
    a ``data`` prop, then trace that prop's expression to a known binding.

    Recognised expression shapes (inside ``data={…}``):
    * ``binding`` — direct identifier
    * ``binding?.field`` — optional chain
    * ``binding.field`` — member access
    * ``binding?.field ?? []`` — nullish-coalesce default
    * ``binding.field || []`` — logical-or default

    Returns the producer info if traceable; otherwise ``None``.
    """
    cur = element.parent
    while cur is not None:
        if cur.type == "jsx_element":
            opener = next(
                (c for c in cur.children if c.type == "jsx_opening_element"),
                None,
            )
            if opener is not None and opener.start_byte != element.start_byte:
                value = jsx_attribute_value_node(opener, "data", buf)
                if value is not None and value.type == "jsx_expression":
                    expr = next(
                        (c for c in value.named_children if c.type != "comment"),
                        None,
                    )
                    if expr is not None:
                        ident = _trace_expression_to_root_identifier(expr, buf)
                        if ident is not None and ident in bindings:
                            return bindings[ident]
        cur = cur.parent
    return None


def _trace_expression_to_root_identifier(expr: Node, buf: bytes) -> str | None:
    """Reduce common expression shapes to their root identifier.

    Examples that resolve to ``"trend"``:

    * ``trend``
    * ``trend?.trendData``
    * ``trend.trendData``
    * ``trend?.trendData ?? []``
    * ``trend.trendData || []``
    * ``trend?.data?.trendData``

    Returns ``None`` if the root isn't a plain identifier.
    """
    cur = expr
    # Unwrap parenthesized + nullish-coalesce / logical-or with literal default.
    while True:
        if cur.type == "parenthesized_expression":
            inner = next((c for c in cur.named_children), None)
            if inner is None:
                return None
            cur = inner
            continue
        if cur.type == "binary_expression":
            op_node = cur.child_by_field_name("operator")
            op = _text(op_node, buf) if op_node is not None else ""
            if op in ("??", "||"):
                left = cur.child_by_field_name("left")
                if left is None:
                    return None
                cur = left
                continue
        break
    # Strip member / optional-chain access down to root.
    while True:
        if cur.type == "member_expression":
            obj = cur.child_by_field_name("object")
            if obj is None:
                return None
            cur = obj
            continue
        if cur.type == "subscript_expression":
            obj = cur.child_by_field_name("object")
            if obj is None:
                return None
            cur = obj
            continue
        # tree-sitter-typescript wraps ``?.`` chains in member_expression with
        # an "?." separator; keep climbing.
        break
    if cur.type == "identifier":
        return _text(cur, buf)
    return None


# ---------------------------------------------------------------------------
# Convenience for callers that have a list of consumer files
# ---------------------------------------------------------------------------


def aggregate_consumer_sites(
    files: Iterable[tuple[str, str]],
) -> list[tuple[str, list[ConsumerSite]]]:
    """Apply :func:`infer_consumer_field_reads` to ``(name, source)`` pairs.

    Returns ``[(name, sites), ...]`` filtered to entries that actually
    have at least one site. Convenience for the diagnostic tool that
    sweeps the whole ``codefocus_component:*`` artifact set.
    """
    out: list[tuple[str, list[ConsumerSite]]] = []
    for name, source in files:
        sites = infer_consumer_field_reads(source)
        if sites:
            out.append((name, sites))
    return out
