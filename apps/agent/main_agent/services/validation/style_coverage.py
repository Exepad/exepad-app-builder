"""
Stage 4: Style coverage — custom classes vs Tailwind config cross-reference.

Compiled CSS exists (Stage 3 passed). Now check that every custom class used in TSX
actually maps to a config key. Standard Tailwind utilities always compile — only custom
extended classes (colors, fonts) can silently fail.
"""

import math
import re
from colorsys import hls_to_rgb, rgb_to_hls

import structlog

from main_agent.services.validation.tsx_ast import collect_static_classnames

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Standard Tailwind values — always available, no config needed
# ---------------------------------------------------------------------------

STANDARD_COLORS = {
    "slate",
    "gray",
    "zinc",
    "neutral",
    "stone",
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
    "black",
    "white",
    "transparent",
    "current",
    "inherit",
}

# Non-color utility suffixes that regex would incorrectly match as colors.
NON_COLOR_SUFFIXES = {
    # bg-* non-color
    "clip",
    "gradient",
    "repeat",
    "origin",
    "no-repeat",
    "cover",
    "contain",
    "center",
    "bottom",
    "top",
    "left",
    "right",
    "fixed",
    "local",
    "scroll",
    "none",
    "auto",
    # text-* non-color
    "xs",
    "sm",
    "base",
    "lg",
    "xl",
    "2xl",
    "3xl",
    "4xl",
    "5xl",
    "6xl",
    "7xl",
    "8xl",
    "9xl",
    "left",
    "center",
    "right",
    "justify",
    "start",
    "end",
    "wrap",
    "nowrap",
    "balance",
    "pretty",
    "ellipsis",
    "clip",
    # border-* non-color
    "0",
    "2",
    "4",
    "8",
    "t",
    "r",
    "b",
    "l",
    "x",
    "y",
    "solid",
    "dashed",
    "dotted",
    "double",
    "hidden",
    "none",
    "collapse",
    "separate",
    "spacing",
    # ring-* non-color
    "1",
    "inset",
    # outline-* non-color
    "offset",
    # shadow-* non-color (standard sizes + common custom shadow names)
    "md",
    "inner",
    "ambient",
    "spread",
    "soft",
    "hard",
    "glow",
    "elevation",
    # divide-* non-color
}

# Prefixes that reference color config
COLOR_PREFIXES = [
    "bg",
    "text",
    "border",
    "ring",
    "outline",
    "shadow",
    "fill",
    "stroke",
    "decoration",
    "divide",
    "placeholder",
    "accent",
]


# ---------------------------------------------------------------------------
# Config parsing
# ---------------------------------------------------------------------------


def parse_css_theme(css_source: str) -> dict:
    """
    Extract design tokens from a Tailwind v4 ``@theme { }`` block in CSS.

    Parses ``--color-*``, ``--font-*``, ``--radius-*`` custom properties
    and returns them as sets keyed the same way as ``parse_tailwind_config``.

    Example::

        @theme {
          --color-primary: #0F766E;
          --font-heading: "Outfit", sans-serif;
          --radius-lg: 0.75rem;
        }

    Returns: ``{"colors": {"primary", ...}, "color_values": {"primary": "#...", ...}, ...}``
    """
    theme_match = re.search(r"@theme\s*\{(.*?)\}", css_source, re.DOTALL)
    if not theme_match:
        return {}

    body = theme_match.group(1)
    colors: set[str] = set()
    fonts: set[str] = set()
    font_values: dict[str, str] = {}
    radii: set[str] = set()

    for m in re.finditer(r"--color-([a-z0-9][a-z0-9-]*)\s*:", body):
        colors.add(m.group(1))
    # Match `--font-<name>: <value>;` and capture the value (everything up to
    # the next `;` or close brace). Mirrors `extract_css_theme_color_values`.
    for m in re.finditer(
        r"--font-([a-z0-9][a-z0-9-]*)\s*:\s*([^;\n}]+?)\s*(?:;|$)", body, re.MULTILINE
    ):
        name = m.group(1)
        fonts.add(name)
        font_values[name] = m.group(2).strip()
    for m in re.finditer(r"--radius-([a-z0-9][a-z0-9-]*)\s*:", body):
        radii.add(m.group(1))

    return {
        "colors": colors,
        "color_values": extract_css_theme_color_values(css_source),
        "fontFamily": fonts,
        "font_values": font_values,
        "borderRadius": radii,
        "boxShadow": set(),
    }


def parse_tailwind_config(config_source: str) -> dict:
    """
    Extract design tokens from a v4 CSS ``@theme`` block.

    Returns dict with keys: colors (set), fontFamily (set), borderRadius (set), boxShadow (set).
    Returns empty sets when no ``@theme`` block is found or it contains no tokens.
    """
    result = parse_css_theme(config_source)
    if result:
        return result

    return {
        "colors": set(),
        "color_values": {},
        "fontFamily": set(),
        "font_values": {},
        "borderRadius": set(),
        "boxShadow": set(),
    }


# ---------------------------------------------------------------------------
# Custom class extractors
# ---------------------------------------------------------------------------


