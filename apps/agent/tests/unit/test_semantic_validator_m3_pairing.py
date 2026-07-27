"""Unit tests for M3 dark-bg text pairing rules and auto-fixes.

Tests cover:
- DarkBgTextPairingRule: detection on static + template literal classNames
- LightTextOnLightBgRule: reverse check (white text on light bg)
- apply_auto_fixes: rewriting text-on-surface → text-on-{token}
- Step 4 orphan fix: preserving text-inverse-on-surface on bg-primary
"""

import pytest

from main_agent.services.validation.fixers import apply_auto_fixes
from main_agent.services.validation.tsx_ast import AstContext, parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.rules.component_m3_colors import (
    DarkBgTextPairingRule,
    LightTextOnLightBgRule,
)

pytestmark = [pytest.mark.unit]


def _run_rule(rule, tsx: str, theme_palette: dict[str, str] | None = None) -> list[str]:
    """Run ``rule`` over ``tsx`` and return the list of formatted warnings.

    Mirrors the contract of the legacy regex check functions: the returned
    strings start with ``Line ~N: ...`` so downstream ``in`` assertions
    keep working.
    """
    tree = parse_tsx(tsx)
    ctx = AstContext(
        tsx=tsx,
        source_buf=source_bytes(tsx),
        tree=tree,
        theme_palette=theme_palette,
    )
    return [f.message for f in rule.check(ctx)]


def check_dark_bg_text_pairing(
    tsx: str,
    theme_palette: dict[str, str] | None = None,
) -> list[str]:
    return _run_rule(DarkBgTextPairingRule(), tsx, theme_palette)


def check_light_text_on_light_bg(
    tsx: str,
    theme_palette: dict[str, str] | None = None,
) -> list[str]:
    return _run_rule(LightTextOnLightBgRule(), tsx, theme_palette)


# =============================================================================
# check_dark_bg_text_pairing
# =============================================================================


class TestCheckDarkBgTextPairing:
    def test_text_on_surface_on_bg_primary_same_element(self):
        tsx = '<div className="bg-primary text-on-surface p-4">Hello</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 1
        assert "text-on-surface" in warnings[0]
        assert "bg-primary" in warnings[0]
        assert "text-on-primary" in warnings[0]

    def test_text_on_surface_variant_on_bg_primary(self):
        tsx = '<div className="bg-primary text-on-surface-variant p-4">Hello</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 1
        assert "text-on-surface-variant" in warnings[0]

    def test_text_on_surface_on_bg_secondary(self):
        tsx = '<div className="bg-secondary text-on-surface">Hello</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 1
        assert "bg-secondary" in warnings[0]
        assert "text-on-secondary" in warnings[0]

    def test_text_on_surface_on_bg_error(self):
        tsx = '<div className="bg-error text-on-surface">Error msg</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 1
        assert "text-on-error" in warnings[0]

    def test_correct_pairing_no_warning(self):
        tsx = '<div className="bg-primary text-on-primary p-4">Hello</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 0

    def test_text_white_on_dark_bg_no_warning(self):
        tsx = '<div className="bg-primary text-white p-4">Hello</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 0

    def test_light_bg_no_warning(self):
        tsx = '<div className="bg-surface text-on-surface p-4">Hello</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 0

    def test_no_dark_bg_fast_path(self):
        tsx = '<div className="bg-white text-on-surface">Hello</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 0

    def test_proximity_child_detection(self):
        """text-on-surface in a child of bg-primary should be flagged."""
        tsx = """
        <footer className="bg-primary p-8">
          <p className="text-on-surface/80">Nearly invisible text</p>
        </footer>
        """
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) >= 1
        assert "text-on-surface" in warnings[0]

    def test_proximity_stops_at_light_bg(self):
        """Children after a light bg override should not be flagged."""
        tsx = """
        <footer className="bg-primary p-8">
          <div className="bg-surface p-4">
            <p className="text-on-surface">This is fine — on light bg</p>
          </div>
        </footer>
        """
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 0

    def test_low_opacity_bg_primary_skipped(self):
        """bg-primary/10 is too transparent to cause contrast issues."""
        tsx = '<div className="bg-primary/10 text-on-surface">Tinted bg</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 0

    def test_bg_primary_container_not_flagged(self):
        """bg-primary-container is a light variant — should not match."""
        tsx = '<div className="bg-primary-container text-on-surface">Light bg</div>'
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 0

    def test_real_footer_pattern(self):
        """Reproduce the actual failing footer from the debug report."""
        tsx = """
        <footer className="bg-primary text-on-surface relative border-t border-outline/20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="space-y-6">
              <span className="font-headline text-2xl font-bold text-white">Brand</span>
              <p className="text-sm text-on-surface/80 max-w-xs">Description text</p>
            </div>
            <h4 className="font-headline text-xl text-white">Heading</h4>
            <a className="text-sm text-on-surface/80 hover:text-secondary">Link</a>
          </div>
        </footer>
        """
        warnings = check_dark_bg_text_pairing(tsx)
        # Should flag text-on-surface on the footer itself + children
        assert len(warnings) >= 1

    def test_light_primary_with_dark_on_primary_is_advisory(self):
        tsx = '<div className="bg-primary text-on-surface p-4">Hello</div>'
        warnings = check_dark_bg_text_pairing(
            tsx,
            theme_palette={
                "primary": "#7dd3fc",
                "on-primary": "#1c1b1f",
                "on-surface": "#1c1b1f",
            },
        )
        assert len(warnings) == 1
        assert "text-on-primary" in warnings[0]
        assert "resolved theme pair" in warnings[0]

    # --- Issue 5: Template literal className support ---

    def test_template_literal_same_element(self):
        """Template literal className with bg-primary + text-on-surface."""
        tsx = "<div className={`bg-primary text-on-surface p-4`}>Hello</div>"
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 1
        assert "bg-primary" in warnings[0]

    def test_template_literal_with_expression(self):
        """Template literal with ${} expression — static parts still checked."""
        tsx = (
            '<div className={`bg-primary ${isActive ? "font-bold" : ""} text-on-surface`}>Hi</div>'
        )
        warnings = check_dark_bg_text_pairing(tsx)
        assert len(warnings) == 1

    def test_template_literal_dynamic_text_not_flagged(self):
        """Text color inside ${} expression should not be flagged."""
        tsx = (
            '<div className={`bg-primary ${isActive ? "text-on-surface" : "text-white"}`}>Hi</div>'
        )
        warnings = check_dark_bg_text_pairing(tsx)
        # text-on-surface is inside ${} — stripped, so not flagged
        assert len(warnings) == 0


