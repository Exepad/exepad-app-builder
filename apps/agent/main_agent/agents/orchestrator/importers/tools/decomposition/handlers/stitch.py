"""Stitch format handler.

Stitch ships per-page HTML in folders (``home_<brand>/code.html``,
``about_us_<brand>/code.html``, ...). Each page's ``<head>`` carries:

  * ``<script id="tailwind-config">`` with the design's color palette,
    fonts, and radii encoded as a JS object literal. We parse this via
    ``html_utils.parse_tailwind_config`` and surface it to the runner so
    the LLM's M3 mapping can pre-fill from real Stitch tokens.
  * ``<link rel="stylesheet" href="https://fonts.googleapis.com/...">``
    Google Fonts loaders, harvested into ``@import url(...)``.

Stitch has no shared external stylesheet; every rule is expressed as a
Tailwind utility class on the elements themselves. The lifter therefore
returns ``[]`` for the verbatim CSS layer — Tailwind's bootstrap covers
everything. ``.ph`` placeholders are not used; image references are
straight ``<img src="https://lh3.googleusercontent.com/aida-public/...">``
URLs handled by the existing image materializer.
"""

from __future__ import annotations

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
    ThemeSources,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.ph_transformer import (
    PhTransformResult,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    ChromeRegion,
    DecompositionPlan,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.style_lifter import (
    CssBlock,
)
from main_agent.agents.orchestrator.importers.tools.html_utils import (
    extract_google_fonts_links,
    parse_tailwind_config,
)
from main_agent.agents.utils.artifact_manager import ArtifactManager


class StitchHandler:
    """Stitch handler.

    Theme tokens come from ``<script id="tailwind-config">``. There is no
    shared stylesheet; the layer block stays empty. Placeholders are not
    used — ``transform_placeholders`` is identity.
    """

    format = "stitch"

    async def collect_theme_sources(self, ctx, plan: DecompositionPlan) -> ThemeSources:
        """Walk pages until a parseable ``<script id="tailwind-config">`` is
        found. Harvest fonts from every page's ``<head><link>`` in order.

        Stitch repeats the tailwind-config across every page; one parse is
        enough for the design tokens. We still walk every page for fonts
        so multi-family designs are not under-collected.
        """
        tailwind_config: dict | None = None
        fonts: list[str] = []
        seen: set[str] = set()

        for page in plan.pages:
            html = await ArtifactManager.load_artifact_as_string(ctx, page.bundle_artifact)
            if not html:
                continue
            if tailwind_config is None:
                parsed = parse_tailwind_config(html)
                if parsed:
                    tailwind_config = parsed
            for url in extract_google_fonts_links(html):
                if url in seen:
                    continue
                seen.add(url)
                fonts.append(url)

        # Stitch's tailwind-config carries design tokens flat under
        # `theme.extend.{colors,borderRadius,spacing,fontSize,fontFamily,
        # boxShadow}`. Surface them as `--<prefix>-<name>` entries so the
        # runner can mirror them into @theme alongside any LLM-derived M3
        # mappings. Tailwind v4 namespace conventions:
        #   colors       → --color-*    (e.g. bg-primary)
        #   borderRadius → --radius-*   (e.g. rounded-xl)
        #   spacing      → --spacing-*  (e.g. p-4, m-6)
        #   fontSize     → --text-*     (e.g. text-lg)
        #   fontFamily   → --font-*     (e.g. font-headline)
        #   boxShadow    → --shadow-*   (e.g. shadow-md)
        # Before this change, only `colors` were lifted; custom `borderRadius`
        # (e.g. Stitch's `xl: "1.25rem"`) silently fell back to Tailwind v4
        # defaults, breaking visual fidelity to the source design. See RC#11.
        root_vars: dict[str, str] = {}
        if tailwind_config:
            extend = (tailwind_config.get("theme") or {}).get("extend") or {}
            _lift_token_section(extend.get("colors"), "color", root_vars)
            _lift_token_section(extend.get("borderRadius"), "radius", root_vars)
            _lift_token_section(extend.get("spacing"), "spacing", root_vars)
            _lift_token_section(extend.get("fontSize"), "text", root_vars)
            _lift_token_section(extend.get("fontFamily"), "font", root_vars)
            _lift_token_section(extend.get("boxShadow"), "shadow", root_vars)

        return ThemeSources(
            root_vars=root_vars,
            google_font_imports=fonts,
            stitch_tailwind_config=tailwind_config,
        )

    async def collect_verbatim_css(self, ctx, plan: DecompositionPlan) -> list[CssBlock]:
        """Stitch is utility-only — no shared stylesheet, no per-page
        ``<style>`` blocks worth lifting. Tailwind v4's compile pass picks
        up every utility class from the cleaned page HTML."""
        return []

    def transform_placeholders(self, html: str) -> tuple[str, PhTransformResult]:
        """Stitch has no ``.ph`` placeholders; identity transform."""
        return html, PhTransformResult()

    async def extract_chrome_region(self, ctx, region: ChromeRegion) -> str:
        """Resolve the chrome subtree via the shared resilient helper.

        For Stitch this is typically a per-page
        ``bundle:html:home_*/code.html`` with a selector like
        ``header.fixed`` or ``footer``. The shared helper tries the LLM's
        declared choice first; only when it misses does it fan out across
        other page bundles and per-role fallback selectors.

        Same code path as Claude Design — both formats share the EXTRACT
        layer's resilience contract.
        """
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            extract_chrome_region_with_fallback,
        )

        return await extract_chrome_region_with_fallback(ctx, region)


