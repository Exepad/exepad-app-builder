"""Unit tests for component hook-safety rules."""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_hooks import (
    ConditionalHooksRule,
    HooksAfterEarlyReturnRule,
    UseAppSelectorRule,
)


def _run(rule, tsx: str):
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return [f.formatted_message() for f in run_rules(ctx, [rule])]


class TestConditionalHooksRule:
    def test_happy_path_top_level_hook(self):
        tsx = """
export default function Foo() {
  const count = useApp(s => s.count);
  return <div>{count}</div>;
}
"""
        assert _run(ConditionalHooksRule(), tsx) == []

    def test_ternary_hook_flagged(self):
        tsx = """
export default function Foo() {
  const x = cond ? useApp(s => s.a) : null;
  return <div/>;
}
"""
        findings = _run(ConditionalHooksRule(), tsx)
        assert len(findings) == 1
        assert "ternary" in findings[0]

    def test_and_short_circuit_flagged(self):
        tsx = """
export default function Foo() {
  const x = cond && useApp(s => s.a);
  return <div/>;
}
"""
        findings = _run(ConditionalHooksRule(), tsx)
        assert len(findings) == 1
        assert "&&" in findings[0]

    def test_or_short_circuit_flagged(self):
        tsx = """
export default function Foo() {
  const x = cond || useApp(s => s.a);
  return <div/>;
}
"""
        findings = _run(ConditionalHooksRule(), tsx)
        assert len(findings) == 1
        assert "||" in findings[0]

    def test_non_hook_named_call_not_flagged(self):
        # ``useful()`` doesn't follow ``useX`` (second char must be upper).
        tsx = """
export default function Foo() {
  const x = cond ? useful() : null;
  return <div/>;
}
"""
        assert _run(ConditionalHooksRule(), tsx) == []


class TestHooksAfterEarlyReturnRule:
    def test_hook_after_early_return_flagged(self):
        # The DashboardContent crash pattern: useMemo after `if (loading) return`.
        tsx = """
export default function Dashboard() {
  const { data, loading } = useModel("recipes", {});
  const [cat, setCat] = useState("all");
  if (loading) {
    return <div>Loading…</div>;
  }
  const breakdown = useMemo(() => data.length, [data]);
  return <div>{breakdown}</div>;
}
"""
        findings = _run(HooksAfterEarlyReturnRule(), tsx)
        assert len(findings) == 1
        assert "useMemo" in findings[0]
        assert "early return" in findings[0]

    def test_all_hooks_before_return_ok(self):
        tsx = """
export default function Dashboard() {
  const { data, loading } = useModel("recipes", {});
  const breakdown = useMemo(() => (data || []).length, [data]);
  if (loading) return <div>Loading…</div>;
  if (!data) return <div>Empty</div>;
  return <div>{breakdown}</div>;
}
"""
        assert _run(HooksAfterEarlyReturnRule(), tsx) == []

    def test_inline_return_guard_flagged(self):
        # Bare `if (x) return y;` (no block) still establishes the boundary.
        tsx = """
export default function Foo() {
  const a = useModel("x", {});
  if (a.loading) return <span/>;
  const b = useHandler("getStats");
  return <div/>;
}
"""
        findings = _run(HooksAfterEarlyReturnRule(), tsx)
        assert len(findings) == 1
        assert "useHandler" in findings[0]

    def test_if_without_return_is_not_a_boundary(self):
        # An `if` that doesn't return doesn't gate later hooks.
        tsx = """
export default function Foo() {
  const a = useModel("x", {});
  if (a.error) { doSomething(); }
  const b = useMemo(() => 1, []);
  return <div/>;
}
"""
        assert _run(HooksAfterEarlyReturnRule(), tsx) == []

    def test_hook_inside_nested_callback_after_return_not_flagged(self):
        # The useMemo arg arrow / callbacks are not component-body hooks; this
        # rule only governs top-level body hooks. (useState here is illegal for
        # other reasons, but not THIS rule's concern.)
        tsx = """
export default function Foo() {
  const a = useModel("x", {});
  if (a.loading) return <span/>;
  return <button onClick={() => { const [s] = useState(0); }}>x</button>;
}
"""
        assert _run(HooksAfterEarlyReturnRule(), tsx) == []

    def test_custom_hook_function_also_checked(self):
        tsx = """
function useThing() {
  const [a, setA] = useState(0);
  if (a > 1) return a;
  const b = useMemo(() => a * 2, [a]);
  return b;
}
"""
        findings = _run(HooksAfterEarlyReturnRule(), tsx)
        assert len(findings) == 1
        assert "useMemo" in findings[0]

    def test_non_component_function_with_return_no_hooks_ok(self):
        # A plain helper with early returns but no hooks isn't touched.
        tsx = """
export default function Foo() {
  const a = useModel("x", {});
  const fmt = (s) => { if (!s) return ""; return s.trim(); };
  return <div>{fmt(a.name)}</div>;
}
"""
        assert _run(HooksAfterEarlyReturnRule(), tsx) == []


class TestUseAppSelectorRule:
    def test_happy_path_key_selector(self):
        tsx = """
export default function Foo() {
  const count = useApp(s => s.count);
  return <div>{count}</div>;
}
"""
        assert _run(UseAppSelectorRule(), tsx) == []

    def test_no_selector_flagged(self):
        tsx = """
export default function Foo() {
  const app = useApp();
  return <div/>;
}
"""
        findings = _run(UseAppSelectorRule(), tsx)
        assert len(findings) == 1
        assert "without selector" in findings[0]

    def test_inline_object_selector_flagged(self):
        tsx = """
export default function Foo() {
  const { a, b } = useApp(s => ({ a: s.a, b: s.b }));
  return <div/>;
}
"""
        findings = _run(UseAppSelectorRule(), tsx)
        assert len(findings) == 1
        assert "inline object selector" in findings[0]

    def test_parenthesized_non_object_selector_ok(self):
        # ``useApp(s => (s.value))`` — wrapped identifier, not an object —
        # stays silent.
        tsx = """
export default function Foo() {
  const v = useApp(s => (s.value));
  return <div/>;
}
"""
        assert _run(UseAppSelectorRule(), tsx) == []
