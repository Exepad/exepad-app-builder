"""Tree-sitter based TSX AST validation layer.

Parser, walker, SQL helper, rule framework, and a default rule set that
validates handler TSX after the builder LLM writes it. Rules populate a
``SemanticResult`` that the handler save tool forwards to the builder
agent as tool-return feedback, driving the self-correction loop.

Rule catalog lives under ``tsx_ast.rules``. Every rule is a small class
with ``id``, ``severity``, and ``check(ctx) -> Iterator[Finding]``. Add
a new rule by dropping a file in ``rules/`` and appending to
``rules.default_set.default_handler_rules``.
"""

from .parser import parse_tsx, source_bytes
from .rules.base import AstContext, Finding, Rule, run_rules
from .walker import (
    collect_static_classnames,
    iter_classname_value_spans,
    rewrite_classname_text,
)

__all__ = [
    "parse_tsx",
    "source_bytes",
    "AstContext",
    "Finding",
    "Rule",
    "run_rules",
    "collect_static_classnames",
    "iter_classname_value_spans",
    "rewrite_classname_text",
]
