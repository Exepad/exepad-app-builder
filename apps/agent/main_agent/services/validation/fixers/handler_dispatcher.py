"""Handler-TSX auto-fix dispatcher.

Handlers don't run the full component rewrite pass — they only need
import-source rewrites (react / framer-motion / lucide-react →
``@exepad/sdk``) and stripping of hallucinated ``import { X } from "X"``
statements where ``X`` is a declared model name.
"""

from __future__ import annotations

import re


def apply_handler_auto_fixes(
    tsx: str, model_names: list[str] | None = None
) -> tuple[str, list[str]]:
    """Apply deterministic import rewrites to handler TSX.

    Rewrites common mis-imports (``react``, ``framer-motion``, ``lucide-react``
    → ``@exepad/sdk``) and strips hallucinated ``import { X } from "X"``
    statements where ``X`` is a declared model name. This runs BEFORE
    semantic validation so the LLM's self-correction loop is not retried
    for issues the auto-fixer already resolved.

    Args:
        tsx: Handler TypeScript source code
        model_names: Known model/table names from backend config. Imports
            whose source string matches one of these is stripped entirely.

    Returns:
        ``(fixed_tsx, list_of_fixes_applied)``.
    """
    fixes_applied: list[str] = []

    if model_names:
        lower_names = {n.lower() for n in model_names}
        cleaned_lines = []
        for line in tsx.split("\n"):
            match = re.match(r"^\s*import\s+.*\s+from\s+['\"]([^'\"]+)['\"]", line)
            if match and match.group(1).lower() in lower_names:
                fixes_applied.append(f"Stripped model-name import: '{match.group(1)}'")
                continue
            cleaned_lines.append(line)
        tsx = "\n".join(cleaned_lines)

    if "from 'react'" in tsx or 'from "react"' in tsx:
        tsx = re.sub(
            r"import\s+\{([^}]+)\}\s+from\s+['\"]react['\"]",
            r"import {\1} from '@exepad/sdk'",
            tsx,
        )
        tsx = re.sub(
            r"import\s+React\s+from\s+['\"]react['\"]",
            "import { React } from '@exepad/sdk'",
            tsx,
        )
        fixes_applied.append("Rewrote react imports → @exepad/sdk")

    for pkg in ("framer-motion", "lucide-react"):
        if f"'{pkg}'" in tsx or f'"{pkg}"' in tsx:
            tsx = tsx.replace(f"'{pkg}'", "'@exepad/sdk'")
            tsx = tsx.replace(f'"{pkg}"', '"@exepad/sdk"')
            fixes_applied.append(f"Rewrote {pkg} → @exepad/sdk")

    return tsx, fixes_applied
