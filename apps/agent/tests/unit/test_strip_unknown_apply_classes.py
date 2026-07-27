"""Tests for ``_strip_unknown_apply_classes``.

The deterministic recovery pass that strips ``@apply <class>`` declarations
when Tailwind reports the class doesn't exist. Production failure pattern:
``DesignSystemBuilder`` emits decorative helpers like
``.bento-card { @apply bg-card border border-border; }`` referencing shadcn
defaults that aren't present in the app's M3 ``@theme`` block.

Tailwind v3 wording: ``The `bg-card` class does not exist``
Tailwind v4 wording: ``Error: Cannot apply unknown utility class `bg-card```

Both must trigger the strip pass so the compile can recover without LLM
intervention. Failure to match v4 wording on the recipebox build (2026-05-12)
shipped the app with a missing ``compiled.css`` and 404s on every page.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.final_compile_gate import (
    _strip_unknown_apply_classes,
)

pytestmark = [pytest.mark.unit]


THEME_CSS = """\
@import "tailwindcss";
@source "./components";

@layer exepad-app {
  @theme {
    --color-primary: #D97706;
    --color-surface: #FFFBEB;
  }

  .bento-card {
    @apply bg-card rounded-xl border border-border shadow-sm;
  }

  .food-frame {
    @apply relative overflow-hidden rounded-xl border border-outline-variant/50;
  }
}
"""


class TestTailwindV3Wording:
    def test_strips_apply_line_for_v3_error(self):
        errors = ["The `bg-card` class does not exist"]
        out, stripped = _strip_unknown_apply_classes(THEME_CSS, errors)
        assert "bg-card" in stripped
        assert "@apply bg-card" not in out
        # Other lines untouched.
        assert ".food-frame" in out
        assert "--color-primary" in out


class TestTailwindV4Wording:
    """Tailwind v4 changed the wording — this regression killed i2nuznpc."""

    def test_strips_apply_line_for_v4_error(self):
        errors = ["Error: Cannot apply unknown utility class `bg-card`"]
        out, stripped = _strip_unknown_apply_classes(THEME_CSS, errors)
        assert "bg-card" in stripped, (
            "v4 error wording must trigger the strip pass; "
            "saw stripped=%r" % (stripped,)
        )
        assert "@apply bg-card" not in out

    def test_strips_multiple_v4_errors(self):
        errors = [
            "Error: Cannot apply unknown utility class `bg-card`",
            "Error: Cannot apply unknown utility class `border-border`",
        ]
        out, stripped = _strip_unknown_apply_classes(THEME_CSS, errors)
        assert set(stripped) >= {"bg-card", "border-border"}
        # Both unknown @apply lines stripped:
        assert "@apply bg-card" not in out
        assert "border-border" not in out
        # Valid lines preserved:
        assert "rounded-xl border border-outline-variant" in out

    def test_v3_and_v4_errors_in_same_batch(self):
        errors = [
            "The `bg-card` class does not exist",
            "Error: Cannot apply unknown utility class `border-border`",
        ]
        out, stripped = _strip_unknown_apply_classes(THEME_CSS, errors)
        assert set(stripped) >= {"bg-card", "border-border"}
