"""M3 color-pairing rule — single walker pass, multiple finding categories.

Replaces the historical 5-rule split (``InverseSurfaceTextPairingRule``,
``LightSurfaceInverseTextRule``, ``DarkSurfaceLightTextRule``,
``DarkBgTextPairingRule``, ``LightTextOnLightBgRule``) with one rule that
iterates :func:`iter_jsx_elements_with_bg_context` ONCE per check call
and emits findings categorized by the per-element pairing condition.

Each finding still carries one of the original five ``rule_id`` strings so
telemetry, error messages, and downstream auto-fixers stay byte-stable
with the historical implementation. Compatibility shims at the bottom
of the module preserve the legacy class names for existing callers /
tests.
"""

from __future__ import annotations

import re
from typing import Iterator

from ...style_coverage import _contrast_ratio
from ..catalog import (
    M3_BG_TO_TEXT,
    M3_DARK_ANCESTOR_TOKENS,
    M3_LIGHT_ANCESTOR_TOKENS,
    M3_LIGHT_HEX_FALLBACKS,
    M3_REFERENCE_DARK_TEXT,
    M3_REFERENCE_LIGHT_TEXT,
    M3_TEXT_TO_BG,
    M3_TOKENS,
)
from ..walker import JsxBgScope, iter_jsx_elements_with_bg_context
from .base import AstContext, Finding

# Rule IDs — preserved for telemetry continuity with the historical 5-rule
# split. Findings emitted by the consolidated rule still carry the
# specific category id, not the consolidated id.
_RULE_INVERSE_SURFACE = "component.m3.inverse_surface_pairing"
_RULE_LIGHT_SURFACE_INVERSE_TEXT = "component.m3.light_surface_inverse_text"
_RULE_DARK_SURFACE_LIGHT_TEXT = "component.m3.dark_surface_light_text"
_RULE_DARK_BG_TEXT_PAIRING = "component.m3.dark_bg_text_pairing"
_RULE_LIGHT_TEXT_ON_LIGHT_BG = "component.m3.light_text_on_light_bg"

_TEXT_ON_SURFACE_EXACT_RE = re.compile(r"\btext-on-surface\b(?!-)")
_WRONG_TEXT_ON_DARK_BG_RE = re.compile(r"\btext-on-surface(?:-variant)?\b(?:/\d+)?")
_LIGHT_TEXT_ON_DARK_BG_RE = re.compile(r"\btext-on-(?:primary|secondary|error)\b(?!-)(?:/\d+)?")

_CONTRAST_WARNING_RATIO = 4.5


# ---------------------------------------------------------------------------
# Hex resolution + message helpers
# ---------------------------------------------------------------------------


def _expand_hex(hex_value: str) -> str | None:
    value = hex_value.strip()
    if not re.match(r"^#[0-9a-fA-F]{3,6}$", value):
        return None
    if len(value) == 4:
        return "#" + "".join(ch * 2 for ch in value[1:]).lower()
    if len(value) == 7:
        return value.lower()
    return None


def _resolve_semantic_hex(token: str, theme_palette: dict[str, str] | None) -> str | None:
    if theme_palette:
        raw = theme_palette.get(token)
        if raw:
            expanded = _expand_hex(raw)
            if expanded:
                return expanded
    fallback = M3_LIGHT_HEX_FALLBACKS.get(token)
    return _expand_hex(fallback) if fallback else None


def _describe_pairing_mismatch(
    *,
    text_token: str,
    bg_token: str,
    theme_palette: dict[str, str] | None,
) -> str:
    preferred_text = M3_BG_TO_TEXT.get(bg_token)
    bg_hex = _resolve_semantic_hex(bg_token, theme_palette)
    text_hex = _resolve_semantic_hex(text_token, theme_palette)
    if bg_hex and text_hex:
        ratio = _contrast_ratio(text_hex, bg_hex)
        if ratio < _CONTRAST_WARNING_RATIO:
            return (
                f"text-{text_token} on bg-{bg_token} measures {ratio:.2f}:1. "
                f"Prefer text-{preferred_text or 'on-surface'} for the resolved theme pair"
            )
    if preferred_text:
        return (
            f"text-{text_token} on bg-{bg_token} is non-canonical. "
            f"Prefer text-{preferred_text} to match the resolved theme pair"
        )
    return f"Prefer the matching theme foreground on bg-{bg_token}"


