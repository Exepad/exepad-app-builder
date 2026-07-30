"""Tests for _lift_nested_utility_blocks.

Tailwind v4 rejects `@utility` declarations nested inside any other
at-rule (`@layer`, `@theme`, `@media`, ...). The LLM occasionally
generates this pattern and triggers a hard CSS compile failure.
_lift_nested_utility_blocks deterministically moves offending blocks to
the stylesheet top level.
"""

import pytest

from main_agent.services.validation.final_compile_gate import (
    _lift_nested_utility_blocks,
)

pytestmark = [pytest.mark.unit]


def _block_body(css: str, opener: str) -> str:
    """Return the inner body of the first `<opener> { ... }` block."""
    start = css.index(opener)
    open_brace = css.index("{", start)
    depth = 0
    i = open_brace
    while i < len(css):
        ch = css[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return css[open_brace + 1 : i]
        i += 1
    raise AssertionError(f"unbalanced {opener}")


def _layer_body(css: str) -> str:
    """Backward-compat wrapper for tests that target `@layer exepad-app`."""
    return _block_body(css, "@layer exepad-app")


def test_single_nested_utility_is_lifted():
    css = """\
@layer exepad-app {
  @import "tailwindcss";
  @theme { --color-primary: #000; }
  @utility glow {
    box-shadow: 0 0 10px var(--color-primary);
  }
}
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 1
    # The nested block is removed from inside the layer
    assert "@utility" not in _layer_body(out)
    # And appears at the top level
    assert "@utility glow" in out
    assert "box-shadow: 0 0 10px var(--color-primary);" in out


def test_multiple_nested_utilities_preserve_order():
    css = """\
@layer exepad-app {
  @utility glow-a { color: red; }
  @utility glow-b { color: blue; }
  @utility glow-c { color: green; }
}
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 3
    idx_a = out.find("@utility glow-a")
    idx_b = out.find("@utility glow-b")
    idx_c = out.find("@utility glow-c")
    assert idx_a != -1 and idx_b != -1 and idx_c != -1
    assert idx_a < idx_b < idx_c
    # All three are now outside the @layer block
    layer_end = out.index("@layer exepad-app")
    layer_close = out.index("}", layer_end)
    assert idx_a > layer_close
    assert idx_b > layer_close
    assert idx_c > layer_close


def test_mixed_nested_and_top_level_utilities():
    css = """\
@layer exepad-app {
  @theme { --color-primary: #000; }
  @utility nested-a { color: red; }
}

@utility existing-top { color: blue; }
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 1
    # Lifted block is inserted BEFORE the existing top-level one
    assert out.index("@utility nested-a") < out.index("@utility existing-top")
    # No @utility inside the @layer anymore
    assert "@utility" not in _layer_body(out)


def test_nested_utility_with_media_query_preserves_braces():
    css = """\
@layer exepad-app {
  @utility fancy {
    color: red;
    @media (min-width: 640px) {
      color: blue;
    }
  }
  @theme { --color-primary: #000; }
}
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 1
    # The inner @media block must come with the lifted @utility, not be
    # orphaned inside the layer.
    assert "@media (min-width: 640px)" in out
    # @theme should still live inside @layer exepad-app
    layer_block_start = out.index("@layer exepad-app")
    layer_block_end = out.index("}", layer_block_start)
    assert "@theme" in out[layer_block_start:layer_block_end]
    # @media should NOT appear inside the @layer anymore — it moved with
    # the @utility. Confirm by checking that the only @media reference lives
    # after the layer's closing brace.
    media_idx = out.index("@media (min-width: 640px)")
    assert media_idx > layer_block_end


def test_already_valid_css_is_unchanged():
    css = """\
@layer exepad-app {
  @import "tailwindcss";
  @theme { --color-primary: #000; }
}

@utility glow {
  box-shadow: 0 0 10px var(--color-primary);
}
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 0
    assert out == css


def test_idempotent_second_pass_is_noop():
    css = """\
@layer exepad-app {
  @utility glow { color: red; }
  @utility halo { color: blue; }
}
"""
    once, count_once = _lift_nested_utility_blocks(css)
    assert count_once == 2
    twice, count_twice = _lift_nested_utility_blocks(once)
    assert count_twice == 0
    assert twice == once


def test_no_utility_keyword_is_fast_path():
    css = "@layer exepad-app { @theme { --color-primary: #000; } }\n"
    out, count = _lift_nested_utility_blocks(css)
    assert count == 0
    assert out == css


def test_lifts_from_non_exepad_layer():
    css = """\
@layer other {
  @utility glow { color: red; }
}
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 1
    # The lifted block lives at the top level (no exepad-app layer to anchor
    # against, so it appends at end-of-file).
    assert "@utility glow" in out
    # And is gone from inside @layer other.
    assert "@utility" not in _block_body(out, "@layer other")


def test_lifts_from_nested_at_theme():
    css = """\
@layer exepad-app {
  @theme {
    --color-primary: #000;
    @utility glow-text { color: var(--color-primary); }
  }
}
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 1
    # The @theme block keeps the custom property but loses the @utility.
    layer_inner = _layer_body(out)
    assert "@theme" in layer_inner
    assert "--color-primary: #000" in layer_inner
    assert "@utility" not in layer_inner
    # Lifted block lives outside both @layer exepad-app and @theme. Walk
    # the braces to find @layer's matching close (not @theme's).
    util_idx = out.index("@utility glow-text")
    depth = 1
    i = out.index("{", out.index("@layer exepad-app")) + 1
    while i < len(out) and depth > 0:
        if out[i] == "{":
            depth += 1
        elif out[i] == "}":
            depth -= 1
        i += 1
    assert util_idx >= i  # @utility appears after @layer's closing brace


def test_lifts_from_media_query():
    css = """\
@media (min-width: 640px) {
  @utility wide-only { font-size: 1.25rem; }
}
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 1
    media_inner = _block_body(out, "@media (min-width: 640px)")
    assert "@utility" not in media_inner
    assert "@utility wide-only" in out


def test_lifts_from_layer_base_not_just_exepad_app():
    css = """\
@layer base {
  @utility resetlike { display: block; }
}

@layer exepad-app {
  @theme { --color-primary: #000; }
}
"""
    out, count = _lift_nested_utility_blocks(css)
    assert count == 1
    # @layer base no longer contains the utility.
    assert "@utility" not in _block_body(out, "@layer base")
    # And it lives somewhere at the top level.
    assert "@utility resetlike" in out
