"""Resilience tests for the auto-fix dispatcher.

Defensive tests covering malformed and edge-case inputs:
- empty TSX
- whitespace-only TSX
- syntactically broken TSX (unmatched braces)
- ``None`` / empty FixContext fields
- non-ASCII content
- pathological self-referential ``useApp`` patterns

The dispatcher and individual fixers must NOT crash on any of these.
They may produce empty output or no fixes, but they must terminate
cleanly. A crash here would cause the Code Focus pipeline to hang or
fail without a useful error.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers import apply_auto_fixes
from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.component_a11y_ux import (
    apply_component_a11y_ux_fixes,
)
from main_agent.services.validation.fixers.component_imports import (
    apply_component_imports_fixes,
)
from main_agent.services.validation.fixers.component_null_safety import (
    apply_component_null_safety_fixes,
)
from main_agent.services.validation.fixers.component_polishing import (
    apply_component_polishing_fixes,
)
from main_agent.services.validation.fixers.component_typos import (
    apply_component_typos_fixes,
)
from main_agent.services.validation.fixers.component_urls_images import (
    apply_component_urls_images_fixes,
)

pytestmark = [pytest.mark.unit]

ALL_FIXERS = [
    apply_component_imports_fixes,
    apply_component_urls_images_fixes,
    apply_component_null_safety_fixes,
    apply_component_typos_fixes,
    apply_component_a11y_ux_fixes,
    apply_component_polishing_fixes,
]


@pytest.mark.parametrize("fixer", ALL_FIXERS, ids=lambda f: f.__name__)
def test_each_fixer_handles_empty_string(fixer):
    """Empty TSX must not crash any fixer; output is unchanged, no fixes."""
    fixes: list[str] = []
    output = fixer("", FixContext(), fixes)
    assert output == ""
    assert fixes == []


@pytest.mark.parametrize("fixer", ALL_FIXERS, ids=lambda f: f.__name__)
def test_each_fixer_handles_whitespace_only(fixer):
    """Whitespace-only input is valid (LLM occasionally returns just newlines
    when the prompt is degenerate). Each fixer must pass it through.
    """
    src = "\n\n   \n\t\n"
    fixes: list[str] = []
    output = fixer(src, FixContext(), fixes)
    assert output == src
    assert fixes == []


def test_dispatcher_handles_unmatched_braces():
    """Syntactically broken TSX must not crash the dispatcher. Most fixers
    are regex-based and tolerate it; the AST-using ones (useApp destructure
    rewrite, M3 pairing) parse defensively and fall through on parse error.
    """
    broken = "function Hero() { return <div"
    fixed, fixes = apply_auto_fixes(
        broken,
        models=[],
        actions={},
        state_keys={},
        page_slugs=["/"],
    )
    # The fixer chain doesn't promise to FIX broken TSX, only that it
    # doesn't raise. The output may equal input or have minor cosmetic
    # changes.
    assert isinstance(fixed, str)
    assert isinstance(fixes, list)


def test_dispatcher_handles_none_optional_args():
    """Several FixContext fields default to None (handlers, page_slugs,
    theme_palette). Calling apply_auto_fixes with ``None`` for the
    optional kwargs must not raise.
    """
    fixed, fixes = apply_auto_fixes(
        "export default function H() { return <div/>; }",
        models=[],
        actions={},
        state_keys={},
        handlers=None,
        page_slugs=None,
        theme_palette=None,
    )
    assert "function H()" in fixed or "export default function" in fixed


def test_each_fixer_handles_non_ascii_content():
    """Component TSX with Unicode text content (Turkish, Chinese, emoji)
    must pass through every fixer without encoding errors.
    """
    src = (
        "import { React } from '@exepad/sdk';\n"
        "export default function Welcome() {\n"
        "  return <div>Selam — 你好 \U0001f44b Hoş geldin!</div>;\n"
        "}\n"
    )
    for fixer in ALL_FIXERS:
        fixes: list[str] = []
        output = fixer(src, FixContext(), fixes)
        assert "你好" in output, f"{fixer.__name__} dropped non-ASCII chars"
        assert "\U0001f44b" in output, f"{fixer.__name__} dropped emoji"


def test_circular_useapp_selector_does_not_loop():
    """A ``const x = useApp(s => s.x)`` selector that re-uses the destructured
    state key as the variable name has been observed to confuse regex-based
    auto-fixers. The null-safety pass must terminate without blowing the
    stack or hanging. We ensure both output is well-formed and the run
    completes inside a normal call (no timeout needed).
    """
    src = (
        "const profile = useApp(s => s.profile);\n" "return <div>{profile.profile.profile}</div>;\n"
    )
    ctx = FixContext(state_keys={"profile": None})
    fixes: list[str] = []
    output = apply_component_null_safety_fixes(src, ctx, fixes)
    # Optional chaining is added on the FIRST `.`, which is what the
    # regex targets. Subsequent `.profile.profile` chains are a separate
    # nested-property concern (handled at a different layer). The key
    # invariant here is termination, not full-chain rewriting.
    assert "profile?." in output
    assert isinstance(fixes, list)


def test_dispatcher_handles_extremely_short_tsx():
    """Single-character / single-token inputs must not crash. esbuild will
    flag them at the syntax stage, but the fixer chain itself shouldn't.
    """
    for src in ("x", "{}", ";", "<>", "<><>"):
        fixed, fixes = apply_auto_fixes(
            src,
            models=[],
            actions={},
            state_keys={},
            page_slugs=["/"],
        )
        assert isinstance(fixed, str)
        assert isinstance(fixes, list)
