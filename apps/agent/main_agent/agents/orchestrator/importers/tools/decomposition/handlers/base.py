"""``FormatHandler`` protocol + dispatch for decomposition handlers.

The runner calls a handler four times per import:

  1. ``collect_theme_sources(ctx, plan)`` — harvest ``--var`` declarations
     and Google Fonts URLs from the bundle's theme inputs (Stitch's
     ``<script id="tailwind-config">`` or Claude Design's external
     ``styles.css``). Returns ``ThemeSources``.
  2. ``collect_verbatim_css(ctx, plan)`` — return ordered ``CssBlock`` list
     destined for ``@layer exepad-app``. Stitch returns ``[]`` (utility-
     only). Claude Design returns ``styles.css`` plus every per-page inline
     ``<style>``.
  3. ``transform_placeholders(html)`` — apply the format-specific image
     injection. Claude Design rewrites ``.ph`` divs to ``<img>``. Stitch
     returns the input unchanged.
  4. ``extract_chrome_region(ctx, region)`` — load the chrome's source
     artifact, run the LLM-chosen selector, return the cleaned subtree.
     Both handler implementations call ``extract_chrome_region_with_fallback``
     below so a wrong-source-artifact / wrong-selector choice from the
     DesignImporter LLM doesn't abort the entire workflow.
"""

from __future__ import annotations

import structlog
from dataclasses import dataclass, field
from typing import Protocol

