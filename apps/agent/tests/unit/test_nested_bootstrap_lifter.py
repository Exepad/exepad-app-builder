"""Tests for _lift_nested_bootstrap_directives.

Tailwind v4 rejects `@source` nested in any layer (`@source cannot be
nested.`) and indirectly rejects `@import "tw-animate-css"` nested in a
layer (the imported package's `@utility` declarations end up nested,
producing `@utility cannot be nested.`).

The DesignImporter prompt currently teaches the LLM to wrap the bootstrap
inside `@layer exepad-app { ... }`. Until that is universally fixed, the
deterministic bootstrap-lifter pulls those directives back to the top of
the stylesheet before Tailwind compilation.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import pytest

from main_agent.services.validation.final_compile_gate import (
    _ensure_tailwind_bootstrap,
    _lift_nested_bootstrap_directives,
)
from tests._tailwind import find_tailwind_node_modules, find_tailwindcss_binary

pytestmark = [pytest.mark.unit]

FIXTURES = Path(__file__).parent / "validation" / "css_ast" / "fixtures"
DESIGN_IMPORT_FAILURE_FIXTURE = FIXTURES / "broken_theme_design_import_nested_bootstrap.css"


def _block_body(css: str, opener: str) -> str:
    start = css.index(opener)
    open_brace = css.index("{", start)
    depth = 0
    i = open_brace
    while i < len(css):
        ch = css[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return css[open_brace + 1 : i]
        i += 1
    raise AssertionError(f"unbalanced {opener}")


# ---------------------------------------------------------------------------
# Pure-Python lifter behavior
# ---------------------------------------------------------------------------


def test_lifts_full_bootstrap_out_of_exepad_layer():
    css = """\
@layer exepad-app {
  @import "tailwindcss";
  @import "tw-animate-css";
  @source "./components";
}

@theme {
  --color-primary: #000;
}
"""
    out, count = _lift_nested_bootstrap_directives(css)
    assert count == 3
    # All three directives now sit at the top of the file.
    assert out.startswith('@import "tailwindcss";')
    assert '@import "tw-animate-css";' in out.split("\n\n")[0]
    assert '@source "./components";' in out.split("\n\n")[0]
    # The exepad-app layer body is empty (or whitespace-only).
    assert _block_body(out, "@layer exepad-app").strip() == ""
    # @theme is preserved.
    assert "--color-primary: #000;" in out


def test_partial_lift_keeps_other_layer_contents():
    css = """\
