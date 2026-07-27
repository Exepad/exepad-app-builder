"""
Artifact tools for Code Focus component builder agents.

These FunctionTools allow agents to save their generated Code Focus code
(components and styles) as artifacts — with inline validation that returns
errors to the LLM for immediate self-correction.

The tool_context parameter is automatically injected by ADK.
"""

import asyncio
import re
import time
import structlog
from typing import Optional
from google.adk.tools import FunctionTool
from google.adk.tools.tool_context import ToolContext
from google.adk.agents.invocation_context import InvocationContext
from google import genai

from main_agent.agents.utils.validation_formatting import format_validation_errors
from main_agent.constants import StateKeys
from main_agent.services.validation.failure_classification import build_failure_detail
from main_agent.services.validation.safe_names import is_safe_artifact_name

logger = structlog.get_logger(__name__)

# Artifact naming convention for Code Focus components
ARTIFACT_PREFIXES = {
    "component": "codefocus_component:",
    "module": "codefocus_module:",
}

# Session state key for the per-component validation log
_TSX_VALIDATION_LOG_KEY = "tsx_component_validation_log"
_MAX_VALIDATION_LOG_ENTRIES = 50

# Per-component semantic failure cap. The LLM gets ``_MAX_SEMANTIC_RETRIES``
# chances to self-correct based on validator feedback; on the next
# attempt past the cap, the auto-fixed TSX is saved with errors
# rebranded as warnings so the build always ships. There is no
# "terminal placeholder" state for non-syntax failures — only esbuild
# parse failure (file unparseable, no JS to ship) escapes via the
# workflow's placeholder-build fallback.
_MAX_SEMANTIC_RETRIES = 1

# Per-component style-coverage failure cap — same contract.
_MAX_STYLE_COVERAGE_RETRIES = 1

# Per-component tsc failure cap — same contract. The LLM gets one
# shot at fixing tsc complaints; on the next attempt, the file ships
# with the type errors rebranded as warnings. Without this cap, a
# Babel-shell sibling mismatch (e.g. ``<Card title="…">`` calling a
# ``Card({label, children})`` declaration in another module) loops
# forever — the per-file ComponentBuilder can only edit one side at
# a time, so retrying the same file never resolves the cross-file
# disagreement and the workflow burns ~$0.07/component before the
# step gives up at the workflow level. See app ``ei57lnqb`` /
# ``kjfd73lw`` Phase 2.5 post-mortems.
_MAX_TSC_RETRIES = 1

# Theme.css artifact name (matches `style_artifact_tools.STYLE_ARTIFACT_PREFIX`).
_THEME_CSS_ARTIFACT = "codefocus_style:theme.css"


def _record_tsx_validation(
    tool_context: ToolContext,
    artifact_filename: str,
    is_valid: bool,
    errors: list[str] | None = None,
    saved: bool = False,
    fixes_applied: list[str] | None = None,
    error_message: str | None = None,
    failure_class: str | None = None,
) -> None:
    """Append a validation entry to the session-state TSX validation log."""
    entry: dict = {
        "artifact_filename": artifact_filename,
        "is_valid": is_valid,
        "saved": saved,
        "timestamp": time.time(),
    }
    if errors:
        entry["validation_errors"] = errors
    if fixes_applied:
        entry["fixes_applied"] = fixes_applied
    if error_message:
        entry["error_message"] = error_message
    if failure_class:
        entry["failure_class"] = failure_class

    log: list = list(tool_context.state.get(_TSX_VALIDATION_LOG_KEY, []))
    log.append(entry)
    if len(log) > _MAX_VALIDATION_LOG_ENTRIES:
        log = log[-_MAX_VALIDATION_LOG_ENTRIES:]
    tool_context.state[_TSX_VALIDATION_LOG_KEY] = log


def _update_component_failure_details(
    tool_context: ToolContext,
    component_name: str,
    detail: dict[str, str],
) -> None:
    """Persist normalized failure details for downstream warning surfacing."""
    failures = dict(tool_context.state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {}))
    failures[component_name] = detail
    tool_context.state[StateKeys.COMPONENT_FAILURE_DETAILS] = failures


def _clear_component_failure_details(tool_context: ToolContext, component_name: str) -> None:
    """Clear any cached failure detail once a component validates successfully."""
    failures = dict(tool_context.state.get(StateKeys.COMPONENT_FAILURE_DETAILS, {}))
    if component_name in failures:
        failures.pop(component_name, None)
        tool_context.state[StateKeys.COMPONENT_FAILURE_DETAILS] = failures


def _apply_unconditional_icon_rescue(
    *,
    component_name: str,
    fixed_code: str,
    fixes: list[str],
) -> tuple[str, list[str]]:
    """Rewrite any unknown ``Icons.X`` references that survived the fix pipeline.

    Crash-class safeguard. Even after the per-fixer rollback (Change A) and
    the post-fix syntax gate, an icon-fallback fix can be discarded if the
    polishing fixer sharing the same pipeline category (urls_images) was
    rolled back, OR if Tier B fired and only partially rescued.

    The rescue is regex-only over ``Icons.PascalCase`` references — pure,
    idempotent, and structurally cannot break JSX. Without it, hallucinated
    names like ``Icons.CircleDollarSign`` ship in the saved file and crash
    the page with React error #130 at first render — the failure mode
    behind app ``ze1ltmf9``.

    Returns:
        ``(fixed_code, fixes)`` — fixed_code is unchanged when no rescue is
        needed; fixes accumulates ``[icon_rescue] ...`` entries when icons
        are scrubbed.
    """
    from main_agent.services.validation.fixers.component_urls_images import (
        apply_icon_fallback_only,
    )

    rescued_code, rescue_fixes = apply_icon_fallback_only(fixed_code)
    if not rescue_fixes:
        return fixed_code, fixes
    new_fixes = list(fixes)
    new_fixes.extend(f"[icon_rescue] {f}" for f in rescue_fixes)
    logger.info(
        "icon_rescue_at_save",
        component=component_name,
        rescued_count=len(rescue_fixes),
    )
    return rescued_code, new_fixes


