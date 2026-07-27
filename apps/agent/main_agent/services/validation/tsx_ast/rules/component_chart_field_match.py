"""``component.charts.datakey_handler_mismatch`` — chart ``dataKey`` /
``nameKey`` props must reference a key the producer handler actually emits.

The bug this catches
--------------------

App ``ky3clhzb`` (2026-05-08): the LLM rewrote a `<Charts.BarChart>` to a
`<Charts.PieChart>` per the user's "make pie chart" request. It preserved
the original BarChart's ``dataKey="appointments"`` and ``nameKey="name"``
verbatim — but the producer handler emits ``appointmentCount`` /
``vetName``, not ``appointments`` / ``name``. The pie rendered as legend
swatches with no slices because Recharts mapped every value to
``undefined``.

Same bug class as the on-2026-05-08 ``tfluo79j`` rate/percentage chart —
just on a different op (chart-shape swap rather than handler rename).
Phase 1 Surveyor on the ``referent-and-current-state`` profile is
structurally blind to this (it doesn't probe data flow); the Editor's
``restyle_referent`` resolution shape doesn't mandate a re-check; the
ComponentBuilder mechanically copies dataKey across chart-type rewrites.

A static AST rule closes the gap from below: regardless of which agent
emitted the component, save is blocked when ``dataKey="X"`` doesn't
intersect the union of object-literal keys in the producer handler's
source.

Fail-open contract
------------------

The rule depends on ``ctx.handler_sources`` — a ``{handler_name: tsx}``
map populated when validation runs after source rehydration. If
``handler_sources`` is missing OR the relevant handler isn't present
OR the handler emits zero static object literals, the rule yields no
findings. We'd rather miss a bug than block a save on a missing
dependency the validator couldn't fetch.

Producer attribution
--------------------

For each chart series (``<Charts.{Bar,Pie,Area,Line}>``) with a
``dataKey="X"`` or ``nameKey="X"`` attribute:

1. Walk up to the chart wrapper (``<Charts.{Bar,Pie,Area,Line}Chart>``)
   to find its ``data={EXPR}`` prop.
2. Trace ``EXPR`` to a root identifier (e.g. ``caseload?.chartData ?? []``
   → ``caseload``).
3. In the same component, find the ``useHandler('NAME')`` whose
   destructure or rename binds to ``caseload``. That's the producer.
4. Look up ``handler_sources[NAME]``; collect every object-literal key
   anywhere in its source via ``infer_handler_emitted_keys``.
5. If ``X`` isn't in that key set → emit an error ``Finding`` with the
   list of available keys as a fix hint.

Severity
--------

Error. Empty charts are crash-class for the user's perception of the app
("the chart isn't working"). The fix is mechanical (rename the dataKey)
and the agent has all the information it needs to fix it on retry —
the finding's ``fix_hint`` lists the actual valid keys.
"""

from __future__ import annotations

from typing import Iterator, Optional

from tree_sitter import Node

from ..walker import (
    iter_jsx_opening_elements,
    jsx_attribute_string_value,
    jsx_attribute_value_node,
    jsx_tag_name,
)
from ..shape_inference import infer_handler_emitted_keys
from .base import AstContext, Finding


# Series elements that take a ``dataKey`` / ``nameKey`` attr we audit.
_SERIES_TAGS: frozenset[str] = frozenset(
    {"Charts.Bar", "Charts.Pie", "Charts.Area", "Charts.Line", "Charts.Radar", "Charts.Scatter"}
)

# Series elements that carry ``data={...}`` *directly* on themselves rather
# than receiving it from a wrapper. Recharts API quirk: ``<Pie>`` and
# ``<Radar>`` (and ``<Scatter>`` when used standalone) bind their own data
# array; ``<Bar>`` / ``<Line>`` / ``<Area>`` receive it from the wrapping
# ``<*Chart>``.
_SELF_DATA_SERIES_TAGS: frozenset[str] = frozenset(
    {"Charts.Pie", "Charts.Radar", "Charts.Scatter"}
)

# Wrapper elements whose ``data={...}`` prop binds the array the series reads.
_WRAPPER_TAGS: frozenset[str] = frozenset(
    {
        "Charts.BarChart",
        "Charts.PieChart",
        "Charts.AreaChart",
        "Charts.LineChart",
        "Charts.RadarChart",
        "Charts.ScatterChart",
        "Charts.ComposedChart",
    }
)

