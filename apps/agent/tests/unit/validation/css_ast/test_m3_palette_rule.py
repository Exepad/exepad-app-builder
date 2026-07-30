"""`style.m3.palette_incomplete` — the write-time half of the palette contract.

This rule is what makes a bad palette RECOVERABLE. `save_style_artifact` feeds
rule errors back to the LLM and lets it retry, so catching it here turns
"terminal failure four minutes later, after the agent has moved on" into "fix
this and resubmit".

The gap it closes: the only rule that previously read the palette was
`M3ContrastPairsRule`, which delegates to `validate_contrast_pairs`, which opens
with `if color_values:`. An EMPTY palette therefore produced no findings and
passed — the one case guaranteed to break the deploy was the one case write-time
validation could not see.
"""

from __future__ import annotations

from main_agent.services.validation.css_ast import CssContext, parse_css
from main_agent.services.validation.css_ast.rules.default_set import theme_css_rules
from main_agent.services.validation.css_ast.rules.m3_palette import M3PaletteCompleteRule
from main_agent.services.validation.finding import run_rules
from main_agent.services.validation.style_coverage import M3_REQUIRED_PALETTE_TOKENS


def _ctx(css: str) -> CssContext:
    return CssContext(css=css, stylesheet=parse_css(css))


def _theme(body: str) -> str:
    return "@theme {\n" + body + "\n}"


def _full_palette(value: str = "#1B5E20") -> str:
    return _theme("\n".join(f"  --color-{t}: {value};" for t in sorted(M3_REQUIRED_PALETTE_TOKENS)))


def _findings(css: str) -> list:
    return list(M3PaletteCompleteRule().check(_ctx(css)))


class TestM3PaletteCompleteRule:
    def test_complete_hex_palette_passes(self):
        assert _findings(_full_palette()) == []

    def test_complete_oklch_palette_passes(self):
        # Accepted since the extractor understands oklch; the rule must agree.
        assert _findings(_full_palette("oklch(0.55 0.12 250)")) == []

    def test_unreadable_palette_is_an_error(self):
        findings = _findings(_theme("  --color-primary: var(--brand);"))
        assert len(findings) == 1
        assert findings[0].severity == "error"

    def test_unreadable_palette_names_the_real_problem(self):
        # "add 30 missing tokens" would send the model hunting for tokens it
        # already wrote. When NOTHING parsed, say so.
        msg = _findings(_theme("  --color-primary: var(--brand);"))[0].message
        assert "No colour tokens could be read" in msg
        assert "#" in msg, "the message should show the expected hex form"

    def test_partial_palette_lists_what_is_missing(self):
        css = _theme("  --color-primary: #1B5E20;\n  --color-surface: #FFFFFF;")
        msg = _findings(css)[0].message
        assert "Missing:" in msg
        # The list is capped at 6 for readability, so assert on the cap rather
        # than on a token that happens to fall outside the preview window.
        assert "and " in msg and " more" in msg
        assert "error" in msg  # first alphabetically, always in the preview

    def test_missing_count_is_reported(self):
        findings = _findings(_theme("  --color-primary: var(--x);"))
        assert str(len(M3_REQUIRED_PALETTE_TOKENS)) in findings[0].message


class TestRuleIsWiredIntoTheThemeRuleSet:
    """A rule that is not registered protects nothing."""

    def test_rule_is_in_theme_css_rules(self):
        ids = {r.id for r in theme_css_rules()}
        assert "style.m3.palette_incomplete" in ids

    def test_empty_palette_fails_the_full_rule_set(self):
        # The end-to-end assertion: this exact input used to pass every rule and
        # be saved as a "validated" artifact.
        css = (
            '@import "tailwindcss";\n'
            "@layer exepad-app {\n}\n"
            ":root {\n  --primary: 221 83% 53%;\n}\n"
            + _theme("  --color-primary: var(--brand);")
        )
        errors = [f for f in run_rules(_ctx(css), theme_css_rules()) if f.severity == "error"]
        assert any(f.rule_id == "style.m3.palette_incomplete" for f in errors)