def _apply_post_fix_syntax_gate(
    *,
    tool_context: ToolContext,
    component_name: str,
    code: str,
    fixed_code: str,
    fixes: list[str],
) -> tuple[str, list[str]]:
    """Verify auto-fixers didn't corrupt JSX between Stage 1 and save.

    Stage 1 (esbuild parse) ran on the original LLM output; some fixers
    do regex/AST splicing that can produce un-parseable JSX (joined
    classNames, mismatched tags). Without this gate, corrupted output
    saves as ``is_valid=true`` and only fails downstream at the backend
    deploy compile step — the failure mode behind app ``xdk89qba``'s
    blue screen.

    Three tiers, each strictly safer than the previous:

    - **A — fixed code parses:** return unchanged.
    - **B — fixed code fails, original parses:** fall back to the
      LLM's pre-fix output. We lose the polishing but keep the model's
      intent. Logged at error level so the offending fixer is
      bisectable from the ``fixes_applied`` list across N corrupted
      saves.
    - **C — both fail:** ship the placeholder TSX (``build_placeholder_component_tsx``)
      so the page still renders. Populate ``UNRESOLVED_COMPONENTS`` so
      the editor flow surfaces the failure on the next turn.
    """
    from main_agent.services.validation.syntax_validator import validate_tsx_syntax

    post_fix_valid, post_fix_errors = validate_tsx_syntax(fixed_code)
    if post_fix_valid:
        return fixed_code, fixes  # Tier A

    original_valid, _ = validate_tsx_syntax(code)
    if original_valid:
        # Tier B — fall back to the LLM's pre-fix output. Before returning,
        # scrub hallucinated ``Icons.X`` names (regex-only, can't break
        # JSX). Without this, names like ``Icons.CircleDollarSign`` survive
        # in the saved file and crash the page at render time with React
        # error #130 ("element type is invalid: got undefined").
        from main_agent.services.validation.fixers.component_urls_images import (
            apply_icon_fallback_only,
        )

        rescued_code, rescue_fixes = apply_icon_fallback_only(code)
        logger.error(
            "auto_fix_corrupted_jsx_recovered",
            component=component_name,
            errors=post_fix_errors[:3],
            fixes_applied=fixes,
            tier_b_rescue_fixes=rescue_fixes,
        )
        return rescued_code, list(rescue_fixes)

    # Tier C — neither version parses. Ship the placeholder.
    from main_agent.agents.orchestrator.app_types.webapp.services.component_failure_service import (
        build_placeholder_component_tsx,
    )

    logger.error(
        "auto_fix_corrupted_jsx_unrecoverable",
        component=component_name,
        post_fix_errors=post_fix_errors[:3],
        fixes_applied=fixes,
    )
    failure_reason = (
        "Auto-fix produced unparseable JSX and the LLM's original output "
        "also failed to parse. Regenerate this component."
    )
    placeholder_tsx = build_placeholder_component_tsx(
        component_name,
        failure_reason,
        failure_class="jsx_syntax_error_post_fix",
    )

    unresolved = dict(tool_context.state.get(StateKeys.UNRESOLVED_COMPONENTS, {}))
    unresolved[component_name] = failure_reason
    tool_context.state[StateKeys.UNRESOLVED_COMPONENTS] = unresolved

    detail = build_failure_detail(post_fix_errors, placeholder_tsx)
    detail["failure_class"] = "jsx_syntax_error_post_fix"
    _update_component_failure_details(tool_context, component_name, detail)

    return placeholder_tsx, []


async def _check_style_coverage(
    tool_context: ToolContext,
    component_name: str,
    filename: str,
    code: str,
) -> tuple[dict | None, list[str]]:
    """Pre-save gate: ensure every custom Tailwind class has a matching @theme token.

    Returns ``(retry_dict, warnings)``:
    - ``(None, [])`` — coverage clean, proceed to save.
    - ``(retry_dict, [])`` — below retry cap, ask the LLM to call
      ``add_theme_tokens`` or rewrite the offending classes.
    - ``(None, warnings)`` — at retry cap, ship the auto-fixed TSX with
      these strings appended to the response's warnings list. The save
      always proceeds; coverage gaps surface visually in the editor.

    Loads ``codefocus_style:theme.css`` via the artifact store. If absent,
    the gate is skipped silently. Design-import bypass: when the workflow
    stored a mechanical-TSX baseline for this component, source HTML's
    authored classnames pass through verbatim.
    """
    from main_agent.services.validation.style_coverage import validate_style_coverage

    if tool_context.state.get(f"_design_import_mechanical_tsx:{component_name}"):
        return None, []

    artifact = await tool_context.load_artifact(filename=_THEME_CSS_ARTIFACT)
    if artifact is None or getattr(artifact, "inline_data", None) is None:
        return None, []

    try:
        theme_css = artifact.inline_data.data.decode("utf-8")
    except Exception:
        return None, []

    warnings = validate_style_coverage({component_name: code}, theme_css)
    if not warnings:
        return None, []

    fail_key = f"_component_style_coverage_failures:{component_name}"
    fail_count = tool_context.state.get(fail_key, 0) + 1
    tool_context.state[fail_key] = fail_count

    formatted = format_validation_errors(warnings, max_errors=5)
    _record_tsx_validation(
        tool_context,
        filename,
        is_valid=False,
        errors=warnings,
        failure_class="style_coverage_undefined_token",
    )

    if fail_count > _MAX_STYLE_COVERAGE_RETRIES:
        # Out of retries — save anyway, surface as warnings.
        logger.warning(
            f"Style coverage cap reached for {component_name} — "
            f"saving with {len(warnings)} coverage warning(s)",
            warnings=warnings[:3],
            attempt=fail_count,
        )
        return None, [f"unresolved style-coverage: {w}" for w in warnings]

    logger.info(
        f"Style coverage gate failed for {component_name}",
        warnings=warnings[:3],
        attempt=fail_count,
        max_retries=_MAX_STYLE_COVERAGE_RETRIES,
    )
    guidance = (
        f"Style coverage errors:\n{formatted}\n\n"
        f"Two valid resolutions:\n"
        f"  1) Call `add_theme_tokens(names=[...], values=[...])` to splice "
        f"the missing tokens into theme.css, then re-save this component.\n"
        f"  2) Replace the offending classes with tokens that already exist "
        f"in `design_system_context.palette`."
    )
    return {"success": False, "error": guidance}, []


def _check_design_import_parity(
    tool_context: ToolContext,
    component_name: str,
    code: str,
) -> dict | None:
    """Hard-block ComponentBuilder edits that drift from the mechanical TSX.

    Reads two pieces of session state:
    - ``_design_import_mechanical_tsx:<component_name>`` — the pre-edit
      TSX produced by the deterministic transformer. The workflow
      pushes this before invoking ComponentBuilder edit mode.
    - ``_validation_context_models`` / ``..._handlers`` — the backend
      surface used for the invented-name detector.

    Returns None when no mechanical-TSX baseline exists (ComponentBuilder
    is running scratch creation or a non-design-import edit). When the
    baseline is present, runs the parity validator and on any violation
    returns a failure dict. The workflow caller catches the failure and
    re-saves the mechanical TSX directly.
    """
    state_key = f"_design_import_mechanical_tsx:{component_name}"
    before_tsx = tool_context.state.get(state_key, "")
    if not before_tsx:
        return None

    from main_agent.services.validation.design_import_parity import check_parity

    backend_surface: dict[str, list] = {
        "models": tool_context.state.get("_validation_context_models", []) or [],
        "handlers": tool_context.state.get("_validation_context_handlers", []) or [],
    }

    result = check_parity(
        before_tsx=before_tsx,
        after_tsx=code,
        backend_surface=backend_surface,
    )
    if result.passed:
        return None

    summary = "; ".join(f"[{v.code}] {v.message}" for v in result.violations[:5])
    if len(result.violations) > 5:
        summary += f" (+{len(result.violations) - 5} more)"
    logger.warning(
        "design_import_parity_failed",
        component_name=component_name,
        violation_count=len(result.violations),
        codes=sorted({v.code for v in result.violations}),
    )
    return {
        "success": False,
        "error": (
            f"design_import_parity: ComponentBuilder edit drifted from the "
            f"mechanical-pipeline baseline. The workflow will restore the "
            f"pre-edit TSX so the static-but-correct version ships. "
            f"Violations: {summary}"
        ),
        "failure_class": "design_import_parity",
        "terminal": True,
    }