# Attrs whose value is a column name the producer must actually emit.
# ``dataKey`` (value field) and ``nameKey`` (label field) are both contracts.
_KEY_ATTRS: tuple[str, ...] = ("dataKey", "nameKey")


class ChartFieldMismatchRule:
    """Chart ``dataKey`` / ``nameKey`` references must match a producer key."""

    id = "component.charts.datakey_handler_mismatch"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not ctx.handler_sources:
            return  # fail open — no producer source to cross-check

        # Index every useHandler binding in the component:
        #   const { data: caseload } = useHandler('getCaseloadChart')
        #   const trend             = useHandler('getOccupancyTrend')
        # → {'caseload': 'getCaseloadChart', 'trend': 'getOccupancyTrend'}
        bindings = _collect_use_handler_bindings(ctx.tree.root_node, ctx.source_buf)
        if not bindings:
            return

        # Additionally trace one hop through local-variable intermediates so
        # ``data={metrics.chartData}`` resolves when ``metrics`` is built
        # from a handler's output:
        #   const { data: stats } = useHandler('getDashboardStats');
        #   const metrics = { chartData: stats?.chartData ?? [] };
        #   <Charts.AreaChart data={metrics.chartData}> ...
        # Without this hop the rule fails open on app coje33ih's Dashboard
        # (chart `dataKey="existingCost"` against handler key `existing`).
        derived = _collect_derived_field_bindings(ctx.tree.root_node, ctx.source_buf, bindings)
        aliases = _collect_alias_bindings(ctx.tree.root_node, ctx.source_buf, bindings)
        # Aliases extend bindings transparently — ``const m = stats`` makes
        # ``m`` interchangeable with ``stats`` for handler lookup.
        for alias_name, handler in aliases.items():
            bindings.setdefault(alias_name, handler)

        # Walk every chart wrapper, capture its byte range + producer handler.
        # We use byte-range enclosure (rather than parent-walking) because
        # tree-sitter JSX nesting puts series inside the wrapper's
        # ``jsx_element``, and a byte-range test is robust to whatever
        # intermediate fragments / expression containers sit between them.
        wrapper_ranges: list[tuple[int, int, str]] = []  # (start_byte, end_byte, handler)
        for wrapper in iter_jsx_opening_elements(ctx.tree.root_node):
            tag = jsx_tag_name(wrapper, ctx.source_buf)
            if tag not in _WRAPPER_TAGS:
                continue
            data_node = jsx_attribute_value_node(wrapper, "data", ctx.source_buf)
            if data_node is None:
                continue
            handler_name = _resolve_data_handler(
                data_node, ctx.source_buf, bindings, derived
            )
            if handler_name is None:
                continue
            # The wrapper's enclosing jsx_element (parent) covers the full
            # ``<Wrapper>...</Wrapper>`` range that contains the series.
            enclosing = wrapper.parent if wrapper.parent is not None else wrapper
            wrapper_ranges.append((enclosing.start_byte, enclosing.end_byte, handler_name))

        # Don't early-return on empty wrapper_ranges: self-data series
        # (Pie / Radar / Scatter) carry ``data={...}`` directly and don't
        # need a wrapper to attribute their producer.

        # Cache emitted-keys per handler to avoid re-parsing the same source.
        handler_keys_cache: dict[str, set[str]] = {}

        def _keys_for(handler_name: str) -> set[str]:
            cached = handler_keys_cache.get(handler_name)
            if cached is not None:
                return cached
            src = ctx.handler_sources.get(handler_name) if ctx.handler_sources else None
            keys = infer_handler_emitted_keys(src) if src else set()
            handler_keys_cache[handler_name] = keys
            return keys

        def _handler_for_byte(byte_pos: int) -> Optional[str]:
            """Return the handler name for the innermost wrapper enclosing
            ``byte_pos``, or ``None`` if no wrapper covers it."""
            best: Optional[tuple[int, str]] = None  # (range_size, handler)
            for start, end, handler in wrapper_ranges:
                if start <= byte_pos < end:
                    size = end - start
                    if best is None or size < best[0]:
                        best = (size, handler)
            return best[1] if best else None

        # For each series element with a dataKey/nameKey, identify its
        # producer handler — either via its own ``data={...}`` prop (Pie /
        # Radar / Scatter) or via the enclosing wrapper's prop (Bar / Line
        # / Area).
        for series in iter_jsx_opening_elements(ctx.tree.root_node):
            tag = jsx_tag_name(series, ctx.source_buf)
            if tag not in _SERIES_TAGS:
                continue
            handler_name: Optional[str] = None
            if tag in _SELF_DATA_SERIES_TAGS:
                # Self-data series: read ``data={...}`` directly on the series.
                self_data = jsx_attribute_value_node(series, "data", ctx.source_buf)
                if self_data is not None:
                    handler_name = _resolve_data_handler(
                        self_data, ctx.source_buf, bindings, derived
                    )
            if handler_name is None:
                # Fall back to wrapper-supplied data (Bar / Line / Area).
                handler_name = _handler_for_byte(series.start_byte)
            if handler_name is None:
                continue
            valid_keys = _keys_for(handler_name)
            if not valid_keys:
                continue  # handler emits no static literals — bail (fail open)

            for attr_name in _KEY_ATTRS:
                key_value = jsx_attribute_string_value(series, attr_name, ctx.source_buf)
                if key_value is None:
                    continue
                if key_value in valid_keys:
                    continue
                yield Finding(
                    rule_id=self.id,
                    severity="error",
                    message=(
                        f"<{tag} {attr_name}=\"{key_value}\"> references a field that "
                        f"'{handler_name}' does not emit. Valid keys (from the "
                        f"handler's object literals): {sorted(valid_keys)}. Update the "
                        f"chart to use one of those, or fix the handler to emit "
                        f"'{key_value}'."
                    ),
                    line=series.start_point[0] + 1,
                    col=series.start_point[1],
                    fix_hint=(
                        f"replace {attr_name}=\"{key_value}\" with a key the handler emits "
                        f"({', '.join(sorted(valid_keys))})"
                    ),
                )


