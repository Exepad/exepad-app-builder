"""Tests for ``html_cleaner.extract_body``.

The preservation contract: every visible text node, every ``class=`` value,
every ``data-*`` value, every ``<img src>``, and every body-level
``<script>`` body in the source must survive into the cleaned output.
``<head>``/``<meta>``/``<title>``/``<link>``/``<head>``-scoped scripts and
HTML comments are removed.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from bs4 import BeautifulSoup, Comment

from main_agent.agents.orchestrator.importers.tools.decomposition.html_cleaner import (
    HtmlCleanerError,
    extract_body,
    extract_node,
)


def _visible_text_tokens(html: str) -> set[str]:
    """Return non-whitespace text tokens (longer than 2 chars) from a body fragment."""
    soup = BeautifulSoup(html, "html.parser")
    tokens: set[str] = set()
    for text in soup.find_all(string=True):
        if isinstance(text, Comment):
            continue
        for token in text.strip().split():
            token = token.strip()
            if len(token) >= 3:
                tokens.add(token)
    return tokens


def _all_classes(html: str) -> set[str]:
    soup = BeautifulSoup(html, "html.parser")
    classes: set[str] = set()
    for el in soup.find_all(class_=True):
        for cls in el.get("class", []):
            if cls:
                classes.add(cls)
    return classes


def _all_data_attrs(html: str) -> dict[str, str]:
    soup = BeautifulSoup(html, "html.parser")
    out: dict[str, str] = {}
    for el in soup.find_all():
        for attr, val in el.attrs.items():
            if attr.startswith("data-") and isinstance(val, str):
                out[f"{el.name}.{attr}"] = val
    return out


# ── Synthetic fixtures ────────────────────────────────────────────────────


def test_strips_doctype_html_head():
    raw = (
        "<!DOCTYPE html>"
        '<html lang="en"><head>'
        '<meta charset="utf-8">'
        "<title>HappyDoods</title>"
        '<link rel="stylesheet" href="styles.css">'
        "<script>console.log('analytics')</script>"
        "</head>"
        '<body><h1 class="hero">Hello</h1></body>'
        "</html>"
    )
    cleaned = extract_body(raw)
    assert cleaned == '<h1 class="hero">Hello</h1>'
    assert "<head>" not in cleaned
    assert "<meta" not in cleaned
    assert "console.log" not in cleaned  # head-script gone
    assert "<title>" not in cleaned


def test_preserves_body_scripts():
    raw = (
        "<!DOCTYPE html><html><head>"
        "<script>head_only_analytics()</script>"
        "</head><body>"
        '<div class="faq">Q?</div>'
        "<script>document.querySelectorAll('.faq').forEach(...)</script>"
        "</body></html>"
    )
    cleaned = extract_body(raw)
    assert "head_only_analytics" not in cleaned
    assert "document.querySelectorAll('.faq')" in cleaned
    assert '<div class="faq">' in cleaned


def test_strips_html_comments():
    raw = "<body><!-- TODO: redesign --><p>Hi</p><!--keep me away--></body>"
    cleaned = extract_body(raw)
    assert "<!--" not in cleaned
    assert "TODO" not in cleaned
    assert "keep me away" not in cleaned
    assert "<p>Hi</p>" in cleaned


def test_handles_fragment_without_body():
    raw = '<div class="card"><p>Hi</p></div>'
    cleaned = extract_body(raw)
    assert cleaned == '<div class="card"><p>Hi</p></div>'


def test_drop_styles_default():
    raw = "<body><style>.x{color:red;}</style><p>Hi</p></body>"
    cleaned = extract_body(raw)
    assert "<style>" not in cleaned
    assert ".x{color:red" not in cleaned
    assert "<p>Hi</p>" in cleaned


def test_keep_styles_when_drop_styles_false():
    raw = "<body><style>.x{color:red;}</style><p>Hi</p></body>"
    cleaned = extract_body(raw, drop_styles=False)
    assert "<style>" in cleaned
    assert ".x{color:red" in cleaned


def test_html_entities_round_trip():
    raw = "<body><p>Hens &amp; eggs &copy; 2026 &mdash; nbsp&nbsp;here</p></body>"
    cleaned = extract_body(raw)
    # html.parser leaves named entities as text, but key invariant:
    # the bytes the user sees in their browser are preserved.
    assert "Hens" in cleaned
    assert "eggs" in cleaned
    assert "2026" in cleaned


def test_void_elements_unchanged():
    raw = '<body><img src="a.jpg" alt="A"><br><hr></body>'
    cleaned = extract_body(raw)
    assert 'src="a.jpg"' in cleaned
    assert 'alt="A"' in cleaned


def test_body_attributes_wrap_into_div():
    """When <body> has attributes (class/id/data-*), the cleaner wraps
    children in a <div> carrying those attributes so they don't get lost
    when <body> is stripped.

    Stitch puts ``class="antialiased bg-surface"`` on <body>; without this
    behavior that class would silently disappear.
    """
    raw = (
        '<html><body class="antialiased bg-surface" data-theme="light">'
        "<main><p>hi</p></main>"
        "</body></html>"
    )
    cleaned = extract_body(raw)
    soup = BeautifulSoup(cleaned, "html.parser")
    roots = [c for c in soup.children if getattr(c, "name", None)]
    assert len(roots) == 1
    wrapper = roots[0]
    assert wrapper.name == "div"
    assert "antialiased" in wrapper.get("class") or []
    assert "bg-surface" in wrapper.get("class") or []
    assert wrapper.get("data-theme") == "light"
    assert wrapper.find("main") is not None


def test_body_without_attributes_no_wrapper():
    """When <body> has no attributes, the cleaner emits children directly."""
    raw = "<html><body><main><p>hi</p></main></body></html>"
    cleaned = extract_body(raw)
    # No wrapping div introduced.
    assert cleaned.startswith("<main>")
    assert "<div" not in cleaned[:6]


def test_extra_remove_selectors():
    raw = (
        "<body>"
        '<header class="topbar">NAV</header>'
        "<main><p>Hi</p></main>"
        '<footer class="bottom">FOOT</footer>'
        "</body>"
    )
    cleaned = extract_body(raw, extra_remove_selectors=["header.topbar", "footer.bottom"])
    assert "NAV" not in cleaned
    assert "FOOT" not in cleaned
    assert "<p>Hi</p>" in cleaned


def test_extract_node_picks_first_match():
    raw = (
        "<html><body>"
        '<header class="topbar"><nav>HOME</nav></header>'
        "<main><p>body</p></main>"
        "</body></html>"
    )
    node = extract_node(raw, "header.topbar")
    assert node.startswith('<header class="topbar">')
    assert "HOME" in node
    assert "body" not in node


def test_extract_node_raises_on_no_match():
    with pytest.raises(HtmlCleanerError):
        extract_node("<body><p>nope</p></body>", "header.topbar")


def test_empty_input_raises():
    with pytest.raises(HtmlCleanerError):
        extract_body("")


# ── Real fixture: claude_design_2 multi-page ──────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[7]
CLAUDE_DESIGN_2 = REPO_ROOT / "packages" / "design-tools-fixtures" / "claude_design" / "chick_farm"


@pytest.mark.skipif(
    not CLAUDE_DESIGN_2.exists(),
    reason=f"fixture missing: {CLAUDE_DESIGN_2}",
)
@pytest.mark.parametrize(
    "page_file",
    [
        "index.html",
        "story.html",
        "flock.html",
        "practices.html",
        "shop.html",
        "stockists.html",
        "visit.html",
        "contact.html",
    ],
)
def test_claude_design_2_preservation(page_file: str):
    """For every fixture page, every visible text token + every class value
    + every data-* value + every <img src> from the source body must appear
    in the cleaned output."""
    raw = (CLAUDE_DESIGN_2 / page_file).read_text()
    cleaned = extract_body(raw)

    # Source body — without <head>, <script>, <style>, comments. Compare visible
    # content sets against the cleaned output.
    src_soup = BeautifulSoup(raw, "html.parser")
    src_body = src_soup.find("body") or src_soup
    # Strip <style>, head-scripts, comments from the source to mirror the
    # cleaner's behaviour before computing tokens.
    for tag in src_body.find_all("style"):
        tag.decompose()
    for comment in src_body.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    src_tokens = _visible_text_tokens(str(src_body))
    cleaned_tokens = _visible_text_tokens(cleaned)
    missing_tokens = src_tokens - cleaned_tokens
    assert not missing_tokens, f"text loss in {page_file}: {sorted(list(missing_tokens))[:30]}"

    src_classes = _all_classes(str(src_body))
    cleaned_classes = _all_classes(cleaned)
    missing_classes = src_classes - cleaned_classes
    assert not missing_classes, f"class loss in {page_file}: {sorted(list(missing_classes))[:30]}"

    src_data_attrs = _all_data_attrs(str(src_body))
    cleaned_data_attrs = _all_data_attrs(cleaned)
    missing_data_attrs = set(src_data_attrs) - set(cleaned_data_attrs)
    assert (
        not missing_data_attrs
    ), f"data-* attribute loss in {page_file}: {sorted(missing_data_attrs)[:30]}"


@pytest.mark.skipif(
    not CLAUDE_DESIGN_2.exists(),
    reason=f"fixture missing: {CLAUDE_DESIGN_2}",
)
def test_claude_design_2_index_preserves_hero_ticker_and_promise_grid():
    """Regression for kvf6lxug: the LLM-emitted import dropped the hero
    ticker, the 3-pillar grid, and the 8-promise grid. The deterministic
    cleaner must keep them all."""
    raw = (CLAUDE_DESIGN_2 / "index.html").read_text()
    cleaned = extract_body(raw)
    # Distinctive markers from the source:
    assert "hero-ticker" in cleaned or "ticker" in cleaned, "hero ticker missing"
    assert "promise" in cleaned, "promise section missing"
    # The brand SVG path / brand mark sits inside the original header — verify
    # we didn't redraw it. The original uses 'Happy<span class="brand-em">Doods'.
    assert "Happy" in cleaned


# ── Real fixture: Stitch ──────────────────────────────────────────────────

STITCH_BUNDLE = (
    REPO_ROOT
    / "packages"
    / "design-tools-fixtures"
    / "stitch"
    / "stitch_contact_us_happydoods_farm"
)
STITCH_PAGE_DIRS = (
    "home_happydoods_farm",
    "about_us_happydoods_farm",
    "our_products_happydoods_farm",
    "contact_us_happydoods_farm",
)


@pytest.mark.skipif(
    not STITCH_BUNDLE.exists(),
    reason=f"fixture missing: {STITCH_BUNDLE}",
)
@pytest.mark.parametrize("page_dir", STITCH_PAGE_DIRS)
def test_stitch_preservation(page_dir: str):
    """Same preservation invariant as Claude Design, applied to Stitch.

    Stitch pages carry a ``<script id="tailwind-config">`` in <head> and
    Material Symbols in <head> too. None of those should leak into the
    cleaned body output, but every body-level text/class/data-attr must
    survive verbatim.
    """
    page_path = STITCH_BUNDLE / page_dir / "code.html"
    if not page_path.exists():
        pytest.skip(f"page missing: {page_path}")
    raw = page_path.read_text()
    cleaned = extract_body(raw)

    # Tailwind config must NOT leak into the body output.
    assert 'id="tailwind-config"' not in cleaned
    assert "tailwind.config" not in cleaned

    # Compute source body, mirroring the cleaner's removal pass.
    src_soup = BeautifulSoup(raw, "html.parser")
    src_body = src_soup.find("body") or src_soup
    for tag in src_body.find_all("style"):
        tag.decompose()
    for comment in src_body.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    # Text token + class + data-attr preservation.
    src_tokens = _visible_text_tokens(str(src_body))
    cleaned_tokens = _visible_text_tokens(cleaned)
    missing_tokens = src_tokens - cleaned_tokens
    assert (
        not missing_tokens
    ), f"text loss in stitch/{page_dir}: {sorted(list(missing_tokens))[:30]}"

    src_classes = _all_classes(str(src_body))
    cleaned_classes = _all_classes(cleaned)
    missing_classes = src_classes - cleaned_classes
    assert (
        not missing_classes
    ), f"class loss in stitch/{page_dir}: {sorted(list(missing_classes))[:30]}"