async def validate_and_save_tsx_component_artifact(
    tool_context: ToolContext,
    code: str,
    component_name: str,
) -> dict:
    """
    Validate and save generated Code Focus component code as an artifact.

    Runs syntax and semantic validation before saving. If validation fails,
    returns errors so you can fix the code and call this tool again.

    Args:
        code: Complete component TSX code string
        component_name: PascalCase component name (e.g., "HomeContent", "DashboardSidebar")

    Returns:
        Dict with save status. On failure: {"success": false, "error": "..."}.
        On success: {"success": true, "artifact_filename": "...", "version": N, "checks_passed": [...], "warnings": [...]}.
    """
    return await _validate_and_save_tsx_artifact_impl(
        tool_context,
        code,
        component_name,
        artifact_prefix=ARTIFACT_PREFIXES["component"],
        enforce_default_export=True,
    )


async def validate_and_save_tsx_module_artifact(
    tool_context: ToolContext,
    code: str,
    module_name: str,
) -> dict:
    """
    Validate and save a Babel-shell SUPPORTING MODULE as a TSX artifact.

    Used in Phase 2 per-module Babel-shell edits when the entry component
    declares `supporting_modules` in `repo.frontend.components[<name>]`. The
    module is bundled into the entry's compiled JS at deploy time via
    esbuild — DO NOT add `export default`. Use NAMED exports only:
    ``export function Sidebar() {}``, ``export const HBars = ...``,
    ``export class DataLib {}``.

    Same validation pipeline as the component tool (esbuild syntax, tsc,
    auto-fixes, semantic checks, style coverage). The only differences:
    saves to ``codefocus_module:<name>.tsx`` and skips the
    ``export default function {name}`` name check (modules don't have a
    default export).

    Args:
        code: Complete module TSX code string with named exports.
        module_name: PascalCase module name matching one of the entry's
            ``supporting_modules`` (e.g., "Charts", "Sidebar", "DataLib").

    Returns:
        Same shape as ``validate_and_save_tsx_component_artifact``.
    """
    return await _validate_and_save_tsx_artifact_impl(
        tool_context,
        code,
        module_name,
        artifact_prefix=ARTIFACT_PREFIXES["module"],
        enforce_default_export=False,
    )


