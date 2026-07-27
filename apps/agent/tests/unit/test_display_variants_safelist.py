"""Tests for the bare display-utility safelist in ``final_compile_gate``.

Tailwind v4's content scanner is unreliable for bare display utilities
(``md:flex``, ``md:hidden`` etc.) when they sit next to hyphenated siblings
like ``md:flex-col`` in the same className. The gate injects a synthetic TSX
file (``_display_variants.tsx``) that lists each utility explicitly so the
scanner picks it up regardless.

Reproduced 2026-05-15 on app ``pnkndvyy``: MainSidebar emitted
``"hidden md:flex flex-col h-full ..."``; compiled.css shipped
``.md\\:flex-row{...}`` but NOT ``.md\\:flex{display:flex}``. The sidebar
resolved to ``display: none`` at every breakpoint.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from main_agent.services.validation import final_compile_gate
from main_agent.services.validation.final_compile_gate import (
    _DISPLAY_VARIANTS_TSX,
    run_final_compile_gate,
)

pytestmark = [pytest.mark.unit]


class TestDisplayVariantsConstant:
    """The constant must enumerate every bare display utility we ship to
    components, including the pnkndvyy regression case ``md:flex``."""

    def test_contains_md_flex(self):
        """The specific class that failed on pnkndvyy."""
        assert 'className="md:flex"' in _DISPLAY_VARIANTS_TSX

    def test_contains_full_breakpoint_x_display_matrix(self):
        """Every {breakpoint × display} combination must be enumerated.

        Without this, future regressions on a different breakpoint+display
        pair would slip through the same way ``md:flex`` did.
        """
        breakpoints = ["sm", "md", "lg", "xl", "2xl"]
        displays = ["flex", "block", "inline", "inline-block", "grid", "hidden"]
        for bp in breakpoints:
            for d in displays:
                cls = f'className="{bp}:{d}"'
                assert cls in _DISPLAY_VARIANTS_TSX, f"missing {bp}:{d}"
        # Plus the un-prefixed forms.
        for d in displays:
            assert f'className="{d}"' in _DISPLAY_VARIANTS_TSX, f"missing {d}"


class TestDisplayVariantsWrittenToCompileDir:
    """The gate must stage ``_display_variants.tsx`` next to component
    sources so Tailwind's content scanner sees it during the compile."""

    def test_safelist_file_present_in_compile_dir(self):
        """Stub the actual tailwind invocation; assert the synthetic file
        landed alongside the real components. Read the file body inside
        the stub before the gate's tempdir is torn down."""
        captured = {}

        def fake_compile(tsx_dir: str, base_path: str, css_output: str):
            captured["tsx_dir"] = tsx_dir
            captured["files"] = sorted(os.listdir(tsx_dir))
            safelist_path = os.path.join(tsx_dir, "_display_variants.tsx")
            if os.path.exists(safelist_path):
                with open(safelist_path, encoding="utf-8") as f:
                    captured["safelist_body"] = f.read()
            return True, "/* compiled */", []

        with patch.object(final_compile_gate, "_compile_css", side_effect=fake_compile):
            result = run_final_compile_gate(
                theme_css=(
                    '@import "tailwindcss";\n'
                    '@import "tw-animate-css";\n'
                    '@source "./components";\n'
                    "@theme { --color-primary: #000; }\n"
                ),
                tsx_sources={
                    "MainSidebar": '<nav className="hidden md:flex flex-col">x</nav>',
                },
            )

        assert result.success
        assert "_display_variants.tsx" in captured["files"]
        assert "_sdk_overlay_classes.tsx" in captured["files"]
        assert "MainSidebar.tsx" in captured["files"]
        # The safelist file's content must include the bare-display utilities
        # the scanner needs.
        body = captured.get("safelist_body", "")
        assert 'className="md:flex"' in body
        assert 'className="md:hidden"' in body
