"""tinycss2-backed CSS rule framework.

Mirrors ``tsx_ast``: a single parse produces a stylesheet node list
shared across rules via ``CssContext``; rules are small classes with
``id``, ``severity``, and ``check(ctx) -> Iterator[Finding]``; the
runner ``run_rules`` (shared with ``tsx_ast``) isolates rule crashes
and sorts findings by ``(severity, line, col)``.

Used by the DesignSystemBuilder save tool to validate ``theme.css``.
"""

from .parser import parse_css
from .rules.base import CssContext, CssRule

__all__ = [
    "parse_css",
    "CssContext",
    "CssRule",
]