async def _validate_and_save_tsx_artifact_impl(
    tool_context: ToolContext,
    code: str,
    component_name: str,
    *,
    artifact_prefix: str,
    enforce_default_export: bool,
) -> dict:
    """Shared validate-and-save pipeline for components AND supporting modules.

    The two public tools (``validate_and_save_tsx_component_artifact`` and
    ``validate_and_save_tsx_module_artifact``) delegate to this impl with
    different ``artifact_prefix`` + ``enforce_default_export`` settings.

    Side effects (validation log, failure detail tracking, retry counters)
    are keyed by ``component_name`` regardless of artifact kind so the
    save-tool guardrail and per-component retry caps work uniformly.
    """
    # Hard path-traversal gate: component_name is a free-form LLM tool-call field
    # that becomes a filename here and, during tsc validation, a file ON DISK.
    # Reject anything that isn't a bare identifier before it can be persisted or
    # written (e.g. `../../../../tmp/pwned`).
    if not is_safe_artifact_name(component_name):
        return {
            "success": False,
            "error": (
                f"Invalid component name {component_name!r}: must be a bare "
                "identifier (letters, digits, underscore; no path separators)."
            ),
        }

    filename = f"{artifact_prefix}{component_name}.tsx"
    fail_key = f"_component_semantic_failures:{component_name}"

    try:
        # ── 0. Stringified-JSX healer ─────────────────────────────────
        # Gemini occasionally over-escapes quotes when emitting TSX in
        # tool-call responses, producing ``className=\\"x\\"`` literal
        # backslash-quote characters. esbuild rejects this. The healer
        # detects the systematic bug shape and unescapes the whole file
        # before validation. When the bug is absent, the file passes
        # through untouched.
        from main_agent.services.validation.jsx_quote_unescape import unescape_jsx_quotes

        code, unescape_count = unescape_jsx_quotes(code)
        if unescape_count:
            logger.info(
                f"jsx_quote_unescape: repaired {unescape_count} over-escaped "
                f'\\" in {component_name} before Stage 1'
            )

        # ── 1. Syntax validation (esbuild parse) ──────────────────────
        from main_agent.services.validation.syntax_validator import validate_tsx_syntax

        # esbuild is a synchronous subprocess (up to 10s). Offload it to a worker
        # thread so it does not freeze the single asyncio event loop — otherwise
        # each parallel ComponentBuilder slot's save serializes on the loop and
        # the /cancel watchdog + /health stall for the duration.
        valid, syntax_errors = await asyncio.to_thread(validate_tsx_syntax, code)
        if not valid:
            detail = build_failure_detail(syntax_errors, code)
            _update_component_failure_details(tool_context, component_name, detail)
            formatted = format_validation_errors(syntax_errors, max_errors=5)
            logger.info(
                f"TSX syntax validation failed for {component_name}",
                errors=syntax_errors[:3],
                failure_class=detail["failure_class"],
            )
            _record_tsx_validation(
                tool_context,
                filename,
                is_valid=False,
                errors=syntax_errors,
                failure_class=detail["failure_class"],
            )
            # esbuild parse fail is the one terminal class — file is
            # literally unparseable, no JS to ship. The workflow's
            # placeholder-build at creation_workflow.py catches the
            # missing artifact and ships the "needs your attention"
            # card. Don't escalate here; let the LLM take its retry.
            return {"success": False, "error": f"Syntax errors — fix and retry:\n{formatted}"}

        # ── 1b. Export name validation (context-bleed guard) ──────────
        # Only enforced for entry components — supporting modules use
        # named exports and have no `export default`.
        export_match = re.search(r"export\s+default\s+function\s+(\w+)", code)
        if enforce_default_export and export_match:
            actual_name = export_match.group(1)
            if actual_name != component_name:
                detail = build_failure_detail(
                    [f"Export name '{actual_name}' doesn't match '{component_name}'"],
                    code,
                )
                _update_component_failure_details(tool_context, component_name, detail)
                logger.warning(
                    "Export name mismatch in component",
                    component_name=component_name,
                    actual_export=actual_name,
                )
                _record_tsx_validation(
                    tool_context,
                    filename,
                    is_valid=False,
                    errors=[f"Export name '{actual_name}' doesn't match '{component_name}'"],
                    failure_class=detail["failure_class"],
                )
                return {
                    "success": False,
                    "error": (
                        f"Wrong component: your code exports '{actual_name}' "
                        f"but you must generate '{component_name}'. "
                        f"Write the CORRECT component for '{component_name}' — "
                        f"do NOT reuse code from a previous component."
                    ),
                }

        # ── 1.5. tsc --noEmit type check (Phase 2 gate) ───────────────
        # Generates a per-app .d.ts from the workflow's backend / logic /
        # pages manifests and runs `tsc --noEmit` against the component +
        # SDK type bundle. Catches model / handler / icon / state-key /
        # route typos at compile time, replacing the catalog of
        # cross-reference AST rules. Fails open when `tsc` isn't on PATH
        # (local dev without Node.js).
        from main_agent.services.validation.syntax_validator import validate_tsx_with_tsc
        from main_agent.services.validation.tsc_validator.dts_generator import (
            generate_app_dts,
        )

        backend_for_dts = {
            "models": tool_context.state.get("_validation_context_models", []),
            "handlers": tool_context.state.get("_validation_context_handlers", []),
        }
        logic_for_dts = tool_context.state.get("_validation_context_logic", {}) or {}
        # The page-slug list is just a list of strings; wrap each in the
        # ``{"slug": ...}`` shape ``generate_app_dts`` expects.
        pages_for_dts = [
            {"slug": s}
            for s in (tool_context.state.get("_validation_context_page_slugs", []) or [])
            if isinstance(s, str)
        ]
        services_for_dts = tool_context.state.get("_validation_context_services", {}) or {}
        app_dts = generate_app_dts(
            backend=backend_for_dts,
            logic=logic_for_dts,
            pages=pages_for_dts,
            services=services_for_dts,
        )
        # Babel-shell sibling map: when the workflow emitted multiple
        # per-module TSX artifacts, cross-file imports (``./Data``,
        # ``./Charts`` …) need the sibling TSX staged alongside the
        # target so tsc resolves them on disk instead of emitting TS2307
        # false positives. We filter the target itself out of the dict
        # defensively (run_tsc_check would skip it anyway).
        sibling_modules_map = tool_context.state.get("_codefocus_sibling_modules") or {}
        if not isinstance(sibling_modules_map, dict):
            sibling_modules_map = {}
        sibling_modules_for_tsc = {
            name: src
            for name, src in sibling_modules_map.items()
            if isinstance(name, str) and name != component_name
        }
        # tsc --noEmit is a synchronous subprocess (up to 10s); offload to a
        # worker thread so the type-check does not block the event loop and the
        # parallel save slots keep their concurrency.
        tsc_findings = await asyncio.to_thread(
            validate_tsx_with_tsc,
            tsx_source=code,
            component_name=component_name,
            app_dts=app_dts,
            sibling_modules=sibling_modules_for_tsc or None,
        )
        # Stash tsc messages for the warnings list when the retry cap is
        # exceeded — collected here so the variable is in scope below
        # even if the gate passes.
        tsc_unresolved_warnings: list[str] = []
        if tsc_findings:
            tsc_messages = [
                f"{f.message} (tsc {f.rule_id} at line {f.line}:{f.col})" for f in tsc_findings[:5]
            ]
            tsc_fail_key = f"_component_tsc_failures:{component_name}"
            tsc_fail_count = tool_context.state.get(tsc_fail_key, 0) + 1
            tool_context.state[tsc_fail_key] = tsc_fail_count
            detail = build_failure_detail(tsc_messages, code)
            _update_component_failure_details(tool_context, component_name, detail)

            if tsc_fail_count > _MAX_TSC_RETRIES:
                # Out of retries — ship the file anyway with type errors
                # rebranded as warnings. Same contract as the semantic
                # and style-coverage gates. The user iterates on the
                # remaining errors via the editor flow.
                logger.warning(
                    f"tsc retry cap reached for {component_name} — "
                    f"saving with {len(tsc_findings)} type error(s) as warnings",
                    errors=tsc_messages[:3],
                    attempt=tsc_fail_count,
                    failure_class=detail["failure_class"],
                )
                tsc_unresolved_warnings = [f"unresolved tsc: {m}" for m in tsc_messages]
                # Fall through to the auto-fix + semantic stages below.
            else:
                formatted = format_validation_errors(tsc_messages, max_errors=5)
                logger.info(
                    f"TypeScript validation failed for {component_name}",
                    errors=tsc_messages[:3],
                    attempt=tsc_fail_count,
                    max_retries=_MAX_TSC_RETRIES,
                    failure_class=detail["failure_class"],
                )
                _record_tsx_validation(
                    tool_context,
                    filename,
                    is_valid=False,
                    errors=tsc_messages,
                    failure_class=detail["failure_class"],
                )
                return {
                    "success": False,
                    "error": f"TypeScript errors — fix and retry:\n{formatted}",
                }

        # ── 2. Semantic auto-fixes (deterministic rewrites) ───────────
        from main_agent.services.validation.fixers import apply_auto_fixes
        from main_agent.agents.utils.image_generation_utils import should_strip_llm_image_urls
        from main_agent.services.validation.semantic_validator import run_semantic_checks

        models = tool_context.state.get("_validation_context_models", [])
        handlers = tool_context.state.get("_validation_context_handlers", [])
        # Optional — handler TSX sources keyed by name. Populated by
        # editing_workflow's setup phase after source rehydration. Used by
        # cross-reference rules (chart dataKey vs handler return shape).
        handler_sources = tool_context.state.get("_validation_context_handler_sources") or {}
        logic = tool_context.state.get("_validation_context_logic", {})
        page_slugs = tool_context.state.get("_validation_context_page_slugs", [])
        theme_palette = (
            tool_context.state.get("_validation_context_theme_palette")
            or tool_context.state.get(StateKeys.RESOLVED_THEME_PALETTE)
            or {}
        )
        state_keys = logic.get("state", {}) if isinstance(logic, dict) else {}
        security_enabled = bool(
            tool_context.state.get("_validation_context_security_enabled", False)
        )

        # The fixer pipeline re-parses its output with esbuild after every
        # fixer (per-fixer rollback), i.e. many blocking subprocess.run
        # calls per save. Offload the whole deterministic pass so the single
        # asyncio event loop isn't frozen during it.
        fixed_code, fixes = await asyncio.to_thread(
            apply_auto_fixes,
            code,
            models,
            {},
            state_keys,
            handlers=handlers,
            page_slugs=page_slugs,
            theme_palette=theme_palette,
            stock_provider_configured=should_strip_llm_image_urls(),
            security_enabled=security_enabled,
        )
        if fixes:
            logger.info(
                f"Auto-fixed {len(fixes)} issue(s) in {component_name}",
                fixes=fixes[:5],
            )

        # ── 2.4. SDK barrel → subpath import split (deploy optimization) ─
        # Rewrite ``import { … } from '@exepad/sdk'`` into per-subpath imports
        # so a core-only page never downloads/parses the 443 KB-gzip monolith.
        # Deliberately NOT a fixer in apply_auto_fixes (that must stay minimal/
        # idempotent); it runs here, before the syntax gate + semantic checks
        # validate the saved code. No-op when disabled / no routing table /
        # nothing routable — and a missed path degrades safely to the barrel.
        from main_agent.services.validation.fixers.component_sdk_subpaths import (
            split_sdk_barrel,
        )

        split_code, split_fixes = split_sdk_barrel(fixed_code)
        if split_fixes:
            fixed_code = split_code
            fixes.extend(split_fixes)
            logger.info(
                f"Split @exepad/sdk imports in {component_name}",
                subpaths=split_fixes[0],
            )

        # ── 2.5. Post-auto-fix syntax gate ────────────────────────────
        # Stage 1 (esbuild) ran on the original LLM output; some fixers
        # do regex/AST splicing that can produce un-parseable JSX.
        # Re-validate ``fixed_code``; on failure, fall back to the
        # original LLM source or the placeholder card. See app
        # ``xdk89qba`` post-mortem.
        # The post-fix gate re-parses both the fixed and (on failure) the
        # original source with esbuild — blocking subprocess calls. Offload
        # it so validation doesn't freeze the event loop.
        fixed_code, fixes = await asyncio.to_thread(
            _apply_post_fix_syntax_gate,
            tool_context=tool_context,
            component_name=component_name,
            code=code,
            fixed_code=fixed_code,
            fixes=fixes,
        )

        # ── 2.6. Unconditional icon rescue ───────────────────────────
        # See ``_apply_unconditional_icon_rescue`` for the rationale.
        # Crash-class safeguard against React error #130 — must run on
        # every save path, not just Tier B fallback.
        fixed_code, fixes = _apply_unconditional_icon_rescue(
            component_name=component_name,
            fixed_code=fixed_code,
            fixes=fixes,
        )

        # ── 3. Semantic checks (blocking errors + warnings) ──────────
        # ``expected_component_name`` forwarded so structlog labels the
        # check with the actual component name instead of "unknown" —
        # closes RC4 logging gap from the Onix Studio investigation.
        result = run_semantic_checks(
            fixed_code,
            models,
            logic,
            page_slugs,
            expected_component_name=component_name,
            handlers=handlers,
            theme_palette=theme_palette,
            handler_sources=handler_sources,
            stock_provider_configured=should_strip_llm_image_urls(),
        )
        if not result.valid:
            fail_count = tool_context.state.get(fail_key, 0) + 1
            tool_context.state[fail_key] = fail_count
            detail = build_failure_detail(result.errors, fixed_code)
            _update_component_failure_details(tool_context, component_name, detail)

            if fail_count > _MAX_SEMANTIC_RETRIES:
                # Out of retries — save anyway with errors rebranded as
                # warnings. Component ships as the LLM's last attempt;
                # the user iterates in the editor flow.
                logger.warning(
                    f"Semantic retry cap reached for {component_name} — "
                    f"saving auto-fixed TSX with errors rebranded as warnings",
                    errors=result.errors[:3],
                    attempt=fail_count,
                    failure_class=detail["failure_class"],
                )
                rebranded = [f"unresolved: {e}" for e in result.errors]
                result.warnings = list(result.warnings) + rebranded
                result.errors = []
                # Fall through to save path below.
            else:
                # Below cap — return retry feedback to the LLM.
                formatted = format_validation_errors(result.errors, max_errors=5)
                logger.info(
                    f"Semantic validation failed for {component_name}",
                    errors=result.errors[:3],
                    attempt=fail_count,
                    max_retries=_MAX_SEMANTIC_RETRIES,
                    failure_class=detail["failure_class"],
                )
                _record_tsx_validation(
                    tool_context,
                    filename,
                    is_valid=False,
                    errors=result.errors,
                    failure_class=detail["failure_class"],
                )
                if any("ExepadImage" in e for e in result.errors):
                    formatted += (
                        '\n\nREMINDER: Every <ExepadImage> MUST have keywords="..." '
                        "(5+ word English search query) and importance={1-10}."
                    )

                # Pattern A: record the attempt + auto-fixed TSX so the
                # next turn anchors on the prior baseline.
                from main_agent.agents.orchestrator.app_types.webapp.services import (
                    retry_context_service as rcs,
                )
                from main_agent.agents.utils.retry_feedback import build_retry_feedback

                error_categories = rcs.categorize_errors_by_api_id(result.errors)
                rcs.record_attempt(
                    tool_context.state,
                    component_name,
                    auto_fixed_tsx=fixed_code,
                    auto_fixes_categorized=rcs.categorize_fixes(fixes),
                    errors_categorized=error_categories,
                    error_summaries=result.errors,
                    final_status="semantic_fail",
                )
                addendum = build_retry_feedback(
                    state=tool_context.state,
                    component_name=component_name,
                    current_errors=result.errors,
                    auto_fixed_tsx=fixed_code,
                    fail_count=fail_count,
                    max_retries=_MAX_SEMANTIC_RETRIES,
                )
                if addendum:
                    formatted = formatted + "\n\n" + addendum

                return {"success": False, "error": f"Semantic errors — fix and retry:\n{formatted}"}

        # ── 3.5. Style coverage gate ─────────────────────────────────
        #
        # Verify every custom Tailwind class in the TSX has a matching
        # `@theme` token. Below cap → retry; at cap → ship the
        # auto-fixed TSX with coverage gaps surfaced as warnings.
        coverage_retry, coverage_warnings = await _check_style_coverage(
            tool_context,
            component_name,
            filename,
            fixed_code,
        )
        if coverage_retry is not None:
            return coverage_retry
        if coverage_warnings:
            result.warnings = list(result.warnings) + coverage_warnings
        if tsc_unresolved_warnings:
            result.warnings = list(result.warnings) + tsc_unresolved_warnings

        # ── 3.6. Design-import parity gate ───────────────────────────
        #
        # Compare the saved TSX to the pre-edit mechanical TSX baseline
        # when one exists. Hard-block any drift outside the surgical
        # plan-item edits — the workflow caller catches the failure
        # and re-saves the mechanical TSX directly.
        parity_response = _check_design_import_parity(
            tool_context,
            component_name,
            fixed_code,
        )
        if parity_response is not None:
            return parity_response

        # ── 4. Save artifact ─────────────────────────────────────────
        # Post-save sibling refresh: keep `_codefocus_sibling_modules`
        # in sync so subsequent saves/edits in this same agent turn see
        # the freshly-saved peer source (full mutual visibility under
        # tsc and the dependency graph).
        _refresh_sibling_modules(tool_context, filename, fixed_code)
        _clear_component_failure_details(tool_context, component_name)
        # Style coverage passed — reset its retry counter for this component.
        # ADK's `State` wrapper supports `__setitem__` but not `pop`/`del`;
        # setting to 0 is functionally equivalent because the counter logic
        # uses `state.get(key, 0) + 1` on the next failure.
        tool_context.state[f"_component_style_coverage_failures:{component_name}"] = 0
        # Reset the tsc retry counter on success — same rationale as the
        # style-coverage reset above (ADK State doesn't support pop/del).
        tool_context.state[f"_component_tsc_failures:{component_name}"] = 0
        # Pattern A: drop the retry-context history on success so future
        # edits to this component start fresh.
        from main_agent.agents.orchestrator.app_types.webapp.services import (
            retry_context_service as rcs,
        )

        rcs.clear_retry_context(tool_context.state, component_name)
        code_bytes = fixed_code.encode("utf-8")
        artifact = genai.types.Part.from_bytes(data=code_bytes, mime_type="text/plain")
        version = await tool_context.save_artifact(filename=filename, artifact=artifact)

        checks_passed = ["syntax", "imports", "forbidden_apis", "hooks"]
        if models:
            checks_passed.append("model_refs")

        logger.info(
            "TSX component validated and saved",
            component=component_name,
            artifact=filename,
            version=version,
            bytes=len(code_bytes),
            auto_fixes=len(fixes),
            warnings=[w[:80] for w in (result.warnings or [])],
            checks_passed=checks_passed,
        )

        _record_tsx_validation(
            tool_context,
            filename,
            is_valid=True,
            saved=True,
            fixes_applied=fixes if fixes else None,
        )

        # Track modified-this-turn for the Tier-2 sweep at end-of-turn.
        _record_artifact_write_kind(tool_context, filename, "modified")

        # ── Tier 1 — dependent revalidation ──────────────────────────
        # Walk the import graph for files that import this one and
        # re-run AST + semantic checks (cheap, no esbuild/tsc) so the
        # agent sees cascade breaks inline. Always advisory: the save
        # itself succeeded.
        dependent_issues: list[dict] = []
        try:
            from main_agent.services.validation.dirty_file_sweeper import (
                revalidate_importers,
            )

            sources = await _gather_artifact_sources(tool_context)
            already_saved = set(tool_context.state.get("_files_modified_this_turn") or []) | set(
                tool_context.state.get("_files_created_this_turn") or []
            )
            tier1_issues = await revalidate_importers(
                filename,
                sources,
                models=models,
                handlers=handlers,
                logic=logic if isinstance(logic, dict) else {},
                page_slugs=page_slugs,
                theme_palette=theme_palette,
                already_saved_this_turn=already_saved,
            )
            for issue in tier1_issues[:10]:
                dependent_issues.append(
                    {
                        "filename": issue.filename,
                        "rule": issue.rule,
                        "line": issue.line,
                        "message": issue.message,
                        "severity": issue.severity,
                    }
                )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "tier1_revalidate_importers_failed",
                component=component_name,
                error=str(exc),
            )

        response: dict = {
            "success": True,
            "artifact_filename": filename,
            "version": version,
            "checks_passed": checks_passed,
        }
        if result.warnings:
            response["warnings"] = result.warnings[:5]
            response["advisory_count"] = len(result.warnings)
        if fixes:
            response["auto_fixes_applied"] = fixes[:5]
        if dependent_issues:
            response["dependent_issues"] = dependent_issues
        return response

    except Exception as e:
        logger.error(f"Failed to validate/save TSX artifact {component_name}: {e}")
        _record_tsx_validation(
            tool_context,
            filename,
            is_valid=False,
            error_message=str(e),
        )
        return {"success": False, "error": str(e)}


