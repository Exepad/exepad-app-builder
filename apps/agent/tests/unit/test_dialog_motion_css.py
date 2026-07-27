"""Tests for the dialog-motion CSS injected by ``final_compile_gate``.

The SDK Dialog/AlertDialog panels no longer hardcode a tw-animate-css enter
animation. Instead they carry ``.exepad-dialog-content`` (+ an optional
``data-exepad-motion`` preset) and the gate injects the actual enter/exit
keyframes into every app's Tailwind compile input. The animation is driven by
the app's design tokens (``--animation-scale-enter`` / ``--animation-slide-enter``
/ ``--animation-duration`` / ``--animation-ease``) so each app's modals animate
with a distinct personality, and a per-dialog ``motion`` prop overrides the
default via the ``data-exepad-motion`` presets.

Two contracts pinned here:
  1. the constant defines the keyframes + all presets, and
  2. the gate appends it to the *compile input* (base.css) — NOT to the stored
     theme.css (``rewritten_theme_css``), so it can't compound across edits.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from main_agent.services.validation import final_compile_gate
from main_agent.services.validation.final_compile_gate import (
    _DIALOG_MOTION_CSS,
    _base_css_for_compile,
    run_final_compile_gate,
)

pytestmark = [pytest.mark.unit]


class TestDialogMotionConstant:
    """The constant must supply the keyframes, the token fallbacks, and every
    ``motion`` preset the SDK can emit."""

    def test_defines_enter_and_exit_keyframes(self):
        assert "@keyframes exepad-dialog-enter" in _DIALOG_MOTION_CSS
        assert "@keyframes exepad-dialog-exit" in _DIALOG_MOTION_CSS

    def test_binds_the_content_hook_class_to_data_state(self):
        assert '.exepad-dialog-content[data-state="open"]' in _DIALOG_MOTION_CSS
        assert '.exepad-dialog-content[data-state="closed"]' in _DIALOG_MOTION_CSS

    def test_consumes_the_design_tokens_with_fallbacks(self):
        # Per-app personality: scale/slide/duration/ease tokens must be read,
        # each with a literal fallback so a token-less theme still animates.
        assert "var(--animation-scale-enter, 0.95)" in _DIALOG_MOTION_CSS
        assert "var(--animation-slide-enter, 8px)" in _DIALOG_MOTION_CSS
        assert "var(--animation-duration, 200ms)" in _DIALOG_MOTION_CSS
        assert "var(--animation-ease," in _DIALOG_MOTION_CSS

    def test_defines_every_motion_preset(self):
        for preset in ("fade", "zoom", "scale", "pop", "slide-up", "slide-down", "none"):
            assert (
                f'[data-exepad-motion="{preset}"]' in _DIALOG_MOTION_CSS
            ), f"missing preset {preset}"

    def test_honours_reduced_motion(self):
        assert "prefers-reduced-motion: reduce" in _DIALOG_MOTION_CSS

    def test_base_css_for_compile_appends_motion_without_mutating_input(self):
        theme = "@theme { --color-primary: #000; }"
        combined = _base_css_for_compile(theme)
        assert combined.startswith(theme)
        assert _DIALOG_MOTION_CSS in combined


class TestDialogMotionInjectedIntoCompileInput:
    """The gate must append the motion CSS to base.css (the compile input) but
    keep the stored theme.css clean."""

    def test_motion_css_present_in_compile_input_only(self):
        captured = {}

        def fake_compile(tsx_dir: str, base_path: str, css_output: str):
            with open(base_path, encoding="utf-8") as f:
                captured["base_css"] = f.read()
            return True, "/* compiled */", []

        theme_css = (
            '@import "tailwindcss";\n'
            '@import "tw-animate-css";\n'
            '@source "./components";\n'
            "@theme { --color-primary: #000; }\n"
        )

        with patch.object(final_compile_gate, "_compile_css", side_effect=fake_compile):
            result = run_final_compile_gate(
                theme_css=theme_css,
                tsx_sources={
                    "Modal": (
                        '<DialogContent className="exepad-dialog-content" '
                        'data-exepad-motion="slide-up">x</DialogContent>'
                    ),
                },
            )

        assert result.success
        # The compile input carries the keyframes + presets...
        assert "@keyframes exepad-dialog-enter" in captured["base_css"]
        assert '[data-exepad-motion="slide-up"]' in captured["base_css"]
        # ...but a clean compile leaves theme.css untouched (no rewrite), so the
        # motion block never accumulates in the stored artifact.
        assert result.rewritten_theme_css is None
