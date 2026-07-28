"""Deterministic rewrites applied to component TSX before validation.

The auto-fix pass runs BEFORE ``run_semantic_checks`` so the LLM never
sees warnings about patterns the fixer already corrected (bad imports,
icon typos, null-safety, M3 token mismatches, etc.).

Public entry points:

- ``apply_auto_fixes`` — main rewrite pass invoked by the Code Focus
  component save tool.
- ``apply_handler_auto_fixes`` — narrower pass for handler TSX (only
  the import-rewrite subset applies).
- ``rewrite_useapp_destructures`` — AST-based ``useApp`` destructure
  rewriter consumed by :func:`apply_auto_fixes`.

The fix bodies live in per-category modules under this package
(``component_imports``, ``component_urls_images``, ``component_m3_colors``,
``component_null_safety``, ``component_typos``, ``component_a11y_ux``,
``component_polishing``). The two dispatchers orchestrate them in a
fixed order.
"""

from __future__ import annotations

from main_agent.services.validation.fixers.dispatcher import apply_auto_fixes
from main_agent.services.validation.fixers.handler_dispatcher import (
    apply_handler_auto_fixes,
)
from main_agent.services.validation.fixers.handler_enum_case import (
    apply_handler_enum_case_fixes,
)
from main_agent.services.validation.fixers.handler_sql_fk_column import (
    apply_handler_fk_column_fixes,
)
from main_agent.services.validation.fixers.useapp_destructure import (
    rewrite_useapp_destructures,
)

__all__ = [
    "apply_auto_fixes",
    "apply_handler_auto_fixes",
    "apply_handler_enum_case_fixes",
    "apply_handler_fk_column_fixes",
    "rewrite_useapp_destructures",
]
