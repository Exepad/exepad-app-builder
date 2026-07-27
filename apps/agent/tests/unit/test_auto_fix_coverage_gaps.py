"""Test coverage for auto-fixers that had no direct unit tests.

Each fixer is exercised with both a ``fires`` case (pattern present →
rewrite applied, fix message collected) and an ``idempotent`` case
(pattern absent or already-correct → source unchanged, no fix message).
Edge cases follow where the fixer's documented contract has a
non-trivial boundary (threshold number, whitelist, etc.).
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers import (
    apply_auto_fixes,
    apply_handler_auto_fixes,
)

pytestmark = [pytest.mark.unit]


# ---------------------------------------------------------------------------
# #1 — Export name auto-rename
# ---------------------------------------------------------------------------


class TestExportNameAutoRename:
    def test_mismatched_name_renamed(self):
        tsx = "export default function WrongName() { return null; }"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="ExpectedName")
        assert "export default function ExpectedName()" in fixed
        assert any("'WrongName'" in f and "'ExpectedName'" in f for f in fixes), fixes

    def test_matching_name_idempotent(self):
        tsx = "export default function ExpectedName() { return null; }"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="ExpectedName")
        assert fixed == tsx
        assert not any("Renamed export" in f for f in fixes)

    def test_no_expected_name_disables_fix(self):
        tsx = "export default function WhateverName() { return null; }"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("Renamed export" in f for f in fixes)


# ---------------------------------------------------------------------------
# #6 — SDK exports import completion
# ---------------------------------------------------------------------------


class TestSdkExportImportCompletion:
    def test_missing_useNavigation_added(self):
        tsx = "import { React } from '@exepad/sdk';\n" "const path = useNavigation().currentPath;\n"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "useNavigation" in fixed.split("from '@exepad/sdk'")[0]
        assert any("Added missing SDK imports" in f for f in fixes)

    def test_already_imported_idempotent(self):
        tsx = (
            "import { React, useNavigation } from '@exepad/sdk';\n"
            "const path = useNavigation().currentPath;\n"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        # Import line stays unchanged.
        assert "Added missing SDK imports" not in " ".join(fixes)

    def test_unused_export_not_added(self):
        tsx = "import { React } from '@exepad/sdk';\n// nothing else\n"
        _, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert not any("Added missing SDK imports" in f for f in fixes)


# ---------------------------------------------------------------------------
# #14 — Hallucinated URL in CSS url() patterns
# ---------------------------------------------------------------------------


class TestHallucinatedCssUrl:
    def test_blocked_domain_replaced(self):
        # CSS url() has no downstream resolver, so the blocked-domain URL is
        # not just placeholdered — the inline-style url() is neutralized to
        # ``none`` (app mr5czdwj: a dangling ``__PLACEHOLDER__`` in CSS ships
        # into compiled.css and the browser fetches ``/__PLACEHOLDER__``).
        tsx = (
            "export default function X() {\n"
            "  return <div style={{ background: \"url('https://images.unsplash.com/photo-1234')\" }}/>;\n"
            "}"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "__PLACEHOLDER__" not in fixed
        assert "unsplash" not in fixed
        assert "none" in fixed
        assert any(
            ("hallucinated style URL" in f or "unknown style URL" in f) and "unsplash.com" in f
            for f in fixes
        )

    def test_allowed_domain_idempotent(self):
        tsx = (
            "export default function X() {\n"
            "  return <div style={{ background: \"url('https://storage.googleapis.com/b.png')\" }}/>;\n"
            "}"
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert "storage.googleapis.com" in fixed
        assert "__PLACEHOLDER__" not in fixed

    def test_no_url_pattern_idempotent(self):
        tsx = "export default function X() { return <div className='bg-red-500'/>; }"
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx


# ---------------------------------------------------------------------------
# #17 — Text opacity strip (text-*/N → text-*)
# ---------------------------------------------------------------------------


class TestTextOpacityStrip:
    def test_text_opacity_stripped(self):
        tsx = "<p className='text-on-primary/80'>hi</p>"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-primary/80" not in fixed
        assert "text-on-primary" in fixed
        assert any("Stripped text opacity" in f and "text-on-primary/80" in f for f in fixes)

    def test_multiple_opacities_all_stripped(self):
        # Wrapped in a fragment because real components always have a
        # single root; multi-root TSX is rejected by tree-sitter and the
        # className-scoped rewriter (correctly) only sees parsed elements.
        tsx = (
            "<>"
            "<div className='text-on-surface/90'>a</div>"
            "<div className='text-muted-foreground/70'>b</div>"
            "</>"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "text-on-surface/90" not in fixed
        assert "text-muted-foreground/70" not in fixed
        assert sum("Stripped text opacity" in f for f in fixes) == 2

    def test_no_opacity_idempotent(self):
        tsx = "<p className='text-on-primary'>hi</p>"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("Stripped text opacity" in f for f in fixes)


# ---------------------------------------------------------------------------
# #8 — Untyped empty-array typing for useRef([]) / useState([])
# ---------------------------------------------------------------------------


class TestUntypedEmptyArrayTyping:
    """Locks the never[]-inference safety net: bare ``useRef([])`` and
    ``useState([])`` calls get widened to ``<any[]>`` so subsequent
    ``.push(...)`` calls don't fail with tsc.2345.

    Lives in ``component_polishing.py``; canonical pattern lives in
    ``game_arcade.md`` (Common Pitfalls + Platformer Entities).
    """

    def test_useRef_empty_array_typed(self):
        tsx = "const blocks = useRef([]);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "useRef<any[]>([])" in fixed
        assert any("untyped useRef/useState empty array" in f for f in fixes)

    def test_useState_empty_array_typed(self):
        tsx = "const [enemies, setEnemies] = useState([]);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "useState<any[]>([])" in fixed
        assert any("untyped useRef/useState empty array" in f for f in fixes)

    def test_already_typed_useRef_not_touched(self):
        tsx = "const blocks = useRef<Block[]>([]);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("untyped useRef/useState empty array" in f for f in fixes)

    def test_already_typed_useState_not_touched(self):
        tsx = "const [items, setItems] = useState<Item[]>([]);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("untyped useRef/useState empty array" in f for f in fixes)

    def test_non_empty_initializer_not_touched(self):
        # ``useRef([1, 2])`` infers ``number[]`` correctly — leave alone.
        tsx = "const counts = useRef([1, 2, 3]);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("untyped useRef/useState empty array" in f for f in fixes)

    def test_useRef_null_initializer_not_touched(self):
        # ``useRef(null)`` is a ref-object pattern, not an array. Skip.
        tsx = "const inputRef = useRef(null);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("untyped useRef/useState empty array" in f for f in fixes)

    def test_other_function_with_empty_array_not_touched(self):
        # Only ``useRef`` / ``useState`` are wrapped — random calls
        # like ``foo([])`` keep their original shape.
        tsx = "const result = foo([]);"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("untyped useRef/useState empty array" in f for f in fixes)

    def test_multiple_untyped_calls_all_fixed(self):
        tsx = (
            "const blocks = useRef([]);\n"
            "const enemies = useRef([]);\n"
            "const [pickups, setPickups] = useState([]);"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed.count("useRef<any[]>([])") == 2
        assert "useState<any[]>([])" in fixed
        # Single fix entry summarizing the count.
        matching = [f for f in fixes if "untyped useRef/useState empty array" in f]
        assert len(matching) == 1
        assert "3" in matching[0]

    def test_idempotent_on_typed_input(self):
        # After the first pass, the output is already typed — second
        # pass must be a no-op.
        tsx = "const blocks = useRef([]);"
        fixed_once, _ = apply_auto_fixes(tsx, [], {}, {})
        fixed_twice, fixes = apply_auto_fixes(fixed_once, [], {}, {})
        assert fixed_twice == fixed_once
        assert not any("untyped useRef/useState empty array" in f for f in fixes)


# ---------------------------------------------------------------------------
# #25 / #26 — useApp null-safety injection (variable + destructured)
# ---------------------------------------------------------------------------


class TestUseAppNullSafetyInjection:
    def test_assigned_variable_prop_access_rewritten(self):
        tsx = "const filters = useApp(s => s.filters);\n" "const cat = filters.category;\n"
        state_keys = {"filters": {}}  # nullable (empty dict)
        fixed, fixes = apply_auto_fixes(tsx, [], {}, state_keys)
        assert "filters?.category" in fixed
        assert any("optional chaining" in f for f in fixes)

    def test_destructured_var_rewritten(self):
        """AST destructure fixer rewrites to Pattern-2 first, then null-safety
        Pattern 2 inserts ``?.`` on the bound variable."""
        tsx = "const { profile } = useApp();\n" "const name = profile.name;\n"
        state_keys = {"profile": None}  # nullable
        fixed, fixes = apply_auto_fixes(tsx, [], {}, state_keys)
        assert "profile?.name" in fixed
        assert any("optional chaining" in f and "profile" in f for f in fixes)

    def test_non_nullable_state_key_not_rewritten(self):
        tsx = "const count = useApp(s => s.count);\n" "const n = count.toString();\n"
        state_keys = {"count": 0}  # non-nullable initial value
        fixed, fixes = apply_auto_fixes(tsx, [], {}, state_keys)
        assert "count.toString()" in fixed
        assert not any("optional chaining" in f for f in fixes)

    def test_already_safe_idempotent(self):
        tsx = "const filters = useApp(s => s.filters);\n" "const cat = filters?.category;\n"
        state_keys = {"filters": {}}
        fixed, fixes = apply_auto_fixes(tsx, [], {}, state_keys)
        assert "filters?.category" in fixed
        # No duplicate ?? applied; output unchanged.
        assert fixed == tsx
        assert not any("optional chaining" in f for f in fixes)


# ---------------------------------------------------------------------------
# #31 — Model name typo fuzzy-fix
# ---------------------------------------------------------------------------


class TestModelNameTypoFix:
    def test_close_name_corrected(self):
        tsx = "const { list } = useModel('poss');"
        fixed, fixes = apply_auto_fixes(tsx, [{"name": "posts"}], {}, {})
        assert "useModel('posts')" in fixed
        assert any("Typo: useModel('poss') → useModel('posts')" in f for f in fixes)

    def test_correct_name_idempotent(self):
        tsx = "const { list } = useModel('posts');"
        fixed, fixes = apply_auto_fixes(tsx, [{"name": "posts"}], {}, {})
        assert fixed == tsx
        assert not any("useModel" in f and "Typo" in f for f in fixes)

    def test_too_far_typo_left_alone(self):
        """Fuzzy-match cutoff 0.8 — totally wrong names shouldn't be corrected."""
        tsx = "const { list } = useModel('xyz');"
        fixed, _ = apply_auto_fixes(tsx, [{"name": "posts"}], {}, {})
        # Still references xyz — the unknown-model AST rule will flag.
        assert "useModel('xyz')" in fixed


