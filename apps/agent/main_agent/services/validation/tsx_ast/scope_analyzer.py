"""Per-file exports / imports / scope analyzer for Babel-shell modules.

The Phase 2 per-JSX translator needs, for each sibling JSX file:
  - **Exports**: the set of top-level names other files might reference
  - **Imports**: the set of identifiers referenced inside this file but
    NOT bound locally and NOT a known global → these are the names that
    must come from another sibling via `import { X } from "./Other";`
  - **`window.X = ...;` registrations**: legacy cross-file communication
    pattern; the names assigned to `window.X` are public exports too,
    and the assignment statements themselves get stripped at translate
    time (replaced by ES exports).

The walker is intentionally OVER-approximating on the bindings side
(any name that appears in a binding position anywhere in the file is
considered "bound somewhere"), which means cross-file references whose
name happens to also be locally shadowed in some inner scope will be
missed. In practice Babel-shell apps don't shadow component names —
each file owns a distinct namespace — so the over-approximation is
safe and keeps the implementation small.

Module signature::

    analyze_module(source: str) -> ModuleAnalysis

`ModuleAnalysis` carries:
  - `exports`: list[str], dedup'd, source-order
  - `window_registrations`: list[str], dedup'd, source-order
  - `import_candidates`: set[str] of identifier references that must
    come from elsewhere (built-ins already filtered out)
"""

from __future__ import annotations

from dataclasses import dataclass, field

from tree_sitter import Node

from .parser import node_text, parse_tsx, source_bytes
from .walker import walk


# Browser + ECMAScript globals that must NEVER count as cross-module
# imports. Conservative — anything provided by the runtime (browser,
# JS spec, React, the SDK we inject) belongs here. When in doubt,
# extend rather than overreact: a missing builtin shows up as a bogus
# cross-file import which the symbol resolver then fails to resolve,
# surfacing a clear warning at translate time.
_BUILTIN_GLOBALS: frozenset[str] = frozenset({
    # ECMAScript core
    "Array", "ArrayBuffer", "BigInt", "Boolean", "DataView", "Date",
    "Error", "EvalError", "Float32Array", "Float64Array", "Function",
    "Infinity", "Int8Array", "Int16Array", "Int32Array", "JSON",
    "Map", "Math", "NaN", "Number", "Object", "Promise", "Proxy",
    "RangeError", "ReferenceError", "Reflect", "RegExp", "Set",
    "String", "Symbol", "SyntaxError", "TypeError", "URIError",
    "Uint8Array", "Uint16Array", "Uint32Array", "Uint8ClampedArray",
    "WeakMap", "WeakSet",
    # ES standard methods
    "decodeURI", "decodeURIComponent", "encodeURI",
    "encodeURIComponent", "eval", "globalThis", "isFinite", "isNaN",
    "parseFloat", "parseInt", "undefined",
    # Browser globals
    "alert", "atob", "btoa", "cancelAnimationFrame", "clearInterval",
    "clearTimeout", "console", "crypto", "customElements", "document",
    "fetch", "history", "indexedDB", "innerHeight", "innerWidth",
    "localStorage", "location", "matchMedia", "navigator",
    "performance", "postMessage", "prompt", "queueMicrotask",
    "requestAnimationFrame", "screen", "scrollTo", "scrollX",
    "scrollY", "sessionStorage", "setInterval", "setTimeout",
    "structuredClone", "URL", "URLSearchParams", "window",
    # Web APIs
    "AbortController", "Audio", "Blob", "CustomEvent", "Element",
    "Event", "EventTarget", "FileReader", "FormData", "Headers",
    "HTMLElement", "Image", "IntersectionObserver", "MutationObserver",
    "Node", "Range", "ResizeObserver", "Request", "Response",
    "Selection", "WebSocket", "Worker",
    # React + SDK names — provided by the SDK import we inject at
    # translate time. A sibling using `<React.Fragment/>` or
    # `<LightDOMContainer/>` doesn't get those flagged as cross-file
    # imports.
    "React", "LightDOMContainer", "Fragment", "ReactDOM",
})


