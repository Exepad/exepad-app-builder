"""Per-JSX-module translator (Phase 2 of the Babel-shell migration).

Where the legacy :mod:`transformer` concatenates every sibling JSX into
one mega-TSX, this module translates each sibling JSX into its OWN TSX
artifact with cross-file ES `import` statements between siblings. The
deploy-time esbuild bundle (``--bundle=true --external:react``) rolls
them back into one JS at the runtime layer, so the runtime doesn't
change.

Public API:

  - :func:`transform_babel_shell_modules` — orchestrator. Takes a list
    of :class:`ModuleSpec` (one per sibling), runs scope analysis to
    build a global symbol table, computes per-module cross-file
    imports, then calls :func:`transform_jsx_module` for each.

  - :func:`transform_jsx_module` — single-file translator. Parses one
    JSX file, strips bootstrap (entry) + window-registrations +
    duplicate React destructures, prefixes top-level declarations with
    ``export``, and prepends an ES import block (SDK + cross-file).

The legacy single-file :func:`transform_jsx_to_tsx` stays — it's the
fall-back when the per-module feature flag is off, or for HTML-only
imports.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from tree_sitter import Node

from main_agent.services.validation.tsx_ast.parser import (
    node_text,
    parse_tsx,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.scope_analyzer import (
    analyze_module,
)

# Reuse internals from the legacy single-file translator.
from .transformer import (
    TransformResult,
    _bootstrap_from_expression_statement,
    _find_react_destructures,
    _format_react_destructure,
    _helper_vars_from_declaration,
    _splice_out,
)


_SDK_IMPORT_LINE_ENTRY = 'import { React, LightDOMContainer } from "@exepad/sdk";'
_SDK_IMPORT_LINE_MODULE = 'import { React } from "@exepad/sdk";'


# Names that surface in scope_analyzer.import_candidates but should NOT
# be added to ES import statements — they're either already provided by
# the SDK's import line above (`React`, `LightDOMContainer`) or are
# expected to be unresolved at the agent layer (the React destructure
# names like `useState` are already available locally to whichever file
# does the destructure; no module exports them).
_IMPORT_FILTER: frozenset[str] = frozenset({
    "React", "LightDOMContainer", "Fragment", "ReactDOM",
    # ReactDOM appears in the entry module's bootstrap line (which gets
    # stripped); it's never imported from a sibling.
})


@dataclass
class ModuleSpec:
    """One sibling JSX file in a Babel-shell page.

    `name` is the PascalCased TSX filename stem (e.g. ``Charts`` for the
    artifact ``codefocus_module:Charts.tsx``).

    `is_entry` is True for the single file containing the
    ``ReactDOM.render`` / ``createRoot().render`` bootstrap — that
    file's translation gets the LightDOMContainer wrapper +
    ``export default``. All other modules emit named exports only.
    """

    name: str
    source: str
    is_entry: bool = False


@dataclass
class _ModuleContext:
    """Internal: analysis + resolution result for one module."""

    spec: ModuleSpec
    analysis: object  # ModuleAnalysis from scope_analyzer
    # imports_to_inject[other_module_name] = sorted list of names to import
    imports_to_inject: dict[str, list[str]] = field(default_factory=dict)
    # unresolved import candidates (name not provided by any sibling)
    unresolved: list[str] = field(default_factory=list)


def transform_babel_shell_modules(
    modules: list[ModuleSpec],
    *,
    entry_component_name: str,
) -> dict[str, TransformResult]:
    """Translate every sibling JSX into its own TSX with ES imports.

    Returns ``{module_name: TransformResult}`` — one entry per input
    spec. The entry module's TSX has the synthesized wrapper component
    + ``export default``; supporting modules emit named exports only.

    Resolution rules:
      - For each module, ``import_candidates`` (names referenced but
        not bound locally and not built-in) are looked up in the global
        symbol table built from every OTHER module's exports.
      - When a name is exported by exactly one sibling → emit
        ``import { name } from "./Sibling";``
      - When a name is exported by multiple siblings → pick the
        alphabetically-first sibling, append a warning.
      - When a name resolves to no sibling → leave it unresolved
        (esbuild bundle will catch it later as undefined; a warning
        surfaces in the entry's TransformResult).
    """
    if not modules:
        return {}

    # ---- Run scope analysis for each module ------------------------
    contexts: list[_ModuleContext] = []
    for spec in modules:
        analysis = analyze_module(spec.source)
        contexts.append(_ModuleContext(spec=spec, analysis=analysis))

    # ---- Build global symbol table {symbol: [provider_module]} -----
    # Walk every module's exports and record which siblings provide it.
    # Multiple providers → ambiguous; we pick the alphabetically-first
    # one and warn.
    providers: dict[str, list[str]] = {}
    for ctx in contexts:
        for exported in ctx.analysis.exports:
            providers.setdefault(exported, []).append(ctx.spec.name)

    # ---- Resolve each module's imports against the symbol table ----
    for ctx in contexts:
        for name in sorted(ctx.analysis.import_candidates):
            if name in _IMPORT_FILTER:
                continue
            candidates = providers.get(name, [])
            # Filter out self-providers (a module exporting a name it
            # also references doesn't import from itself).
            candidates = [m for m in candidates if m != ctx.spec.name]
            if not candidates:
                ctx.unresolved.append(name)
                continue
            chosen = sorted(candidates)[0]
            ctx.imports_to_inject.setdefault(chosen, []).append(name)

    # Sort each per-sibling import list for stable output.
    for ctx in contexts:
        for sibling in list(ctx.imports_to_inject.keys()):
            ctx.imports_to_inject[sibling] = sorted(
                set(ctx.imports_to_inject[sibling])
            )

    # ---- Translate each module -------------------------------------
    results: dict[str, TransformResult] = {}
    for ctx in contexts:
        result = transform_jsx_module(
            source=ctx.spec.source,
            module_name=ctx.spec.name,
            is_entry=ctx.spec.is_entry,
            entry_component_name=entry_component_name if ctx.spec.is_entry else None,
            imports_to_inject=ctx.imports_to_inject,
            unresolved=ctx.unresolved,
        )
        results[ctx.spec.name] = result

    return results


def transform_jsx_module(
    *,
    source: str,
    module_name: str,
    is_entry: bool,
    entry_component_name: Optional[str],
    imports_to_inject: dict[str, list[str]],
    unresolved: list[str],
) -> TransformResult:
    """Translate ONE sibling JSX file into its TSX module.

    For entry modules:
      - Bootstrap call (``ReactDOM.render(<App/>)``) is stripped
      - Helper-var declarations from the createRoot two-line form
        are stripped
      - A wrapper component named ``entry_component_name`` is
        synthesized and ``export default``\'d
      - Top-level declarations stay un-exported (they're internal to
        the bundle's entry); only the wrapper is exported

    For non-entry modules:
      - All recognised top-level declarations (function/class/const)
        are prefixed with ``export`` so siblings can import them
      - ``window.X = X;`` registrations are stripped (ES imports
        replace the global-namespace channel)
      - No bootstrap should be present; if one IS, it's stripped and
        a warning is added

    In both cases:
      - Duplicate ``const { useState } = React;`` destructures are
        merged into a single line at the top (same logic as the
        legacy single-file translator)
      - The SDK import line is injected first
      - Cross-file imports follow the SDK import
    """
    if not source.strip():
        return TransformResult(
            tsx="",
            confidence="low",
            warnings=[
                f"transform_jsx_module({module_name}): empty input"
            ],
        )

    # Pre-pass: rewrite `window.X = expr;` lines.
    #   - `window.X = X;` (self-registration) → "" (the existing
    #     declaration gets `export` prefixed below)
    #   - `window.X = otherExpr;` → `export const X = otherExpr;` so
    #     the value survives as a real binding AND becomes an export
    # This must run before the main parse because the rewritten lines
    # change which spans the rest of the translator sees.
    source = _rewrite_window_assignments(source)

    # Pre-pass: strip aliases from `const { useState: useStateS } = React`
    # destructures. Babel-shell siblings carry these aliases to avoid
    # collisions when concatenated into one global scope. In per-module
    # mode each file is its own ES scope, so the aliases are pure noise
    # — we rewrite them to canonical names (`useState`) and replace
    # every reference in the body. Pure-canonical destructures are
    # untouched.
    source = _dealias_react_destructures(source)

    try:
        tree = parse_tsx(source)
    except Exception as exc:  # noqa: BLE001
        return TransformResult(
            tsx="",
            confidence="low",
            warnings=[
                f"transform_jsx_module({module_name}): parse failed: {exc}"
            ],
        )

    buf = source_bytes(source)
    root = tree.root_node

    warnings: list[str] = []
    confidence = "high"

    # ---- Stage 1: collect spans to strip ---------------------------
    spans_to_strip: list[tuple[int, int]] = []

    # 1a. Bootstrap calls + helper-var decls (entry only — but if a
    #     module accidentally has one, strip it and warn).
    bootstraps, helper_var_decls = _find_bootstraps(root, buf)
    primary: Optional = None
    if bootstraps:
        if not is_entry:
            warnings.append(
                f"{module_name}: ReactDOM bootstrap found in non-entry "
                f"module — stripped, but check the page's entry assignment"
            )
            confidence = "low"
        spans_to_strip.extend(b.span for b in bootstraps)
        for var_name in {b.helper_var for b in bootstraps if b.helper_var}:
            decl_span = helper_var_decls.get(var_name)
            if decl_span is not None:
                spans_to_strip.append(decl_span)
        primary = bootstraps[-1]

    # 1b. window.X = X self-registrations remaining after the pre-pass
    #     (these are the cases where the right side IS the same
    #     identifier as the property — they were left alone by the
    #     pre-pass because the existing declaration covers the value).
    #     Strip them.
    for stmt in root.children:
        if _is_window_self_registration(stmt, buf):
            spans_to_strip.append((stmt.start_byte, stmt.end_byte))

    # 1c. Duplicate React destructures (existing logic).
    react_destructures = _find_react_destructures(root, buf)
    merged_destructure_pairs: list[tuple[str, str]] = []
    if len(react_destructures) >= 2:
        seen: set[str] = set()
        for _, pairs in react_destructures:
            for prop, binding in pairs:
                if binding not in seen:
                    seen.add(binding)
                    merged_destructure_pairs.append((prop, binding))
        for span, _ in react_destructures:
            spans_to_strip.append(span)
        warnings.append(
            f"{module_name}: merged {len(react_destructures)} duplicate "
            f"`const {{ ... }} = React;` destructures into one line "
            f"({', '.join(b for _, b in merged_destructure_pairs)})"
        )

    # 1d. (Modules only) — for each top-level declaration whose name is
    #     in the export set, we prefix `export `. This is implemented as
    #     a SPAN INSERT (not a strip), so we collect it separately.
    export_insert_offsets: list[int] = []
    if not is_entry:
        export_insert_offsets = _collect_export_insert_offsets(root, buf)

    # ---- Stage 2: splice out stripped spans ------------------------
    body_text = _splice_out(buf, spans_to_strip)

    # ---- Stage 3: re-parse (or splice) to inject `export ` for modules
    # We didn't include export inserts in spans_to_strip because
    # _splice_out only strips. Apply inserts on the spliced result.
    if export_insert_offsets:
        body_text = _insert_export_keywords(
            body_text, source, spans_to_strip, export_insert_offsets
        )

    # ---- Stage 4: build the prelude (SDK + cross-file imports) ----
    # Only the entry module needs LightDOMContainer (used by the
    # synthesized wrapper at Stage 5). Supporting modules don't render
    # at the document root, so the import would be dead.
    sdk_import_line = _SDK_IMPORT_LINE_ENTRY if is_entry else _SDK_IMPORT_LINE_MODULE
    prelude_lines: list[str] = [sdk_import_line]
    if merged_destructure_pairs:
        prelude_lines.append(
            _format_react_destructure(merged_destructure_pairs)
        )
    for sibling, names in sorted(imports_to_inject.items()):
        if not names:
            continue
        prelude_lines.append(
            f'import {{ {", ".join(names)} }} from "./{sibling}";'
        )

    if unresolved:
        warnings.append(
            f"{module_name}: {len(unresolved)} unresolved cross-file "
            f"reference(s): {', '.join(sorted(unresolved))} — esbuild "
            f"bundle may report these as undefined"
        )

    # ---- Stage 5: assemble final output ----------------------------
    if is_entry:
        if primary is None or primary.root_jsx_name is None:
            return TransformResult(
                tsx="",
                confidence="low",
                warnings=warnings + [
                    f"{module_name}: no ReactDOM.render bootstrap found "
                    f"in entry module"
                ],
            )
        if entry_component_name is None:
            return TransformResult(
                tsx="",
                confidence="low",
                warnings=warnings + [
                    f"{module_name}: entry module needs a wrapper "
                    f"component name (orchestrator did not pass one)"
                ],
            )
        if primary.root_jsx_has_attrs:
            warnings.append(
                f"{module_name}: root `<{primary.root_jsx_name}/>` had "
                f"props in bootstrap call; the wrapper passes none"
            )
            confidence = "low"
        # Defensive: when the requested wrapper name collides with a
        # top-level declaration in the entry's body, emitting
        # `function {wrapper_name}() {...}` produces a duplicate
        # declaration that esbuild rejects, AND the wrapper would
        # self-recurse (`<{wrapper_name}/>` referencing the body
        # function). Pick a non-colliding alternative by suffixing
        # `Wrapper`. The PUBLIC `export default` still uses
        # `entry_component_name` via re-export.
        existing_top_level = _collect_top_level_names(
            parse_tsx(body_text).root_node, source_bytes(body_text)
        )
        wrapper_name = entry_component_name
        if wrapper_name in existing_top_level:
            collide_warning = (
                f"{module_name}: wrapper name {wrapper_name!r} collides "
                f"with a body declaration; renaming wrapper to "
                f"{wrapper_name}Wrapper"
            )
            warnings.append(collide_warning)
            wrapper_name = f"{entry_component_name}Wrapper"
        tsx = _assemble_entry_module(
            prelude="\n".join(prelude_lines),
            body_text=body_text.strip(),
            wrapper_component_name=wrapper_name,
            root_name=primary.root_jsx_name,
        )
    else:
        tsx = _assemble_supporting_module(
            prelude="\n".join(prelude_lines),
            body_text=body_text.strip(),
        )

    return TransformResult(
        tsx=tsx,
        scripts_js="",
        styles_css="",
        plan_items=[],
        warnings=warnings,
        confidence=confidence,
    )


# ── Helpers ──────────────────────────────────────────────────────────


def _find_bootstraps(
    root: Node, buf: bytes
) -> tuple[list, dict[str, tuple[int, int]]]:
    """Locate bootstrap calls + helper-var declarations.

    Reuses the legacy translator's helpers so detection stays
    consistent across the per-module and concat code paths.
    """
    bootstraps: list = []
    helper_var_decls: dict[str, tuple[int, int]] = {}

    for stmt in root.children:
        if stmt.type in ("lexical_declaration", "variable_declaration"):
            for var_name in _helper_vars_from_declaration(stmt, buf):
                helper_var_decls[var_name] = (stmt.start_byte, stmt.end_byte)
            continue
        if stmt.type == "expression_statement":
            match = _bootstrap_from_expression_statement(stmt, buf)
            if match is not None:
                bootstraps.append(match)

    # Filter Form C (helper-var-referencing) bootstraps to only those
    # whose helper var is a known ReactDOM.createRoot declaration —
    # same guard as the legacy translator.
    bootstraps = [
        b
        for b in bootstraps
        if b.helper_var is None or b.helper_var in helper_var_decls
    ]
    return bootstraps, helper_var_decls


def _is_window_self_registration(stmt: Node, buf: bytes) -> bool:
    """True iff `stmt` is `window.X = X;` (right side is the same
    identifier as the left's property).

    These statements are stripped because the existing top-level
    declaration of `X` (a function/const) gets `export ` prefixed
    elsewhere in the translator. Other window assignments are
    handled by the pre-pass `_rewrite_window_assignments` which
    converts `window.X = expr;` into `export const X = expr;`.
    """
    if stmt.type != "expression_statement" or not stmt.named_children:
        return False
    expr = stmt.named_children[0]
    if expr.type != "assignment_expression":
        return False
    left = expr.child_by_field_name("left")
    right = expr.child_by_field_name("right")
    if left is None or right is None or left.type != "member_expression":
        return False
    obj = left.child_by_field_name("object")
    prop = left.child_by_field_name("property")
    if obj is None or prop is None or obj.type != "identifier":
        return False
    if node_text(obj, buf) != "window":
        return False
    if right.type != "identifier" or prop.type != "property_identifier":
        return False
    return node_text(right, buf) == node_text(prop, buf)


def _collect_top_level_names(root: Node, buf: bytes) -> set[str]:
    """Return the set of names declared at the top level.

    Walks `root.children` and extracts the binding name from
    function/class declarations and lexical/variable declarations.
    Used by :func:`_rewrite_window_assignments` to avoid emitting
    `export const X = ...;` when `X` is already defined elsewhere
    (which would otherwise become a duplicate-declaration esbuild error).
    """
    names: set[str] = set()
    for stmt in root.children:
        node = stmt
        # Unwrap export wrappers: `export function X() {}` etc.
        if stmt.type == "export_statement":
            decl = stmt.child_by_field_name("declaration")
            if decl is not None:
                node = decl
        if node.type in ("function_declaration", "class_declaration"):
            name_node = node.child_by_field_name("name")
            if name_node is not None:
                txt = node_text(name_node, buf)
                if txt:
                    names.add(txt)
            continue
        if node.type in ("lexical_declaration", "variable_declaration"):
            for child in node.named_children:
                if child.type != "variable_declarator":
                    continue
                name_node = child.child_by_field_name("name")
                if name_node is None:
                    continue
                if name_node.type == "identifier":
                    txt = node_text(name_node, buf)
                    if txt:
                        names.add(txt)
                # Object/array destructure patterns: walk and pick up
                # shorthand_property_identifier_pattern leaves. Rare at
                # top level but possible (`const { A, B } = obj;`).
                else:
                    for desc in _walk(name_node):
                        if desc.type == "shorthand_property_identifier_pattern":
                            txt = node_text(desc, buf)
                            if txt:
                                names.add(txt)
                        elif desc.type == "identifier" and desc.parent is not None and (
                            desc.parent.type == "pair_pattern"
                            and desc.parent.child_by_field_name("value") is desc
                        ):
                            txt = node_text(desc, buf)
                            if txt:
                                names.add(txt)
    return names


def _walk(node: Node):
    """Depth-first walk of a tree-sitter node (local helper)."""
    yield node
    for child in node.named_children:
        yield from _walk(child)


def _rewrite_window_assignments(source: str) -> str:
    """Rewrite `window.X = expr;` and `Object.assign(window, {...})` lines.

    Two source-statement shapes get handled:

    1. `window.X = expr;` (single assignment):
       - If `expr` is `X` (self-registration): leave the line in place;
         it will be stripped later by `_is_window_self_registration`.
       - If a top-level declaration of `X` already exists: strip the
         assignment entirely. The existing declaration becomes the
         canonical binding and gets ``export `` prefixed by the export-
         insert pass — the assignment was just a global-namespace
         publication that ES imports replace.
       - Otherwise: replace the entire statement with
         `export const X = expr;` so the value survives as a real
         binding AND becomes a public export.

    2. `Object.assign(window, {X, Y, Z});` (batch publication, common
       in Babel-shell exports). Each named property whose name matches
       an existing top-level declaration is stripped from the object
       literal; if the resulting object is empty, the entire statement
       is dropped. Properties whose name doesn't match a declaration
       are left in place (they're the only source of that binding —
       removing them would break the per-module ES export). When the
       second argument is anything other than an object literal (e.g.
       a spread variable), the statement is left untouched.

    Member assignments (`window.X.Y = z`) are left untouched because the
    left-hand side's `property` field is the inner `Y`, not `X` — the
    member_expression check only matches when the left's object is the
    bare identifier `window`.

    Operates by parsing once, collecting (span, replacement) edits,
    then applying byte-level splices in reverse order.
    """
    if "window" not in source:
        return source
    try:
        tree = parse_tsx(source)
    except Exception:
        return source
    buf = source_bytes(source)

    existing_top_level = _collect_top_level_names(tree.root_node, buf)
    edits: list[tuple[int, int, str]] = []  # (start_byte, end_byte, replacement)
    for stmt in tree.root_node.children:
        if stmt.type != "expression_statement" or not stmt.named_children:
            continue
        expr = stmt.named_children[0]

        # Shape 1: window.X = expr;
        if expr.type == "assignment_expression":
            left = expr.child_by_field_name("left")
            right = expr.child_by_field_name("right")
            if left is None or right is None or left.type != "member_expression":
                continue
            obj = left.child_by_field_name("object")
            prop = left.child_by_field_name("property")
            if (
                obj is None
                or prop is None
                or obj.type != "identifier"
                or prop.type != "property_identifier"
                or node_text(obj, buf) != "window"
            ):
                continue
            prop_name = node_text(prop, buf)
            # Self-registration: leave alone (handled later by strip pass).
            if right.type == "identifier" and node_text(right, buf) == prop_name:
                continue
            # Collision: top-level decl already exists. Strip.
            if prop_name in existing_top_level:
                edits.append((stmt.start_byte, stmt.end_byte, ""))
                continue
            # Direct assignment: rewrite to `export const X = expr;`.
            right_text = node_text(right, buf)
            replacement = f"export const {prop_name} = {right_text};"
            edits.append((stmt.start_byte, stmt.end_byte, replacement))
            continue

        # Shape 2: Object.assign(window, {X, Y, Z});
        if expr.type == "call_expression":
            edit = _rewrite_object_assign_window(expr, stmt, existing_top_level, buf)
            if edit is not None:
                edits.append(edit)
            continue

    if not edits:
        return source
    # Apply edits in reverse order so earlier offsets stay valid.
    out = source.encode("utf-8")
    for start, end, replacement in sorted(edits, reverse=True):
        out = out[:start] + replacement.encode("utf-8") + out[end:]
    return out.decode("utf-8")


def _rewrite_object_assign_window(
    call: Node,
    stmt: Node,
    existing_top_level: set[str],
    buf: bytes,
) -> tuple[int, int, str] | None:
    """Compute the strip edit for `Object.assign(window, {...})`.

    Returns a `(start_byte, end_byte, replacement)` tuple to delete or
    rewrite the statement, or `None` if the call should be left as-is.

    Skip cases (return None):
      - Callee is not the literal `Object.assign` member chain
      - Fewer than 2 arguments
      - First argument is not the bare `window` identifier
      - Second argument is not an object literal (e.g. spread variable)
      - No properties shadow existing top-level declarations
        (means the global registration is the only source of those
        bindings — removing them would lose the symbol)
    """
    callee = call.child_by_field_name("function")
    if callee is None or callee.type != "member_expression":
        return None
    callee_obj = callee.child_by_field_name("object")
    callee_prop = callee.child_by_field_name("property")
    if (
        callee_obj is None
        or callee_prop is None
        or callee_obj.type != "identifier"
        or callee_prop.type != "property_identifier"
        or node_text(callee_obj, buf) != "Object"
        or node_text(callee_prop, buf) != "assign"
    ):
        return None
    args = call.child_by_field_name("arguments")
    if args is None:
        return None
    arg_nodes = [c for c in args.named_children]
    if len(arg_nodes) < 2:
        return None
    target = arg_nodes[0]
    payload = arg_nodes[1]
    if target.type != "identifier" or node_text(target, buf) != "window":
        return None
    if payload.type != "object":
        # Spread var, function call, etc. — defensive: leave alone.
        return None

    # Walk the object literal's properties. For each shorthand
    # (`{X}`) or pair (`{X: expr}`), capture its name + byte span so
    # we can splice colliding entries out of the object literal.
    keep: list[str] = []
    drop_count = 0
    for prop in payload.named_children:
        name: str | None = None
        if prop.type == "shorthand_property_identifier":
            name = node_text(prop, buf)
        elif prop.type == "pair":
            key_node = prop.child_by_field_name("key")
            if key_node is None:
                continue
            if key_node.type == "property_identifier":
                name = node_text(key_node, buf)
            elif key_node.type == "string":
                # Strip surrounding quotes (`"X"` or `'X'`).
                txt = node_text(key_node, buf)
                if len(txt) >= 2 and txt[0] in ("\"", "'") and txt[-1] == txt[0]:
                    name = txt[1:-1]
        if name is None:
            # Spread element, computed key, etc. — leave the whole
            # statement intact rather than risk breaking it.
            return None
        if name in existing_top_level:
            drop_count += 1
        else:
            keep.append(node_text(prop, buf))

    if drop_count == 0:
        return None  # Nothing to strip — leave alone.
    if not keep:
        # Every property collided with an existing declaration → drop
        # the whole statement.
        return (stmt.start_byte, stmt.end_byte, "")
    # Some properties survive → rebuild the call with just those.
    rebuilt = "Object.assign(window, {" + ", ".join(keep) + "});"
    return (stmt.start_byte, stmt.end_byte, rebuilt)


def _dealias_react_destructures(source: str) -> str:
    """Strip aliases from `const { useState: useStateS } = React` lines.

    Babel-shell siblings often carry alias destructures like
    ``const { useState: useStateS } = React;`` so concatenated globals
    don't collide. In per-module mode each file is its own ES scope,
    so the aliases are dead weight that confuses readers.

    For each aliased pair `(prop, binding)` where `prop != binding`:
      1. Rewrite the destructure declaration to use canonical names
         (collapsing aliased pairs to shorthand `{ useState }`).
      2. Replace every reference to `binding` in the body with `prop`.

    Skips:
      - Pure-canonical destructures (no aliases)
      - Pairs whose canonical name collides with another top-level
        declaration in the file (renaming would shadow that decl)
    """
    if "React" not in source:
        return source
    try:
        tree = parse_tsx(source)
    except Exception:
        return source
    buf = source_bytes(source)

    react_destructures = _find_react_destructures(tree.root_node, buf)
    if not react_destructures:
        return source

    # Build alias map across all destructures: binding → canonical prop.
    # Also collect spans of the destructure statements themselves so we
    # can skip identifiers inside them when walking references.
    alias_map: dict[str, str] = {}
    destructure_spans: list[tuple[int, int]] = []
    needs_rewrite = False
    for span, pairs in react_destructures:
        destructure_spans.append(span)
        for prop, binding in pairs:
            if prop != binding:
                # If the same binding appears multiple times across
                # destructures (would be unusual), the first canonical
                # mapping wins.
                if binding not in alias_map:
                    alias_map[binding] = prop
                    needs_rewrite = True

    if not needs_rewrite:
        return source

    # Defensive: if any canonical name collides with a top-level decl
    # of a DIFFERENT binding, drop that alias from the rewrite map —
    # otherwise we'd shadow the existing decl.
    existing_top_level = _collect_top_level_names(tree.root_node, buf)
    for binding, prop in list(alias_map.items()):
        if prop in existing_top_level and prop != binding:
            del alias_map[binding]

    if not alias_map:
        return source

    # Walk the tree and find every identifier reference whose text
    # matches an alias binding. Skip identifiers INSIDE the destructure
    # patterns (those get rewritten as part of the declaration rewrite).
    #
    # Two node types matter:
    #   - `identifier`: ordinary references (calls, returns, args,
    #     parameters, value-side of `pair`)
    #   - `shorthand_property_identifier`: object-literal shorthand
    #     `{ useStateS }` (== `{ useStateS: useStateS }`). This node
    #     simultaneously names a property AND reads the binding. After
    #     dealiasing we want `{ useState }` so the property key matches
    #     the new canonical binding name.
    edits: list[tuple[int, int, str]] = []
    for node in _walk(tree.root_node):
        if node.type not in ("identifier", "shorthand_property_identifier"):
            continue
        # Skip nodes inside any React destructure statement; the
        # declaration rewrite below covers them.
        if any(s <= node.start_byte < e for s, e in destructure_spans):
            continue
        if node.type == "identifier":
            # Skip identifiers used as a property name in member access
            # (`obj.useStateS` shouldn't be touched).
            parent = node.parent
            if parent is not None and parent.type == "member_expression":
                prop_node = parent.child_by_field_name("property")
                if prop_node is node:
                    continue
        text = node_text(node, buf)
        if text in alias_map:
            edits.append((node.start_byte, node.end_byte, alias_map[text]))

    # Rewrite each destructure declaration to use canonical names only.
    for span, pairs in react_destructures:
        canonical_pairs = [
            (prop, prop if binding in alias_map else binding)
            for prop, binding in pairs
        ]
        rebuilt = _format_react_destructure(canonical_pairs)
        edits.append((span[0], span[1], rebuilt))

    if not edits:
        return source
    out = buf
    for start, end, replacement in sorted(edits, reverse=True):
        out = out[:start] + replacement.encode("utf-8") + out[end:]
    return out.decode("utf-8")


def _collect_export_insert_offsets(root: Node, buf: bytes) -> list[int]:
    """Return byte offsets where ``export `` should be inserted.

    Walks top-level declarations and records the start_byte of every
    `function_declaration`, `class_declaration`, and
    `lexical_declaration` that's NOT already wrapped in an
    `export_statement`. Skips React-destructures (`const { useState }
    = React;`) — those don't need to be exported because they're
    locally-aliased React API and any sibling that needs `useState`
    can destructure React itself.
    """
    offsets: list[int] = []
    for stmt in root.children:
        if stmt.type == "export_statement":
            continue  # already exported
        if stmt.type in ("function_declaration", "class_declaration"):
            offsets.append(stmt.start_byte)
            continue
        if stmt.type in ("lexical_declaration", "variable_declaration"):
            # Skip React-destructures.
            if _is_react_destructure(stmt, buf):
                continue
            offsets.append(stmt.start_byte)
    return offsets


def _is_react_destructure(stmt: Node, buf: bytes) -> bool:
    """`const { ... } = React;` returns True; everything else False."""
    for declarator in stmt.children:
        if declarator.type != "variable_declarator":
            continue
        value_node = declarator.child_by_field_name("value")
        if value_node is None:
            continue
        if value_node.type == "identifier" and node_text(value_node, buf) == "React":
            return True
    return False


def _insert_export_keywords(
    body_text: str,
    original_source: str,
    spans_stripped: list[tuple[int, int]],
    insert_offsets_in_original: list[int],
) -> str:
    """Insert ``export `` at each offset (translated through the splice).

    `body_text` is the result of stripping `spans_stripped` from
    `original_source`. The insert offsets are in the ORIGINAL source's
    byte coordinates; we translate each through the splice (subtract
    the cumulative bytes of stripped spans before that offset).

    Insert position matters: we want the `export` to land BEFORE the
    declaration, i.e. before the original byte-offset's translated
    position.
    """
    # Sort + merge stripped spans so we can compute "bytes removed
    # before offset X" with a linear scan.
    merged: list[tuple[int, int]] = sorted(spans_stripped)
    body_buf = body_text.encode("utf-8")
    out_parts: list[bytes] = []
    last_translated = 0
    for orig_offset in sorted(set(insert_offsets_in_original)):
        # How many bytes of the original were removed BEFORE this offset?
        removed_bytes = 0
        skipped = False
        for s, e in merged:
            if e <= orig_offset:
                removed_bytes += e - s
            elif s < orig_offset < e:
                # Offset falls inside a stripped span — skip the insert.
                skipped = True
                break
            else:
                break
        if skipped:
            continue
        translated = orig_offset - removed_bytes
        # Clip — defensive in case of edge cases at file boundaries.
        if translated < last_translated or translated > len(body_buf):
            continue
        out_parts.append(body_buf[last_translated:translated])
        out_parts.append(b"export ")
        last_translated = translated
    out_parts.append(body_buf[last_translated:])
    return b"".join(out_parts).decode("utf-8")


def _assemble_entry_module(
    *,
    prelude: str,
    body_text: str,
    wrapper_component_name: str,
    root_name: str,
) -> str:
    """Assemble the entry module's TSX: prelude + body + wrapper + default export."""
    return (
        prelude
        + "\n\n"
        + body_text
        + "\n\n\n"
        + f"function {wrapper_component_name}() {{\n"
        f"  return (\n"
        f"    <LightDOMContainer>\n"
        f"      <{root_name} />\n"
        f"    </LightDOMContainer>\n"
        f"  );\n"
        f"}}\n"
        f"\n"
        f"export default {wrapper_component_name};\n"
    )


def _assemble_supporting_module(*, prelude: str, body_text: str) -> str:
    """Assemble a supporting module's TSX: prelude + body. No default
    export — siblings consume named exports."""
    return prelude + "\n\n" + body_text + "\n"