# ---------------------------------------------------------------------------
# #33 — State key typo fuzzy-fix
# ---------------------------------------------------------------------------


class TestStateKeyTypoFix:
    def test_close_key_corrected(self):
        tsx = "setState('modee', 'dark');"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {"mode": "light"})
        assert "setState('mode'" in fixed
        assert any("Typo: setState('modee') → setState('mode')" in f for f in fixes)

    def test_correct_key_idempotent(self):
        tsx = "setState('mode', 'dark');"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {"mode": "light"})
        assert fixed == tsx


# ---------------------------------------------------------------------------
# #38 — console.log() stripping
# ---------------------------------------------------------------------------


class TestConsoleLogStrip:
    def test_single_line_stripped(self):
        tsx = "function f(){\n  console.log('debug');\n  return 1;\n}"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert "console.log" not in fixed
        assert "return 1;" in fixed
        assert any("console.log" in f for f in fixes)

    def test_multiple_calls_first_stripped(self):
        """Known limitation: the strip regex consumes the next line's
        leading whitespace, so back-to-back calls without an intervening
        non-blank line only strip the first pass. A second run of
        apply_auto_fixes would strip the rest — in practice the save
        tool re-runs after each LLM turn."""
        tsx = "function f(){\n" "  console.log('a');\n" "  console.log('b');\n" "  return 1;\n" "}"
        fixed, _ = apply_auto_fixes(tsx, [], {}, {})
        # At least one was stripped.
        assert fixed.count("console.log") < tsx.count("console.log")

    def test_no_console_log_idempotent(self):
        tsx = "function f(){ return 1; }"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {})
        assert fixed == tsx
        assert not any("console.log" in f for f in fixes)


