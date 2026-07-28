"""Unit tests for the AST-based useApp destructure fixer."""

from __future__ import annotations

from main_agent.services.validation.fixers import rewrite_useapp_destructures


class TestBareUseAppDestructure:
    def test_single_name_rewritten(self):
        src = "const { count } = useApp();"
        out, fixes = rewrite_useapp_destructures(src)
        assert "const count = useApp(s => s.count);" in out
        assert "{ count }" not in out
        assert any("bare useApp()" in f for f in fixes)

    def test_multi_name_rewritten(self):
        src = "const { count, name, setState } = useApp();"
        out, fixes = rewrite_useapp_destructures(src)
        assert "const count = useApp(s => s.count);" in out
        assert "const name = useApp(s => s.name);" in out
        assert "const setState = useApp(s => s.setState);" in out
        assert any("3 individual calls" in f for f in fixes)

    def test_aliased_destructure_rewritten(self):
        src = "const { count: total } = useApp();"
        out, _ = rewrite_useapp_destructures(src)
        assert "const total = useApp(s => s.count);" in out

    def test_no_useApp_untouched(self):
        src = "const { a } = other();"
        out, fixes = rewrite_useapp_destructures(src)
        assert out == src
        assert fixes == []


class TestInlineObjectSelector:
    def test_simple_inline_rewritten(self):
        src = "const { a, b } = useApp(s => ({ a: s.a, b: s.b }));"
        out, fixes = rewrite_useapp_destructures(src)
        assert "const a = useApp(s => s.a);" in out
        assert "const b = useApp(s => s.b);" in out
        assert any("inline object selector" in f for f in fixes)

    def test_parens_param_rewritten(self):
        src = "const { a } = useApp((state) => ({ a: state.a }));"
        out, _ = rewrite_useapp_destructures(src)
        assert "const a = useApp(s => s.a);" in out

    def test_aliased_inline_pair(self):
        src = "const { dispatch: dispatchX } = useApp(s => ({ dispatch: s.dispatch }));"
        out, _ = rewrite_useapp_destructures(src)
        assert "const dispatchX = useApp(s => s.dispatch);" in out

    def test_computed_value_declined(self):
        """Rewriting computed selectors would drop information — decline."""
        src = "const { total } = useApp(s => ({ total: s.price * s.quantity }));"
        out, fixes = rewrite_useapp_destructures(src)
        assert out == src
        assert fixes == []

    def test_destructure_missing_keys_declined(self):
        """``{ a, b }`` but selector only provides ``a`` → decline."""
        src = "const { a, b } = useApp(s => ({ a: s.a }));"
        out, fixes = rewrite_useapp_destructures(src)
        assert out == src
        assert fixes == []


class TestRobustness:
    def test_multi_line_destructure_rewritten(self):
        src = "const {\n" "  count,\n" "  name,\n" "} = useApp();"
        out, _ = rewrite_useapp_destructures(src)
        assert "const count = useApp(s => s.count);" in out
        assert "const name = useApp(s => s.name);" in out

    def test_selector_call_unchanged(self):
        """Existing per-key selectors are already correct — don't re-write."""
        src = "const count = useApp(s => s.count);"
        out, fixes = rewrite_useapp_destructures(src)
        assert out == src
        assert fixes == []

    def test_non_usemodel_destructure_unchanged(self):
        src = "const { data } = useModel('posts');"
        out, fixes = rewrite_useapp_destructures(src)
        assert out == src
        assert fixes == []

    def test_two_destructures_both_rewritten(self):
        src = "const { a } = useApp();\n" "const { b } = useApp(s => ({ b: s.b }));"
        out, _ = rewrite_useapp_destructures(src)
        assert "const a = useApp(s => s.a);" in out
        assert "const b = useApp(s => s.b);" in out
