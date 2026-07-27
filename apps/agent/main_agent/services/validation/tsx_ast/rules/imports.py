"""``handler.imports.non_sdk`` — restrict import sources to the SDK.

Walks ``import_statement`` nodes and flags any source string that is not
``@exepad/sdk`` (or a relative / absolute path). The prefix allow-list lives
in ``tsx_ast.catalog`` so both handler and component rule sets read the same
frozenset.

Components may additionally import a vetted set of runtime extension
packages (e.g. ``@exepad/ext-three``) — passed per-rule-set as
``allowed_exact`` so the allowance is scoped to ``component_rules()`` and
never leaks into handler TSX. Extensions are matched EXACTLY (no subpaths):
the esm.sh extension builds ship the core only, so ``@exepad/ext-three/...``
would not resolve at runtime and must still be rejected.
"""

from __future__ import annotations

from typing import Iterator

from ..catalog import ALLOWED_IMPORT_SOURCES
from ..walker import find_by_type, string_literal_value
from .base import AstContext, Finding


class ImportsNonSdkRule:
    """Flag imports from packages outside the SDK allow-list.

    Args:
        allowed_exact: Additional import specifiers permitted via EXACT
            string match (no prefix/subpath allowance). Used by
            ``component_rules()`` to admit vetted extension packages
            (``ALLOWED_EXTENSION_IMPORTS``) that handlers must not import.
            Defaults to empty → SDK-only behaviour (handler parity).
    """

    id = "handler.imports.non_sdk"
    severity = "error"

    def __init__(self, allowed_exact: frozenset[str] | None = None) -> None:
        self._allowed_exact = allowed_exact or frozenset()

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        root = ctx.tree.root_node
        buf = ctx.source_buf
        seen: set[str] = set()

        for imp in find_by_type(root, "import_statement"):
            # The import source is the ``string`` child of ``import_statement``
            # with field name ``source`` in most tree-sitter TS grammars;
            # defensively fall back to the last ``string`` descendant.
            source_node = imp.child_by_field_name("source")
            if source_node is None:
                for child in imp.children:
                    if child.type == "string":
                        source_node = child
                if source_node is None:
                    continue

            source = string_literal_value(source_node, buf)
            if source is None:
                continue

            # Relative or absolute paths are fine.
            if source.startswith(".") or source.startswith("/"):
                continue
            # Vetted extension packages — EXACT match only (no subpaths).
            if source in self._allowed_exact:
                continue
            if any(source.startswith(prefix) for prefix in ALLOWED_IMPORT_SOURCES):
                continue

            if source in seen:
                continue
            seen.add(source)

            yield Finding(
                rule_id=self.id,
                severity="error",
                message=f"Forbidden import: '{source}'",
                line=imp.start_point[0] + 1,
                col=imp.start_point[1],
            )