def extract_custom_color_refs(tsx: str) -> list[tuple[str, str]]:
    """Returns list of (full_class, color_name) for custom color references only.

    Scans only **static className text** extracted from JSX attributes —
    not raw TSX. SVG kebab attributes inside ``dangerouslySetInnerHTML``
    (``text-anchor``, ``stroke-width``, ``fill-opacity`` etc.), JSX
    comments, and string literals containing class-shaped words are NOT
    flagged. See `tsx_ast.collect_static_classnames` for the extraction
    contract.
    """
    refs = []
    classname_corpus = " ".join(collect_static_classnames(tsx))
    if not classname_corpus:
        return refs
    for prefix in COLOR_PREFIXES:
        for match in re.finditer(rf"\b{prefix}-([a-z][a-z0-9-]*)", classname_corpus):
            color = match.group(1)

            # Skip non-color utility suffixes
            first_part = color.split("-")[0]
            if first_part in NON_COLOR_SUFFIXES or color in NON_COLOR_SUFFIXES:
                continue

            # Skip standard Tailwind colors (slate-900, red-500, etc.)
            if first_part in STANDARD_COLORS:
                continue

            # Skip arbitrary values [#fff], [0.65rem]
            if color.startswith("["):
                continue

            # Skip opacity modifiers
            if color.startswith("opacity"):
                continue

            # Skip bg-gradient-to-* patterns
            if "gradient" in color:
                continue

            refs.append((match.group(0), color))
    return refs


# ---------------------------------------------------------------------------
# Cross-reference
# ---------------------------------------------------------------------------


def validate_style_coverage(
    tsx_sources: dict[str, str],
    config_source: str,
) -> list[str]:
    """
    Check that every custom color class used in TSX has a matching config entry.

    Color tokens are load-bearing: an undeclared ``bg-foo`` produces no
    CSS at all in Tailwind v4 (silent), so the build ships visually
    broken. Color warnings drive ``add_theme_tokens`` retries.

    Font coverage is intentionally NOT checked: Tailwind v4 fonts work
    via ``var(--font-X)`` even when the token isn't declared in
    ``@theme``, so missing-font warnings produced no signal anyone acted
    on. The font-warnings branch was removed; if it needs to come back,
    base it on ``collect_static_classnames`` like the color check does.

    Args:
        tsx_sources: {component_name: tsx_source}
        config_source: theme.css content (v4 CSS with @theme block)

    Returns:
        List of warning strings for unmatched custom classes
    """
    config = parse_tailwind_config(config_source)
    config_colors = config.get("colors", set())
    config_shadows = config.get("boxShadow", set())
    warnings = []

    for component, tsx in tsx_sources.items():
        # Check custom color references
        for full_class, color_name in extract_custom_color_refs(tsx):
            # Skip shadow-* classes that match boxShadow config keys
            if full_class.startswith("shadow-") and color_name in config_shadows:
                continue
            # Skip when the full class (e.g. "outline-variant") is itself a
            # config color — the prefix just happens to collide with a
            # Tailwind utility name.
            if full_class in config_colors:
                continue
            if color_name not in config_colors:
                warnings.append(
                    f'[{component}] Class "{full_class}" — color "{color_name}" '
                    f"not in tailwind.config extend.colors"
                )

    return warnings


# ---------------------------------------------------------------------------
# Deterministic M3 color auto-fix
# ---------------------------------------------------------------------------

# Maps missing M3 color → (source_color, lightness_blend_factor).
# Factor > 1 lightens toward white; factor < 1 darkens toward black.
# Values chosen to match typical Material Design 3 token relationships.
M3_DERIVABLE_COLORS: dict[str, tuple[str, float]] = {
    "outline-variant": ("outline", 1.30),
    "surface-variant": ("surface", 0.96),
    "surface-dim": ("surface", 0.90),
    "surface-bright": ("surface", 1.02),
    "surface-container-lowest": ("surface", 1.03),
    "surface-container-low": ("surface", 0.98),
    "surface-container": ("surface", 0.96),
    "surface-container-high": ("surface", 0.94),
    "surface-container-highest": ("surface", 0.92),
    "on-surface-variant": ("on-surface", 1.15),
}


def _hex_to_rgb(hex_color: str) -> tuple[float, float, float]:
    """Convert '#rrggbb' to (r, g, b) floats in [0, 1]."""
    h = hex_color.lstrip("#")
    if len(h) == 3:
        h = h[0] * 2 + h[1] * 2 + h[2] * 2
    return int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255


def _rgb_to_hex(r: float, g: float, b: float) -> str:
    """Convert (r, g, b) floats in [0, 1] to '#rrggbb'."""
    return "#{:02x}{:02x}{:02x}".format(
        int(round(max(0, min(1, r)) * 255)),
        int(round(max(0, min(1, g)) * 255)),
        int(round(max(0, min(1, b)) * 255)),
    )


def _hex_to_hsl_string(hex_color: str) -> str:
    """Convert '#rrggbb' to Tailwind/shadcn space-separated HSL."""
    r, g, b = _hex_to_rgb(hex_color)
    h, l, s = rgb_to_hls(r, g, b)
    hue = round(h * 360)
    sat = round(s * 100)
    light = round(l * 100)
    return f"{hue} {sat}% {light}%"