# ---------------------------------------------------------------------------
# #40 — navigate() path typo fuzzy-fix
# ---------------------------------------------------------------------------


class TestNavigatePathTypoFix:
    def test_close_path_corrected(self):
        tsx = "navigate('/proucts');"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, page_slugs=["/", "/products", "/about"])
        assert "navigate('/products')" in fixed
        assert any("navigate path typo" in f and "/products" in f for f in fixes)

    def test_correct_path_idempotent(self):
        tsx = "navigate('/products');"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, page_slugs=["/", "/products"])
        assert fixed == tsx
        assert not any("navigate path typo" in f for f in fixes)

    def test_system_route_ignored(self):
        tsx = "navigate('/login');"
        fixed, _ = apply_auto_fixes(tsx, [], {}, {}, page_slugs=["/", "/products"])
        assert "navigate('/login')" in fixed

    def test_dynamic_path_ignored(self):
        tsx = "navigate(`/products/${id}`);"
        fixed, _ = apply_auto_fixes(tsx, [], {}, {}, page_slugs=["/", "/products"])
        assert "${id}" in fixed

    def test_unresolved_path_rewrites_to_first_page(self):
        # No close match — the ghost target has no plausible counterpart
        # in the plan. Rewrite to the first declared page so the link is
        # a harmless redirect instead of a 404 dead end.
        tsx = "navigate('/my-tasks');"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, page_slugs=["/"])
        assert "navigate('/')" in fixed
        assert "navigate('/my-tasks')" not in fixed
        assert any("Rewrote unresolved navigate path" in f for f in fixes)

    def test_unresolved_path_rewrites_to_first_available_page(self):
        # Multiple pages in the plan, none close to the ghost target.
        tsx = "navigate('/nonexistent-widget');"
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, page_slugs=["/dashboard", "/reports"])
        assert "navigate('/dashboard')" in fixed
        assert any("Rewrote unresolved navigate path" in f and "/dashboard" in f for f in fixes)


