"""``component.sdk.call_not_imported`` — flag bare SDK hook/function calls
that are not in the file's ``@exepad/sdk`` import statement.

The bug this catches
--------------------

A component calls a known SDK hook but the import line never declares it,
leaving::

    import { LightDOMContainer, Link, React } from '@exepad/sdk';
    function OrdersContent() {
      const { data } = useModel('orders');

At runtime the component crashes with::

    ReferenceError: useModel is not defined

…and the ErrorBoundary fallback ("This section isn't available right
now.") replaces the entire section.

Scope vs sibling rules
----------------------

This rule walks **call expressions only** — bare ``identifier(...)``
forms where the callee is a known SDK callable. PascalCase JSX
components are covered by ``SdkImportCompletenessRule`` (``tsx_ast/
rules/component_imports.py``) which walks JSX tag names. Member
expressions like ``format.currency(...)`` are covered by
``SdkFormatMethodRule``. The three rules form a complete coverage
matrix over the ways an undeclared SDK symbol can be referenced.

Watch source
------------

Loaded once at rule-construction time from ``load_sdk_exports()`` (the
catalog populated by the SDK build at ``packages/exepad-sdk/dist/
sdk-exports.json``) and filtered to *callable* identifiers — names
starting with ``use`` (hooks) OR a lowercase first letter (functions).
PascalCase symbols (``Link``, ``LightDOMContainer``, ``Icons``,
``Charts``, ``Motion``) are JSX components handled by
``SdkImportCompletenessRule`` and are intentionally NOT in this rule's
watch set. Drift-proof by construction — the catalog is regenerated on
every SDK build.

Why an AST rule on top of the existing fixer
--------------------------------------------

The auto-fixer at ``fixers/component_imports.py`` already adds missing
SDK identifiers to the import. But its hardcoded ``SDK_EXPORTS`` list
can drift from the actual SDK surface. This
rule provides a deterministic block at validation time — so even if a
future hook ships without being added to the fixer's list, the bad
TSX never sails through. The auto-fix still runs first; this rule
catches the residue.

Severity
--------

**Error.** A missing import causes a runtime ``ReferenceError`` which
renders the component as the ErrorBoundary fallback — guaranteed
user-visible breakage.
"""

from __future__ import annotations

from typing import Iterator

from ..catalog import load_sdk_exports
from ..walker import find_by_type
from .base import AstContext, Finding
from .component_imports import _sdk_import_names

_RULE_ID = "component.sdk.call_not_imported"


def _callable_sdk_exports() -> frozenset[str]:
    """SDK exports that are callable identifiers (hooks + functions).

    Filters the SDK catalog to names that are syntactically callable in
    bare form — hooks (``use*``) and lowercase-first functions
    (``navigate``, ``toast``, ``format``, ``cn``, …). Excludes:
      * PascalCase JSX components (``Link``, ``Icons``, ``Charts``,
        ``LightDOMContainer``, etc.) — those are caught by
        ``SdkImportCompletenessRule``.
      * Top-level constants (``SDK_VERSION``, ``_``) — never bare-called.

    The result is frozen for safe sharing across rule instances.
    """
    raw = load_sdk_exports()
    if not raw:
        return frozenset()
    callable_set: set[str] = set()
    for name in raw:
        if not name or not name[0].isalpha():
            continue
        # Skip ALL_CAPS constants (SDK_VERSION).
        if name.isupper():
            continue
        # Hooks start with `use`; bare functions start with lowercase.
        # PascalCase JSX components handled by SdkImportCompletenessRule.
        if name.startswith("use") or name[0].islower():
            callable_set.add(name)
    return frozenset(callable_set)


class SdkUndeclaredCallRule:
    """Flag bare SDK callable identifiers used without import."""

    id = _RULE_ID
    severity = "error"

    def __init__(self) -> None:
        self._watch = _callable_sdk_exports()

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        if not self._watch:
            return
        tree = ctx.tree
        if tree is None:
            return

        buf = ctx.source_buf
        imported = _sdk_import_names(tree.root_node, buf)

        # Emit one finding per distinct identifier — multiple call sites
        # of the same missing hook would otherwise spam the report.
        seen: set[str] = set()
        for call in find_by_type(tree.root_node, "call_expression"):
            callee = call.child_by_field_name("function")
            if callee is None or callee.type != "identifier":
                continue
            name = buf[callee.start_byte : callee.end_byte].decode("utf-8")
            if name not in self._watch:
                continue
            if name in imported:
                continue
            if name in seen:
                continue
            seen.add(name)
            line = callee.start_point[0] + 1
            col = callee.start_point[1]
            yield Finding(
                rule_id=_RULE_ID,
                severity="error",
                line=line,
                col=col,
                message=(
                    f"`{name}` is called but not imported from `@exepad/sdk`. "
                    f"At runtime this raises `ReferenceError: {name} is not "
                    f"defined` and the component renders the ErrorBoundary "
                    f"fallback (\"This section isn't available right now.\")."
                ),
                fix_hint=(
                    f"Add `{name}` to the named imports — "
                    f"`import {{ ... {name} }} from '@exepad/sdk'`. The "
                    f"`component_imports` auto-fixer will do this "
                    f"automatically on the next save if its `SDK_EXPORTS` "
                    f"list includes the identifier."
                ),
            )
