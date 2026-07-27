"""Unit tests for theme.css AST rules."""

from __future__ import annotations


from main_agent.services.validation.css_ast import CssContext, parse_css
from main_agent.services.validation.css_ast.rules.contrast import (
    M3ContrastPairsRule,
    SdkContrastPairsRule,
)
from main_agent.services.validation.css_ast.rules.default_set import theme_css_rules
from main_agent.services.validation.css_ast.rules.forbidden import (
    BootstrapInsideLayerRule,
    FontFaceRule,
    GlobalResetRule,
    HostSelectorRule,
    V3TailwindBaseRule,
)
from main_agent.services.validation.css_ast.rules.hsl_format import (
    HslFnWrapperRule,
    HslHexInsteadRule,
)
from main_agent.services.validation.css_ast.rules.required import (
    LayerExepadAppRule,
    RootBlockRule,
    SdkVariablesRule,
    TailwindImportRule,
)
from main_agent.services.validation.finding import run_rules

_MINIMAL_VALID = """
@import "tailwindcss";

@layer exepad-app {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 0%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 0%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 0%;
    --primary: 0 0% 0%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 0%;
    --secondary-foreground: 0 0% 100%;
    --destructive: 0 0% 0%;
    --destructive-foreground: 0 0% 100%;
    --muted: 0 0% 0%;
    --muted-foreground: 0 0% 100%;
    --accent: 0 0% 0%;
    --accent-foreground: 0 0% 100%;
    --border: 214 32% 91%;
    --input: 214 32% 91%;
    --ring: 221 83% 53%;
    --radius: 0.5rem;
    --sidebar-background: 0 0% 0%;
    --sidebar-foreground: 0 0% 100%;
    --sidebar-primary: 0 0% 0%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 0 0% 0%;
    --sidebar-accent-foreground: 0 0% 100%;
    --sidebar-border: 214 32% 91%;
    --sidebar-ring: 221 83% 53%;
  }
}
"""


def _run(rule, css: str):
    stylesheet = parse_css(css)
    ctx = CssContext(css=css, stylesheet=stylesheet)
    return [f.formatted_message() for f in run_rules(ctx, [rule])]


class TestHostSelectorRule:
    def test_host_flagged(self):
        findings = _run(HostSelectorRule(), ":host { color: red; }")
        assert len(findings) == 1
        assert ":host selector is forbidden" in findings[0]

    def test_ok_without_host(self):
        assert _run(HostSelectorRule(), "div { color: red; }") == []


class TestV3TailwindBaseRule:
    def test_flagged(self):
        findings = _run(V3TailwindBaseRule(), "@tailwind base;")
        assert len(findings) == 1

    def test_ok_when_only_components_utilities(self):
        # ``@tailwind components`` is allowed (v3 syntax for those directives
        # is fine inside @layer); only ``@tailwind base`` is forbidden.
        assert _run(V3TailwindBaseRule(), "@tailwind components;") == []


class TestGlobalResetRule:
    def test_flagged(self):
        css = "* , *::before , *::after { margin: 0; padding: 0; }"
        findings = _run(GlobalResetRule(), css)
        assert len(findings) == 1

    def test_ok_without_reset(self):
        assert _run(GlobalResetRule(), "body { margin: 0; }") == []


class TestFontFaceRule:
    def test_flagged(self):
        findings = _run(
            FontFaceRule(),
            "@font-face { font-family: 'X'; src: url(x.woff); }",
        )
        assert len(findings) == 1

    def test_ok(self):
        assert _run(FontFaceRule(), ":root { --font: 'Inter'; }") == []


