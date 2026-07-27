"""Tests for ``ph_transformer``."""

from __future__ import annotations

from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from main_agent.agents.orchestrator.importers.tools.decomposition.ph_transformer import (
    PhTransformResult,
    transform_placeholders,
)

# ── Synthetic ──────────────────────────────────────────────────────────────


_LOADER = """
(function() {
  const PH = {"eggs_brown":"https://example.com/brown.jpg","eggs_pastel":"https://example.com/pastel.jpg"};
  const MAP = [
    ["Brown eggs", "eggs_brown"],
    ["Pastel mix", "eggs_pastel"],
  ];
  document.querySelectorAll(".ph").forEach(ph => { /* ... */ });
})();
"""


def _build_page(body_html: str, *, with_loader: bool = True) -> str:
    loader = f"<script>{_LOADER}</script>" if with_loader else ""
    return f"<html><body>{body_html}{loader}</body></html>"


def test_basic_match_injects_img():
    page = _build_page(
        '<div class="product-img ph"><span class="ph-label">Brown eggs · ¾</span></div>'
    )
    out, result = transform_placeholders(page)
    assert result.transformed == 1
    assert "ph-label" not in out
    assert 'src="https://example.com/brown.jpg"' in out
    assert 'alt="Brown eggs · ¾"' in out
    # ph class dropped, original layout class kept
    assert 'class="product-img"' in out


def test_overlay_sibling_preserved():
    page = _build_page(
        '<div class="product-img ph">'
        '<span class="ph-label">Brown eggs</span>'
        '<div class="scribble-note">that\'s us!</div>'
        "</div>"
    )
    out, result = transform_placeholders(page)
    assert result.transformed == 1
    soup = BeautifulSoup(out, "html.parser")
    wrapper = soup.find(class_="product-img")
    assert wrapper is not None
    children = [c for c in wrapper.children if getattr(c, "name", None)]
    # img comes first, overlay second
    assert children[0].name == "img"
    assert "scribble-note" in (children[1].get("class") or [])


def test_unmatched_label_left_alone():
    page = _build_page(
        '<div class="product-img ph"><span class="ph-label">No match here</span></div>'
    )
    out, result = transform_placeholders(page)
    assert result.transformed == 0
    assert result.unmatched_labels == ["No match here"]
    # Wrapper still has ph class because we didn't mutate it.
    assert 'class="product-img ph"' in out


def test_loader_script_removed():
    page = _build_page('<div class="ph"><span class="ph-label">Brown eggs</span></div>')
    out, result = transform_placeholders(page)
    assert result.loader_removed is True
    # No more PH/MAP literals in the document.
    assert "const PH" not in out
    assert "const MAP" not in out


def test_other_scripts_survive():
    page = (
        "<html><body>"
        "<script>head_only_analytics()</script>"
        '<div class="ph"><span class="ph-label">Brown eggs</span></div>'
        "<script>document.querySelectorAll('.faq').forEach(...)</script>"
        f"<script>{_LOADER}</script>"
        "</body></html>"
    )
    out, result = transform_placeholders(page)
    assert result.loader_removed is True
    # The loader is gone but the FAQ script and analytics survive.
    assert "head_only_analytics" in out
    assert "querySelectorAll('.faq')" in out
    assert "const PH" not in out


def test_no_loader_returns_input():
    page = "<html><body><div class='ph'><span class='ph-label'>Brown</span></div></body></html>"
    out, result = transform_placeholders(page)
    assert result.transformed == 0
    assert result.loader_removed is False
    # Wrapper untouched.
    assert "ph-label" in out


def test_case_insensitive_fuzzy_match():
    page = _build_page('<div class="ph"><span class="ph-label">brown EGGS dozen</span></div>')
    out, result = transform_placeholders(page)
    assert result.transformed == 1
    assert 'src="https://example.com/brown.jpg"' in out


def test_url_with_braces_in_query_does_not_break_extraction():
    """Edge case: URL contains a ``{`` literally (rare; defense-in-depth)."""
    weird_loader = """
(function() {
  const PH = {"x":"https://api.example.com/photo?w={w}"};
  const MAP = [["X","x"]];
  document.querySelectorAll(".ph").forEach(...);
})();
"""
    page = (
        f'<html><body><div class="ph"><span class="ph-label">X</span></div>'
        f"<script>{weird_loader}</script></body></html>"
    )
    out, result = transform_placeholders(page)
    # Whether or not the URL parses as JSON, we should not crash and the
    # behavior should be deterministic. Either:
    #   - JSON parse succeeds and an img is injected
    #   - JSON parse fails and the wrapper is left alone (no exception)
    assert isinstance(out, str)
    assert isinstance(result, PhTransformResult)


# ── Real fixture: claude_design_2 ──────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[7]
CLAUDE_DESIGN_2 = REPO_ROOT / "packages" / "design-tools-fixtures" / "claude_design" / "chick_farm"


@pytest.mark.skipif(
    not CLAUDE_DESIGN_2.exists(),
    reason=f"fixture missing: {CLAUDE_DESIGN_2}",
)
def test_claude_design_2_index_transforms_placeholders():
    raw = (CLAUDE_DESIGN_2 / "index.html").read_text()
    out, result = transform_placeholders(raw)
    # The home page has multiple .ph divs; baseline regression: at least
    # 3 should resolve via fuzzy match. Some have generic ph-label text
    # the MAP cannot resolve — those land in unmatched_labels, which is
    # the expected outcome and gets surfaced into notes.md by the runner.
    assert (
        result.transformed >= 3
    ), f"expected at least 3 placeholder rewrites, got {result.transformed}"
    assert result.loader_removed is True
    assert "const PH" not in out
    assert "const MAP" not in out
    # Real Unsplash URLs are present in <img src> form.
    assert 'src="https://images.unsplash.com/' in out