# =============================================================================
# check_light_text_on_light_bg (Issue 6: reverse check)
# =============================================================================


class TestCheckLightTextOnLightBg:
    # Track 2 (post-2026-04) policy: uses the JSX ancestor walker, so
    # ``text-on-primary`` on a child element IS flagged when the nearest
    # enclosing explicit ancestor bg resolves to a light M3 surface.
    # Bare children with no resolvable ancestor stay silent — the walker
    # cannot guess what's above the top of the tree.
    #
    # Before Track 2 the check was same-element only; the rewrite recovers
    # the false negatives without re-introducing the 53× false-positive
    # cascade documented for session-20260415T091442-0dab09.

    def test_text_on_primary_bare_no_ancestor_no_flag(self):
        """text-on-primary at the top of the tree — no ancestor, stay silent."""
        tsx = '<p className="text-on-primary">Child of unknown parent bg</p>'
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_text_on_primary_bare_no_ancestor_even_with_palette(self):
        """Resolving the palette does not change the no-ancestor case."""
        tsx = '<p className="text-on-primary">Readable but semantically unclear</p>'
        warnings = check_light_text_on_light_bg(
            tsx,
            theme_palette={
                "primary": "#7dd3fc",
                "on-primary": "#1c1b1f",
                "surface": "#ffffff",
            },
        )
        assert warnings == []

    def test_text_on_primary_bare_child_of_bg_surface_parent_flagged(self):
        """Track 2 recovery: ancestor walker resolves bg-surface → true positive."""
        tsx = """
        <section className="bg-surface">
          <p className="text-on-primary">Invisible</p>
        </section>
        """
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 1
        assert "text-on-primary" in warnings[0]

    def test_text_on_secondary_bare_child_deep_in_bg_surface(self):
        """Deeply nested child inherits the nearest enclosing bg."""
        tsx = """
        <section className="bg-surface">
          <div>
            <article>
              <span className="text-on-secondary">invisible</span>
            </article>
          </div>
        </section>
        """
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 1
        assert "text-on-secondary" in warnings[0]

    def test_text_on_primary_bare_child_of_bg_primary_parent_not_flagged(self):
        """Track 2 correctness: child of dark parent is correctly paired."""
        tsx = """
        <section className="bg-primary">
          <p className="text-on-primary">OK, inherited dark bg</p>
        </section>
        """
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_nested_light_card_inside_dark_band_stays_silent(self):
        """An explicit bg-surface card inside a bg-primary section is its
        own correct scope — children inherit bg-surface, and text-on-
        primary on them would be wrong, but text-on-surface is fine.
        """
        tsx = """
        <section className="bg-primary">
          <article className="bg-surface">
            <p className="text-on-surface">Readable body</p>
          </article>
        </section>
        """
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_text_on_primary_on_bg_primary(self):
        """text-on-primary on bg-primary — correct pairing, no flag."""
        tsx = '<div className="bg-primary text-on-primary">OK</div>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 0

    def test_text_on_secondary_on_bg_surface(self):
        """text-on-secondary on SAME-element bg-surface — true positive."""
        tsx = '<div className="bg-surface text-on-secondary">Invisible</div>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 1
        assert "text-on-secondary" in warnings[0]

    def test_text_on_primary_on_bg_surface(self):
        """text-on-primary on SAME-element bg-surface — true positive."""
        tsx = '<div className="bg-surface text-on-primary">Invisible</div>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 1
        assert "text-on-primary" in warnings[0]

    def test_text_on_primary_on_bg_surface_container(self):
        """text-on-primary on SAME-element bg-surface-container — true positive."""
        tsx = '<div className="bg-surface-container text-on-primary">Invisible</div>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 1

    def test_text_on_error_on_bg_error(self):
        """text-on-error on bg-error — correct, no flag."""
        tsx = '<div className="bg-error text-on-error">Error</div>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 0

    def test_text_on_primary_on_bg_inverse_surface(self):
        """text-on-primary on bg-inverse-surface (dark) — no flag."""
        tsx = '<div className="bg-inverse-surface text-on-primary">OK</div>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 0

    def test_text_on_primary_on_unknown_bg(self):
        """text-on-primary on bg-muted (ambiguous) — skip, no flag."""
        tsx = '<div className="bg-muted text-on-primary">Maybe OK</div>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 0

    def test_text_on_primary_with_opacity_bare_no_flag(self):
        """text-on-primary/80 with no bg — bare element, not flagged.

        Opacity modifiers on text tokens are forbidden by policy and the
        auto-fixer strips them before this check runs.  The surviving bare
        className has no ancestor info so we stay silent.
        """
        tsx = '<p className="text-on-primary/80">Semi-transparent white</p>'
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_text_on_primary_with_opacity_on_bg_surface(self):
        """text-on-primary/80 ON same-element light bg — still flagged."""
        tsx = '<p className="bg-surface text-on-primary/80">White on white</p>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 1

    def test_template_literal_text_on_primary_bare_no_flag(self):
        """Template literal, bare element — follows same ancestry-unknown rule."""
        tsx = "<p className={`text-on-primary text-sm`}>Unknown parent</p>"
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_template_literal_text_on_primary_on_bg_surface(self):
        """Template literal with explicit light bg — still flagged."""
        tsx = "<p className={`bg-surface text-on-primary text-sm`}>White on white</p>"
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 1

    def test_real_world_bg_secondary_child_no_flag(self):
        """Regression: MembersContent table header pattern from rg4509tv.

        <thead className="bg-secondary"><th className="text-on-secondary">…
        Used to produce 17 false positives.  Must be silent.
        """
        tsx = """
        <thead className="bg-secondary">
          <tr>
            <th className="text-on-secondary font-bold">Name</th>
            <th className="text-on-secondary font-bold">Email</th>
            <th className="text-on-secondary">Status</th>
          </tr>
        </thead>
        """
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_no_light_text_fast_path(self):
        """No text-on-primary/secondary/error present — fast path."""
        tsx = '<div className="bg-surface text-on-surface">Normal</div>'
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 0

    # --- Corpus regression: word-boundary false positive (2026-04-15) ---

    def test_text_on_primary_container_not_falsely_flagged(self):
        """text-on-primary-container is a valid M3 token; the regex must
        not match its ``text-on-primary`` prefix.

        Regression harvested from RequestListContent_fbce13c325419db6
        where 12 such false positives fired across 7 components before
        the word-boundary fix.
        """
        tsx = (
            '<div className="bg-surface">'
            '<p className="text-on-primary-container">chip</p>'
            "</div>"
        )
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_text_on_secondary_container_not_falsely_flagged(self):
        """Same regression, secondary family."""
        tsx = (
            '<div className="bg-secondary-container flex items-center '
            'text-on-secondary-container">icon+label</div>'
        )
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_text_on_error_container_not_falsely_flagged(self):
        """Same regression, error family."""
        tsx = '<div className="bg-error-container text-on-error-container">' "error chip</div>"
        warnings = check_light_text_on_light_bg(tsx)
        assert warnings == []

    def test_text_on_primary_still_flagged_when_bare_on_container_parent(self):
        """Sanity: the fix must not over-silence genuine primary misuse.

        An element with text-on-primary on a light surface-container
        parent IS a true positive — primary-container is light.
        """
        tsx = (
            '<div className="bg-primary-container">'
            '<p className="text-on-primary">still wrong</p>'
            "</div>"
        )
        warnings = check_light_text_on_light_bg(tsx)
        assert len(warnings) == 1


