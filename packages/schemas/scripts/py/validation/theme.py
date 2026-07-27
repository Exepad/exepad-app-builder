"""
Theme validation — colors, fonts, contrast.

Validates hex/HSL color formats, WCAG contrast ratios, Google Fonts
families/variants, chart color distinctiveness, and theme palette structure.
"""

import json
import os
import re


# Data paths
_current_dir = os.path.dirname(os.path.abspath(__file__))
_DATA_DIR = os.path.normpath(os.path.join(_current_dir, '..', '..', '..', 'data'))
GOOGLE_FONTS_PATH_ABS = os.path.join(_DATA_DIR, 'fonts', 'google_fonts.json')

# Lazy-loaded fonts data
_GOOGLE_FONTS_DATA = None


def _get_google_fonts_data():
    """Load Google fonts data with family names and their valid variants."""
    global _GOOGLE_FONTS_DATA
    if _GOOGLE_FONTS_DATA is None:
        try:
            with open(GOOGLE_FONTS_PATH_ABS, 'r') as f:
                fonts_data = json.load(f)
                _GOOGLE_FONTS_DATA = {
                    item['family']: item.get('variants', [])
                    for item in fonts_data.get('items', [])
                }
        except FileNotFoundError:
            print(f"Warning: Google fonts file not found at {GOOGLE_FONTS_PATH_ABS}")
            _GOOGLE_FONTS_DATA = {}
        except (json.JSONDecodeError, KeyError) as e:
            print(f"Warning: Error parsing Google fonts file: {e}")
            _GOOGLE_FONTS_DATA = {}
    return _GOOGLE_FONTS_DATA


# =============================================================================
# FONT VALIDATION
# =============================================================================

def validate_font_list(font_list: list[str]) -> list[str]:
    """Validate a list of font family names against the Google Fonts catalog."""
    google_fonts_data = _get_google_fonts_data()
    errors = []
    for font_name in font_list:
        if font_name not in google_fonts_data:
            errors.append(f"Invalid font family: {font_name}")
    return errors


def validate_single_font_family(font_family: str) -> str | None:
    """Validate a single font family name. Returns error message or None."""
    google_fonts_data = _get_google_fonts_data()
    if font_family not in google_fonts_data:
        return f"Invalid font family: '{font_family}'"
    return None


def validate_font_variant(font_family: str, variant: str) -> str | None:
    """Validate a font variant for a specific font family."""
    google_fonts_data = _get_google_fonts_data()
    if font_family not in google_fonts_data:
        return f"Invalid font family: '{font_family}'"

    variant_mapping = {
        'regular': '400',
        'italic': '400italic',
        'bold': '700',
        'bolditalic': '700italic',
    }
    normalized_variant = variant_mapping.get(variant.lower(), variant)
    variants = google_fonts_data[font_family]

    if normalized_variant not in variants:
        if variant not in variants:
            return f"Invalid variant '{variant}' for font family '{font_family}'. Valid variants: {', '.join(variants)}"
    return None


def validate_google_fonts_url(url: str, font_family: str) -> str | None:
    """Validate a Google Fonts CSS URL contains the expected font family."""
    if not url.startswith('https://fonts.googleapis.com/css'):
        return "Invalid Google Fonts URL: must start with 'https://fonts.googleapis.com/css'"

    encoded_family = font_family.replace(' ', '+')
    if f"family={encoded_family}" not in url:
        return f"Font family '{font_family}' not found in URL: {url}"
    return None


# =============================================================================
# COLOR VALIDATION
# =============================================================================

def validate_hex_color(hex_color: str) -> str | None:
    """Validate a hex color string (#RRGGBB or #RGB)."""
    hex_pattern = r'^#?[0-9A-Fa-f]{6}$|^#?[0-9A-Fa-f]{3}$'
    if not re.match(hex_pattern, hex_color):
        return f"Invalid hex color: '{hex_color}'. Must be in format #RRGGBB or #RGB"
    return None


def hex_to_rgb(hex_color: str) -> tuple[int, int, int] | None:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    if len(hex_color) == 3:
        hex_color = ''.join([c * 2 for c in hex_color])
    if len(hex_color) != 6:
        return None
    try:
        return (int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16))
    except ValueError:
        return None


