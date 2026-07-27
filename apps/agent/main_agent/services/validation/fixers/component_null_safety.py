"""Null-safety rewrites for component TSX auto-fix.

Covers:

- useApp Pattern 2 (``const X = useApp(s => s.key)``) and Pattern 3
  (``const { X } = useApp()``) — add optional chaining for every nullable
  state key.
- useModel ``data`` null guard (``data.map(`` → ``(data ?? []).map(``).
- SDK hook nullable field access (destructured fields from
  ``useCurrentUser`` etc.).
- Broken optional chain repair (``?.[N].method()`` → ``?.[N]?.method()``).
"""

from __future__ import annotations

import re

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.semantic_validator import _SDK_HOOK_NULLABLE_FIELDS


def apply_component_null_safety_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    state_keys = ctx.state_keys

    # useApp null-safety: rewrite var.prop → var?.prop for nullable state keys.
    # Covers Pattern 2 (variable assigned from useApp selector) and Pattern 3
    # (destructured from useApp()). Pattern 1 (chained .prop on useApp() call)
    # is left for the fixer agent since rewriting inline is fragile.
    nullable_keys: set[str] = set()
    if isinstance(state_keys, dict):
        for key, val in state_keys.items():
            if val is None or val == {} or val == []:
                nullable_keys.add(key)

    if nullable_keys:
        # Pattern 2: const X = useApp(s => s.nullableKey); ... X.prop → X?.prop
        for key in nullable_keys:
            assign_pat = rf"const\s+(\w+)\s*=\s*useApp\s*\(\s*\(?\s*\w+\s*\)?\s*=>\s*\w+\.{re.escape(key)}\s*\)"
            for m in re.finditer(assign_pat, tsx):
                var_name = m.group(1)
                # Replace var.X with var?.X (but not var?.X which is already safe)
                unsafe_pat = rf"\b{re.escape(var_name)}\.(?!\s)(?!\?)"
                safe_repl = f"{var_name}?."
                new_tsx = re.sub(unsafe_pat, safe_repl, tsx[m.end() :])
                if new_tsx != tsx[m.end() :]:
                    tsx = tsx[: m.end()] + new_tsx
                    fixes_applied.append(
                        f"Added optional chaining to '{var_name}' (from state.{key})"
                    )

        # Pattern 3: const { X, Y } = useApp(); ... X.prop → X?.prop
        destructure_match = re.search(r"const\s+\{([^}]+)\}\s*=\s*useApp\s*\(\s*\)", tsx)
        if destructure_match:
            destructured_names = {n.strip() for n in destructure_match.group(1).split(",")}
            for key in nullable_keys & destructured_names:
                unsafe_pat = rf"\b{re.escape(key)}\.(?!\s)(?!\?)"
                safe_repl = f"{key}?."
                after = tsx[destructure_match.end() :]
                new_after = re.sub(unsafe_pat, safe_repl, after)
                if new_after != after:
                    tsx = tsx[: destructure_match.end()] + new_after
                    fixes_applied.append(f"Added optional chaining to destructured '{key}'")

    # useModel null-safety: rewrite data.map( → (data ?? []).map( for destructured
    # useModel data variables.  useModel() returns data: T[] | null.
    alias_pat = re.compile(r"const\s+\{[^}]*\bdata(?:\s*:\s*(\w+))?\b[^}]*\}\s*=\s*useModel\s*\(")
    for m in alias_pat.finditer(tsx):
        var_name = m.group(1) or "data"
        after = tsx[m.end() :]
        # Replace var.arrayMethod( with (var ?? []).arrayMethod(
        # But not var?.method or (var ?? []).method (already safe)
        array_method_pat = re.compile(
            rf"(?<!\?\.)(?<!\]\))\b({re.escape(var_name)})"
            + r"(\.(?:map|filter|find|findIndex|forEach|reduce|some|every|"
            + r"flat|flatMap|includes|indexOf|slice|sort|concat|length)\b)"
        )

        def _wrap_null_guard(match):
            vn = match.group(1)
            method = match.group(2)
            # Check if already wrapped: (var ?? []) pattern
            pos = match.start()
            before_ctx = after[max(0, pos - 10) : pos].rstrip()
            if before_ctx.endswith("?") or before_ctx.endswith("])"):
                return match.group(0)
            fixes_applied.append(f"Added null guard: {vn}{method} → ({vn} ?? []){method}")
            return f"({vn} ?? []){method}"

        new_after = array_method_pat.sub(_wrap_null_guard, after)
        if new_after != after:
            tsx = tsx[: m.end()] + new_after

    # SDK hook nullable field safety: rewrite field.method() → field?.method()
    # for destructured nullable fields from hooks like useCurrentUser().
    for hook_name, nullable_fields in _SDK_HOOK_NULLABLE_FIELDS.items():
        if hook_name not in tsx:
            continue

        # Destructured pattern: const { email, name } = useCurrentUser()
        destr_pat = re.compile(rf"const\s+\{{([^}}]+)\}}\s*=\s*{re.escape(hook_name)}\s*\(\s*\)")
        for dm in destr_pat.finditer(tsx):
            destructured = {n.strip() for n in dm.group(1).split(",")}
            for field_name in nullable_fields & destructured:
                unsafe_pat = rf"\b{re.escape(field_name)}\.(?!\s)(?!\?)"
                safe_repl = f"{field_name}?."
                after = tsx[dm.end() :]
                new_after = re.sub(unsafe_pat, safe_repl, after)
                if new_after != after:
                    tsx = tsx[: dm.end()] + new_after
                    fixes_applied.append(
                        f"Added optional chaining to '{field_name}' (from {hook_name}())"
                    )

        # Var-bound pattern: const user = useCurrentUser(); ... user.name.method()
        # Rewrite user.<field>.X → user.<field>?.X (skip already-safe ?.)
        var_pat = re.compile(rf"const\s+(\w+)\s*=\s*{re.escape(hook_name)}\s*\(\s*\)")
        for vm in var_pat.finditer(tsx):
            var_name = vm.group(1)
            after = tsx[vm.end() :]
            for field_name in nullable_fields:
                unsafe_pat = re.compile(
                    rf"\b{re.escape(var_name)}\.{re.escape(field_name)}\.(?!\s)(?!\?)"
                )
                safe_repl = f"{var_name}.{field_name}?."
                new_after, n = unsafe_pat.subn(safe_repl, after)
                if n:
                    after = new_after
                    fixes_applied.append(
                        f"Added optional chaining to '{var_name}.{field_name}' "
                        f"(from {hook_name}())"
                    )
            tsx = tsx[: vm.end()] + after

    # Broken optional chain fix: ?.[N].method( → ?.[N]?.method(
    broken_chain_pat = re.compile(r"(\?\.\[[^\]]+\])\.(\w+\s*\()")
    new_tsx = broken_chain_pat.sub(r"\1?.\2", tsx)
    if new_tsx != tsx:
        fixes_applied.append("Fixed broken optional chain: ?.[…].method() → ?.[…]?.method()")
        tsx = new_tsx

    return tsx
