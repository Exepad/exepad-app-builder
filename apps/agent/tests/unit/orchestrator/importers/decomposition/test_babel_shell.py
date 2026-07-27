"""Tests for Babel-shell detection in the Claude Design handler.

Covers two real-world export shapes:

* **Sibling-bootstrap (Platformer Game)** — page HTML is a thin shell with
  ``<script type="text/babel" src="game.jsx">`` siblings; the bootstrap
  ``ReactDOM.render(...)`` call lives at the bottom of one of those JSX
  files. Two pages share the same JSX siblings.

* **Inline-bootstrap (Anima)** — page HTML loads many sibling helper JSX
  files plus a final inline ``<script type="text/babel">`` block carrying
  the ``function App()`` definition and the bootstrap call. Helper JSX
  files end with ``window.X = X;`` registrations.

Plus negative cases — pure HTML pages, hand-written SPA shells, and
bundles missing the React/Babel CDN signal — that must NOT trigger the
Babel-shell path.
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.claude_design import (  # noqa: E501
    BabelShellManifest,
    detect_babel_shell,
    pair_script_artifact,
)

pytestmark = [pytest.mark.unit]


PLATFORMER_FIXTURE_DIR = (
    Path(__file__).resolve().parents[7]
    / "packages"
    / "design-tools-fixtures"
    / "claude_design"
    / "Platformer Game"
)

# The Anima bundle is a large, license-encumbered design export that is not
# vendored into the repo. Point EXEPAD_ANIMA_FIXTURE_DIR at a local copy to run
# these cases; otherwise they skip (as they do in CI).
ANIMA_FIXTURE_DIR = Path(
    os.environ.get(
        "EXEPAD_ANIMA_FIXTURE_DIR",
        str(
            Path(__file__).resolve().parents[7]
            / "packages"
            / "design-tools-fixtures"
            / "claude_design"
            / "Exepad Anima"
        ),
    )
)
ANIMA_FIXTURE = ANIMA_FIXTURE_DIR / "Exepad Build Animation.html"


# ── Detection — positive cases on real fixtures ───────────────────────────


def test_detect_platformer_sibling_bootstrap():
    """Bloop World.html → 2 sibling JSX, 0 inline blocks."""
    if not PLATFORMER_FIXTURE_DIR.exists():
        pytest.skip(f"Fixture missing: {PLATFORMER_FIXTURE_DIR}")
    html = (PLATFORMER_FIXTURE_DIR / "Bloop World.html").read_text()

    manifest = detect_babel_shell(html)

    assert manifest is not None
    assert manifest.root_id == "root"
    # tweaks-panel.jsx loads first, game.jsx second — DOM order must be
    # preserved so the App component (defined in game.jsx) sees TweaksPanel
    # in scope.
    assert manifest.jsx_sources == ["tweaks-panel.jsx", "game.jsx"]
    # Bootstrap is inside game.jsx, not the HTML — no inline blocks.
    assert manifest.inline_babel_blocks == []
    # Bloop World.html has a small <head><style> reset (background, font).
    assert "html, body" in manifest.head_styles_css
    assert "#6BB6FF" in manifest.head_styles_css  # blue background


def test_detect_anima_inline_bootstrap():
    """Anima HTML → 17 sibling JSX, 1 inline App+bootstrap block."""
    if not ANIMA_FIXTURE.exists():
        pytest.skip(f"Fixture missing: {ANIMA_FIXTURE}")
    html = ANIMA_FIXTURE.read_text()

    manifest = detect_babel_shell(html)

    assert manifest is not None
    assert manifest.root_id == "root"
    # 17 sibling .jsx files in script-tag order; design-canvas.jsx must
    # come first so its DesignCanvas/DCSection/DCArtboard helpers are in
    # scope when the inline App references them.
    assert len(manifest.jsx_sources) == 17
    assert manifest.jsx_sources[0] == "design-canvas.jsx"
    assert manifest.jsx_sources[1] == "v1-concentric.jsx"
    # Exactly one inline block carrying the App definition + bootstrap.
    assert len(manifest.inline_babel_blocks) == 1
    inline = manifest.inline_babel_blocks[0]
    assert "function App()" in inline
    assert "ReactDOM.createRoot" in inline
    assert "<DesignCanvas>" in inline
    # head_styles is small — just the body/html background reset.
    assert "background" in manifest.head_styles_css


# ── Detection — negative cases ────────────────────────────────────────────


def test_detect_returns_none_for_pure_html_page():
    """A normal HTML page has structural body content, fails signal A."""
    html = """
    <html><head></head><body>
      <header><nav>Home</nav></header>
      <main><p>Hello world</p></main>
    </body></html>
    """
    assert detect_babel_shell(html) is None


def test_detect_returns_none_for_root_div_without_jsx_scripts():
    """SPA shell loading a bundled .js (not JSX) — fails signal B."""
    html = """
    <html><body>
      <div id="root"></div>
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script type="module" src="/assets/app-abc123.js"></script>
    </body></html>
    """
    assert detect_babel_shell(html) is None


def test_detect_returns_none_for_jsx_scripts_without_react_cdn():
    """Hand-rolled babel-in-browser shell missing the React/Babel CDN
    signal — fails signal C. Conservative: we'd rather false-negative
    than ship an empty TSX wrapper for an arbitrary HTML page."""
    html = """
    <html><body>
      <div id="root"></div>
      <script type="text/babel" src="game.jsx"></script>
    </body></html>
    """
    assert detect_babel_shell(html) is None


def test_detect_returns_none_when_root_div_already_populated():
    """If the mount div has child elements, the page renders content
    server-side; not a Babel shell."""
    html = """
    <html><body>
      <div id="root">
        <p>Pre-rendered content</p>
      </div>
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
      <script type="text/babel" src="game.jsx"></script>
    </body></html>
    """
    assert detect_babel_shell(html) is None


def test_detect_returns_none_when_body_has_other_structural_children():
    """Even with a root div + JSX scripts, if there's other body content
    (header, main, etc.) it's a hybrid page — don't route to JSX
    translator."""
    html = """
    <html><body>
      <header>Site nav</header>
      <div id="root"></div>
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
      <script type="text/babel" src="game.jsx"></script>
    </body></html>
    """
    assert detect_babel_shell(html) is None


def test_detect_returns_none_for_empty_html():
    assert detect_babel_shell("") is None
    assert detect_babel_shell("<html></html>") is None


def test_detect_accepts_babel_standalone_alone():
    """Only @babel/standalone (no React CDN) still satisfies signal C."""
    html = """
    <html><body>
      <div id="root"></div>
      <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
      <script type="text/babel" src="game.jsx"></script>
    </body></html>
    """
    manifest = detect_babel_shell(html)
    assert manifest is not None
    assert manifest.jsx_sources == ["game.jsx"]


def test_detect_extracts_inline_babel_in_dom_order():
    """Multiple inline blocks should preserve DOM order."""
    html = """
    <html><body>
      <div id="root"></div>
      <script src="https://unpkg.com/react@18/umd/react.development.js"></script>
      <script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
      <script type="text/babel" src="lib.jsx"></script>
      <script type="text/babel">const FIRST = 1;</script>
      <script type="text/babel">const SECOND = 2;</script>
    </body></html>
    """
    manifest = detect_babel_shell(html)
    assert manifest is not None
    assert manifest.inline_babel_blocks == ["const FIRST = 1;", "const SECOND = 2;"]


# ── Sibling pairing ───────────────────────────────────────────────────────


def test_pair_script_artifact_resolves_top_level_siblings():
    """Bloop World.html lives at the archive root; its <script src="game.jsx">
    references resolve to bundle:script:game.jsx."""
    manifest = BabelShellManifest(
        root_id="root",
        jsx_sources=["tweaks-panel.jsx", "game.jsx"],
    )
    staged = {
        "bundle:html:Bloop World.html",
        "bundle:script:game.jsx",
        "bundle:script:tweaks-panel.jsx",
    }
    resolved, missing = pair_script_artifact(
        manifest, page_html_relpath="Bloop World.html", staged_keys=staged
    )
    assert resolved == ["bundle:script:tweaks-panel.jsx", "bundle:script:game.jsx"]
    assert missing == []


def test_pair_script_artifact_resolves_nested_siblings():
    """Pages nested inside a project folder resolve relative to that folder."""
    manifest = BabelShellManifest(root_id="root", jsx_sources=["game.jsx"])
    staged = {
        "bundle:html:proj/index.html",
        "bundle:script:proj/game.jsx",
    }
    resolved, missing = pair_script_artifact(
        manifest, page_html_relpath="proj/index.html", staged_keys=staged
    )
    assert resolved == ["bundle:script:proj/game.jsx"]
    assert missing == []


def test_pair_script_artifact_reports_missing_siblings():
    """A <script src=> referencing an un-uploaded JSX is reported missing
    rather than aborting the import."""
    manifest = BabelShellManifest(
        root_id="root",
        jsx_sources=["game.jsx", "tweaks-panel.jsx"],
    )
    staged = {
        "bundle:html:Bloop World.html",
        "bundle:script:game.jsx",
        # tweaks-panel.jsx absent — user forgot to include it in the zip
    }
    resolved, missing = pair_script_artifact(
        manifest, page_html_relpath="Bloop World.html", staged_keys=staged
    )
    assert resolved == ["bundle:script:game.jsx"]
    assert missing == ["tweaks-panel.jsx"]


def test_pair_script_artifact_falls_back_to_basename_match():
    """When the <script src=> path doesn't match the staged relpath
    exactly (different folder nesting), basename-fuzzy match recovers."""
    manifest = BabelShellManifest(root_id="root", jsx_sources=["./game.jsx"])
    staged = {
        "bundle:html:proj/index.html",
        # Staged at top-level despite the page being nested.
        "bundle:script:game.jsx",
    }
    resolved, missing = pair_script_artifact(
        manifest, page_html_relpath="proj/index.html", staged_keys=staged
    )
    assert resolved == ["bundle:script:game.jsx"]
    assert missing == []


def test_pair_script_artifact_skips_external_urls():
    """Absolute http(s) script srcs can't resolve to bundle entries; they
    surface in missing so the user sees what was bypassed."""
    manifest = BabelShellManifest(
        root_id="root",
        jsx_sources=["https://cdn.example.com/lib.jsx", "game.jsx"],
    )
    staged = {"bundle:html:home.html", "bundle:script:game.jsx"}
    resolved, missing = pair_script_artifact(
        manifest, page_html_relpath="home.html", staged_keys=staged
    )
    assert resolved == ["bundle:script:game.jsx"]
    assert missing == ["https://cdn.example.com/lib.jsx"]


def test_pair_script_artifact_strips_query_and_fragment():
    """Cache-busting query strings (?v=2) and fragments shouldn't break
    resolution."""
    manifest = BabelShellManifest(
        root_id="root", jsx_sources=["game.jsx?v=2", "panel.jsx#main"]
    )
    staged = {
        "bundle:html:home.html",
        "bundle:script:game.jsx",
        "bundle:script:panel.jsx",
    }
    resolved, missing = pair_script_artifact(
        manifest, page_html_relpath="home.html", staged_keys=staged
    )
    assert resolved == ["bundle:script:game.jsx", "bundle:script:panel.jsx"]
    assert missing == []
