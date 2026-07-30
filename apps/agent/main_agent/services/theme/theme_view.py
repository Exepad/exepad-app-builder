"""Read-only view of a Tailwind v4 ``@theme`` block.

The platform has two consumers of "what tokens exist in theme.css?":

- :func:`build_design_system_context` — tells ComponentBuilder which
  tokens are usable in class names (the model is instructed to emit
  classes only for tokens that exist).
- :func:`style_coverage.parse_tailwind_config` — runs after generation
  to validate that every custom class in the TSX has a corresponding
  token.

Before this module, both consumers parsed theme.css independently with
their own regex passes. Each had blind spots:

- ``build_design_system_context`` returned a 2-key fonts dict
  (``{headline, body}``) — no awareness that the theme might also have
  ``--font-display`` or other custom names.
- ``parse_tailwind_config`` returned the raw set of token names — no
  alias awareness, so a class referencing ``font-headline`` would fail
  coverage even when ``--font-heading`` was the canonical alias.

:class:`ThemeView` unifies the two views:

- :meth:`available_color_tokens` / :meth:`available_font_tokens` return
  the **complete** set of names declared in ``@theme`` — including
  custom or domain-specific tokens the LLM should know about.
- :meth:`has_font` is alias-aware (via
  :func:`font_aliases.alias_aware_font_lookup`) so the validator
  doesn't false-positive on canonical pairs that DesignImporter's
  symmetric derivation already filled in.

The view is **descriptive, not prescriptive** — it never modifies the
CSS or enforces a schema. Theme content is whatever the upstream
producer wrote (DesignSystemBuilder for scratch, DesignImporter for
adopt mode); ThemeView simply reports it consistently.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from main_agent.services.theme.font_aliases import alias_aware_font_lookup


@dataclass(frozen=True)
class ThemeView:
    """Immutable read API over a parsed ``@theme`` block.

    Construction is via :meth:`from_css`. The dataclass is ``frozen``
    so consumers can pass it freely without copy-defensiveness.
    """

    raw_css: str
    colors: Mapping[str, str] = field(default_factory=dict)
    fonts: Mapping[str, str] = field(default_factory=dict)
    radii: Mapping[str, str] = field(default_factory=dict)

    @classmethod
    def from_css(cls, theme_css: str) -> "ThemeView":
        """Parse a ``theme.css`` source into a ``ThemeView``.

        Delegates to ``style_coverage.parse_css_theme`` for the actual
        regex extraction so there's a single parser implementation. If
        the CSS has no ``@theme`` block (empty fixture, malformed),
        returns an empty view rather than raising.
        """
        # Local import to avoid an import cycle with style_coverage,
        # which also wants to delegate ThemeView construction back here
        # eventually.
        from main_agent.services.validation.style_coverage import (
            extract_css_theme_color_values,
            parse_css_theme,
        )

        if not theme_css:
            return cls(raw_css="")

        parsed = parse_css_theme(theme_css)
        if not parsed:
            return cls(raw_css=theme_css)

        # parse_css_theme returns sets of names + a font_values dict.
        # ThemeView wants name→value maps for ALL three namespaces, so
        # we cross-reference with the color-values extractor for colors
        # and the existing font_values for fonts. Radii values aren't
        # extracted by the parser today — keep an empty value map but
        # populate the name set so has_radius() works.
        color_values = extract_css_theme_color_values(theme_css) or {}
        colors = {name: color_values.get(name, "") for name in parsed.get("colors", set())}
        fonts = dict(parsed.get("font_values", {}))
        radii = {name: "" for name in parsed.get("borderRadius", set())}

        return cls(raw_css=theme_css, colors=colors, fonts=fonts, radii=radii)

    # ── Queries ───────────────────────────────────────────────────────

    def has_color(self, name: str) -> bool:
        """True if ``--color-{name}`` is declared in @theme."""
        return name in self.colors

    def has_font(self, name: str) -> bool:
        """True if ``--font-{name}`` is declared OR resolvable via a
        canonical alias.

        Examples (alias pair: ``headline`` ↔ ``heading``):
            theme has --font-heading → has_font("headline") → True
            theme has --font-headline → has_font("heading") → True
        """
        if name in self.fonts:
            return True
        # Alias-aware lookup: cast our font-name dict to the
        # ``--font-{name}`` form expected by alias_aware_font_lookup.
        prefixed = {f"--font-{n}": v for n, v in self.fonts.items()}
        return alias_aware_font_lookup(prefixed, name) is not None

    def has_radius(self, name: str) -> bool:
        return name in self.radii

    def get_font(self, name: str) -> str | None:
        """Resolve a font name through the canonical alias graph."""
        prefixed = {f"--font-{n}": v for n, v in self.fonts.items()}
        return alias_aware_font_lookup(prefixed, name)

    def color_value(self, name: str) -> str | None:
        return self.colors.get(name)

    # ── Available-token sets (consumed by design_system_context) ─────

    def available_color_tokens(self) -> tuple[str, ...]:
        """Sorted tuple of all color token names declared in @theme.

        ComponentBuilder is told this is the complete set of valid
        ``bg-X`` / ``text-X`` / ``border-X`` token names. Anything else
        must go through ``add_theme_tokens`` first.
        """
        return tuple(sorted(self.colors))

    def available_font_tokens(self) -> tuple[str, ...]:
        """Sorted tuple of all font token names declared in @theme.

        Includes both members of each canonical alias pair when both
        are explicitly declared. Custom names (``--font-display``,
        ``--font-handwritten``, ``--font-mono``) flow through unchanged
        so domain-specific imports retain their vocabulary.
        """
        return tuple(sorted(self.fonts))

    def available_radius_tokens(self) -> tuple[str, ...]:
        return tuple(sorted(self.radii))
