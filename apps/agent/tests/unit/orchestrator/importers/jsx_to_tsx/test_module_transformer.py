"""Unit tests for the per-module Babel-shell translator (Phase 2).

Covers:
  - Cross-file ES import resolution from sibling exports
  - `window.X = X;` self-registration → strip + ensure declaration
    gets `export ` prefix
  - `window.X = expr;` direct assignment → rewrite to
    `export const X = expr;`
  - Entry module: bootstrap stripped, wrapper synthesized,
    `export default`
  - Supporting modules: top-level decls prefixed with `export`,
    no default export
  - Cross-file imports filtered against built-ins (React etc.)
  - Output bundles cleanly via esbuild
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from main_agent.agents.orchestrator.importers.tools.jsx_to_tsx import (
    ModuleSpec,
    transform_babel_shell_modules,
    transform_jsx_module,
)

pytestmark = [pytest.mark.unit]


def _esbuild_or_skip() -> str:
    """Return the esbuild invocation prefix or skip if unavailable."""
    if shutil.which("esbuild"):
        return "esbuild"
    if shutil.which("npx"):
        return "npx"
    pytest.skip("neither esbuild nor npx on PATH; runs in Docker/CI")


# ── Per-module assembly ──────────────────────────────────────────────


def test_supporting_module_prefixes_top_level_decls_with_export():
    """A non-entry module must export every top-level component/const
    so siblings can import them."""
    result = transform_jsx_module(
        source=(
            "function Sidebar() { return <nav/>; }\n"
            "const Topbar = () => <header/>;\n"
        ),
        module_name="Shell",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert "export function Sidebar" in result.tsx
    assert "export const Topbar" in result.tsx


def test_supporting_module_does_not_synthesize_wrapper():
    """Non-entry modules emit named exports only — no LightDOMContainer
    wrapper, no `export default`."""
    result = transform_jsx_module(
        source="function Foo() { return <div/>; }\n",
        module_name="Helpers",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert "LightDOMContainer" not in result.tsx.replace(
        'import { React, LightDOMContainer }', ''
    )
    assert "export default" not in result.tsx


def test_entry_module_strips_bootstrap_and_synthesizes_wrapper():
    result = transform_jsx_module(
        source=(
            "function App() { return <div>hi</div>; }\n"
            "ReactDOM.render(<App/>, document.getElementById('root'));\n"
        ),
        module_name="Main",
        is_entry=True,
        entry_component_name="MyApp",
        imports_to_inject={},
        unresolved=[],
    )
    assert "ReactDOM.render" not in result.tsx
    assert "function MyApp()" in result.tsx
    assert "<LightDOMContainer>" in result.tsx
    assert "<App />" in result.tsx
    assert result.tsx.rstrip().endswith("export default MyApp;")


def test_entry_module_top_level_decls_stay_unexported():
    """Entry's helpers don't need `export` — only the wrapper is the
    public surface."""
    result = transform_jsx_module(
        source=(
            "const TWEAK_DEFAULTS = {};\n"
            "function App() { return <div/>; }\n"
            "ReactDOM.render(<App/>, document.getElementById('root'));\n"
        ),
        module_name="Main",
        is_entry=True,
        entry_component_name="MyApp",
        imports_to_inject={},
        unresolved=[],
    )
    # `App` and `TWEAK_DEFAULTS` must NOT be prefixed with export
    assert "\nfunction App()" in result.tsx
    assert "\nconst TWEAK_DEFAULTS" in result.tsx
    assert "export const TWEAK_DEFAULTS" not in result.tsx


# ── window.X handling ────────────────────────────────────────────────


def test_window_self_registration_stripped_and_declaration_exported():
    result = transform_jsx_module(
        source=(
            "function Sidebar() { return <nav/>; }\n"
            "window.Sidebar = Sidebar;\n"
        ),
        module_name="Shell",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert "window.Sidebar" not in result.tsx
    assert "export function Sidebar" in result.tsx


def test_window_direct_assignment_rewritten_to_export_const():
    """`window.STUDENTS = makeStudents();` becomes
    `export const STUDENTS = makeStudents();` so the value survives
    AND is publicly exported."""
    result = transform_jsx_module(
        source=(
            "function makeStudents() { return [1, 2, 3]; }\n"
            "window.STUDENTS = makeStudents();\n"
            "window.SCHOOL = { name: 'X' };\n"
        ),
        module_name="Data",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert "export function makeStudents" in result.tsx
    assert "export const STUDENTS = makeStudents()" in result.tsx
    assert "export const SCHOOL = { name: 'X' }" in result.tsx
    assert "window." not in result.tsx


def test_entry_wrapper_renames_on_collision_with_body_decl():
    """When the wrapper name collides with a top-level function in the
    entry's body, the wrapper must rename itself to avoid both a
    duplicate declaration AND infinite self-recursion in the JSX. The
    public default export should still flow through the renamed
    wrapper.
    """
    src = (
        "function Game() {\n"
        "  return <div>game</div>;\n"
        "}\n"
        "ReactDOM.render(<Game/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="Game",
        is_entry=True,
        entry_component_name="Game",
        imports_to_inject={},
        unresolved=[],
    )
    # Body's `function Game()` survives unmodified (entry modules
    # don't get `export ` prefixes — only supporting modules do).
    assert "function Game()" in result.tsx
    # Wrapper renamed to GameWrapper to avoid duplicate-decl.
    assert "function GameWrapper()" in result.tsx
    # Wrapper renders <Game/> (the body function), not <GameWrapper/>.
    assert "<Game />" in result.tsx
    # Default export is the wrapper.
    assert "export default GameWrapper" in result.tsx
    # Exactly one `function Game(` (the body) — no duplicate.
    assert result.tsx.count("function Game(") == 1
    assert any("renaming wrapper" in w for w in result.warnings)


def test_window_direct_assignment_collides_with_existing_decl():
    """Existing `function X() {}` at top level + `window.X = somethingElse;`
    must NOT produce two `X` declarations. The window line gets stripped;
    the existing function survives and gets `export ` prefixed.
    """
    src = (
        "function makeStudents() { return [1, 2, 3]; }\n"
        # Both forms collide on the same name `makeStudents` — the
        # window line is a redundant publication that the existing
        # function definition makes obsolete.
        "window.makeStudents = makeStudents;\n"  # self-reg → strip via separate pass
        "function STUDENTS() { return null; }\n"
        # Direct assignment to a name that ALREADY has a top-level decl
        # would otherwise emit a duplicate `export const STUDENTS = ...`
        # and esbuild would refuse to bundle. Strip instead.
        "window.STUDENTS = 'wrong';\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="Data",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    # Each name appears exactly once at top-level (one `export function X`).
    assert result.tsx.count("function makeStudents") == 1
    assert result.tsx.count("function STUDENTS") == 1
    assert "export function makeStudents" in result.tsx
    assert "export function STUDENTS" in result.tsx
    # No leftover window assignments and no synthetic const that would
    # shadow the function.
    assert "window." not in result.tsx
    assert "const STUDENTS" not in result.tsx
    assert "const makeStudents" not in result.tsx


def test_object_assign_window_full_strip_when_all_collide():
    """`Object.assign(window, {Charts, BarChart, Donut})` where every
    name has a top-level decl in this file → strip the whole statement.
    The existing functions get `export ` prefixed via the normal path.
    """
    src = (
        "function Charts() { return null; }\n"
        "function BarChart() { return null; }\n"
        "function Donut() { return null; }\n"
        "Object.assign(window, { Charts, BarChart, Donut });\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="Charts",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert "window" not in result.tsx
    assert "Object.assign" not in result.tsx
    assert result.tsx.count("function Charts") == 1
    assert "export function Charts" in result.tsx
    assert "export function BarChart" in result.tsx
    assert "export function Donut" in result.tsx


def test_object_assign_window_partial_strip_keeps_undeclared():
    """Mixed batch: names that already have top-level decls are stripped
    from the object literal; names that don't survive (the registration
    is the only source of those bindings).
    """
    src = (
        "function Charts() { return null; }\n"
        "Object.assign(window, { Charts, NotDeclaredAnywhere: 'x' });\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="Charts",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    # Charts stripped (collides), NotDeclaredAnywhere kept.
    assert "Charts," not in result.tsx
    assert "Charts }" not in result.tsx
    assert "NotDeclaredAnywhere" in result.tsx
    assert result.tsx.count("function Charts") == 1


def test_object_assign_window_with_pair_quoted_key():
    """Pair properties with quoted string keys (`{"X": expr}`) are
    detected and stripped when their name collides with a top-level
    decl, same as shorthand `{X}` form."""
    src = (
        "function Charts() { return null; }\n"
        "Object.assign(window, { \"Charts\": Charts });\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="Charts",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert "Object.assign" not in result.tsx
    assert "export function Charts" in result.tsx


def test_object_assign_window_with_spread_arg_left_intact():
    """Defensive: `Object.assign(window, spreadVar)` is NOT a literal
    object — refuse to mutate. The statement survives untouched.
    """
    src = (
        "function Charts() { return null; }\n"
        "const allExports = { Charts };\n"
        "Object.assign(window, allExports);\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="Charts",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    # Statement preserved as-is.
    assert "Object.assign(window, allExports)" in result.tsx


def test_object_assign_other_target_left_intact():
    """`Object.assign(notWindow, {...})` is not our concern — leave it.
    """
    src = (
        "const myObj = {};\n"
        "function Charts() { return null; }\n"
        "Object.assign(myObj, { Charts });\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="Charts",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert "Object.assign(myObj, { Charts })" in result.tsx


# ── Cross-file imports ───────────────────────────────────────────────


def test_cross_file_imports_appear_after_sdk_import():
    result = transform_jsx_module(
        source="function Page() { return <Sidebar><Donut/></Sidebar>; }\n",
        module_name="Page",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={
            "Shell": ["Sidebar"],
            "Charts": ["Donut", "BarChart"],
        },
        unresolved=[],
    )
    lines = [l for l in result.tsx.splitlines() if l.startswith("import")]
    # Supporting modules import only React (LightDOMContainer is entry-only).
    assert lines[0] == 'import { React } from "@exepad/sdk";'
    assert "LightDOMContainer" not in result.tsx
    assert any('from "./Shell"' in l and "Sidebar" in l for l in lines)
    assert any(
        'from "./Charts"' in l and "Donut" in l and "BarChart" in l
        for l in lines
    )


def test_supporting_module_excludes_lightdomcontainer_import():
    """Non-entry modules don't render via LightDOMContainer — the import
    is dead and shouldn't ship in the per-module prelude."""
    result = transform_jsx_module(
        source="export const Icon = () => <svg/>;\n",
        module_name="Icons",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert 'import { React } from "@exepad/sdk";' in result.tsx
    assert "LightDOMContainer" not in result.tsx


def test_entry_module_includes_lightdomcontainer_import():
    """The entry module's synthesized wrapper uses LightDOMContainer; the
    import must be present."""
    result = transform_jsx_module(
        source=(
            "function App() { return <div>hi</div>; }\n"
            "ReactDOM.render(<App/>, document.getElementById('root'));\n"
        ),
        module_name="Page",
        is_entry=True,
        entry_component_name="Page",
        imports_to_inject={},
        unresolved=[],
    )
    assert 'import { React, LightDOMContainer }' in result.tsx
    assert "<LightDOMContainer>" in result.tsx


def test_unresolved_import_warned_not_fatal():
    """A reference that no sibling exports surfaces as a warning. The
    output still emits — esbuild bundle catches the unresolved name
    later as a build-time error."""
    result = transform_jsx_module(
        source="function F() { return <Mystery/>; }\n",
        module_name="X",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=["Mystery"],
    )
    assert any("unresolved" in w.lower() for w in result.warnings)
    assert "Mystery" in " ".join(result.warnings)


# ── Orchestrator integration ─────────────────────────────────────────


def test_orchestrator_resolves_symbol_table():
    modules = [
        ModuleSpec(name="Icons", source="const Icon = () => <svg/>;\nwindow.Icon = Icon;\n"),
        ModuleSpec(name="Shell", source="const Sidebar = () => <Icon/>;\nwindow.Sidebar = Sidebar;\n"),
        ModuleSpec(
            name="Main",
            is_entry=True,
            source=(
                "function App() { return <Sidebar/>; }\n"
                "ReactDOM.render(<App/>, document.getElementById('root'));\n"
            ),
        ),
    ]
    results = transform_babel_shell_modules(modules, entry_component_name="MyApp")
    # Shell imports Icon from Icons
    assert 'from "./Icons"' in results["Shell"].tsx
    assert "Icon" in results["Shell"].tsx
    # Main imports Sidebar from Shell (NOT Icons, even though Icons
    # also exports Icon — Sidebar is a Shell export only)
    assert 'from "./Shell"' in results["Main"].tsx
    assert "Sidebar" in results["Main"].tsx


def test_orchestrator_self_imports_excluded():
    """A module that exports AND references the same name doesn't
    import that name from itself."""
    modules = [
        ModuleSpec(
            name="Both",
            source="function Foo() { return <Foo/>; }\nwindow.Foo = Foo;\n",
        ),
        ModuleSpec(
            name="Main",
            is_entry=True,
            source="function App() { return <div/>; }\nReactDOM.render(<App/>, document.getElementById('root'));\n",
        ),
    ]
    results = transform_babel_shell_modules(modules, entry_component_name="MyApp")
    # Foo doesn't import Foo from itself
    assert "./Both" not in results["Both"].tsx


# ── React destructure dedupe (legacy logic still works) ─────────────


def test_react_destructure_alias_stripped_and_references_renamed():
    """`const { useState: useStateS } = React; ... useStateS(0)` becomes
    `const { useState } = React; ... useState(0)` — aliases from the
    original Babel-shell concat are pure noise in per-module mode.
    """
    src = (
        "const { useState: useStateS, useEffect: useEffectS } = React;\n"
        "function Sidebar() {\n"
        "  const [open, setOpen] = useStateS(false);\n"
        "  useEffectS(() => { console.log('mount'); }, []);\n"
        "  return <div>{open ? 'on' : 'off'}</div>;\n"
        "}\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="Shell",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    # Aliased bindings are gone; canonical names take their place.
    assert "useStateS" not in result.tsx
    assert "useEffectS" not in result.tsx
    assert "const { useState, useEffect } = React;" in result.tsx
    assert "useState(false)" in result.tsx
    assert "useEffect(() => " in result.tsx


def test_react_destructure_dealias_skips_property_access():
    """`obj.useStateS` is a property name, not a binding reference —
    must not be rewritten."""
    src = (
        "const { useState: useStateS } = React;\n"
        "const obj = { useStateS: 'something' };\n"  # property KEY, not ref
        "function Foo() {\n"
        "  const [n] = useStateS(0);\n"  # this IS a ref → rewrite
        "  return <div>{obj.useStateS}</div>;\n"  # property ACCESS, not ref
        "}\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="X",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    # Property key + property access both preserve `useStateS`.
    assert "{ useStateS: 'something' }" in result.tsx
    assert "obj.useStateS" in result.tsx
    # The actual call site got renamed.
    assert "useState(0)" in result.tsx
    # And the destructure declaration is canonical.
    assert "const { useState } = React;" in result.tsx


def test_react_destructure_dealias_rewrites_shorthand_property():
    """`{ useStateS }` shorthand object property reads the binding AND
    names the property. After dealiasing the binding name changes, so
    the shorthand has to be rewritten too — otherwise the property
    points at a now-undefined name."""
    src = (
        "const { useState: useStateS } = React;\n"
        "const exports = { useStateS };\n"  # shorthand: { useStateS: useStateS }
        "function Foo() { return useStateS(0); }\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="X",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    # Alias gone everywhere — including the shorthand property.
    assert "useStateS" not in result.tsx
    assert "{ useState }" in result.tsx
    assert "useState(0)" in result.tsx


def test_react_destructure_canonical_names_pass_through():
    """Already-canonical destructures are untouched."""
    src = (
        "const { useState, useEffect } = React;\n"
        "function Foo() { const [n] = useState(0); return null; }\n"
    )
    result = transform_jsx_module(
        source=src,
        module_name="X",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    assert "const { useState, useEffect } = React;" in result.tsx
    assert "useState(0)" in result.tsx


def test_duplicate_react_destructures_merged_per_module():
    """When a single module has multiple React destructures (rare but
    possible from inline source), they get merged into one — same as
    the legacy single-file translator."""
    result = transform_jsx_module(
        source=(
            "const { useState, useEffect } = React;\n"
            "function Foo() { return <div/>; }\n"
            "const { useState, useRef } = React;\n"  # duplicate
            "function Bar() { return <Foo/>; }\n"
        ),
        module_name="X",
        is_entry=False,
        entry_component_name=None,
        imports_to_inject={},
        unresolved=[],
    )
    react_lines = [l for l in result.tsx.splitlines() if l.strip().endswith("= React;")]
    assert len(react_lines) == 1
    merged = react_lines[0]
    assert "useState" in merged and "useEffect" in merged and "useRef" in merged


# ── End-to-end esbuild bundle ───────────────────────────────────────


def test_orchestrator_output_bundles_via_esbuild():
    """Multi-module TSX output must compile + bundle via esbuild
    --bundle=true with React externalised."""
    binary = _esbuild_or_skip()
    cwd = (
        Path(__file__).resolve().parents[6]
        if binary == "npx"
        else None
    )

    modules = [
        ModuleSpec(
            name="Data",
            source=(
                "window.SCHOOL = { name: 'X' };\n"
                "const FIRST = ['a','b'];\n"
                "function makeStudents() { return FIRST; }\n"
                "window.STUDENTS = makeStudents();\n"
            ),
        ),
        ModuleSpec(
            name="Icons",
            source="const Icon = ({ name }) => <svg className={name}/>;\nwindow.Icon = Icon;\n",
        ),
        ModuleSpec(
            name="Main",
            is_entry=True,
            source=(
                "const { useState } = React;\n"
                "function App() {\n"
                "  return <div>Students: {STUDENTS.length} <Icon name='x'/></div>;\n"
                "}\n"
                "ReactDOM.render(<App/>, document.getElementById('root'));\n"
            ),
        ),
    ]
    results = transform_babel_shell_modules(modules, entry_component_name="MyApp")

    with tempfile.TemporaryDirectory() as tmp:
        for name, r in results.items():
            (Path(tmp) / f"{name}.tsx").write_text(r.tsx)
        out_path = Path(tmp) / "bundle.js"
        cmd = []
        if binary == "npx":
            cmd = ["npx", "--no-install", "esbuild"]
        else:
            cmd = ["esbuild"]
        cmd += [
            str(Path(tmp) / "Main.tsx"),
            "--bundle=true",
            "--format=esm",
            "--target=es2022",
            "--platform=browser",
            "--jsx=automatic",
            "--external:@exepad/sdk",
            "--external:react",
            "--external:react/*",
            "--external:react-dom",
            "--external:react-dom/*",
            f"--outfile={out_path}",
        ]
        kwargs = {"capture_output": True, "text": True, "timeout": 20}
        if cwd is not None:
            kwargs["cwd"] = str(cwd)
        res = subprocess.run(cmd, **kwargs)
        assert res.returncode == 0, f"esbuild failed: {res.stderr}"
        assert out_path.exists() and out_path.stat().st_size > 0
        bundled = out_path.read_text()
        # Symbol survival in the final bundle
        assert "MyApp" in bundled
        assert "STUDENTS" in bundled
        assert "Icon" in bundled
        # Externalized — not bundled in
        assert "@exepad/sdk" in bundled or "exepad/sdk" in bundled
