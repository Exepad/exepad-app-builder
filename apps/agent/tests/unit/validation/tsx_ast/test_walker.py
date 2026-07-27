"""Unit tests for ``tsx_ast.walker`` — the generic tree-sitter helpers."""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import (
    find_calls,
    find_by_type,
    has_template_substitution,
    string_literal_value,
    template_string_static_value,
)


def _parse(src):
    return parse_tsx(src), source_bytes(src)


class TestFindCalls:
    def test_finds_top_level_call(self):
        tree, _ = _parse("f(1, 2);")
        assert len(list(find_calls(tree.root_node))) == 1

    def test_finds_nested_calls(self):
        tree, _ = _parse("const x = ctx.db.prepare('s').bind(1).first();")
        # prepare, bind, first → 3 call expressions at various nesting levels.
        assert len(list(find_calls(tree.root_node))) == 3

    def test_find_by_type_string(self):
        tree, _ = _parse('const s = "hello";')
        strings = list(find_by_type(tree.root_node, "string"))
        assert len(strings) == 1


class TestStringExtraction:
    def test_plain_double_quoted(self):
        tree, buf = _parse('const s = "hello world";')
        strings = list(find_by_type(tree.root_node, "string"))
        assert string_literal_value(strings[0], buf) == "hello world"

    def test_single_quoted(self):
        tree, buf = _parse("const s = 'single';")
        strings = list(find_by_type(tree.root_node, "string"))
        assert string_literal_value(strings[0], buf) == "single"

    def test_returns_none_for_non_string(self):
        tree, buf = _parse("const x = 42;")
        for n in find_by_type(tree.root_node, "number"):
            assert string_literal_value(n, buf) is None


class TestTemplateStrings:
    def test_static_template_no_substitution(self):
        tree, buf = _parse("const s = `plain static`;")
        templates = list(find_by_type(tree.root_node, "template_string"))
        assert templates
        assert not has_template_substitution(templates[0])
        assert template_string_static_value(templates[0], buf) == "plain static"

    def test_template_with_substitution(self):
        tree, buf = _parse("const s = `hello ${name}`;")
        templates = list(find_by_type(tree.root_node, "template_string"))
        assert templates
        assert has_template_substitution(templates[0])
        assert template_string_static_value(templates[0], buf) is None