# ── helpers ──────────────────────────────────────────────────────────


def _collect_use_handler_bindings(root: Node, buf: bytes) -> dict[str, str]:
    """Return a map of local binding name → useHandler producer name.

    Recognises:
      * ``const { data: alias } = useHandler('X')``  → alias → X
      * ``const { data } = useHandler('X')``         → data  → X
      * ``const alias = useHandler('X')``            → alias → X

    Models (``useModel``) are not included — the rule is scoped to handler
    output shapes, where the cross-reference is meaningful (model field
    names already covered by a separate rule).
    """
    out: dict[str, str] = {}
    # Walk every ``variable_declarator`` — that's what ``const x = ...`` parses to.
    stack: list[Node] = [root]
    while stack:
        node = stack.pop()
        if node.type == "variable_declarator":
            value = node.child_by_field_name("value")
            name_node = node.child_by_field_name("name")
            handler_name = _extract_use_handler_arg(value, buf) if value else None
            if handler_name is None:
                # Recurse into other children
                stack.extend(node.named_children)
                continue
            if name_node is None:
                stack.extend(node.named_children)
                continue
            # Two binding shapes
            if name_node.type == "identifier":
                out[buf[name_node.start_byte : name_node.end_byte].decode("utf-8")] = handler_name
            elif name_node.type == "object_pattern":
                for local in _iter_object_pattern_locals(name_node, buf):
                    out[local] = handler_name
        # Recurse
        stack.extend(node.named_children)
    return out


def _extract_use_handler_arg(value_node: Node, buf: bytes) -> Optional[str]:
    """If ``value_node`` is ``useHandler('X', ...)`` — possibly chained
    (``useHandler('X').data``) — return ``"X"``. Otherwise ``None``."""
    n = value_node
    # Strip trailing member-access chains like ``.data`` so
    # ``const { x } = useHandler('Y').data`` is recognised.
    while n is not None and n.type == "member_expression":
        obj = n.child_by_field_name("object")
        if obj is None:
            return None
        n = obj
    if n is None or n.type != "call_expression":
        return None
    callee = n.child_by_field_name("function")
    if callee is None or callee.type != "identifier":
        return None
    if buf[callee.start_byte : callee.end_byte].decode("utf-8") != "useHandler":
        return None
    args = n.child_by_field_name("arguments")
    if args is None:
        return None
    for arg in args.named_children:
        if arg.type == "string":
            # Strip quotes
            s = buf[arg.start_byte : arg.end_byte].decode("utf-8")
            if len(s) >= 2 and s[0] in "'\"" and s[-1] in "'\"":
                return s[1:-1]
            return s
        # First positional non-string arg = give up (template literal etc)
        return None
    return None