# =============================================================================
# Workflow-level save function (for workflows that save artifacts directly)
# =============================================================================


async def save_component_artifact(
    ctx: InvocationContext,
    code: str,
    component_name: str,
) -> Optional[int]:
    """Save component code as an artifact from workflow code (no tool context)."""
    try:
        # Validate export name matches expected component (context-bleed guard)
        export_match = re.search(r"export\s+default\s+function\s+(\w+)", code)
        if export_match:
            actual_name = export_match.group(1)
            if actual_name != component_name:
                logger.error(
                    f"Export name mismatch in workflow save: "
                    f"'{actual_name}' != '{component_name}' — skipping save"
                )
                return None

        prefix = ARTIFACT_PREFIXES["component"]
        filename = f"{prefix}{component_name}.tsx"
        code_bytes = code.encode("utf-8")
        artifact = genai.types.Part.from_bytes(data=code_bytes, mime_type="text/plain")

        version = await ctx.artifact_service.save_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename=filename,
            artifact=artifact,
        )

        logger.info(
            f"Saved Code Focus component artifact: {filename} v{version} "
            f"({len(code_bytes)} bytes)"
        )
        return version
    except Exception as e:
        logger.error(f"Failed to save Code Focus component artifact: {e}")
        return None


# =============================================================================
# Sibling-modules + frontend-prefix helpers (used by save tools and
# by the multi-file coding-agent tools below)
# =============================================================================