class TestBootstrapInsideLayerRule:
    def test_flagged_v4_import_inside_layer(self):
        css = '@layer exepad-app { @import "tailwindcss"; }'
        findings = _run(BootstrapInsideLayerRule(), css)
        assert len(findings) == 1

    def test_flagged_source_inside_layer(self):
        css = '@layer exepad-app { @source "./components"; }'
        findings = _run(BootstrapInsideLayerRule(), css)
        assert len(findings) == 1

    def test_flagged_inside_other_layer_name(self):
        # Any @layer counts — Tailwind doesn't care about the layer's name.
        css = '@layer base { @import "tw-animate-css"; }'
        findings = _run(BootstrapInsideLayerRule(), css)
        assert len(findings) == 1

    def test_ok_when_top_level(self):
        css = '@import "tailwindcss";\n@layer exepad-app { :root { --x: 0; } }'
        assert _run(BootstrapInsideLayerRule(), css) == []

    def test_ok_with_no_layer(self):
        css = '@import "tailwindcss";\n:root { --x: 0; }'
        assert _run(BootstrapInsideLayerRule(), css) == []


class TestLayerExepadAppRule:
    def test_flagged_when_absent(self):
        assert len(_run(LayerExepadAppRule(), ":root { --x: 0; }")) == 1

    def test_ok_when_present(self):
        css = "@layer exepad-app { }"
        assert _run(LayerExepadAppRule(), css) == []


class TestTailwindImportRule:
    def test_flagged_when_absent(self):
        css = "@layer exepad-app { :root { --x: 0; } }"
        assert len(_run(TailwindImportRule(), css)) == 1

    def test_ok_v4(self):
        css = '@layer exepad-app { @import "tailwindcss"; }'
        assert _run(TailwindImportRule(), css) == []

    def test_ok_v3_components_plus_utilities(self):
        css = "@layer exepad-app {\n" "  @tailwind components;\n" "  @tailwind utilities;\n" "}"
        assert _run(TailwindImportRule(), css) == []


class TestRootBlockRule:
    def test_flagged_when_absent(self):
        assert len(_run(RootBlockRule(), "@layer exepad-app { }")) == 1

    def test_ok_top_level(self):
        assert _run(RootBlockRule(), ":root { --x: 0; }") == []

    def test_ok_nested_in_layer(self):
        css = "@layer exepad-app { :root { --x: 0; } }"
        assert _run(RootBlockRule(), css) == []


class TestSdkVariablesRule:
    def test_flagged_when_missing(self):
        css = ":root { --background: 0 0% 100%; }"
        findings = _run(SdkVariablesRule(), css)
        assert len(findings) == 1
        assert "Missing SDK CSS variables" in findings[0]

    def test_ok_when_complete(self):
        assert _run(SdkVariablesRule(), _MINIMAL_VALID) == []


class TestHslFormatRules:
    def test_hex_instead_flagged(self):
        css = ":root { --background: #ffffff; }"
        findings = _run(HslHexInsteadRule(), css)
        assert len(findings) == 1
        assert "hex format" in findings[0]

    def test_hsl_fn_wrapper_flagged(self):
        css = ":root { --foreground: hsl(0, 0%, 10%); }"
        findings = _run(HslFnWrapperRule(), css)
        assert len(findings) == 1
        assert "hsl() wrapper" in findings[0]

    def test_space_separated_ok(self):
        css = ":root { --primary: 221 83% 53%; }"
        assert _run(HslHexInsteadRule(), css) == []
        assert _run(HslFnWrapperRule(), css) == []