def _hsl_string_to_hex(hsl_value: str) -> str | None:
    """Convert space-separated HSL custom property value to hex."""
    match = re.match(
        r"^\s*(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%\s*$",
        hsl_value,
    )
    if not match:
        return None
    h = (float(match.group(1)) % 360) / 360
    s = max(0.0, min(1.0, float(match.group(2)) / 100))
    l = max(0.0, min(1.0, float(match.group(3)) / 100))
    r, g, b = hls_to_rgb(h, l, s)
    return _rgb_to_hex(r, g, b)


def _oklch_string_to_hex(value: str) -> str | None:
    """Convert an ``oklch(L C H)`` value to hex, or None if it is not one.

    Tailwind v4 ships its own palette in oklch, so it is the notation a model
    reaches for by default even when told to write hex. Refusing it meant a
    perfectly good theme.css resolved to ZERO colors and killed the build (see
    resolve_theme_palette_snapshot), which is a bad trade for a colour space
    that is trivially convertible.

    Accepts the CSS forms ``oklch(0.7 0.15 250)``, percentage lightness, an
    optional ``/ alpha`` (dropped — the palette is opaque), and comma
    separators. Values outside the sRGB gamut are clamped, which is what a
    browser does with them anyway.
    """
    m = re.match(
        r"^\s*oklch\(\s*([\d.]+)(%?)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*(-?[\d.]+)"
        r"(?:\s*/\s*[\d.]+%?)?\s*\)\s*$",
        value,
        re.IGNORECASE,
    )
    if not m:
        return None
    try:
        lightness = float(m.group(1))
        if m.group(2) == "%":
            lightness /= 100.0
        chroma = float(m.group(3))
        hue_deg = float(m.group(4))
    except ValueError:
        return None

    # Oklch → Oklab → linear sRGB → sRGB. The matrices are Björn Ottosson's
    # published constants; this is the whole conversion, no dependency needed.
    hue_rad = math.radians(hue_deg)
    a = chroma * math.cos(hue_rad)
    b_ = chroma * math.sin(hue_rad)

    l_ = (lightness + 0.3963377774 * a + 0.2158037573 * b_) ** 3
    m_ = (lightness - 0.1055613458 * a - 0.0638541728 * b_) ** 3
    s_ = (lightness - 0.0894841775 * a - 1.2914855480 * b_) ** 3

    lin_r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
    lin_g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
    lin_b = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_

    def _to_srgb(c: float) -> float:
        c = max(0.0, min(1.0, c))
        return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055

    return _rgb_to_hex(_to_srgb(lin_r), _to_srgb(lin_g), _to_srgb(lin_b))


def _rgb_function_to_hex(value: str) -> str | None:
    """Convert ``rgb(r g b)`` / ``rgba(r, g, b, a)`` to hex, or None."""
    m = re.match(
        r"^\s*rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)"
        r"(?:\s*[,/]\s*[\d.]+%?)?\s*\)\s*$",
        value,
        re.IGNORECASE,
    )
    if not m:
        return None

    def _channel(raw: str) -> float:
        if raw.endswith("%"):
            return max(0.0, min(1.0, float(raw[:-1]) / 100.0))
        return max(0.0, min(1.0, float(raw) / 255.0))

    try:
        return _rgb_to_hex(_channel(m.group(1)), _channel(m.group(2)), _channel(m.group(3)))
    except ValueError:
        return None


def _hsl_function_to_hex(value: str) -> str | None:
    """Convert ``hsl(H S% L%)`` / ``hsla(...)`` to hex, or None.

    The bare space-separated form (``210 40% 50%``) is handled by
    ``_hsl_string_to_hex``; this is the wrapped function notation.
    """
    m = re.match(
        r"^\s*hsla?\(\s*(-?[\d.]+)(?:deg)?\s*[,\s]\s*([\d.]+)%\s*[,\s]\s*([\d.]+)%"
        r"(?:\s*[,/]\s*[\d.]+%?)?\s*\)\s*$",
        value,
        re.IGNORECASE,
    )
    if not m:
        return None
    return _hsl_string_to_hex(f"{m.group(1)} {m.group(2)}% {m.group(3)}%")


def parse_css_color_to_hex(value: str) -> str | None:
    """Normalise any CSS colour notation we accept in ``@theme`` to hex.

    Hex first (the documented and overwhelmingly common form), then the
    function notations a model reaches for when it drifts from the prompt.
    Returns None for anything unresolvable — notably ``var(...)`` references,
    which cannot be resolved without the whole cascade and would give a
    palette entry that is not actually a colour.
    """
    raw = value.strip().rstrip(";").strip()
    if re.match(r"^#[0-9a-fA-F]{3,8}$", raw):
        return raw
    return _oklch_string_to_hex(raw) or _rgb_function_to_hex(raw) or _hsl_function_to_hex(raw)


def _derive_color(source_hex: str, factor: float) -> str:
    """
    Derive a color by adjusting its lightness.

    factor > 1 → lighter, factor < 1 → darker.
    """
    r, g, b = _hex_to_rgb(source_hex)
    h, l, s = rgb_to_hls(r, g, b)
    new_l = max(0.0, min(1.0, l * factor))
    nr, ng, nb = hls_to_rgb(h, new_l, s)
    return _rgb_to_hex(nr, ng, nb)


# ---------------------------------------------------------------------------
# WCAG contrast helpers + deterministic M3 palette computation
# ---------------------------------------------------------------------------

