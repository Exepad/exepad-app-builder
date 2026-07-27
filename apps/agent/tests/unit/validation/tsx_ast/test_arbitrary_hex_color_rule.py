"""Tests for ``ArbitraryHexColorRule``.

Forbids ``bg-[#hex]`` / ``text-[#hex]`` / ``border-[#hex]`` arbitrary
Tailwind classes in component classNames. Output renders correctly,
but bypassing the M3 theme means theme swaps and rebrands silently
no-op on these classes.

Regression: app ``r3hfcgx5`` (2026-05-14) OrdersContent status badges
hand-coded with ``bg-[#0d9488]`` / ``bg-[#2563eb]`` / ``bg-[#64748b]``
/ ``bg-[#dc2626]`` / ``bg-[#f59e0b]``.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_arbitrary_hex_color import (
    ArbitraryHexColorRule,
)


def _run(tsx: str) -> list:
    tree = parse_tsx(tsx)
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=tree)
    return list(run_rules(ctx, [ArbitraryHexColorRule()]))


class TestArbitraryHexColorRule:
    def test_r3hfcgx5_status_badges_flagged(self):
        tsx = """
function Badges() {
  return (
    <>
      <Badge className="bg-[#0d9488] text-white">Paid</Badge>
      <Badge className="bg-[#2563eb] text-white">Shipped</Badge>
      <Badge className="bg-[#64748b] text-white">Delivered</Badge>
      <Badge className="bg-[#dc2626] text-white">Refunded</Badge>
      <Badge className="bg-[#f59e0b] text-white">Pending</Badge>
    </>
  );
}
"""
        findings = _run(tsx)
        assert len(findings) == 5
        for f in findings:
            assert f.severity == "warning"
            assert "arbitrary hex" in f.message

    def test_text_arbitrary_hex_flagged(self):
        tsx = """
function X() {
  return <p className="text-[#1c1b1f]">x</p>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_border_arbitrary_hex_flagged(self):
        tsx = """
function X() {
  return <div className="border border-[#abc]" />;
}
"""
        findings = _run(tsx)
        assert len(findings) == 1

    def test_variant_chain_still_flagged(self):
        """Variants like ``hover:`` / ``md:`` / ``dark:`` don't cloak the issue."""
        tsx = """
function X() {
  return <button className="bg-primary hover:bg-[#0a6e66] md:dark:bg-[#0e7d72]">x</button>;
}
"""
        findings = _run(tsx)
        assert len(findings) == 2

    def test_theme_token_silent(self):
        tsx = """
function X() {
  return (
    <Badge className="bg-primary text-on-primary">
      <span className="text-secondary border-outline-variant">x</span>
    </Badge>
  );
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_arbitrary_non_color_token_silent(self):
        """``rounded-[4px]`` and other arbitrary non-color tokens not flagged."""
        tsx = """
function X() {
  return <div className="rounded-[4px] p-[6px] gap-[10px]" />;
}
"""
        findings = _run(tsx)
        assert findings == []

    def test_rgb_or_hsl_silent_intentional(self):
        """Out of scope: arbitrary ``rgb(...)`` / ``hsl(...)`` not flagged."""
        tsx = """
function X() {
  return <div className="bg-[rgb(var(--my-color))] text-[hsl(0,100%,50%)]" />;
}
"""
        findings = _run(tsx)
        assert findings == []