class TestContrastPairs:
    """Contrast rules actually measure WCAG AA ratios — assert they fire
    on genuinely bad pairs and stay silent on high-contrast ones."""

    _BAD_SDK_ROOT = """
@layer exepad-app {
  @import "tailwindcss";
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 0%;
    --card: 0 0% 100%;
    --card-foreground: 0 0% 0%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 0%;
    --primary: 210 40% 96%;
    --primary-foreground: 0 0% 100%;
    --secondary: 0 0% 0%;
    --secondary-foreground: 0 0% 100%;
    --destructive: 0 0% 0%;
    --destructive-foreground: 0 0% 100%;
    --muted: 0 0% 0%;
    --muted-foreground: 0 0% 100%;
    --accent: 0 0% 0%;
    --accent-foreground: 0 0% 100%;
    --border: 214 32% 91%;
    --input: 214 32% 91%;
    --ring: 221 83% 53%;
    --radius: 0.5rem;
    --sidebar-background: 0 0% 0%;
    --sidebar-foreground: 0 0% 100%;
    --sidebar-primary: 0 0% 0%;
    --sidebar-primary-foreground: 0 0% 100%;
    --sidebar-accent: 0 0% 0%;
    --sidebar-accent-foreground: 0 0% 100%;
    --sidebar-border: 214 32% 91%;
    --sidebar-ring: 221 83% 53%;
  }
}
"""

    _BAD_M3_THEME = """
@layer exepad-app { @import "tailwindcss"; }
@theme {
  --color-primary: #dbeafe;
  --color-on-primary: #ffffff;
  --color-secondary: #000000;
  --color-on-secondary: #ffffff;
  --color-error: #000000;
  --color-on-error: #ffffff;
}
:root {
  --background: 0 0% 100%; --foreground: 0 0% 0%;
  --card: 0 0% 100%; --card-foreground: 0 0% 0%;
  --popover: 0 0% 100%; --popover-foreground: 0 0% 0%;
  --primary: 0 0% 0%; --primary-foreground: 0 0% 100%;
  --secondary: 0 0% 0%; --secondary-foreground: 0 0% 100%;
  --destructive: 0 0% 0%; --destructive-foreground: 0 0% 100%;
  --muted: 0 0% 0%; --muted-foreground: 0 0% 100%;
  --accent: 0 0% 0%; --accent-foreground: 0 0% 100%;
  --border: 214 32% 91%; --input: 214 32% 91%;
  --ring: 221 83% 53%; --radius: 0.5rem;
  --sidebar-background: 0 0% 0%; --sidebar-foreground: 0 0% 100%;
  --sidebar-primary: 0 0% 0%; --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 0 0% 0%; --sidebar-accent-foreground: 0 0% 100%;
  --sidebar-border: 214 32% 91%; --sidebar-ring: 221 83% 53%;
}
"""

    def test_high_contrast_sdk_pairs_produce_no_findings(self):
        # ``_MINIMAL_VALID`` uses pure black/white pairings — 21:1 ratio.
        assert _run(SdkContrastPairsRule(), _MINIMAL_VALID) == []

    def test_high_contrast_m3_pairs_produce_no_findings(self):
        assert _run(M3ContrastPairsRule(), _MINIMAL_VALID) == []

    def test_low_contrast_sdk_root_pair_flagged(self):
        findings = _run(SdkContrastPairsRule(), self._BAD_SDK_ROOT)
        assert any('SDK "primary-foreground"' in f for f in findings), findings

    def test_low_contrast_m3_pair_flagged(self):
        findings = _run(M3ContrastPairsRule(), self._BAD_M3_THEME)
        # ``on-primary`` = white on ``primary`` = #dbeafe (pale blue) = ~1.22:1.
        assert any('"on-primary"' in f for f in findings), findings


class TestGoldenMinimalValid:
    """The known-good fixture should pass EVERY error rule."""

    def test_no_errors(self):
        stylesheet = parse_css(_MINIMAL_VALID)
        ctx = CssContext(css=_MINIMAL_VALID, stylesheet=stylesheet)
        findings = run_rules(ctx, theme_css_rules())
        errors = [f for f in findings if f.severity == "error"]
        assert errors == [], "valid theme should produce zero error findings"


class TestBrokenKitchenSink:
    """A theme.css with every forbidden pattern should flag each of them."""

    CSS = """
:host { color: red; }
@font-face { font-family: 'X'; src: url(x.woff); }
* , *::before , *::after { margin: 0; padding: 0; }
@tailwind base;
@layer exepad-app {
  @import "tailwindcss";
  @source "./components";
  :root { --background: 0 0% 100%; }
}
"""

    def test_every_forbidden_rule_fires(self):
        stylesheet = parse_css(self.CSS)
        ctx = CssContext(css=self.CSS, stylesheet=stylesheet)
        findings = run_rules(ctx, theme_css_rules())
        ids = {f.rule_id for f in findings}
        assert "style.forbidden.host_selector" in ids
        assert "style.forbidden.font_face" in ids
        assert "style.forbidden.global_reset" in ids
        assert "style.forbidden.v3_tailwind_directive" in ids
        assert "style.forbidden.bootstrap_inside_layer" in ids
        assert "style.required.sdk_variables" in ids
