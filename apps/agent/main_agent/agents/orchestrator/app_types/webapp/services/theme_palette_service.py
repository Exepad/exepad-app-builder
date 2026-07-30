"""Resolve and persist authoritative theme palettes from theme.css artifacts."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from google.adk.agents.invocation_context import InvocationContext

from main_agent.constants import StateKeys
from main_agent.agents.utils.helpers import push_session_state_update
from main_agent.agents.utils.artifact_manager import ArtifactManager
import structlog

from main_agent.services.validation.style_coverage import (
    M3_REQUIRED_PALETTE_TOKENS,
    compute_m3_palette,
    format_missing_palette_tokens,
    parse_css_theme,
    resolve_m3_palette,
)

logger = structlog.get_logger(__name__)

# Static fallback seed colors used when theme.css is missing (broken / partial-
# state flows). Not the source of truth — log a warning when used.
_FALLBACK_SEEDS = {
    "primary": "#0F766E",
    "secondary": "#D97706",
    "surface": "#FFFBEB",
    "error": "#DC2626",
}

# Re-exported from the validation layer, which is where the write-time rule
# reads it too. Keeping a second copy here is exactly what let the writer and
# the reader disagree about what a valid palette is.
REQUIRED_THEME_PALETTE_TOKENS = M3_REQUIRED_PALETTE_TOKENS


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


# The background→surface / on-background→on-surface derivation now lives with
# the resolver in the validation layer (M3_TOKEN_ALIASES), so the write-time
# rule applies the same aliasing this reader does.


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
        # resolve_m3_palette is THE definition of a usable palette, shared with
        # the write-time rule (style.m3.palette_incomplete) so the two cannot
        # disagree. They used to, and a "validated" theme.css killed the deploy.
        palette, missing = resolve_m3_palette(theme_css)

        if missing:
            # Do NOT abort. A theme.css that is present but unreadable used to
            # raise here while a theme.css that was ABSENT fell back to a seed
            # palette one branch below — so a bad theme was punished harder than
            # no theme at all, and the user lost the whole build (minutes of
            # agent time) over colour tokens. Degrade the same way instead: keep
            # whatever DID parse, fill the rest from the seed palette, and ship
            # a styled app.
            #
            # The write-time rule is what stops us getting here in the first
            # place, and it can still ask the LLM to fix it. This is the net.
            if fallback_to_seed:
                logger.warning(
                    "theme_palette_incomplete_using_seed_fallback",
                    missing_count=len(missing),
                    missing=format_missing_palette_tokens(missing, preview=10),
                    parsed_count=len(palette),
                    total_required=len(M3_REQUIRED_PALETTE_TOKENS),
                )
                seed = _compute_fallback_seed_palette()
                # The LLM's own values win wherever they parsed; the seed only
                # fills gaps, so a partially-good theme keeps its identity.
                merged = {**seed, **palette}
                fonts = parse_css_theme(theme_css).get("font_values", {}) or {}
                return ThemePaletteSnapshot(
                    palette=merged,
                    source_hash=hashlib.sha256(theme_css.encode("utf-8")).hexdigest(),
                    source="theme_css_seed_filled",
                    theme_css=theme_css,
                    fonts=fonts,
                )
            raise ThemePaletteResolutionError(
                "theme.css is missing required resolved color tokens: "
                f"{format_missing_palette_tokens(missing) or 'none found'}"
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