_FRONTEND_WRITE_PREFIXES = (
    ARTIFACT_PREFIXES["component"],
    ARTIFACT_PREFIXES["module"],
    "codefocus_style:",
)
_FRONTEND_DELETE_PREFIXES = (
    ARTIFACT_PREFIXES["component"],
    ARTIFACT_PREFIXES["module"],
)


def _is_frontend_write_target(filename: str) -> bool:
    return any(filename.startswith(p) for p in _FRONTEND_WRITE_PREFIXES)


def _is_frontend_delete_target(filename: str) -> bool:
    return any(filename.startswith(p) for p in _FRONTEND_DELETE_PREFIXES)


def _refresh_sibling_modules(tool_context: ToolContext, filename: str, source: str) -> None:
    """Stash the saved source in `_codefocus_sibling_modules` so the
    next save/edit in this same agent turn sees the freshly-written
    peer."""
    siblings = tool_context.state.get("_codefocus_sibling_modules") or {}
    if not isinstance(siblings, dict):
        siblings = {}
    # Tsc + dependency-graph services key by bare component / module
    # name (no prefix, no extension), so strip both.
    base = filename
    for prefix in (ARTIFACT_PREFIXES["component"], ARTIFACT_PREFIXES["module"]):
        if base.startswith(prefix):
            base = base[len(prefix) :]
            break
    if base.endswith(".tsx"):
        base = base[:-4]
    siblings[base] = source
    tool_context.state["_codefocus_sibling_modules"] = siblings


def _drop_sibling_module(tool_context: ToolContext, filename: str) -> None:
    """Remove the artifact from `_codefocus_sibling_modules` after delete."""
    siblings = tool_context.state.get("_codefocus_sibling_modules") or {}
    if not isinstance(siblings, dict):
        return
    base = filename
    for prefix in (ARTIFACT_PREFIXES["component"], ARTIFACT_PREFIXES["module"]):
        if base.startswith(prefix):
            base = base[len(prefix) :]
            break
    if base.endswith(".tsx"):
        base = base[:-4]
    if base in siblings:
        siblings.pop(base, None)
        tool_context.state["_codefocus_sibling_modules"] = siblings


_POLISH_SLOT_NAME_PREFIX = "component_builder_multiple_polish_slot_"


def _record_artifact_write_kind(tool_context: ToolContext, filename: str, kind: str) -> None:
    """Track artifacts created / deleted this agent turn for post-agent bookkeeping.

    Slot-aware when the calling agent is one of the polish pool's slots —
    those run in parallel against the same session state, so a shared
    ``_files_{kind}_this_turn`` list is unsafe (concurrent read-modify-write).
    Per-slot keys eliminate the race. Non-polish callers (creation flow +
    single-action editing) keep writing to the original global key — no
    behavior change.

    The slot identity comes from ``tool_context.agent_name``, which ADK
    populates with the currently-running sub-agent's name; the same hook
    backs ``slot_save_guardrail`` in component_builder_pool.py.
    """
    slot = tool_context.agent_name or ""
    if slot.startswith(_POLISH_SLOT_NAME_PREFIX):
        key = f"_files_{kind}_this_turn__{slot}"
    else:
        key = f"_files_{kind}_this_turn"
    items = list(tool_context.state.get(key) or [])
    if filename not in items:
        items.append(filename)
        tool_context.state[key] = items

    # Inline cross-slot overlap detector. With the edit_artifact_tool
    # ownership gate in place this should be unreachable in practice,
    # but stays as belt-and-suspenders: if a future write path skips
    # the ownership check, the collision is logged the moment it
    # happens (not at round-end, which a WORKFLOW_TIMEOUT cancellation
    # would skip).
    if slot.startswith(_POLISH_SLOT_NAME_PREFIX):
        state = tool_context.state
        for peer_slot in state.get("_polish_active_slots") or []:
            if peer_slot == slot:
                continue
            peer_key = f"_files_{kind}_this_turn__{peer_slot}"
            if filename in (state.get(peer_key) or []):
                logger.warning(
                    "cross_slot_module_overlap_inline",
                    filename=filename,
                    self_slot=slot,
                    peer_slot=peer_slot,
                    kind=kind,
                )


# =============================================================================
# Multi-file coding-agent tools (Glob / Grep / Edit / Delete / Deps /
# SymbolRefs / Describe / InspectState)
#
# These are the new ComponentBuilderMultiple tool surface. They
# operate over the staged frontend artifacts (read from
# tool_context's session-level artifact storage and from
# `_codefocus_sibling_modules`) and never reach into the backend
# namespace.
# =============================================================================


