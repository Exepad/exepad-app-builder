"""Tests for generated theme.css contrast validation and auto-fix."""

import pytest

from main_agent.services.validation.style_coverage import (
    auto_fix_contrast_pairs,
    validate_contrast_pairs,
)

pytestmark = [pytest.mark.unit]


def test_sdk_root_low_contrast_pair_is_detected():
    css = """
@layer exepad-app { @import "tailwindcss"; }
@theme {
  --color-primary: #dbeafe;
  --color-on-primary: #111827;
}
:root {
  --primary: 214 95% 93%;
  --primary-foreground: 0 0% 100%;
}
"""
    warnings = validate_contrast_pairs(css)
    assert any('SDK "primary-foreground"' in w for w in warnings)


def test_auto_fix_updates_m3_and_sdk_root_pairs():
    css = """
@layer exepad-app { @import "tailwindcss"; }
@theme {
  --color-primary: #dbeafe;
  --color-on-primary: #ffffff;
}
:root {
  --primary: 214 95% 93%;
  --primary-foreground: 0 0% 100%;
}
"""
    fixed = auto_fix_contrast_pairs(css)
    assert fixed is not None
    assert "--color-on-primary: #1C1B1F" in fixed
    assert "--primary-foreground: 255 7% 11%" in fixed
    assert validate_contrast_pairs(fixed) == []
