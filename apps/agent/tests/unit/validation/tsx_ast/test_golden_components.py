"""Golden-fixture tests for ``component_rules()``.

Mirrors ``test_golden_handlers`` for component TSX. Each fixture drives
the full ``component_rules()`` set through ``run_rules`` so the test
catches regressions the per-rule unit tests might miss when rules
interact (e.g. an AST-walker helper picks up a JSX tag both the
ShadowContainer rule and the SdkImportCompleteness rule care about).

Correct fixtures must produce zero errors. Broken fixtures must fire
every rule the fixture was built to exercise.
"""

from __future__ import annotations

from pathlib import Path

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.default_set import component_rules

FIXTURES = Path(__file__).parent / "fixtures"


def _load(name: str) -> str:
    return (FIXTURES / name).read_text()


def _validate(
    tsx: str,
    *,
    models: list[dict] | None = None,
    handlers: list[dict] | None = None,
    logic: dict | None = None,
    page_slugs: list[str] | None = None,
    expected_export_name: str | None = None,
):
    tree = parse_tsx(tsx)
    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        models=models or [],
        handlers=handlers,
        logic=logic,
        page_slugs=page_slugs,
        expected_export_name=expected_export_name,
    )
    findings = run_rules(ctx, component_rules())
    errors = [f for f in findings if f.severity == "error"]
    warnings = [f for f in findings if f.severity == "warning"]
    return errors, warnings


class TestCorrectComponents:
    """Every fixture must pass the full rule set with zero errors.

    Warnings are tolerated because several component rules (navigate,
    heading_order, raw_img_tag) are advisory.
    """

    def test_correct_component_basic(self):
        errors, _ = _validate(
            _load("correct_component_basic.tsx"),
            expected_export_name="Hero",
        )
        assert errors == [], [e.message for e in errors]

    def test_correct_component_with_refs(self):
        errors, _ = _validate(
            _load("correct_component_with_refs.tsx"),
            models=[{"name": "posts"}],
            handlers=[{"name": "fetchPosts"}],
            logic={"state": {"filter": None}},
            page_slugs=["/", "/posts"],
            expected_export_name="PostsList",
        )
        assert errors == [], [e.message for e in errors]


class TestBrokenComponents:
    """Every fixture here must fire the rules it was built to exercise."""

    def test_broken_component_hooks(self):
        errors, _ = _validate(
            _load("broken_component_hooks.tsx"),
            expected_export_name="HooksProblem",
        )
        ids = {e.rule_id for e in errors}
        assert "component.hooks.conditional" in ids
        assert "component.hooks.useapp_selector" in ids

    def test_broken_component_refs(self):
        # Most cross-reference rules (unknown model/handler/state/route)
        # were superseded by the tsc Stage-1.5 gate; only Icons stays
        # AST-checked. The fixture exercises Icons typo detection.
        errors, warnings = _validate(
            _load("broken_component_refs.tsx"),
            models=[{"name": "posts"}],
            handlers=[{"name": "fetchPosts"}],
            logic={"state": {"filter": None}},
            page_slugs=["/", "/posts"],
            expected_export_name="UnknownRefs",
        )
        # Phase 4 (severity policy): unknown_icon is now error-severity
        # because hallucinated icons render as ``undefined`` and crash the
        # page with React error #130. See docs/validation/severity-policy.md.
        error_ids = {e.rule_id for e in errors}
        assert "component.refs.unknown_icon" in error_ids

    def test_broken_component_a11y(self):
        errors, warnings = _validate(
            _load("broken_component_a11y.tsx"),
            expected_export_name="A11yProblem",
        )
        error_ids = {e.rule_id for e in errors}
        warning_ids = {w.rule_id for w in warnings}
        # Two-level heading skip → error.
        assert (
            "component.a11y.heading_order" in error_ids
            or "component.a11y.heading_order" in warning_ids
        )
        assert "component.a11y.button_aria_label" in warning_ids
        assert "component.a11y.dialog_description" in warning_ids

    def test_broken_component_jsx(self):
        errors, warnings = _validate(
            _load("broken_component_jsx.tsx"),
            expected_export_name="JsxProblem",
        )
        error_ids = {e.rule_id for e in errors}
        warning_ids = {w.rule_id for w in warnings}
        assert "component.imports.missing_sdk_export" in error_ids
        assert "component.jsx.raw_img_tag" in warning_ids

    def test_broken_component_export_name(self):
        errors, _ = _validate(
            _load("broken_component_export_name.tsx"),
            expected_export_name="ExpectedName",
        )
        ids = {e.rule_id for e in errors}
        assert "component.export.name_match" in ids
