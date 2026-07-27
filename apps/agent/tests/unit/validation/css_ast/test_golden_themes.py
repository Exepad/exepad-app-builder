"""Golden-fixture tests for ``theme_css_rules()``.

Mirrors ``test_golden_components`` / ``test_golden_handlers``. Each
fixture drives the full 14-rule theme.css set through ``run_rules``
so the combined interactions (e.g. a missing ``@layer`` also
suppressing the ``directive-before-layer`` check) are exercised as
pipelines, not in isolation.

Correct fixtures must produce zero error findings. Broken fixtures
must fire every rule they were built to exercise. Known-false warning
paths (HSL warnings in a theme that already fails structural errors)
are accepted silently.
"""

from __future__ import annotations

from pathlib import Path

from main_agent.services.validation.css_ast import CssContext, parse_css
from main_agent.services.validation.css_ast.rules.default_set import theme_css_rules
from main_agent.services.validation.finding import run_rules

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


def _validate(css: str):
    stylesheet = parse_css(css)
    ctx = CssContext(css=css, stylesheet=stylesheet)
    findings = run_rules(ctx, theme_css_rules())
    errors = [f for f in findings if f.severity == "error"]
    warnings = [f for f in findings if f.severity == "warning"]
    return errors, warnings


class TestCorrectThemes:
    def test_correct_theme_minimal(self):
        errors, _ = _validate(_load("correct_theme_minimal.css"))
        assert errors == [], [e.message for e in errors]

    def test_correct_theme_v3_directives(self):
        errors, _ = _validate(_load("correct_theme_v3_directives.css"))
        assert errors == [], [e.message for e in errors]


class TestBrokenThemes:
    def test_broken_theme_kitchen_sink(self):
        errors, _ = _validate(_load("broken_theme_kitchen_sink.css"))
        ids = {e.rule_id for e in errors}
        assert "style.forbidden.host_selector" in ids
        assert "style.forbidden.font_face" in ids
        assert "style.forbidden.global_reset" in ids
        assert "style.forbidden.v3_tailwind_directive" in ids
        assert "style.forbidden.bootstrap_inside_layer" in ids
        assert "style.required.sdk_variables" in ids

    def test_broken_theme_missing_structure(self):
        errors, _ = _validate(_load("broken_theme_missing_structure.css"))
        ids = {e.rule_id for e in errors}
        assert "style.required.layer_exepad_app" in ids
        assert "style.required.tailwind_import" in ids
        assert "style.required.root_block" in ids

    def test_broken_theme_hsl_format(self):
        errors, warnings = _validate(_load("broken_theme_hsl_format.css"))
        # HSL format issues are advisory — every structural rule passes.
        assert errors == [], [e.message for e in errors]
        warning_ids = {w.rule_id for w in warnings}
        assert "style.hsl.hex_instead_of_hsl" in warning_ids
        assert "style.hsl.hsl_fn_wrapper" in warning_ids

    def test_broken_theme_contrast_fail(self):
        errors, _ = _validate(_load("broken_theme_contrast_fail.css"))
        ids = {e.rule_id for e in errors}
        assert "style.contrast.sdk_pairs" in ids
        assert "style.contrast.m3_pairs" in ids

    def test_broken_theme_missing_sdk_vars(self):
        errors, _ = _validate(_load("broken_theme_missing_sdk_vars.css"))
        ids = {e.rule_id for e in errors}
        assert "style.required.sdk_variables" in ids
