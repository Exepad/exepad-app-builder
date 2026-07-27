"""AST-based fixer for ``useApp`` destructuring patterns.

The LLM regularly emits two brittle patterns that cause infinite
re-renders via ``useSyncExternalStore``'s ``Object.is`` snapshot
comparison:

1. Inline object selector — ``const { a, b } = useApp(s => ({ a: s.a, b: s.b }))``
   Each render produces a new object, so the snapshot never stabilises.
2. Bare destructure — ``const { a, b } = useApp()``
   Returns the entire store snapshot; mutating any key triggers a
   re-render for every consumer.

Both are rewritten to individual per-key selector calls:

    const a = useApp(s => s.a);
    const b = useApp(s => s.b);

The AST version (this module) replaces the legacy regex fixer because
the regex misses multi-line destructures, trailing comments, and
destructure patterns with leading ``data:`` pairs bound to other
``useModel`` / ``useHandler`` calls. Tree-sitter gives us the exact
``variable_declarator`` node — no ambiguity.

Returns ``(new_source, fixes_applied)`` where ``fixes_applied`` is a
human-readable list matching the legacy regex's messages so the
existing auto-fix telemetry stays stable.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import find_by_type


def rewrite_useapp_destructures(tsx: str) -> tuple[str, list[str]]:
    """Rewrite every ``useApp`` destructure pattern into per-key selector calls.

    Returns the rewritten source plus a list of fix summaries (one per
    destructure rewritten). Non-matching TSX comes back unchanged with an
    empty fix list.
    """
    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx, []

    buf = source_bytes(tsx)
    edits: list[tuple[int, int, str]] = []
    fixes: list[str] = []

    for declarator in find_by_type(tree.root_node, "variable_declarator"):
        name_node = declarator.child_by_field_name("name")
        value_node = declarator.child_by_field_name("value")
        if name_node is None or value_node is None:
            continue
        if name_node.type != "object_pattern":
            continue
        if value_node.type != "call_expression":
            continue
        callee = value_node.child_by_field_name("function")
        if callee is None or callee.type != "identifier":
            continue
        if buf[callee.start_byte : callee.end_byte].decode("utf-8") != "useApp":
            continue

        args = value_node.child_by_field_name("arguments")
        if args is None:
            continue

        # Find the enclosing ``lexical_declaration`` so we rewrite the
        # whole ``const {...} = useApp(...);`` line including its
        # optional semicolon.
        statement = _enclosing_statement(declarator)
        if statement is None:
            continue

        replacement: str | None = None
        fix_msg: str | None = None

        if args.named_child_count == 0:
            # Bare ``useApp()`` destructure.
            names = _destructured_names(name_node, buf)
            if not names:
                continue
            replacement = "\n".join(
                f"const {alias} = useApp(s => s.{key});" for key, alias in names
            )
            fix_msg = f"Rewrote bare useApp() destructuring → {len(names)} individual calls"
        elif args.named_child_count == 1:
            # ``useApp(s => ({ a: s.a, b: s.b }))`` inline object selector.
            selector = args.named_children[0]
            mapping = _arrow_inline_object_mapping(selector, buf)
            if mapping is None:
                continue
            destructured = _destructured_names(name_node, buf)
            dest_keys = {key for key, _ in destructured}
            # Only rewrite when destructured names are all covered by the
            # inline selector (otherwise the rewrite would drop keys).
            if not dest_keys.issubset(set(mapping)):
                continue
            replacement = "\n".join(
                f"const {alias} = useApp(s => s.{mapping[key]});" for key, alias in destructured
            )
            fix_msg = (
                f"Rewrote useApp inline object selector → {len(destructured)} individual calls"
            )
        else:
            continue

        if replacement is None or fix_msg is None:
            continue

        edits.append((statement.start_byte, statement.end_byte, replacement))
        fixes.append(fix_msg)

    if not edits:
        return tsx, []

    # Apply edits right-to-left so earlier offsets stay valid.
    edits.sort(key=lambda e: e[0], reverse=True)
    out = tsx
    for start_byte, end_byte, replacement in edits:
        start = _byte_to_char_index(tsx, start_byte)
        end = _byte_to_char_index(tsx, end_byte)
        out = out[:start] + replacement + out[end:]
    return out, fixes


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _text(node, buf: bytes) -> str:
    return buf[node.start_byte : node.end_byte].decode("utf-8")


def _enclosing_statement(declarator):
    """Walk up from a ``variable_declarator`` to its ``lexical_declaration``."""
    cursor = declarator.parent
    while cursor is not None and cursor.type not in (
        "lexical_declaration",
        "variable_declaration",
    ):
        cursor = cursor.parent
    return cursor


def _destructured_names(object_pattern, buf: bytes) -> list[tuple[str, str]]:
    """Return ``[(source_key, local_alias), ...]`` from an object_pattern node.

    ``{ a, b: c }`` → ``[("a", "a"), ("b", "c")]``. Complex cases (nested
    destructures, default values, rest spreads) abort with an empty list
    so the caller leaves the source unchanged rather than produce a
    semantically-different rewrite.
    """
    out: list[tuple[str, str]] = []
    for child in object_pattern.children:
        if child.type == "shorthand_property_identifier_pattern":
            name = _text(child, buf)
            out.append((name, name))
        elif child.type == "pair_pattern":
            key = child.child_by_field_name("key")
            alias = child.child_by_field_name("value")
            if key is None or alias is None or alias.type != "identifier":
                return []
            out.append((_text(key, buf), _text(alias, buf)))
        elif child.type in ("rest_pattern", "assignment_pattern"):
            return []
        elif child.type in ("{", "}", ",", "comment"):
            continue
        else:
            # Unknown child type — abort to stay safe.
            return []
    return out


def _arrow_inline_object_mapping(node, buf: bytes) -> dict[str, str] | None:
    """Extract ``{k: param.k}`` pairs from an inline-object selector arrow.

    Returns ``{source_key: param_prop, ...}`` when the arrow body is a
    parenthesized object whose every pair value is a direct
    member-expression on the single parameter. Returns ``None`` when the
    pattern doesn't exactly match — we don't want to lose computed
    values or nested expressions during a rewrite.
    """
    if node.type != "arrow_function":
        return None
    # Resolve the single parameter name, supporting both ``s => ...``
    # (identifier as direct child) and ``(s) => ...`` /
    # ``(state: State) => ...`` shapes (identifier nested inside a
    # ``formal_parameters`` / ``required_parameter`` wrapper).
    param_name = _single_param_name(node, buf)
    if param_name is None:
        return None

    body = node.child_by_field_name("body")
    if body is None or body.type != "parenthesized_expression":
        return None
    inner = None
    for child in body.children:
        if child.type == "object":
            inner = child
            break
    if inner is None:
        return None

    mapping: dict[str, str] = {}
    for child in inner.named_children:
        if child.type != "pair":
            return None  # spread, shorthand, computed → unsafe to rewrite
        key_node = child.child_by_field_name("key")
        value_node = child.child_by_field_name("value")
        if key_node is None or value_node is None:
            return None
        if key_node.type not in ("property_identifier", "identifier"):
            return None
        if value_node.type != "member_expression":
            return None
        obj = value_node.child_by_field_name("object")
        prop = value_node.child_by_field_name("property")
        if obj is None or prop is None or obj.type != "identifier" or _text(obj, buf) != param_name:
            return None
        mapping[_text(key_node, buf)] = _text(prop, buf)
    return mapping


def _single_param_name(arrow_fn, buf: bytes) -> str | None:
    """Return the single identifier name of an arrow-function parameter list.

    Handles three shapes:
      * ``s => ...`` — direct ``identifier`` child of the arrow_function.
      * ``(s) => ...`` — ``formal_parameters`` containing
        ``required_parameter`` containing ``identifier``.
      * ``(state: State) => ...`` — typed required_parameter.
    """
    for child in arrow_fn.children:
        if child.type == "identifier":
            return _text(child, buf)
        if child.type == "formal_parameters":
            for grand in child.children:
                if grand.type == "identifier":
                    return _text(grand, buf)
                if grand.type == "required_parameter":
                    ident = grand.child_by_field_name("pattern") or _first_identifier(grand)
                    if ident is not None and ident.type == "identifier":
                        return _text(ident, buf)
    return None


def _first_identifier(node):
    for child in node.children:
        if child.type == "identifier":
            return child
    return None


def _byte_to_char_index(source: str, byte_offset: int) -> int:
    """Convert a tree-sitter byte offset to a Python string char index.

    Tree-sitter reports byte offsets into the UTF-8 encoded source.
    Python string slicing uses char offsets. This helper decodes the
    prefix up to ``byte_offset`` and returns its char length so we
    splice at the right place even when the TSX contains non-ASCII.
    """
    return len(source.encode("utf-8")[:byte_offset].decode("utf-8"))
