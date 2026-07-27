"""Regression: theme.css is the sole source of truth for design tokens.

Verifies that:
- The assembly service does NOT write `frontend.designSystem` to app_config.
- `build_design_system_context` works from a parsed-from-theme.css palette
  alone (no `design_system` dict input).
- On edit, `design_style[]` is omitted from the LLM-facing context (existing
  TSX is the design memory; replaying creator-time bullets propagates stale
  token vocabulary — see project memory: tertiary_fixed bug).
"""

from __future__ import annotations

import json

import pytest

from main_agent.agents.orchestrator.app_types.webapp.services.codefocus_assembly_service import (
    AssemblyContext,
    AssemblyService,
)
from main_agent.agents.orchestrator.app_types.webapp.services.design_system_context import (
    build_design_system_context,
)

pytestmark = [pytest.mark.unit]


# A typical M3 palette parsed from theme.css.
_PALETTE = {
    "primary": "#1b4332",
    "on-primary": "#ffffff",
    "primary-container": "#b7e4c7",
    "on-primary-container": "#081c15",
    "secondary": "#47664b",
    "on-secondary": "#ffffff",
    "surface": "#fcf9f3",
    "on-surface": "#1c1c18",
    "tertiary-fixed": "#b7c4bc",
    "on-tertiary-fixed-variant": "#18171a",
}


_FONTS = {
    "heading": '"Noto Serif", serif',
    "body": '"Plus Jakarta Sans", sans-serif',
}


def test_assembly_service_does_not_write_designSystem_to_app_config():
    """The persistent app_config no longer carries `frontend.designSystem`.

    Theme tokens live in `codefocus_style:theme.css` (artifact) and the
    runtime renders from compiled CSS — there's no consumer of
    `app_config.frontend.designSystem` left.
    """
    service = AssemblyService()
    ctx = AssemblyContext(
        app_name="Test App",
        app_alias="test-app",
        app_secondary_type="website",
        navigation_type="HeaderMenuTop",
        font_urls=[],
        components=[],
        backend_config=None,
        logic_config=None,
        favicon_svg="",
    )
    config = service.assemble_app_config(ctx)
    assert "designSystem" not in config["frontend"]


def test_assembly_context_has_no_design_system_field():
    """The dataclass field was deleted as part of decoupling — passing
    `design_system=` should raise a constructor error."""
    with pytest.raises(TypeError):
        AssemblyContext(
            app_name="Test App",
            app_alias="test-app",
            app_secondary_type="website",
            navigation_type="HeaderMenuTop",
            font_urls=[],
            components=[],
            backend_config=None,
            logic_config=None,
            design_system={"primary_color": "#000000"},  # type: ignore[call-arg]
            favicon_svg="",
        )


def test_build_design_system_context_works_from_palette_alone():
    """The new signature accepts palette + fonts; no app_config.designSystem
    dict needed."""
    raw = build_design_system_context(_PALETTE, fonts=_FONTS)
    ctx = json.loads(raw)

    # Palette is authoritative, not a `colors` field aliased from app_config.
    assert ctx["palette"] == _PALETTE
    assert ctx["fonts"]["headline"] == '"Noto Serif", serif'
    assert ctx["fonts"]["body"] == '"Plus Jakarta Sans", sans-serif'
    # Pairing rules are still emitted — they're a property of M3, not of the
    # specific app's palette.
    assert "bg-primary" in ctx["pairing_rules"]


def test_build_design_system_context_omits_style_on_edit():
    """On edit (no `design_style[]` passed), the `style` key MUST be absent
    from the JSON. Re-feeding creator-time vocabulary into edit prompts is
    what created the tertiary_fixed propagation bug.
    """
    raw = build_design_system_context(_PALETTE, fonts=_FONTS, design_style=None)
    ctx = json.loads(raw)
    assert "style" not in ctx


def test_build_design_system_context_includes_style_on_create():
    """On create, the Creator's bullets ARE used (in-memory only — the
    assembly service no longer persists them to app_config).
    """
    bullets = [
        "Organic asymmetry with tonal layering",
        "Glassmorphism for floating navigation",
    ]
    raw = build_design_system_context(_PALETTE, fonts=_FONTS, design_style=bullets)
    ctx = json.loads(raw)
    assert ctx["style"] == bullets


def test_build_design_system_context_handles_missing_fonts_gracefully():
    """Old/edge-case theme.css without --font-* lines must not crash."""
    raw = build_design_system_context(_PALETTE, fonts={})
    ctx = json.loads(raw)
    # Both font slots resolve to None — ComponentBuilder treats them as
    # "use the runtime defaults".
    assert ctx["fonts"]["headline"] is None
    assert ctx["fonts"]["body"] is None
