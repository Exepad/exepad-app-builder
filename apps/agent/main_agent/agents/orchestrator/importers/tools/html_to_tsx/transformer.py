"""Mechanical HTML→TSX transformer entry point (Pass 1 only).

Phase 1 covers the structural translation — Pass 1 in the architecture
diagram. Later phases layer on top:

* Phase 2 (wiring) — `wiring/` package overrides certain emit decisions
  (forms, links, images, material symbols) and computes the SDK
  import set
* Phase 3 (JS → hooks) — `js_to_hooks/` translates the sidecar JS
  produced here into React hooks
* Phase 4 (mobile-nav) — `mobile_nav.py` injects the responsive scaffold
  for header components
* Phase 5 (plan augmentation) — `plan_builder.py` emits per-component
  building_plan items describing residual behaviors and wiring
  intentions

Phase 1 outputs:

* TSX skeleton wrapped in ``<LightDOMContainer>`` + a function +
  ``export default``. Every original text node and class name from the
  source HTML is preserved verbatim.
* Sidecar JS string (concatenated, analytics-free) for Phase 3 to
  consume — saved by the workflow as
  ``design_import_scripts:{Name}.js``.
* Sidecar CSS string (defensive, usually empty) for Phase 8 to consume
  — saved as ``design_import_styles:{Name}.css`` when non-empty.
* Confidence flag — ``"low"`` when the input contained patterns the
  mechanical pipeline can't handle reliably; the workflow falls back
  to the legacy LLM ComponentBuilder path.

Public entry: :func:`transform_html_to_tsx`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from .js_to_hooks import transform_scripts_to_hooks
from .mobile_nav import maybe_inject_mobile_nav_scaffold
from .plan_builder import build_plan_items
from .script_extractor import extract_scripts
from .style_extractor import extract_styles
from .walker import parse_html, walk
from .wiring import compose_import_line
from .wiring.context import WiringContext

Confidence = Literal["high", "low"]


@dataclass
class TransformResult:
    """Outcome of running the mechanical pipeline against one component's
    cleaned HTML.

    Attributes:
        tsx: The full TSX file body, ready to save as
            ``codefocus_component:{Name}.tsx``. Includes imports, the
            function declaration, the JSX body wrapped in
            ``<LightDOMContainer>``, and ``export default``.
        scripts_js: Concatenated JS body extracted from ``<script>``
            blocks (analytics already filtered). Empty when the source
            had no behavioral scripts.
        styles_css: Concatenated CSS body from ``<style>`` blocks
            (defensive — usually empty because the decomposition
            runner strips them upstream).
        plan_items: Building-plan items for ComponentBuilder's edit
            mode. Phase 1 emits an empty list; Phase 5 (plan_builder)
            will populate this with behavioral residuals + wiring
            intentions.
        warnings: Non-fatal issues encountered during the walk
            (unknown attributes, dropped elements, etc.).
        confidence: ``"high"`` when the mechanical pipeline can
            handle the input; ``"low"`` when the workflow should
            consider falling back to the LLM path.
    """

    tsx: str
    scripts_js: str = ""
    styles_css: str = ""
    plan_items: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    confidence: Confidence = "high"


def transform_html_to_tsx(
    html: str,
    *,
    component_name: str,
    page_slugs: tuple[str, ...] = (),
    page_routes: tuple[tuple[str, str], ...] = (),
    form_ids: tuple[str, ...] = (),
    component_role: str = "content",
    backend_surface: dict[str, Any] | None = None,
    building_plan: list[str] | None = None,
) -> TransformResult:
    """Translate cleaned HTML into a TSX component file.

    Args:
        html: Cleaned HTML body from the decomposition runner
            (e.g. the contents of ``content::page.html``). Should
            already be byte-faithful — no ``<style>`` blocks in
            typical cases, no chrome leaks. The transformer is
            defensive against both.
        component_name: PascalCase component name. Used for the
            function declaration and the export.
        page_slugs: Internal page slugs (from ``app_context.pages``).
            ``<a href="/foo">`` rewrites to ``<Link to="/foo">`` only
            when the slug is in this set. Empty tuple means no link
            rewriting.
        page_routes: ``(slug, title)`` pairs for the chrome-nav fuzzy
            match. When ``component_role`` is ``sidebar``/``header``/
            ``footer``, bare ``<a href="#">`` anchors are rewritten to
            ``<Link to="/slug">`` by matching the anchor text against
            page titles. Empty tuple disables the rewrite — design-
            import sidebars then ship with dead ``href="#"`` links.
        form_ids: Deprecated/unused. Retained for signature stability;
            the platform forms service was removed, so no form wiring is
            performed.
        component_role: ``content`` | ``header`` | ``footer`` |
            ``sidebar``. Phase 4 (mobile-nav scaffold) will key off
            ``"header"``; Phase 2 doesn't read this directly.

    Returns:
        :class:`TransformResult` carrying the TSX, sidecars, plan
        items, warnings, and confidence.
    """
    soup = parse_html(html)

    # Strip scripts and styles BEFORE walking. This way the walker sees
    # a tree with only structural / content elements.
    scripts = extract_scripts(soup)
    styles = extract_styles(soup)

    wiring_ctx = WiringContext(
        page_slugs=tuple(page_slugs),
        page_routes=tuple(page_routes),
        form_ids=tuple(form_ids),
        component_role=component_role,
    )

    # Phase 3: translate the extracted JS body into React.useEffect
    # blocks. The blocks splice into the function-body preamble.
    hooks_result = transform_scripts_to_hooks(scripts.body)
    wiring_ctx.function_preamble.extend(hooks_result.useeffect_blocks)
    wiring_ctx.warnings.extend(hooks_result.warnings)

    walk_result = walk(soup, ctx=wiring_ctx)

    # Phase 4: inject mobile-nav scaffold for header components. Runs
    # post-walk so the substitution sees fully-resolved attributes.
    body_jsx = maybe_inject_mobile_nav_scaffold(walk_result.jsx, wiring_ctx)

    confidence: Confidence = (
        "low" if (walk_result.low_confidence or scripts.low_confidence) else "high"
    )

    warnings: list[str] = []
    warnings.extend(walk_result.warnings)
    if scripts.dropped_external:
        for src in scripts.dropped_external:
            warnings.append(f"dropped external script src={src!r}")
    if scripts.dropped_analytics:
        warnings.append(f"dropped {scripts.dropped_analytics} analytics script(s)")
    if scripts.dropped_placeholder_loader:
        warnings.append(
            f"dropped {scripts.dropped_placeholder_loader} placeholder-loader script(s)"
        )

    tsx = _wrap_in_component(
        body_jsx,
        component_name,
        ctx=wiring_ctx,
    )

    # Phase 5: emit per-component building_plan items describing
    # behavioral residuals + wiring intentions for ComponentBuilder
    # edit mode.
    plan_items = build_plan_items(
        jsx_body=body_jsx,
        scripts_js=scripts.body,
        component_name=component_name,
        backend_surface=backend_surface,
        building_plan=building_plan,
    )

    return TransformResult(
        tsx=tsx,
        scripts_js=scripts.body,
        styles_css=styles.body,
        plan_items=plan_items,
        warnings=warnings,
        confidence=confidence,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _wrap_in_component(body_jsx: str, component_name: str, *, ctx: WiringContext) -> str:
    """Wrap a JSX body in the canonical Exepad component shell.

    Composes the SDK import line from ``ctx.sdk_imports`` and splices
    any ``ctx.function_preamble`` blocks (e.g. handleSubmit) between
    the function declaration and the ``return (...)``.

    Output shape mirrors the one ComponentBuilder emits for scratch
    creation, so the validator pipeline (``apply_auto_fixes``,
    ``run_semantic_checks``) treats both paths identically.
    """
    import_line = compose_import_line(ctx)
    preamble = "\n\n".join(ctx.function_preamble).strip()
    if preamble:
        # Indent every line of the preamble two spaces to match React
        # component-body indentation.
        preamble = "\n".join(("  " + line if line else line) for line in preamble.split("\n"))
        preamble += "\n\n"

    return _COMPONENT_TEMPLATE.format(
        import_line=import_line,
        name=component_name,
        preamble=preamble,
        body=body_jsx,
    )


_COMPONENT_TEMPLATE = """{import_line}

function {name}() {{
{preamble}  return (
    <LightDOMContainer>
      {body}
    </LightDOMContainer>
  );
}}

export default {name};
"""
