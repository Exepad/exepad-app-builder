"""Shared validation primitives — ``Finding``, ``Severity``, ``run_rules``.

Every rule engine in this package (``tsx_ast`` for TSX, ``css_ast`` for
CSS) yields ``Finding`` objects. The runner ``run_rules`` isolates rule
crashes so one broken rule cannot fail the whole validation pass, and
sorts findings by (severity, line, col) so the truncation in
``artifact_tools._format_errors`` surfaces the most actionable messages
first.

Callers can run different rule kinds against different context types —
``run_rules`` is duck-typed against any ``ctx`` a rule knows how to
read. Rule protocols are defined next to the rule engines that consume
them (``tsx_ast.rules.base.Rule``, ``css_ast.rules.base.CssRule``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Literal, Protocol

Severity = Literal["error", "warning", "info"]

_SEVERITY_RANK: dict[str, int] = {"error": 0, "warning": 1, "info": 2}


@dataclass(frozen=True)
class Finding:
    """One issue reported by a rule."""

    rule_id: str
    severity: Severity
    message: str
    line: int  # 1-based
    col: int  # 0-based
    fix_hint: str | None = None

    def formatted_message(self) -> str:
        """Render for the tool-return error string with a trailing position."""
        return f"{self.message} ({self.rule_id} at line {self.line}:{self.col})"


class _RuleLike(Protocol):
    id: str

    def check(self, ctx: Any) -> Iterable[Finding]: ...


def run_rules(ctx: Any, rules: list[_RuleLike]) -> list[Finding]:
    """Run every rule over the context and return a sorted finding list.

    Findings are sorted by (severity rank, line, col). Errors outrank
    warnings outrank infos. A rule that raises is converted into a
    single warning with ``rule_id="{rule.id}.crash"`` — this keeps one
    bad rule from torpedoing the whole pass.
    """
    collected: list[Finding] = []
    for rule in rules:
        try:
            collected.extend(rule.check(ctx))
        except Exception as exc:  # pragma: no cover — rules must not crash the gate
            collected.append(
                Finding(
                    rule_id=f"{rule.id}.crash",
                    severity="warning",
                    message=f"Rule crashed: {type(exc).__name__}: {exc}",
                    line=1,
                    col=0,
                )
            )

    collected.sort(key=lambda f: (_SEVERITY_RANK.get(f.severity, 99), f.line, f.col))
    return collected