# ---------------------------------------------------------------------------
# Handler auto-fix idempotent tests (previously only "fires" was covered)
# ---------------------------------------------------------------------------


class TestHandlerAutoFixIdempotent:
    def test_no_bad_imports_unchanged(self):
        tsx = (
            "import { HandlerContext } from '@exepad/sdk';\n"
            "export default async function h(ctx){ return {}; }\n"
        )
        fixed, fixes = apply_handler_auto_fixes(tsx, model_names=["posts"])
        assert fixed == tsx
        assert fixes == []

    def test_no_model_import_to_strip(self):
        tsx = (
            "import { helper } from './helper';\n"
            "export default async function h(ctx){ return {}; }\n"
        )
        fixed, fixes = apply_handler_auto_fixes(tsx, model_names=["posts"])
        assert fixed == tsx
        assert fixes == []


# ---------------------------------------------------------------------------
# Sign-Out → wire/inject the canonical useHandler("auth_signout") pattern
# ---------------------------------------------------------------------------


class TestDeadSignOutButton:
    """Wire a dead Sign-Out button to the canonical auth_signout handler.

    The blessed pattern is `useHandler("auth_signout")` — NEVER
    `navigate("/logout")` (the navigate_unknown_route rule blocks it).
    """

    def _sidebar(self, button: str) -> str:
        return (
            "import { React, navigate, Icons, useHandler } from '@exepad/sdk/core';\n"
            "export default function MainSidebar() {\n"
            "  return (\n"
            "    <aside>\n"
            f"      {button}\n"
            "    </aside>\n"
            "  );\n"
            "}\n"
        )

    def test_icon_only_signout_button_gets_wired(self):
        tsx = self._sidebar(
            '<button title="Sign Out" aria-label="Sign out" className="p-2">'
            '<Icons.LogOut className="w-4 h-4" /></button>'
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="MainSidebar")
        assert 'useHandler("auth_signout"' in fixed
        assert "onClick={signOut}" in fixed
        assert 'navigate("/logout")' not in fixed  # never the forbidden pattern
        assert any("Sign-Out" in f for f in fixes)

    def test_logout_icon_without_label_gets_wired(self):
        # No title/aria-label — detected purely by the LogOut icon child.
        tsx = self._sidebar('<button className="p-2"><Icons.LogOut /></button>')
        fixed, _ = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="MainSidebar")
        assert 'useHandler("auth_signout"' in fixed
        assert "onClick={signOut}" in fixed

    def test_already_wired_is_unchanged(self):
        # Already uses the canonical auth_signout hook → fixer is a no-op.
        tsx = (
            "import { React, Icons, useHandler } from '@exepad/sdk/core';\n"
            "export default function MainSidebar() {\n"
            '  const { execute: signOut } = useHandler("auth_signout", { autoFetch: false });\n'
            "  return (\n"
            "    <aside>\n"
            '      <button onClick={signOut} title="Sign Out"><Icons.LogOut /></button>\n'
            "    </aside>\n"
            "  );\n"
            "}\n"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="MainSidebar")
        assert fixed.count('useHandler("auth_signout"') == 1
        assert not any("Sign-Out" in f for f in fixes)

    def test_non_signout_button_untouched(self):
        tsx = self._sidebar('<button title="Add item"><Icons.Plus /></button>')
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="MainSidebar")
        assert "auth_signout" not in fixed
        assert not any("Sign-Out" in f for f in fixes)


