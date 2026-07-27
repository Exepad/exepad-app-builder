"""Tests for the mechanical JSX → TSX translator.

Covers each of the three ``ReactDOM`` bootstrap forms, every
confidence-degrading signal, and end-to-end snapshot tests against the
real Platformer (sibling-bootstrap) and Anima (inline-bootstrap)
fixtures. Final ``esbuild`` compile gate runs when the binary is
present (skipped in dev, enforced in CI / Docker container).
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest

from main_agent.agents.orchestrator.importers.tools.jsx_to_tsx import (
    transform_jsx_to_tsx,
)
from main_agent.services.validation.syntax_validator import (
    validate_tsx_syntax,
)

pytestmark = [pytest.mark.unit]


PLATFORMER_FIXTURE_DIR = (
    Path(__file__).resolve().parents[7]
    / "packages"
    / "design-tools-fixtures"
    / "claude_design"
    / "Platformer Game"
)

# Not vendored into the repo (large, license-encumbered design export).
# Point EXEPAD_ANIMA_FIXTURE_DIR at a local copy to run these cases; otherwise
# they skip (as they do in CI).
ANIMA_FIXTURE_DIR = Path(
    os.environ.get(
        "EXEPAD_ANIMA_FIXTURE_DIR",
        str(
            Path(__file__).resolve().parents[7]
            / "packages"
            / "design-tools-fixtures"
            / "claude_design"
            / "Exepad Anima"
        ),
    )
)


def _esbuild_or_skip() -> None:
    if shutil.which("esbuild") is None:
        pytest.skip("esbuild not on PATH; tests run in Docker / CI")


# ── Form A: ReactDOM.render(<X/>, container) ─────────────────────────────


def test_form_a_strips_reactdom_render_and_emits_wrapper():
    src = (
        "function Game() { return <div>play</div>; }\n"
        'ReactDOM.render(<Game/>, document.getElementById("root"));\n'
    )
    result = transform_jsx_to_tsx(src, component_name="MyApp")

    assert result.confidence == "high"
    assert result.warnings == []
    assert result.plan_items == []
    assert "ReactDOM.render" not in result.tsx
    assert 'import { React, LightDOMContainer } from "@exepad/sdk";' in result.tsx
    # Body preserved verbatim except for the bootstrap line.
    assert "function Game()" in result.tsx
    assert "return <div>play</div>;" in result.tsx
    # Wrapper points at the root component name extracted from the bootstrap.
    assert "function MyApp()" in result.tsx
    assert "<Game />" in result.tsx
    assert "export default MyApp;" in result.tsx


# ── Form B: ReactDOM.createRoot(...).render(<X/>) ────────────────────────


def test_form_b_strips_create_root_chain_inline():
    src = (
        "function App() { return <main>hi</main>; }\n"
        'ReactDOM.createRoot(document.getElementById("root")).render(<App/>);\n'
    )
    result = transform_jsx_to_tsx(src, component_name="WrapperX")

    assert result.confidence == "high"
    assert "ReactDOM.createRoot" not in result.tsx
    assert ".render(<App/>" not in result.tsx  # bootstrap fully gone
    assert "function App()" in result.tsx
    assert "<App />" in result.tsx
    assert "export default WrapperX;" in result.tsx


# ── Form C: const root = ReactDOM.createRoot(...); root.render(<X/>) ─────


def test_form_c_strips_helper_var_and_render():
    src = (
        "function Game() { return <div/>; }\n"
        'const root = ReactDOM.createRoot(document.getElementById("root"));\n'
        "root.render(<Game/>);\n"
    )
    result = transform_jsx_to_tsx(src, component_name="GameApp")

    assert result.confidence == "high"
    # Both lines stripped.
    assert "ReactDOM.createRoot" not in result.tsx
    assert "root.render" not in result.tsx
    assert "const root" not in result.tsx
    # Component preserved.
    assert "function Game()" in result.tsx
    assert "<Game />" in result.tsx


def test_form_c_does_not_strip_unrelated_helper_var():
    """A `const root = …` declaration whose initializer is NOT
    ReactDOM.createRoot must survive — could be any other value named
    `root` for unrelated reasons."""
    src = (
        "function App() { return <div/>; }\n"
        "const root = computeRoot();\n"  # NOT ReactDOM.createRoot
        'ReactDOM.render(<App/>, document.getElementById("root"));\n'
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert "const root = computeRoot();" in result.tsx
    assert "ReactDOM.render" not in result.tsx


def test_form_c_false_positive_on_unknown_helper_is_ignored():
    """Any `<identifier>.render(<JSX/>)` whose identifier is NOT a
    known ReactDOM.createRoot helper must NOT be treated as a React
    bootstrap. Real-world risk: `stripeApi.render(<Form/>)`,
    `analytics.render(<Tag/>)`, custom SDKs, etc."""
    src = (
        "function Form() { return <input/>; }\n"
        "const stripeApi = StripeFactory();\n"  # NOT ReactDOM.createRoot
        "stripeApi.render(<Form/>);\n"  # MUST NOT be detected as a bootstrap
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    # No real bootstrap → empty tsx (fall-through sentinel).
    assert result.tsx == ""
    assert result.confidence == "low"
    assert any("no ReactDOM.render bootstrap found" in w for w in result.warnings)


def test_root_with_props_lowers_confidence_with_warning():
    """`ReactDOM.render(<App name='x'/>, …)` → wrapper synthesises
    `<App />` without the prop. Translator warns the user that the
    bootstrap-time props are dropped."""
    src = (
        "function App({name}) { return <h1>{name}</h1>; }\n"
        "ReactDOM.render(<App name='hello'/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.confidence == "low"
    assert any("declares props in the bootstrap call" in w for w in result.warnings)
    # The wrapper still emits — caller decides what to do with low confidence.
    assert "<App />" in result.tsx
    assert 'name=' not in result.tsx.split("function X()")[1]  # not in wrapper


def test_root_without_props_does_not_warn():
    """Negative case for the props warning — `<App />` (no attrs)
    must NOT trigger the prop-dropping warning."""
    src = (
        "function App() { return <h1/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.confidence == "high"
    assert not any("declares props" in w for w in result.warnings)


# ── Body preservation ────────────────────────────────────────────────────


def test_body_preserves_window_assignment_and_react_calls():
    """`window.X = X;` registrations and `React.useState` calls pass
    through untouched (the SDK exports React, hooks live on it)."""
    src = (
        "function Counter() {\n"
        "  const [n, setN] = React.useState(0);\n"
        "  return <button onClick={() => setN(n + 1)}>{n}</button>;\n"
        "}\n"
        "window.Counter = Counter;\n"
        'ReactDOM.render(<Counter/>, document.getElementById("root"));\n'
    )
    result = transform_jsx_to_tsx(src, component_name="App")
    assert "React.useState(0)" in result.tsx
    assert "window.Counter = Counter;" in result.tsx
    assert "ReactDOM.render" not in result.tsx


def test_body_preserves_destructured_react_hooks():
    """`const { useState } = React;` references the SDK-imported React
    namespace; we never inject hook imports separately."""
    src = (
        "const { useState, useEffect } = React;\n"
        "function App() {\n"
        "  const [n] = useState(0);\n"
        "  return <div>{n}</div>;\n"
        "}\n"
        'ReactDOM.render(<App/>, document.getElementById("root"));\n'
    )
    result = transform_jsx_to_tsx(src, component_name="Wrap")
    assert "const { useState, useEffect } = React;" in result.tsx
    assert result.confidence == "high"  # destructure of known hooks is fine


# ── Confidence-degrading signals ─────────────────────────────────────────


def test_es_import_lowers_confidence():
    src = (
        "import React from 'react';\n"
        "function App() { return <div/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.confidence == "low"
    assert any("ES `import`/`export`" in w for w in result.warnings)
    # The translator still emits TSX — workflow may or may not use it.
    assert result.tsx != ""


def test_typescript_interface_lowers_confidence():
    src = (
        "interface Props { name: string }\n"
        "function App(props: Props) { return <div>{props.name}</div>; }\n"
        "ReactDOM.render(<App name='x'/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.confidence == "low"
    assert any("TypeScript-only" in w for w in result.warnings)


def test_custom_element_tag_lowers_confidence():
    src = (
        "function App() { return <my-widget data-x='1'/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.confidence == "low"
    assert any("Custom element" in w for w in result.warnings)


def test_multiple_distinct_bootstrap_roots_lower_confidence():
    src = (
        "function App() { return <main/>; }\n"
        "function Panel() { return <aside/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
        "ReactDOM.render(<Panel/>, document.getElementById('side'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.confidence == "low"
    # The wrapper mounts the LAST distinct root.
    assert "<Panel />" in result.tsx
    assert any("Multiple bootstrap roots" in w for w in result.warnings)


def test_dynamic_dangerously_set_inner_html_lowers_confidence():
    src = (
        "function App({ html }) { return <div dangerouslySetInnerHTML={{ __html: html }}/>; }\n"
        "ReactDOM.render(<App html=''/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.confidence == "low"
    assert any("dangerouslySetInnerHTML" in w for w in result.warnings)


def test_literal_dangerously_set_inner_html_does_not_lower_confidence():
    """A literal `__html: '<svg>...</svg>'` is the source author's intent
    — translator should not flag it."""
    src = (
        "function App() { return <div dangerouslySetInnerHTML={{ __html: '<svg/>' }}/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.confidence == "high"


# ── Empty-tsx sentinel: no bootstrap → fall-through ──────────────────────


def test_no_bootstrap_returns_empty_tsx_with_warning():
    """When the source has no ReactDOM.* call, the translator returns
    empty tsx so the workflow can fall through to ComponentBuilder."""
    src = "function Helper() { return <div/>; }\n"
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.tsx == ""
    assert result.confidence == "low"
    assert any("no ReactDOM.render bootstrap found" in w for w in result.warnings)


def test_empty_input_returns_empty_tsx():
    result = transform_jsx_to_tsx("", component_name="X")
    assert result.tsx == ""
    assert result.confidence == "low"


def test_fragment_root_is_empty_tsx():
    """`ReactDOM.render(<>...</>, …)` — fragments have no single tag
    name, so the wrapper synthesis is impossible. Empty tsx + warning."""
    src = (
        "function App() { return <main/>; }\n"
        "ReactDOM.render(<><App/></>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="X")
    assert result.tsx == ""
    assert result.confidence == "low"
    assert any("not a single component element" in w for w in result.warnings)


# ── head_styles_css forwarding ───────────────────────────────────────────


def test_head_styles_css_rides_on_styles_css():
    src = (
        "function App() { return <div/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    head_css = "html, body { margin: 0; background: #6BB6FF; }"
    result = transform_jsx_to_tsx(src, component_name="X", head_styles_css=head_css)
    assert result.styles_css == head_css


# ── Real fixtures ────────────────────────────────────────────────────────


def test_platformer_fixture_translates_cleanly():
    """Concatenate the real Platformer JSX (game.jsx + tweaks-panel.jsx
    in script-tag order) and verify the translator produces a complete
    TSX module."""
    if not PLATFORMER_FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {PLATFORMER_FIXTURE_DIR}")
    # Same concat order the runner uses (DOM order from Bloop World.html:
    # tweaks-panel.jsx first, game.jsx second).
    tweaks = (PLATFORMER_FIXTURE_DIR / "tweaks-panel.jsx").read_text()
    game = (PLATFORMER_FIXTURE_DIR / "game.jsx").read_text()
    concat = (
        f"// === tweaks-panel.jsx ===\n{tweaks.rstrip()}\n\n"
        f"// === game.jsx ===\n{game.rstrip()}\n"
    )
    result = transform_jsx_to_tsx(concat, component_name="BloopWorldGame")

    # Bootstrap stripped, wrapper synthesised.
    assert "ReactDOM.render" not in result.tsx
    assert "ReactDOM.createRoot" not in result.tsx
    assert "function BloopWorldGame()" in result.tsx
    assert "export default BloopWorldGame;" in result.tsx
    # Both source files' bodies survived verbatim.
    assert "// === tweaks-panel.jsx ===" in result.tsx
    assert "// === game.jsx ===" in result.tsx
    # SDK import injected.
    assert 'import { React, LightDOMContainer } from "@exepad/sdk";' in result.tsx


def test_anima_fixture_translates_cleanly():
    """Anima pattern: many sibling helpers + a final inline App block
    carrying the bootstrap. Concatenated like the runner does it."""
    if not ANIMA_FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {ANIMA_FIXTURE_DIR}")
    # Pull the 17 sibling .jsx files in alphabetical-ish order matching
    # the HTML script-tag order.
    sibling_order = [
        "design-canvas.jsx",
        "v1-concentric.jsx",
        "v2-blueprint.jsx",
        "v3-wordmark.jsx",
        "v4-orbit.jsx",
        "v5-wave.jsx",
        "v6-line.jsx",
        "v7-numeric.jsx",
        "v8-light-blueprint.jsx",
        "v9-stack-weave.jsx",
        "v10-network.jsx",
        "v11-pillars.jsx",
        "v12-polygons.jsx",
        "v13-arcs.jsx",
        "v14-dotted-rings.jsx",
        "v15-wireframe-in.jsx",
        "v1b-ui-build.jsx",
    ]
    parts = []
    for name in sibling_order:
        body = (ANIMA_FIXTURE_DIR / name).read_text()
        parts.append(f"// === {name} ===\n{body.rstrip()}\n")
    # The inline App block (extracted from the HTML) — minimal real example.
    inline_app = (
        "// === [inline #1] from Exepad Build Animation.html ===\n"
        "const W = 760;\n"
        "const H = 520;\n"
        "function App() { return <DesignCanvas/>; }\n"
        'ReactDOM.createRoot(document.getElementById("root")).render(<App />);\n'
    )
    parts.append(inline_app)
    concat = "\n".join(parts)

    result = transform_jsx_to_tsx(concat, component_name="ExepadBuildAnimation")
    assert result.tsx != ""
    assert "function ExepadBuildAnimation()" in result.tsx
    assert "<App />" in result.tsx
    assert "ReactDOM.createRoot" not in result.tsx
    # All 17 helper component definitions survived (spot-check).
    assert "function V1Concentric" in result.tsx
    assert "function V15WireframeIn" in result.tsx
    assert "function DesignCanvas" in result.tsx
    # window.X = X registrations are kept (harmless after concat into one module).
    assert "window.V1Concentric = V1Concentric" in result.tsx


# ── esbuild compile gate ─────────────────────────────────────────────────


def test_translator_output_compiles_via_esbuild_simple_case():
    """The minimal Form A output must syntax-check via the same esbuild
    binary the validation pipeline uses. Skipped when esbuild is missing
    (dev); enforced in CI / Docker."""
    _esbuild_or_skip()
    src = (
        "function Game() { return <div>play</div>; }\n"
        'ReactDOM.render(<Game/>, document.getElementById("root"));\n'
    )
    result = transform_jsx_to_tsx(src, component_name="App")
    ok, errors = validate_tsx_syntax(result.tsx)
    assert ok, f"esbuild reported errors: {errors}"


def test_platformer_translator_output_compiles_via_esbuild():
    _esbuild_or_skip()
    if not PLATFORMER_FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {PLATFORMER_FIXTURE_DIR}")
    tweaks = (PLATFORMER_FIXTURE_DIR / "tweaks-panel.jsx").read_text()
    game = (PLATFORMER_FIXTURE_DIR / "game.jsx").read_text()
    concat = (
        f"// === tweaks-panel.jsx ===\n{tweaks.rstrip()}\n\n"
        f"// === game.jsx ===\n{game.rstrip()}\n"
    )
    result = transform_jsx_to_tsx(concat, component_name="BloopWorldGame")
    ok, errors = validate_tsx_syntax(result.tsx)
    assert ok, f"esbuild reported errors: {errors[:5]}"


# ── React-destructure dedupe ─────────────────────────────────────────────


def test_duplicate_shorthand_react_destructures_are_merged():
    """Two siblings with overlapping shorthand destructures must collapse
    into a single top-level ``const { ... } = React;`` line."""
    src = (
        "// === a.jsx ===\n"
        "const { useState, useEffect, useRef, useMemo } = React;\n"
        "function Helper() { const [x] = useState(0); return <div>{x}</div>; }\n\n"
        "// === b.jsx ===\n"
        "const { useState, useEffect } = React;\n"
        "function App() { return <Helper/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="MyApp")
    react_decls = [ln for ln in result.tsx.splitlines() if ln.strip().endswith("= React;")]
    assert len(react_decls) == 1, (
        f"Expected exactly one merged React destructure, got:\n  "
        + "\n  ".join(react_decls)
    )
    merged = react_decls[0]
    for name in ("useState", "useEffect", "useRef", "useMemo"):
        assert name in merged, f"Missing {name} in merged line: {merged!r}"
    assert any("Merged 2 duplicate" in w for w in result.warnings)


def test_aliased_react_destructures_are_folded_in():
    """Aliased forms (``{ useState: useStateS }``) introduce unique
    bindings. The merged line keeps both shorthand and pair entries."""
    src = (
        "// === a.jsx ===\n"
        "const { useState, useEffect } = React;\n"
        "function Helper() { return null; }\n\n"
        "// === b.jsx ===\n"
        "const { useState: useStateS } = React;\n"
        "function App() { return <Helper/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="MyApp")
    react_decls = [ln for ln in result.tsx.splitlines() if ln.strip().endswith("= React;")]
    assert len(react_decls) == 1, react_decls
    merged = react_decls[0]
    assert "useState" in merged and "useEffect" in merged
    assert "useState: useStateS" in merged, (
        f"Expected aliased binding preserved in merged line: {merged!r}"
    )


def test_disjoint_react_destructures_preserve_all_names():
    """When sibling destructures share zero binding names, the merged
    line must carry every binding (no dropping)."""
    src = (
        "const { useState } = React;\n"
        "const { useReducer } = React;\n"
        "function App() { return null; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="MyApp")
    react_decls = [ln for ln in result.tsx.splitlines() if ln.strip().endswith("= React;")]
    assert len(react_decls) == 1
    assert "useState" in react_decls[0]
    assert "useReducer" in react_decls[0]


def test_single_react_destructure_is_left_alone():
    """A lone destructure (the common Platformer case) is not rewritten —
    no warning, no merging, byte-stable output."""
    src = (
        "const { useState, useEffect } = React;\n"
        "function App() { const [x] = useState(0); return <div/>; }\n"
        "ReactDOM.render(<App/>, document.getElementById('root'));\n"
    )
    result = transform_jsx_to_tsx(src, component_name="MyApp")
    assert "const { useState, useEffect } = React;" in result.tsx
    assert not any("Merged" in w for w in result.warnings)


def test_school_dashboard_six_destructures_compile_via_esbuild():
    """End-to-end: simulate the School Dashboard fixture's concat order
    and verify the resulting TSX compiles. Six React destructures across
    the siblings — two shorthand (charts.jsx + inline App), four aliased
    (shell, page-overview, page-students, page-classes)."""
    _esbuild_or_skip()
    src = (
        "// === charts.jsx ===\n"
        "const { useState, useEffect, useRef, useMemo } = React;\n"
        "function LineChart() { return <svg/>; }\n\n"
        "// === shell.jsx ===\n"
        "const { useState: useStateS } = React;\n"
        "function Sidebar() { const [o] = useStateS(false); return <nav/>; }\n\n"
        "// === page-overview.jsx ===\n"
        "const { useState: useStateO } = React;\n"
        "function OverviewPage() { const [v] = useStateO(0); return <div/>; }\n\n"
        "// === page-students.jsx ===\n"
        "const { useState: useStateSt, useMemo: useMemoSt } = React;\n"
        "function StudentsPage() { return <div/>; }\n\n"
        "// === page-classes.jsx ===\n"
        "const { useState: useStateC } = React;\n"
        "function ClassesPage() { return <div/>; }\n\n"
        "// === [inline #1] from index.html ===\n"
        "const { useState, useEffect } = React;\n"
        "function App() { const [p] = useState('overview'); return <Sidebar/>; }\n"
        "ReactDOM.createRoot(document.getElementById('root')).render(<App/>);\n"
    )
    result = transform_jsx_to_tsx(src, component_name="SchoolDashboardShell")
    ok, errors = validate_tsx_syntax(result.tsx)
    assert ok, f"esbuild rejected merged output: {errors[:5]}"
    assert any("Merged 6 duplicate" in w for w in result.warnings)
