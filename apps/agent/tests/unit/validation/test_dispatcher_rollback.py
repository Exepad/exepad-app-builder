"""Tests for the per-fixer rollback wrapper in ``fixers.dispatcher``.

The wrapper is the heart of Change A: when a single fixer corrupts JSX,
its mutations are reverted in isolation while the rest of the pipeline
continues. Without this layer, one corrupting fixer poisoned the whole
batch and Tier B threw away every other fixer's safe mutations along
with the unsafe one — the failure mode that shipped React-#130 crashes
in app ``ze1ltmf9``.
"""

from __future__ import annotations

import pytest

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.fixers.dispatcher import (
    _apply_with_rollback,
    apply_auto_fixes,
)


pytestmark = [pytest.mark.unit]


_CLEAN_TSX = (
    "import { React, LightDOMContainer } from \"@exepad/sdk\";\n"
    "function HomeContent() {\n"
    "  return (<LightDOMContainer><div>Hello</div></LightDOMContainer>);\n"
    "}\n"
    "export default HomeContent;\n"
)

_CORRUPTED_TSX = "// pretend this fails esbuild parse"


def _make_ctx() -> FixContext:
    return FixContext(expected_component_name="HomeContent")


# --------------------------------------------------------------------------- #
# _apply_with_rollback unit tests
# --------------------------------------------------------------------------- #


def test_clean_fixer_output_passes_through_with_prefixed_fixes(monkeypatch):
    """Tier A: fixer returns parseable JSX → output kept, fixes prefixed."""
    monkeypatch.setattr(
        "main_agent.services.validation.fixers.dispatcher.validate_tsx_syntax",
        lambda _src: (True, []),
    )
    fixes: list[str] = []

    def fixer(tsx, ctx, fixes_applied):
        fixes_applied.append("Renamed Foo → Bar")
        return tsx + "\n// touched"

    out = _apply_with_rollback("test_fixer", fixer, _CLEAN_TSX, _make_ctx(), fixes)
    assert out == _CLEAN_TSX + "\n// touched"
    assert fixes == ["[test_fixer] Renamed Foo → Bar"], (
        "Fix message should be prefixed with the fixer name for log bisection"
    )


def test_corrupting_fixer_is_rolled_back(monkeypatch):
    """Tier B (per-fixer): output fails parse → mutation reverted, fixes dropped."""
    # First call (validating the corrupting fixer's output) returns invalid;
    # any subsequent call returns valid. The wrapper only calls validate once
    # per fixer, so this is enough.
    calls = iter([(False, ["mismatched tag"])])
    monkeypatch.setattr(
        "main_agent.services.validation.fixers.dispatcher.validate_tsx_syntax",
        lambda _src: next(calls),
    )
    fixes: list[str] = ["[earlier_fixer] earlier survives"]

    def corrupting(tsx, ctx, fixes_applied):
        fixes_applied.append("Wrote 32 corrupting className changes")
        return _CORRUPTED_TSX

    out = _apply_with_rollback(
        "polishing", corrupting, _CLEAN_TSX, _make_ctx(), fixes
    )
    assert out == _CLEAN_TSX, "Source must be reverted to pre-fixer state"
    assert fixes == ["[earlier_fixer] earlier survives"], (
        "Corrupting fixer's appended messages must be dropped; "
        "earlier fixers' messages must survive"
    )


def test_raising_fixer_is_rolled_back(monkeypatch):
    """Defensive: fixer raises → mutations reverted, pipeline continues."""
    monkeypatch.setattr(
        "main_agent.services.validation.fixers.dispatcher.validate_tsx_syntax",
        lambda _src: (True, []),
    )
    fixes: list[str] = ["[earlier_fixer] earlier survives"]

    def raising(tsx, ctx, fixes_applied):
        fixes_applied.append("about to crash")
        raise RuntimeError("boom")

    out = _apply_with_rollback("buggy", raising, _CLEAN_TSX, _make_ctx(), fixes)
    assert out == _CLEAN_TSX
    assert fixes == ["[earlier_fixer] earlier survives"], (
        "Mid-fixer-crash mutations must be cleaned up"
    )


def test_already_prefixed_fixes_are_not_double_prefixed(monkeypatch):
    """A fixer that emits its own ``[name]`` prefix shouldn't get re-tagged."""
    monkeypatch.setattr(
        "main_agent.services.validation.fixers.dispatcher.validate_tsx_syntax",
        lambda _src: (True, []),
    )
    fixes: list[str] = []

    def fixer(tsx, ctx, fixes_applied):
        fixes_applied.append("[manual] already-tagged")
        fixes_applied.append("untagged")
        return tsx

    _apply_with_rollback("auto_tagged", fixer, _CLEAN_TSX, _make_ctx(), fixes)
    assert fixes == ["[manual] already-tagged", "[auto_tagged] untagged"]


# --------------------------------------------------------------------------- #
# apply_auto_fixes integration test
# --------------------------------------------------------------------------- #


def test_apply_auto_fixes_isolates_corrupting_fixer(monkeypatch):
    """One corrupting fixer must not poison the rest of the pipeline.

    Reproduces the ``ze1ltmf9`` failure pattern at the dispatcher level:
    fixer #4 corrupts JSX, fixer #5 still gets to run on the pre-corruption
    source. The shipped fix list contains the safe fixer's message; the
    corrupting fixer's appended messages are absent.
    """
    # Mock the full pipeline: replace _FIXER_PIPELINE with three scripted
    # fixers — safe, corrupting, safe-again. validate_tsx_syntax should
    # return False only for the corrupting fixer's output.
    def safe_fixer_a(tsx, ctx, fixes_applied):
        fixes_applied.append("safe-A applied")
        return tsx + "\n// safe-A"

    def corrupting_fixer(tsx, ctx, fixes_applied):
        fixes_applied.append("corrupting touched 32 lines")
        return _CORRUPTED_TSX

    def safe_fixer_b(tsx, ctx, fixes_applied):
        fixes_applied.append("safe-B applied")
        return tsx + "\n// safe-B"

    monkeypatch.setattr(
        "main_agent.services.validation.fixers.dispatcher._FIXER_PIPELINE",
        (
            ("safe_a", safe_fixer_a),
            ("polishing", corrupting_fixer),
            ("safe_b", safe_fixer_b),
        ),
    )

    # Validate: any source containing the corruption marker fails parse.
    def fake_validate(src: str) -> tuple[bool, list[str]]:
        if "pretend this fails" in src:
            return (False, ["✘ mismatched tag"])
        return (True, [])

    monkeypatch.setattr(
        "main_agent.services.validation.fixers.dispatcher.validate_tsx_syntax",
        fake_validate,
    )

    out, fixes = apply_auto_fixes(
        _CLEAN_TSX,
        models=[],
        actions={},
        state_keys={},
        expected_component_name="HomeContent",
    )

    # Both safe fixers' mutations survived in the source.
    assert "// safe-A" in out
    assert "// safe-B" in out
    # The corrupting fixer's body never reached the output.
    assert "pretend this fails" not in out

    # Fix log: safe-A and safe-B prefixed with their fixer names; corrupting
    # fixer's message is absent (rolled back).
    assert "[safe_a] safe-A applied" in fixes
    assert "[safe_b] safe-B applied" in fixes
    assert not any("corrupting" in f for f in fixes), (
        f"Rolled-back fix message should not appear in shipped fixes: {fixes}"
    )
