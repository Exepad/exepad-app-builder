"""Tests for ``services/theme/font_aliases``.

The DesignImporter runner used to fill in ``--font-headline`` /
``--font-body`` only when the bundle had M3-canonical names; bundles
with Tailwind/runtime names (``--font-heading``, ``--font-sans``) were
left without the M3 aliases. Class names the model emitted using the
canonical M3 vocabulary (``font-headline``, ``font-body``) then failed
strict literal-match style coverage. That asymmetry killed the Onix
Studio HomeContent build (2026-04-30).

These tests pin:

1. Single-direction derivations both ways (``headline → heading`` and
   the reverse-asymmetry case ``heading → headline`` that wasn't
   handled before).
2. Idempotence — both halves already present means nothing to add.
3. ``alias_aware_font_lookup`` falls through canonical pairs.
"""

from __future__ import annotations

import pytest

from main_agent.services.theme.font_aliases import (
    CANONICAL_FONT_PAIRS,
    alias_aware_font_lookup,
    compute_font_aliases,
)

pytestmark = [pytest.mark.unit]


# ──────────────────────────────────────────────────────────────────────
# compute_font_aliases — bidirectional derivation
# ──────────────────────────────────────────────────────────────────────


def test_emits_heading_alias_when_only_headline_present():
    out = compute_font_aliases({"--font-headline": "'Inter', sans-serif"})
    assert out == ["--font-heading: var(--font-headline)"]


def test_emits_headline_alias_when_only_heading_present_REGRESSION_ONIX():
    """Onix Studio regression. Pre-fix this returned [] and the build
    failed with ``font 'headline' not in tailwind.config extend.fontFamily``.
    """
    out = compute_font_aliases({"--font-heading": "'Fraunces', serif"})
    assert out == ["--font-headline: var(--font-heading)"]


def test_emits_sans_alias_when_only_body_present():
    out = compute_font_aliases({"--font-body": "'Inter', sans-serif"})
    assert out == ["--font-sans: var(--font-body)"]


def test_emits_body_alias_when_only_sans_present():
    """Symmetric to the headline-from-heading case for the body pair."""
    out = compute_font_aliases({"--font-sans": "'Inter', sans-serif"})
    assert out == ["--font-body: var(--font-sans)"]


def test_no_op_when_both_pair_members_present():
    """Idempotent: a theme that already has both halves of a pair gets
    no additional alias lines. Crucial because DesignSystemBuilder always
    emits both — running this on its output must not add duplicates.
    """
    out = compute_font_aliases(
        {
            "--font-heading": "'A', serif",
            "--font-headline": "'A', serif",
            "--font-sans": "'B', sans-serif",
            "--font-body": "'B', sans-serif",
        }
    )
    assert out == []


def test_no_op_on_empty_input():
    assert compute_font_aliases({}) == []


def test_handles_both_pairs_simultaneously():
    """A bundle that has only ``--font-heading`` and ``--font-sans``
    (the Tailwind/runtime convention) gets both M3 aliases added.
    """
    out = compute_font_aliases(
        {
            "--font-heading": "'Fraunces', serif",
            "--font-sans": "'Inter', sans-serif",
        }
    )
    assert "--font-headline: var(--font-heading)" in out
    assert "--font-body: var(--font-sans)" in out
    assert len(out) == 2


def test_ignores_non_font_tokens():
    """Color and radius tokens must not pollute the alias output."""
    out = compute_font_aliases(
        {
            "--color-primary": "#0F0",
            "--radius-lg": "1rem",
            "--font-heading": "'X', serif",
        }
    )
    assert out == ["--font-headline: var(--font-heading)"]


def test_idempotent_after_running_compute_then_apply():
    """Running compute_font_aliases on a theme, applying its output, and
    running it again must produce no new aliases — the operation
    converges in one step.
    """
    initial = {"--font-heading": "'X', serif"}
    first = compute_font_aliases(initial)
    assert first == ["--font-headline: var(--font-heading)"]

    # Simulate splicing the alias into the theme.
    after_apply = {**initial, "--font-headline": "var(--font-heading)"}
    second = compute_font_aliases(after_apply)
    assert second == []


# ──────────────────────────────────────────────────────────────────────
# alias_aware_font_lookup — fallthrough for resolvers
# ──────────────────────────────────────────────────────────────────────


def test_lookup_returns_direct_value_when_present():
    tokens = {"--font-headline": "'A', serif"}
    assert alias_aware_font_lookup(tokens, "headline") == "'A', serif"


def test_lookup_falls_through_to_canonical_alias():
    """The Onix Studio resolution case: caller asks for ``headline`` but
    only ``--font-heading`` is declared."""
    tokens = {"--font-heading": "'Fraunces', serif"}
    assert alias_aware_font_lookup(tokens, "headline") == "'Fraunces', serif"


def test_lookup_falls_through_in_both_directions():
    tokens = {"--font-headline": "'A', serif"}
    assert alias_aware_font_lookup(tokens, "heading") == "'A', serif"

    tokens2 = {"--font-sans": "'B', sans-serif"}
    assert alias_aware_font_lookup(tokens2, "body") == "'B', sans-serif"

    tokens3 = {"--font-body": "'C', sans-serif"}
    assert alias_aware_font_lookup(tokens3, "sans") == "'C', sans-serif"


def test_lookup_returns_none_for_unknown_name():
    assert alias_aware_font_lookup({"--font-heading": "'X'"}, "display") is None


def test_lookup_returns_none_when_neither_alias_present():
    assert alias_aware_font_lookup({}, "headline") is None


def test_canonical_pairs_includes_documented_set():
    """Pin the alias set to prevent silent drift. Adding a new pair
    requires updating this assertion AND the doc in
    ``packages/schemas/data/agent_docs/frontend/component_builder/docs/10_COLOR_AND_LAYOUT.md``.
    """
    pair_keys = {frozenset(p) for p in CANONICAL_FONT_PAIRS}
    assert pair_keys == {
        frozenset({"headline", "heading"}),
        frozenset({"body", "sans"}),
    }