async def _gather_artifact_sources(
    tool_context: ToolContext,
    *,
    name_filter: tuple[str, ...] = (
        "codefocus_component:",
        "codefocus_module:",
        "codefocus_style:",
    ),
) -> dict[str, str]:
    """Return a {filename: source} map of currently-staged frontend artifacts.

    Reads from session-level artifact storage; the
    `_codefocus_sibling_modules` dict (workflow-seeded + post-save
    refreshed) overrides for fresher peer source on the same agent turn.
    """
    out: dict[str, str] = {}
    try:
        names = await tool_context.list_artifacts()
    except Exception:
        names = []
    for filename in names or []:
        if not isinstance(filename, str):
            continue
        if not any(filename.startswith(p) for p in name_filter):
            continue
        try:
            artifact = await tool_context.load_artifact(filename=filename)
        except Exception:
            continue
        if artifact is None or getattr(artifact, "inline_data", None) is None:
            continue
        try:
            out[filename] = artifact.inline_data.data.decode("utf-8", errors="replace")
        except Exception:
            continue

    # Sibling-modules overrides (freshest peer source)
    siblings = tool_context.state.get("_codefocus_sibling_modules") or {}
    if isinstance(siblings, dict):
        for base, src in siblings.items():
            if not isinstance(base, str) or not isinstance(src, str):
                continue
            # The siblings dict is keyed by bare name (no prefix, no .tsx).
            # Try component prefix first; fall back to module prefix.
            for candidate in (
                f"{ARTIFACT_PREFIXES['component']}{base}.tsx",
                f"{ARTIFACT_PREFIXES['module']}{base}.tsx",
            ):
                if candidate in out:
                    out[candidate] = src
                    break
    return out


async def list_artifacts_tool_impl(
    tool_context: ToolContext,
    pattern: str,
) -> dict:
    """Glob — return frontend artifact names matching ``pattern``.

    fnmatch-style glob over artifact names (e.g. ``"codefocus_module:*"``,
    ``"codefocus_component:*Card*"``). Backend prefixes are filtered out
    regardless of the pattern.
    """
    from main_agent.services.artifact_search import list_artifacts_by_pattern

    try:
        names = await tool_context.list_artifacts()
    except Exception as e:
        return {"matches": [], "count": 0, "error": str(e)}
    matches = list_artifacts_by_pattern(pattern, list(names or []))
    return {"matches": matches, "count": len(matches)}


async def search_artifacts_tool_impl(
    tool_context: ToolContext,
    pattern: str,
    name_glob: str = "codefocus_*",
    flags: list[str] | None = None,
    max_results: int = 200,
) -> dict:
    """Grep — regex search across frontend artifact contents."""
    from main_agent.services.artifact_search import search_artifact_contents

    sources = await _gather_artifact_sources(tool_context)
    try:
        hits, truncated = search_artifact_contents(
            pattern,
            sources,
            name_glob=name_glob,
            flags=flags or [],
            max_results=max_results,
        )
    except re.error as e:
        return {"matches": [], "count": 0, "error": f"invalid regex: {e}"}
    payload = [
        {
            "filename": h.filename,
            "line_no": h.line_no,
            "line": h.line,
            "byte_offset": h.byte_offset,
        }
        for h in hits
    ]
    return {"matches": payload, "count": len(payload), "truncated": truncated}


async def discover_dependencies_tool_impl(
    tool_context: ToolContext,
    file_names: list[str],
    direction: str = "both",
    transitive: bool = False,
) -> dict:
    """Walk the import graph across staged frontend artifacts.

    ``direction``: ``"imports"`` | ``"imported_by"`` | ``"both"``.
    """
    from main_agent.services.dependency_graph import build_dependency_graph

    if direction not in ("imports", "imported_by", "both"):
        return {"error": f"direction must be imports|imported_by|both, got {direction!r}"}
    sources = await _gather_artifact_sources(tool_context)
    graph = build_dependency_graph(
        sources,
        file_names=file_names or None,
        direction=direction,  # type: ignore[arg-type]
        transitive=transitive,
    )
    return {"graph": graph}


async def find_symbol_references_tool_impl(
    tool_context: ToolContext,
    symbol: str,
    kinds: list[str] | None = None,
    name_glob: str = "codefocus_*",
) -> dict:
    """TSX-aware symbol lookup across frontend artifacts."""
    from main_agent.services.dependency_graph import find_symbol_references

    if not symbol or not symbol.strip():
        return {"matches": [], "count": 0, "error": "symbol must be non-empty"}
    sources = await _gather_artifact_sources(tool_context)
    hits = find_symbol_references(
        symbol,
        sources,
        kinds=kinds or ["all"],
        name_glob=name_glob,
    )
    payload = [
        {
            "filename": h.filename,
            "line_no": h.line_no,
            "byte_offset": h.byte_offset,
            "kind": h.kind,
            "context_snippet": h.context_snippet,
        }
        for h in hits
    ]
    return {"matches": payload, "count": len(payload)}


async def describe_artifact_tool_impl(
    tool_context: ToolContext,
    filename: str,
) -> dict:
    """Cheap structural AST summary for a single frontend artifact."""
    from main_agent.services.dependency_graph import describe_artifact

    if not _is_frontend_write_target(filename):
        return {
            "error": (f"describe_artifact only works on frontend artifacts; " f"got {filename!r}.")
        }
    sources = await _gather_artifact_sources(tool_context)
    source = sources.get(filename)
    if source is None:
        return {"error": f"artifact {filename!r} not found in session storage"}
    desc = describe_artifact(filename, source)
    return {
        "filename": desc.filename,
        "exports": desc.exports,
        "imports": desc.imports,
        "hooks_used": desc.hooks_used,
        "jsx_root_tag": desc.jsx_root_tag,
        "props_signature": desc.props_signature,
        "state_keys_referenced": desc.state_keys_referenced,
        "lines": desc.lines,
        "bytes": desc.bytes,
    }


async def inspect_app_state_tool_impl(
    tool_context: ToolContext,
    kind: str = "all",
) -> dict:
    """Live read of pages / models / handlers / state keys / components."""
    from main_agent.services.dependency_graph import inspect_app_state

    valid_kinds = {"pages", "models", "handlers", "state_keys", "components", "all"}
    if kind not in valid_kinds:
        return {"error": f"kind must be one of {sorted(valid_kinds)}, got {kind!r}"}

    state = tool_context.state
    # Source of truth: workflow stages backend / logic / page state under the
    # `_validation_context_*` keys before invoking the builder, which is what
    # the existing tsc validator reads.
    backend_config = {
        "models": state.get("_validation_context_models", []) or [],
        "handlers": state.get("_validation_context_handlers", []) or [],
    }
    logic_config = state.get("_validation_context_logic", {}) or {}
    page_slugs = state.get("_validation_context_page_slugs", []) or []
    pages = [
        {"slug": s, "title": s, "uuid": s, "content": []} for s in page_slugs if isinstance(s, str)
    ]
    # Live app_config carries the structured page list — prefer that when present.
    app_config = state.get(StateKeys.APP_CONFIG) or {}
    if isinstance(app_config, dict):
        repo = app_config.get("repo") or {}
        frontend = repo.get("frontend") or {}
        live_pages = frontend.get("pages") or []
        if live_pages:
            pages = list(live_pages)
        components = frontend.get("components") or {}
    else:
        components = {}

    return inspect_app_state(
        kind=kind,  # type: ignore[arg-type]
        backend_config=backend_config or {},
        logic_config=logic_config or {},
        pages=list(pages) if pages else [],
        components=components if isinstance(components, dict) else {},
    )