def get_relative_luminance(rgb: tuple[int, int, int]) -> float:
    """Calculate relative luminance based on WCAG 2.1."""
    def adjust(c: int) -> float:
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = rgb
    return 0.2126 * adjust(r) + 0.7152 * adjust(g) + 0.0722 * adjust(b)


def get_contrast_ratio(color1: str, color2: str) -> float | None:
    """Calculate contrast ratio between two hex colors (1-21 scale)."""
    rgb1 = hex_to_rgb(color1)
    rgb2 = hex_to_rgb(color2)
    if not rgb1 or not rgb2:
        return None
    lum1 = get_relative_luminance(rgb1)
    lum2 = get_relative_luminance(rgb2)
    lighter = max(lum1, lum2)
    darker = min(lum1, lum2)
    return (lighter + 0.05) / (darker + 0.05)


def validate_color_contrast(foreground: str, background: str, min_ratio: float = 4.5) -> str | None:
    """Validate color contrast meets WCAG AA standard."""
    ratio = get_contrast_ratio(foreground, background)
    if ratio is None:
        return "Could not calculate contrast ratio - invalid colors"
    if ratio < min_ratio:
        return f"Low contrast ratio {ratio:.2f}:1 (recommended minimum: {min_ratio}:1 for readability)"
    return None