class TestSignOutInjection:
    """Inject an auth_signout Sign-Out button when an auth sidebar has none."""

    def _nav_sidebar(
        self,
        *,
        footer: str = "",
        name_imports: str = "navigate, Icons, useCurrentUser, useHandler",
    ) -> str:
        # A genuine nav shell: uses navigate(), <nav>, and useCurrentUser —
        # the signals the injector requires. No sign-out affordance unless
        # `footer` supplies one.
        return (
            f"import {{ React, {name_imports} }} from '@exepad/sdk/core';\n"
            "export default function MainSidebar() {\n"
            "  const user = useCurrentUser();\n"
            "  return (\n"
            '    <aside className="flex flex-col h-full">\n'
            "      <nav>\n"
            '        <button onClick={() => navigate("/dashboard")}>Dashboard</button>\n'
            "      </nav>\n"
            f"      {footer}\n"
            "    </aside>\n"
            "  );\n"
            "}\n"
        )

    def test_injects_signout_when_auth_enabled_and_missing(self):
        tsx = self._nav_sidebar()
        fixed, fixes = apply_auto_fixes(
            tsx, [], {}, {}, expected_component_name="MainSidebar", security_enabled=True
        )
        assert 'useHandler("auth_signout"' in fixed
        assert "onClick={signOut}" in fixed
        assert 'navigate("/logout")' not in fixed
        assert any("Injected a Sign-Out" in f for f in fixes)
        # Button lands INSIDE the <aside> panel; hook is above the return.
        assert fixed.index("onClick={signOut}") < fixed.index("</aside>")
        assert fixed.index('useHandler("auth_signout"') < fixed.index("return (")

    def test_no_injection_when_auth_disabled(self):
        tsx = self._nav_sidebar()
        fixed, fixes = apply_auto_fixes(
            tsx, [], {}, {}, expected_component_name="MainSidebar", security_enabled=False
        )
        assert "auth_signout" not in fixed
        assert not any("Injected" in f for f in fixes)

    def test_no_injection_for_non_sidebar_component(self):
        tsx = self._nav_sidebar()
        fixed, _ = apply_auto_fixes(
            tsx, [], {}, {}, expected_component_name="DashboardPage", security_enabled=True
        )
        assert "auth_signout" not in fixed

    def test_no_action_when_auth_signout_already_present(self):
        # A sidebar that already wires auth_signout gets nothing added.
        tsx = (
            "import { React, navigate, Icons, useCurrentUser, useHandler } from '@exepad/sdk/core';\n"
            "export default function MainSidebar() {\n"
            "  const user = useCurrentUser();\n"
            '  const { execute: signOut } = useHandler("auth_signout", { autoFetch: false });\n'
            "  return (\n"
            '    <aside className="flex flex-col h-full">\n'
            '      <button onClick={signOut} title="Sign Out"><Icons.LogOut /></button>\n'
            "    </aside>\n"
            "  );\n"
            "}\n"
        )
        fixed, fixes = apply_auto_fixes(
            tsx, [], {}, {}, expected_component_name="MainSidebar", security_enabled=True
        )
        assert fixed.count('useHandler("auth_signout"') == 1
        assert not any("Injected" in f for f in fixes)
        assert not any("Wired" in f for f in fixes)

    def test_wires_existing_dead_button_instead_of_injecting(self):
        # A dead (unwired) Sign-Out button is WIRED — not duplicated by a
        # fresh injection.
        footer = '<button title="Sign Out"><Icons.LogOut /></button>'
        tsx = self._nav_sidebar(footer=footer)
        fixed, fixes = apply_auto_fixes(
            tsx, [], {}, {}, expected_component_name="MainSidebar", security_enabled=True
        )
        assert fixed.count('useHandler("auth_signout"') == 1
        assert "onClick={signOut}" in fixed
        assert any("Wired" in f for f in fixes)
        assert not any("Injected" in f for f in fixes)

    def test_no_injection_without_nav_signal(self):
        # "Sidebar"-named widget that is NOT a nav shell (no navigate/<nav>/
        # useCurrentUser) is left alone — avoids false positives.
        tsx = (
            "import { React } from '@exepad/sdk/core';\n"
            "export default function SidebarFilters() {\n"
            "  return (\n"
            "    <aside>\n"
            "      <h3>Filters</h3>\n"
            "    </aside>\n"
            "  );\n"
            "}\n"
        )
        fixed, _ = apply_auto_fixes(
            tsx, [], {}, {}, expected_component_name="SidebarFilters", security_enabled=True
        )
        assert "auth_signout" not in fixed


