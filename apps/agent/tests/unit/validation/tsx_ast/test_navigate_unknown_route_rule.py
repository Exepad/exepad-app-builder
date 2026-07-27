"""Tests for ``NavigateUnknownRouteRule``.

``navigate("/X")`` target must be a declared page slug. Platform
pseudo-routes (``/logout``, ``/auth/...``) → error with the platform
logout pattern hint. Generic unknown slugs → warning. Dynamic
targets (template literals, function calls) → skipped.

Regression: app ``r3hfcgx5`` (2026-05-14) MainSidebar
``navigate("/logout")`` on a 7-page app without a ``/logout`` slug.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast import (
    AstContext,
    parse_tsx,
    run_rules,
    source_bytes,
)
from main_agent.services.validation.tsx_ast.rules.component_navigate_unknown_route import (
    NavigateUnknownRouteRule,
)


def _run(tsx: str, pages: list[str] | None = None) -> list:
    tree = parse_tsx(tsx)
    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        page_slugs=pages,
    )
    return list(run_rules(ctx, [NavigateUnknownRouteRule()]))


_NEXUS_PAGES = ["/", "/inventory", "/orders", "/partners", "/staff",
                "/feedback", "/settings"]


class TestNavigateUnknownRouteRule:
    def test_r3hfcgx5_logout_pseudo_route_error(self):
        tsx = """
function MainSidebar() {
  return (
    <button onClick={() => navigate("/logout")}>x</button>
  );
}
"""
        findings = _run(tsx, _NEXUS_PAGES)
        assert len(findings) == 1
        assert findings[0].severity == "error"
        assert "platform pseudo-route" in findings[0].message
        assert "auth_signout" in findings[0].message

    def test_known_route_silent(self):
        tsx = """
function X() {
  return <button onClick={() => navigate("/orders")}>x</button>;
}
"""
        findings = _run(tsx, _NEXUS_PAGES)
        assert findings == []

    def test_unknown_static_route_warning(self):
        tsx = """
function X() {
  return <button onClick={() => navigate("/recipes")}>x</button>;
}
"""
        findings = _run(tsx, _NEXUS_PAGES)
        assert len(findings) == 1
        assert findings[0].severity == "warning"
        assert "/recipes" in findings[0].message
        assert "/orders" in findings[0].message  # hint lists available

    def test_query_string_variant_of_known_slug_silent(self):
        tsx = """
function X() {
  return <a onClick={() => navigate("/orders?id=42")}>x</a>;
}
"""
        findings = _run(tsx, _NEXUS_PAGES)
        assert findings == []

    def test_dynamic_target_skipped(self):
        """Template-literal and identifier targets aren't analysable."""
        tsx = """
function X({ href }) {
  return (
    <>
      <a onClick={() => navigate(href)}>x</a>
      <a onClick={() => navigate(`/orders/${id}`)}>y</a>
    </>
  );
}
"""
        findings = _run(tsx, _NEXUS_PAGES)
        assert findings == []

    def test_root_route_recognised(self):
        tsx = """
function X() {
  return <button onClick={() => navigate("/")}>home</button>;
}
"""
        findings = _run(tsx, _NEXUS_PAGES)
        assert findings == []

    def test_other_pseudo_routes_blocked(self):
        for path in ("/sign-in", "/auth/logout", "/signup"):
            tsx = (
                "function X(){return <a onClick={() => "
                f'navigate("{path}")}}>x</a>;}}'
            )
            findings = _run(tsx, _NEXUS_PAGES)
            assert len(findings) == 1, f"expected error for {path}"
            assert findings[0].severity == "error", f"expected error for {path}"

    def test_no_page_slugs_fails_open(self):
        tsx = """
function X() {
  return <button onClick={() => navigate("/anywhere")}>x</button>;
}
"""
        assert _run(tsx, None) == []
        assert _run(tsx, []) == []

    def test_slug_with_leading_whitespace_in_pages_normalized(self):
        """Reconciler leaves ``" /"`` slug in plan output sometimes — the
        rule must normalize before comparing."""
        tsx = """
function X() {
  return <button onClick={() => navigate("/")}>x</button>;
}
"""
        findings = _run(tsx, [" /", "/inventory"])
        assert findings == []
