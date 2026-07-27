"""Unit tests for ``component.export.name_match``."""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_structure import (
    ComponentExportNameRule,
)


def _run(tsx: str, expected: str | None):
    tree = parse_tsx(tsx)
    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        expected_export_name=expected,
    )
    return [f.formatted_message() for f in run_rules(ctx, [ComponentExportNameRule()])]


class TestComponentExportNameRule:
    def test_match_ok(self):
        assert _run("export default function MyWidget() { return null; }", "MyWidget") == []

    def test_mismatch(self):
        findings = _run("export default function Widget() { return null; }", "MyWidget")
        assert len(findings) == 1
        assert "Widget" in findings[0] and "MyWidget" in findings[0]

    def test_no_expected_name_disables_rule(self):
        # When the save tool has no expected name we stay silent rather
        # than guess; the rule is advisory for that caller.
        assert _run("export default function Anything() { return null; }", None) == []

    def test_non_function_export_silent(self):
        # ``export default SomeVar`` — not a named function declaration,
        # so the rule can't make a deterministic call. Stay silent.
        assert _run("const Foo = () => null;\nexport default Foo;", "Bar") == []

    def test_default_class_export_silent(self):
        # ``export default class`` is not a function_declaration. The rule
        # only fires on the function form, so a class default export must
        # not trigger a (potentially wrong) name-mismatch warning.
        assert _run("export default class Widget {}", "MyWidget") == []

    def test_named_export_alongside_default_function_only_default_checked(self):
        # The rule walks every ``export_statement`` but only inspects the
        # one with the ``default`` keyword. A sibling named export with a
        # different identifier must not be flagged.
        tsx = (
            "export const Helper = () => null;\n"
            "export default function Widget() { return null; }\n"
        )
        assert _run(tsx, "Widget") == []

    def test_anonymous_default_function_silent(self):
        # ``export default function () { ... }`` has no name field. The
        # rule walks ``child_by_field_name("name")`` and silently exits
        # when it returns None — saves a false-positive on the LLM's
        # occasional anonymous-function form.
        assert _run("export default function () { return null; }", "Widget") == []

    def test_arrow_function_default_export_silent(self):
        # ``export default () => ...`` is an expression, not a
        # function_declaration. Stay silent — the AST handler can't make
        # a deterministic call about the intended name.
        assert _run("export default () => null;", "Widget") == []

    def test_empty_tsx_silent(self):
        # No exports at all — the walker finds nothing and the rule
        # produces no findings.
        assert _run("", "Widget") == []
        assert _run("// just a comment", "Widget") == []
