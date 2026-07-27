"""Lift CSS from bundle sources into ``codefocus_style:theme.css``.

The DesignImporter LLM doesn't write theme CSS anymore. This module:

* Parses every ``<style>`` block from the bundle's HTML pages and the
  shared ``styles.css`` (Claude Design multi-page).
* Separates ``:root { ... }`` declarations (lifted to the ``@theme`` block)
  from rule bodies (pasted verbatim into ``@layer exepad-app``).
* Strips forbidden globals — the resets and bare-element rules that
  Tailwind v4's preflight already covers.
* Emits a single ``codefocus_style:theme.css`` carrying:
  - The Tailwind v4 bootstrap preamble
  - Every Google Fonts ``@import``
  - ``@theme`` with both M3-mapped tokens AND every original ``--var`` so
    verbatim ``var(--*)`` references in the layer block still resolve.
  - ``@layer exepad-app { ... }`` containing every preserved class rule,
    pseudo-class, ``@media``, ``@keyframes``, etc.

Uses ``tinycss2`` for CST-preserving round-trips: comments, exotic
whitespace, and arbitrary selectors all survive ``parse_stylesheet`` →
``serialize`` unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional

import tinycss2

# ── Tailwind v4 bootstrap (per claude-design-importer/SKILL.md "REQUIRED preamble") ──
# These directives MUST sit at the top of theme.css OUTSIDE any @layer.
_BOOTSTRAP_LINES = (
    '@import "tailwindcss";',
    '@import "tw-animate-css";',
    '@source "./components";',
)


@dataclass(frozen=True)
class CssBlock:
    """One ordered chunk of CSS lifted from a bundle source.

    ``origin`` identifies the source — used in error messages and to keep
    cascade order stable when multiple blocks come from the same handler.
    """

    origin: str
    text: str


@dataclass
class LiftedStyles:
    """Result of running the style-block parser over bundle CSS sources."""

    root_vars: dict[str, str] = field(default_factory=dict)
    """Raw ``--var: value`` declarations from every ``:root { … }`` block.
    Later blocks override earlier ones (CSS cascade).
    """

    layer_text: str = ""
    """Verbatim CSS for ``@layer exepad-app``: every non-``:root`` rule from
    every collected source, with forbidden globals stripped, joined in
    cascade order with double newlines between blocks for readability.
    """

    base_layer_text: str = ""
    """Verbatim CSS for ``@layer base``: bare ``h1``-``h6`` rules from the
    source. The runner emits these inside ``@layer base`` so they apply
    to bare ``<h1>...<h6>`` elements (giving the imported design's
    typography defaults — weight, letter-spacing, line-height, font
    variation settings, etc.) WITHOUT overriding component-level
    Tailwind utility classes like ``.font-bold`` or ``.text-4xl``, which
    sit in ``@layer utilities`` (declared after ``base``).

    Without this routing the lifter used to drop bare h-rules entirely,
    silently losing design fidelity. Per-section overrides (``.hero h1``,
    ``.story-copy h2``) still flow into ``layer_text`` (``@layer
    exepad-app``) where they correctly beat utilities for that scope.
    """


def lift_styles(blocks: Iterable[CssBlock]) -> LiftedStyles:
    """Parse a list of CSS blocks, return root vars + cleaned layer text.

    Each block is parsed via ``tinycss2.parse_stylesheet``. ``:root`` rules
    have their declarations harvested into ``root_vars``. Every other rule
    that is not a forbidden global is re-serialized into either
    ``layer_text`` (default — ``@layer exepad-app``) or ``base_layer_text``
    (bare typography rules — ``@layer base``).
    """
    root_vars: dict[str, str] = {}
    layer_chunks: list[str] = []
    base_chunks: list[str] = []

    for block in blocks:
        if not block.text or not block.text.strip():
            continue
        rules = tinycss2.parse_stylesheet(
            block.text,
            skip_comments=False,
            skip_whitespace=False,
        )
        kept_exepad: list = []
        kept_base: list = []
        for node in rules:
            kept, dest = _process_node(node, root_vars=root_vars)
            if kept is None:
                continue
            if dest == "base":
                kept_base.append(kept)
            else:
                kept_exepad.append(kept)
        if kept_exepad:
            chunk = tinycss2.serialize(kept_exepad).strip()
            if chunk:
                layer_chunks.append(chunk)
        if kept_base:
            chunk = tinycss2.serialize(kept_base).strip()
            if chunk:
                base_chunks.append(chunk)

    return LiftedStyles(
        root_vars=root_vars,
        layer_text="\n\n".join(layer_chunks),
        base_layer_text="\n\n".join(base_chunks),
    )


def build_theme_css(
    *,
    google_font_imports: Iterable[str],
    m3_tokens: dict[str, str],
    original_tokens: dict[str, str],
    extra_theme_lines: Iterable[str] = (),
    layer_text: str = "",
    base_layer_text: str = "",
) -> str:
    """Assemble the final ``codefocus_style:theme.css`` text.

    Args:
        google_font_imports: ``fonts.googleapis.com`` URLs collected from any
            bundle ``<link rel="stylesheet">``. Emitted as ``@import url(...)``.
        m3_tokens: Material-3 palette mapped from source vars by the LLM's
            plan. Always emitted first inside ``@theme``.
        original_tokens: Every source ``--var`` declaration. Emitted INSIDE
            ``@theme`` after M3 tokens (skipping any name already in
            ``m3_tokens`` so we don't double-declare). This is what makes
            verbatim ``var(--barn)`` references in the layer block resolve.
        extra_theme_lines: Optional ``--token: value`` declarations
            (without the leading whitespace). Useful for fonts / radii
            derived from sources other than ``:root``.
        layer_text: The body of ``@layer exepad-app { ... }``. May be
            empty, in which case the layer block is omitted. Rules in
            this layer beat Tailwind utilities by layer order.
        base_layer_text: The body of ``@layer base { ... }``. May be
            empty. Carries the imported design's bare ``h1``-``h6``
            typography defaults — emitted in ``@layer base`` so they
            apply to bare headings but LOSE to component-level
            ``.font-bold`` / ``.text-4xl`` utilities (which sit in
            ``@layer utilities``, declared after ``base``).

    Returns:
        Complete theme.css text. Always starts with the Tailwind v4
        bootstrap preamble.
    """
    out: list[str] = []
    out.extend(_BOOTSTRAP_LINES)
    out.append("")
    seen_imports: set[str] = set()
    for url in google_font_imports:
        if not isinstance(url, str) or not url.strip():
            continue
        if url in seen_imports:
            continue
        seen_imports.add(url)
        out.append(f'@import url("{url}");')
    if seen_imports:
        out.append("")

    out.append("@theme {")
    for name, value in m3_tokens.items():
        out.append(f"  {_format_decl(name, value)}")
    if original_tokens:
        out.append("")
        out.append(
            "  /* Source design tokens preserved for verbatim var(--*) "
            "references in @layer exepad-app. */"
        )
        for name, value in original_tokens.items():
            if name in m3_tokens:
                continue
            out.append(f"  {_format_decl(name, value)}")
    for line in extra_theme_lines:
        if not isinstance(line, str) or not line.strip():
            continue
        clean = line.strip().rstrip(";")
        out.append(f"  {clean};")
    out.append("}")

    # The runtime SPA shell renders inside `<div class="bg-background
    # text-foreground">`. `text-foreground` resolves to var(--color-foreground).
    # If the imported palette doesn't declare it, the utility falls through to
    # the SPA's light-mode default (dark navy) and every element without an
    # explicit color rule inherits invisible text on dark themes. Aliasing it
    # to --color-on-surface keeps the foreground tracking the resolved palette.
    #
    # NOTE: emitted in a verbatim ``:root`` block (NOT inside ``@theme``)
    # because Tailwind v4 tree-shakes ``@theme`` tokens that no class
    # references. ``:root`` declarations pass through to the compiled
    # output unchanged, ensuring the override is present on the page even
    # when no app component uses ``text-foreground`` directly.
    has_foreground = "--color-foreground" in m3_tokens or "--color-foreground" in original_tokens
    has_on_surface = "--color-on-surface" in m3_tokens or "--color-on-surface" in original_tokens
    if not has_foreground and has_on_surface:
        out.append("")
        out.append(":root { --color-foreground: var(--color-on-surface); }")

    if base_layer_text and base_layer_text.strip():
        # Emitted BEFORE @layer exepad-app — both layers contribute to
        # the same Tailwind-managed base/exepad-app sequence, but writing
        # @layer base first makes the cascade order obvious to anyone
        # reading the generated CSS. Tailwind utilities (in @layer
        # utilities, declared after base) still beat these rules.
        out.append("")
        out.append("@layer base {")
        out.append(_indent(base_layer_text.strip(), "  "))
        out.append("}")

    if layer_text and layer_text.strip():
        out.append("")
        out.append("@layer exepad-app {")
        out.append(_indent(layer_text.strip(), "  "))
        out.append("}")

    out.append("")  # trailing newline
    return "\n".join(out)


# ────────────────────────────────────────────────────────────────────────────
# Internals
# ────────────────────────────────────────────────────────────────────────────

# Selectors whose top-level rules Tailwind v4's preflight already covers.
# We drop these from layer text rather than carry them — Tailwind would
# either duplicate or fight them.
_FORBIDDEN_BARE_SELECTORS: frozenset[str] = frozenset(
    {
        "*",
        "*::before",
        "*::after",
        "html",
        "body",
        "img",
        "a",
    }
)
# Bare typography selectors. Rules whose ENTIRE selector list is bare
# h1...h6 carry the imported design's heading typography defaults
# (font-family, font-weight, letter-spacing, line-height,
# font-variation-settings, color, text-wrap). The lifter routes them to
# ``@layer base`` so they apply to bare ``<h1>...<h6>`` elements without
# overriding component-level Tailwind utilities like ``.font-bold`` —
# Tailwind utilities sit in ``@layer utilities`` (declared after
# ``base``), so they win on layer order regardless of selector
# specificity.
_BARE_TYPOGRAPHY_SELECTORS: frozenset[str] = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
# At-rules that can't safely live inside ``@layer exepad-app { ... }`` in
# Tailwind v4. ``@import`` and ``@charset`` belong at the top of the file
# (the runner re-emits Google Fonts via a top-level ``@import url(...)``);
# ``@font-face`` is replaced by ``@import url(googlefonts)``.
_FORBIDDEN_AT_RULES: frozenset[str] = frozenset({"font-face", "import", "charset"})


def _process_node(node, *, root_vars: dict[str, str]):  # noqa: ANN001 — tinycss2 ASTs aren't typed
    """Decide where one top-level CSS node belongs.

    Returns ``(kept_node, destination)`` where ``destination`` is one of:

    - ``"exepad-app"`` — ``@layer exepad-app`` (default for class /
      compound / pseudo selectors). Beats Tailwind utilities by layer
      order.
    - ``"base"`` — ``@layer base``. Used for bare ``h1``-``h6``
      rules that carry the design's typography defaults; loses to
      ``.font-bold`` and friends in ``@layer utilities``.
    - ``None`` (when ``kept_node`` is also ``None``) — drop entirely:
      ``:root`` blocks (already harvested into ``root_vars``), ``*``,
      ``html``, ``body``, ``img``, ``a`` (Tailwind preflight handles
      these), and forbidden at-rules (``@import``, ``@font-face``,
      ``@charset``).
    """
    node_type = node.type
    if node_type in {"whitespace", "comment"}:
        return node, "exepad-app"

    if node_type == "qualified-rule":
        selector = tinycss2.serialize(node.prelude).strip()
        if _is_root_selector(selector):
            _harvest_declarations_into(node.content, root_vars)
            return None, None
        if _is_bare_typography_selector(selector):
            return node, "base"
        if _is_forbidden_bare_selector(selector):
            return None, None
        return node, "exepad-app"

    if node_type == "at-rule":
        at_name = (node.lower_at_keyword or "").strip()
        if at_name in _FORBIDDEN_AT_RULES:
            return None, None
        return node, "exepad-app"

    return node, "exepad-app"


def _is_root_selector(selector: str) -> bool:
    parts = [p.strip() for p in selector.split(",") if p.strip()]
    return any(part == ":root" for part in parts)


def _is_bare_typography_selector(selector: str) -> bool:
    """True iff every comma-separated part is a bare ``h1``..``h6``.

    Used to route the design's heading typography rule(s) into
    ``@layer base``. Compound selectors like ``.pagehead h1`` or
    ``.hero h1`` do NOT match — those flow into ``@layer exepad-app``
    where they correctly beat Tailwind utilities for that scope.
    """
    parts = [p.strip() for p in selector.split(",") if p.strip()]
    if not parts:
        return False
    return all(p in _BARE_TYPOGRAPHY_SELECTORS for p in parts)


def _is_forbidden_bare_selector(selector: str) -> bool:
    """True iff every part is a bare reset selector (``*``, ``html``, …).

    These get dropped entirely — Tailwind preflight already covers them.
    Note: bare ``h1``-``h6`` rules are NOT handled here; they route to
    ``@layer base`` via ``_is_bare_typography_selector``.
    """
    parts = [p.strip() for p in selector.split(",") if p.strip()]
    if not parts:
        return False
    return all(p in _FORBIDDEN_BARE_SELECTORS for p in parts)


def _harvest_declarations_into(content_tokens, sink: dict[str, str]) -> None:
    """Parse a qualified-rule's content tokens as declarations, store --vars."""
    declarations = tinycss2.parse_blocks_contents(content_tokens, skip_whitespace=True)
    for decl in declarations:
        if decl.type != "declaration":
            continue
        name = decl.lower_name or decl.name
        if not name.startswith("--"):
            continue
        # Use the original-case name to round-trip exactly.
        original_name = decl.name
        value = tinycss2.serialize(decl.value).strip()
        if decl.important:
            value = f"{value} !important"
        sink[original_name] = value


def _format_decl(name: str, value: str) -> str:
    name = name.strip()
    value = value.strip().rstrip(";")
    return f"{name}: {value};"


def _indent(text: str, prefix: str) -> str:
    return "\n".join(prefix + line if line else line for line in text.split("\n"))


# ────────────────────────────────────────────────────────────────────────────
# Convenience: pull style blocks from bundle HTML
# ────────────────────────────────────────────────────────────────────────────


# Re-exported convenience so handlers don't need a second BeautifulSoup import.
def collect_inline_style_blocks(html: str, *, origin: str) -> list[CssBlock]:
    """Return every ``<style>`` element's text from ``html`` as CssBlocks."""
    if not html:
        return []
    from bs4 import BeautifulSoup  # local import keeps tinycss2-only callers cheap

    soup = BeautifulSoup(html, "html.parser")
    out: list[CssBlock] = []
    for idx, style in enumerate(soup.find_all("style")):
        text = style.string or ""
        if not isinstance(text, str):
            text = str(text)
        text = text.strip()
        if not text:
            continue
        out.append(CssBlock(origin=f"{origin}#style[{idx}]", text=text))
    return out


def collect_external_stylesheet(text: Optional[str], *, origin: str) -> list[CssBlock]:
    """Wrap an external stylesheet's text in a CssBlock."""
    if not text:
        return []
    return [CssBlock(origin=origin, text=text)]
