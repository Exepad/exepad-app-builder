"""Unit tests for the DesignImporter deterministic helper tools.

These tools run inside the DesignImporter LLM loop. They must be pure,
deterministic, and never raise on malformed input — the LLM interprets
`None` / empty results and falls back to inference.
"""

from __future__ import annotations

import pytest

from main_agent.agents.orchestrator.importers.tools.html_utils import (
    extract_google_fonts_links,
    extract_root_vars,
    extract_style_blocks,
    parse_tailwind_config,
    resolve_css_vars,
)

pytestmark = [pytest.mark.unit]


# ── parse_tailwind_config ─────────────────────────────────────────────────


class TestParseTailwindConfig:
    def test_parses_stitch_style_config(self):
        html = """
        <html><head>
          <script id="tailwind-config">
            tailwind.config = {
              darkMode: "class",
              theme: {
                extend: {
                  colors: {
                    "primary": "#7a5900",
                    "secondary": "#47664b",
                  },
                  fontFamily: { headline: ["Noto Serif"], body: ["Plus Jakarta Sans"] },
                  borderRadius: { "DEFAULT": "0.25rem", "lg": "1rem" },
                },
              },
            }
          </script>
        </head></html>
        """
        cfg = parse_tailwind_config(html)
        assert cfg is not None
        theme = cfg["theme"]["extend"]
        assert theme["colors"]["primary"] == "#7a5900"
        assert theme["colors"]["secondary"] == "#47664b"
        assert theme["fontFamily"]["headline"] == ["Noto Serif"]
        assert theme["borderRadius"]["lg"] == "1rem"

    def test_returns_none_when_no_script(self):
        assert parse_tailwind_config("<html><body>hi</body></html>") is None

    def test_returns_none_for_empty_input(self):
        assert parse_tailwind_config("") is None
        assert parse_tailwind_config(None) is None  # type: ignore[arg-type]

    def test_handles_trailing_commas_and_unquoted_keys(self):
        """Stitch's export uses unquoted keys and trailing commas — both
        valid JS but not JSON. The lifter must cope."""
        html = """<script id="tailwind-config">
        tailwind.config = {
          theme: {
            extend: {
              colors: { primary: "#111", secondary: "#222", },
            },
          },
        }
        </script>"""
        cfg = parse_tailwind_config(html)
        assert cfg is not None
        assert cfg["theme"]["extend"]["colors"]["primary"] == "#111"

    def test_returns_none_on_unrecognized_body(self):
        """If the script isn't `tailwind.config = {...}`, we give up
        rather than guess."""
        html = '<script id="tailwind-config">something else entirely</script>'
        assert parse_tailwind_config(html) is None


# ── extract_style_blocks + extract_root_vars ──────────────────────────────


class TestStyleBlocks:
    def test_extracts_every_style_block_in_order(self):
        html = """
        <style>body { color: red; }</style>
        <style>nav { padding: 8px; }</style>
        """
        blocks = extract_style_blocks(html)
        assert len(blocks) == 2
        assert "color: red" in blocks[0]
        assert "padding: 8px" in blocks[1]

    def test_no_style_blocks_returns_empty(self):
        assert extract_style_blocks("<html></html>") == []
        assert extract_style_blocks("") == []


class TestRootVars:
    def test_parses_claude_design_style_root(self):
        blocks = ["""
            :root {
                --bg:     #F6F4EF;
                --accent: #3E3BE0;
                --r-lg:   14px;
                --shadow-1: 0 1px 0 rgba(23,23,26,.04);
            }
            """]
        vars_ = extract_root_vars(blocks)
        assert vars_["--bg"] == "#F6F4EF"
        assert vars_["--accent"] == "#3E3BE0"
        assert vars_["--r-lg"] == "14px"
        assert vars_["--shadow-1"] == "0 1px 0 rgba(23,23,26,.04)"

    def test_later_blocks_override_earlier(self):
        blocks = [
            ":root { --accent: #111; }",
            ":root { --accent: #222; }",
        ]
        vars_ = extract_root_vars(blocks)
        assert vars_["--accent"] == "#222"

    def test_empty_input(self):
        assert extract_root_vars([]) == {}


# ── resolve_css_vars ──────────────────────────────────────────────────────


class TestResolveCssVars:
    def test_simple_resolution(self):
        assert resolve_css_vars("var(--accent)", {"--accent": "#3E3BE0"}) == "#3E3BE0"

    def test_fallback_used_when_var_missing(self):
        assert resolve_css_vars("var(--missing, #000)", {}) == "#000"

    def test_missing_var_without_fallback_preserved(self):
        """Conservative behavior: leave the expression alone so downstream
        code can decide whether to flag or drop."""
        assert resolve_css_vars("var(--missing)", {}) == "var(--missing)"

    def test_chained_resolution(self):
        vars_ = {"--a": "var(--b)", "--b": "#fff"}
        assert resolve_css_vars("var(--a)", vars_) == "#fff"

    def test_bounded_depth_does_not_hang_on_cycle(self):
        """Cycles are possible (rare but real) — must not infinite-loop."""
        vars_ = {"--a": "var(--b)", "--b": "var(--a)"}
        # Returns best-effort — the key assertion is "doesn't hang."
        result = resolve_css_vars("var(--a)", vars_)
        assert isinstance(result, str)

    def test_no_var_returns_input_unchanged(self):
        assert resolve_css_vars("#ABC", {}) == "#ABC"
        assert resolve_css_vars("rgba(0,0,0,0.5)", {}) == "rgba(0,0,0,0.5)"
        assert resolve_css_vars("", {}) == ""


# ── extract_google_fonts_links ────────────────────────────────────────────


class TestExtractGoogleFontsLinks:
    def test_finds_link_tags(self):
        html = """
        <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto">
        <link href="/assets/app.css" rel="stylesheet">
        """
        urls = extract_google_fonts_links(html)
        assert len(urls) == 2
        assert any("Inter" in u for u in urls)
        assert any("Roboto" in u for u in urls)

    def test_deduplicates_preserving_order(self):
        html = """
        <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
        """
        urls = extract_google_fonts_links(html)
        assert len(urls) == 1

    def test_ignores_other_stylesheets(self):
        html = '<link href="https://example.com/fonts.css" rel="stylesheet">'
        assert extract_google_fonts_links(html) == []

    def test_empty_input(self):
        assert extract_google_fonts_links("") == []
        assert extract_google_fonts_links("<html></html>") == []