_DARK_TEXT = "#1C1B1F"
_LIGHT_TEXT = "#FFFFFF"


def _linearize(c: float) -> float:
    """sRGB gamma linearization for a single channel in [0, 1]."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _relative_luminance(hex_color: str) -> float:
    """WCAG 2.1 relative luminance from a hex color."""
    r, g, b = _hex_to_rgb(hex_color)
    return 0.2126 * _linearize(r) + 0.7152 * _linearize(g) + 0.0722 * _linearize(b)


def _contrast_ratio(fg_hex: str, bg_hex: str) -> float:
    """WCAG contrast ratio between two colors (always >= 1.0)."""
    l1 = _relative_luminance(fg_hex)
    l2 = _relative_luminance(bg_hex)
    lighter = max(l1, l2)
    darker = min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def _pick_on_color(bg_hex: str, min_ratio: float = 4.5) -> str:
    """Return white or dark text, whichever achieves at least min_ratio on bg_hex."""
    if _contrast_ratio(_LIGHT_TEXT, bg_hex) >= min_ratio:
        return _LIGHT_TEXT
    if _contrast_ratio(_DARK_TEXT, bg_hex) >= min_ratio:
        return _DARK_TEXT
    white_ratio = _contrast_ratio(_LIGHT_TEXT, bg_hex)
    dark_ratio = _contrast_ratio(_DARK_TEXT, bg_hex)
    return _LIGHT_TEXT if white_ratio >= dark_ratio else _DARK_TEXT


def _blend_toward(base_hex: str, target_hex: str, factor: float) -> str:
    """Blend base toward target by factor (0 = base, 1 = target)."""
    r1, g1, b1 = _hex_to_rgb(base_hex)
    r2, g2, b2 = _hex_to_rgb(target_hex)
    return _rgb_to_hex(
        r1 + (r2 - r1) * factor,
        g1 + (g2 - g1) * factor,
        b1 + (b2 - b1) * factor,
    )


def _derive_container(base_hex: str) -> str:
    """Lighten a seed color by blending toward white to produce a soft container tone."""
    return _blend_toward(base_hex, "#FFFFFF", 0.65)


def _invert_lightness(hex_color: str) -> str:
    """Invert the lightness of a color in HLS space."""
    r, g, b = _hex_to_rgb(hex_color)
    h, l, s = rgb_to_hls(r, g, b)
    nr, ng, nb = hls_to_rgb(h, 1.0 - l, s)
    return _rgb_to_hex(nr, ng, nb)


def _ensure_pair_contrast(
    bg_hex: str,
    fg_hex: str,
    min_ratio: float = 4.5,
    max_nudges: int = 12,
) -> tuple[str, str]:
    """
    Return a (bg, fg) pair guaranteed to meet `min_ratio` WCAG contrast.

    Strategy:
      1. Pick the best fg (white or dark) for the given bg.
      2. If it still fails (mid-tone bg where neither extreme hits 4.5:1),
         nudge the bg away from mid — darker if it's already dark-ish,
         lighter if light-ish — in 15% steps until a passing pair exists.

    This is used as a last-line safety net on top of ``compute_m3_palette``
    and the auto-fixer: palettes derived from awkward seed combinations
    (e.g. an orange primary on a slate surface) can produce on-* tokens
    where neither white nor dark text reaches 4.5:1 against the derived
    container tone. Nudging the bg is preferable to accepting 1.00:1 text.
    """
    if _contrast_ratio(fg_hex, bg_hex) >= min_ratio:
        return bg_hex, fg_hex

    # First attempt: let _pick_on_color choose the best text color.
    candidate_fg = _pick_on_color(bg_hex, min_ratio)
    if _contrast_ratio(candidate_fg, bg_hex) >= min_ratio:
        return bg_hex, candidate_fg

    # Mid-tone bg: nudge the bg itself toward the nearer extreme.
    is_dark = _relative_luminance(bg_hex) < 0.5
    factor = 0.85 if is_dark else 1.15
    adjusted_bg = bg_hex
    for _ in range(max_nudges):
        adjusted_bg = _derive_color(adjusted_bg, factor)
        candidate_fg = _pick_on_color(adjusted_bg, min_ratio)
        if _contrast_ratio(candidate_fg, adjusted_bg) >= min_ratio:
            return adjusted_bg, candidate_fg

    # Exhausted nudges — return best-effort extremal pair.
    final_bg = "#0A0A0A" if is_dark else "#FAFAFA"
    return final_bg, _pick_on_color(final_bg, min_ratio)


def _harmonize_palette_contrast(palette: dict[str, str]) -> dict[str, str]:
    """
    Guarantee every M3 on-*/background pair in ``palette`` meets WCAG AA.

    Walks ``M3_CONTRAST_PAIRS`` and, for each pair that fails 4.5:1,
    replaces BOTH the bg token and the on-* token with values returned by
    ``_ensure_pair_contrast``. Runs after ``compute_m3_palette`` so that
    components generated from this palette never inherit a sub-4.5 pair —
    eliminating the root cause behind the post-hoc ``auto_fix_contrast_pairs``
    safety net (which still runs as a final patch for CSS emitted by the
    LLM that bypasses the computed palette).
    """
    out = dict(palette)
    for fg_name, bg_name in M3_CONTRAST_PAIRS.items():
        bg_hex = out.get(bg_name)
        fg_hex = out.get(fg_name)
        if not bg_hex or not fg_hex:
            continue
        if _contrast_ratio(fg_hex, bg_hex) >= 4.5:
            continue
        new_bg, new_fg = _ensure_pair_contrast(bg_hex, fg_hex)
        out[bg_name] = new_bg
        out[fg_name] = new_fg
    return out


def compute_m3_palette(
    primary: str,
    secondary: str,
    surface: str,
    error: str,
) -> dict[str, str]:
    """
    Deterministically compute a full Material Design 3 color palette from 4 seed hex
    colors, with guaranteed WCAG AA contrast for all on-*/background pairs.

    Tertiary is derived as a 50/50 blend of primary and secondary so it sits
    between them in hue. M3's "fixed" tones pin to the role's container
    shade and don't change between light/dark mode — modeled here as
    aliases of the corresponding -container tokens, with -dim and
    -on-*-variant shades derived deterministically.
    """
    primary_container = _derive_container(primary)
    secondary_container = _derive_container(secondary)
    error_container = _derive_container(error)

    # Tertiary: contrasting hue derived from a 50/50 blend of primary + secondary
    tertiary = _blend_toward(primary, secondary, 0.5)
    tertiary_container = _derive_container(tertiary)

    on_primary_container = _pick_on_color(primary_container)
    on_secondary_container = _pick_on_color(secondary_container)
    on_tertiary_container = _pick_on_color(tertiary_container)

    background = surface
    surface_variant = _derive_color(surface, 0.96)
    surface_dim = _derive_color(surface, 0.90)
    surface_bright = _derive_color(surface, 1.02)

    on_surface = _pick_on_color(surface)
    outline = (
        _derive_color(surface, 0.60)
        if _relative_luminance(surface) > 0.5
        else _derive_color(surface, 1.8)
    )
    outline_variant = _derive_color(outline, 1.30)

    inverse_surface = _invert_lightness(surface)
    inverse_primary = _blend_toward(primary, "#FFFFFF", 0.40)

    raw_palette = {
        "primary": primary,
        "on-primary": _pick_on_color(primary),
        "primary-container": primary_container,
        "on-primary-container": on_primary_container,
        "secondary": secondary,
        "on-secondary": _pick_on_color(secondary),
        "secondary-container": secondary_container,
        "on-secondary-container": on_secondary_container,
        "tertiary": tertiary,
        "on-tertiary": _pick_on_color(tertiary),
        "tertiary-container": tertiary_container,
        "on-tertiary-container": on_tertiary_container,
        # Fixed tones — pin to container shade (M3: don't shift in dark mode)
        "primary-fixed": primary_container,
        "primary-fixed-dim": _derive_color(primary_container, 0.92),
        "on-primary-fixed": on_primary_container,
        "on-primary-fixed-variant": _derive_color(on_primary_container, 0.85),
        "secondary-fixed": secondary_container,
        "secondary-fixed-dim": _derive_color(secondary_container, 0.92),
        "on-secondary-fixed": on_secondary_container,
        "on-secondary-fixed-variant": _derive_color(on_secondary_container, 0.85),
        "tertiary-fixed": tertiary_container,
        "tertiary-fixed-dim": _derive_color(tertiary_container, 0.92),
        "on-tertiary-fixed": on_tertiary_container,
        "on-tertiary-fixed-variant": _derive_color(on_tertiary_container, 0.85),
        "surface": surface,
        "on-surface": on_surface,
        "surface-variant": surface_variant,
        "on-surface-variant": _pick_on_color(surface_variant),
        "surface-dim": surface_dim,
        "surface-bright": surface_bright,
        "surface-container-lowest": _derive_color(surface, 1.03),
        "surface-container-low": _derive_color(surface, 0.98),
        "surface-container": _derive_color(surface, 0.96),
        "surface-container-high": _derive_color(surface, 0.94),
        "surface-container-highest": _derive_color(surface, 0.92),
        "error": error,
        "on-error": _pick_on_color(error),
        "error-container": error_container,
        "on-error-container": _pick_on_color(error_container),
        "outline": outline,
        "outline-variant": outline_variant,
        "background": background,
        "on-background": _pick_on_color(background),
        "inverse-surface": inverse_surface,
        "inverse-on-surface": _pick_on_color(inverse_surface),
        "inverse-primary": inverse_primary,
    }
    return _harmonize_palette_contrast(raw_palette)


# ---------------------------------------------------------------------------
# M3 contrast pair validation + auto-fix
# ---------------------------------------------------------------------------

M3_CONTRAST_PAIRS: dict[str, str] = {
    "on-primary": "primary",
    "on-secondary": "secondary",
    "on-tertiary": "tertiary",
    "on-error": "error",
    "on-surface": "surface",
    "on-primary-container": "primary-container",
    "on-secondary-container": "secondary-container",
    "on-tertiary-container": "tertiary-container",
    "on-error-container": "error-container",
    "on-surface-variant": "surface-variant",
    "on-background": "background",
    "inverse-on-surface": "inverse-surface",
    # Fixed-tone pairs — pin to container shade
    "on-primary-fixed": "primary-fixed",
    "on-secondary-fixed": "secondary-fixed",
    "on-tertiary-fixed": "tertiary-fixed",
}

SDK_ROOT_CONTRAST_PAIRS: dict[str, str] = {
    "foreground": "background",
    "primary-foreground": "primary",
    "secondary-foreground": "secondary",
    "destructive-foreground": "destructive",
    "muted-foreground": "muted",
    "accent-foreground": "accent",
    "card-foreground": "card",
    "popover-foreground": "popover",
    "sidebar-foreground": "sidebar-background",
    "sidebar-primary-foreground": "sidebar-primary",
    "sidebar-accent-foreground": "sidebar-accent",
}


def _mask_comments_and_strings(css: str) -> str:
    """Blank out comment and string CONTENT, preserving length.

    Every masked character becomes a space, so offsets found in the mask index
    straight into the original. Doing this first means neither the search for
    the at-rule nor the brace counting can be fooled by punctuation that is
    only text — and a file's own header comment mentioning ``@theme`` (as the
    contrast fixture's does) cannot be mistaken for the block itself.
    """
    out = list(css)
    i = 0
    n = len(css)
    while i < n:
        if css[i] == "/" and i + 1 < n and css[i + 1] == "*":
            end = css.find("*/", i + 2)
            end = n if end == -1 else end + 2
            for j in range(i, end):
                if not css[j].isspace():
                    out[j] = " "
            i = end
            continue
        if css[i] in "\"'":
            quote = css[i]
            j = i + 1
            while j < n and css[j] != quote:
                j += 2 if css[j] == "\\" else 1
            end = min(j + 1, n)
            for k in range(i, end):
                if not css[k].isspace():
                    out[k] = " "
            i = end
            continue
        i += 1
    return "".join(out)


def _extract_theme_block(config_source: str) -> str | None:
    """Return the body of the ``@theme`` block, brace-matched.

    NOT ``@theme\\s*\\{(.*?)\\}``. That non-greedy form stopped at the FIRST
    closing brace, so a comment containing ``}`` or any nested block truncated
    the body and silently dropped every declaration after it — the palette then
    came back empty or partial from a stylesheet that looked perfectly fine.
    Mask comments/strings, then count braces.
    """
    mask = _mask_comments_and_strings(config_source)
    start = re.search(r"@theme\b[^{]*\{", mask)
    if not start:
        return None

    depth = 1
    for i in range(start.end(), len(mask)):
        if mask[i] == "{":
            depth += 1
        elif mask[i] == "}":
            depth -= 1
            if depth == 0:
                return config_source[start.end() : i]
    # Unbalanced (truncated file): treat the rest as the body rather than
    # discarding declarations that are plainly there.
    return config_source[start.end() :]


def extract_css_theme_color_values(config_source: str) -> dict[str, str]:
    """Extract flat color name -> hex value mapping from a v4 CSS ``@theme`` block.

    Values are normalised to hex from any notation we accept (hex, oklch, rgb,
    hsl) — see ``parse_css_color_to_hex``. Anything unresolvable (e.g. a
    ``var()`` reference) is omitted rather than guessed at.
    """
    body = _extract_theme_block(config_source)
    if body is None:
        return {}

    result: dict[str, str] = {}
    for m in re.finditer(r"--color-([a-z0-9][a-z0-9-]*)\s*:\s*([^;{}\n]+)", body):
        parsed = parse_css_color_to_hex(m.group(2))
        if parsed:
            result[m.group(1)] = parsed
    return result


def extract_root_hsl_values(config_source: str) -> dict[str, str]:
    """Extract :root shadcn/SDK CSS variable values as var name -> hex."""
    root_match = re.search(r":root\s*\{(.*?)\}", config_source, re.DOTALL)
    if not root_match:
        return {}

    result: dict[str, str] = {}
    for m in re.finditer(
        r"--([a-z0-9][a-z0-9-]*)\s*:\s*([^;{}\n]+)",
        root_match.group(1),
    ):
        name = m.group(1)
        raw = m.group(2).strip()
        if raw.startswith("#"):
            result[name] = raw
            continue
        hsl_hex = _hsl_string_to_hex(raw)
        if hsl_hex:
            result[name] = hsl_hex
    return result


# ---------------------------------------------------------------------------
# The M3 palette contract — ONE definition, shared by the writer and the reader
# ---------------------------------------------------------------------------
# These tokens are what the deploy step requires from theme.css. They live here,
# in the validation layer, rather than next to the reader: when the writer's
# rules and the reader's requirements were defined separately, the writer happily
# stamped a file "validated" that the reader then rejected — and the workflow
# died minutes later, after the LLM could no longer be asked to fix it.

M3_REQUIRED_PALETTE_TOKENS = frozenset(
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

# Material 3 treats "background"/"surface" as aliases for the page background in
# most real palettes, and likewise their on-* counterparts. Deriving one from the
# other beats failing a build over a cosmetic omission.
M3_TOKEN_ALIASES: dict[str, str] = {
    "background": "surface",
    "on-background": "on-surface",
}


def resolve_m3_palette(theme_css: str) -> tuple[dict[str, str], list[str]]:
    """Return ``(palette, missing)`` for a theme.css.

    The single definition of "does this theme.css carry a usable M3 palette".
    Both the write-time rule and the deploy-time reader call this, so they cannot
    disagree — which is exactly what let an unusable palette through before.

    ``palette`` has aliases already derived; ``missing`` is sorted and empty when
    the theme is complete.
    """
    palette = extract_css_theme_color_values(theme_css)
    for token, alias_source in M3_TOKEN_ALIASES.items():
        if token not in palette and alias_source in palette:
            palette[token] = palette[alias_source]
    return palette, sorted(M3_REQUIRED_PALETTE_TOKENS - set(palette))


def format_missing_palette_tokens(missing: list[str], *, preview: int = 6) -> str:
    """Human-readable summary of missing tokens, capped so it stays readable."""
    if not missing:
        return "none"
    head = ", ".join(missing[:preview])
    extra = len(missing) - preview
    return f"{head}, and {extra} more" if extra > 0 else head


def validate_contrast_pairs(config_source: str) -> list[str]:
    """Check WCAG AA contrast (>= 4.5:1) for M3 and SDK root text/background pairs."""
    color_values = extract_css_theme_color_values(config_source)
    warnings = []

    if color_values:
        for fg_name, bg_name in M3_CONTRAST_PAIRS.items():
            fg_hex = color_values.get(fg_name)
            bg_hex = color_values.get(bg_name)
            if not fg_hex or not bg_hex:
                continue
            ratio = _contrast_ratio(fg_hex, bg_hex)
            if ratio < 4.5:
                warnings.append(
                    f'Contrast fail: "{fg_name}" ({fg_hex}) on "{bg_name}" ({bg_hex}) '
                    f"= {ratio:.2f}:1 (need >= 4.5:1)"
                )

    root_values = extract_root_hsl_values(config_source)
    if root_values:
        for fg_name, bg_name in SDK_ROOT_CONTRAST_PAIRS.items():
            fg_hex = root_values.get(fg_name)
            bg_hex = root_values.get(bg_name)
            if not fg_hex or not bg_hex:
                continue
            ratio = _contrast_ratio(fg_hex, bg_hex)
            if ratio < 4.5:
                warnings.append(
                    f'Contrast fail: SDK "{fg_name}" ({fg_hex}) on "{bg_name}" ({bg_hex}) '
                    f"= {ratio:.2f}:1 (need >= 4.5:1)"
                )
    return warnings


def auto_fix_contrast_pairs(config_source: str) -> str | None:
    """
    Fix failing contrast pairs by replacing on-* colors with white or dark text.

    Returns the fixed config source, or None if no fixes were needed/possible.
    """
    color_values = extract_css_theme_color_values(config_source)
    root_values = extract_root_hsl_values(config_source)
    if not color_values and not root_values:
        return None

    # Two replacement maps: fg_name -> (old, new), and bg_name -> (old, new).
    # Using ``_ensure_pair_contrast`` lets us nudge the bg when neither white
    # nor dark text meets 4.5:1 on the given bg (the mid-tone teal/cyan case
    # that silently shipped a failing pair in OnboardFlow). The previous
    # implementation only swapped fg with ``_pick_on_color``, which is a
    # no-op when ``_pick_on_color`` returns the same fg it was already set
    # to — leaving the failing pair unfixed.
    replacements: dict[str, tuple[str, str]] = {}
    bg_replacements: dict[str, tuple[str, str]] = {}
    if color_values:
        for fg_name, bg_name in M3_CONTRAST_PAIRS.items():
            fg_hex = color_values.get(fg_name)
            bg_hex = color_values.get(bg_name)
            if not fg_hex or not bg_hex:
                continue
            if _contrast_ratio(fg_hex, bg_hex) >= 4.5:
                continue
            new_bg, new_fg = _ensure_pair_contrast(bg_hex, fg_hex)
            if new_fg != fg_hex:
                replacements[fg_name] = (fg_hex, new_fg)
            if new_bg != bg_hex:
                bg_replacements[bg_name] = (bg_hex, new_bg)

    root_replacements: dict[str, tuple[str, str]] = {}
    root_bg_replacements: dict[str, tuple[str, str]] = {}
    if root_values:
        for fg_name, bg_name in SDK_ROOT_CONTRAST_PAIRS.items():
            fg_hex = root_values.get(fg_name)
            bg_hex = root_values.get(bg_name)
            if not fg_hex or not bg_hex:
                continue
            if _contrast_ratio(fg_hex, bg_hex) >= 4.5:
                continue
            new_bg, new_fg = _ensure_pair_contrast(bg_hex, fg_hex)
            if new_fg != fg_hex:
                root_replacements[fg_name] = (fg_hex, new_fg)
            if new_bg != bg_hex:
                root_bg_replacements[bg_name] = (bg_hex, new_bg)

    if (
        not replacements
        and not bg_replacements
        and not root_replacements
        and not root_bg_replacements
    ):
        return None

    fixed = config_source
    # Apply @theme replacements — fg first, then bg (so nudged bg covers fg's bg).
    for color_name, (old_hex, new_hex) in {**replacements, **bg_replacements}.items():
        css_pat = f"--color-{color_name}:\\s*{re.escape(old_hex)}"
        if re.search(css_pat, fixed):
            fixed = re.sub(css_pat, f"--color-{color_name}: {new_hex}", fixed, count=1)

    for var_name, (_old_hex, new_hex) in root_replacements.items():
        hsl_value = _hex_to_hsl_string(new_hex)
        css_pat = rf"(--{re.escape(var_name)}\s*:\s*)([^;{{}}\n]+)"
        fixed = re.sub(css_pat, rf"\g<1>{hsl_value}", fixed, count=1)

    for var_name, (_old_hex, new_hex) in root_bg_replacements.items():
        hsl_value = _hex_to_hsl_string(new_hex)
        css_pat = rf"(--{re.escape(var_name)}\s*:\s*)([^;{{}}\n]+)"
        fixed = re.sub(css_pat, rf"\g<1>{hsl_value}", fixed, count=1)

    logger.info(
        "Auto-fixed contrast pairs",
        fg_fixed=list(replacements.keys()) + [f"SDK:{k}" for k in root_replacements.keys()],
        bg_nudged=list(bg_replacements.keys()) + [f"SDK:{k}" for k in root_bg_replacements.keys()],
    )
    return fixed


def splice_tokens_into_theme(
    css_source: str,
    additions: dict[str, str],
) -> tuple[str, list[str], list[str]]:
    """Insert each ``{full_token_name: value}`` into the @theme block.

    ``full_token_name`` carries its prefix (e.g. ``color-tertiary-fixed``,
    ``font-display``) — the splice prepends ``--`` and appends ``: value;``.

    Idempotent: names that already appear as ``--name:`` declarations are
    skipped (not overwritten). Safe to retry.

    Returns ``(new_css, names_added, names_skipped_as_duplicates)``.
    """
    if not additions:
        return css_source, [], []

    theme_match = re.search(r"@theme\s*\{", css_source)
    if not theme_match:
        return css_source, [], []

    start = theme_match.end()
    depth = 1
    pos = start
    while pos < len(css_source) and depth > 0:
        ch = css_source[pos]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
        pos += 1
    if depth != 0:
        return css_source, [], []
    closing_brace_pos = pos - 1

    theme_body = css_source[start:closing_brace_pos]

    fresh: dict[str, str] = {}
    skipped: list[str] = []
    for name, value in additions.items():
        if re.search(rf"--{re.escape(name)}\s*:", theme_body):
            skipped.append(name)
            continue
        fresh[name] = value
    if not fresh:
        return css_source, [], sorted(skipped)

    indent_match = re.search(r"\n([ \t]+)--[a-z]", theme_body)
    indent = indent_match.group(1) if indent_match else "  "

    lines = [f"{indent}--{name}: {value};" for name, value in sorted(fresh.items())]
    insertion = "\n".join(lines) + "\n"

    new_css = css_source[:closing_brace_pos] + insertion + css_source[closing_brace_pos:]
    return new_css, sorted(fresh.keys()), sorted(skipped)


def auto_fix_missing_m3_colors(
    config_source: str,
    missing_colors: set[str],
) -> str | None:
    """
    Deterministically add missing M3 colors to ``@theme``.

    Strategy:
      1. Read primary/secondary/surface/error from the current @theme.
      2. Call ``compute_m3_palette`` to derive the full 46-token canonical
         palette (tertiary + fixed family included).
      3. For each missing color: look it up in the computed palette →
         splice as ``--color-{name}``. Falls back to ``M3_DERIVABLE_COLORS``
         only for non-M3 names that the canonical palette doesn't cover.

    Returns the fixed config source, or None if no fixes could be applied.
    """
    config = parse_tailwind_config(config_source)
    config_colors = config.get("colors", set())
    color_values = extract_css_theme_color_values(config_source)

    # Build the canonical full palette from current seeds (when available).
    full_palette: dict[str, str] = {}
    seeds_present = all(
        c in color_values and re.match(r"^#[0-9a-fA-F]{3,6}$", color_values[c] or "")
        for c in ("primary", "secondary", "surface", "error")
    )
    if seeds_present:
        try:
            full_palette = compute_m3_palette(
                primary=color_values["primary"],
                secondary=color_values["secondary"],
                surface=color_values["surface"],
                error=color_values["error"],
            )
        except Exception as exc:
            logger.warning(
                "compute_m3_palette failed during auto-fix; falling back to M3_DERIVABLE_COLORS",
                error=str(exc),
            )

    additions: dict[str, str] = {}
    for color_name in missing_colors:
        if color_name in config_colors:
            continue  # already exists

        # Primary path: canonical computed palette
        canonical = full_palette.get(color_name)
        if canonical and re.match(r"^#[0-9a-fA-F]{3,6}$", canonical):
            additions[f"color-{color_name}"] = canonical
            continue

        # Fallback: heuristic derivation from M3_DERIVABLE_COLORS
        derivation = M3_DERIVABLE_COLORS.get(color_name)
        if not derivation:
            continue
        source_key, factor = derivation
        source_hex = color_values.get(source_key)
        if not source_hex or not isinstance(source_hex, str):
            continue
        if not re.match(r"^#[0-9a-fA-F]{3,6}$", source_hex):
            continue
        additions[f"color-{color_name}"] = _derive_color(source_hex, factor)

    if not additions:
        return None

    fixed, added, _skipped = splice_tokens_into_theme(config_source, additions)
    if not added:
        return None

    logger.info(
        "Auto-derived missing M3 colors",
        added=[name.removeprefix("color-") for name in added],
    )
    return fixed
