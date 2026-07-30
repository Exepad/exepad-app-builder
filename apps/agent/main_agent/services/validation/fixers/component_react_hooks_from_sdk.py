"""``component_react_hooks_from_sdk`` — React hooks belong to React, not the SDK.

The bug this fixes
------------------

The LLM frequently writes::

    import { useState, useEffect, Button } from "@exepad/sdk";
    const [x, setX] = useState(0);
    useEffect(() => { ... }, []);

But ``@exepad/sdk`` exports the ``React`` NAMESPACE, not the bare hooks — so
``useState`` / ``useEffect`` / ``useMemo`` / … are not exported members. tsc
fails (``'@exepad/sdk' has no exported member 'useState'``) and at runtime the
module load throws ``SyntaxError: … does not provide an export named
'useState'`` — crashing the whole component. Observed live: a build wedged on
``ExpensesContent`` retrying this exact mistake (it imported
``useState``/``useEffect``/``useMemo`` from the SDK).

The fix
-------

Rewrite to the canonical form (the same shape the skills document)::

    import { Button, React } from "@exepad/sdk";
    const [x, setX] = React.useState(0);
    React.useEffect(() => { ... }, []);

For every ``@exepad/sdk[/subpath]`` import: drop the React-hook specifiers,
ensure ``React`` is imported there, then prefix bare hook usages with
``React.``. Runs BEFORE the ``imports`` pass so the resulting ``React.`` usage
is reconciled by the import logic and no stale bare-hook import survives.

Scope
-----

Only the React-OWNED hook names are touched. The SDK's own hooks
(``useModel`` / ``useHandler`` / ``useApp`` / ``useCurrentUser`` /
``useNavigation`` / ``useForm`` / ``useTheme`` / ``useFileUpload`` /
``useFileUrl`` …) are real SDK exports and are never in this set, so they pass
through untouched. Member accesses (``foo.useState``) and object keys are left
alone — only bare ``identifier`` references outside the import are prefixed.
Per-fixer rollback reverts the whole splice if it ever yields unparseable JSX.
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import walk

# React-owned hooks the LLM mis-imports from the SDK. Deliberately excludes
# every SDK hook (useModel/useHandler/useApp/…), so this set never overlaps the
# SDK's real export surface.
_REACT_HOOKS = frozenset(
    {
        "useState",
        "useEffect",
        "useMemo",
        "useRef",
        "useCallback",
        "useContext",
        "useReducer",
        "useLayoutEffect",
        "useImperativeHandle",
        "useId",
        "useTransition",
        "useDeferredValue",
        "useSyncExternalStore",
        "useInsertionEffect",
        "useDebugValue",
    }
)

# `import { ... } from "@exepad/sdk"` or a subpath (`@exepad/sdk/core`, etc.).
_SDK_IMPORT_RE = re.compile(
    r"import\s*\{([^}]*)\}\s*from\s*(['\"])(@exepad/sdk(?:/[a-zA-Z0-9_-]+)?)\2\s*;?"
)


def apply_component_react_hooks_from_sdk_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    # Fast pre-screen: need an SDK import AND at least one React-hook name.
    if "@exepad/sdk" not in tsx:
        return tsx
    if not any(h in tsx for h in _REACT_HOOKS):
        return tsx

    # ── Rewrite the import lines: drop hook specifiers, ensure React. ──
    removed: set[str] = set()
    import_spans: list[tuple[int, int]] = []
    edits: list[tuple[int, int, str]] = []

    for m in _SDK_IMPORT_RE.finditer(tsx):
        import_spans.append((m.start(), m.end()))
        raw_specs = [s.strip() for s in m.group(1).split(",")]
        specs = [s for s in raw_specs if s]
        # A hook specifier is a bare name (no `as` alias) that is a React hook.
        hook_specs = [s for s in specs if s in _REACT_HOOKS]
        if not hook_specs:
            continue
        for s in hook_specs:
            removed.add(s)
        kept = [s for s in specs if s not in _REACT_HOOKS]
        if "React" not in kept:
            kept.append("React")
        module = m.group(3)
        quote = m.group(2)
        new_import = f"import {{ {', '.join(kept)} }} from {quote}{module}{quote};"
        edits.append((m.start(), m.end(), new_import))

    if not removed:
        return tsx

    # ── Prefix bare hook usages with `React.` (skip imports + member access). ──
    def _in_import(pos: int) -> bool:
        return any(lo <= pos < hi for lo, hi in import_spans)

    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx
    buf = source_bytes(tsx)

    for node in walk(tree.root_node):
        if node.type != "identifier":
            continue
        name = buf[node.start_byte : node.end_byte].decode("utf-8", errors="replace")
        if name not in removed:
            continue
        if _in_import(node.start_byte):
            continue
        parent = node.parent
        # Skip `foo.useState` (the hook as a member property, not a free ref).
        if parent is not None and parent.type == "member_expression":
            prop = parent.child_by_field_name("property")
            if prop is not None and prop.start_byte == node.start_byte:
                continue
        edits.append((node.start_byte, node.start_byte, "React."))

    if not edits:
        return tsx

    out = buf
    for start, end, replacement in sorted(edits, key=lambda e: -e[0]):
        out = out[:start] + replacement.encode("utf-8") + out[end:]

    fixes_applied.append(
        "Moved React hook(s) off @exepad/sdk to the React namespace: "
        + ", ".join(sorted(removed))
    )
    return out.decode("utf-8")