def _iter_object_pattern_locals(pattern: Node, buf: bytes) -> Iterator[str]:
    """Yield local-binding names from a destructuring ``object_pattern``.

    For ``{ data: trend }`` yields ``"trend"`` (not ``"data"``). For
    ``{ data }`` yields ``"data"``.
    """
    for child in pattern.named_children:
        if child.type == "shorthand_property_identifier_pattern":
            yield buf[child.start_byte : child.end_byte].decode("utf-8")
        elif child.type == "pair_pattern":
            value = child.child_by_field_name("value")
            if value is not None and value.type == "identifier":
                yield buf[value.start_byte : value.end_byte].decode("utf-8")


def _resolve_data_handler(
    expr_node: Node,
    buf: bytes,
    bindings: dict[str, str],
    derived: dict[tuple[str, str], str],
) -> Optional[str]:
    """Resolve the producer handler for a chart's ``data={EXPR}`` prop.

    Resolution order:
      1. Strip down to ``(root_ident, first_field?)`` via
         :func:`_root_path_of_expr`.
      2. If the expression is a bare identifier (``data={x}``) → look up
         ``bindings[x]``.
      3. If the expression is a single-step member access
         (``data={metrics.chartData}``) → first try
         ``derived[(metrics, chartData)]``; fall back to
         ``bindings[metrics]`` so deeper chains
         (``data={stats.chartData}`` against a direct binding ``stats``)
         still resolve.

    Returns ``None`` if no producer can be attributed (fail-open).
    """
    path = _root_path_of_expr(expr_node, buf)
    if path is None:
        return None
    root, fields = path
    if not fields:
        return bindings.get(root)
    # First-level field access: prefer derived binding, fall back to direct.
    first_field = fields[0]
    return derived.get((root, first_field)) or bindings.get(root)


def _root_path_of_expr(expr_node: Node, buf: bytes) -> Optional[tuple[str, list[str]]]:
    """Like :func:`_root_identifier_of_expr` but also returns the field path.

    Walks through optional-chains, nullish-coalesce, parenthesised
    expressions, and TypeScript ``as`` casts to recover ``(root_ident,
    [field1, field2, ...])``. Returns ``None`` for non-identifier roots
    (call expressions, literals, etc.).
    """
    n: Optional[Node] = expr_node
    if n is None:
        return None
    if n.type == "jsx_expression":
        n = next(iter(n.named_children), None)
    fields: list[str] = []
    while n is not None:
        t = n.type
        if t == "identifier":
            # Walked-in fields are reversed (innermost first); flip to
            # outer→inner order for the caller.
            fields.reverse()
            return buf[n.start_byte : n.end_byte].decode("utf-8"), fields
        if t == "member_expression":
            # Record the property name then descend into the object.
            prop = n.child_by_field_name("property")
            if prop is not None and prop.type in (
                "property_identifier",
                "identifier",
            ):
                fields.append(buf[prop.start_byte : prop.end_byte].decode("utf-8"))
            obj = n.child_by_field_name("object")
            if obj is None:
                return None
            n = obj
            continue
        if t == "subscript_expression":
            # Subscript ``x[expr]`` — skip recording the dynamic key but
            # keep tracing toward the root identifier.
            obj = next(iter(n.named_children), None)
            if obj is None:
                return None
            n = obj
            continue
        if t == "binary_expression":
            left = next(iter(n.named_children), None)
            if left is None:
                return None
            n = left
            continue
        if t == "parenthesized_expression":
            n = next(iter(n.named_children), None)
            continue
        if t == "as_expression":
            # ``(projectionResult as any)`` — first child is the inner value.
            n = next(iter(n.named_children), None)
            continue
        if t == "non_null_expression":
            # ``foo!`` — descend into the inner expression.
            n = next(iter(n.named_children), None)
            continue
        # Anything else (call_expression, array, etc.) — give up.
        return None
    return None


