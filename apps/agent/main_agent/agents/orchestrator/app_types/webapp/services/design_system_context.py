"""
Shared utility for building a unified design-system context string.

theme.css is the sole source of truth for design tokens (colors + fonts).
Both the creation workflow and the editing workflow extract palette + fonts
from theme.css via ``ThemePaletteSnapshot`` and pass them here. The Creator's
``design_style[]`` flows in only on create — never on edit (where the
existing component TSX is the design memory).

The optional ``theme_view`` argument exposes the FULL set of token names
declared in ``@theme`` to the model — not just the curated 2-key fonts
dict. ComponentBuilder is instructed (in
``agent_docs/frontend/component_builder/docs/10_COLOR_AND_LAYOUT.md``) to use
ONLY those token names; anything else must go through ``add_theme_tokens``
first. This closes the validator/builder disagreement that caused the
Onix Studio HomeContent failure (the model was told ``font-headline``
existed via the curated dict, but the validator demanded the literal
``--font-headline`` token in theme.css).
"""

import json

from main_agent.services.theme.theme_view import ThemeView

# M3 background → foreground pairing rules for WCAG AA contrast.
# Components MUST use the on-* color for text on the corresponding background.
_M3_PAIRING_RULES: dict[str, str] = {
    "bg-primary": "text-on-primary",
    "bg-secondary": "text-on-secondary",
    "bg-tertiary": "text-on-tertiary",
    "bg-error": "text-on-error",
    "bg-surface": "text-on-surface",
    "bg-background": "text-on-background",
    "bg-primary-container": "text-on-primary-container",
    "bg-secondary-container": "text-on-secondary-container",
    "bg-tertiary-container": "text-on-tertiary-container",
    "bg-error-container": "text-on-error-container",
    "bg-surface-variant": "text-on-surface-variant",
    "bg-surface-container": "text-on-surface",
    "bg-surface-container-low": "text-on-surface",
    "bg-surface-container-high": "text-on-surface",
    "bg-surface-container-highest": "text-on-surface",
    "bg-surface-container-lowest": "text-on-surface",
    "bg-inverse-surface": "text-inverse-on-surface",
}


def build_design_system_context(
    palette: dict[str, str],
    fonts: dict[str, str] | None = None,
    design_style: list[str] | None = None,
    theme_view: ThemeView | None = None,
) -> str:
    """Serialize a design-system context for ComponentBuilder, with theme.css as truth.

    Args:
        palette: M3 color token map (name → hex) parsed from theme.css.
        fonts: Optional ``--font-*`` token name → value map (e.g.
            ``{"heading": "\\"Noto Serif\\", serif"}``).
        design_style: Optional natural-language design directives. Only
            passed by the create workflow (Creator plan in scope).
            Omitted on edit — existing component TSX is the design memory
            there.
        theme_view: Optional :class:`ThemeView` over the actual
            ``theme.css``. When supplied, the ``available_color_tokens``
            and ``available_font_tokens`` keys land in the output JSON
            so the model knows the full set of valid token names — not
            just the curated 2-key fonts dict. Without this, the
            model's class hallucinations slip past the curated view but
            fail the strict literal-match coverage validator.

    Returns:
        A compact JSON string suitable for ``ComponentBuilderInput.design_system_context``.
    """
    fonts = fonts or {}
    ctx: dict = {
        "palette": palette,
        "fonts": {
            "headline": fonts.get("heading") or fonts.get("headline"),
            "body": fonts.get("body") or fonts.get("sans"),
        },
        "pairing_rules": _M3_PAIRING_RULES,
        "palette_notes": [
            "The palette values are authoritative. Do not assume on-primary, on-secondary, on-error, or inverse-on-surface are always white.",
            "on-* tokens may be light or dark depending on the resolved palette. Always pair bg-X with text-on-X on the same element.",
        ],
        "resolved_pair_examples": [
            {
                "background": f"bg-primary ({palette.get('primary')})",
                "text": f"text-on-primary ({palette.get('on-primary')})",
            },
            {
                "background": f"bg-secondary ({palette.get('secondary')})",
                "text": f"text-on-secondary ({palette.get('on-secondary')})",
            },
            {
                "background": f"bg-inverse-surface ({palette.get('inverse-surface')})",
                "text": f"text-inverse-on-surface ({palette.get('inverse-on-surface')})",
            },
        ],
        "default_text_colors": {
            "body": "text-on-surface",
            "muted": "text-on-surface-variant",
            "heading": "text-on-surface or text-primary",
            "hint": (
                "Use these for ALL light backgrounds (bg-surface, bg-surface-container*, "
                "bg-white, or no explicit background). "
                "text-inverse-on-surface is palette-derived and reserved for bg-inverse-surface."
            ),
        },
        "forbidden_pairings": [
            {
                "combination": "text-inverse-on-surface on light backgrounds",
                "why": "text-inverse-on-surface is reserved for bg-inverse-surface only",
                "fix": "Use text-on-surface for body text, text-on-surface-variant for muted text",
            },
            {
                "combination": "text-on-surface or text-on-surface-variant on bg-inverse-surface",
                "why": "bg-inverse-surface has its own dedicated foreground token",
                "fix": "Use text-inverse-on-surface for body text, text-white for headings",
            },
        ],
        "opacity_rules": {
            "text_min_opacity": 80,
            "header_min_bg_opacity": 70,
            "hint": (
                "For muted text use text-on-surface-variant instead of opacity modifiers. "
                "NEVER use text-{color}/{opacity} where opacity < 80."
            ),
        },
    }

    # design_style[] only flows on create (Creator plan in scope). On edit,
    # the existing component TSX is the design memory — re-feeding the
    # planner's natural-language bullets bakes in stale token vocabulary
    # (see project memory: tertiary_fixed propagation bug).
    if design_style:
        ctx["style"] = design_style

    # Surface the FULL token list when a ThemeView is supplied. The
    # model sees both M3-canonical names and any custom or domain
    # tokens (e.g. --font-display, --color-coordinate-text). Anything
    # NOT in these lists must go through add_theme_tokens first —
    # documented in 10_COLOR_AND_LAYOUT.md so the model knows how to
    # respond to a missing-token need.
    if theme_view is not None:
        ctx["available_color_tokens"] = list(theme_view.available_color_tokens())
        ctx["available_font_tokens"] = list(theme_view.available_font_tokens())
        ctx["available_token_usage_rule"] = (
            "Use ONLY classes whose token name appears in "
            "available_color_tokens (for bg-/text-/border-) or "
            "available_font_tokens (for font-). To use any other "
            "token name, you MUST call add_theme_tokens BEFORE saving "
            "the component."
        )

    return json.dumps(ctx)