@dataclass
class ModuleAnalysis:
    """Static analysis result for one Babel-shell sibling JSX file."""

    exports: list[str] = field(default_factory=list)
    window_registrations: list[str] = field(default_factory=list)
    bindings: set[str] = field(default_factory=set)
    references: set[str] = field(default_factory=set)
    import_candidates: set[str] = field(default_factory=set)
    parse_failed: bool = False


def analyze_module(source: str) -> ModuleAnalysis:
    """Walk a JSX/TSX file and report its public surface + dependencies.

    Returns an empty `ModuleAnalysis` (with `parse_failed=True`) when
    tree-sitter cannot parse the input. Callers treat that as "skip
    cross-file resolution; emit the file as-is" rather than failing.
    """
    if not source or not source.strip():
        return ModuleAnalysis()

    try:
        tree = parse_tsx(source)
    except Exception:
        return ModuleAnalysis(parse_failed=True)

    buf = source_bytes(source)
    root = tree.root_node

    exports: list[str] = []
    seen_exports: set[str] = set()
    window_registrations: list[str] = []
    seen_window: set[str] = set()
    bindings: set[str] = set()
    references: set[str] = set()

    def add_export(name: str) -> None:
        if name and name not in seen_exports:
            seen_exports.add(name)
            exports.append(name)

    def add_window_reg(name: str) -> None:
        if name and name not in seen_window:
            seen_window.add(name)
            window_registrations.append(name)

    # ---- Top-level exports + window assignments ----------------------
    for stmt in root.children:
        for name in _top_level_export_names(stmt, buf):
            add_export(name)
        win_name = _window_assignment_name(stmt, buf)
        if win_name is not None:
            add_window_reg(win_name)
            add_export(win_name)

    # ---- Bindings + references walk ----------------------------------
    _collect_bindings_and_references(root, buf, bindings, references)

    # Imports = referenced names that we don't bind locally and aren't
    # built-in globals. Source-order is irrelevant here since the caller
    # uses sets.
    import_candidates = {
        name
        for name in references
        if name not in bindings and name not in _BUILTIN_GLOBALS
    }

    return ModuleAnalysis(
        exports=exports,
        window_registrations=window_registrations,
        bindings=bindings,
        references=references,
        import_candidates=import_candidates,
    )


# ── Top-level exports ─────────────────────────────────────────────────


def _top_level_export_names(stmt: Node, buf: bytes):
    """Yield public-API names introduced by `stmt` at file scope.

    Recognised forms:
      - `function Foo() {}`              → Foo
      - `class Foo {}`                   → Foo
      - `const Foo = <expr>`             → Foo (any value type)
      - `const { a, b: alias } = ...`    → a, alias (destructure)
      - `const { a } = React`            → SKIP (React destructure;
        these are local hook aliases, not public exports of this file)
      - `export function Foo() {}`       → Foo
      - `export const Foo = ...`         → Foo
      - `export default function Foo()`  → Foo
      - `export default <expression>`    → ignored (anonymous default)
      - Plain statements / imports       → ignored
    """
    if stmt.type == "export_statement":
        for child in stmt.named_children:
            if child.type in (
                "function_declaration",
                "class_declaration",
                "lexical_declaration",
                "variable_declaration",
                "enum_declaration",
                "interface_declaration",
                "type_alias_declaration",
            ):
                yield from _top_level_export_names(child, buf)
        return

    if stmt.type in (
        "function_declaration",
        "class_declaration",
        "enum_declaration",
        "interface_declaration",
        "type_alias_declaration",
    ):
        name_node = stmt.child_by_field_name("name")
        # tree-sitter-tsx tags class names as `type_identifier`,
        # function names as `identifier`. Accept either.
        if name_node is not None and name_node.type in (
            "identifier",
            "type_identifier",
        ):
            yield node_text(name_node, buf)
        return

    if stmt.type in ("lexical_declaration", "variable_declaration"):
        for declarator in stmt.children:
            if declarator.type != "variable_declarator":
                continue
            name_node = declarator.child_by_field_name("name")
            value_node = declarator.child_by_field_name("value")
            if name_node is None:
                continue
            # Skip React-destructures: `const { useState } = React;`
            # creates locally-aliased React API, not a cross-file
            # exportable surface.
            if (
                value_node is not None
                and value_node.type == "identifier"
                and node_text(value_node, buf) == "React"
            ):
                continue
            yield from _binding_names_from_pattern(name_node, buf)


