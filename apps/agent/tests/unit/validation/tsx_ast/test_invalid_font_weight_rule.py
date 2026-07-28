"""Tests for ``InvalidFontWeightRule``.

Tailwind v4 numeric font-weight utilities (``font-100``…``font-900``)
are not in the default theme and silently no-op. The rule warns on
every occurrence; the companion auto-fixer ``component_typography``
rewrites the static cases. The rule is the surface for cases the
fixer can't reach (template-literal classNames with dynamic
interpolation).
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_invalid_font_weight import (
    InvalidFontWeightRule,
)


def _run(tsx: str) -> list[str]:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    findings = run_rules(ctx, [InvalidFontWeightRule()])
    return [f.message for f in findings]


class TestInvalidFontWeightRule:
    def test_font_700_warns(self):
        tsx = '''function H() {
  return <h1 className="font-headline font-700 text-4xl">x</h1>;
}
'''
        msgs = _run(tsx)
        assert len(msgs) == 1
        assert "font-700" in msgs[0]
        assert "font-bold" in msgs[0]

    def test_font_800_warns(self):
        tsx = '''function H() {
  return <h1 className="font-800 uppercase">x</h1>;
}
'''
        msgs = _run(tsx)
        assert len(msgs) == 1
        assert "font-800" in msgs[0]
        assert "font-extrabold" in msgs[0]

    def test_named_font_bold_silent(self):
        tsx = '''function H() {
  return (
    <div>
      <h1 className="font-bold text-4xl">x</h1>
      <p className="font-extrabold">y</p>
      <p className="font-normal">z</p>
    </div>
  );
}
'''
        assert _run(tsx) == []

    def test_arbitrary_form_silent(self):
        # `font-[700]` is a valid Tailwind arbitrary value — must not warn.
        tsx = '''function H() {
  return <h1 className="font-headline font-[700] text-4xl">x</h1>;
}
'''
        assert _run(tsx) == []

    def test_template_literal_static_warns(self):
        # Template literal whose cooked text statically contains font-700.
        tsx = (
            "function H() {\n"
            "  return <button className={`font-headline font-700 px-4`}>x</button>;\n"
            "}\n"
        )
        msgs = _run(tsx)
        assert len(msgs) == 1
        assert "font-700" in msgs[0]

    def test_dynamic_interpolation_silent(self):
        # `font-${weight}` — the rule only inspects the cooked literal
        # bytes; the substitution placeholder ``${weight}`` does not
        # match the regex, and the cooked text is just ``font-`` (no
        # numeric digits), so no warning fires.
        tsx = (
            "function H({weight}: {weight: number}) {\n"
            "  return <h1 className={`font-headline font-${weight} text-4xl`}>x</h1>;\n"
            "}\n"
        )
        assert _run(tsx) == []

    def test_multiple_occurrences_each_emit(self):
        tsx = '''function H() {
  return (
    <div>
      <h1 className="font-700 text-3xl">a</h1>
      <h2 className="font-800 text-2xl">b</h2>
      <p className="font-500 text-sm">c</p>
    </div>
  );
}
'''
        msgs = _run(tsx)
        assert len(msgs) == 3
        joined = " ".join(msgs)
        assert "font-700" in joined and "font-bold" in joined
        assert "font-800" in joined and "font-extrabold" in joined
        assert "font-500" in joined and "font-medium" in joined

    def test_does_not_match_unrelated_tokens(self):
        # ``--font-700: 700;`` is a CSS variable definition — NOT in a
        # className context, so the rule should not see it. The
        # className regex only matches inside JSX className attributes.
        tsx = '''function H() {
  return (
    <h1 className="font-bold" style={{ "--font-700": 700 } as any}>
      x
    </h1>
  );
}
'''
        assert _run(tsx) == []
