"""Component validation pipeline.

Per-component (runs inline at component save time, in
``validate_and_save_tsx_component_artifact``):

1. Syntax (esbuild) — valid JSX/JS?
2. Semantic (AST rule engine + residual regex + auto-fix) — SDK imports,
   forbidden APIs, backend refs, hooks, JSX shape, a11y, null safety.
3. Style coverage (per-component) — does each className resolve to a theme
   token or a built-in Tailwind utility?

Cross-component (runs once at workflow end):

4. Final Tailwind compile gate — single ``tailwindcss`` invocation against
   theme.css + every component, with deterministic CSS-recovery fixers.
   No LLM, no retries (see ``final_compile_gate``).
"""

from .exceptions import CssCompilationError, SemanticValidationError, SyntaxValidationError
from .final_compile_gate import CompileResult, run_final_compile_gate
from .fixers import apply_auto_fixes
from .semantic_validator import run_semantic_checks
from .style_coverage import validate_style_coverage
from .syntax_validator import validate_tsx_syntax

__all__ = [
    "CompileResult",
    "run_final_compile_gate",
    "SyntaxValidationError",
    "SemanticValidationError",
    "CssCompilationError",
    "validate_tsx_syntax",
    "run_semantic_checks",
    "apply_auto_fixes",
    "validate_style_coverage",
]