def _binding_names_from_pattern(node: Node, buf: bytes):
    """Yield identifier names introduced by a binding pattern.

    Handles `identifier`, `object_pattern`, `array_pattern`,
    `assignment_pattern` (default values), and `rest_pattern`.
    """
    if node is None:
        return
    if node.type == "identifier":
        yield node_text(node, buf)
        return
    if node.type == "shorthand_property_identifier_pattern":
        yield node_text(node, buf)
        return

    if node.type == "object_pattern":
        for child in node.named_children:
            if child.type == "shorthand_property_identifier_pattern":
                yield node_text(child, buf)
            elif child.type == "pair_pattern":
                value_node = child.child_by_field_name("value")
                if value_node is not None:
                    yield from _binding_names_from_pattern(value_node, buf)
            elif child.type in ("rest_pattern", "rest_element"):
                for inner in child.named_children:
                    yield from _binding_names_from_pattern(inner, buf)
            elif child.type == "object_assignment_pattern":
                left = child.child_by_field_name("left")
                if left is not None:
                    yield from _binding_names_from_pattern(left, buf)
        return

    if node.type == "array_pattern":
        for child in node.named_children:
            if child.type in ("rest_pattern", "rest_element"):
                for inner in child.named_children:
                    yield from _binding_names_from_pattern(inner, buf)
            else:
                yield from _binding_names_from_pattern(child, buf)
        return

    if node.type == "assignment_pattern":
        left = node.child_by_field_name("left")
        if left is not None:
            yield from _binding_names_from_pattern(left, buf)
        return


def _window_assignment_name(stmt: Node, buf: bytes) -> str | None:
    """Match `window.X = ...;` and return X.

    Recognises both registration form (`window.Foo = Foo;`) and direct
    assignment (`window.SCHOOL = {...};`). Both make X publicly visible
    to other Babel-shell scripts and should be lifted to ES exports.

    Returns None for any non-`window.X = ...` statement. Computed
    properties (`window[name] = ...`) are not handled — they're rare in
    Babel-shell exports and ambiguous to lift without runtime info.
    """
    if stmt.type != "expression_statement" or not stmt.named_children:
        return None
    expr = stmt.named_children[0]
    if expr.type != "assignment_expression":
        return None
    left = expr.child_by_field_name("left")
    if left is None or left.type != "member_expression":
        return None
    obj = left.child_by_field_name("object")
    prop = left.child_by_field_name("property")
    if obj is None or prop is None:
        return None
    if obj.type != "identifier" or node_text(obj, buf) != "window":
        return None
    if prop.type != "property_identifier":
        return None
    return node_text(prop, buf)


# ── Bindings + references walk ────────────────────────────────────────


