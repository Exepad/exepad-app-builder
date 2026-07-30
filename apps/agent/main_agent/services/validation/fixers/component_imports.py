"""Import / export rewrites for component TSX auto-fix.

Covers:
- Export default function rename to the expected component name.
- ``react`` / ``framer-motion`` / ``lucide-react`` imports rewritten to
  ``@exepad/sdk`` (with default-React handling).
- SDK export injection: any used SDK name that isn't imported gets added
  to the ``@exepad/sdk`` import statement.
- Legacy regex fallbacks for inline-object and bare ``useApp()``
  destructures (the AST rewrite in ``useapp_destructure`` runs first).
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.useapp_destructure import (
    rewrite_useapp_destructures,
)
from main_agent.services.validation.semantic_validator import _SDK_EXPORTS


def apply_component_imports_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    # Export name auto-rename (fixes wrong function name when content is correct)
    if ctx.expected_component_name:
        export_match = re.search(r"(export\s+default\s+function\s+)(\w+)", tsx)
        if export_match and export_match.group(2) != ctx.expected_component_name:
            tsx = tsx.replace(
                export_match.group(0),
                f"{export_match.group(1)}{ctx.expected_component_name}",
                1,
            )
            fixes_applied.append(
                f"Renamed export '{export_match.group(2)}' → '{ctx.expected_component_name}'"
            )

    # Import rewrites (safe — these are full import statements)
    if "from 'react'" in tsx or 'from "react"' in tsx:
        has_default_react = bool(re.search(r"import\s+React\s+from\s+['\"]react['\"]", tsx))
        has_named_react = bool(re.search(r"import\s+\{[^}]+\}\s+from\s+['\"]react['\"]", tsx))

        # Rewrite default import: import React from 'react' → import { React } from '@exepad/sdk'
        tsx = re.sub(
            r"import\s+React\s+from\s+['\"]react['\"]",
            "import { React } from '@exepad/sdk'",
            tsx,
        )

        # Rewrite named imports: import { useState } from 'react' → const { useState } = React
        # If there was no default import, we need to add the SDK import first
        if has_named_react and not has_default_react:
            tsx = re.sub(
                r"import\s+\{([^}]+)\}\s+from\s+['\"]react['\"]",
                lambda m: (
                    f"import {{ React }} from '@exepad/sdk';\n" f"const {{{m.group(1)}}} = React"
                ),
                tsx,
                count=1,  # Only add the import once for the first match
            )
            # Remaining named imports just become destructuring
            tsx = re.sub(
                r"import\s+\{([^}]+)\}\s+from\s+['\"]react['\"]",
                lambda m: f"const {{{m.group(1)}}} = React",
                tsx,
            )
        else:
            tsx = re.sub(
                r"import\s+\{([^}]+)\}\s+from\s+['\"]react['\"]",
                lambda m: f"const {{{m.group(1)}}} = React",
                tsx,
            )
        fixes_applied.append("Rewrote react imports → @exepad/sdk")

    if "'framer-motion'" in tsx or '"framer-motion"' in tsx:
        tsx = tsx.replace("'framer-motion'", "'@exepad/sdk'")
        tsx = tsx.replace('"framer-motion"', '"@exepad/sdk"')
        fixes_applied.append("Rewrote framer-motion → @exepad/sdk")

    if "'lucide-react'" in tsx or '"lucide-react"' in tsx:
        tsx = tsx.replace("'lucide-react'", "'@exepad/sdk'")
        tsx = tsx.replace('"lucide-react"', '"@exepad/sdk"')
        fixes_applied.append("Rewrote lucide-react → @exepad/sdk")

    # Ensure SDK exports used in code are actually imported.
    # The LLM sometimes uses a function (e.g., useNavigation()) without
    # importing it, which crashes at runtime with a ReferenceError and the
    # ErrorBoundary hides the whole component. The fixer below adds any
    # used-but-unimported SDK identifier from this list.
    SDK_EXPORTS = [
        "useNavigation",
        "navigate",
        "useModel",
        "useHandler",
        "useTheme",
        "useCurrentUser",
        "useApp",
        "useFileUpload",
        "useFileUrl",
        "LightDOMContainer",
        "Icons",
        "Charts",
        "Motion",
        "motion",
        "toast",
        "useForm",
        "Controller",
        "z",
        "format",
    ]
    sdk_import_match = re.search(r"import\s+\{([^}]+)\}\s+from\s+['\"]@exepad/sdk['\"]", tsx)
    if sdk_import_match:
        imported_names = {n.strip() for n in sdk_import_match.group(1).split(",") if n.strip()}

        # ── Symmetric check: strip imports the SDK doesn't actually export.
        # The LLM (or a stale prompt) sometimes imports identifiers the SDK
        # never provides, e.g. ``Link`` (before it was shipped) or a misspelled
        # hook. At module load the runtime throws:
        #   SyntaxError: The requested module '@exepad/sdk' does not provide
        #   an export named 'X'
        # which crashes the entire component. `_SDK_EXPORTS` is the catalog
        # regenerated by ``packages/exepad-sdk/scripts/generate-agent-docs.ts``
        # at every SDK build, so it is the authoritative allow-list.
        unknown_imports: list[str] = []
        if _SDK_EXPORTS:
            for name in list(imported_names):
                if name not in _SDK_EXPORTS:
                    unknown_imports.append(name)
            for name in unknown_imports:
                imported_names.discard(name)

        missing = []
        for export_name in SDK_EXPORTS:
            if export_name in imported_names:
                continue
            # Check if it's used in the code (as a function call or JSX tag)
            usage_pattern = rf"\b{re.escape(export_name)}\s*[(<.]"
            if re.search(usage_pattern, tsx):
                missing.append(export_name)
        # Also check for PascalCase JSX elements that are SDK exports but not imported
        if _SDK_EXPORTS:
            jsx_usages = set(re.findall(r"</?([A-Z][A-Za-z0-9]+)", tsx))
            for jsx_name in jsx_usages:
                if jsx_name in imported_names or jsx_name in missing:
                    continue
                if jsx_name not in _SDK_EXPORTS:
                    continue
                missing.append(jsx_name)

        needs_rewrite = bool(missing) or bool(unknown_imports)
        if needs_rewrite:
            new_imports = ", ".join(sorted(imported_names | set(missing)))
            tsx = (
                tsx[: sdk_import_match.start()]
                + (f"import {{ {new_imports} }} from '@exepad/sdk'")
                + tsx[sdk_import_match.end() :]
            )
            if missing:
                fixes_applied.append(f"Added missing SDK imports: {', '.join(missing)}")
            if unknown_imports:
                fixes_applied.append(
                    "Stripped unknown @exepad/sdk imports: " f"{', '.join(sorted(unknown_imports))}"
                )

    # ── AST-based useApp destructure rewrite ──────────────────────────
    # ``fixers.useapp_destructure`` handles both inline-object selector
    # patterns and bare ``useApp()`` destructures in one pass. It uses
    # tree-sitter to pinpoint the exact ``lexical_declaration`` to replace,
    # so multi-line destructures, trailing comments, and aliased pair
    # patterns are all handled cleanly. The regex passes below stay as
    # a fall-back for patterns the AST rewrite declines to touch (e.g.
    # computed selectors the AST deems unsafe to rewrite).
    tsx, ast_useapp_fixes = rewrite_useapp_destructures(tsx)
    fixes_applied.extend(ast_useapp_fixes)

    # Legacy regex fallbacks — kept because the AST rewrite is
    # intentionally conservative on computed selectors / nested patterns.
    useapp_obj_pattern = re.compile(
        r"const\s+\{([^}]+)\}\s*=\s*useApp\s*\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*"
        r"\(\s*\{([^}]+)\}\s*\)\s*\)\s*;?"
    )
    for m in useapp_obj_pattern.finditer(tsx):
        param = m.group(2)
        body = m.group(3)
        # Extract key: param.key pairs
        props = re.findall(rf"(\w+)\s*:\s*{re.escape(param)}\.(\w+)", body)
        if not props:
            continue
        # Verify all entries are simple direct access (no computed expressions)
        simple_entries = [entry.strip() for entry in body.split(",") if entry.strip()]
        if len(props) != len(simple_entries):
            continue  # Has computed expressions — leave for fixer agent

        replacement_lines = []
        for key, val in props:
            replacement_lines.append(f"const {key} = useApp(s => s.{val});")
        tsx = tsx[: m.start()] + "\n".join(replacement_lines) + tsx[m.end() :]
        fixes_applied.append(
            f"Rewrote useApp inline object selector → {len(props)} individual calls"
        )

    # Bare useApp() destructuring → individual selector calls.
    # Matches patterns like:
    #   const { count, setState } = useApp();
    # Rewrites to:
    #   const count = useApp(s => s.count);
    #   const setState = useApp(s => s.setState);
    bare_useapp_pattern = re.compile(r"const\s+\{([^}]+)\}\s*=\s*useApp\s*\(\s*\)\s*;?")
    for m in bare_useapp_pattern.finditer(tsx):
        names = [n.strip() for n in m.group(1).split(",") if n.strip()]
        if not names:
            continue
        replacement_lines = []
        for name in names:
            replacement_lines.append(f"const {name} = useApp(s => s.{name});")
        tsx = tsx[: m.start()] + "\n".join(replacement_lines) + tsx[m.end() :]
        fixes_applied.append(f"Rewrote bare useApp() destructuring → {len(names)} individual calls")

    return tsx