def _flatten_colors(colors: dict, *, prefix: str = "") -> dict:
    """Tailwind nested color shorthand → flat name map.

    Handles both flat (``{"primary": "#7a5900"}``) and nested
    (``{"surface": {"container": {"low": "#f6f3ed"}}}``) shapes. Nested
    keys join with ``-``, mirroring Tailwind v4's M3 token convention.
    """
    out: dict[str, str] = {}
    for key, value in colors.items():
        full = f"{prefix}-{key}" if prefix else key
        if isinstance(value, dict):
            out.update(_flatten_colors(value, prefix=full))
        else:
            out[full] = value
    return out


def _stringify_token_value(value) -> str | None:
    """Coerce a tailwind-config theme token value to a CSS var string.

    Handles the common shapes:
      * ``"1.25rem"`` → ``"1.25rem"``
      * ``["Noto Serif"]`` → ``'"Noto Serif"'`` (Tailwind v4 expects quoted family names)
      * ``["1rem", {"lineHeight": "1.5"}]`` (fontSize tuple) → ``"1rem"`` (size only)
      * ``"0 1px 2px rgba(0,0,0,0.1)"`` (boxShadow) → unchanged
    Returns None when the value can't be represented as a simple CSS string.
    """
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list) and value:
        first = value[0]
        if isinstance(first, str):
            # fontFamily lists become quoted comma-joined CSS
            # (e.g. ["Noto Serif", "serif"] → '"Noto Serif", "serif"').
            quoted = [f'"{x}"' if isinstance(x, str) and " " in x else x for x in value if isinstance(x, str)]
            return ", ".join(quoted)
        if isinstance(first, (int, float)):
            return str(first)
    return None


def _lift_token_section(section, css_prefix: str, dest: dict[str, str]) -> None:
    """Flatten a `theme.extend.<section>` dict and write `--<prefix>-<name>`
    entries to `dest`. No-op when section is missing/empty/non-dict.

    Uses `_flatten_colors` for the nested → dash-joined name map (Tailwind's
    nested shorthand convention works the same way for all token sections,
    not just colors).
    """
    if not isinstance(section, dict) or not section:
        return
    for name, raw in _flatten_colors(section).items():
        # `_flatten_colors` returns the leaf value unchanged; it may not be a
        # string (e.g. fontFamily arrays). Coerce here.
        css_value = _stringify_token_value(raw)
        if css_value is None:
            continue
        # Tailwind v4 reserves a `DEFAULT` key for unprefixed utilities
        # (e.g. `rounded` → `borderRadius.DEFAULT`). Map it to `--<prefix>`.
        var_name = f"--{css_prefix}" if name == "DEFAULT" else f"--{css_prefix}-{name}"
        dest[var_name] = css_value
