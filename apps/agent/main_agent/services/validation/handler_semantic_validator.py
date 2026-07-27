"""Handler semantic validation orchestrator.

The actual validation logic lives under
``main_agent.services.validation.tsx_ast`` — every check is an AST rule
in ``tsx_ast/rules``. This module keeps the glue that sits at the
boundary between the rule framework and the handler build pipeline:

- ``run_handler_semantic_checks`` — parses handler TSX once and runs the
  default rule set, returning a ``SemanticResult`` the handler builder's
  save tool can feed back to the LLM.

The deterministic import-rewrite pass ``apply_handler_auto_fixes`` lives
in :mod:`main_agent.services.validation.fixers.handler_dispatcher` and is
re-exported from :mod:`main_agent.services.validation.fixers`.
"""

from __future__ import annotations

import structlog

from main_agent.services.validation.semantic_validator import SemanticResult

from .tsx_ast import AstContext, parse_tsx, run_rules, source_bytes
from .tsx_ast.rules.default_set import handler_rules
from .tsx_ast.rules.sql_model_references import SqlUndeclaredTableRule

logger = structlog.get_logger(__name__)


def run_handler_semantic_checks(
    tsx: str,
    models: list[dict] | None = None,
    expected_outputs: list[dict] | None = None,
) -> SemanticResult:
    """Run all handler-relevant semantic checks via the AST rule framework.

    Parses the handler TSX once with tree-sitter and runs the default rule
    set from ``tsx_ast.rules.default_set``. Errors block (trigger a retry
    in the save tool); warnings are advisory and do not trigger a retry.

    Args:
        tsx: Handler TypeScript source code
        models: Backend model definitions for SQL table-reference validation.
            When ``None``, the table-reference rule is skipped — the opt-out
            is used by callers that don't have the session model list handy.
        expected_outputs: ``[{name, type}, ...]`` list from ``handler_plan.outputs``.
            Fed into ``AstContext.handler_plan`` so rules like
            ``HandlerHardcodedReturnLiteralRule`` can tell which keys are
            supposed to carry computed numeric values.

    Returns:
        ``SemanticResult`` with errors (blocking) and warnings (advisory).
    """
    result = SemanticResult()

    try:
        tree = parse_tsx(tsx)
    except Exception as exc:
        result.errors.append(f"Handler TSX failed to parse: {type(exc).__name__}: {exc}")
        return result

    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        models=models or [],  # type: ignore[arg-type]
        handler_plan={"expected_outputs": expected_outputs} if expected_outputs else None,
    )

    rules = handler_rules()
    if models is None:
        rules = [r for r in rules if not isinstance(r, SqlUndeclaredTableRule)]

    findings = run_rules(ctx, rules)

    for f in findings:
        bucket = result.errors if f.severity == "error" else result.warnings
        bucket.append(f.formatted_message())

    if result.errors or result.warnings:
        logger.info(
            "Handler semantic check results",
            errors=result.errors,
            warnings=[w[:80] for w in result.warnings],
        )

    return result
