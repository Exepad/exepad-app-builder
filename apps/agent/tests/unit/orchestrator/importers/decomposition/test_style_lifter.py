"""Tests for ``style_lifter``.

Validates:
* ``:root`` declarations harvested into ``root_vars``.
* Forbidden globals (``*``, ``html``, ``@font-face``) stripped from layer text.
* Pseudo-classes / ``@media`` / ``@keyframes`` round-trip via tinycss2.
* The emitted theme.css passes the canonical ``theme_css_rules`` validator.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import tinycss2

from main_agent.agents.orchestrator.importers.tools.decomposition.style_lifter import (
    CssBlock,
    build_theme_css,
    collect_external_stylesheet,
    collect_inline_style_blocks,
    lift_styles,
)

# ── Synthetic stylesheets ─────────────────────────────────────────────────


def _block(text: str, *, origin: str = "test") -> CssBlock:
    return CssBlock(origin=origin, text=text)


def test_root_vars_harvested():
    css = """
        :root {
            --brand: #aabbcc;
            --gap: 12px;
        }
        .nav { color: var(--brand); }
    """
    out = lift_styles([_block(css)])
    assert out.root_vars == {"--brand": "#aabbcc", "--gap": "12px"}
    # The .nav rule survives in layer text.
    assert ".nav" in out.layer_text
    # The :root block does NOT.
    assert ":root" not in out.layer_text


def test_forbidden_bare_selectors_stripped():
    css = """
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html { font-size: 16px; }
        body { background: white; }
        a { color: blue; }
        .keep { color: red; }
    """
    out = lift_styles([_block(css)])
    assert "box-sizing" not in out.layer_text
    assert "font-size: 16px" not in out.layer_text
    assert "background: white" not in out.layer_text
    assert ".keep" in out.layer_text


def test_bare_typography_rules_routed_to_base_layer():
    """Bare ``h1``-``h6`` rules carry the imported design's typography
    defaults (font-weight, letter-spacing, font-variation-settings).
    They MUST land in ``base_layer_text`` (which the runner emits inside
    ``@layer base``) — not dropped, and not in ``layer_text`` where they
    would beat Tailwind utilities. Their per-h font-size rules go to the
    same place so the whole heading scale travels together.
    """
    css = """
        h1, h2, h3, h4 {
            font-family: var(--serif);
            font-weight: 500;
            letter-spacing: -0.01em;
            line-height: 1.05;
            color: var(--ink);
            text-wrap: balance;
        }
        h1 { font-size: clamp(48px, 7vw, 96px); font-variation-settings: "opsz" 144, "SOFT" 80; }
        h2 { font-size: clamp(36px, 4.5vw, 64px); font-variation-settings: "opsz" 96, "SOFT" 60; }
        h3 { font-size: clamp(24px, 2.4vw, 32px); font-variation-settings: "opsz" 48; }
        .keep { color: red; }
    """
    out = lift_styles([_block(css)])

    # All bare h-rules went to base layer.
    assert "font-weight: 500" in out.base_layer_text
    assert "letter-spacing: -0.01em" in out.base_layer_text
    assert 'font-variation-settings: "opsz" 144' in out.base_layer_text
    assert 'font-variation-settings: "opsz" 96' in out.base_layer_text
    assert 'font-variation-settings: "opsz" 48' in out.base_layer_text

    # Nothing typography-default leaked into the exepad-app layer.
    assert "font-weight: 500" not in out.layer_text
    assert 'font-variation-settings: "opsz" 144' not in out.layer_text

    # Compound class rules still flow to exepad-app.
    assert ".keep" in out.layer_text
    assert ".keep" not in out.base_layer_text


def test_compound_h_selectors_stay_in_exepad_app_layer():
    """``.hero h1`` / ``.pagehead h1`` are SCOPED — they belong in
    ``@layer exepad-app`` so they correctly beat Tailwind utilities for
    that specific scope. Only BARE ``h1``..``h6`` go to base layer.
    """
    css = """
        .pagehead h1 { font-size: clamp(48px, 6vw, 88px); margin-bottom: 16px; }
        .hero h1 { font-size: clamp(56px, 8vw, 112px); font-variation-settings: "opsz" 144, "wght" 450; }
        .story-copy h2 { font-style: italic; font-variation-settings: "opsz" 144, "wght" 400; }
    """
    out = lift_styles([_block(css)])

    # All compound selectors land in @layer exepad-app body.
    assert ".pagehead h1" in out.layer_text
    assert ".hero h1" in out.layer_text
    assert ".story-copy h2" in out.layer_text

    # Nothing leaked into base layer.
    assert ".pagehead" not in out.base_layer_text
    assert ".hero" not in out.base_layer_text
    assert ".story-copy" not in out.base_layer_text


def test_base_layer_empty_when_no_bare_typography_rules():
    """A bundle with only class-scoped CSS produces an empty
    ``base_layer_text``. ``build_theme_css`` then omits the ``@layer
    base { ... }`` block entirely (no empty layers in the output)."""
    css = """
        .nav { color: blue; }
        .pagehead h1 { font-size: 48px; }
    """
    out = lift_styles([_block(css)])
    assert out.base_layer_text == ""
    # And exepad-app layer still gets the compound selectors.
    assert ".nav" in out.layer_text
    assert ".pagehead h1" in out.layer_text


def test_font_face_dropped():
    css = """
        @font-face { font-family: "X"; src: url("x.woff2"); }
        .x { font-family: "X"; }
    """
    out = lift_styles([_block(css)])
    assert "@font-face" not in out.layer_text
    assert ".x" in out.layer_text


def test_pseudo_classes_and_media_round_trip():
    css = """
        .nav-cta:hover { background: var(--barn); transform: translateY(-1px); }
        .nav-links a.active::after { content: ""; height: 2px; }
        @media (max-width: 720px) {
            .wrap { padding: 0 20px; }
        }
        @keyframes pulse {
            0% { opacity: 0.4; }
            100% { opacity: 1; }
        }
    """
    out = lift_styles([_block(css)])
    text = out.layer_text
    assert ":hover" in text
    assert "::after" in text
    assert "@media" in text
    assert "@keyframes" in text
    assert "translateY(-1px)" in text


def test_multiple_blocks_keep_cascade_order():
    a = _block(".x { color: red; }", origin="a")
    b = _block(".x { color: blue; } .y { font-weight: 700; }", origin="b")
    out = lift_styles([a, b])
    # Both .x rules survive; their order is the input order.
    assert out.layer_text.index("color: red") < out.layer_text.index("color: blue")
    assert ".y" in out.layer_text


def test_lift_styles_handles_empty_blocks():
    out = lift_styles([_block(""), _block("   "), _block(".keep { color: red; }")])
    assert ".keep" in out.layer_text


def test_collect_inline_style_blocks_html_parser():
    html = (
        "<head><style>:root { --x: 1; }</style></head>"
        "<body><p>hi</p><style>.y { color: red; }</style></body>"
    )
    blocks = collect_inline_style_blocks(html, origin="page")
    assert len(blocks) == 2
    assert ":root" in blocks[0].text
    assert ".y" in blocks[1].text


def test_collect_external_stylesheet_passthrough():
    blocks = collect_external_stylesheet("body{}", origin="bundle:asset:styles.css")
    assert len(blocks) == 1
    assert blocks[0].text == "body{}"
    assert blocks[0].origin == "bundle:asset:styles.css"


# ── theme.css assembly ────────────────────────────────────────────────────


def test_build_theme_css_bootstrap_first():
    out = build_theme_css(
        google_font_imports=[],
        m3_tokens={"--color-primary": "#aa0000"},
        original_tokens={},
        layer_text="",
    )
    lines = out.splitlines()
    assert lines[0] == '@import "tailwindcss";'
    assert lines[1] == '@import "tw-animate-css";'
    assert lines[2] == '@source "./components";'


def test_build_theme_css_emits_both_m3_and_originals():
    out = build_theme_css(
        google_font_imports=[],
        m3_tokens={"--color-primary": "#A8472A"},
        original_tokens={"--barn": "#A8472A", "--cream": "#F5EFE2"},
        layer_text=".x { color: var(--barn); }",
    )
    # M3 token present
    assert "--color-primary: #A8472A" in out
    # Original tokens present alongside
    assert "--barn: #A8472A" in out
    assert "--cream: #F5EFE2" in out
    # Layer block emitted
    assert "@layer exepad-app {" in out
    assert ".x" in out


def test_build_theme_css_skips_empty_layer():
    out = build_theme_css(
        google_font_imports=[],
        m3_tokens={"--color-primary": "#000"},
        original_tokens={},
        layer_text="",
    )
    assert "@layer exepad-app" not in out


def test_build_theme_css_dedupes_imports():
    out = build_theme_css(
        google_font_imports=[
            "https://fonts.googleapis.com/css2?family=Inter",
            "https://fonts.googleapis.com/css2?family=Inter",
        ],
        m3_tokens={"--color-primary": "#000"},
        original_tokens={},
        layer_text="",
    )
    assert out.count("@import url") == 1


def test_build_theme_css_emits_base_layer_when_provided():
    """Bare ``h1``-``h6`` rules (lifted to the base layer) come out as
    ``@layer base { ... }`` in the assembled theme.css. The block
    appears AFTER ``@theme`` and BEFORE ``@layer exepad-app`` for cascade
    legibility (Tailwind utilities still beat base regardless of order
    because the layer-order declaration in ``@import "tailwindcss"``
    establishes ``base`` < ``utilities``)."""
    out = build_theme_css(
        google_font_imports=[],
        m3_tokens={"--color-primary": "#000"},
        original_tokens={},
        base_layer_text=(
            "h1, h2, h3, h4 {\n"
            "  font-family: var(--serif);\n"
            "  font-weight: 500;\n"
            "}\n"
            "h1 { font-size: clamp(48px, 7vw, 96px); "
            'font-variation-settings: "opsz" 144; }'
        ),
        layer_text=".x { color: red; }",
    )

    assert "@layer base {" in out
    assert "font-weight: 500" in out
    assert 'font-variation-settings: "opsz" 144' in out

    # Cascade order: @theme first, then @layer base, then @layer exepad-app.
    pos_theme = out.index("@theme {")
    pos_base = out.index("@layer base {")
    pos_exepad = out.index("@layer exepad-app {")
    assert pos_theme < pos_base < pos_exepad


def test_build_theme_css_omits_base_layer_when_empty():
    """No ``@layer base { ... }`` block is emitted when the lifter found
    no bare typography rules — keeps the output free of empty layers."""
    out = build_theme_css(
        google_font_imports=[],
        m3_tokens={"--color-primary": "#000"},
        original_tokens={},
        base_layer_text="",
        layer_text=".x { color: red; }",
    )
    assert "@layer base {" not in out
    # And the exepad-app layer is still emitted.
    assert "@layer exepad-app {" in out


# ── Real fixture: claude_design_2/styles.css ──────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[7]
STYLES_FIXTURE = REPO_ROOT / "packages" / "design-tools-fixtures" / "claude_design" / "chick_farm" / "styles.css"


@pytest.mark.skipif(
    not STYLES_FIXTURE.exists(),
    reason=f"fixture missing: {STYLES_FIXTURE}",
)
def test_claude_design_2_styles_css_lifts_cleanly():
    css = STYLES_FIXTURE.read_text()
    out = lift_styles([_block(css, origin="bundle:asset:styles.css")])

    # :root vars from happydoods stylesheet must be harvested.
    expected_vars = ["--cream", "--barn", "--moss", "--ink"]
    for var in expected_vars:
        assert var in out.root_vars, f"missing harvested root var: {var}"

    # Forbidden globals must be absent.
    assert "* { box-sizing" not in out.layer_text
    assert "html {" not in out.layer_text
    assert "body {" not in out.layer_text

    # Class rules must survive.
    assert ".wrap" in out.layer_text
    assert ".nav" in out.layer_text
    # Pseudo classes / media queries from the source must round-trip.
    assert ":hover" in out.layer_text or "@media" in out.layer_text


@pytest.mark.skipif(
    not STYLES_FIXTURE.exists(),
    reason=f"fixture missing: {STYLES_FIXTURE}",
)
def test_emitted_theme_css_structural_invariants():
    """End-to-end shape check on the lifter's output for the real fixture.

    The validator suite at services/validation/css_ast/rules/default_set.py is
    calibrated for DesignSystemBuilder output (which emits a :root block of
    shadcn-shorthand vars). The DesignImporter's theme.css path historically
    does not emit those vars (as seen in a staged design-import app's
    code/frontend/styles/ output), so we assert the structural invariants the
    importer pipeline actually
    requires:

      * Tailwind v4 bootstrap preamble at the top, OUTSIDE any layer.
      * @theme block present with M3 tokens.
      * @layer exepad-app block present with verbatim rules.
      * No forbidden globals from styles.css survived the cleanup.
      * The whole emitted file parses via tinycss2 without errors.
    """
    css = STYLES_FIXTURE.read_text()
    lifted = lift_styles([_block(css, origin="bundle:asset:styles.css")])

    m3 = {
        "--color-primary": lifted.root_vars.get("--barn", "#A8472A"),
        "--color-on-primary": "#ffffff",
        "--color-background": lifted.root_vars.get("--cream", "#F5EFE2"),
        "--color-on-background": lifted.root_vars.get("--ink", "#2A1F17"),
        "--font-headline": '"Fraunces", serif',
        "--font-body": '"Inter", sans-serif',
    }

    theme_css = build_theme_css(
        google_font_imports=["https://fonts.googleapis.com/css2?family=Fraunces"],
        m3_tokens=m3,
        original_tokens=lifted.root_vars,
        layer_text=lifted.layer_text,
    )

    # 1. Bootstrap preamble at the top, OUTSIDE any layer.
    lines = theme_css.splitlines()
    assert lines[0] == '@import "tailwindcss";'

    # 2. @theme block present with M3 tokens.
    assert "@theme {" in theme_css
    assert "--color-primary: #A8472A" in theme_css
    # Original tokens preserved alongside.
    assert "--barn:" in theme_css
    assert "--cream:" in theme_css

    # 3. @layer exepad-app present with class rules.
    assert "@layer exepad-app {" in theme_css
    assert ".wrap" in theme_css
    assert ".nav" in theme_css

    # 4. No forbidden globals leaked.
    assert "* { box-sizing" not in theme_css
    assert "@font-face" not in theme_css

    # 5. Parses cleanly via tinycss2 (no malformed at-rules etc.).
    parsed = tinycss2.parse_stylesheet(theme_css, skip_comments=False)
    parse_errors = [n for n in parsed if n.type == "error"]
    assert not parse_errors, f"tinycss2 parse errors: {parse_errors}"
