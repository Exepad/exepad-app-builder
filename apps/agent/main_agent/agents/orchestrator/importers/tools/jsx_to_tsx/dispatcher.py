"""Mechanical-TSX translation dispatcher for design-import flows.

Lifts the Babel-shell → TSX per-module translation that lived inside
``CreationWorkflow``'s per-component build loop into a stand-alone
helper so ``DesignImportWorkflow`` can call it directly without going
through CreationWorkflow.

The function is purely deterministic — no LLM. It walks every component
plan in the synthesized creator_plan, runs ``transform_babel_shell_modules``
per cluster, and saves the resulting ``codefocus_component:<Name>.tsx``
+ ``codefocus_module:<Name>.tsx`` artifacts.

Side effects:
- Writes session-level artifacts via ``ctx.artifact_service``.
- Mutates ``component_plan["supporting_modules"]`` with the list of
  saved supporting-module names.
- Merges all freshly-translated TSX into
  ``ctx.session.state["_codefocus_sibling_modules"]`` so the downstream
  validation pipeline (esbuild + tsc) resolves cross-sibling imports.

Returns the list of ``ComponentEntry`` rows the caller will hand to
``AssemblyService.assemble_app_config``.
"""

from __future__ import annotations

from dataclasses import dataclass

import structlog

from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.agents.utils.state_ops import push_session_state_update
from main_agent.constants import StateKeys

from .module_transformer import ModuleSpec, transform_babel_shell_modules

logger = structlog.get_logger(__name__)


def _run_auto_fixes_on_chrome(
    ctx,
    tsx: str,
    component_name: str,
) -> str:
    """Run the deterministic auto-fix pipeline on dispatcher-saved TSX.

    Chrome regions (MainHeader/MainFooter/MainSidebar) and HTML-path
    entry components do NOT go through ComponentBuilderMultiplePolish,
    so without this call the entire ``component_rules()`` AST/fixer
    chain is silently inert for them — material-symbols leaks, arbitrary
    hex classes, missing imports, etc. all ship verbatim from the
    mechanical translator. App ``9vvnqllg`` (chick-farm4017, 2026-05-16)
    surfaced this: MainFooter shipped with three raw
    ``<span class="material-symbols-outlined">{glyph}</span>`` spans
    on every page.

    Failure-mode contract: fixers + the post-fix syntax gate must NEVER
    block translation. On any exception (or post-fix esbuild rejection)
    we return the input TSX unchanged so the design-import workflow
    completes.
    """
    try:
        from main_agent.services.validation.fixers import apply_auto_fixes
        from main_agent.agents.utils.image_generation_utils import should_strip_llm_image_urls
    except Exception:  # noqa: BLE001
        return tsx

    state = ctx.session.state if hasattr(ctx, "session") else {}
    models = state.get("_validation_context_models", []) or []
    handlers = state.get("_validation_context_handlers", []) or []
    logic = state.get("_validation_context_logic", {}) or {}
    page_slugs = state.get("_validation_context_page_slugs", []) or []
    theme_palette = (
        state.get("_validation_context_theme_palette")
        or state.get(StateKeys.RESOLVED_THEME_PALETTE)
        or {}
    )
    state_keys = logic.get("state", {}) if isinstance(logic, dict) else {}

    try:
        fixed, fixes = apply_auto_fixes(
            tsx,
            models,
            {},
            state_keys,
            expected_component_name=component_name,
            handlers=handlers,
            page_slugs=page_slugs,
            theme_palette=theme_palette,
            stock_provider_configured=should_strip_llm_image_urls(),
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "design_import_dispatcher: apply_auto_fixes raised; saving unfixed TSX",
            component=component_name,
            error=str(exc),
        )
        return tsx

    # SDK barrel → subpath import split (deploy optimization). Chrome regions
    # ship to the browser and resolve ``@exepad/sdk`` via the global import map
    # too, so they benefit from the split exactly like page components. Applied
    # here (not in apply_auto_fixes) and validated by the post-fix gate below;
    # any breakage reverts to the unfixed input per this function's contract.
    try:
        from main_agent.services.validation.fixers.component_sdk_subpaths import (
            split_sdk_barrel,
        )

        split_code, split_fixes = split_sdk_barrel(fixed)
        if split_fixes:
            fixed = split_code
            fixes = fixes + split_fixes
    except Exception:  # noqa: BLE001
        pass

    if not fixes:
        return fixed

    # Post-fix syntax gate — some fixers do regex/AST splicing that can
    # corrupt JSX. Re-validate with esbuild; revert on failure.
    try:
        from main_agent.services.validation.syntax_validator import (
            validate_tsx_syntax,
        )
    except Exception:  # noqa: BLE001
        validate_tsx_syntax = None  # type: ignore[assignment]

    if validate_tsx_syntax is not None:
        try:
            ok, errors = validate_tsx_syntax(fixed)
        except Exception:  # noqa: BLE001
            ok, errors = True, []
        if not ok:
            logger.warning(
                "design_import_dispatcher: post-fix syntax gate failed; reverting",
                component=component_name,
                error_count=len(errors),
            )
            return tsx

    logger.info(
        "design_import_dispatcher: auto-fixes applied",
        component=component_name,
        fix_count=len(fixes),
        fixes=fixes[:5],
    )
    return fixed


