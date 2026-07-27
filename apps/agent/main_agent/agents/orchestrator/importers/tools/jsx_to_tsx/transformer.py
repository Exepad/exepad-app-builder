"""Mechanical JSX → TSX translator (Babel-shell exports → SDK component).

Input is the concatenated React source emitted by the decomposition runner
for a Babel-shell page: every sibling ``.jsx``/``.tsx`` file referenced by
``<script type="text/babel" src="…">`` (in DOM order), followed by every
inline ``<script type="text/babel">`` block from the HTML. Output is a
single ``codefocus_component:{Name}.tsx`` that mounts the original React
tree inside ``<LightDOMContainer>``.

Pipeline (8 stages):

1. Parse the input with tree-sitter-tsx (the TSX grammar accepts plain
   JSX as a strict subset — same parser the validation pipeline uses).
2. Walk top-level statements collecting:

   * Bootstrap calls to strip — ``ReactDOM.render(<X/>, …)``,
     ``ReactDOM.createRoot(…).render(<X/>)``, and the secondary form
     ``const root = ReactDOM.createRoot(…); root.render(<X/>);`` where
     the runtime helper variable is referenced by name later.
   * The root component name extracted from the first JSX argument of
     the render call.
   * Confidence-degrading signals — ES ``import``/``export`` statements
     (modern source not Babel-in-browser), TS-only declarations
     (``interface``, ``type``), multiple distinct bootstrap roots,
     ``dangerouslySetInnerHTML`` with a non-literal value.

3. Strip the bootstrap statements (and the helper-variable declaration
   when applicable) by byte-range — every other byte of the source is
   preserved verbatim, so per-file banners, ``window.X = X;``
   registrations, and ``React.useState`` calls all pass through.
4. Inject ``import { React, LightDOMContainer } from "@exepad/sdk";`` at
   the top of the output.
5. Append a synthesized wrapper component:

   .. code-block:: tsx

      function {component_name}() {
        return (
          <LightDOMContainer>
            <{root_name} />
          </LightDOMContainer>
        );
      }

      export default {component_name};

   The wrapper renders the root rather than rewriting the root's own
   return JSX — that keeps multi-branch returns / fragments / conditional
   renders intact.
6. Set ``confidence="low"`` when any degrading signal fired (Stage 2).
   Empty ``tsx`` is returned when no bootstrap was found at all — the
   workflow treats that as a fall-through signal to invoke
   ComponentBuilder with the raw JSX as context.
7. ``plan_items`` is always empty for Babel-shell sources: the input is
   already idiomatic React; ComponentBuilder running on top would risk
   "improving" working code.
8. ``head_styles_css`` (passed through from the Babel-shell detector)
   rides along in ``styles_css`` so the workflow's existing CSS sidecar
   handler can route it into the global theme.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from tree_sitter import Node

from main_agent.agents.orchestrator.importers.tools.html_to_tsx.transformer import (
    TransformResult,
)
from main_agent.services.validation.tsx_ast.parser import (
    node_text,
    parse_tsx,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.walker import (
    find_by_type,
    find_calls,
    member_chain,
    walk,
)


# ── SDK import line ──────────────────────────────────────────────────────
#
# `@exepad/sdk` exports `React` as a named export but does NOT export
# individual hooks — the React API surface is reachable as `React.useState`
# etc. (verified against `packages/exepad-sdk/src/index.ts`). Translator
# preserves any `React.useX` calls in the source as-is, and any
# ``const { useState } = React;`` destructures pass through too because
# they reference the SDK-imported `React`. We never inject hook imports.

_SDK_IMPORT_LINE = 'import { React, LightDOMContainer } from "@exepad/sdk";'


# ── Bootstrap chain heads we recognise ───────────────────────────────────
#
# Three flavours of React 18 mount calls show up in Babel-in-browser
# exports. Each lands at the bottom of the JSX source after every
# component definition:
#
#   ReactDOM.render(<App/>, document.getElementById("root"));
#     → call_expression with member_chain == "ReactDOM.render"
#
#   ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
#     → call_expression whose function is a member_expression
#       (`<callExpr>.render`); the inner call_expression has chain
#       "ReactDOM.createRoot"
#
#   const root = ReactDOM.createRoot(document.getElementById("root"));
#   root.render(<App/>);
#     → declaration whose initializer is a call_expression with chain
#       "ReactDOM.createRoot"; the next render call uses the variable
#       name. Both lines must be stripped together.

_REACT_DOM_RENDER = "ReactDOM.render"
_REACT_DOM_CREATE_ROOT = "ReactDOM.createRoot"


# ── Confidence-degrading signals ─────────────────────────────────────────
#
# Anything in this list keeps the translator running — we still emit TSX
# — but flips ``confidence`` to "low" and records a warning. The workflow
# logs the warnings; a low-confidence emission may also fall through to
# ComponentBuilder if the empty-tsx sentinel is set elsewhere.

_TS_ONLY_NODE_TYPES = frozenset({"interface_declaration", "type_alias_declaration"})


# ── Internal AST walk results ────────────────────────────────────────────


@dataclass
class _BootstrapMatch:
    """One ``ReactDOM.render`` / ``createRoot().render`` / ``root.render`` call.

    ``span`` is the ``(start_byte, end_byte)`` range of the *outer*
    statement (typically an ``expression_statement``) so callers can
    splice it out cleanly without leaving stranded semicolons.

    ``root_jsx_name`` is the tag name of the JSX argument passed to
    ``.render``. ``None`` when the argument is something we couldn't
    safely identify (e.g. a fragment, a function call, or an
    expression).

    ``root_jsx_has_attrs`` is True when the bootstrap JSX element
    declares attributes (``<App name="x"/>``). The wrapper synthesis
    drops them, so callers should warn the user that the rendered
    component starts without its bootstrap-time props.

    ``helper_var`` is the identifier assigned to ``ReactDOM.createRoot``
    when the bootstrap uses the two-line form; ``None`` for the inline
    forms. The translator strips the matching ``const helper_var = …``
    declaration alongside the render call. A non-None ``helper_var``
    is only accepted as a bootstrap when the helper variable is a known
    ``ReactDOM.createRoot`` declaration; otherwise the match is dropped
    to avoid stripping unrelated ``X.render(<Y/>)`` calls (Stripe SDK,
    custom analytics, etc.).
    """

    span: tuple[int, int]
    root_jsx_name: Optional[str]
    root_jsx_has_attrs: bool = False
    helper_var: Optional[str] = None


@dataclass
class _Scan:
    """Aggregated AST scan — one pass over the program for everything."""

    bootstraps: list[_BootstrapMatch]
    helper_var_decls: dict[str, tuple[int, int]]  # var_name → declaration span
    has_es_imports: bool
    has_ts_only_decls: bool
    has_custom_element_tag: bool
    has_dangerously_set_inner_html_dynamic: bool


def transform_jsx_to_tsx(
    jsx_source: str,
    *,
    component_name: str,
    head_styles_css: str = "",
) -> TransformResult:
    """Translate concatenated Babel-shell JSX into a single TSX component.

    Args:
        jsx_source: Concatenated body of every sibling ``.jsx``/``.tsx``
            file plus any inline ``<script type="text/babel">`` blocks
            from the parent HTML. Order matters — siblings first
            (defining helper components), inline blocks last (defining
            the App composition + ``ReactDOM.render`` bootstrap).
        component_name: PascalCase name of the wrapper component the
            runtime will render. Used for the ``function`` declaration
            and ``export default``.
        head_styles_css: Concatenated ``<head><style>`` body from the
            parent HTML. Forwarded to ``TransformResult.styles_css`` so
            the workflow can add it to the global theme; empty by
            default.

    Returns a :class:`TransformResult`. ``confidence="low"`` is set when
    any degrading signal fires (Stage 2 in the module docstring).
    ``tsx`` is the empty string when no ``ReactDOM`` bootstrap is found
    at all — the workflow treats that as a fall-through sentinel.
    """
    if not jsx_source.strip():
        return TransformResult(
            tsx="",
            confidence="low",
            warnings=["transform_jsx_to_tsx: empty input"],
        )

    try:
        tree = parse_tsx(jsx_source)
    except Exception as exc:  # noqa: BLE001 — surface parse failures to caller
        return TransformResult(
            tsx="",
            confidence="low",
            warnings=[f"transform_jsx_to_tsx: parse failed: {exc}"],
        )

    buf = source_bytes(jsx_source)
    scan = _scan_program(tree.root_node, buf)

    # Form C bootstraps reference a helper variable by name; only accept
    # them when that helper is a known ``ReactDOM.createRoot`` declaration
    # in the same source. Otherwise ``stripeApi.render(<Form/>)`` and
    # similar calls would be incorrectly stripped as React bootstraps.
    scan.bootstraps = [
        b for b in scan.bootstraps
        if b.helper_var is None or b.helper_var in scan.helper_var_decls
    ]

    if not scan.bootstraps:
        return TransformResult(
            tsx="",
            confidence="low",
            warnings=[
                "transform_jsx_to_tsx: no ReactDOM.render bootstrap found "
                "(workflow may fall through to ComponentBuilder)"
            ],
        )

    # Pick the LAST bootstrap as authoritative — Babel-in-browser executes
    # top-to-bottom and only the final ``render`` call matters.
    primary = scan.bootstraps[-1]
    if primary.root_jsx_name is None:
        return TransformResult(
            tsx="",
            confidence="low",
            warnings=[
                "transform_jsx_to_tsx: bootstrap call's JSX argument is not "
                "a single component element (fragment / expression / "
                "function call). Cannot synthesise wrapper."
            ],
        )

    # Spans to strip: every bootstrap call's outer statement, plus the
    # ``const helper_var = …`` declaration when the two-line form is used.
    # Collected as (start, end) tuples; sorted + deduped before splicing.
    spans_to_strip: list[tuple[int, int]] = [b.span for b in scan.bootstraps]
    helper_vars_to_strip: set[str] = {
        b.helper_var for b in scan.bootstraps if b.helper_var is not None
    }
    for var_name in helper_vars_to_strip:
        decl_span = scan.helper_var_decls.get(var_name)
        if decl_span is not None:
            spans_to_strip.append(decl_span)

    # Sibling Babel-shell scripts each repeat ``const { useState, ... } = React;``
    # at top scope. Babel-in-browser wraps each script so they live in
    # isolated scopes; concatenated into one TSX module they collide and
    # esbuild rejects with "symbol already declared". Strip every such
    # destructure and emit a single merged line carrying the union of
    # unique BINDING names. Aliased forms like ``{ useState: useStateS }``
    # introduce unique bindings and are folded in as-is.
    react_destructures = _find_react_destructures(tree.root_node, buf)
    merged_destructure_pairs: list[tuple[str, str]] = []
    if len(react_destructures) >= 2:
        seen_bindings: set[str] = set()
        for _, pairs in react_destructures:
            for prop, binding in pairs:
                if binding in seen_bindings:
                    continue
                seen_bindings.add(binding)
                merged_destructure_pairs.append((prop, binding))
        for span, _ in react_destructures:
            spans_to_strip.append(span)

    body_text = _splice_out(buf, spans_to_strip)

    # Detect distinct root names across all bootstraps. Multiple roots
    # mean the source mounts more than one tree (e.g. a `dev panel` + the
    # app); we still emit the LAST one but warn.
    distinct_roots = {
        b.root_jsx_name for b in scan.bootstraps if b.root_jsx_name is not None
    }

    warnings: list[str] = []
    confidence = "high"

    if scan.has_es_imports:
        warnings.append(
            "ES `import`/`export` statements present (modern source, not "
            "Babel-in-browser); review the SDK import injection"
        )
        confidence = "low"
    if scan.has_ts_only_decls:
        warnings.append(
            "TypeScript-only declarations (interface / type) present; "
            "the JSX path expects plain JS"
        )
        confidence = "low"
    if scan.has_custom_element_tag:
        warnings.append(
            "Custom element tag detected (lowercase tag name with `-`); "
            "may not render under React without a polyfill"
        )
        confidence = "low"
    if scan.has_dangerously_set_inner_html_dynamic:
        warnings.append(
            "Dynamic dangerouslySetInnerHTML present; verify the value is "
            "safe before deploying"
        )
        confidence = "low"
    if len(distinct_roots) > 1:
        warnings.append(
            f"Multiple bootstrap roots {sorted(distinct_roots)} — only the "
            f"last one (`<{primary.root_jsx_name}/>`) is mounted by the wrapper"
        )
        confidence = "low"
    if primary.root_jsx_has_attrs:
        warnings.append(
            f"Root `<{primary.root_jsx_name}/>` declares props in the "
            f"bootstrap call; the wrapper passes none — the rendered "
            f"component starts without its bootstrap-time props"
        )
        confidence = "low"
    if merged_destructure_pairs:
        binding_list = ", ".join(b for _, b in merged_destructure_pairs)
        warnings.append(
            f"Merged {len(react_destructures)} duplicate "
            f"`const {{ ... }} = React;` destructures across sibling JSX "
            f"files into a single declaration ({binding_list})"
        )

    tsx = _assemble_output(
        body_text=body_text.strip(),
        component_name=component_name,
        root_name=primary.root_jsx_name,
        merged_destructure_pairs=merged_destructure_pairs,
    )

    return TransformResult(
        tsx=tsx,
        scripts_js="",
        styles_css=head_styles_css,
        plan_items=[],
        warnings=warnings,
        confidence=confidence,
    )


# ── Implementation ────────────────────────────────────────────────────────


def _scan_program(root: Node, buf: bytes) -> _Scan:
    """Walk every top-level statement once, collecting everything we need."""
    bootstraps: list[_BootstrapMatch] = []
    helper_var_decls: dict[str, tuple[int, int]] = {}
    has_es_imports = False
    has_ts_only_decls = False

    for stmt in root.children:
        if stmt.type in ("import_statement", "export_statement"):
            has_es_imports = True
            continue
        if stmt.type in _TS_ONLY_NODE_TYPES:
            has_ts_only_decls = True
            continue
        # ``const root = ReactDOM.createRoot(…);`` lands at the program
        # level as ``lexical_declaration`` (const/let) or ``variable_declaration`` (var).
        if stmt.type in ("lexical_declaration", "variable_declaration"):
            for var_name in _helper_vars_from_declaration(stmt, buf):
                helper_var_decls[var_name] = (stmt.start_byte, stmt.end_byte)
            continue
        if stmt.type == "expression_statement":
            match = _bootstrap_from_expression_statement(stmt, buf)
            if match is not None:
                bootstraps.append(match)

    has_custom_element_tag = _scan_for_custom_element_tags(root, buf)
    has_dyn_dsih = _scan_for_dynamic_dangerously_set_inner_html(root, buf)

    return _Scan(
        bootstraps=bootstraps,
        helper_var_decls=helper_var_decls,
        has_es_imports=has_es_imports,
        has_ts_only_decls=has_ts_only_decls,
        has_custom_element_tag=has_custom_element_tag,
        has_dangerously_set_inner_html_dynamic=has_dyn_dsih,
    )


def _helper_vars_from_declaration(decl: Node, buf: bytes) -> list[str]:
    """Return identifier names whose initializer is ``ReactDOM.createRoot(…)``."""
    names: list[str] = []
    for declarator in decl.children:
        if declarator.type != "variable_declarator":
            continue
        # variable_declarator: name (identifier) value (expression)
        name_node: Optional[Node] = None
        value_node: Optional[Node] = None
        for child in declarator.named_children:
            if child.type == "identifier" and name_node is None:
                name_node = child
            elif child.type == "call_expression":
                value_node = child
        if name_node is None or value_node is None:
            continue
        chain = _call_chain(value_node, buf)
        if chain == _REACT_DOM_CREATE_ROOT:
            names.append(node_text(name_node, buf))
    return names


def _find_react_destructures(
    root: Node, buf: bytes
) -> list[tuple[tuple[int, int], list[tuple[str, str]]]]:
    """Find every top-level ``const|let|var { ... } = React;`` destructure.

    Returns a list of ``(span, [(property, binding), ...])`` per declaration,
    in source order. ``property`` is the React API name read; ``binding`` is
    the local identifier introduced (== property for shorthand patterns,
    == alias for ``{ useState: useStateS }`` patterns).

    Babel-shell siblings each repeat ``const { useState, useEffect } = React;``
    at the top of their wrapped script scope. Concatenated into one TSX
    module, those re-declarations of the SAME binding name collide and
    esbuild rejects the file. Caller dedupes the bindings.
    """
    out: list[tuple[tuple[int, int], list[tuple[str, str]]]] = []
    for stmt in root.children:
        if stmt.type not in ("lexical_declaration", "variable_declaration"):
            continue
        # A single `const a = X, b = Y;` declaration carries multiple
        # variable_declarators; we only treat it as a React-destructure
        # statement when EVERY declarator destructures from React.
        declarators = [c for c in stmt.children if c.type == "variable_declarator"]
        if not declarators:
            continue
        all_react = True
        pairs: list[tuple[str, str]] = []
        for declarator in declarators:
            name_node = declarator.child_by_field_name("name")
            value_node = declarator.child_by_field_name("value")
            if (
                name_node is None
                or value_node is None
                or value_node.type != "identifier"
                or node_text(value_node, buf) != "React"
                or name_node.type != "object_pattern"
            ):
                all_react = False
                break
            for prop in name_node.named_children:
                if prop.type == "shorthand_property_identifier_pattern":
                    name = node_text(prop, buf)
                    pairs.append((name, name))
                elif prop.type == "object_assignment_pattern":
                    # ``{ useState = defaultVal }`` form — skip silently;
                    # mixing default values into a merged destructure is
                    # ambiguous, leave the original line alone.
                    all_react = False
                    break
                elif prop.type == "pair_pattern":
                    key_node = prop.child_by_field_name("key")
                    value_binding = prop.child_by_field_name("value")
                    # We accept simple aliased forms (``{ useState: useStateS }``).
                    # Nested destructuring or ``{ useState: useStateS = default }``
                    # would land as ``object_pattern`` / ``assignment_pattern`` here
                    # and we bail to leave the original line intact.
                    if (
                        key_node is None
                        or value_binding is None
                        or value_binding.type != "identifier"
                    ):
                        all_react = False
                        break
                    pairs.append((node_text(key_node, buf), node_text(value_binding, buf)))
                else:
                    # rest_pattern, computed keys, anything exotic — bail
                    all_react = False
                    break
            if not all_react:
                break
        if all_react and pairs:
            out.append(((stmt.start_byte, stmt.end_byte), pairs))
    return out


def _format_react_destructure(pairs: list[tuple[str, str]]) -> str:
    """Render ``[(prop, binding), ...]`` as ``const { ... } = React;``.

    Emits shorthand ``{ useState }`` when ``prop == binding`` and aliased
    ``{ useState: useStateS }`` otherwise. Order is preserved.
    """
    parts = [p if p == b else f"{p}: {b}" for p, b in pairs]
    return "const { " + ", ".join(parts) + " } = React;"


def _bootstrap_from_expression_statement(
    stmt: Node, buf: bytes
) -> Optional[_BootstrapMatch]:
    """Match a top-level ``X.render(<Y/>)`` call against the three flavours."""
    call = _first_call_expression_child(stmt)
    if call is None:
        return None
    chain = _call_chain(call, buf)

    # Form A: ReactDOM.render(<X/>, container)
    if chain == _REACT_DOM_RENDER:
        name, has_attrs = _first_jsx_arg(call, buf)
        return _BootstrapMatch(
            span=(stmt.start_byte, stmt.end_byte),
            root_jsx_name=name,
            root_jsx_has_attrs=has_attrs,
        )

    # Form B / C: <something>.render(<X/>) — `something` is either
    # `ReactDOM.createRoot(…)` (inline) or a previously-declared identifier
    # (helper-variable form).
    if chain.endswith(".render"):
        function_node = call.child_by_field_name("function")
        if function_node is None or function_node.type != "member_expression":
            return None
        receiver = function_node.child_by_field_name("object")
        if receiver is None:
            return None

        # Form B: receiver is an inline ``ReactDOM.createRoot(…)`` call.
        if receiver.type == "call_expression":
            inner_chain = _call_chain(receiver, buf)
            if inner_chain == _REACT_DOM_CREATE_ROOT:
                name, has_attrs = _first_jsx_arg(call, buf)
                return _BootstrapMatch(
                    span=(stmt.start_byte, stmt.end_byte),
                    root_jsx_name=name,
                    root_jsx_has_attrs=has_attrs,
                )

        # Form C: receiver is a bare identifier. Caller filters these
        # against the program-scoped ``helper_var_decls`` map and drops
        # any whose helper isn't a known ReactDOM.createRoot declaration —
        # without that filter, ``stripeApi.render(<Form/>)`` and similar
        # would be incorrectly stripped as React bootstraps.
        if receiver.type == "identifier":
            name, has_attrs = _first_jsx_arg(call, buf)
            return _BootstrapMatch(
                span=(stmt.start_byte, stmt.end_byte),
                root_jsx_name=name,
                root_jsx_has_attrs=has_attrs,
                helper_var=node_text(receiver, buf),
            )

    return None


def _first_call_expression_child(stmt: Node) -> Optional[Node]:
    """An ``expression_statement`` wraps a single child expression."""
    for child in stmt.named_children:
        if child.type == "call_expression":
            return child
    return None


def _call_chain(call: Node, buf: bytes) -> str:
    """Return the dotted name a ``call_expression`` calls.

    For ``ReactDOM.render(...)`` returns ``"ReactDOM.render"``. For
    ``ReactDOM.createRoot(...)`` returns ``"ReactDOM.createRoot"``. For
    ``foo()`` returns ``"foo"``. Returns the empty string for shapes
    that aren't a member expression or identifier.
    """
    if call.type != "call_expression":
        return ""
    function = call.child_by_field_name("function")
    if function is None:
        return ""
    if function.type == "member_expression":
        return member_chain(function, buf)
    if function.type == "identifier":
        return node_text(function, buf)
    return ""


def _first_jsx_arg(call: Node, buf: bytes) -> tuple[Optional[str], bool]:
    """Return ``(tag_name, has_attrs)`` for the first JSX argument.

    ``tag_name`` is ``None`` for fragments (``<>...</>``), spread
    arguments, expressions, and other non-element shapes — caller treats
    that as a confidence-degrading signal.

    ``has_attrs`` is True when the JSX element declares any attributes
    (``<App name="x"/>``); the wrapper synthesis drops them, so callers
    should warn that the rendered component starts without its
    bootstrap-time props.
    """
    args = call.child_by_field_name("arguments")
    if args is None:
        return None, False
    for arg in args.named_children:
        if arg.type == "jsx_element":
            opening = _jsx_element_opening_node(arg)
            if opening is None:
                return None, False
            return _jsx_element_tag_name(opening, buf), _jsx_element_has_attrs(opening)
        if arg.type == "jsx_self_closing_element":
            return _jsx_element_tag_name(arg, buf), _jsx_element_has_attrs(arg)
        if arg.type == "jsx_fragment":
            return None, False
        # First positional arg is the JSX root for both render forms.
        return None, False
    return None, False


def _jsx_element_opening_node(jsx_element: Node) -> Optional[Node]:
    for child in jsx_element.children:
        if child.type == "jsx_opening_element":
            return child
    return None


def _jsx_element_tag_name(elem: Node, buf: bytes) -> Optional[str]:
    """Tag name of an opening / self-closing JSX element."""
    name_node = elem.child_by_field_name("name")
    if name_node is None:
        for child in elem.children:
            if child.type in ("identifier", "nested_identifier", "member_expression"):
                name_node = child
                break
    if name_node is None:
        return None
    return node_text(name_node, buf)


def _jsx_element_has_attrs(elem: Node) -> bool:
    """True iff a JSX opening / self-closing element declares any attribute."""
    return any(child.type == "jsx_attribute" for child in elem.children)


def _scan_for_custom_element_tags(root: Node, buf: bytes) -> bool:
    """True iff any JSX tag name is lowercase with a ``-`` (custom element)."""
    for elem in walk(root):
        if elem.type not in ("jsx_opening_element", "jsx_self_closing_element"):
            continue
        name = _jsx_element_tag_name(elem, buf)
        if name and name[:1].islower() and "-" in name:
            return True
    return False


def _scan_for_dynamic_dangerously_set_inner_html(root: Node, buf: bytes) -> bool:
    """True iff any ``dangerouslySetInnerHTML`` value is non-literal.

    A literal ``__html`` string is safe (the source author intended it).
    Anything else (function call, identifier, template with substitution)
    is a smell worth surfacing in the warnings.
    """
    for elem in walk(root):
        if elem.type not in ("jsx_opening_element", "jsx_self_closing_element"):
            continue
        for attr in elem.children:
            if attr.type != "jsx_attribute":
                continue
            if attr.named_child_count == 0:
                continue
            attr_name = node_text(attr.named_children[0], buf)
            if attr_name != "dangerouslySetInnerHTML":
                continue
            if attr.named_child_count < 2:
                continue
            value = attr.named_children[1]
            if value.type != "jsx_expression":
                return True  # non-expression is unusual — flag
            # Value is `{{ __html: <something> }}`. Check whether <something>
            # is a string literal.
            object_node = _first_object_in_jsx_expression(value)
            if object_node is None:
                return True
            if not _object_html_is_string_literal(object_node, buf):
                return True
    return False


def _first_object_in_jsx_expression(expr: Node) -> Optional[Node]:
    for child in expr.named_children:
        if child.type == "object":
            return child
    return None


def _object_html_is_string_literal(obj: Node, buf: bytes) -> bool:
    """True iff the ``__html`` property of ``obj`` is a string literal."""
    for pair in obj.named_children:
        if pair.type != "pair":
            continue
        if pair.named_child_count < 2:
            continue
        key_node = pair.named_children[0]
        value_node = pair.named_children[1]
        key_text = node_text(key_node, buf).strip("'\"")
        if key_text != "__html":
            continue
        return value_node.type == "string"
    return False


def _splice_out(buf: bytes, spans: list[tuple[int, int]]) -> str:
    """Return ``buf`` decoded with ``spans`` removed.

    Spans are sorted ascending and merged when overlapping so the output
    stays well-formed even if the same range is recorded twice (defensive
    against the helper-var dedupe logic).
    """
    if not spans:
        return buf.decode("utf-8")
    merged = _merge_spans(spans)
    parts: list[bytes] = []
    cursor = 0
    for start, end in merged:
        if start > cursor:
            parts.append(buf[cursor:start])
        cursor = end
    if cursor < len(buf):
        parts.append(buf[cursor:])
    return b"".join(parts).decode("utf-8")


def _merge_spans(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    sorted_spans = sorted(spans)
    merged: list[tuple[int, int]] = []
    for start, end in sorted_spans:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _assemble_output(
    *,
    body_text: str,
    component_name: str,
    root_name: str,
    merged_destructure_pairs: Optional[list[tuple[str, str]]] = None,
) -> str:
    """Compose the final TSX file: SDK import + body + wrapper component.

    When ``merged_destructure_pairs`` is non-empty, a single merged
    ``const { ... } = React;`` line is injected immediately after the SDK
    import — this replaces the per-sibling destructures stripped from
    ``body_text`` (see ``_find_react_destructures``).
    """
    prelude = _SDK_IMPORT_LINE + "\n"
    if merged_destructure_pairs:
        prelude += "\n" + _format_react_destructure(merged_destructure_pairs) + "\n"
    return (
        prelude
        + "\n"
        + body_text
        + "\n\n\n"
        + f"function {component_name}() {{\n"
        f"  return (\n"
        f"    <LightDOMContainer>\n"
        f"      <{root_name} />\n"
        f"    </LightDOMContainer>\n"
        f"  );\n"
        f"}}\n"
        f"\n"
        f"export default {component_name};\n"
    )
