"""``component.imports.missing_sdk_export`` — JSX tag → import completeness.

If a component references ``<DialogDescription>`` in JSX but forgets to
add it to the ``@exepad/sdk`` import list, the generated code crashes at
runtime with ``ReferenceError: DialogDescription is not defined``. This
rule walks the JSX tree, collects every PascalCase tag name, and
cross-references against (a) the names declared in the existing SDK
import and (b) the SDK export catalog. A tag that is a *known SDK symbol*
but not imported is flagged.

Locally-defined components (not in the SDK export catalog) are ignored.
Components that use a dotted tag (``Icons.Menu``) are ignored here — the
outer identifier is checked, so ``Icons`` would be the catch, and that
case is covered by ``component.refs.unknown_icon`` for the Icons helper.
"""

from __future__ import annotations

from typing import Iterator

from ..catalog import load_sdk_exports
from ..walker import find_by_type, string_literal_value
from .base import AstContext, Finding


class SdkImportCompletenessRule:
    """Flag JSX PascalCase tags that refer to an SDK symbol not in the import."""

    id = "component.imports.missing_sdk_export"
    severity = "error"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        sdk_exports = load_sdk_exports()
        if not sdk_exports:
            return

        buf = ctx.source_buf
        imported = _sdk_import_names(ctx.tree.root_node, buf)
        # If the component does not import from ``@exepad/sdk`` at all we
        # stay silent — a separate rule (``handler.imports.non_sdk``) will
        # already have flagged the broken import surface.
        if not imported and not _has_sdk_import(ctx.tree.root_node, buf):
            return

        seen: set[str] = set()
        for el in _iter_opening(ctx.tree.root_node):
            name = _jsx_root_identifier(el, buf)
            if not name or not name[0].isupper():
                continue
            if name in imported or name not in sdk_exports or name in seen:
                continue
            seen.add(name)
            yield Finding(
                rule_id=self.id,
                severity="error",
                message=(
                    f"SDK component <{name}> used in JSX but not imported — "
                    f"add '{name}' to the @exepad/sdk import"
                ),
                line=el.start_point[0] + 1,
                col=el.start_point[1],
            )


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------


def _iter_opening(root):
    yield from find_by_type(root, "jsx_opening_element")
    yield from find_by_type(root, "jsx_self_closing_element")


def _jsx_root_identifier(element, buf: bytes) -> str:
    """Return the outermost identifier of a JSX tag name.

    For ``<Foo>`` returns ``"Foo"``. For ``<Foo.Bar>`` returns ``"Foo"``.
    Lowercase HTML tags are returned as-is (they won't start with an
    upper-case letter so callers can filter them out).
    """
    name_node = element.child_by_field_name("name")
    if name_node is None:
        for child in element.children:
            if child.type in ("identifier", "nested_identifier", "member_expression"):
                name_node = child
                break
    if name_node is None:
        return ""
    if name_node.type == "identifier":
        return buf[name_node.start_byte : name_node.end_byte].decode("utf-8")
    # ``member_expression`` / ``nested_identifier`` — take the leftmost atom.
    cursor = name_node
    while True:
        obj = cursor.child_by_field_name("object")
        if obj is None:
            break
        cursor = obj
    if cursor.type == "identifier":
        return buf[cursor.start_byte : cursor.end_byte].decode("utf-8")
    # Fall-back: take the first named child's text.
    if cursor.named_child_count:
        first = cursor.named_children[0]
        return buf[first.start_byte : first.end_byte].decode("utf-8")
    return ""


def _is_sdk_source(source: str | None) -> bool:
    """True for the bare ``@exepad/sdk`` barrel OR any subpath entry.

    The ``component_sdk_subpaths`` auto-fixer rewrites the bare barrel into
    ``@exepad/sdk/core``, ``@exepad/sdk/charts``, … imports. The import
    completeness rules must treat all of them as "the SDK" so a name imported
    via ``/core`` still counts as imported (and a missing one is still flagged).
    """
    if source is None:
        return False
    return source == "@exepad/sdk" or source.startswith("@exepad/sdk/")


def _has_sdk_import(root, buf: bytes) -> bool:
    for imp in find_by_type(root, "import_statement"):
        source = imp.child_by_field_name("source")
        if source is None:
            continue
        if _is_sdk_source(string_literal_value(source, buf)):
            return True
    return False


def _sdk_import_names(root, buf: bytes) -> set[str]:
    """Collect every named import from ``@exepad/sdk`` (barrel or subpath)."""
    names: set[str] = set()
    for imp in find_by_type(root, "import_statement"):
        source = imp.child_by_field_name("source")
        if source is None:
            continue
        if not _is_sdk_source(string_literal_value(source, buf)):
            continue
        for clause in imp.children:
            if clause.type == "import_clause":
                _collect_from_clause(clause, buf, names)
    return names


def _collect_from_clause(clause, buf: bytes, out: set[str]) -> None:
    for child in clause.children:
        if child.type == "named_imports":
            for spec in child.children:
                if spec.type == "import_specifier":
                    # ``{ Foo as Bar }`` → the local binding is ``Bar``.
                    alias = spec.child_by_field_name("alias")
                    name_node = alias or spec.child_by_field_name("name")
                    if name_node is None and spec.named_child_count:
                        name_node = spec.named_children[-1]
                    if name_node is not None:
                        out.add(buf[name_node.start_byte : name_node.end_byte].decode("utf-8"))
        elif child.type == "identifier":
            # Default import binding.
            out.add(buf[child.start_byte : child.end_byte].decode("utf-8"))
        elif child.type == "namespace_import":
            # ``* as sdk`` — treat the namespace binding as importing every symbol.
            # We can't know which symbols the user references via ``sdk.X`` from
            # inside JSX (that would be ``<sdk.X>``, a member-expression tag,
            # which ``_jsx_root_identifier`` already skips). Skipping the
            # namespace binding itself is fine.
            pass