@layer exepad-app {
  @import "tailwindcss";
  @source "./components";
  @theme { --color-primary: #000; }
}
"""
    out, count = _lift_nested_bootstrap_directives(css)
    assert count == 2
    layer_body = _block_body(out, "@layer exepad-app")
    assert "@import" not in layer_body
    assert "@source" not in layer_body
    assert "@theme { --color-primary: #000; }" in layer_body
    assert out.startswith('@import "tailwindcss";')
    assert '@source "./components";' in out


def test_already_top_level_returns_unchanged():
    css = """\
@import "tailwindcss";
@source "./components";

@layer exepad-app {
  @theme { --color-primary: #000; }
}
"""
    out, count = _lift_nested_bootstrap_directives(css)
    assert count == 0
    assert out == css


def test_idempotent_second_pass_is_noop():
    css = """\
@layer exepad-app {
  @import "tailwindcss";
  @source "./components";
}
"""
    once, count_once = _lift_nested_bootstrap_directives(css)
    assert count_once == 2
    twice, count_twice = _lift_nested_bootstrap_directives(once)
    assert count_twice == 0
    assert twice == once


def test_deduplicates_repeated_directive():
    # The LLM occasionally emits the same @import twice.
    css = """\
@layer exepad-app {
  @import "tailwindcss";
  @import "tailwindcss";
  @source "./components";
}
"""
    out, count = _lift_nested_bootstrap_directives(css)
    assert count == 3
    # Lifted directives are deduped.
    assert out.count('@import "tailwindcss";') == 1


def test_deduplicates_against_existing_top_level():
    # The LLM occasionally emits the bootstrap BOTH at the top level AND
    # nested. Lifting must not produce duplicate top-level directives.
    css = """\
@import "tailwindcss";
@layer exepad-app {
  @import "tailwindcss";
  @source "./components";
}
"""
    out, count = _lift_nested_bootstrap_directives(css)
    assert count == 2
    assert out.count('@import "tailwindcss";') == 1
    assert out.count('@source "./components";') == 1
    # Layer body no longer contains either directive.
    assert "@import" not in _block_body(out, "@layer exepad-app")
    assert "@source" not in _block_body(out, "@layer exepad-app")


def test_no_layer_returns_unchanged():
    css = '@import "tailwindcss";\n@theme { --color-primary: #000; }\n'
    out, count = _lift_nested_bootstrap_directives(css)
    assert count == 0
    assert out == css


def test_lifts_from_non_exepad_layer():
    css = """\
@layer base {
  @import "tw-animate-css";
}
"""
    out, count = _lift_nested_bootstrap_directives(css)
    assert count == 1
    assert out.startswith('@import "tw-animate-css";')
    assert "@import" not in _block_body(out, "@layer base")


# ---------------------------------------------------------------------------
# End-to-end: the captured failing fixture must compile after lift+bootstrap
# ---------------------------------------------------------------------------


def test_captured_failing_fixture_compiles_after_lift():
    """Reproduces the production failure and confirms the lifter heals it.

    Pinned fixture is the exact theme.css from the failed session
    (Session_f0be5c82586e4e26cb23e10c9452edf3, config
    d99d5ada-14b5-49e9-812d-2b0eab528181).
    """
    if not DESIGN_IMPORT_FAILURE_FIXTURE.exists():
        pytest.skip("Captured failure fixture not present")
    binary = find_tailwindcss_binary()
    if not binary:
        pytest.skip("tailwindcss CLI not available on this host")
    node_modules = find_tailwind_node_modules()
    if not node_modules:
        pytest.skip("tailwindcss + tw-animate-css node_modules not available")

    css = DESIGN_IMPORT_FAILURE_FIXTURE.read_text()

    with tempfile.TemporaryDirectory() as tmpdir:
        components = Path(tmpdir) / "components"
        components.mkdir()
        (components / "Sample.tsx").write_text(
            'export default function S(){return <div className="bg-primary p-4">x</div>}'
        )
        # Symlink node_modules so tw-animate-css resolves.
        os.symlink(node_modules, Path(tmpdir) / "node_modules")

        # 1) Confirm the raw fixture fails to compile (sanity check that the
        # fixture really reproduces the production error).
        raw = Path(tmpdir) / "raw.css"
        raw.write_text(css)
        out_raw = Path(tmpdir) / "raw_out.css"
        result = subprocess.run(
            [binary, "--input", str(raw), "--output", str(out_raw), "--cwd", tmpdir],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode != 0, "Fixture no longer reproduces the failure"
        assert "@utility" in result.stderr and "nested" in result.stderr.lower()

        # 2) Apply the lifter + bootstrap pipeline and confirm it now compiles.
        lifted, lift_count = _lift_nested_bootstrap_directives(css)
        assert lift_count == 3, "Expected to lift the 3 bootstrap directives"
        bootstrapped, _ = _ensure_tailwind_bootstrap(lifted)
        fixed = Path(tmpdir) / "fixed.css"
        fixed.write_text(bootstrapped)
        out_fixed = Path(tmpdir) / "fixed_out.css"
        result_fixed = subprocess.run(
            [binary, "--input", str(fixed), "--output", str(out_fixed), "--cwd", tmpdir],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert (
            result_fixed.returncode == 0
        ), f"Fixed CSS still fails to compile: {result_fixed.stderr}"
        compiled = out_fixed.read_text()
        # Real utilities ended up in the compiled output (sanity check that
        # the fix didn't accidentally turn off the content scan).
        assert "bg-primary" in compiled or ".bg-primary" in compiled