def validate_chart_colors(charts: dict) -> list[str]:
    """Validate chart color palette for distinctiveness."""
    warnings = []
    chart_colors = [v for k, v in charts.items() if k.startswith('chart-') and v]

    for i, color in enumerate(chart_colors, 1):
        err = validate_hex_color(color)
        if err:
            warnings.append(f"Chart color {i}: {err}")

    if len(chart_colors) >= 2:
        unique_hues = set()
        for color in chart_colors:
            rgb = hex_to_rgb(color)
            if rgb:
                unique_hues.add((rgb[0] // 50, rgb[1] // 50, rgb[2] // 50))
        if len(unique_hues) < len(chart_colors) * 0.6:
            warnings.append("Chart colors may be too similar - consider more distinct hues for better differentiation")

    return warnings


def validate_hsl_lightness_contrast(color1_hsl: str, color2_hsl: str, min_diff: float = 40) -> str | None:
    """Validate lightness difference between two HSL colors."""
    try:
        if not (' ' in color1_hsl and '%' in color1_hsl):
            return None
        if not (' ' in color2_hsl and '%' in color2_hsl):
            return None

        parts1 = color1_hsl.strip().split()
        parts2 = color2_hsl.strip().split()
        if len(parts1) < 3 or len(parts2) < 3:
            return None

        lightness1 = float(parts1[2].rstrip('%'))
        lightness2 = float(parts2[2].rstrip('%'))
        lightness_diff = abs(lightness1 - lightness2)

        if lightness_diff < min_diff:
            return (
                f"CRITICAL: Insufficient lightness contrast. "
                f"Color1 L={lightness1}%, Color2 L={lightness2}%. "
                f"Difference={lightness_diff:.1f}% (minimum required: {min_diff}%). "
                f"This will cause visibility issues!"
            )
        return None
    except (ValueError, IndexError):
        return None


# =============================================================================
# THEME ORCHESTRATORS (called by core.py during WebApp validation)
# =============================================================================

def validate_webapp_fonts(webapp_config: dict, loc: str, errors: list[str]) -> None:
    """Validate fonts in a WebApp configuration. Mutates the errors list."""
    frontend = webapp_config.get("frontend", {})
    theme = frontend.get("theme", {})
    if "fonts" not in theme or not isinstance(theme["fonts"], dict):
        return

    fonts_obj = theme["fonts"]
    for font_key, font_config in fonts_obj.items():
        if not isinstance(font_config, dict):
            continue
        font_loc = f"{loc}.frontend.theme.fonts.{font_key}"

        font_family = font_config.get("family")
        if font_family and isinstance(font_family, str):
            cleaned_family = font_family.strip().strip("'\"")
            font_error = validate_single_font_family(cleaned_family)
            if font_error:
                errors.append(f"[{font_loc}] {font_error}")

            if not font_error:
                variant = font_config.get("variant")
                if variant and isinstance(variant, str):
                    variant_error = validate_font_variant(cleaned_family, variant)
                    if variant_error:
                        errors.append(f"[{font_loc}] {variant_error}")

                url = font_config.get("url")
                if url and isinstance(url, str):
                    url_error = validate_google_fonts_url(url, cleaned_family)
                    if url_error:
                        errors.append(f"[{font_loc}] {url_error}")

        if not font_config.get("family"):
            errors.append(f"[{font_loc}] Missing required 'family' field")
        if not font_config.get("variant"):
            errors.append(f"[{font_loc}] Missing required 'variant' field")
        if not font_config.get("url"):
            errors.append(f"[{font_loc}] Missing required 'url' field")


def validate_webapp_theme(webapp_config: dict, loc: str, errors: list[str]) -> None:
    """Validate theme in a WebApp configuration. Mutates the errors list."""
    frontend = webapp_config.get("frontend", {})
    if "theme" not in frontend:
        return

    theme = frontend["theme"]
    if not isinstance(theme, dict):
        return

    theme_loc = f"{loc}.frontend.theme"

    # Validate light palette
    if "light" in theme and isinstance(theme["light"], dict):
        _validate_palette(theme["light"], f"{theme_loc}.light", errors)

    # Validate dark palette
    if "dark" in theme and isinstance(theme["dark"], dict):
        _validate_palette(theme["dark"], f"{theme_loc}.dark", errors)

    # Validate chart colors
    if "charts" in theme and isinstance(theme["charts"], dict):
        chart_warnings = validate_chart_colors(theme["charts"])
        for warning in chart_warnings:
            errors.append(f"[{theme_loc}.charts] {warning}")


def _validate_palette(palette: dict, palette_loc: str, errors: list[str]) -> None:
    """Validate a single color palette (light or dark)."""
    # Validate individual color formats
    for color_name, color_value in palette.items():
        if color_value and isinstance(color_value, str):
            if ' ' in color_value and '%' in color_value:
                pass  # HSL format — skip hex validation
            else:
                hex_error = validate_hex_color(color_value)
                if hex_error:
                    errors.append(f"[{palette_loc}.{color_name}] {hex_error}")

    # Background/Foreground contrast
    if "background" in palette and "foreground" in palette:
        bg, fg = palette["background"], palette["foreground"]
        is_hsl = ' ' in str(bg) and '%' in str(bg) and ' ' in str(fg) and '%' in str(fg)
        if is_hsl:
            hsl_error = validate_hsl_lightness_contrast(bg, fg, min_diff=50)
            if hsl_error:
                errors.append(f"[{palette_loc}] Background/Foreground: {hsl_error}")
        else:
            contrast_warn = validate_color_contrast(fg, bg)
            if contrast_warn:
                errors.append(f"[{palette_loc}] Background/Foreground: {contrast_warn}")

    # Background/Primary contrast
    if "background" in palette and "primary" in palette:
        hsl_error = validate_hsl_lightness_contrast(palette["background"], palette["primary"], min_diff=40)
        if hsl_error:
            errors.append(f"[{palette_loc}] Background/Primary: {hsl_error}")

    # Primary/Primary-foreground contrast
    if "primary" in palette and "primary-foreground" in palette:
        primary, primary_fg = palette["primary"], palette["primary-foreground"]
        is_hsl = ' ' in str(primary) and '%' in str(primary) and ' ' in str(primary_fg) and '%' in str(primary_fg)
        if is_hsl:
            hsl_error = validate_hsl_lightness_contrast(primary, primary_fg, min_diff=40)
            if hsl_error:
                errors.append(f"[{palette_loc}] Primary/Primary-foreground: {hsl_error}")
        else:
            contrast_warn = validate_color_contrast(primary_fg, primary)
            if contrast_warn:
                errors.append(f"[{palette_loc}] Primary/Primary-foreground: {contrast_warn}")

    # Background/Accent contrast
    if "background" in palette and "accent" in palette:
        hsl_error = validate_hsl_lightness_contrast(palette["background"], palette["accent"], min_diff=40)
        if hsl_error:
            errors.append(f"[{palette_loc}] Background/Accent: {hsl_error}")