# ---------------------------------------------------------------------------
# React hooks imported from @exepad/sdk → rewrite to the React namespace
# ---------------------------------------------------------------------------
class TestReactHooksFromSdk:
    """`import { useState } from '@exepad/sdk'` is invalid (the SDK exports the
    React namespace, not bare hooks). The fixer rewrites to React.useState."""

    @staticmethod
    def _sdk_import(src: str) -> str:
        import re
        m = re.search(r"import\s*\{([^}]*)\}\s*from\s*['\"]@exepad/sdk['\"]", src)
        return m.group(1) if m else ""

    def test_hooks_rewritten_to_react_namespace(self):
        tsx = (
            "import { useState, useEffect, Button } from '@exepad/sdk';\n"
            "export default function Widget() {\n"
            "  const [n, setN] = useState(0);\n"
            "  useEffect(() => { setN(1); }, []);\n"
            "  return <Button onClick={() => setN(n + 1)}>{n}</Button>;\n"
            "}\n"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="Widget")
        assert "React.useState(0)" in fixed
        assert "React.useEffect(" in fixed
        # The bare hooks are gone from the SDK import; React is present.
        imp = self._sdk_import(fixed)
        assert "React" in imp
        assert "useState" not in imp
        assert "useEffect" not in imp
        assert "Button" in imp  # real SDK export preserved
        assert any("React hook" in f for f in fixes)

    def test_sdk_hooks_untouched(self):
        # useModel etc. ARE real SDK exports — never rewritten.
        tsx = (
            "import { useModel, Button } from '@exepad/sdk';\n"
            "export default function W() {\n"
            "  const { data } = useModel('items');\n"
            "  return <Button>{String(data)}</Button>;\n"
            "}\n"
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="W")
        assert "React.useModel" not in fixed
        assert "useModel('items')" in fixed

    def test_member_access_and_object_keys_untouched(self):
        # Only bare hook references are prefixed — not `obj.useState` or a
        # `{ useState: ... }` object key.
        tsx = (
            "import { useState, Button } from '@exepad/sdk';\n"
            "export default function W() {\n"
            "  const [n] = useState(0);\n"
            "  const config = { useState: true };\n"
            "  const v = config.useState;\n"
            "  return <Button>{n}{String(v)}</Button>;\n"
            "}\n"
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="W")
        assert "React.useState(0)" in fixed
        assert "{ useState: true }" in fixed       # object key untouched
        assert "config.useState" in fixed          # member access untouched
        assert "config.React.useState" not in fixed

    def test_subpath_import_handled(self):
        tsx = (
            "import { useRef, useMemo } from '@exepad/sdk/core';\n"
            "export default function W() {\n"
            "  const r = useRef(null);\n"
            "  const m = useMemo(() => 1, []);\n"
            "  return <div ref={r}>{m}</div>;\n"
            "}\n"
        )
        fixed, _ = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="W")
        assert "React.useRef(null)" in fixed
        assert "React.useMemo(" in fixed
        import re as _re
        core_imp = _re.search(r"import\s*\{([^}]*)\}\s*from\s*['\"]@exepad/sdk/core['\"]", fixed)
        assert core_imp and "React" in core_imp.group(1)
        assert core_imp and "useRef" not in core_imp.group(1)

    def test_idempotent_on_correct_code(self):
        # Already canonical (React.useState) → no change, no fix message.
        tsx = (
            "import { React, Button } from '@exepad/sdk';\n"
            "export default function W() {\n"
            "  const [n] = React.useState(0);\n"
            "  return <Button>{n}</Button>;\n"
            "}\n"
        )
        fixed, fixes = apply_auto_fixes(tsx, [], {}, {}, expected_component_name="W")
        assert "React.React.useState" not in fixed
        assert not any("React hook" in f for f in fixes)
