"""Resolve and persist authoritative theme palettes from theme.css artifacts."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from google.adk.agents.invocation_context import InvocationContext

from main_agent.constants import StateKeys
from main_agent.agents.utils.helpers import push_session_state_update
from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.services.validation.style_coverage import (
    compute_m3_palette,
    extract_css_theme_color_values,
    parse_css_theme,
)

# Static fallback seed colors used when theme.css is missing (broken / partial-
# state flows). Not the source of truth — log a warning when used.
_FALLBACK_SEEDS = {
    "primary": "#0F766E",
    "secondary": "#D97706",
    "surface": "#FFFBEB",
    "error": "#DC2626",
}

REQUIRED_THEME_PALETTE_TOKENS = frozenset(
    {
        "primary",
        "on-primary",
        "primary-container",
        "on-primary-container",
        "secondary",
        "on-secondary",
        "secondary-container",
        "on-secondary-container",
        "surface",
        "on-surface",
        "surface-variant",
        "on-surface-variant",
        "surface-dim",
        "surface-bright",
        "surface-container-lowest",
        "surface-container-low",
        "surface-container",
        "surface-container-high",
        "surface-container-highest",
        "error",
        "on-error",
        "error-container",
        "on-error-container",
        "outline",
        "outline-variant",
        "background",
        "on-background",
        "inverse-surface",
        "inverse-on-surface",
        "inverse-primary",
    }
)


class ThemePaletteResolutionError(ValueError):
    """Raised when an authoritative theme palette cannot be resolved."""


@dataclass(frozen=True)
class ThemePaletteSnapshot:
    """Resolved theme palette metadata."""

    palette: dict[str, str]
    source_hash: str
    source: str
    theme_css: str | None = None
    fonts: dict[str, str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.fonts is None:
            object.__setattr__(self, "fonts", {})


def _compute_fallback_seed_palette() -> dict[str, str]:
    """Compute a default M3 palette when theme.css is missing.

    Returns the canonical M3 palette derived from static seed colors.
    Used only as a last-resort fallback for broken/partial flows; the
    workflow should normally read directly from theme.css.
    """
    return compute_m3_palette(
        primary=_FALLBACK_SEEDS["primary"],
        secondary=_FALLBACK_SEEDS["secondary"],
        surface=_FALLBACK_SEEDS["surface"],
        error=_FALLBACK_SEEDS["error"],
    )


def render_fallback_theme_css() -> str:
    """Render a complete Tailwind v4 ``theme.css`` from the static seed palette.

    Used when DesignSystemBuilder produced no ``codefocus_style:theme.css``
    artifact (an off-Gemini no-save). Without this, the compile gate falls
    back to the bare ``TAILWIND_BASE_CSS`` bootstrap, which has NO M3 tokens —
    so every ``bg-primary`` / ``text-on-surface`` class renders unstyled, and
    no theme.css is persisted (the runtime fetches ``/styles/theme.css`` → 404).
    Emitting a coherent seed palette ships a styled app instead of a broken one.

    Deterministic and dependency-light (reuses the design-import renderer); the
    palette keys are mapped to ``--color-*`` CSS variables that ``build_theme_css``
    writes verbatim into ``@theme``.
    """
    from main_agent.agents.orchestrator.importers.tools.decomposition.style_lifter import (
        build_theme_css,
    )

    palette = _compute_fallback_seed_palette()
    m3_tokens = {f"--color-{name}": value for name, value in palette.items()}
    return build_theme_css(google_font_imports=[], m3_tokens=m3_tokens, original_tokens={})


_M3_TOKEN_ALIASES: dict[str, str] = {
    # Material 3 treats "background" and "surface" as aliases for the default
    # page background in most real-world palettes; the same holds for their
    # on-* counterparts. The design-import LLM sometimes emits only one side
    # of each pair (e.g. ``--color-surface`` without ``--color-background``).
    # Fall back to the alias before failing — the alternative is aborting
    # the whole workflow for a cosmetic omission.
    "background": "surface",
    "on-background": "on-surface",
}


def resolve_theme_palette_snapshot(
    theme_css: str | None,
    *,
    fallback_to_seed: bool = True,
) -> ThemePaletteSnapshot:
    """Resolve the authoritative theme palette + fonts from theme.css.

    theme.css is the single source of truth — when present, the palette
    is parsed via ``extract_css_theme_color_values`` and fonts via
    ``parse_css_theme``. When absent and ``fallback_to_seed`` is True,
    a default M3 palette is computed from static seed colors.
    """
    if theme_css:
        palette = extract_css_theme_color_values(theme_css)

        # Derive MD3 aliases for tokens the LLM omitted (e.g. background →
        # surface). Mutates ``palette`` in place so the returned snapshot
        # carries the derived values.
        derived: list[str] = []
        for missing_token, alias_source in _M3_TOKEN_ALIASES.items():
            if missing_token not in palette and alias_source in palette:
                palette[missing_token] = palette[alias_source]
                derived.append(f"{missing_token}→{alias_source}")

        missing = sorted(REQUIRED_THEME_PALETTE_TOKENS - set(palette))
        if missing:
            preview = ", ".join(missing[:6])
            extra = len(missing) - 6
            if extra > 0:
                preview = f"{preview}, and {extra} more"
            raise ThemePaletteResolutionError(
                "theme.css is missing required resolved color tokens: " f"{preview or 'none found'}"
            )

        fonts = parse_css_theme(theme_css).get("font_values", {}) or {}
        return ThemePaletteSnapshot(
            palette=palette,
            source_hash=hashlib.sha256(theme_css.encode("utf-8")).hexdigest(),
            source="theme_css",
            theme_css=theme_css,
            fonts=fonts,
        )

    if not fallback_to_seed:
        raise ThemePaletteResolutionError(
            "theme.css artifact is missing, so the authoritative theme palette cannot be resolved"
        )

    return ThemePaletteSnapshot(
        palette=_compute_fallback_seed_palette(),
        source_hash="",
        source="seed_fallback",
        theme_css=None,
        fonts={},
    )


async def load_and_persist_theme_palette(
    ctx: InvocationContext,
    *,
    fallback_to_seed: bool = True,
) -> ThemePaletteSnapshot:
    """Load theme.css from artifacts, resolve the palette + fonts, and persist debug state."""
    theme_css = await ArtifactManager.load_artifact_as_string(ctx, "codefocus_style:theme.css")
    snapshot = resolve_theme_palette_snapshot(theme_css, fallback_to_seed=fallback_to_seed)
    await push_session_state_update(
        ctx,
        {
            StateKeys.RESOLVED_THEME_PALETTE: snapshot.palette,
            StateKeys.THEME_SOURCE_HASH: snapshot.source_hash,
            StateKeys.THEME_PALETTE_SOURCE: snapshot.source,
        },
    )
    return snapshot
