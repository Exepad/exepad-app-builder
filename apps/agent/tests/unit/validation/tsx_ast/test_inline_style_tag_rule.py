"""Tests for ``InlineStyleTagRule``.

Forbids raw ``<style>...</style>`` JSX elements in components. Code
Focus renders into the light DOM, so a raw ``<style>`` element
bypasses the ``@layer exepad-app`` scope and applies globally.

Regression: app ``r3hfcgx5`` (2026-05-14) MainSidebar embedded a
custom-scrollbar ``<style>{...}</style>`` to declare ``::-webkit-*``
pseudo-element rules.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_inline_style_tag import (
    InlineStyleTagRule,
)


def _run(tsx: str) -> list:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return list(run_rules(ctx, [InlineStyleTagRule()]))


class TestInlineStyleTagRule:
    def test_r3hfcgx5_custom_scrollbar_style_flagged(self):
        tsx = """
function MainSidebar() {
  return (
    <aside>
      <nav className="custom-scrollbar">...</nav>
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.05);
        }
      `}</style>
    </aside>
  );
}
"""
        findings = _run(tsx)
        assert len(findings) == 1
        assert findings[0].severity == "warning"

    def test_self_closing_style_also_flagged(self):
        tsx = """
function X() {
  return <style />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_style_attribute_silent(self):
        """``style={{...}}`` attribute form is the React idiom — NOT flagged."""
        tsx = """
function X() {
  return <div style={{ color: 'red' }}>hi</div>;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_pascalcase_styled_component_silent(self):
        """``<MyStyle>`` and ``<StyledBox>`` are user components, not <style>."""
        tsx = """
function X() {
  return (
    <>
      <MyStyle prop="x" />
      <StyledBox><span>x</span></StyledBox>
    </>
  );
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_multiple_style_tags_each_flagged(self):
        tsx = """
function X() {
  return (
    <>
      <style>{`a {color:red}`}</style>
      <p>x</p>
      <style>{`b {color:blue}`}</style>
    </>
  );
}
"""
        findings = _run(tsx)
        assert len(findings) == 2

    def test_no_style_element_silent(self):
        tsx = """
function X() {
  return <p className="text-primary">hi</p>;
}
"""
        findings = _run(tsx)
        assert findings == []