# =============================================================================
# apply_auto_fixes — M3 pairing fix
# =============================================================================


class TestAutoFixM3Pairing:
    """Test apply_auto_fixes rewrites text-on-surface on dark M3 backgrounds."""

    # Minimal args for apply_auto_fixes — M3 fix doesn't need models/actions/state
    _DEFAULTS = dict(models=[], actions={}, state_keys={})

    def test_fixes_text_on_surface_to_text_on_primary(self):
        tsx = '<div className="bg-primary text-on-surface p-4">Hello</div>'
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-primary" in fixed
        assert "text-on-surface" not in fixed

    def test_fixes_child_text_on_surface_via_ancestor_walker(self):
        """Track 2: ancestor-aware auto-fixer rewrites child text tokens.

        Before Track 2 the fixer intentionally did NOT cross-rewrite
        child tokens because it couldn't tell whether the child was
        actually enclosed by the dark bg (the legacy fixer was per-
        className only).  Now the walker resolves the parent chain, so
        ``<p className="text-on-surface">`` inside ``<footer className=
        "bg-primary">`` correctly becomes ``text-on-primary`` in one
        pass without requiring the fixer agent.
        """
        tsx = """
        <footer className="bg-primary p-8">
          <p className="text-on-surface/80">Text</p>
        </footer>
        """
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        # Text opacity strip runs before the ancestor-aware pairing fix,
        # so /80 is gone and the surviving text-on-surface is rewritten.
        assert "/80" not in fixed
        assert "text-on-primary" in fixed
        assert "text-on-surface" not in fixed

    def test_does_not_cross_rewrite_into_light_nested_card(self):
        tsx = """
        <footer className="bg-primary p-8">
          <div className="bg-surface rounded-xl p-6">
            <p className="text-on-surface">Readable body copy</p>
          </div>
        </footer>
        """
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "bg-surface rounded-xl p-6" in fixed
        assert "text-on-surface" in fixed
        assert "text-on-primary" not in fixed
        assert not any("text-on-{token}" in f for f in fixes)

    def test_does_not_touch_correct_pairing(self):
        tsx = '<div className="bg-primary text-on-primary p-4">Hello</div>'
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-primary" in fixed
        assert fixed.count("text-on-primary") == 1

    def test_fixes_bg_secondary_pairing(self):
        tsx = '<div className="bg-secondary text-on-surface">Hello</div>'
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-secondary" in fixed

    # --- Corpus regression: bg-inverse-surface ancestor fix (2026-04-15) ---

    def test_rewrites_child_text_on_surface_under_bg_inverse_surface(self):
        """Harvested from WalkersContent_41ba732c75df1588 — the LLM
        generated ``<p className="text-on-surface">`` inside a
        ``<div className="bg-inverse-surface">`` hero banner.  The
        ancestor-aware auto-fixer must rewrite children to
        ``text-inverse-on-surface`` so the categorical error never
        reaches the fixer agent retry.
        """
        tsx = """
        <div className="bg-inverse-surface rounded-[24px] p-8">
          <h2 className="text-on-surface text-2xl font-bold">Safety First</h2>
          <p className="text-on-surface text-lg">Every walker is vetted.</p>
        </div>
        """
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-surface" not in fixed
        assert fixed.count("text-inverse-on-surface") == 2
        assert any("ancestor bg" in f for f in fixes)

    # --- Corpus regression: text-on-X-container on bg-X (luna-rest, 2026-05-12) ---

    def test_rewrites_text_on_primary_container_under_bg_primary_ancestor(self):
        """Harvested from luna-rest (jmhd6gv7): paragraphs used
        ``text-on-primary-container`` inside ``bg-primary`` sections.
        Because ``--color-on-primary-container`` is near-black, the
        rendered contrast was ~1.3 : 1 (unreadable). Track 2 must
        rewrite the child token to ``text-on-primary``."""
        tsx = (
            '<section className="py-24 bg-primary text-on-primary">'
            '<p className="text-on-primary-container text-lg leading-relaxed">'
            "Hybrid Engineering for Elite Support."
            "</p>"
            "</section>"
        )
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-primary-container" not in fixed
        assert "text-on-primary" in fixed

    def test_rewrites_text_on_secondary_container_under_bg_secondary_ancestor(self):
        """Same regression, secondary family."""
        tsx = (
            '<section className="bg-secondary">'
            '<h2 className="text-on-secondary-container text-3xl">Heading</h2>'
            "</section>"
        )
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-secondary-container" not in fixed
        assert "text-on-secondary" in fixed

    def test_rewrites_text_on_error_container_under_bg_error_ancestor(self):
        """Same regression, error family."""
        tsx = (
            '<div className="bg-error">'
            '<p className="text-on-error-container">Error detail</p>'
            "</div>"
        )
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-error-container" not in fixed
        assert "text-on-error" in fixed

    def test_text_on_primary_container_under_bg_primary_container_unchanged(self):
        """Negative: the canonical correct pairing must stay untouched."""
        tsx = (
            '<div className="bg-primary-container">'
            '<p className="text-on-primary-container">Chip body</p>'
            "</div>"
        )
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-primary-container" in fixed

    def test_same_element_text_on_primary_container_on_bg_primary(self):
        """``<div className="bg-primary text-on-primary-container">`` —
        same-element wrong pairing must also be rewritten."""
        tsx = (
            '<div className="bg-primary text-on-primary-container p-8">Hero</div>'
        )
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-primary-container" not in fixed
        assert "text-on-primary" in fixed

    def test_rewrites_same_element_light_bg_with_wrong_dark_text_token(self):
        """Harvested from ScheduleContent_5aabf3189393e108 — a Button
        with ``bg-surface-container-highest text-on-primary`` on the
        same element.  This is the reverse of the canonical M3 pairing
        fix (dark bg + text-on-surface) and used to escape the
        same-element rewrite.  Track 2 closes it.
        """
        tsx = (
            '<button className="bg-surface-container-highest text-on-primary '
            'font-bold px-4">Mark Present</button>'
        )
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-primary" not in fixed
        assert "text-on-surface" in fixed