def _collect_bindings_and_references(
    root: Node,
    buf: bytes,
    bindings: set[str],
    references: set[str],
) -> None:
    """Single AST walk: every name lands in `bindings` or `references`.

    A node contributes a BINDING when it sits in a binding position
    (function/class name, parameter, variable_declarator name pattern,
    catch param, for-of loop variable, import specifier, labeled
    statement label).

    A node contributes a REFERENCE when it's an `identifier` or
    `jsx_identifier` that's:
      - NOT a binding-position node (we collect those by id)
      - NOT a `member_expression` property (`foo.bar` — bar)
      - NOT a `jsx_attribute` name (`<Foo prop={x}/>` — prop)
      - NOT an object literal pair key (`{ key: val }` — key, when in
        expression position)
      - NOT a lowercase JSX tag (HTML element)
      - NOT inside an `import`/`export` clause specifier list
    """
    # Pass 1 marks binding-position nodes by start_byte (stable identity
    # across Node wrapper recreations — tree-sitter returns fresh
    # wrappers on every access, so id() is not safe).
    binding_byte_offsets: set[int] = set()

    # Pass 1: mark every node that occupies a binding position. We
    # walk the AST once and inspect known parent shapes.
    for node in walk(root):
        # Function-style declarations: name + parameters
        if node.type in (
            "function_declaration",
            "function_expression",
            "function",
            "arrow_function",
            "generator_function",
            "generator_function_declaration",
            "method_definition",
        ):
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                _mark_pattern_ids(name_node, binding_byte_offsets)
            params = node.child_by_field_name("parameters")
            if params is not None:
                _mark_pattern_ids(params, binding_byte_offsets)
            # Single-param arrow `n => expr` puts the parameter as a
            # direct identifier child (no `formal_parameters` wrapper,
            # no `parameters` field). Catch that shape: any direct
            # identifier / pattern child that is NOT the body field.
            if node.type == "arrow_function":
                body_node = node.child_by_field_name("body")
                body_byte = body_node.start_byte if body_node is not None else -1
                for c in node.named_children:
                    if c.start_byte == body_byte:
                        continue
                    if c.type in (
                        "identifier",
                        "object_pattern",
                        "array_pattern",
                    ):
                        _mark_pattern_ids(c, binding_byte_offsets)

        elif node.type in ("class_declaration", "class_expression"):
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                _mark_pattern_ids(name_node, binding_byte_offsets)

        elif node.type in (
            "enum_declaration",
            "interface_declaration",
            "type_alias_declaration",
        ):
            # TypeScript-only declarations: `enum X {}`, `interface X {}`,
            # `type X = ...`. The name in `field("name")` is the binding;
            # other identifiers inside (members, type params) are
            # references and don't need to be marked here — references
            # to a TS-only symbol from another module would still resolve
            # correctly because the symbol-table pass also scans them.
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                _mark_pattern_ids(name_node, binding_byte_offsets)

        elif node.type == "variable_declarator":
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                _mark_pattern_ids(name_node, binding_byte_offsets)

        elif node.type == "catch_clause":
            param = node.child_by_field_name("parameter")
            if param is not None:
                _mark_pattern_ids(param, binding_byte_offsets)
            else:
                # Older grammar variants expose the binding as the first
                # named identifier child of catch_clause.
                for c in node.named_children:
                    if c.type in ("identifier", "object_pattern", "array_pattern"):
                        _mark_pattern_ids(c, binding_byte_offsets)
                        break

        elif node.type in ("for_in_statement", "for_of_statement"):
            left = node.child_by_field_name("left")
            if left is not None:
                # `for (const x of arr)` — left is a lexical_declaration
                # whose declarator's name is the binding. Defer to the
                # variable_declarator branch above by recursing.
                _mark_pattern_ids(left, binding_byte_offsets)

        elif node.type == "labeled_statement":
            label = node.child_by_field_name("label")
            if label is not None:
                _mark_pattern_ids(label, binding_byte_offsets)

        elif node.type in (
            "import_specifier",
            "import_clause",
            "namespace_import",
        ):
            # `import { foo as bar } from "..."` — bar is the local binding.
            # tree-sitter exposes the alias as the `alias` field; absent →
            # the `name` field is the binding.
            alias = node.child_by_field_name("alias")
            if alias is not None:
                _mark_pattern_ids(alias, binding_byte_offsets)
            else:
                name_node = node.child_by_field_name("name")
                if name_node is not None:
                    _mark_pattern_ids(name_node, binding_byte_offsets)

    # Pass 2: bucket every identifier into binding or reference.
    for node in walk(root):
        if node.type == "identifier":
            name = node_text(node, buf)
            if not name:
                continue
            if node.start_byte in binding_byte_offsets:
                bindings.add(name)
                continue
            if _is_member_expression_property(node):
                continue
            if _is_jsx_attribute_name(node):
                continue
            if _is_object_property_key(node):
                continue
            if _is_jsx_tag_name(node):
                # Uppercase identifier in a JSX tag position → component
                # reference; lowercase → HTML element, skip.
                if name and name[0].isupper():
                    references.add(name)
                continue
            if _is_jsx_member_property(node):
                # `<Foo.Bar/>` — Bar is a property of Foo's namespace
                continue
            references.add(name)

        elif node.type == "shorthand_property_identifier_pattern":
            # Always a binding (we already include these via pattern
            # walking above; this catches any we missed structurally).
            name = node_text(node, buf)
            if name:
                bindings.add(name)

        elif node.type == "shorthand_property_identifier":
            # `{ foo }` shorthand in object literal — `foo` IS a
            # reference to a local/imported `foo`.
            name = node_text(node, buf)
            if name and name not in _BUILTIN_GLOBALS:
                references.add(name)


