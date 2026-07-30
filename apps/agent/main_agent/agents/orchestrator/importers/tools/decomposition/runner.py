"""Deterministic decomposition runner — the entry point.

Called from the workflow immediately after the DesignImporter LLM finishes
emitting its ``DecompositionPlan``. The runner:

  1. Validates that every plan-referenced ``bundle:*`` artifact key really
     exists in the artifact store.
  2. Picks the right ``FormatHandler`` off ``design_bundle_skill_context``.
  3. Loads each ``bundle:html:*`` page, runs the handler's placeholder
     transformer, lifts ``<style>`` blocks, and emits one
     ``content:<slug>:page.html`` per ``PageMapping``. For Babel-shell
     pages (Claude Design exports of runnable React apps), ALSO emits
     ``content:<slug>:script.jsx`` carrying the concatenated React
     source — sibling JSX files in ``<script src>`` order, then any
     inline ``<script type="text/babel">`` blocks. Identical script
     blobs across pages are deduped by sha256 (so two pages sharing one
     game.jsx ship one TSX component, not two).
  4. Extracts each ``ChromeRegion`` and emits ``content:main:<role>.html``.
     Optionally deletes the same selector from every per-page output so
     chrome is not duplicated when the page also inlines it.
  5. Builds ``codefocus_style:theme.css`` with the bootstrap preamble,
     Google Fonts ``@import`` lines, an ``@theme`` block carrying both
     M3-mapped tokens AND every original ``--var``, and an
     ``@layer exepad-app`` block carrying every preserved CSS rule.
  6. Saves ``design_import/{navigation,backend-intent,notes}.{json,md}``.
  7. Synthesizes a Creator-compatible plan whose ``component_plans``
     reference the deterministically-emitted artifacts and whose
     ``design_system`` colors match the resolved theme tokens. Other
     fields (reasoning, app_name, security_plan, favicon_svg,
     design_style) are kept verbatim from the LLM. ``building_plan`` /
     ``app_building_plan`` are NOT in the LLM schema — the runner sets
     concise per-component "translate the imported HTML" hints, and the
     workflow inlines the app-wide plan from the LLM-saved
     ``plan:app.md`` artifact via the plan-artifact materializer.
  8. Returns a ``DecompositionResult`` with counts.

The image materializer (``materialize_design_import_images``) runs
AFTER this pass and rewrites every ``<img src>`` to a stable
``data-asset-relpath`` plus an asset manifest.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Optional

import structlog
from google import genai

from main_agent.agents.orchestrator.importers.tools.decomposition.handlers import (
    HandlerError,
    select_handler,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.handlers.claude_design import (
    detect_babel_shell,
    pair_script_artifact,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.html_cleaner import (
    HtmlCleanerError,
    extract_body,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    DecompositionPlan,
    PageMapping,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.style_lifter import (
    build_theme_css,
    lift_styles,
)
from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.services.theme.font_aliases import (
    alias_aware_font_lookup,
    compute_font_aliases,
)

logger = structlog.get_logger(__name__)


# ── Allow-list ────────────────────────────────────────────────────────────
# These were the LLM-facing tool-validation invariants in the old
# ``save_design_artifact``. Now they are post-condition asserts the runner
# enforces on its own outputs. The set is the same.

import re  # noqa: E402

_CONTENT_PAGE_RE = re.compile(r"^content:([a-z0-9][a-z0-9-]*|):page\.html$")
# Babel-shell pages emit a sibling JSX content artifact alongside their HTML.
# The same kebab-slug rule applies; the .jsx suffix distinguishes the script
# from the page body.
_CONTENT_SCRIPT_RE = re.compile(r"^content:([a-z0-9][a-z0-9-]*|):script\.jsx$")
# Phase 2 per-module Babel-shell emission: one artifact per sibling JSX,
# located at content:<slug>:scripts/<modulename>.jsx (kebab slug, then a
# subpath under scripts/).
_CONTENT_SCRIPT_MODULE_RE = re.compile(
    r"^content:([a-z0-9][a-z0-9-]*|):scripts/[A-Za-z_][A-Za-z0-9_]*\.jsx$"
)
_ALLOWED_EXACT: frozenset[str] = frozenset(
    {
        "codefocus_style:theme.css",
        "content:main:header.html",
        "content:main:sidebar.html",
        "content:main:footer.html",
        "design_import/navigation.json",
        "design_import/backend-intent.json",
        "design_import/notes.md",
    }
)


def _is_allowed_output(filename: str) -> bool:
    return (
        filename in _ALLOWED_EXACT
        or bool(_CONTENT_PAGE_RE.match(filename))
        or bool(_CONTENT_SCRIPT_RE.match(filename))
        or bool(_CONTENT_SCRIPT_MODULE_RE.match(filename))
    )


@dataclass
class DecompositionResult:
    """Outcome of one decomposition run."""

    emitted_artifact_keys: list[str] = field(default_factory=list)
    synthesized_creator_plan: dict = field(default_factory=dict)
    pages_emitted: int = 0
    chrome_emitted: int = 0
    placeholders_transformed: int = 0
    unmatched_placeholder_labels: list[str] = field(default_factory=list)
    notes_with_appended_warnings: str = ""


def _is_all_babel_shell(plan: DecompositionPlan) -> bool:
    """Return True when EVERY page in the plan is a Babel-shell.

    Chrome (header / sidebar / footer) in Babel-shell bundles lives in
    sibling JSX files (e.g. ``shell.jsx``) concatenated at runtime, so
    CSS selectors cannot find it in any ``bundle:html:*`` artifact.
    Phase 4 chrome extraction must be skipped for these bundles —
    the translated TSX contains the chrome inline and the downstream
    digest + assembly path is fail-soft on missing chrome artifacts.

    Empty page list ⇒ False (defensive: don't skip on a degenerate plan).
    """
    if not plan.pages:
        return False
    return all(p.script_mode == "babel-shell" for p in plan.pages)


# ── Public entry point ────────────────────────────────────────────────────


async def run_design_decomposition(
    ctx,
    *,
    plan: DecompositionPlan,
    skill_context: dict,
) -> DecompositionResult:
    """Run the deterministic pass.

    Raises ``HandlerError`` on plan-validation failures, missing source
    artifacts, or chrome selectors that don't match. The workflow turns
    these into pipeline errors with FATAL severity.
    """
    handler = select_handler(skill_context)

    # ── Phase 1: validate plan against staged keys ────────────────────
    artifact_keys = await _list_artifact_keys(ctx)
    _validate_plan(plan, staged_keys=artifact_keys)

    # ── Phase 2: theme sources from handler ───────────────────────────
    theme_sources = await handler.collect_theme_sources(ctx, plan)
    layer_blocks = await handler.collect_verbatim_css(ctx, plan)
    lifted = lift_styles(layer_blocks)

    # Mirror EVERY source --var into @theme so verbatim var(--*) refs in
    # the layer block resolve. The handler's tailwind-config flatten and
    # the lifter's :root harvest may overlap; merge with handler tokens
    # winning (they're the LLM-curated set).
    original_tokens: dict[str, str] = dict(lifted.root_vars)
    original_tokens.update(theme_sources.root_vars)

    # The LLM picks 4 M3 pillars (primary/secondary/surface/error). The
    # runner derives the remaining 26 tokens from those four via
    # compute_m3_palette. No fabricated defaults — each pillar must
    # resolve to a real bundle color or an explicit hex literal.
    m3_tokens = _resolve_pillars(plan, original_tokens)

    # Symmetric font-alias derivation — fills in the missing side of every
    # canonical pair (headline ↔ heading, body ↔ sans). A bundle that
    # only declares ``--font-heading`` gets ``--font-headline: var(--font-heading)``
    # added, and vice versa. Without this, the M3-named class the LLM
    # emits (``font-headline``) had no token to bind to whenever the
    # bundle used the Tailwind/runtime names — the failure shape that
    # killed the Onix Studio HomeContent build (2026-04-30).
    #
    # Keeps the existing ``var()`` aliasing so the original bundle font
    # is preserved verbatim. We add a NAME, not a VALUE.
    combined_font_tokens = {**original_tokens, **m3_tokens}
    runtime_font_aliases = compute_font_aliases(combined_font_tokens)
    extra_theme_lines = [
        *(plan.theme.extra_theme_lines or []),
        *runtime_font_aliases,
    ]

    theme_css = build_theme_css(
        google_font_imports=theme_sources.google_font_imports,
        m3_tokens=m3_tokens,
        original_tokens=original_tokens,
        extra_theme_lines=extra_theme_lines,
        layer_text=lifted.layer_text,
        base_layer_text=lifted.base_layer_text,
    )

    # Post-condition: theme.css must carry every M3 token the downstream
    # palette resolver requires. Localizes the bug here instead of
    # surfacing it four steps later in load_and_persist_theme_palette.
    _assert_theme_css_complete(theme_css)

    # ── Phase 3: per-page processing ──────────────────────────────────
    # Strip the chrome regions from every page so the shared MainHeader /
    # MainFooter doesn't render twice. Use the LLM-supplied selector AS
    # PRIMARY, then per-role semantic fallbacks. Past regression: app
    # rdzn62gx (2026-05-16) — LLM emitted `selector: "header"` because
    # the home page used <header>, but About/Products/Contact pages used
    # top-level <nav> for the same chrome role; the literal selector
    # silently no-op'd on those three pages and shipped the source nav
    # alongside the shared MainHeader. Fallbacks are conservative —
    # `nav[class*='fixed top-0']` only matches site-chrome-shaped sticky
    # navs, not decorative body-level <nav> elements.
    delete_selectors: list[str] = []
    for region in plan.chrome:
        if not region.delete_from_pages:
            continue
        if region.selector:
            delete_selectors.append(region.selector)
        for fallback in _chrome_fallback_selectors(region.role):
            if fallback not in delete_selectors:
                delete_selectors.append(fallback)

    placeholders_transformed = 0
    unmatched_labels: list[str] = []
    emitted_keys: list[str] = []
    # Babel-shell state accumulated across pages.
    babel_dedupe_by_hash: dict[str, str] = {}  # blob sha256 → output_artifact
    page_script_artifacts: dict[str, str] = {}  # canonical slug → script artifact key
    # Phase 2 per-module emission: canonical slug → list of
    # {name, artifact, is_entry} dicts (one per sibling JSX + inline).
    page_script_modules: dict[str, list[dict]] = {}
    missing_siblings_by_page: dict[str, list[str]] = {}  # canonical slug → relpaths

    for page in plan.pages:
        cleaned_html, ph_result, raw_html = await _process_page(
            ctx,
            page=page,
            handler=handler,
            extra_remove_selectors=delete_selectors,
        )
        await _save_text_artifact(ctx, page.output_artifact, cleaned_html, mime="text/html")
        emitted_keys.append(page.output_artifact)
        placeholders_transformed += ph_result.transformed
        unmatched_labels.extend(ph_result.unmatched_labels)

        # Babel-shell pages also produce a content:<slug>:script.jsx
        # artifact (or reuse one via dedupe). Detection is automatic — the
        # LLM's PageMapping.script_artifact is informational only at this
        # stage; PR 3 teaches the importer skill to set it for telemetry.
        emission = await _emit_babel_shell_artifact(
            ctx,
            page=page,
            raw_html=raw_html,
            staged_keys=artifact_keys,
            dedupe_by_hash=babel_dedupe_by_hash,
        )
        if emission is not None:
            slug_key = page.page_slug.strip("/")
            if emission.output_artifact:
                page_script_artifacts[slug_key] = emission.output_artifact
                # Only add to emitted_keys when this page actually saved a
                # NEW artifact — dedupe hits reuse a previously-emitted key.
                if emission.deduped_against is None:
                    emitted_keys.append(emission.output_artifact)
            if emission.per_module_artifacts:
                page_script_modules[slug_key] = emission.per_module_artifacts
                # Newly-saved per-module artifacts; the dedupe map's
                # value tells us which were freshly written this page.
                seen_in_emit: set[str] = set()
                for m in emission.per_module_artifacts:
                    key = m["artifact"]
                    if key in seen_in_emit:
                        continue
                    seen_in_emit.add(key)
                    if key not in emitted_keys:
                        emitted_keys.append(key)
            if emission.missing_siblings:
                missing_siblings_by_page[slug_key] = list(emission.missing_siblings)

    # ── Phase 4: chrome regions ───────────────────────────────────────
    # Babel-shell bundles render header/sidebar/footer from sibling JSX
    # files (e.g. shell.jsx) that get concatenated at runtime; the chrome
    # never appears in static HTML, so CSS selectors can't extract it.
    # When EVERY page is Babel-shell, skip Phase 4 entirely — the
    # translated TSX contains the chrome inline and the downstream
    # bundle_digest/assembly path is fail-soft on missing
    # content:main:{header,sidebar,footer}.html artifacts. SKILL.md
    # instructs the DesignImporter to emit chrome=[] for these bundles;
    # this guard is the load-bearing safety net for when the LLM still
    # emits a chrome region anyway (production app u0j2m40o, 2026-05-19,
    # crashed Phase 1.5 on a sidebar selector that didn't exist in HTML).
    all_babel_shell = _is_all_babel_shell(plan)
    if all_babel_shell and plan.chrome:
        logger.warning(
            "babel_shell_chrome_regions_dropped",
            count=len(plan.chrome),
            regions=[
                {
                    "role": r.role,
                    "source_artifact": r.source_artifact,
                    "selector": r.selector,
                }
                for r in plan.chrome
            ],
        )
    elif not all_babel_shell:
        for region in plan.chrome:
            cleaned_chrome = await handler.extract_chrome_region(ctx, region)
            await _save_text_artifact(
                ctx, region.output_artifact, cleaned_chrome, mime="text/html"
            )
            emitted_keys.append(region.output_artifact)

    # ── Phase 5: theme.css ────────────────────────────────────────────
    await _save_text_artifact(ctx, "codefocus_style:theme.css", theme_css, mime="text/css")
    emitted_keys.append("codefocus_style:theme.css")

    # ── Phase 6: metadata ─────────────────────────────────────────────
    notes_text = _augment_notes(
        plan.notes,
        unmatched_labels=unmatched_labels,
        missing_siblings_by_page=missing_siblings_by_page,
    )
    await _save_text_artifact(
        ctx,
        "design_import/notes.md",
        notes_text or "No notes.\n",
        mime="text/markdown",
    )
    emitted_keys.append("design_import/notes.md")

    if plan.navigation:
        await _save_json_artifact(ctx, "design_import/navigation.json", plan.navigation)
        emitted_keys.append("design_import/navigation.json")

    if plan.backend_intent is not None:
        intent_dict = plan.backend_intent.model_dump(exclude_none=True)
        if intent_dict.get("models") or intent_dict.get("handlers") or intent_dict.get("seeds"):
            await _save_json_artifact(ctx, "design_import/backend-intent.json", intent_dict)
            emitted_keys.append("design_import/backend-intent.json")

    # ── Phase 7: synthesize creator_plan ──────────────────────────────
    synthesized = _synthesize_creator_plan(
        plan,
        m3_tokens=m3_tokens,
        fonts=_pick_fonts(m3_tokens, original_tokens),
        page_script_artifacts=page_script_artifacts,
        page_script_modules=page_script_modules,
    )

    # ── Phase 8: post-condition assertions ────────────────────────────
    for key in emitted_keys:
        if not _is_allowed_output(key):
            raise HandlerError(
                f"Runner emitted disallowed artifact key: {key!r}. This is a "
                "bug in the runner; check ``_ALLOWED_EXACT`` / ``_CONTENT_PAGE_RE``."
            )

    logger.info(
        "design_decomposition_done",
        format=plan.format,
        pages=len(plan.pages),
        chrome=len(plan.chrome),
        placeholders=placeholders_transformed,
        unmatched=len(unmatched_labels),
        artifacts=len(emitted_keys),
    )

    return DecompositionResult(
        emitted_artifact_keys=emitted_keys,
        synthesized_creator_plan=synthesized,
        pages_emitted=len(plan.pages),
        chrome_emitted=len(plan.chrome),
        placeholders_transformed=placeholders_transformed,
        unmatched_placeholder_labels=unmatched_labels,
        notes_with_appended_warnings=notes_text,
    )


# ── Internals ─────────────────────────────────────────────────────────────


async def _list_artifact_keys(ctx) -> set[str]:
    keys = await ctx.artifact_service.list_artifact_keys(
        session_id=ctx.session.id,
        user_id=ctx.session.user_id,
        app_name=ctx.session.app_name,
    )
    return set(keys or [])


def _validate_plan(plan: DecompositionPlan, *, staged_keys: set[str]) -> None:
    """Reject early if the LLM referenced non-existent or malformed keys.

    This is the LLM's only structural responsibility — every other field is
    either free-form text (LLM's choice) or auto-derived. Make sure no
    silent surprises sneak through.
    """
    seen_outputs: set[str] = set()
    seen_slugs: set[str] = set()

    for page in plan.pages:
        if page.bundle_artifact not in staged_keys:
            raise HandlerError(
                f"Page {page.page_slug or '<home>'} references missing "
                f"bundle artifact: {page.bundle_artifact!r}. Staged keys: "
                f"{sorted(k for k in staged_keys if k.startswith('bundle:'))}"
            )
        if not _is_allowed_output(page.output_artifact):
            raise HandlerError(
                f"Page output artifact does not match the allow-list: " f"{page.output_artifact!r}"
            )
        if page.output_artifact in seen_outputs:
            raise HandlerError(f"Duplicate output artifact: {page.output_artifact!r}")
        seen_outputs.add(page.output_artifact)
        if page.page_slug in seen_slugs:
            raise HandlerError(f"Duplicate page slug: {page.page_slug!r}")
        seen_slugs.add(page.page_slug)

        # When a page declares a Babel-shell script artifact, it must point
        # at a real bundle:script:* key. Wrong-namespace references are a
        # common LLM failure mode — surface them with a useful diagnostic
        # listing the staged scripts that ARE available.
        #
        # script_mode WITHOUT script_artifact is accepted: on a multi-page
        # Babel-shell where many sibling JSX files load through one HTML
        # via internal routing (useState("page")) there is no honest 1:1
        # slug→script mapping. The runner self-detects sibling scripts via
        # `pair_script_artifact`, so mode-only is a valid telemetry signal.
        # script_artifact WITHOUT script_mode is still rejected — that one
        # IS half-formed (you've named a script file but not declared what
        # to do with it).
        has_artifact = page.script_artifact is not None
        has_mode = page.script_mode is not None
        if has_artifact and not has_mode:
            raise HandlerError(
                f"Page {page.page_slug or '<home>'}: script_artifact set "
                f"without script_mode (got "
                f"script_artifact={page.script_artifact!r}, "
                f"script_mode={page.script_mode!r}). Set script_mode="
                f"'babel-shell' or drop script_artifact."
            )
        if has_artifact:
            if not page.script_artifact.startswith("bundle:script:"):
                raise HandlerError(
                    f"Page {page.page_slug or '<home>'}: script_artifact "
                    f"must reference a bundle:script:* key, got "
                    f"{page.script_artifact!r}."
                )
            if page.script_artifact not in staged_keys:
                staged_scripts = sorted(
                    k for k in staged_keys if k.startswith("bundle:script:")
                )
                raise HandlerError(
                    f"Page {page.page_slug or '<home>'} references missing "
                    f"script artifact: {page.script_artifact!r}. "
                    f"Staged scripts: {staged_scripts}"
                )

    for region in plan.chrome:
        if region.source_artifact not in staged_keys:
            raise HandlerError(
                f"Chrome region {region.role!r} references missing source "
                f"artifact: {region.source_artifact!r}"
            )
        if not _is_allowed_output(region.output_artifact):
            raise HandlerError(
                f"Chrome output artifact does not match the allow-list: "
                f"{region.output_artifact!r}"
            )
        if region.output_artifact in seen_outputs:
            raise HandlerError(f"Duplicate output artifact: {region.output_artifact!r}")
        seen_outputs.add(region.output_artifact)


async def _process_page(
    ctx,
    *,
    page: PageMapping,
    handler,
    extra_remove_selectors: list[str],
) -> tuple[str, Any, str]:
    """Load → transform placeholders → extract body.

    Returns ``(cleaned_html, ph_result, raw_html)``. The raw HTML is
    returned alongside so the caller can run Babel-shell detection on
    the original document — placeholder transformation and body
    extraction strip information (script tags, head metadata) that the
    JSX path needs.
    """
    raw = await ArtifactManager.load_artifact_as_string(ctx, page.bundle_artifact)
    if not raw:
        raise HandlerError(f"Bundle artifact loaded as empty: {page.bundle_artifact!r}")

    transformed_html, ph_result = handler.transform_placeholders(raw)

    try:
        cleaned = extract_body(
            transformed_html,
            extra_remove_selectors=extra_remove_selectors or None,
        )
    except HtmlCleanerError as exc:
        raise HandlerError(
            f"Cleaning {page.bundle_artifact!r} produced empty output: {exc}"
        ) from exc

    return cleaned, ph_result, raw


# ── Babel-shell script artifact emission ──────────────────────────────────


# Phase 2 per-module flag. When set to a truthy value in the agent's
# environment, each Babel-shell page's sibling JSX files become their
# own content artifacts (and downstream codefocus_module:*.tsx
# artifacts) instead of being concatenated into a single
# content:<slug>:script.jsx blob. The deploy-time esbuild bundle
# (--bundle=true --external:react) rolls them back into one JS for the
# runtime, so the runtime stays unchanged.
_PER_MODULE_ENV_VAR = "BABEL_SHELL_PER_MODULE"


def _per_module_enabled() -> bool:
    """True iff the per-module Babel-shell emission flag is on."""
    import os as _os
    return _os.environ.get(_PER_MODULE_ENV_VAR, "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


@dataclass
class _BabelShellEmission:
    """Outcome of running the Babel-shell path on one page.

    ``output_artifact`` is the ``content:<slug>:script.jsx`` key the
    component_plan synthesizer should bind to ``source_jsx_artifact``.
    On dedupe hits, this points at the artifact emitted for an earlier
    page with an identical script blob.

    ``missing_siblings`` accumulates the relpaths of ``<script src=>``
    JSX files the user referenced but didn't upload — surfaced in
    notes.md so the soft-fail degradation is visible.
    """

    output_artifact: str
    missing_siblings: list[str] = field(default_factory=list)
    deduped_against: Optional[str] = None  # set when this page reused another's artifact
    # Phase 2 per-module emission: when populated, one entry per
    # sibling JSX file. Each dict carries:
    #   {"name": "Charts", "artifact": "content:<slug>:scripts/Charts.jsx",
    #    "is_entry": False}
    # ``output_artifact`` above stays empty in this mode (the entry's
    # artifact is the one with is_entry=True). Empty list means
    # legacy single-artifact mode was used.
    per_module_artifacts: list[dict] = field(default_factory=list)


def _bundle_relpath_from_artifact(bundle_html_artifact: str) -> str:
    """Strip the ``bundle:html:`` prefix to recover the archive relpath."""
    prefix = "bundle:html:"
    if bundle_html_artifact.startswith(prefix):
        return bundle_html_artifact[len(prefix):]
    return bundle_html_artifact


def _content_script_artifact_key(page: PageMapping) -> str:
    """Compute the ``content:<slug>:script.jsx`` key for a page."""
    slug = page.page_slug.strip("/")
    return f"content:{slug}:script.jsx"


def _concat_babel_sources(
    *,
    sibling_chunks: list[tuple[str, str]],
    inline_chunks: list[tuple[str, str]],
) -> tuple[str, str]:
    """Concatenate sibling JSX bodies + inline blocks with origin banners.

    Args:
        sibling_chunks: ``(banner_label, body)`` per external sibling, in
            ``<script src>`` tag order.
        inline_chunks: ``(banner_label, body)`` per inline ``<script
            type="text/babel">`` block, in DOM order.

    Returns ``(text, sha256_hex)`` where the hash is computed over the
    UTF-8 bytes of the final text. Used by the dedupe map.
    """
    parts: list[str] = []
    for label, body in sibling_chunks:
        parts.append(f"// === {label} ===\n{body.rstrip()}\n")
    for label, body in inline_chunks:
        parts.append(f"// === {label} ===\n{body.rstrip()}\n")
    text = "\n".join(parts)
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    return text, digest


async def _emit_babel_shell_artifact(
    ctx,
    *,
    page: PageMapping,
    raw_html: str,
    staged_keys: set[str],
    dedupe_by_hash: dict[str, str],
) -> Optional[_BabelShellEmission]:
    """Detect Babel shell, concat siblings + inline blocks, save the artifact.

    Returns ``None`` when the page is not a Babel shell (caller falls
    back to the standard HTML→TSX pipeline). Returns a populated
    :class:`_BabelShellEmission` otherwise — even on dedupe hits, where
    no new artifact is saved but the page still gets its
    ``content:<slug>:script.jsx`` key pointing at the prior emission.

    The detector is run on every page. The LLM's ``page.script_artifact``
    is currently informational; the runner self-detects so PR 2 lands
    without depending on the skill markdown changes in PR 3.
    """
    manifest = detect_babel_shell(raw_html)
    if manifest is None:
        return None

    page_html_relpath = _bundle_relpath_from_artifact(page.bundle_artifact)
    resolved_keys, missing_siblings = pair_script_artifact(
        manifest,
        page_html_relpath=page_html_relpath,
        staged_keys=staged_keys,
    )

    # Load each sibling's bytes in <script src> order. Skip any that
    # somehow lost their staging between detection and load (defensive).
    sibling_chunks: list[tuple[str, str]] = []
    for key in resolved_keys:
        body = await ArtifactManager.load_artifact_as_string(ctx, key)
        if not body:
            missing_siblings.append(key[len("bundle:script:"):])
            continue
        relpath = key[len("bundle:script:"):]
        sibling_chunks.append((relpath, body))

    inline_chunks: list[tuple[str, str]] = [
        (f"[inline #{i + 1}] from {page_html_relpath}", body)
        for i, body in enumerate(manifest.inline_babel_blocks)
    ]

    if not sibling_chunks and not inline_chunks:
        # All siblings missing AND no inline blocks → nothing to translate.
        # Soft-fail: skip emission, downstream html_to_tsx will still
        # produce the empty <div id="root"/> shell. The notes section will
        # tell the user why.
        logger.warning(
            "babel_shell_no_sources_resolved",
            page=page.page_slug or "<home>",
            missing=missing_siblings,
        )
        return _BabelShellEmission(
            output_artifact="",
            missing_siblings=missing_siblings,
        )

    # Always emit the legacy concat artifact: it's the fall-back when
    # the Phase 2 per-module translator fails to produce a usable entry
    # (empty TSX, parse failure, missing bootstrap detection). Without
    # this safety net a per-module failure cascades into the HTML
    # translator path, which is wrong for runnable React imports.
    concat_text, blob_hash = _concat_babel_sources(
        sibling_chunks=sibling_chunks,
        inline_chunks=inline_chunks,
    )
    prior_key = dedupe_by_hash.get(blob_hash)
    if prior_key is not None:
        concat_artifact = prior_key
        deduped_against = prior_key
    else:
        concat_artifact = _content_script_artifact_key(page)
        await _save_text_artifact(ctx, concat_artifact, concat_text, mime="text/jsx")
        dedupe_by_hash[blob_hash] = concat_artifact
        deduped_against = None

    if _per_module_enabled():
        # Phase 2: per-sibling content artifacts ride alongside the
        # concat. Workflow prefers per-module path; falls through to the
        # concat artifact when the per-module entry produces empty TSX.
        per_module = await _emit_per_module_artifacts(
            ctx,
            page=page,
            sibling_chunks=sibling_chunks,
            inline_chunks=inline_chunks,
            dedupe_by_hash=dedupe_by_hash,
        )
        return _BabelShellEmission(
            output_artifact=concat_artifact,
            missing_siblings=missing_siblings,
            per_module_artifacts=per_module,
            deduped_against=deduped_against,
        )

    return _BabelShellEmission(
        output_artifact=concat_artifact,
        missing_siblings=missing_siblings,
        deduped_against=deduped_against,
    )


# ── Per-module Babel-shell emission (Phase 2) ─────────────────────────────


def _module_name_from_relpath(relpath: str) -> str:
    """Derive a PascalCase TSX module name from a sibling JSX relpath.

    Examples:
      - ``data.jsx``         → ``Data``
      - ``page-overview.jsx`` → ``PageOverview``
      - ``tweaks-panel.jsx`` → ``TweaksPanel``
      - ``charts/index.jsx`` → ``ChartsIndex``
    """
    stem = relpath.rsplit("/", 1)[-1]
    if stem.endswith(".jsx"):
        stem = stem[:-4]
    elif stem.endswith(".tsx"):
        stem = stem[:-4]
    parts = re.split(r"[^A-Za-z0-9]+", stem)
    pascal = "".join(p[:1].upper() + p[1:] for p in parts if p)
    return pascal or "Module"


_BOOTSTRAP_RE = re.compile(r"\bReactDOM\.(render|createRoot)\b")


def _detect_entry_index(
    sibling_chunks: list[tuple[str, str]],
    inline_chunks: list[tuple[str, str]],
) -> tuple[str, int]:
    """Pick which chunk is the entry (contains the bootstrap call).

    Returns ``(scope, index)`` where scope is ``"sibling"`` or ``"inline"``
    and index is the chunk's position. Defaults to the LAST inline block
    when no chunk contains a bootstrap (the inline-bootstrap pattern always
    has the bootstrap in an inline block anyway), or the LAST sibling when
    there are no inline blocks.
    """
    # Inline blocks first — that's where the bootstrap usually lives in
    # the inline-bootstrap pattern.
    for i, (_, body) in enumerate(inline_chunks):
        if _BOOTSTRAP_RE.search(body):
            return ("inline", i)
    # Otherwise scan siblings (the sibling-bootstrap pattern has it in
    # one of the .jsx files).
    for i, (_, body) in enumerate(sibling_chunks):
        if _BOOTSTRAP_RE.search(body):
            return ("sibling", i)
    # Fallback — choose the last inline if any, else last sibling.
    if inline_chunks:
        return ("inline", len(inline_chunks) - 1)
    return ("sibling", len(sibling_chunks) - 1)


async def _emit_per_module_artifacts(
    ctx,
    *,
    page: PageMapping,
    sibling_chunks: list[tuple[str, str]],
    inline_chunks: list[tuple[str, str]],
    dedupe_by_hash: dict[str, str],
) -> list[dict]:
    """Save one ``content:<slug>:scripts/<Name>.jsx`` per chunk.

    Per-file dedupe: if a sibling JSX with identical content was emitted
    by an earlier page, we reuse its artifact key instead of writing a
    new one. This is finer-grained than the legacy per-bundle dedupe
    and means two pages that share a `Charts.jsx` but differ on the
    page module both share the Charts artifact.

    Returns a list of dicts (one per chunk):
      ``{"name": "Charts", "artifact": "content:<slug>:scripts/Charts.jsx",
        "is_entry": False}``
    Empty list when there are no chunks at all.
    """
    if not sibling_chunks and not inline_chunks:
        return []

    slug = page.page_slug.strip("/")
    entry_scope, entry_index = _detect_entry_index(sibling_chunks, inline_chunks)
    used_names: set[str] = set()
    out: list[dict] = []

    def _unique(name: str) -> str:
        candidate = name
        i = 2
        while candidate in used_names:
            candidate = f"{name}{i}"
            i += 1
        used_names.add(candidate)
        return candidate

    async def _emit_one(label: str, body: str, is_entry: bool) -> None:
        module_name = _unique(_module_name_from_relpath(label))
        digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
        prior = dedupe_by_hash.get(digest)
        if prior is not None and _CONTENT_SCRIPT_MODULE_RE.match(prior):
            # Reuse a prior artifact; keeps Charts.jsx single-source
            # across pages even when the page module is different.
            artifact_key = prior
        else:
            artifact_key = f"content:{slug}:scripts/{module_name}.jsx"
            await _save_text_artifact(ctx, artifact_key, body, mime="text/jsx")
            dedupe_by_hash[digest] = artifact_key
        out.append({
            "name": module_name,
            "artifact": artifact_key,
            "is_entry": is_entry,
        })

    for i, (label, body) in enumerate(sibling_chunks):
        is_entry = (entry_scope == "sibling" and i == entry_index)
        await _emit_one(label, body, is_entry)
    for i, (label, body) in enumerate(inline_chunks):
        is_entry = (entry_scope == "inline" and i == entry_index)
        await _emit_one(label, body, is_entry)

    return out


_HEX_RE = re.compile(r"^#[0-9a-fA-F]{3,8}$")
_PILLAR_NAMES: tuple[str, str, str, str] = ("primary", "secondary", "surface", "error")


def _resolve_pillar(pillar: str, value: str, original_tokens: dict[str, str]) -> str:
    """Resolve one pillar string to a concrete hex color.

    Accepts:
      * Literal hex (``#rrggbb`` or ``#rgb``) — returned as-is.
      * Source ``--var`` name — looked up in ``original_tokens``; the
        resolved value must itself be a hex literal (``compute_m3_palette``
        only operates on hex).

    Raises ``HandlerError`` with a diagnostic naming the source vars that
    DO carry hex values, so the LLM (or a human) can see what was
    available. We never fabricate a default — an off-brand palette is
    worse than a clear failure.
    """
    if not isinstance(value, str) or not value.strip():
        raise HandlerError(
            f"Pillar {pillar!r} is empty. Provide either a source --var "
            f"name (e.g. ``--barn``) or a literal hex (``#7a5900``)."
        )
    candidate = value.strip()
    if _HEX_RE.match(candidate):
        return candidate
    if candidate.startswith("--"):
        resolved = original_tokens.get(candidate)
        if resolved and _HEX_RE.match(resolved.strip()):
            return resolved.strip()
        if resolved:
            raise HandlerError(
                f"Pillar {pillar!r} = {candidate!r} resolved to "
                f"{resolved!r}, which is not a hex literal. "
                f"compute_m3_palette only accepts ``#rrggbb`` values; "
                f"map this pillar to a different source --var or use a "
                f"literal hex."
            )
        available = sorted(
            k for k, v in original_tokens.items() if isinstance(v, str) and _HEX_RE.match(v.strip())
        )
        preview = ", ".join(available[:10])
        if len(available) > 10:
            preview = f"{preview}, … ({len(available) - 10} more)"
        raise HandlerError(
            f"Pillar {pillar!r} = {candidate!r} did not match any source "
            f"--var carrying a hex color. Available source vars with hex "
            f"values: {preview or '(none)'}."
        )
    raise HandlerError(
        f"Pillar {pillar!r} = {value!r} must be a source --var name "
        f"(starting with ``--``) or a literal ``#rrggbb`` hex."
    )


def _resolve_pillars(plan: DecompositionPlan, original_tokens: dict[str, str]) -> dict[str, str]:
    """Resolve the 4 LLM-chosen pillars, then derive the full M3 palette.

    Returns a dict keyed by ``--color-{name}`` for every token in
    :data:`compute_m3_palette`'s output (30 entries).

    For each M3 token, ``original_tokens[--color-{name}]`` wins over the
    derived value when both exist. This preserves Stitch's hand-tuned
    palette (its tailwind-config already names every M3 slot) while
    keeping Claude Design — which uses semantic names like ``--barn`` /
    ``--cream`` and has no ``--color-*`` tokens — fully derived from the
    pillars.

    Raises ``HandlerError`` if any pillar fails to resolve. The error
    message names the offending pillar AND lists what source vars were
    available, so the failure is actionable in one read.
    """
    # Lazy import — keeps the runner module light at import time.
    from main_agent.services.validation.style_coverage import compute_m3_palette

    pillars = plan.theme.pillars
    resolved: dict[str, str] = {
        name: _resolve_pillar(name, getattr(pillars, name), original_tokens)
        for name in _PILLAR_NAMES
    }

    try:
        derived = compute_m3_palette(
            primary=resolved["primary"],
            secondary=resolved["secondary"],
            surface=resolved["surface"],
            error=resolved["error"],
        )
    except Exception as exc:  # noqa: BLE001 — surface as HandlerError
        raise HandlerError(
            f"compute_m3_palette failed on resolved pillars " f"{resolved!r}: {exc}"
        ) from exc

    out: dict[str, str] = {}
    for bare, derived_value in derived.items():
        m3_key = f"--color-{bare}"
        authored = original_tokens.get(m3_key)
        if isinstance(authored, str) and _HEX_RE.match(authored.strip()):
            out[m3_key] = authored.strip()
        else:
            out[m3_key] = derived_value
    return out


def _assert_theme_css_complete(theme_css: str) -> None:
    """Verify the emitted theme.css carries every required M3 token.

    Runs the same extraction the downstream
    :func:`load_and_persist_theme_palette` will run. Failing here means
    the runner's own assembly path has a bug — better to crash with a
    runner-scoped error than to let the workflow walk four more steps
    before tripping ``ThemePaletteResolutionError``.
    """
    from main_agent.agents.orchestrator.app_types.webapp.services.theme_palette_service import (
        REQUIRED_THEME_PALETTE_TOKENS,
    )
    from main_agent.services.validation.style_coverage import (
        extract_css_theme_color_values,
    )

    palette = extract_css_theme_color_values(theme_css)
    missing = sorted(REQUIRED_THEME_PALETTE_TOKENS - set(palette))
    if missing:
        preview = ", ".join(missing[:8])
        if len(missing) > 8:
            preview = f"{preview}, … ({len(missing) - 8} more)"
        raise HandlerError(
            "Runner emitted theme.css missing required M3 tokens: "
            f"{preview}. This is a bug in the runner's theme assembly; "
            "compute_m3_palette returns all 30 tokens, so an absence "
            "here means the @theme block is malformed."
        )


def _pick_fonts(m3_tokens: dict[str, str], original_tokens: dict[str, str]) -> dict[str, str]:
    """Return the resolved ``--font-headline`` / ``--font-body`` values.

    Falls back to original_tokens if the LLM didn't carry the M3 mapping
    explicitly. Falls back across canonical aliases (``headline`` ↔
    ``heading``, ``body`` ↔ ``sans``) so a bundle that uses only the
    Tailwind/runtime names still produces a usable creator plan. Used
    by the creator-plan synthesizer so design_system references real
    fonts.
    """
    combined = {**original_tokens, **m3_tokens}
    headline = alias_aware_font_lookup(combined, "headline") or ""
    body = alias_aware_font_lookup(combined, "body") or ""
    return {"headline": _strip_quotes(headline), "body": _strip_quotes(body)}


def _strip_quotes(value: str) -> str:
    """Strip a leading font-family list down to its first family name."""
    if not value:
        return ""
    first = value.split(",", 1)[0].strip()
    if first.startswith('"') and first.endswith('"') and len(first) >= 2:
        return first[1:-1]
    if first.startswith("'") and first.endswith("'") and len(first) >= 2:
        return first[1:-1]
    return first


def _augment_notes(
    notes: str,
    *,
    unmatched_labels: Optional[list[str]] = None,
    missing_siblings_by_page: Optional[dict[str, list[str]]] = None,
) -> str:
    """Append warning sections to the import notes.

    Two diagnostic sections may be appended (each only when applicable):

    * ``## Unmatched placeholders`` — Claude-Design ``.ph`` labels the
      transformer couldn't match to a MAP entry.
    * ``## Missing JSX siblings`` — Babel-shell pages that referenced
      a ``<script src="*.jsx">`` sibling not present in the upload. The
      app still deploys (soft-fail); this section tells the user which
      files were expected so they can re-upload a complete bundle.
    """
    base = (notes or "").rstrip()
    sections: list[str] = []

    if unmatched_labels:
        sections.append("## Unmatched placeholders")
        for label in dict.fromkeys(unmatched_labels):
            sections.append(f"- {label}")

    if missing_siblings_by_page:
        if sections:
            sections.append("")
        sections.append("## Missing JSX siblings")
        sections.append(
            "These Babel-shell pages reference JSX/TSX files that were "
            "not in the uploaded archive. The pages still deploy but the "
            "missing components render as nothing; re-upload the bundle "
            "with the listed files to fix."
        )
        for slug in sorted(missing_siblings_by_page):
            label = slug or "home"
            files = list(dict.fromkeys(missing_siblings_by_page[slug]))
            files_str = ", ".join(f"`{f}`" for f in files)
            sections.append(f"- `/{label}`: {files_str}")

    if not sections:
        return base
    out = base + "\n\n" + "\n".join(sections) if base else "\n".join(sections)
    return out.strip() + "\n"


def _synthesize_creator_plan(
    plan: DecompositionPlan,
    *,
    m3_tokens: dict[str, str],
    fonts: dict[str, str],
    page_script_artifacts: Optional[dict[str, str]] = None,
    page_script_modules: Optional[dict[str, list[dict]]] = None,
) -> dict:
    """Produce the deterministic creator_plan dict.

    Takes the LLM's ``creator_plan`` as base and overrides:
      * ``component_plans`` — re-built from ``plan.pages`` + ``plan.chrome``
        so every entry's ``source_html_artifact`` references a real file.
        For Babel-shell pages, ``source_jsx_artifact`` is also set (keyed
        on canonical page slug via ``page_script_artifacts``); the
        creation_workflow branches on that field to invoke the JSX
        translator instead of html_to_tsx.
        When the per-module Babel-shell flag is on,
        ``source_jsx_modules`` is set instead — a list of
        ``{name, artifact, is_entry}`` dicts the workflow feeds into
        ``transform_babel_shell_modules``.
      * ``design_system.{primary,secondary,surface,error}_color`` plus
        ``headline_font`` / ``body_font`` — overwritten with resolved
        theme tokens.
    """
    page_script_artifacts = page_script_artifacts or {}
    page_script_modules = page_script_modules or {}
    creator_plan = plan.creator_plan.model_dump()

    # Merge the LLM's backend_intent into app_backend_plan. The intent carries
    # richer schema (FK references, full column lists, plans/invoices etc.)
    # than the creator_plan's app_backend_plan, which the LLM tends to leave
    # sparse on the design-import branch.
    #
    # Merge policy:
    #   - New model name → append the intent model (with ``owner_scope = "shared"``
    #     when unset, matching grounding.py:_to_model_plan_dict line 497).
    #   - Conflicting model name → COLUMN-UNION the column lists, intent
    #     column wins on name clash. The pnkndvyy fix used don't-clobber
    #     and shipped column drops on alo48zsn (2026-05-15): LLM populated
    #     ``app_backend_plan.members`` with 5 columns and ``backend_intent.members``
    #     with 6 columns (one being the ``plan_id`` FK); don't-clobber kept
    #     the sparse 5-col version and dropped the FK.
    if plan.backend_intent is not None and (
        plan.backend_intent.models or plan.backend_intent.handlers
    ):
        backend_plan = creator_plan.setdefault("app_backend_plan", {})
        if plan.backend_intent.models:
            existing_by_name: dict[str, dict] = {}
            for m in (backend_plan.get("models") or []):
                if isinstance(m, dict) and m.get("name"):
                    existing_by_name[m["name"]] = m

            intent_new: list[dict] = []
            for m in plan.backend_intent.models:
                intent_dict = m.model_dump(exclude_none=True)
                intent_dict.setdefault("owner_scope", "shared")

                if m.name in existing_by_name:
                    # Conflict: union columns by name. Intent column wins
                    # on name clash since the intent is the LLM's richer
                    # considered schema (FK refs, enum_values, etc.).
                    existing_m = existing_by_name[m.name]
                    cols_by_name: dict[str, dict] = {}
                    for c in (existing_m.get("columns") or []):
                        if isinstance(c, dict) and c.get("name"):
                            cols_by_name[c["name"]] = c
                    for ic in intent_dict.get("columns") or []:
                        if isinstance(ic, dict) and ic.get("name"):
                            cols_by_name[ic["name"]] = ic
                    existing_m["columns"] = list(cols_by_name.values())
                else:
                    intent_new.append(intent_dict)

            if intent_new:
                backend_plan.setdefault("models", []).extend(intent_new)
        if plan.backend_intent.handlers:
            existing_handler_names = {
                h.get("name")
                for h in (backend_plan.get("handlers") or [])
                if isinstance(h, dict)
            }
            intent_handlers = [
                h.model_dump(exclude_none=True)
                for h in plan.backend_intent.handlers
                if h.name not in existing_handler_names
            ]
            if intent_handlers:
                backend_plan.setdefault("handlers", []).extend(intent_handlers)
        logger.info(
            "design_import_backend_intent_merged",
            models=[m.name for m in plan.backend_intent.models],
            handlers=[h.name for h in plan.backend_intent.handlers],
        )

    # Re-build component_plans deterministically. Preserve any LLM-authored
    # fields the runner doesn't own (``image_references`` etc.) by looking
    # up the original entry by slug/role. ``building_plan`` is NOT in the
    # LLM schema — the runner emits a concise translation hint per entry.
    by_slug: dict[str, dict] = {}
    by_role: dict[str, dict] = {}
    for cp in creator_plan.get("component_plans") or []:
        if cp.get("role") == "content":
            slug = (cp.get("page_slug") or "").rstrip("/")
            by_slug[slug] = cp
        elif cp.get("role") in {"header", "sidebar", "footer"}:
            by_role[cp["role"]] = cp

    new_component_plans: list[dict] = []
    for region in plan.chrome:
        base = by_role.get(region.role) or {}
        new_component_plans.append(
            {
                **base,
                # Always use the deterministic helper. The LLM regularly
                # emits ad-hoc names ("HeroSection", "ApplicationForm",
                # "UserDashboard") that don't match the page they end up
                # bound to. App rdzn62gx (2026-05-16) had the home page
                # entry render as ApplicationForm.tsx because the LLM's
                # name fallback won via `or`. Drop the fallback —
                # `MainHeader` / `MainFooter` / `MainSidebar` is the
                # contract every downstream consumer expects.
                "name": _default_chrome_name(region.role),
                "role": region.role,
                "page_slug": None,
                "page_title": None,
                "source_html_artifact": region.output_artifact,
                "building_plan": base.get("building_plan")
                or [f"Translate the imported {region.role} markup verbatim to TSX."],
            }
        )

    for page in plan.pages:
        slug_key = page.page_slug.strip("/")
        base = by_slug.get(slug_key) or {}
        cp_dict: dict = {
            **base,
            # Always use the deterministic helper. See chrome-loop comment
            # above. `_default_content_name` produces `HomeContent`,
            # `OurProductsContent`, `AboutUsContent`, etc. — page-derived
            # names every downstream consumer expects.
            "name": _default_content_name(page.page_slug),
            "role": "content",
            "page_slug": page.page_route,
            "page_title": page.page_title,
            "page_summary": page.page_summary or base.get("page_summary") or "",
            "page_short_summary": page.page_short_summary
            or base.get("page_short_summary")
            or "",
            "source_html_artifact": page.output_artifact,
            "building_plan": base.get("building_plan")
            or [f"Translate the imported HTML for /{slug_key or 'home'} verbatim to TSX."],
        }
        # Babel-shell pages carry an additional source_jsx_artifact; the
        # creation_workflow branches on this to call the JSX translator
        # instead of the standard html_to_tsx pipeline.
        if slug_key in page_script_artifacts:
            cp_dict["source_jsx_artifact"] = page_script_artifacts[slug_key]
        # Phase 2 per-module path: a list of sibling JSX artifacts each
        # destined for its own codefocus_module:*.tsx output. The entry
        # element (is_entry=True) becomes the rendered component; the
        # rest are supporting modules referenced via ES imports.
        if slug_key in page_script_modules:
            cp_dict["source_jsx_modules"] = page_script_modules[slug_key]
        new_component_plans.append(cp_dict)
    creator_plan["component_plans"] = new_component_plans

    # Patch design_system colors + fonts.
    design_system = dict(creator_plan.get("design_system") or {})
    if "--color-primary" in m3_tokens:
        design_system["primary_color"] = m3_tokens["--color-primary"]
    if "--color-secondary" in m3_tokens:
        design_system["secondary_color"] = m3_tokens["--color-secondary"]
    if "--color-surface" in m3_tokens:
        design_system["surface_color"] = m3_tokens["--color-surface"]
    if "--color-error" in m3_tokens:
        design_system["error_color"] = m3_tokens["--color-error"]
    if fonts.get("headline"):
        design_system["headline_font"] = fonts["headline"]
    if fonts.get("body"):
        design_system["body_font"] = fonts["body"]
    creator_plan["design_system"] = design_system

    return creator_plan


def _default_chrome_name(role: str) -> str:
    return {"header": "MainHeader", "sidebar": "MainSidebar", "footer": "MainFooter"}.get(
        role, f"Main{role.title()}"
    )


# Per-role fallback CSS selectors used by the chrome-strip pass when the
# LLM-supplied `ChromeRegion.selector` doesn't match every page (e.g.
# home uses <header> but inner pages use top-level <nav>). Conservative
# by design — only matches shapes that are almost always site chrome,
# not in-body decorations. Tight class-substring matches (`class*='fixed
# top-0'`) keep blast radius low; `nav.fixed` alone would over-strip
# decorative sticky navs inside page bodies.
_CHROME_FALLBACK_SELECTORS: dict[str, tuple[str, ...]] = {
    "header": ("header", "nav[class*='fixed top-0']"),
    "footer": ("footer", "div[class*='footer']"),
    "sidebar": ("aside", "nav[class*='sidebar']"),
}


def _chrome_fallback_selectors(role: str) -> tuple[str, ...]:
    return _CHROME_FALLBACK_SELECTORS.get(role, ())


def _default_content_name(slug: str) -> str:
    """``/about-us`` → ``AboutUsContent``; ``/`` → ``HomeContent``."""
    bare = (slug or "").strip("/").replace("-", " ").replace("_", " ")
    if not bare:
        return "HomeContent"
    pascal = "".join(word.title() for word in bare.split())
    return f"{pascal}Content"


# ── Artifact save helpers ─────────────────────────────────────────────────


async def _save_text_artifact(ctx, filename: str, text: str, *, mime: str) -> None:
    artifact = genai.types.Part.from_bytes(data=text.encode("utf-8"), mime_type=mime)
    await ctx.artifact_service.save_artifact(
        session_id=ctx.session.id,
        user_id=ctx.session.user_id,
        app_name=ctx.session.app_name,
        filename=filename,
        artifact=artifact,
    )


async def _save_json_artifact(ctx, filename: str, payload: dict) -> None:
    text = json.dumps(payload, indent=2, ensure_ascii=False)
    await _save_text_artifact(ctx, filename, text, mime="application/json")
