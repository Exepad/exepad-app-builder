"""M3 color-token auto-fixes for component TSX.

Five rewrite phases applied in order:

1. **Text opacity strip** (regex). ``text-*/N`` → ``text-*``. Tailwind
   opacity modifiers on text colors fail WCAG AA on palette-derived
   pairs; the design system provides full-opacity semantic muted
   variants instead.
2. **Bare ``outline-variant``** (regex). ``outline-variant`` is an M3
   color name, not a Tailwind outline-color utility — rewrite to
   ``border-outline-variant`` so the class compiles.
3. **Low-opacity background clamp** (regex). ``bg-*/<30`` → ``bg-*/30``.
   Runs before the AST pass so clamped opacities are stable when the
   walker resolves effective bg tokens.
4. **Header ``bg-transparent``** (regex). Inside ``<header>`` /
   ``<nav>``, ``bg-transparent`` → ``bg-surface/90 backdrop-blur-md``.
   Runs before the AST pass so the walker sees the final ancestor bg —
   otherwise an orphan ``text-on-primary`` inside a transparent header
   would be skipped on the first pass and only flagged on a second
   pass after the header rewrite, breaking idempotence.
5. **AST four-phase pairing fix** (single tree walk via
   :func:`_rewrite_m3_color_pairings`):
   a. Same-element ``bg-inverse-surface`` + ``text-on-surface[-variant]``
      → ``text-inverse-on-surface``.
   b. Orphan ``text-inverse-on-surface`` (no dark ancestor) →
      ``text-on-surface``.
   c. Same-element ``bg-{primary/secondary/error}`` +
      ``text-on-surface[-variant]`` → ``text-on-{token}``.
   d. Ancestor-aware Track 2: rewrite child text tokens against the
      nearest enclosing ancestor bg.

The AST rewriter applies edits right-to-left by byte offset so earlier
offsets stay valid as later className literals are spliced in place.
Telemetry messages are byte-identical to the historical rewriter
(``in classNames with bg-inverse-surface``, ``in classNames without
dark background``, ``child text token``, …) — downstream tests assert
on the exact phrasing.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from main_agent.services.validation.fixers._context import FixContext
from main_agent.services.validation.tsx_ast.catalog import (
    M3_DARK_ANCESTOR_TOKENS,
    M3_LIGHT_ANCESTOR_TOKENS,
)
from main_agent.services.validation.tsx_ast.parser import parse_tsx, source_bytes
from main_agent.services.validation.tsx_ast.walker import (
    JsxBgScope,
    iter_jsx_elements_with_bg_context,
    rewrite_classname_text,
)

# ---------------------------------------------------------------------------
# Public dispatcher
# ---------------------------------------------------------------------------


def apply_component_m3_colors_fixes(
    tsx: str,
    ctx: FixContext,
    fixes_applied: list[str],
) -> str:
    """Run all M3 color-pairing rewrites in order. See module docstring.

    Phase 1 / 3 / 4 (text opacity strip, bg opacity clamp, header
    bg-transparent rewrite) are scoped to JSX className text via
    ``rewrite_classname_text`` so SVG kebab attributes inside
    ``dangerouslySetInnerHTML`` strings, JSX comments, and string
    literals are never mutated.
    """
    _text_opacity_re = re.compile(r"\b(text-[\w-]+)/(\d+)\b")

    def _fix_text_opacity_in_class(class_text: str) -> str:
        def repl(m: re.Match) -> str:
            cls = m.group(1)
            fixes_applied.append(f"Stripped text opacity {m.group(0)} → {cls}")
            return cls

        return _text_opacity_re.sub(repl, class_text)

    tsx = rewrite_classname_text(tsx, _fix_text_opacity_in_class)

    _bare_outline_variant_re = re.compile(r"(?<![a-z-])outline-variant(?=/|\s|\"|\b)")
    _outline_variant_seen = [False]

    def _fix_outline_variant_in_class(class_text: str) -> str:
        if not _bare_outline_variant_re.search(class_text):
            return class_text
        _outline_variant_seen[0] = True
        return _bare_outline_variant_re.sub("border-outline-variant", class_text)

    tsx = rewrite_classname_text(tsx, _fix_outline_variant_in_class)
    if _outline_variant_seen[0]:
        fixes_applied.append("Replaced bare outline-variant with border-outline-variant")

    _bg_opacity_re = re.compile(r"\b(bg-[\w-]+)/(\d+)\b")

    def _fix_low_opacity_bg_in_class(class_text: str) -> str:
        def repl(m: re.Match) -> str:
            opacity = int(m.group(2))
            if opacity < 30:
                fixes_applied.append(f"Clamped bg opacity {m.group(0)} → {m.group(1)}/30")
                return f"{m.group(1)}/30"
            return m.group(0)

        return _bg_opacity_re.sub(repl, class_text)

    tsx = rewrite_classname_text(tsx, _fix_low_opacity_bg_in_class)

    if re.search(r"<(?:header|nav)\b", tsx):
        # bg-transparent → bg-surface/90 backdrop-blur-md must apply ONLY
        # inside className text (otherwise an svg attr or string mention
        # of "bg-transparent" would also get rewritten). Scope via the
        # className-text rewriter and use a sentinel to log the fix once.
        _seen_in_class = [False]

        def _swap_in_class(class_text: str) -> str:
            if "bg-transparent" not in class_text:
                return class_text
            if "backdrop-blur" in class_text:
                return class_text
            _seen_in_class[0] = True
            return class_text.replace("bg-transparent", "bg-surface/90 backdrop-blur-md")

        tsx = rewrite_classname_text(tsx, _swap_in_class)
        if _seen_in_class[0]:
            fixes_applied.append(
                "Replaced bg-transparent with bg-surface/90 backdrop-blur-md in header"
            )

    tsx, extra_fixes = _rewrite_m3_color_pairings(tsx, theme_palette=ctx.theme_palette)
    fixes_applied.extend(extra_fixes)
    return tsx


# ---------------------------------------------------------------------------
# AST four-phase pairing rewriter (inlined from the deleted
# ``m3_color_pairing.py`` — single tree walk, four phases over the same
# scope list, splice rewrites right-to-left).
# ---------------------------------------------------------------------------


_TEXT_ON_SURFACE_EXACT_RE = re.compile(r"\btext-on-surface\b(?!-)")
_TEXT_ON_SURFACE_VARIANT_EXACT_RE = re.compile(r"\btext-on-surface-variant\b")
_WRONG_TEXT_ON_DARK_BG_RE = re.compile(r"\btext-on-surface(?:-variant)?\b(?:/\d+)?")
_LIGHT_TEXT_ON_DARK_BG_RE = re.compile(r"\btext-on-(?:primary|secondary|error)\b(?!-)(?:/\d+)?")
# ``text-on-X-container`` is only valid inside a ``bg-X-container`` ancestor.
# When the effective ancestor bg is the dark M3 token ``bg-X`` (no
# ``-container`` suffix), this token renders near-black on dark and
# fails WCAG AA — rewrite to ``text-on-X``. Seen on luna-rest
# (jmhd6gv7) where ``<p className="text-on-primary-container">`` sat
# inside ``<section className="bg-primary">``, producing ~1.3:1.
_WRONG_CONTAINER_TEXT_ON_DARK_BG_RE = re.compile(
    r"\btext-on-(?:primary|secondary|error)-container\b(?:/\d+)?"
)

# Same-element opacity-bearing dark bg (``bg-primary/30``, ``bg-secondary/40``,
# ``bg-error/30``) carrying ``text-on-X-container``. The walker's
# ``own_bg_token`` filter rejects opacity < 60 as "decorative tint", so the
# main same-element rewriter doesn't see these scopes. But the wrong-
# container token is wrong at ANY opacity — it's a token-pair semantic
# error, not a contrast error. Seen on coje33ih InfrastructureContent
# (2026-05-12): ``<Badge className="bg-primary/30 text-on-primary-container">``.
_OPACITY_DARK_BG_TOKEN_RE = re.compile(
    r"\bbg-(primary|secondary|error)(?:/\d+)\b"
)


@dataclass
class _RewriteState:
    """Accumulator passed between phases — one edit map, a few counters."""

    rewrites: dict[tuple[int, int], str] = field(default_factory=dict)
    same_element_inverse: bool = False
    orphan_inverse_fixed: bool = False
    same_element_dark_count: int = 0
    track2_spans: set[tuple[int, int]] = field(default_factory=set)


def _rewrite_m3_color_pairings(
    tsx: str,
    theme_palette: dict[str, str] | None = None,
) -> tuple[str, list[str]]:
    """Rewrite M3 bg/text pairing violations in a single AST walk."""
    try:
        tree = parse_tsx(tsx)
    except Exception:
        return tsx, []

    buf = source_bytes(tsx)
    scopes = list(iter_jsx_elements_with_bg_context(tree.root_node, buf))
    state = _RewriteState()

    _phase_same_element_inverse(scopes, state)
    _phase_orphan_inverse(scopes, state)
    _phase_same_element_dark(scopes, state)
    _phase_same_element_opacity_dark_wrong_container(scopes, state)
    _phase_ancestor_track2(scopes, state)

    if state.rewrites:
        tsx = _splice_rewrites(buf, state.rewrites)

    fixes = _build_fix_messages(state)
    _ = theme_palette  # parameter kept for API symmetry; not used here.
    return tsx, fixes


def _phase_same_element_inverse(
    scopes: list[JsxBgScope], state: _RewriteState
) -> None:
    """Same-element ``bg-inverse-surface`` + ``text-on-surface[-variant]``
    → ``text-inverse-on-surface``."""
    for scope in scopes:
        if scope.own_bg_token != "inverse-surface":
            continue
        has_exact = bool(_TEXT_ON_SURFACE_EXACT_RE.search(scope.class_str))
        has_variant = bool(_TEXT_ON_SURFACE_VARIANT_EXACT_RE.search(scope.class_str))
        if not (has_exact or has_variant):
            continue
        new_class = scope.class_str
        # Variant-form first so the exact-form regex (which excludes
        # ``-variant``) doesn't see partial-rewrite collisions.
        new_class = _TEXT_ON_SURFACE_VARIANT_EXACT_RE.sub("text-inverse-on-surface", new_class)
        new_class = _TEXT_ON_SURFACE_EXACT_RE.sub("text-inverse-on-surface", new_class)
        span = scope.class_inner_span
        if span is None:
            continue
        state.rewrites[span] = new_class
        state.same_element_inverse = True


def _phase_orphan_inverse(
    scopes: list[JsxBgScope], state: _RewriteState
) -> None:
    """Revert ``text-inverse-on-surface`` on elements not inside any dark bg."""
    for scope in scopes:
        span = scope.class_inner_span
        if span is None:
            continue
        current = state.rewrites.get(span, scope.class_str)
        if "text-inverse-on-surface" not in current:
            continue
        effective = scope.effective_bg_token
        has_dark_context = effective == "inverse-surface" or effective in M3_DARK_ANCESTOR_TOKENS
        if has_dark_context:
            continue
        state.rewrites[span] = current.replace("text-inverse-on-surface", "text-on-surface")
        state.orphan_inverse_fixed = True


def _phase_same_element_dark(
    scopes: list[JsxBgScope], state: _RewriteState
) -> None:
    """Same-element ``bg-{primary/secondary/error}`` + wrong text token
    → ``text-on-{token}``.

    Catches two wrong-text variants on the same element:
    - ``text-on-surface[-variant]`` (light text on dark — original).
    - ``text-on-{X}-container`` (container-pair token on dark — added
      to cover luna-rest's ``<div className="bg-primary
      text-on-primary-container">`` pattern).
    """
    for scope in scopes:
        token = scope.own_bg_token
        if token is None or token not in M3_DARK_ANCESTOR_TOKENS:
            continue
        span = scope.class_inner_span
        if span is None:
            continue
        current = state.rewrites.get(span, scope.class_str)
        rewrote = False
        if _WRONG_TEXT_ON_DARK_BG_RE.search(current):
            current = _WRONG_TEXT_ON_DARK_BG_RE.sub(f"text-on-{token}", current)
            rewrote = True
        if _WRONG_CONTAINER_TEXT_ON_DARK_BG_RE.search(current):
            current = _WRONG_CONTAINER_TEXT_ON_DARK_BG_RE.sub(
                f"text-on-{token}", current
            )
            rewrote = True
        if not rewrote:
            continue
        state.rewrites[span] = current
        state.same_element_dark_count += 1


def _phase_same_element_opacity_dark_wrong_container(
    scopes: list[JsxBgScope], state: _RewriteState
) -> None:
    """Same-element ``bg-{primary/secondary/error}/N`` (any opacity) +
    ``text-on-{X}-container`` → ``text-on-{X}``.

    The walker filters opacity < 60 out of ``own_bg_token`` (treating
    them as decorative tints), but the wrong-container token is a
    token-pair semantic error — not a contrast error — and is wrong at
    every opacity. Seen on coje33ih InfrastructureContent (2026-05-12)
    where Badges used ``bg-primary/30 text-on-primary-container``.
    """
    for scope in scopes:
        if scope.own_bg_token is not None:
            # Already handled by the main same-element dark phase.
            continue
        span = scope.class_inner_span
        if span is None:
            continue
        current = state.rewrites.get(span, scope.class_str)
        opacity_match = _OPACITY_DARK_BG_TOKEN_RE.search(current)
        if opacity_match is None:
            continue
        if not _WRONG_CONTAINER_TEXT_ON_DARK_BG_RE.search(current):
            continue
        token = opacity_match.group(1)
        new_class = _WRONG_CONTAINER_TEXT_ON_DARK_BG_RE.sub(
            f"text-on-{token}", current
        )
        if new_class == current:
            continue
        state.rewrites[span] = new_class
        state.same_element_dark_count += 1


def _phase_ancestor_track2(
    scopes: list[JsxBgScope], state: _RewriteState
) -> None:
    """Rewrite child text tokens based on the nearest enclosing ancestor bg."""
    for scope in scopes:
        effective = scope.effective_bg_token
        if effective is None:
            continue
        # Children with no own bg always inherit. Elements with a LIGHT own
        # bg may still carry a wrong dark-paired text token on the same
        # element — allow the rewrite. Skip everything else that already
        # carries its own bg.
        if scope.own_bg_token is not None and scope.own_bg_token not in M3_LIGHT_ANCESTOR_TOKENS:
            continue
        span = scope.class_inner_span
        if span is None:
            continue
        current = state.rewrites.get(span, scope.class_str)
        new_class = _track2_rewrite(effective, current)
        if new_class is None or new_class == current:
            continue
        state.rewrites[span] = new_class
        state.track2_spans.add(span)


def _track2_rewrite(effective: str, class_str: str) -> str | None:
    """Return the Track 2 rewrite for ``class_str`` against ``effective``."""
    if effective in M3_DARK_ANCESTOR_TOKENS and _WRONG_TEXT_ON_DARK_BG_RE.search(class_str):
        return _WRONG_TEXT_ON_DARK_BG_RE.sub(f"text-on-{effective}", class_str)
    # ``text-on-X-container`` against ``bg-X`` (dark) is unreadable; rewrite
    # to the dark-pair token. Seen on luna-rest (jmhd6gv7) where multiple
    # paragraphs used ``text-on-primary-container`` inside ``bg-primary``
    # sections (contrast ~1.3 : 1).
    if effective in M3_DARK_ANCESTOR_TOKENS and _WRONG_CONTAINER_TEXT_ON_DARK_BG_RE.search(
        class_str
    ):
        return _WRONG_CONTAINER_TEXT_ON_DARK_BG_RE.sub(f"text-on-{effective}", class_str)
    if effective == "inverse-surface" and _WRONG_TEXT_ON_DARK_BG_RE.search(class_str):
        return _WRONG_TEXT_ON_DARK_BG_RE.sub("text-inverse-on-surface", class_str)
    if effective in M3_LIGHT_ANCESTOR_TOKENS and _LIGHT_TEXT_ON_DARK_BG_RE.search(class_str):
        return _LIGHT_TEXT_ON_DARK_BG_RE.sub("text-on-surface", class_str)
    if effective in M3_LIGHT_ANCESTOR_TOKENS and "text-inverse-on-surface" in class_str:
        return class_str.replace("text-inverse-on-surface", "text-on-surface")
    return None


def _splice_rewrites(buf: bytes, rewrites: dict[tuple[int, int], str]) -> str:
    """Apply every rewrite right-to-left so earlier offsets remain valid."""
    new_bytes = bytearray(buf)
    for (start, end), new_class in sorted(rewrites.items(), reverse=True):
        new_bytes[start:end] = new_class.encode("utf-8")
    return bytes(new_bytes).decode("utf-8")


def _build_fix_messages(state: _RewriteState) -> list[str]:
    """Build the telemetry messages — byte-identical to the historical rewriter."""
    fixes: list[str] = []
    if state.same_element_inverse:
        fixes.append(
            "Replaced text-on-surface[-variant] → text-inverse-on-surface "
            "in classNames with bg-inverse-surface"
        )
    if state.orphan_inverse_fixed:
        fixes.append(
            "Replaced text-inverse-on-surface → text-on-surface "
            "in classNames without dark background"
        )
    if state.same_element_dark_count:
        fixes.append(
            f"Replaced text-on-surface → text-on-{{token}} "
            f"in {state.same_element_dark_count} className(s) "
            f"with bg-primary/secondary/error"
        )
    if state.track2_spans:
        fixes.append(
            f"Rewrote {len(state.track2_spans)} child text token(s) to match "
            f"ancestor bg (Track 2 pairing)"
        )
    return fixes


# Hand-rolled span helpers (``_classname_inner_span`` / ``_find_tag_end`` /
# ``_char_span_to_byte_span``) used to live here. They were brittle —
# ``_find_tag_end`` re-implemented JSX parsing as a character-by-character
# brace+string state machine and could be confused by JSX expressions
# containing ``>`` characters in string literals or nested templates. They
# also assumed character offsets (``el_start + quoted.start(1)``) added to
# byte offsets (``scope.start_byte``), which only worked because typical
# component TSX is ASCII.
#
# Replaced by ``JsxBgScope.class_inner_span``, populated by tree-sitter
# directly via ``_classname_value_inner_span`` in ``walker.py``. One AST
# walk, native byte offsets, no regex over raw TSX in the span-locator
# path.