from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    ChromeRegion,
    DecompositionPlan,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.ph_transformer import (
    PhTransformResult,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.style_lifter import (
    CssBlock,
)
from main_agent.agents.utils.artifact_manager import ArtifactManager

logger = structlog.get_logger(__name__)


class HandlerError(RuntimeError):
    """Raised when a handler cannot satisfy a runner request.

    Common cases: a referenced ``bundle:*`` artifact is missing, a
    ``ChromeRegion.selector`` matches nothing in the source artifact, the
    Stitch tailwind-config script is malformed.
    """


# Per-role fallback CSS selectors used by the chrome EXTRACT path when the
# LLM-supplied ``ChromeRegion.selector`` misses on the declared
# ``source_artifact``. Conservative by design — only matches shapes that are
# almost always site chrome.
#
# Distinct from runner.py's strip-side fallbacks: extract needs WIDER
# coverage (we want to find the chrome anywhere it might live), strip needs
# NARROWER coverage (we don't want to delete decorative in-body navs/footers).
# Each path owns its own table by design.
CHROME_FALLBACK_SELECTORS: dict[str, tuple[str, ...]] = {
    "header": ("header", "nav.nav", "nav[class*='fixed top-0']"),
    "footer": ("footer", "footer.footer", "div[class*='footer']"),
    "sidebar": ("aside", "nav[class*='sidebar']"),
}


def chrome_fallback_selectors(role: str) -> tuple[str, ...]:
    """Per-role fallback selectors. Empty tuple for unknown roles."""
    return CHROME_FALLBACK_SELECTORS.get(role, ())


async def extract_chrome_region_with_fallback(ctx, region: ChromeRegion) -> str:
    """Apply ``region.selector`` with multi-layer fallbacks.

    Attempt order (first match wins):

      1. LLM's declared ``(source_artifact, selector)``. Happy path — when
         the LLM chose correctly this is the only attempt.
      2. ``region.source_artifact`` × per-role fallback selectors.
      3. Every staged ``bundle:html:*`` page artifact × the original selector.
      4. Every staged page artifact × per-role fallback selectors.

    The shared simple-case Stitch + Claude Design chrome-extract path used
    to hard-fail on the first miss at the original ``source_artifact``.
    App ``kngnrssf`` (chick-farm Claude Design, 2026-05-17): LLM emitted
    ``source_artifact: "bundle:doc:partials.html", selector: "footer.footer"``
    but partials.html contained only ``<nav>`` — the footer lived inline in
    each per-page bundle. Selector was valid CSS, source artifact was wrong;
    the workflow aborted after 685s and $0.124 with no recovery. This helper
    transparently locates the footer in any page bundle and proceeds.

    Logs a structlog warning at level ``info`` when a fallback fires so
    observability surfaces the rescue (we want to fix the DesignImporter's
    selector choice in future runs, not just paper over it forever).

    Raises ``HandlerError`` only after exhausting every fallback.
    """
    from main_agent.agents.orchestrator.importers.tools.decomposition.html_cleaner import (
        HtmlCleanerError,
        extract_node,
    )

    declared_source = region.source_artifact
    declared_selector = region.selector

    raw = await ArtifactManager.load_artifact_as_string(ctx, declared_source)
    if not raw:
        # Even when the declared source is missing we can still try page
        # bundles before giving up. Capture the empty state and fall
        # through to the fan-out below.
        logger.info(
            "chrome_extract_declared_source_missing",
            role=region.role,
            source_artifact=declared_source,
            selector=declared_selector,
        )

    # ── Attempt 1: LLM's declared choice (happy path) ────────────────
    if raw:
        try:
            return extract_node(raw, declared_selector)
        except HtmlCleanerError:
            pass  # fall through to fallback layers

    fallbacks = chrome_fallback_selectors(region.role)
    attempts: list[tuple[str, str]] = []
    # Track every (source, selector) tried so the eventual error message
    # is diagnostic, not generic.
    attempts.append((declared_source, declared_selector))

    # ── Attempt 2: declared source × fallback selectors ──────────────
    if raw:
        for fb_sel in fallbacks:
            if fb_sel == declared_selector:
                continue
            attempts.append((declared_source, fb_sel))
            try:
                result = extract_node(raw, fb_sel)
            except HtmlCleanerError:
                continue
            logger.info(
                "chrome_extract_fallback_selector",
                role=region.role,
                source_artifact=declared_source,
                declared_selector=declared_selector,
                resolved_selector=fb_sel,
            )
            return result

    # ── Attempt 3 + 4: page bundles × (original selector, then fallbacks) ──
    page_artifacts = await _list_page_html_artifacts(ctx)
    for page_artifact in page_artifacts:
        if page_artifact == declared_source:
            continue  # already tried in attempt 1
        page_raw = await ArtifactManager.load_artifact_as_string(ctx, page_artifact)
        if not page_raw:
            continue

        attempts.append((page_artifact, declared_selector))
        try:
            result = extract_node(page_raw, declared_selector)
        except HtmlCleanerError:
            result = None
        if result is not None:
            logger.info(
                "chrome_extract_fallback_source",
                role=region.role,
                declared_source_artifact=declared_source,
                declared_selector=declared_selector,
                resolved_source_artifact=page_artifact,
                resolved_selector=declared_selector,
            )
            return result

        for fb_sel in fallbacks:
            if fb_sel == declared_selector:
                continue
            attempts.append((page_artifact, fb_sel))
            try:
                result = extract_node(page_raw, fb_sel)
            except HtmlCleanerError:
                continue
            logger.info(
                "chrome_extract_fallback_source_and_selector",
                role=region.role,
                declared_source_artifact=declared_source,
                declared_selector=declared_selector,
                resolved_source_artifact=page_artifact,
                resolved_selector=fb_sel,
            )
            return result

    # Exhausted every attempt — raise with diagnostic detail.
    attempt_summary = ", ".join(
        f"{src!r}+{sel!r}" for src, sel in attempts[:8]
    )
    if len(attempts) > 8:
        attempt_summary += f", … ({len(attempts)} total)"
    raise HandlerError(
        f"Chrome selector {declared_selector!r} did not match in "
        f"{declared_source!r} (role={region.role!r}); fallback search "
        f"across {len(page_artifacts)} page artifact(s) × "
        f"{len(fallbacks)} fallback selector(s) also produced no match. "
        f"Tried: {attempt_summary}"
    )


async def _list_page_html_artifacts(ctx) -> list[str]:
    """Return every staged ``bundle:html:*`` artifact key, sorted.

    Used by the chrome-extract fallback to discover candidate sources
    when the LLM-declared source doesn't contain the requested chrome.

    Uses the InvocationContext-native ``artifact_service.list_artifact_keys``
    pattern (same shape as ``runner._list_artifact_keys`` and
    ``claude_design._list_artifact_keys``). The previous implementation
    called ``ArtifactManager.list_artifacts(ctx)`` which is typed for
    ``CallbackContext`` and throws ``'InvocationContext' object has no
    attribute 'list_artifacts'`` on the contexts the decomposition runner
    actually passes — the defensive ``except`` then masked the bug by
    returning ``[]``, leaving the chrome fallback to "search across 0
    page artifact(s)" and surface a misleading diagnostic (production
    app u0j2m40o, 2026-05-19).
    """
    try:
        keys = await ctx.artifact_service.list_artifact_keys(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
        )
    except Exception:  # noqa: BLE001
        # ADK artifact services may not support listing in every transport;
        # fail-open so the helper just doesn't get fan-out attempts.
        return []
    if not keys:
        return []
    return sorted(k for k in keys if isinstance(k, str) and k.startswith("bundle:html:"))


@dataclass
class ThemeSources:
    """Output of ``FormatHandler.collect_theme_sources``.

    Attributes:
        root_vars: ``{"--barn": "#A8472A", ...}``. The runner mirrors these
            into ``@theme`` so verbatim ``var(--*)`` references in the
            layer block resolve.
        google_font_imports: ``["https://fonts.googleapis.com/css2?...", ...]``
            already deduplicated, in cascade order.
        stitch_tailwind_config: When the bundle is Stitch and a
            ``<script id="tailwind-config">`` was parsed successfully, the
            decoded config dict (``{"theme": {"extend": {"colors": {...},
            ...}}}``). Used by the runner to pre-fill the LLM's M3 mapping
            with sensible defaults. ``None`` for Claude Design.
    """

    root_vars: dict[str, str] = field(default_factory=dict)
    google_font_imports: list[str] = field(default_factory=list)
    stitch_tailwind_config: dict | None = None


class FormatHandler(Protocol):
    """Handler protocol — implementations live in this package."""

    format: str

    async def collect_theme_sources(self, ctx, plan: DecompositionPlan) -> ThemeSources: ...

    async def collect_verbatim_css(self, ctx, plan: DecompositionPlan) -> list[CssBlock]: ...

    def transform_placeholders(self, html: str) -> tuple[str, PhTransformResult]: ...

    async def extract_chrome_region(self, ctx, region: ChromeRegion) -> str: ...


def select_handler(skill_context: dict) -> "FormatHandler":
    """Pick the right handler off the bundle's staged skill context.

    Args:
        skill_context: Value of ``design_bundle_skill_context`` in session
            state. The stager writes ``skill_name`` ("claude-design-importer"
            / "stitch-importer") and (for Claude Design) an optional
            ``mode`` field.

    Raises:
        HandlerError: when ``skill_name`` is missing or Claude Design with
            the obsolete single-canvas mode.
    """
    # Local imports to avoid a circular import at package load time —
    # base.py is imported by the package __init__ before the concrete
    # handler modules are.
    from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.claude_design import (
        ClaudeDesignHandler,
    )
    from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.stitch import (
        StitchHandler,
    )

    skill_name = (skill_context or {}).get("skill_name", "")
    if skill_name == "stitch-importer":
        return StitchHandler()
    if skill_name == "claude-design-importer":
        mode = (skill_context or {}).get("mode")
        if mode == "single_canvas":
            raise HandlerError(
                "Claude Design single-canvas bundles are obsolete. Please "
                "re-export the design as a multi-page bundle."
            )
        return ClaudeDesignHandler()
    raise HandlerError(
        f"Unknown design bundle skill: {skill_name!r}. Expected "
        "'claude-design-importer' or 'stitch-importer'."
    )
