"""Unit tests for theme.css AST validation (historic location).

The production validator is now the ``css_ast`` rule framework at
``services.validation.css_ast``. These tests keep their historic names
and assertions but call through a small adapter so we don't need to
rewrite every ``result.valid`` / ``result.errors`` check.
"""

from dataclasses import dataclass, field

import pytest

from main_agent.services.validation.css_ast import CssContext, parse_css
from main_agent.services.validation.css_ast.rules.default_set import theme_css_rules
from main_agent.services.validation.finding import run_rules


@dataclass
class _Result:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def valid(self) -> bool:
        return not self.errors


def validate_theme_css(css: str) -> _Result:
    """Adapter: runs the css_ast rule set and splits findings by severity.

    Returned object preserves the ``(valid, errors, warnings)`` surface
    every test in this file uses.
    """
    ctx = CssContext(css=css, stylesheet=parse_css(css))
    findings = run_rules(ctx, theme_css_rules())
    result = _Result()
    for f in findings:
        (result.errors if f.severity == "error" else result.warnings).append(f.message)
    return result


pytestmark = [pytest.mark.unit]

# =============================================================================
# Helpers
# =============================================================================

_ROOT_VARS = """\
:root {
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --primary: 221 83% 53%;
  --primary-foreground: 0 0% 100%;
  --secondary: 160 84% 39%;
  --secondary-foreground: 222 47% 11%;
  --destructive: 0 84% 45%;
  --destructive-foreground: 0 0% 100%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 20% 35%;
  --accent: 160 84% 39%;
  --accent-foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 221 83% 53%;
  --radius: 0.5rem;
  --sidebar-background: 222 47% 11%;
  --sidebar-foreground: 210 40% 98%;
  --sidebar-primary: 221 83% 53%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 217 33% 17%;
  --sidebar-accent-foreground: 210 40% 98%;
  --sidebar-border: 217 33% 17%;
  --sidebar-ring: 221 83% 53%;
}
"""

# v3-style theme (legacy, still accepted)
VALID_THEME_CSS = f"""\
@tailwind components;
@tailwind utilities;

@layer exepad-app {{
}}

{_ROOT_VARS}"""

# v4-style theme (preferred)
VALID_THEME_CSS_V4 = f"""\
@import "tailwindcss";

@layer exepad-app {{
}}

{_ROOT_VARS}"""

VALID_THEME_CSS_V4_WITH_THEME = f"""\
@import "tailwindcss";

@layer exepad-app {{
}}

@theme {{
  --color-primary: #7dd3fc;
  --color-on-primary: #1c1b1f;
  --color-secondary: #34d399;
  --color-on-secondary: #1c1b1f;
  --color-error: #dc2626;
  --color-on-error: #ffffff;
}}

{_ROOT_VARS}"""

# =============================================================================
# validate_theme_css
# =============================================================================


