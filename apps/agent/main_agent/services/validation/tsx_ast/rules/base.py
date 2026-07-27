"""Rule framework foundations — ``Finding``, ``Rule``, ``AstContext``.

Every AST rule is a small class or callable that reads an ``AstContext`` and
yields zero or more ``Finding`` objects. The rule runner collects them,
sorts by (severity, line), and converts them into the ``SemanticResult``
shape the existing ``validate_and_save_handler_artifact`` tool already
understands — so the feedback loop to the LLM (tool return value → next
agent turn) is preserved unchanged.

``Finding``, ``Severity``, and ``run_rules`` live in
``services.validation.finding`` so the CSS rule engine can share them;
this module re-exports them for the existing tsx-only import sites.

See docs/…/unified-sparking-twilight.md for the full design.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Protocol

from tree_sitter import Tree

from ...finding import Finding, Severity, run_rules

__all__ = [
    "Finding",
    "Severity",
    "run_rules",
    "AstContext",
    "Rule",
]


@dataclass
class AstContext:
    """Everything a tsx rule needs to do its work.

    Rules must treat every field as read-only. Mutating ``models``, the
    tree, or the handler plan will break rules that run later in the
    same pass.

    The same context type serves both handler and component rules —
    handler-only fields (``handler_plan``) and component-only fields
    (``logic``, ``handlers``, ``page_slugs``, ``theme_palette``) default
    to ``None``. Rules that depend on a given field early-return when it
    is absent, matching the pattern used by ``ReturnMissingFieldRule``.
    """

    tsx: str
    source_buf: bytes
    tree: Tree
    # Shared between handler and component rules (backend model catalogue).
    models: list[dict[str, Any]] = field(default_factory=list)
    # Handler-only — ``{expected_outputs: [{name, type}, ...]}``.
    handler_plan: dict[str, Any] | None = None
    # Component-only fields.
    logic: dict[str, Any] | None = None  # ``{state: {...}, actions: {...}}``
    handlers: list[dict[str, Any]] | None = None  # ``[{name, outputs}, ...]``
    # Optional: TSX source of every handler in the app, keyed by handler name.
    # Populated when the validation context can reach durable source (post
    # source-rehydration in EditingWorkflow). Rules that need handler bodies
    # to cross-check producer/consumer contracts (e.g. chart dataKey vs
    # handler return shape) read from here. Absent → rule fails open.
    handler_sources: dict[str, str] | None = None
    page_slugs: list[str] | None = None
    theme_palette: dict[str, str] | None = None  # hex-keyed color map
    expected_export_name: str | None = None  # component file's declared name


class Rule(Protocol):
    """A rule is anything with an ``id``, a default ``severity``, and a
    ``check(ctx) -> Iterator[Finding]`` method."""

    id: str
    severity: Severity

    def check(self, ctx: AstContext) -> Iterable[Finding]: ...