def _describe_surface_mismatch(
    *,
    text_token: str,
    theme_palette: dict[str, str] | None,
    surface_label: str,
) -> str:
    paired_bg = M3_TEXT_TO_BG.get(text_token)
    bg_hex = _resolve_semantic_hex("surface", theme_palette) or "#ffffff"
    text_hex = _resolve_semantic_hex(text_token, theme_palette)
    if text_hex:
        ratio = _contrast_ratio(text_hex, bg_hex)
        if ratio < _CONTRAST_WARNING_RATIO:
            return (
                f"text-{text_token} on {surface_label} measures {ratio:.2f}:1. "
                "Prefer text-on-surface or text-on-surface-variant instead"
            )
    if paired_bg:
        return (
            f"text-{text_token} is reserved for bg-{paired_bg}; on {surface_label} "
            "prefer text-on-surface or text-on-surface-variant"
        )
    return f"Prefer the theme-matched foreground token on {surface_label}"


def _line(scope: JsxBgScope) -> int:
    """1-based line number matching the legacy ``tsx[:pos].count('\\n') + 1``."""
    return scope.start_point[0] + 1


# Silence unused-import complaints — these are re-exported for cohesion with
# the catalog module.
_ = (M3_REFERENCE_DARK_TEXT, M3_REFERENCE_LIGHT_TEXT, M3_TOKENS)


# ---------------------------------------------------------------------------
# Consolidated rule
# ---------------------------------------------------------------------------


class M3ColorPairingRule:
    """All five M3 pairing categories evaluated in a single walker pass.

    Iterates :func:`iter_jsx_elements_with_bg_context` once per ``check``
    call and emits findings with the historical category-specific
    ``rule_id`` so telemetry, error messages, and downstream auto-fixers
    stay byte-identical.

    Categories:

    - ``inverse_surface_pairing`` — ``bg-inverse-surface`` +
      ``text-on-surface-variant`` on the same element (warning).
    - ``light_surface_inverse_text`` — ``text-inverse-on-surface`` on a
      light ancestor (error).
    - ``dark_surface_light_text`` — ``text-on-surface`` against a
      ``bg-inverse-surface`` ancestor that is NOT the element's own bg
      (error).
    - ``dark_bg_text_pairing`` — ``text-on-surface[-variant]`` against
      any dark M3 ancestor (error).
    - ``light_text_on_light_bg`` —
      ``text-on-{primary/secondary/error}`` against a light ancestor
      (error).
    """

    id = "component.m3.color_pairing"
    severity = "error"  # category-level severity is on each finding

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        tsx = ctx.tsx
        # Cheap pre-filter: skip the walker entirely when nothing in the
        # source matches any text-on-* / bg-inverse-surface marker.
        # text-on-* covers the four error categories; bg-inverse-surface
        # is the trigger for the same-element warning.
        if "text-on-" not in tsx and "text-inverse-on-surface" not in tsx:
            if "bg-inverse-surface" not in tsx:
                return

        scopes = list(iter_jsx_elements_with_bg_context(ctx.tree.root_node, ctx.source_buf))
        palette = ctx.theme_palette

        # inverse-surface ↔ on-surface-variant pairing — fire ONLY when an
        # actual element pairs them, not just because both strings appear
        # somewhere in the file. Previously a coarse textual heuristic
        # ("bg-inverse-surface" in tsx and "text-on-surface-variant" in
        # tsx) produced false positives on every component that used both
        # tokens in DIFFERENT scopes — the warning shipped on 5/8 of
        # ``6z5k25jk``'s components even though the auto-fixer correctly
        # left the unrelated text-on-surface-variant uses alone.
        for scope in scopes:
            if "text-on-surface-variant" not in scope.class_str:
                continue
            if scope.effective_bg_token != "inverse-surface":
                continue
            yield Finding(
                rule_id=_RULE_INVERSE_SURFACE,
                severity="warning",
                message=(
                    "text-on-surface-variant used with bg-inverse-surface — "
                    "prefer text-inverse-on-surface for the inverse-surface theme pair"
                ),
                line=scope.start_point[0] + 1,
                col=scope.start_point[1],
            )
            break  # one finding per file is enough — fix-message stays compact

        for scope in scopes:
            yield from self._check_light_surface_inverse_text(scope, palette)
            yield from self._check_dark_surface_light_text(scope, palette)
            yield from self._check_dark_bg_text_pairing(scope, palette)
            yield from self._check_light_text_on_light_bg(scope, palette)

    # -- per-scope checkers ---------------------------------------------------

    def _check_light_surface_inverse_text(
        self, scope: JsxBgScope, palette: dict[str, str] | None
    ) -> Iterator[Finding]:
        if "text-inverse-on-surface" not in scope.class_str:
            return
        effective = scope.effective_bg_token
        if effective is None or effective not in M3_LIGHT_ANCESTOR_TOKENS:
            return
        line_num = _line(scope)
        yield Finding(
            rule_id=_RULE_LIGHT_SURFACE_INVERSE_TEXT,
            severity="warning",
            message=f"Line ~{line_num}: "
            + _describe_surface_mismatch(
                text_token="inverse-on-surface",
                theme_palette=palette,
                surface_label="regular surfaces",
            ),
            line=line_num,
            col=scope.start_point[1],
        )

    def _check_dark_surface_light_text(
        self, scope: JsxBgScope, palette: dict[str, str] | None
    ) -> Iterator[Finding]:
        # Same-element inverse-surface is handled by the auto-fixer; this
        # rule only fires when the inverse-surface is an ANCESTOR.
        if scope.own_bg_token == "inverse-surface":
            return
        if scope.effective_bg_token != "inverse-surface":
            return
        if not _TEXT_ON_SURFACE_EXACT_RE.search(scope.class_str):
            return
        line_num = _line(scope)
        yield Finding(
            rule_id=_RULE_DARK_SURFACE_LIGHT_TEXT,
            severity="warning",
            message=f"Line ~{line_num}: "
            + _describe_pairing_mismatch(
                text_token="on-surface",
                bg_token="inverse-surface",
                theme_palette=palette,
            ),
            line=line_num,
            col=scope.start_point[1],
        )

    def _check_dark_bg_text_pairing(
        self, scope: JsxBgScope, palette: dict[str, str] | None
    ) -> Iterator[Finding]:
        effective = scope.effective_bg_token
        if effective is None or effective not in M3_DARK_ANCESTOR_TOKENS:
            return
        wrong_match = _WRONG_TEXT_ON_DARK_BG_RE.search(scope.class_str)
        if wrong_match is None:
            return
        wrong = wrong_match.group(0)
        line_num = _line(scope)
        yield Finding(
            rule_id=_RULE_DARK_BG_TEXT_PAIRING,
            severity="warning",
            message=f"Line ~{line_num}: "
            + _describe_pairing_mismatch(
                text_token=wrong.split("/")[0].removeprefix("text-"),
                bg_token=effective,
                theme_palette=palette,
            ),
            line=line_num,
            col=scope.start_point[1],
        )

    def _check_light_text_on_light_bg(
        self, scope: JsxBgScope, palette: dict[str, str] | None
    ) -> Iterator[Finding]:
        text_match = _LIGHT_TEXT_ON_DARK_BG_RE.search(scope.class_str)
        if text_match is None:
            return
        effective = scope.effective_bg_token
        if effective is None:
            # No known ancestor — cannot judge, stay silent.
            return
        if effective not in M3_LIGHT_ANCESTOR_TOKENS:
            # Ancestor is dark — pairing is correct.
            return
        wrong = text_match.group(0)
        line_num = _line(scope)
        yield Finding(
            rule_id=_RULE_LIGHT_TEXT_ON_LIGHT_BG,
            severity="warning",
            message=f"Line ~{line_num}: "
            + _describe_surface_mismatch(
                text_token=wrong.split("/")[0].removeprefix("text-"),
                theme_palette=palette,
                surface_label="light/default surfaces",
            ),
            line=line_num,
            col=scope.start_point[1],
        )