def _mark_pattern_ids(node: Node, marked: set[int]) -> None:
    """Walk a binding pattern; mark every identifier-like node by
    `start_byte` (stable across tree-sitter Node wrapper recreations)."""
    if node is None:
        return
    if node.type == "identifier":
        marked.add(node.start_byte)
        return
    if node.type == "shorthand_property_identifier_pattern":
        marked.add(node.start_byte)
        return
    # Recurse through composite pattern nodes.
    for child in node.named_children:
        _mark_pattern_ids(child, marked)


def _is_member_expression_property(ident: Node) -> bool:
    """`foo.bar` — bar is a property lookup, not a local reference."""
    parent = ident.parent
    if parent is None or parent.type != "member_expression":
        return False
    prop = parent.child_by_field_name("property")
    return prop is not None and prop.start_byte == ident.start_byte


def _is_jsx_attribute_name(ident: Node) -> bool:
    """`<Foo bar={x}/>` — bar is the attribute name."""
    parent = ident.parent
    if parent is None or parent.type != "jsx_attribute":
        return False
    if not parent.named_children:
        return False
    return parent.named_children[0].start_byte == ident.start_byte


def _is_object_property_key(ident: Node) -> bool:
    """`{ key: value }` — key is a property name, not a reference."""
    parent = ident.parent
    if parent is None or parent.type != "pair":
        return False
    key = parent.child_by_field_name("key")
    return key is not None and key.start_byte == ident.start_byte


def _is_jsx_tag_name(ident: Node) -> bool:
    """True iff `ident` is the tag name of a JSX element.

    Tree-sitter-tsx represents `<Foo/>` with the tag identifier as the
    first named child (or the `name` field) of `jsx_opening_element`,
    `jsx_self_closing_element`, or `jsx_closing_element`.
    """
    parent = ident.parent
    if parent is None:
        return False
    if parent.type not in (
        "jsx_opening_element",
        "jsx_self_closing_element",
        "jsx_closing_element",
    ):
        return False
    name_node = parent.child_by_field_name("name")
    if name_node is not None and name_node.start_byte == ident.start_byte:
        return True
    # Fallback: first named child is the tag.
    if parent.named_children and parent.named_children[0].start_byte == ident.start_byte:
        return True
    return False


def _is_jsx_member_property(ident: Node) -> bool:
    """`<Foo.Bar/>` — when ident is `Bar`, return True. We want only
    `Foo` to count as a cross-file reference."""
    parent = ident.parent
    if parent is None:
        return False
    if parent.type not in ("member_expression", "jsx_member_expression"):
        return False
    children = parent.named_children
    if len(children) < 2:
        return False
    # Only the LAST child is the property; earlier children are the
    # object chain (which DO count as references for the leftmost).
    if children[-1].start_byte != ident.start_byte:
        return False
    # Check that this member_expression sits as a JSX tag (vs a regular
    # JS member access — those are handled by `_is_member_expression_property`).
    grand = parent.parent
    if grand is None:
        return False
    return grand.type in (
        "jsx_opening_element",
        "jsx_self_closing_element",
        "jsx_closing_element",
    )