async def edit_artifact_tool_impl(
    tool_context: ToolContext,
    filename: str,
    old_string: str,
    new_string: str,
    replace_all: bool = False,
) -> dict:
    """Surgical string replace inside a frontend artifact, validated end-to-end.

    Reuses the same validation pipeline as the full save tools (esbuild,
    tsc, AST rules, fixers, semantic, style coverage). Counts as a save
    against the same retry caps.
    """
    from main_agent.services.artifact_search import apply_edit_to_artifact

    if not _is_frontend_write_target(filename):
        return {
            "ok": False,
            "edits_applied": 0,
            "error": (
                f"edit_artifact only writes frontend artifacts "
                f"(codefocus_component:* / codefocus_module:* / codefocus_style:*); "
                f"got {filename!r}. For backend artifacts, use the dedicated "
                f"AddHandlerAction / ModifyHandlerAction / RemoveHandlerAction "
                f"or model actions instead."
            ),
        }

    # Theme.css edits go through add_theme_tokens (narrower, validated splice).
    if filename.startswith("codefocus_style:"):
        return {
            "ok": False,
            "edits_applied": 0,
            "error": (
                "edit_artifact cannot directly edit theme.css. Use "
                "add_theme_tokens(names=[...], values=[...]) for new "
                "tokens, or ModifyStylesAction for whole-theme rewrites."
            ),
        }

    # Polish-pool ownership gate. Slots dispatched in parallel must NOT
    # write outside their owned entry file — last-writer-wins on a
    # shared module silently drops peer slots' edits. Workflow seeds
    # _polish_owned_files__<slot> per round in
    # EditingWorkflow._run_phase_frontend_build_parallel_polish; this
    # check enforces it regardless of prompt obedience. Non-polish
    # callers fall through unchanged.
    slot = tool_context.agent_name or ""
    if slot.startswith(_POLISH_SLOT_NAME_PREFIX):
        owned = tool_context.state.get(f"_polish_owned_files__{slot}") or []
        if filename not in owned:
            logger.warning(
                "polish_slot_edit_rejected_out_of_scope",
                slot=slot,
                attempted_filename=filename,
                owned=owned,
            )
            return {
                "ok": False,
                "edits_applied": 0,
                "error": (
                    f"Edits to `{filename}` are not permitted from this polish "
                    f"slot — it owns only {owned}. Treat all other modules as "
                    f"read-only context. Return your final response now."
                ),
                "terminal": True,
            }

    # Load current source
    sources = await _gather_artifact_sources(tool_context)
    source = sources.get(filename)
    if source is None:
        return {
            "ok": False,
            "edits_applied": 0,
            "error": f"artifact {filename!r} not found in session storage",
        }

    splice = apply_edit_to_artifact(
        source,
        old_string=old_string,
        new_string=new_string,
        replace_all=replace_all,
    )
    if not splice.ok:
        return {"ok": False, "edits_applied": 0, "error": splice.error}

    # Determine target kind from prefix and run the full validate-save pipeline.
    if filename.startswith(ARTIFACT_PREFIXES["component"]):
        base = filename[len(ARTIFACT_PREFIXES["component"]) :]
        if base.endswith(".tsx"):
            base = base[:-4]
        save_result = await _validate_and_save_tsx_artifact_impl(
            tool_context,
            splice.new_source,
            base,
            artifact_prefix=ARTIFACT_PREFIXES["component"],
            enforce_default_export=True,
        )
    else:
        base = filename[len(ARTIFACT_PREFIXES["module"]) :]
        if base.endswith(".tsx"):
            base = base[:-4]
        save_result = await _validate_and_save_tsx_artifact_impl(
            tool_context,
            splice.new_source,
            base,
            artifact_prefix=ARTIFACT_PREFIXES["module"],
            enforce_default_export=False,
        )

    if save_result.get("success"):
        edit_response: dict = {
            "ok": True,
            "edits_applied": splice.edits_applied,
            "filename": filename,
            "validation": {
                "checks_passed": save_result.get("checks_passed", []),
                "warnings": save_result.get("warnings", []),
                "auto_fixes_applied": save_result.get("auto_fixes_applied", []),
            },
        }
        if save_result.get("dependent_issues"):
            edit_response["dependent_issues"] = save_result["dependent_issues"]
        return edit_response

    return {
        "ok": False,
        "edits_applied": 0,
        "error": save_result.get("error", "validation failed"),
        "filename": filename,
    }


async def delete_artifact_tool_impl(
    tool_context: ToolContext,
    filename: str,
    reason: str = "",
) -> dict:
    """Delete a frontend `codefocus_component:*` or `codefocus_module:*` artifact.

    Pre-checks:
    1. Filename has an allowed delete prefix.
    2. No remaining importer outside the same-turn delete set
       (prevents orphaning callers).
    """
    if not _is_frontend_delete_target(filename):
        return {
            "deleted": False,
            "error": (
                f"delete_artifact only removes codefocus_component:* / "
                f"codefocus_module:* artifacts; got {filename!r}. Handler "
                f"removal goes through RemoveHandlerAction; theme edits "
                f"through ModifyStylesAction."
            ),
        }

    # Importer pre-check
    from main_agent.services.dependency_graph import build_dependency_graph

    sources = await _gather_artifact_sources(tool_context)
    if filename not in sources:
        return {
            "deleted": False,
            "error": f"artifact {filename!r} not found in session storage",
        }

    graph = build_dependency_graph(
        sources,
        file_names=[filename],
        direction="imported_by",
    )
    importers = graph.get(filename, {}).get("imported_by", [])

    same_turn_deletes = set(tool_context.state.get("_files_deleted_this_turn") or [])
    blocking = [imp for imp in importers if imp not in same_turn_deletes]
    if blocking:
        return {
            "deleted": False,
            "error": (
                f"Cannot delete {filename!r}: still imported by "
                f"{', '.join(sorted(blocking))}. Either edit those importers "
                f"first to drop the dependency, or also delete them in this turn."
            ),
            "importers": sorted(blocking),
        }

    # Perform delete
    try:
        await tool_context.delete_artifact(filename=filename)
    except Exception as e:
        return {"deleted": False, "error": f"delete failed: {e}"}

    _drop_sibling_module(tool_context, filename)
    _record_artifact_write_kind(tool_context, filename, "deleted")
    logger.info(
        "delete_artifact_tool: removed artifact",
        filename=filename,
        reason=reason,
    )
    return {"deleted": True, "filename": filename, "reason": reason}


# =============================================================================
# Register as FunctionTools — agents use these
# =============================================================================

validate_and_save_tsx_component_artifact_tool = FunctionTool(
    validate_and_save_tsx_component_artifact
)

validate_and_save_tsx_module_artifact_tool = FunctionTool(validate_and_save_tsx_module_artifact)

# Multi-file coding-agent surface (ComponentBuilderMultiple)
list_artifacts_tool = FunctionTool(list_artifacts_tool_impl)
search_artifacts_tool = FunctionTool(search_artifacts_tool_impl)
discover_dependencies_tool = FunctionTool(discover_dependencies_tool_impl)
find_symbol_references_tool = FunctionTool(find_symbol_references_tool_impl)
describe_artifact_tool = FunctionTool(describe_artifact_tool_impl)
inspect_app_state_tool = FunctionTool(inspect_app_state_tool_impl)
edit_artifact_tool = FunctionTool(edit_artifact_tool_impl)
delete_artifact_tool = FunctionTool(delete_artifact_tool_impl)