# ---------------------------------------------------------------------------
# Backwards-compatibility shims — the historical 5 rule classes are
# preserved as thin wrappers so any external caller / test that imports
# them keeps working. Each runs the consolidated rule and filters to
# its own category. This is dispatch overhead only when the legacy class
# is invoked directly; the AST rule engine in ``default_set.py`` calls
# ``M3ColorPairingRule`` once per component, not five times.
# ---------------------------------------------------------------------------


def _filter_by_rule_id(rule: M3ColorPairingRule, ctx: AstContext, target: str) -> Iterator[Finding]:
    for f in rule.check(ctx):
        if f.rule_id == target:
            yield f


class InverseSurfaceTextPairingRule:
    id = _RULE_INVERSE_SURFACE
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        yield from _filter_by_rule_id(M3ColorPairingRule(), ctx, _RULE_INVERSE_SURFACE)


class LightSurfaceInverseTextRule:
    id = _RULE_LIGHT_SURFACE_INVERSE_TEXT
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        yield from _filter_by_rule_id(M3ColorPairingRule(), ctx, _RULE_LIGHT_SURFACE_INVERSE_TEXT)


class DarkSurfaceLightTextRule:
    id = _RULE_DARK_SURFACE_LIGHT_TEXT
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        yield from _filter_by_rule_id(M3ColorPairingRule(), ctx, _RULE_DARK_SURFACE_LIGHT_TEXT)


class DarkBgTextPairingRule:
    id = _RULE_DARK_BG_TEXT_PAIRING
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        yield from _filter_by_rule_id(M3ColorPairingRule(), ctx, _RULE_DARK_BG_TEXT_PAIRING)


class LightTextOnLightBgRule:
    id = _RULE_LIGHT_TEXT_ON_LIGHT_BG
    severity = "warning"

    def check(self, ctx: AstContext) -> Iterator[Finding]:
        yield from _filter_by_rule_id(M3ColorPairingRule(), ctx, _RULE_LIGHT_TEXT_ON_LIGHT_BG)
