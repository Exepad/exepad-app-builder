"""Unit tests for ``RawInternalAnchorRule`` — in-app navigation must use the SDK
``<Link to="…">`` rather than a raw ``<a href="/path">``.

Regression target: Cedar Ridge Lodge MainHeader (2026-07-25). Every nav item was
``<a href="/rooms" onClick={() => navigate("/rooms")}>``; measured in the browser
each resolved to ``https://localhost/rooms`` while the app was served at
``/a/preview-a4q2n7oeb/``. Left-click worked (the onClick routes), so the break
only showed on modifier-click / copy-link / crawlers.
"""

from __future__ import annotations

from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.base import AstContext
from main_agent.services.validation.tsx_ast.rules.component_raw_internal_anchor import (
    RawInternalAnchorRule,
)


def _findings(tsx: str) -> list:
    ctx = AstContext(tsx=tsx, source_buf=source_bytes(tsx), tree=parse_tsx(tsx))
    return list(RawInternalAnchorRule().check(ctx))


def test_cedar_ridge_header_regression():
    tsx = """
    function MainHeader() {
      return (
        <header>
          <a href="/" onClick={(e) => { e.preventDefault(); navigate("/"); }}>Home</a>
          <a href="/rooms" onClick={(e) => { e.preventDefault(); navigate("/rooms"); }}>Rooms</a>
        </header>
      );
    }
    """
    findings = _findings(tsx)
    assert len(findings) == 2
    assert "basePath" in findings[0].formatted_message()


def test_bare_internal_anchor_without_onclick_flagged():
    """Still broken — a full page load to the wrong origin path."""
    assert len(_findings('function C() { return <a href="/contact">Contact</a>; }')) == 1


def test_dynamic_href_with_navigate_flagged():
    tsx = """
    function C() {
      return links.map((link) => (
        <a href={link.slug} onClick={() => navigate(link.slug)}>{link.label}</a>
      ));
    }
    """
    assert len(_findings(tsx)) == 1


def test_dynamic_href_without_navigate_not_flagged():
    """Not statically knowable as in-app navigation — stay quiet."""
    tsx = "function C() { return <a href={item.url}>{item.label}</a>; }"
    assert _findings(tsx) == []


def test_external_and_scheme_links_not_flagged():
    tsx = """
    function C() {
      return (
        <div>
          <a href="https://example.com">site</a>
          <a href="//cdn.example.com/x">cdn</a>
          <a href="mailto:info@example.com">mail</a>
          <a href="tel:+15550100">call</a>
          <a href="#section">jump</a>
          <a href="relative/path">rel</a>
        </div>
      );
    }
    """
    assert _findings(tsx) == []


def test_new_tab_link_not_flagged():
    """target=_blank is a deliberate full navigation."""
    tsx = 'function C() { return <a href="/brochure" target="_blank">PDF</a>; }'
    assert _findings(tsx) == []


def test_sdk_link_component_not_flagged():
    """The correct form must stay silent (this is what the footer did)."""
    tsx = 'function C() { return <Link to="/rooms">Rooms</Link>; }'
    assert _findings(tsx) == []


def test_anchor_without_href_not_flagged():
    assert _findings("function C() { return <a onClick={go}>x</a>; }") == []