@dataclass
class TranslatedComponent:
    """Result row for one entry component in the design-import."""

    name: str
    role: str  # "header", "sidebar", "footer", "content"
    page_slug: str | None = None
    page_title: str | None = None
    summary: str = ""
    supporting_modules: list[str] = None  # type: ignore[assignment]
    entry_tsx: str = ""

    def __post_init__(self) -> None:
        if self.supporting_modules is None:
            self.supporting_modules = []


async def translate_design_import_components(
    ctx,
    creator_plan: dict,
) -> list[TranslatedComponent]:
    """Mechanically translate every entry in ``creator_plan``.

    Two translation paths share this dispatcher:

    Babel-shell path — for ``component_plan`` carrying ``source_jsx_modules``
    (Claude-Design bundles):
      1. Load each module's `.jsx` body from session artifacts.
      2. Run ``transform_babel_shell_modules`` to produce TSX per module.
      3. Save the entry's TSX as ``codefocus_component:<Name>.tsx``.
      4. Save each supporting module's TSX as ``codefocus_module:<Name>.tsx``.

    HTML path — for ``component_plan`` carrying only ``source_html_artifact``
    (Stitch bundles, chrome regions on any source):
      1. Load the cleaned HTML body via ``ArtifactManager``.
      2. Run ``transform_html_to_tsx`` (deterministic walker → TSX).
      3. Save the result as ``codefocus_component:<Name>.tsx``.
      (No supporting modules; HTML pages collapse into a single file.)

    Both paths merge their TSX into ``_codefocus_sibling_modules`` so
    downstream tsc gates resolve cross-file imports.

    Returns a ``TranslatedComponent`` list — one row per entry — that
    the caller hands to ``AssemblyService`` for initial app_config
    assembly. Entries with neither ``source_jsx_modules`` nor
    ``source_html_artifact`` (or where translation produced empty TSX)
    return an empty ``entry_tsx``; a warning is logged so the gap is
    visible.
    """
    # genai is used for the artifact Part construction; lazy-import so
    # this module is cheap to import in environments that don't
    # initialise genai at startup.
    from google import genai

    component_plans = creator_plan.get("component_plans") or []
    out: list[TranslatedComponent] = []
    sibling_modules_acc: dict[str, str] = {}

    # Build (slug, title) pairs once for the html_to_tsx chrome-nav
    # fuzzy match. Lets the deterministic walker rewrite Stitch
    # placeholder ``<a href="#">Members</a>`` to ``<Link to="/member-directory">``
    # at translation time. Only "content"-role entries contribute a
    # routable slug; chrome regions (header/sidebar/footer) carry None.
    page_routes: tuple[tuple[str, str], ...] = tuple(
        (
            (cp.get("page_slug") or "").strip() or "/",
            cp.get("page_title") or "",
        )
        for cp in component_plans
        if (cp.get("role") or "content") == "content" and cp.get("page_slug") is not None
    )
    # Slug-only view of the same set for the walker's `<a href="/slug">` →
    # `<Link to="/slug">` absolute-path matcher. Without this passed
    # through to the chrome translation call, dchu7mzs (2026-05-17)
    # MainHeader/MainFooter shipped with 30 raw `<a href>` and 0 `<Link>`
    # — every chrome click full-reloaded the page.
    page_slugs: tuple[str, ...] = tuple(slug for slug, _title in page_routes)

    for cp in component_plans:
        component_name = cp.get("name") or ""
        if not component_name:
            logger.warning(
                "design_import_dispatcher: component_plan without name; skipping",
                cp=cp,
            )
            continue

        role = cp.get("role") or "content"
        modules_meta = cp.get("source_jsx_modules") or []
        translated = TranslatedComponent(
            name=component_name,
            role=role,
            page_slug=cp.get("page_slug"),
            page_title=cp.get("page_title"),
            summary=cp.get("page_summary") or cp.get("page_short_summary") or "",
        )

        if not modules_meta:
            # No Babel-shell modules — fall back to the deterministic
            # html_to_tsx translator if the entry carries a
            # source_html_artifact. Stitch bundles take this path (plain
            # HTML + Tailwind, no <script type="text/babel">), as do
            # chrome regions on any source. Without this fallback the
            # downstream EditingWorkflow rehydration would see no TSX
            # in session state, create stubs, and trip the stub-baseline
            # guard.
            html_artifact = cp.get("source_html_artifact")
            if not html_artifact:
                logger.warning(
                    "design_import_dispatcher: no jsx modules and no html artifact",
                    component=component_name,
                )
                out.append(translated)
                continue

            try:
                html_body = await ArtifactManager.load_artifact_as_string(ctx, html_artifact)
            except Exception as exc:
                logger.warning(
                    "design_import_dispatcher: html artifact load failed",
                    component=component_name,
                    artifact=html_artifact,
                    error=str(exc),
                )
                out.append(translated)
                continue

            if not html_body:
                logger.warning(
                    "design_import_dispatcher: html artifact empty",
                    component=component_name,
                    artifact=html_artifact,
                )
                out.append(translated)
                continue

            from main_agent.agents.orchestrator.importers.tools.html_to_tsx import (
                transform_html_to_tsx,
            )

            try:
                html_result = transform_html_to_tsx(
                    html_body,
                    component_name=component_name,
                    component_role=role,
                    page_routes=page_routes,
                    page_slugs=page_slugs,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "design_import_dispatcher: html_to_tsx raised",
                    component=component_name,
                    error=str(exc),
                )
                out.append(translated)
                continue

            if not html_result.tsx:
                logger.warning(
                    "design_import_dispatcher: html_to_tsx produced empty TSX",
                    component=component_name,
                )
                out.append(translated)
                continue

            fixed_tsx = _run_auto_fixes_on_chrome(ctx, html_result.tsx, component_name)
            entry_artifact_key = f"codefocus_component:{component_name}.tsx"
            entry_part = genai.types.Part.from_bytes(
                data=fixed_tsx.encode("utf-8"),
                mime_type="text/tsx",
            )
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=entry_artifact_key,
                artifact=entry_part,
            )
            sibling_modules_acc[component_name] = fixed_tsx
            translated.entry_tsx = fixed_tsx

            if html_result.confidence == "low":
                logger.warning(
                    "design_import_dispatcher: html_to_tsx low-confidence",
                    component=component_name,
                    warnings=list(html_result.warnings)[:5],
                )

            out.append(translated)
            continue

        # Load every module's body
        module_specs: list[ModuleSpec] = []
        for m in modules_meta:
            artifact_key = m.get("artifact")
            module_name = m.get("name") or ""
            if not artifact_key or not module_name:
                continue
            try:
                body = await ArtifactManager.load_artifact_as_string(ctx, artifact_key)
            except Exception as exc:
                logger.warning(
                    "design_import_dispatcher: artifact load failed",
                    component=component_name,
                    module=module_name,
                    artifact=artifact_key,
                    error=str(exc),
                )
                continue
            if not body:
                continue
            module_specs.append(
                ModuleSpec(
                    name=module_name,
                    source=body,
                    is_entry=bool(m.get("is_entry")),
                )
            )

        if not module_specs:
            logger.warning(
                "design_import_dispatcher: component has no loadable modules",
                component=component_name,
            )
            out.append(translated)
            continue

        # Translate
        try:
            per_module_results = transform_babel_shell_modules(
                module_specs,
                entry_component_name=component_name,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "design_import_dispatcher: translator raised",
                component=component_name,
                error=str(exc),
            )
            out.append(translated)
            continue

        if not per_module_results:
            out.append(translated)
            continue

        entry_spec = next((s for s in module_specs if s.is_entry), None)
        entry_result = per_module_results.get(entry_spec.name) if entry_spec is not None else None

        if entry_result is None or not entry_result.tsx:
            logger.warning(
                "design_import_dispatcher: entry produced empty TSX",
                component=component_name,
            )
            out.append(translated)
            continue

        # Save entry component artifact
        fixed_entry_tsx = _run_auto_fixes_on_chrome(ctx, entry_result.tsx, component_name)
        entry_artifact_key = f"codefocus_component:{component_name}.tsx"
        entry_part = genai.types.Part.from_bytes(
            data=fixed_entry_tsx.encode("utf-8"),
            mime_type="text/tsx",
        )
        await ctx.artifact_service.save_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename=entry_artifact_key,
            artifact=entry_part,
        )
        sibling_modules_acc[component_name] = fixed_entry_tsx
        translated.entry_tsx = fixed_entry_tsx

        # Save supporting modules
        for mod_name, mod_result in per_module_results.items():
            if entry_spec is not None and mod_name == entry_spec.name:
                continue
            if not mod_result.tsx:
                logger.warning(
                    "design_import_dispatcher: supporting module produced empty TSX",
                    component=component_name,
                    module=mod_name,
                )
                continue
            fixed_mod_tsx = _run_auto_fixes_on_chrome(ctx, mod_result.tsx, mod_name)
            module_artifact_key = f"codefocus_module:{mod_name}.tsx"
            part = genai.types.Part.from_bytes(
                data=fixed_mod_tsx.encode("utf-8"),
                mime_type="text/tsx",
            )
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=module_artifact_key,
                artifact=part,
            )
            translated.supporting_modules.append(mod_name)
            sibling_modules_acc[mod_name] = fixed_mod_tsx

        out.append(translated)

    # Merge accumulated translations into _codefocus_sibling_modules so
    # the downstream tsc gate resolves cross-file imports.
    if sibling_modules_acc:
        prior = ctx.session.state.get("_codefocus_sibling_modules") or {}
        if not isinstance(prior, dict):
            prior = {}
        merged = {**prior, **sibling_modules_acc}
        await push_session_state_update(
            ctx,
            {"_codefocus_sibling_modules": merged},
        )

    logger.info(
        "design_import_dispatcher: translation done",
        components=len(out),
        translated=sum(1 for t in out if t.entry_tsx),
        modules=sum(len(t.supporting_modules) for t in out),
    )
    return out


__all__ = ["TranslatedComponent", "translate_design_import_components"]