class TestValidateThemeCss:
    def test_valid_theme_passes(self):
        result = validate_theme_css(VALID_THEME_CSS)
        assert result.valid
        assert result.errors == []

    def test_host_selector_forbidden(self):
        css = ":host { color: red; }\n" + VALID_THEME_CSS
        result = validate_theme_css(css)
        assert not result.valid
        assert any(":host" in e for e in result.errors)

    def test_tailwind_base_forbidden(self):
        css = "@tailwind base;\n" + VALID_THEME_CSS
        result = validate_theme_css(css)
        assert not result.valid
        assert any("@tailwind base" in e for e in result.errors)

    def test_global_reset_forbidden(self):
        css = "*, *::before, *::after { margin: 0; padding: 0; }\n" + VALID_THEME_CSS
        result = validate_theme_css(css)
        assert not result.valid
        assert any("Global reset" in e for e in result.errors)

    def test_font_face_forbidden(self):
        css = "@font-face { font-family: 'Custom'; src: url('font.woff2'); }\n" + VALID_THEME_CSS
        result = validate_theme_css(css)
        assert not result.valid
        assert any("@font-face" in e for e in result.errors)

    def test_missing_layer_exepad_app(self):
        css = """\
@tailwind components;
@tailwind utilities;
:root { --background: 0 0% 100%; --foreground: 0 0% 0%; --primary: 0 0% 50%;
--primary-foreground: 0 0% 100%; --secondary: 0 0% 50%; --secondary-foreground: 0 0% 100%;
--destructive: 0 0% 50%; --destructive-foreground: 0 0% 100%; --muted: 0 0% 50%;
--muted-foreground: 0 0% 50%; --border: 0 0% 50%; --ring: 0 0% 50%; }
"""
        result = validate_theme_css(css)
        assert not result.valid
        assert any("@layer exepad-app" in e for e in result.errors)

    def test_missing_root_block(self):
        css = "@layer exepad-app { @tailwind components; @tailwind utilities; }"
        result = validate_theme_css(css)
        assert not result.valid
        assert any(":root" in e for e in result.errors)

    def test_missing_sdk_variables(self):
        css = """\
@layer exepad-app { @tailwind components; @tailwind utilities; }
:root { --background: 0 0% 100%; }
"""
        result = validate_theme_css(css)
        assert not result.valid
        assert any("Missing SDK CSS variables" in e for e in result.errors)

    def test_low_contrast_sdk_root_pair_is_error(self):
        css = VALID_THEME_CSS.replace("--primary: 221 83% 53%", "--primary: 210 40% 96%")
        result = validate_theme_css(css)
        assert not result.valid
        assert any('SDK "primary-foreground"' in e for e in result.errors)

    def test_hex_format_warning(self):
        css = VALID_THEME_CSS.replace("--background: 0 0% 100%", "--background: #ffffff")
        result = validate_theme_css(css)
        # Hex format is a warning, not an error
        assert any("hex format" in w for w in result.warnings)

    def test_hsl_wrapper_warning(self):
        css = VALID_THEME_CSS.replace("--background: 0 0% 100%", "--background: hsl(0, 0%, 100%)")
        result = validate_theme_css(css)
        assert any("hsl()" in w for w in result.warnings)

    # --- Tailwind v4 ---

    def test_v4_import_passes(self):
        result = validate_theme_css(VALID_THEME_CSS_V4)
        assert result.valid
        assert result.errors == []

    def test_v4_import_single_quotes_passes(self):
        css = VALID_THEME_CSS_V4.replace('"tailwindcss"', "'tailwindcss'")
        result = validate_theme_css(css)
        assert result.valid

    def test_light_primary_with_dark_on_primary_passes(self):
        result = validate_theme_css(VALID_THEME_CSS_V4_WITH_THEME)
        assert result.valid

    def test_light_primary_with_white_on_primary_fails(self):
        css = VALID_THEME_CSS_V4_WITH_THEME.replace(
            "--color-on-primary: #1c1b1f;",
            "--color-on-primary: #ffffff;",
        )
        result = validate_theme_css(css)
        assert not result.valid
        assert any('"on-primary"' in e for e in result.errors)

    def test_v4_import_inside_layer_forbidden(self):
        # Tailwind v4 inlines `@import "tw-animate-css"` content at the
        # import site; nesting `@import` inside `@layer` causes
        # `@utility cannot be nested.`. The same shape causes `@source
        # cannot be nested.`. The save-time validator must reject both.
        css = f'@layer exepad-app {{ @import "tailwindcss"; }}\n{_ROOT_VARS}'
        result = validate_theme_css(css)
        assert not result.valid
        assert any("OUTSIDE any @layer" in e or "cannot be nested" in e for e in result.errors)

    def test_v4_import_at_top_passes(self):
        # Mirror of the above — top-level placement is the canonical pattern.
        css = f'@import "tailwindcss";\n@layer exepad-app {{}}\n{_ROOT_VARS}'
        result = validate_theme_css(css)
        assert result.valid, result.errors

    def test_no_tailwind_directive_at_all(self):
        css = f"@layer exepad-app {{}}\n{_ROOT_VARS}"
        result = validate_theme_css(css)
        assert not result.valid
        assert any("Tailwind import" in e for e in result.errors)