def _collect_derived_field_bindings(
    root: Node,
    buf: bytes,
    base_bindings: dict[str, str],
) -> dict[tuple[str, str], str]:
    """Collect locals built as object literals whose fields trace to a handler.

    Recognises::

        const metrics = {
          existingTco: stats?.existingTco ?? 0,
          chartData:   stats?.chartData ?? [],
        };

    and, given ``base_bindings = {"stats": "getDashboardStats"}``, yields::

        {("metrics", "existingTco"): "getDashboardStats",
         ("metrics", "chartData"):   "getDashboardStats"}

    Fields whose initialiser doesn't trace to a known handler binding are
    silently skipped — the producer can't be attributed for those.
    """
    out: dict[tuple[str, str], str] = {}
    stack: list[Node] = [root]
    while stack:
        node = stack.pop()
        if node.type == "variable_declarator":
            name_node = node.child_by_field_name("name")
            value_node = node.child_by_field_name("value")
            if (
                name_node is not None
                and name_node.type == "identifier"
                and value_node is not None
                and value_node.type == "object"
            ):
                local = buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
                for pair in value_node.named_children:
                    if pair.type != "pair":
                        continue
                    key = pair.child_by_field_name("key")
                    val = pair.child_by_field_name("value")
                    if key is None or val is None:
                        continue
                    if key.type == "property_identifier":
                        key_name = buf[key.start_byte : key.end_byte].decode("utf-8")
                    elif key.type == "string":
                        raw = buf[key.start_byte : key.end_byte].decode("utf-8")
                        key_name = raw[1:-1] if len(raw) >= 2 else raw
                    else:
                        continue
                    val_root = _root_identifier_of_expr(val, buf)
                    if val_root and val_root in base_bindings:
                        out[(local, key_name)] = base_bindings[val_root]
        stack.extend(node.named_children)
    return out


def _collect_alias_bindings(
    root: Node,
    buf: bytes,
    base_bindings: dict[str, str],
) -> dict[str, str]:
    """Collect locals that are direct aliases of a handler binding.

    Recognises::

        const m = stats;
        const cast = stats as { x: number };
        const opt = stats?.payload;       // single member-access shortcut

    For the first two, ``m`` and ``cast`` become aliases of whichever
    handler ``stats`` resolves to. The third (member access) is handled
    via :func:`_collect_derived_field_bindings` for fine-grained
    field-level routing; we don't treat it as a full alias.
    """
    out: dict[str, str] = {}
    stack: list[Node] = [root]
    while stack:
        node = stack.pop()
        if node.type == "variable_declarator":
            name_node = node.child_by_field_name("name")
            value_node = node.child_by_field_name("value")
            if (
                name_node is not None
                and name_node.type == "identifier"
                and value_node is not None
            ):
                # Trace through casts / parens; bail on member access (handled
                # by the field-level derived map instead).
                inner: Optional[Node] = value_node
                while inner is not None and inner.type in (
                    "parenthesized_expression",
                    "as_expression",
                    "non_null_expression",
                ):
                    inner = next(iter(inner.named_children), None)
                if inner is not None and inner.type == "identifier":
                    src = buf[inner.start_byte : inner.end_byte].decode("utf-8")
                    if src in base_bindings:
                        local = buf[name_node.start_byte : name_node.end_byte].decode(
                            "utf-8"
                        )
                        out[local] = base_bindings[src]
        stack.extend(node.named_children)
    return out


def _root_identifier_of_expr(expr_node: Node, buf: bytes) -> Optional[str]:
    """Trace through optional-chain / nullish-coalesce / member-access to
    the root identifier.

    Examples:
        ``caseload?.chartData ?? []``        → ``"caseload"``
        ``trend.data.percentage``            → ``"trend"``
        ``(metrics?.list || [])``            → ``"metrics"``

    Returns ``None`` for non-identifier roots (call expressions, literals).
    """
    n = expr_node
    # Unwrap parenthesized JSX expression containers: ``data={EXPR}`` →
    # the value node is a ``jsx_expression``, child is the actual expr.
    if n.type == "jsx_expression":
        n = next(iter(n.named_children), None)
    # Walk down the operand spine. The tree-sitter-tsx grammar does NOT
    # populate field names on binary_expression / member_expression for
    # the operand positions, so we use ``named_children[0]`` as the
    # canonical "left" or "object" operand.
    while n is not None:
        t = n.type
        if t == "identifier":
            return buf[n.start_byte : n.end_byte].decode("utf-8")
        if t in ("member_expression", "subscript_expression"):
            # First named child is the object operand.
            obj = next(iter(n.named_children), None)
            if obj is None:
                return None
            n = obj
            continue
        if t == "binary_expression":
            # ``a ?? b`` — first operand is the meaningful one.
            left = next(iter(n.named_children), None)
            if left is None:
                return None
            n = left
            continue
        if t == "parenthesized_expression":
            n = next(iter(n.named_children), None)
            continue
        # Anything else (call_expression, array, etc.) — give up.
        return None
    return None


