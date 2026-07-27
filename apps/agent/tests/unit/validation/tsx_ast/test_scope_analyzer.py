"""Unit tests for ``tsx_ast.scope_analyzer.analyze_module``.

Contract under test:
  - **Exports**: top-level function/class declarations, top-level
    `const Foo = ...` (excluding React-destructures), `export function/
    class/const`, and any name appearing in a `window.X = ...`
    assignment are reported as exports.
  - **Imports** (`import_candidates`): identifier references whose name
    is NOT bound anywhere in the file AND NOT a known built-in.
  - **Window registrations**: `window.X = ...` lines surface X under
    `window_registrations` (and as an export).
  - HTML JSX tags (`<svg/>`, `<div/>`) are NOT references.
  - Function parameters (including single-param arrow `n => ...`) are
    bindings.
  - `const { useState } = React;` does NOT export `useState` — it's a
    local React-API alias.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.tsx_ast.scope_analyzer import (
    analyze_module,
)

pytestmark = [pytest.mark.unit]


# ── Exports ───────────────────────────────────────────────────────────


def test_function_declarations_export():
    src = "function Foo() {}\nfunction Bar() {}\n"
    r = analyze_module(src)
    assert r.exports == ["Foo", "Bar"]


def test_class_declarations_export():
    src = "class Service {}\n"
    r = analyze_module(src)
    assert "Service" in r.exports


def test_const_arrow_exports():
    src = "const Foo = () => 1;\nconst bar = (x) => x;\n"
    r = analyze_module(src)
    assert r.exports == ["Foo", "bar"]


def test_object_destructure_exports_each_name():
    src = "const { a, b: alias } = someObject;\n"
    r = analyze_module(src)
    assert "a" in r.exports
    assert "alias" in r.exports  # right-side of pair_pattern is the binding


def test_react_destructure_does_not_export_hooks():
    """`const { useState, useEffect } = React;` is a local React-API
    alias. Other files don't import these from this file — they
    destructure React themselves."""
    src = "const { useState, useEffect, useRef } = React;\nfunction Foo() {}\n"
    r = analyze_module(src)
    assert "useState" not in r.exports
    assert "useEffect" not in r.exports
    assert "useRef" not in r.exports
    assert "Foo" in r.exports


def test_export_keyword_unwrapped():
    src = (
        "export function Helper() { return 1; }\n"
        "export const value = 42;\n"
        "export default function Main() { return 2; }\n"
        "export default OtherThing;\n"  # bare re-export, no new decl
    )
    r = analyze_module(src)
    assert "Helper" in r.exports
    assert "value" in r.exports
    assert "Main" in r.exports
    # Bare re-export of `OtherThing` does NOT introduce a new export.
    assert "OtherThing" not in r.exports


# ── Window registrations ──────────────────────────────────────────────


def test_window_self_registration():
    """`window.Foo = Foo;` → Foo is registered AND exported."""
    src = "function Foo() {}\nwindow.Foo = Foo;\n"
    r = analyze_module(src)
    assert "Foo" in r.window_registrations
    assert "Foo" in r.exports


def test_window_direct_assignment_with_object():
    """`window.SCHOOL = {...};` → SCHOOL is registered AND exported,
    even though the right side is a literal not an identifier."""
    src = "window.SCHOOL = { name: 'X' };\n"
    r = analyze_module(src)
    assert "SCHOOL" in r.window_registrations
    assert "SCHOOL" in r.exports


def test_window_call_assignment():
    """`window.STUDENTS = makeStudents();` → STUDENTS registered."""
    src = "function makeStudents() { return []; }\nwindow.STUDENTS = makeStudents();\n"
    r = analyze_module(src)
    assert "STUDENTS" in r.window_registrations
    assert "STUDENTS" in r.exports


# ── Cross-file imports ────────────────────────────────────────────────


def test_unbound_uppercase_jsx_is_import():
    """`<Sidebar/>` referenced but not defined → cross-file import."""
    src = "function Foo() { return <Sidebar/>; }\n"
    r = analyze_module(src)
    assert "Sidebar" in r.import_candidates


def test_unbound_identifier_is_import():
    src = "function Foo() { return KPIS.enrollment; }\n"
    r = analyze_module(src)
    assert "KPIS" in r.import_candidates


def test_react_is_not_an_import():
    """`React` is a known SDK builtin — never an import."""
    src = "const x = React.useState(0);\n"
    r = analyze_module(src)
    assert "React" not in r.import_candidates


def test_browser_globals_not_imports():
    src = (
        "function Foo() {\n"
        "  const el = document.getElementById('root');\n"
        "  console.log(window.location);\n"
        "  setTimeout(() => fetch('/api'), 100);\n"
        "  return JSON.stringify({});\n"
        "}\n"
    )
    r = analyze_module(src)
    assert r.import_candidates == set()


def test_local_definitions_not_imports():
    src = (
        "function Helper() { return 1; }\n"
        "function Page() { return <Helper/>; }\n"
    )
    r = analyze_module(src)
    assert r.import_candidates == set()


# ── HTML JSX tags ─────────────────────────────────────────────────────


def test_lowercase_jsx_tags_not_imports():
    src = "function F() { return <div><span><svg><nav/></svg></span></div>; }\n"
    r = analyze_module(src)
    assert "div" not in r.import_candidates
    assert "span" not in r.import_candidates
    assert "svg" not in r.import_candidates
    assert "nav" not in r.import_candidates


# ── Function-param bindings ──────────────────────────────────────────


def test_destructured_param_bindings():
    """`function F({ data })` — `data` is a local binding, not a ref."""
    src = "function F({ data }) { return <div>{data}</div>; }\n"
    r = analyze_module(src)
    assert "data" not in r.import_candidates


def test_array_destructure_bindings():
    """`const [a, b] = useState(0)` — a, b are bindings."""
    src = (
        "function F() {\n"
        "  const [hover, setHover] = useState(false);\n"
        "  return <div onMouseEnter={() => setHover(true)}>{hover}</div>;\n"
        "}\n"
    )
    r = analyze_module(src)
    assert "hover" not in r.import_candidates
    assert "setHover" not in r.import_candidates


def test_single_param_arrow_binding():
    """`n => ...` puts `n` as a direct child of arrow_function (no
    formal_parameters wrapper). Must still be treated as a binding."""
    src = "const f = arr => arr.map(n => ({name: n}));\n"
    r = analyze_module(src)
    assert "n" not in r.import_candidates
    assert "arr" not in r.import_candidates


# ── Member-expression properties ─────────────────────────────────────


def test_member_property_not_a_reference():
    """`KPIS.enrollment` — only KPIS is a reference; enrollment is a
    property lookup."""
    src = "function F() { return <span>{KPIS.enrollment}</span>; }\n"
    r = analyze_module(src)
    assert "enrollment" not in r.import_candidates


def test_jsx_attribute_name_not_a_reference():
    """`<Foo bar={x}/>` — `bar` is the attribute name, not a ref."""
    src = "function F() { return <Foo bar={1} someProp={2}/>; }\n"
    r = analyze_module(src)
    assert "bar" not in r.import_candidates
    assert "someProp" not in r.import_candidates


def test_object_literal_key_not_a_reference():
    """`const x = { foo: 1, bar: 2 }` — foo/bar are keys, not refs."""
    src = "const x = { foo: 1, bar: 2 };\n"
    r = analyze_module(src)
    assert "foo" not in r.import_candidates
    assert "bar" not in r.import_candidates


# ── End-to-end Babel-shell shape ─────────────────────────────────────


def test_babel_shell_sibling_pattern():
    """Realistic shell.jsx-style sibling: defines Sidebar locally,
    references Icon which lives in another sibling, registers via
    window."""
    src = (
        "const { useState } = React;\n"
        "const Sidebar = ({ active }) => (\n"
        "  <nav><Icon name='home'/>{active}</nav>\n"
        ");\n"
        "window.Sidebar = Sidebar;\n"
    )
    r = analyze_module(src)
    assert r.exports == ["Sidebar"]
    assert r.window_registrations == ["Sidebar"]
    assert r.import_candidates == {"Icon"}


def test_inline_app_block_pattern():
    """The bootstrap inline block — defines App, composes siblings,
    bootstraps via ReactDOM."""
    src = (
        "const { useState, useEffect } = React;\n"
        "function App() {\n"
        "  const [page, setPage] = useState('overview');\n"
        "  return <Sidebar onNavigate={setPage}><OverviewPage/></Sidebar>;\n"
        "}\n"
        "ReactDOM.createRoot(document.getElementById('root')).render(<App/>);\n"
    )
    r = analyze_module(src)
    assert "App" in r.exports
    assert r.import_candidates == {"Sidebar", "OverviewPage"}


# ── Robustness ───────────────────────────────────────────────────────


def test_empty_input_returns_empty_analysis():
    r = analyze_module("")
    assert r.exports == []
    assert r.import_candidates == set()
    assert not r.parse_failed


def test_whitespace_only_returns_empty():
    r = analyze_module("   \n  \n")
    assert r.exports == []
    assert r.import_candidates == set()


# ── Regression: import alias binding (the typo bug) ─────────────────


def test_import_alias_binding():
    """`import { foo as bar }` — the analyzer used to NameError on this."""
    src = (
        'import { foo as bar } from "x";\n'
        "const y = bar();\n"
    )
    r = analyze_module(src)
    # Must not crash; `bar` is a binding (the import alias), `bar` is
    # also a reference (used by `const y = bar()`), and `y` is a top-level
    # binding/export.
    assert not r.parse_failed
    assert "bar" in r.bindings
    # `bar` should be filtered out of import_candidates because it IS
    # the local binding for an imported symbol.
    assert "bar" not in r.import_candidates


# ── TypeScript-only declarations ────────────────────────────────────


def test_enum_declaration_is_a_binding_and_export():
    src = "enum Direction { Up, Down }\nconst x = Direction.Up;\n"
    r = analyze_module(src)
    assert not r.parse_failed
    assert "Direction" in r.exports
    assert "Direction" in r.bindings
    # The reference `Direction.Up` resolves locally, no false import.
    assert "Direction" not in r.import_candidates


def test_interface_declaration_is_a_binding():
    src = "interface IFoo { x: number }\nconst y: IFoo = { x: 1 };\n"
    r = analyze_module(src)
    assert not r.parse_failed
    assert "IFoo" in r.exports
    assert "IFoo" not in r.import_candidates


def test_type_alias_declaration_is_a_binding():
    src = "type Pt = { x: number };\nconst p: Pt = { x: 1 };\n"
    r = analyze_module(src)
    assert not r.parse_failed
    assert "Pt" in r.exports
    assert "Pt" not in r.import_candidates
