"""Unit tests for the chrome-strip per-role fallback selectors in
``decomposition/runner.py::_chrome_fallback_selectors``.

The bug this catches
--------------------

App ``rdzn62gx`` (2026-05-16, Stitch chick-farm import). The LLM
emitted ``ChromeRegion(role='header', selector='header')`` because the
home page used ``<header>`` at the top level. But About/Products/Contact
pages used a bare top-level ``<nav class="fixed top-0 ...">`` instead of
``<header>`` — so the literal selector silently no-op'd on those three
pages and shipped the inline nav alongside the shared MainHeader.

The fix added per-role fallback selectors so the strip pass tries
sensible alternatives even when the LLM picks the wrong tag for the
canonical page. These tests pin both shapes — literal selector AND
fallback firing on a non-matching page.
"""

from __future__ import annotations

from main_agent.agents.orchestrator.importers.tools.decomposition.html_cleaner import (
    extract_body,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.runner import (
    _chrome_fallback_selectors,
)


# ---------------------------------------------------------------------------
# Fallback-selector catalogue smoke tests.
# ---------------------------------------------------------------------------


def test_header_role_fallbacks_include_nav_fixed() -> None:
    fb = _chrome_fallback_selectors("header")
    assert "header" in fb
    assert any("nav[class*='fixed top-0']" in s for s in fb)


def test_footer_role_fallbacks_include_footer_tag() -> None:
    fb = _chrome_fallback_selectors("footer")
    assert "footer" in fb


def test_unknown_role_returns_empty() -> None:
    assert _chrome_fallback_selectors("mystery") == ()


# ---------------------------------------------------------------------------
# End-to-end: the rdzn62gx regression — `<nav class="fixed top-0">` page
# must get its inline nav stripped when fallback fires alongside the
# LLM's literal selector.
# ---------------------------------------------------------------------------


def test_fallback_strips_nav_fixed_top_0_when_literal_misses() -> None:
    """About-us page shape from rdzn62gx — top-level <nav> instead of <header>.

    The LLM-supplied `selector` was `"header"` (because home page used
    <header>). With ONLY the literal selector, this About page's nav
    survives → duplicate-nav UI. With the fallback `nav[class*='fixed
    top-0']` added, the nav is stripped.
    """
    about_html = (
        '<body>'
        '<div class="bg-surface text-on-surface">'
        '<nav class="fixed top-0 w-full z-50 bg-surface/80 backdrop-blur-md shadow-sm">'
        '<a href="#">Home</a><a href="#">Products</a>'
        '</nav>'
        '<main><h1>About Us</h1></main>'
        '</div>'
        '</body>'
    )
    selectors = ["header"] + list(_chrome_fallback_selectors("header"))
    cleaned = extract_body(about_html, extra_remove_selectors=selectors)

    assert "fixed top-0" not in cleaned, (
        "fallback nav[class*='fixed top-0'] should have stripped the inline nav"
    )
    assert "<h1>About Us</h1>" in cleaned, "page content must survive the strip"


def test_literal_header_still_strips_home_page() -> None:
    """Sanity: the LLM's literal `header` selector still works on pages
    that DO use <header> at the top level."""
    home_html = (
        '<body>'
        '<div class="bg-surface">'
        '<header class="fixed top-0"><nav><a href="#">Home</a></nav></header>'
        '<main><h1>Home</h1></main>'
        '</div>'
        '</body>'
    )
    selectors = ["header"] + list(_chrome_fallback_selectors("header"))
    cleaned = extract_body(home_html, extra_remove_selectors=selectors)

    assert "<header" not in cleaned
    assert "<h1>Home</h1>" in cleaned


def test_fallback_does_not_strip_non_chrome_nav() -> None:
    """A decorative in-body <nav> that ISN'T site chrome must survive the strip.

    The fallback selector `nav[class*='fixed top-0']` is intentionally
    narrow — it only matches fixed-top sticky navs, NOT bare or
    body-level navs (like a sub-nav inside a sidebar or breadcrumb).
    """
    page_html = (
        '<body>'
        '<main>'
        '<nav class="flex gap-4"><a href="#">Section A</a><a href="#">Section B</a></nav>'
        '<article>Content</article>'
        '</main>'
        '</body>'
    )
    selectors = ["header"] + list(_chrome_fallback_selectors("header"))
    cleaned = extract_body(page_html, extra_remove_selectors=selectors)

    # The decorative in-body <nav> should still be present.
    assert '<nav class="flex gap-4">' in cleaned
    assert "Section A" in cleaned


def test_footer_fallback_strips_bare_footer_tag() -> None:
    page_html = (
        '<body>'
        '<main>Body</main>'
        '<footer class="bg-surface-container">© 2026</footer>'
        '</body>'
    )
    # Simulate the LLM picking a too-specific selector that misses;
    # fallback "footer" should catch.
    selectors = ["footer.site-footer"] + list(_chrome_fallback_selectors("footer"))
    cleaned = extract_body(page_html, extra_remove_selectors=selectors)
    assert "<footer" not in cleaned
    assert "Body" in cleaned