# =============================================================================
# Step 4 orphan fix — Issue 1: must preserve text-inverse-on-surface on bg-primary
# =============================================================================


class TestOrphanFixDarkPositions:
    """Step 4 must NOT revert text-inverse-on-surface on M3 dark backgrounds."""

    _DEFAULTS = dict(models=[], actions={}, state_keys={})

    def test_preserves_inverse_text_on_bg_primary(self):
        """text-inverse-on-surface on bg-primary should NOT be reverted."""
        tsx = '<footer className="bg-primary text-inverse-on-surface p-8">White text</footer>'
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        # Should keep white text — bg-primary is dark
        assert "text-inverse-on-surface" in fixed or "text-on-primary" in fixed
        # Must NOT have text-on-surface (dark text on dark bg)
        assert "text-on-surface" not in fixed or "text-on-surface" not in fixed.replace(
            "text-on-primary", ""
        ).replace("text-inverse-on-surface", "")

    def test_preserves_inverse_text_in_bg_primary_child(self):
        """text-inverse-on-surface in a child of bg-primary should be preserved."""
        tsx = """
        <footer className="bg-primary p-8">
          <p className="text-inverse-on-surface">White text on dark</p>
        </footer>
        """
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        # The child text should stay white — either as inverse-on-surface or on-primary
        assert "text-on-surface p-8" not in fixed  # not reverted to dark on parent
        # Child should not have bare text-on-surface (dark)
        assert 'className="text-on-surface"' not in fixed

    def test_still_reverts_orphan_on_light_bg(self):
        """text-inverse-on-surface on light bg should still be reverted."""
        tsx = '<div className="bg-surface text-inverse-on-surface">Wrong</div>'
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-surface" in fixed
        assert "text-inverse-on-surface" not in fixed

    def test_still_reverts_orphan_no_bg(self):
        """text-inverse-on-surface with no bg at all should be reverted."""
        tsx = '<p className="text-inverse-on-surface text-lg">Orphaned white</p>'
        fixed, fixes = apply_auto_fixes(tsx, **self._DEFAULTS)
        assert "text-on-surface" in fixed
        assert "text-inverse-on-surface" not in fixed
