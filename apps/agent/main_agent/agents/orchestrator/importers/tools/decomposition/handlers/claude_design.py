"""Claude Design (multi-page) format handler.

Theme tokens come from the bundle's shared stylesheet (typically
``styles.css``, but the bundle stager keys it by archive relpath so the
exact staged key may be ``bundle:asset:styles.css`` OR
``bundle:asset:<project>/styles.css`` depending on how the export was
zipped). The handler discovers the stylesheet by listing staged keys and
matching any ``bundle:asset:*.css`` entry — robust to whatever path shape
the export uses.

Layer-block CSS is the discovered stylesheet (minus ``:root`` and
forbidden globals) plus every per-page inline ``<style>`` block. Image
regions use the ``.ph`` placeholder pattern with an inline JS loader
carrying ``PH``/``MAP`` literals — ``ph_transformer`` consumes that data
and rewrites ``.ph`` divs into real ``<img>`` tags.

When the bundle has no shared stylesheet at all (rare — every authored
class lives inline in per-page ``<style>``), the handler proceeds with
just per-page styles and an empty ``root_vars`` dict; the runner derives
the full M3 palette from ``DecompositionPlan.theme.pillars`` resolved
against the per-page ``:root`` declarations the lifter harvests.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Optional

from bs4 import BeautifulSoup, Tag

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
    HandlerError,
    ThemeSources,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.ph_transformer import (
    PhTransformResult,
    transform_placeholders,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    ChromeRegion,
    DecompositionPlan,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.style_lifter import (
    CssBlock,
    collect_external_stylesheet,
    collect_inline_style_blocks,
)
from main_agent.agents.orchestrator.importers.tools.html_utils import (
    extract_google_fonts_links,
    extract_root_vars,
)
from main_agent.agents.utils.artifact_manager import ArtifactManager

# Preferred file basenames for the shared stylesheet, ordered by priority.
# When multiple ``bundle:asset:*.css`` candidates exist (rare), pick the
# one that matches the earliest preferred name.
_PREFERRED_STYLES_BASENAMES: tuple[str, ...] = ("styles.css", "style.css", "main.css")


class ClaudeDesignHandler:
    """Multi-page Claude Design handler. Single-canvas mode is rejected by
    ``handlers.base.select_handler``."""

    format = "claude_design"

    async def collect_theme_sources(self, ctx, plan: DecompositionPlan) -> ThemeSources:
        """Harvest ``--var`` declarations from the shared stylesheet and
        Google Fonts URLs from every page's ``<head><link>``.

        The shared stylesheet is discovered by listing staged ``bundle:asset:*``
        keys ending in ``.css``; the export's directory structure is allowed
        to vary (top-level ``styles.css`` vs. ``<project>/styles.css``).
        """
        stylesheet_key, styles_css = await _discover_shared_stylesheet(ctx)
        root_vars: dict[str, str] = {}
        if styles_css:
            # extract_root_vars wants <style>-block list semantics; wrap the
            # raw stylesheet text as a single block.
            root_vars = dict(extract_root_vars([styles_css]))
        # else: bundle has no shared stylesheet, proceed with empty root_vars.
        # The runner resolves plan.theme.pillars against whatever per-page
        # :root blocks the lifter harvests downstream.

        # Fonts can come from any page's <head><link>. Walk every page in
        # cascade order and dedupe.
        fonts: list[str] = []
        seen: set[str] = set()
        for page in plan.pages:
            html = await ArtifactManager.load_artifact_as_string(ctx, page.bundle_artifact)
            if not html:
                continue
            for url in extract_google_fonts_links(html):
                if url in seen:
                    continue
                seen.add(url)
                fonts.append(url)

        return ThemeSources(root_vars=root_vars, google_font_imports=fonts)

    async def collect_verbatim_css(self, ctx, plan: DecompositionPlan) -> list[CssBlock]:
        """Return the shared stylesheet first, then every per-page ``<style>``.

        Cascade order matters: the shared stylesheet defines the base classes;
        per-page ``<style>`` blocks override them. The lifter pastes
        everything verbatim into one ``@layer exepad-app`` block.
        """
        blocks: list[CssBlock] = []

        stylesheet_key, styles_css = await _discover_shared_stylesheet(ctx)
        if styles_css:
            blocks.extend(
                collect_external_stylesheet(
                    styles_css, origin=stylesheet_key or "bundle:asset:styles.css"
                )
            )

        for page in plan.pages:
            html = await ArtifactManager.load_artifact_as_string(ctx, page.bundle_artifact)
            if not html:
                continue
            blocks.extend(collect_inline_style_blocks(html, origin=page.bundle_artifact))
        return blocks

    def transform_placeholders(self, html: str) -> tuple[str, PhTransformResult]:
        """Run the deterministic ``.ph`` → ``<img>`` rewrite."""
        return transform_placeholders(html)

    async def extract_chrome_region(self, ctx, region: ChromeRegion) -> str:
        """Resolve the chrome subtree via the shared resilient helper.

        Tries the LLM's declared ``(source_artifact, selector)`` first;
        falls back across page bundles + per-role semantic selectors only
        when the declared choice misses. See
        ``base.extract_chrome_region_with_fallback`` for the full attempt
        order and the ``kngnrssf`` failure mode it rescues.
        """
        from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.base import (
            extract_chrome_region_with_fallback,
        )

        return await extract_chrome_region_with_fallback(ctx, region)


# ── Stylesheet discovery ──────────────────────────────────────────────────


async def _discover_shared_stylesheet(ctx) -> tuple[Optional[str], Optional[str]]:
    """Find the bundle's shared stylesheet by scanning staged asset keys.

    Returns ``(staged_key, css_text)``. When no ``.css`` asset is staged,
    returns ``(None, None)`` and the caller proceeds without a shared
    stylesheet (per-page inline ``<style>`` blocks still survive on their
    own).

    Resolution order:
      1. Preferred basenames in :data:`_PREFERRED_STYLES_BASENAMES` order.
      2. Any ``bundle:asset:*.css`` (first one found, sorted for determinism).
    """
    keys = await _list_artifact_keys(ctx)
    css_keys = sorted(
        k
        for k in keys
        if isinstance(k, str) and k.startswith("bundle:asset:") and k.lower().endswith(".css")
    )
    if not css_keys:
        return None, None

    by_basename: dict[str, str] = {}
    for key in css_keys:
        relpath = key[len("bundle:asset:") :]
        basename = os.path.basename(relpath).lower()
        # Keep first occurrence per basename (sorted order = deterministic).
        by_basename.setdefault(basename, key)

    chosen_key: Optional[str] = None
    for preferred in _PREFERRED_STYLES_BASENAMES:
        if preferred in by_basename:
            chosen_key = by_basename[preferred]
            break
    if chosen_key is None:
        # Fall back to the first .css asset overall.
        chosen_key = css_keys[0]

    text = await ArtifactManager.load_artifact_as_string(ctx, chosen_key)
    return chosen_key, text


async def _list_artifact_keys(ctx) -> list[str]:
    try:
        keys = await ctx.artifact_service.list_artifact_keys(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
        )
    except Exception:  # noqa: BLE001 — defensive: empty list is the safe default
        return []
    return list(keys or [])


# ── Babel-shell detection ─────────────────────────────────────────────────
#
# Claude Design exports an interactive React app as a Babel-in-browser shell:
# a thin HTML page with `<div id="root"/>` plus `<script type="text/babel">`
# tags pointing at sibling `.jsx` files (and/or carrying inline JSX). The
# rest of the import pipeline expects HTML pages whose body is the page
# content; a Babel shell's body is essentially empty until JavaScript
# mounts the React tree at runtime. Without explicit detection, the
# downstream html_to_tsx mechanical pipeline emits an empty wrapper
# (`<LightDOMContainer><div id="root"/></LightDOMContainer>`) and ships a
# blank page — the failure mode that motivated this whole feature.
#
# Detection is conjunctive across three signals (A AND B AND C). False
# positives ship empty TSX components today, so we want detection to be
# precise rather than recall-maximizing; an undetected Babel shell at
# worst preserves today's broken behavior.

_BABEL_SCRIPT_TYPE = "text/babel"
_REACT_CDN_RE = re.compile(
    r"react(-dom)?(@\d|\.production|\.development)", re.IGNORECASE
)
_BABEL_STANDALONE_NEEDLE = "@babel/standalone"
_JSX_LIKE_SRC_RE = re.compile(r"\.(jsx|tsx)(\?.*)?$", re.IGNORECASE)


@dataclass
class BabelShellManifest:
    """Outcome of ``detect_babel_shell``.

    Attributes:
        root_id: Value of the root mount node's ``id`` attribute, almost
            always ``"root"``. Captured for completeness — the JSX
            translator wraps the React tree in ``<LightDOMContainer>`` so
            the original mount-point id doesn't actually matter at
            runtime.
        jsx_sources: Relative paths from every ``<script type="text/babel"
            src="…">`` tag, in DOM (script-tag) order. These are the
            sibling ``.jsx``/``.tsx`` files the runner pairs against
            staged ``bundle:script:*`` keys.
        inline_babel_blocks: Bodies of every inline ``<script type=
            "text/babel">`` (no ``src`` attr), in DOM order. The Anima
            export pattern puts the ``function App()`` definition and the
            ``ReactDOM.render()`` bootstrap in such an inline block; the
            translator concatenates these AFTER external siblings so
            execution order matches Babel-in-browser.
        head_styles_css: Concatenated body of every ``<head><style>``
            block. Babel shells often carry global resets (``html, body
            { margin: 0 }``) the runtime needs; the runner forwards this
            into ``codefocus_style:theme.css`` via the existing layer
            pipeline.
    """

    root_id: str
    jsx_sources: list[str]
    inline_babel_blocks: list[str] = field(default_factory=list)
    head_styles_css: str = ""


def detect_babel_shell(html: str) -> Optional[BabelShellManifest]:
    """Decide whether ``html`` is a Babel-in-browser shell.

    Returns a populated :class:`BabelShellManifest` when ALL three signals
    fire, otherwise ``None``. The runner reads the manifest to drive the
    JSX translator path; ``None`` falls through to the existing HTML→TSX
    pipeline unchanged.

    Trigger conditions (conjunctive):

    * **A.** ``<body>`` contains exactly one ``<div id="root">…</div>``
      with no significant content outside it (only ``<script>`` tags and
      whitespace are tolerated as siblings).
    * **B.** At least one ``<script type="text/babel" src="*.jsx">`` (or
      ``.tsx``).
    * **C.** At least one ``<script src>`` matching the React/ReactDOM
      CDN URL pattern OR referencing ``@babel/standalone``.

    All three must hold. (A) alone false-positives on hand-written SPA
    shells whose components live in a `<script type="module" src=…>`
    bundle. (B) alone false-positives on dev hot-reload pages with inline
    babel snippets. (C) alone matches modern Vite exports that don't use
    the Babel shell pattern at all.
    """
    soup = BeautifulSoup(html or "", "html.parser")
    body = soup.body
    if body is None:
        return None

    root_id = _detect_solo_root_div(body)
    if root_id is None:
        return None  # Signal A failed.

    jsx_srcs: list[str] = []
    inline_blocks: list[str] = []
    has_react_cdn = False
    has_babel_standalone = False

    for script in soup.find_all("script"):
        src = (script.get("src") or "").strip()
        script_type = (script.get("type") or "").strip().lower()

        if src:
            if _REACT_CDN_RE.search(src):
                has_react_cdn = True
            if _BABEL_STANDALONE_NEEDLE in src:
                has_babel_standalone = True
            if script_type == _BABEL_SCRIPT_TYPE and _JSX_LIKE_SRC_RE.search(src):
                jsx_srcs.append(src)
        elif script_type == _BABEL_SCRIPT_TYPE:
            body_text = script.string or script.get_text() or ""
            stripped = body_text.strip()
            if stripped:
                inline_blocks.append(stripped)

    if not jsx_srcs:
        return None  # Signal B failed.
    if not (has_react_cdn or has_babel_standalone):
        return None  # Signal C failed.

    return BabelShellManifest(
        root_id=root_id,
        jsx_sources=jsx_srcs,
        inline_babel_blocks=inline_blocks,
        head_styles_css=_collect_head_styles(soup),
    )


def _detect_solo_root_div(body: Tag) -> Optional[str]:
    """Return the root ``id`` when ``body`` has exactly one ``<div id=…>``
    surrounded only by ``<script>`` siblings and whitespace.

    Returns ``None`` if the body has additional structural content (text,
    other divs, headings, etc.) — those signal a real HTML page, not a
    JS-mounted shell.
    """
    root_candidate: Optional[Tag] = None
    for child in body.children:
        if isinstance(child, str):
            if child.strip():  # non-whitespace text node disqualifies.
                return None
            continue
        if not isinstance(child, Tag):
            continue
        if child.name == "script":
            continue
        if child.name == "div" and child.get("id"):
            if root_candidate is not None:
                # More than one structural div — not a shell.
                return None
            root_candidate = child
            continue
        # Any other tag (header, main, p, etc.) means real content lives
        # in the body alongside the mount point.
        return None
    if root_candidate is None:
        return None
    # The mount div should itself be empty (or whitespace-only). A
    # populated root div would mean the page already has its content
    # baked in.
    if (root_candidate.string or "").strip():
        return None
    if any(isinstance(c, Tag) for c in root_candidate.children):
        return None
    root_id = root_candidate.get("id")
    return str(root_id) if root_id else None


def _collect_head_styles(soup: BeautifulSoup) -> str:
    """Concatenate every ``<head><style>`` body, double-newline separated.

    Empty string when there's no head or no <style> blocks.
    """
    head = soup.head
    if head is None:
        return ""
    blocks: list[str] = []
    for style in head.find_all("style"):
        text = style.string or style.get_text() or ""
        if text.strip():
            blocks.append(text.strip())
    return "\n\n".join(blocks)


def pair_script_artifact(
    manifest: BabelShellManifest,
    *,
    page_html_relpath: str,
    staged_keys: set[str],
) -> tuple[list[str], list[str]]:
    """Resolve ``manifest.jsx_sources`` to staged ``bundle:script:*`` keys.

    Args:
        manifest: detection result with ``jsx_sources`` (relative paths
            from ``<script src>`` tags in the page HTML).
        page_html_relpath: relpath of the parent HTML inside the bundle
            (e.g. ``"Bloop World.html"``). Used to resolve ``<script
            src>`` values that are relative to the page's directory.
        staged_keys: every staged artifact key (the runner's full keyset).

    Returns:
        ``(resolved_keys, missing_relpaths)`` — resolved_keys preserves
        the order of ``manifest.jsx_sources`` (siblings define components
        first; the inline App/bootstrap reads them later). When a sibling
        wasn't uploaded, its relpath lands in missing_relpaths so the
        runner can warn the user without aborting the whole import.

    External (``http://`` / ``https://``) script srcs are skipped — they
    can't be resolved against staged bundle entries; they're recorded in
    missing_relpaths so the user can see what was bypassed.
    """
    page_dir = os.path.dirname(page_html_relpath)
    resolved: list[str] = []
    missing: list[str] = []

    # Build a basename → key map for fuzzy matching when the <script src>
    # path doesn't line up exactly with the staged relpath. Common when
    # the user zips files at a different nesting depth than the HTML
    # page expects.
    script_keys = [k for k in staged_keys if k.startswith("bundle:script:")]
    by_basename: dict[str, list[str]] = {}
    for key in script_keys:
        rel = key[len("bundle:script:"):]
        by_basename.setdefault(os.path.basename(rel).lower(), []).append(key)

    for src in manifest.jsx_sources:
        clean = src.split("?", 1)[0].split("#", 1)[0].strip()
        if not clean:
            continue
        if clean.startswith(("http://", "https://", "//")):
            missing.append(src)
            continue

        # Resolve relative to the parent HTML's directory.
        if page_dir:
            relpath = os.path.normpath(os.path.join(page_dir, clean))
        else:
            relpath = os.path.normpath(clean)
        candidate_key = f"bundle:script:{relpath}"
        if candidate_key in staged_keys:
            resolved.append(candidate_key)
            continue

        # Direct path miss — fall back to basename match (single
        # candidate only; ambiguous matches surface as missing so the
        # user can disambiguate).
        basename = os.path.basename(clean).lower()
        candidates = by_basename.get(basename) or []
        if len(candidates) == 1:
            resolved.append(candidates[0])
        else:
            missing.append(clean)

    return resolved, missing


__all__ = [
    "BabelShellManifest",
    "ClaudeDesignHandler",
    "detect_babel_shell",
    "pair_script_artifact",
]
