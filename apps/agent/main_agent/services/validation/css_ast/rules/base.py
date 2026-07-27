"""CSS rule framework foundations.

``CssContext`` carries the raw source plus the pre-parsed stylesheet
node list so every rule in a single pass shares one parse tree.
``CssRule`` is the duck-typed protocol the shared ``run_rules`` runner
expects (``id``, ``severity``, ``check(ctx) -> Iterable[Finding]``).

``Finding`` and ``run_rules`` live in ``services.validation.finding``
so the TSX and CSS engines report findings through the same surface.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Protocol

from ...finding import Finding, Severity, run_rules

__all__ = [
    "CssContext",
    "CssRule",
    "Finding",
    "Severity",
    "run_rules",
]


@dataclass
class CssContext:
    """Inputs for CSS rule evaluation.

    Rules treat every field as read-only — the tinycss2 node list is
    shared across rules in the pass, and mutating it would break later
    rules.
    """

    css: str
    stylesheet: list[Any]


class CssRule(Protocol):
    id: str
    severity: Severity

    def check(self, ctx: CssContext) -> Iterable[Finding]: ...
