"""Unit tests for the ``add_theme_tokens`` ComponentBuilder tool.

Covers:
- Adding 0, 1, and N tokens
- Idempotent skip of pre-existing names
- Token name shape validation
- Token value validation (hex / hsl / var refs)
- Splice preserves @import / @source / @layer / :root blocks
- Splice is byte-stable when called twice with the same input
- Missing artifact / missing @theme block → graceful failure
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Optional

import pytest

from main_agent.agents.orchestrator.app_types.webapp.subagents.theme_token_tool import (
    THEME_FILENAME,
    _splice_tokens_into_theme,
    add_theme_tokens,
)

pytestmark = [pytest.mark.unit]


# ---------------------------------------------------------------------------
# Test fixtures
# ---------------------------------------------------------------------------


_BASE_THEME_CSS = """\
@import "tailwindcss";
@import "tw-animate-css";
@source "./components";

@layer exepad-app {
  :root {
    color-scheme: light;
  }

  @theme {
    --color-primary: #1565c0;
    --color-on-primary: #ffffff;
    --color-secondary: #42a5f5;
    --color-surface: #ffffff;
    --color-on-surface: #1a1c1e;
    --font-display: "Inter", sans-serif;
  }

  html.dark {
    --color-surface: #1a1c1e;
    --color-on-surface: #e3e3e3;
  }
}
"""


class _StubInlineData:
    def __init__(self, data: bytes):
        self.data = data


class _StubArtifact:
    def __init__(self, data: bytes):
        self.inline_data = _StubInlineData(data)


class _DummyToolContext:
    """In-memory stand-in for ADK ToolContext.

    Only implements ``load_artifact`` / ``save_artifact`` — that's all the
    tool touches.
    """

    def __init__(self, theme_css: Optional[str]):
        self.state: dict = {}
        self.actions = SimpleNamespace(escalate=False)
        self.agent_name = "ComponentBuilder"
        self._artifacts: dict[str, bytes] = {}
        if theme_css is not None:
            self._artifacts[THEME_FILENAME] = theme_css.encode("utf-8")
        self.save_calls: list[tuple[str, bytes]] = []

    async def load_artifact(self, *, filename: str, version: Optional[int] = None):
        data = self._artifacts.get(filename)
        if data is None:
            return None
        return _StubArtifact(data)

    async def save_artifact(self, *, filename: str, artifact) -> int:
        data = artifact.inline_data.data
        self._artifacts[filename] = data
        self.save_calls.append((filename, data))
        return len(self.save_calls)


def _theme_css(ctx: _DummyToolContext) -> str:
    return ctx._artifacts[THEME_FILENAME].decode("utf-8")


# ---------------------------------------------------------------------------
# _splice_tokens_into_theme — pure function tests
# ---------------------------------------------------------------------------


def test_splice_inserts_new_token_into_theme_block():
    new_css, added, skipped = _splice_tokens_into_theme(
        _BASE_THEME_CSS, {"color-tertiary": "#7fb069"}
    )
    assert added == ["color-tertiary"]
    assert skipped == []
    assert "--color-tertiary: #7fb069;" in new_css
    # @import / @source / @layer / :root blocks intact
    assert '@import "tailwindcss";' in new_css
    assert '@import "tw-animate-css";' in new_css
    assert '@source "./components";' in new_css
    assert "@layer exepad-app" in new_css
    assert "html.dark" in new_css
    assert "color-scheme: light;" in new_css


def test_splice_inserts_multiple_sorted_alphabetically():
    new_css, added, skipped = _splice_tokens_into_theme(
        _BASE_THEME_CSS,
        {
            "color-zeta": "#000000",
            "color-alpha": "#ffffff",
            "color-mu": "#888888",
        },
    )
    assert added == ["color-alpha", "color-mu", "color-zeta"]
    assert skipped == []
    # Sorted insertion order
    alpha_pos = new_css.index("--color-alpha:")
    mu_pos = new_css.index("--color-mu:")
    zeta_pos = new_css.index("--color-zeta:")
    assert alpha_pos < mu_pos < zeta_pos


def test_splice_skips_existing_token_name():
    new_css, added, skipped = _splice_tokens_into_theme(
        _BASE_THEME_CSS,
        {"color-primary": "#abcdef", "color-tertiary": "#7fb069"},
    )
    assert added == ["color-tertiary"]
    assert skipped == ["color-primary"]
    # Existing primary is NOT overwritten
    assert "--color-primary: #1565c0;" in new_css
    assert "--color-primary: #abcdef;" not in new_css


def test_splice_byte_stable_when_called_twice():
    additions = {"color-tertiary": "#7fb069", "color-success": "#3f8a4a"}
    once, _, _ = _splice_tokens_into_theme(_BASE_THEME_CSS, additions)
    twice, added, skipped = _splice_tokens_into_theme(once, additions)
    assert twice == once  # byte-identical
    assert added == []  # nothing new on second pass
    assert sorted(skipped) == ["color-success", "color-tertiary"]


def test_splice_no_theme_block_returns_unchanged():
    no_theme = "@import 'tailwindcss';\n:root { color-scheme: light; }\n"
    new_css, added, skipped = _splice_tokens_into_theme(no_theme, {"color-x": "#000000"})
    assert new_css == no_theme
    assert added == []
    assert skipped == []


def test_splice_empty_additions_is_noop():
    new_css, added, skipped = _splice_tokens_into_theme(_BASE_THEME_CSS, {})
    assert new_css == _BASE_THEME_CSS
    assert added == []
    assert skipped == []


def test_splice_preserves_indentation_of_existing_entries():
    new_css, _, _ = _splice_tokens_into_theme(_BASE_THEME_CSS, {"color-tertiary": "#7fb069"})
    # Indent before existing tokens is 4 spaces (inside @layer + @theme)
    assert "    --color-tertiary: #7fb069;" in new_css


# ---------------------------------------------------------------------------
# add_theme_tokens — full tool surface tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_add_single_token_writes_artifact():
    ctx = _DummyToolContext(_BASE_THEME_CSS)

    result = await add_theme_tokens(
        ctx,
        names=["color-tertiary"],
        values=["#7fb069"],
        rationale="hero badge accent",
    )

    assert result["success"] is True
    assert result["added"] == ["color-tertiary"]
    assert result["skipped_duplicates"] == []
    assert result["errors"] == []
    assert result["version"] == 1
    assert "--color-tertiary: #7fb069;" in _theme_css(ctx)


@pytest.mark.asyncio
async def test_add_three_tokens_at_once():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(
        ctx,
        names=["color-tertiary", "color-success", "color-warning"],
        values=["#7fb069", "#3f8a4a", "#f4a01e"],
    )
    assert result["success"] is True
    assert sorted(result["added"]) == ["color-success", "color-tertiary", "color-warning"]
    css = _theme_css(ctx)
    assert "--color-tertiary: #7fb069;" in css
    assert "--color-success: #3f8a4a;" in css
    assert "--color-warning: #f4a01e;" in css


@pytest.mark.asyncio
async def test_add_zero_tokens_is_noop_success():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(ctx, names=[], values=[])
    assert result["success"] is True
    assert result["added"] == []
    assert result["skipped_duplicates"] == []
    assert ctx.save_calls == []  # no artifact write


@pytest.mark.asyncio
async def test_idempotent_skip_of_existing_token():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(
        ctx,
        names=["color-primary"],
        values=["#deadbe"],
    )
    assert result["success"] is True
    assert result["added"] == []
    assert result["skipped_duplicates"] == ["color-primary"]
    assert "--color-primary: #1565c0;" in _theme_css(ctx)
    assert ctx.save_calls == []  # no artifact write — no change


@pytest.mark.asyncio
async def test_idempotent_when_called_twice():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    first = await add_theme_tokens(ctx, names=["color-tertiary"], values=["#7fb069"])
    css_after_first = _theme_css(ctx)
    second = await add_theme_tokens(ctx, names=["color-tertiary"], values=["#7fb069"])
    css_after_second = _theme_css(ctx)
    assert first["added"] == ["color-tertiary"]
    assert second["added"] == []
    assert second["skipped_duplicates"] == ["color-tertiary"]
    assert css_after_first == css_after_second


@pytest.mark.asyncio
async def test_invalid_token_name_returns_error():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(
        ctx,
        names=["Color-Bad"],  # uppercase rejected
        values=["#abcdef"],
    )
    assert result["success"] is False
    assert result["added"] == []
    assert any("Invalid token name" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_invalid_value_returns_error():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(
        ctx,
        names=["color-foo"],
        values=["red"],  # bare keyword not allowed
    )
    assert result["success"] is False
    assert any("Invalid value" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_accepts_hex_hsl_and_var_values():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(
        ctx,
        names=["color-a", "color-b", "color-c"],
        values=["#abcdef", "hsl(28 30% 75%)", "var(--color-primary)"],
    )
    assert result["success"] is True
    assert sorted(result["added"]) == ["color-a", "color-b", "color-c"]
    css = _theme_css(ctx)
    assert "--color-a: #abcdef;" in css
    assert "--color-b: hsl(28 30% 75%);" in css
    assert "--color-c: var(--color-primary);" in css


@pytest.mark.asyncio
async def test_strip_leading_dashes_from_name():
    """LLMs sometimes prepend `--` to the token name. Strip it."""
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(
        ctx,
        names=["--color-tertiary"],
        values=["#7fb069"],
    )
    assert result["success"] is True
    assert result["added"] == ["color-tertiary"]
    assert "--color-tertiary: #7fb069;" in _theme_css(ctx)


@pytest.mark.asyncio
async def test_mismatched_lengths_rejected():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(
        ctx,
        names=["color-a", "color-b"],
        values=["#abcdef"],
    )
    assert result["success"] is False
    assert any("same length" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_missing_theme_artifact_returns_error():
    ctx = _DummyToolContext(theme_css=None)
    result = await add_theme_tokens(ctx, names=["color-tertiary"], values=["#7fb069"])
    assert result["success"] is False
    assert any("Could not load theme artifact" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_partial_validation_some_valid_some_invalid_still_writes_valid():
    ctx = _DummyToolContext(_BASE_THEME_CSS)
    result = await add_theme_tokens(
        ctx,
        names=["color-good", "BAD-NAME"],
        values=["#abcdef", "#fedcba"],
    )
    # Mixed: at least one valid pair → still saves the valid one and reports the error
    assert result["success"] is True
    assert result["added"] == ["color-good"]
    assert any("Invalid token name" in e for e in result["errors"])
    assert "--color-good: #abcdef;" in _theme_css(ctx)
