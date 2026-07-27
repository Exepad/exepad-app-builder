"""Cross-file revalidation for ComponentBuilderMultiple.

Two tiers:

- ``revalidate_importers`` (Tier 1) — cheap AST + semantic-only sweep over
  the saved file's importers. Called from inside each save / edit tool so
  the agent sees cascade breaks inline as ``dependent_issues``.

- ``sweep_dirty_files`` (Tier 2) — full pipeline (esbuild + auto-fixers +
  semantic + style coverage) over the dirty set after the agent ends its
  turn. Drives the fix-up retry loop in the frontend_build dispatcher.

- ``render_fix_up_prompt`` formats Tier-2 issues into a follow-up prompt
  for re-invoking ComponentBuilderMultiple.

Both helpers reuse the existing pipeline modules — never duplicate
validator logic. Backend artifacts (``handler_code:*``) are excluded.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

import structlog

logger = structlog.get_logger(__name__)


_COMPONENT_PREFIX = "codefocus_component:"
_MODULE_PREFIX = "codefocus_module:"


@dataclass
class DirtyFileIssue:
    filename: str
    rule: str
    line: int | None
    message: str
    severity: Literal["error", "warning"] = "error"


# --------------------------------------------------------------------------- #
# Internal — bare-name conversion + frontend filter
# --------------------------------------------------------------------------- #


def _is_frontend_artifact(name: str) -> bool:
    return name.startswith(_COMPONENT_PREFIX) or name.startswith(_MODULE_PREFIX)


def _bare_name(filename: str) -> str:
    base = filename
    for prefix in (_COMPONENT_PREFIX, _MODULE_PREFIX):
        if base.startswith(prefix):
            base = base[len(prefix) :]
            break
    if base.endswith(".tsx"):
        base = base[:-4]
    return base


def _frontend_only(sources: dict[str, str]) -> dict[str, str]:
    return {n: s for n, s in sources.items() if _is_frontend_artifact(n)}


# --------------------------------------------------------------------------- #
# Tier 1 — revalidate importers (AST + semantic only)
# --------------------------------------------------------------------------- #


async def revalidate_importers(
    saved_filename: str,
    sources: dict[str, str],
    *,
    skip_self: bool = True,
    models: list[dict] | None = None,
    handlers: list[dict] | None = None,
    logic: dict | None = None,
    page_slugs: list[str] | None = None,
    theme_palette: dict[str, str] | None = None,
    already_saved_this_turn: Iterable[str] | None = None,
) -> list[DirtyFileIssue]:
    """Tier 1 — re-run AST rules + semantic checks for files that import
    the saved file.

    Skips esbuild + tsc + auto-fixers for cost; the goal is to surface
    cross-file breakage (e.g. renamed prop on a peer component) so the
    agent can issue a corrective ``edit_artifact`` in the same turn.
    """
    from main_agent.services.dependency_graph import build_dependency_graph
    from main_agent.services.validation.semantic_validator import run_semantic_checks
    from main_agent.agents.utils.image_generation_utils import should_strip_llm_image_urls

    sources = _frontend_only(sources)
    if saved_filename not in sources:
        return []

    graph = build_dependency_graph(sources, file_names=[saved_filename], direction="imported_by")
    importers: list[str] = list(graph.get(saved_filename, {}).get("imported_by", []) or [])
    if skip_self and saved_filename in importers:
        importers.remove(saved_filename)

    skip_set = set(already_saved_this_turn or [])

    issues: list[DirtyFileIssue] = []
    for importer in importers:
        if importer == saved_filename:
            continue
        if importer in skip_set:
            # Already validated by its own save tool; no need to re-check
            continue
        source = sources.get(importer)
        if not source:
            continue
        try:
            result = run_semantic_checks(
                source,
                models or [],
                logic or {},
                page_slugs or [],
                expected_component_name=_bare_name(importer),
                handlers=handlers or [],
                theme_palette=theme_palette or {},
                stock_provider_configured=should_strip_llm_image_urls(),
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning(
                "revalidate_importers_semantic_failed",
                importer=importer,
                error=str(exc),
            )
            continue
        for err in result.errors:
            issues.append(
                DirtyFileIssue(
                    filename=importer,
                    rule="semantic",
                    line=None,
                    message=err,
                    severity="error",
                )
            )
    return issues


# --------------------------------------------------------------------------- #
# Tier 2 — full-pipeline sweep over the dirty set
# --------------------------------------------------------------------------- #


async def sweep_dirty_files(
    dirty_files: Iterable[str],
    sources: dict[str, str],
    *,
    theme_css: str = "",
    models: list[dict] | None = None,
    handlers: list[dict] | None = None,
    logic: dict | None = None,
    page_slugs: list[str] | None = None,
    theme_palette: dict[str, str] | None = None,
    expand_to_importers: bool = True,
) -> dict[str, list[DirtyFileIssue]]:
    """Tier 2 — full pipeline over dirty + their importers.

    Pipeline per file:
      1. esbuild syntax (cheap parse)
      2. apply_auto_fixes (deterministic — but we DO NOT save)
      3. semantic checks
      4. style coverage when theme_css provided

    tsc is intentionally skipped: the dirty set's tsc runs already
    occurred at save time with the latest siblings; firing tsc again
    here doubles cost without new signal.
    """
    from main_agent.services.dependency_graph import build_dependency_graph
    from main_agent.services.validation.fixers import apply_auto_fixes
    from main_agent.agents.utils.image_generation_utils import should_strip_llm_image_urls
    from main_agent.services.validation.semantic_validator import run_semantic_checks
    from main_agent.services.validation.style_coverage import validate_style_coverage
    from main_agent.services.validation.syntax_validator import validate_tsx_syntax

    sources = _frontend_only(sources)
    dirty: set[str] = {f for f in dirty_files if f in sources}
    if expand_to_importers and dirty:
        graph = build_dependency_graph(sources, file_names=list(dirty), direction="imported_by")
        for f in list(dirty):
            for importer in graph.get(f, {}).get("imported_by", []) or []:
                dirty.add(importer)

    state_keys = (logic or {}).get("state", {}) if isinstance(logic, dict) else {}

    out: dict[str, list[DirtyFileIssue]] = {}
    for filename in sorted(dirty):
        source = sources.get(filename)
        if source is None:
            continue
        component_name = _bare_name(filename)
        issues: list[DirtyFileIssue] = []

        # 1. Syntax
        try:
            # esbuild is a blocking subprocess — offload it so this sweep
            # (which runs after the agent's turn, over the whole dirty set)
            # doesn't freeze the event loop / /health per file.
            valid, syntax_errors = await asyncio.to_thread(validate_tsx_syntax, source)
        except Exception as exc:  # pragma: no cover
            valid, syntax_errors = False, [f"syntax check crashed: {exc}"]
        if not valid:
            for err in syntax_errors:
                issues.append(
                    DirtyFileIssue(
                        filename=filename,
                        rule="syntax",
                        line=None,
                        message=err,
                        severity="error",
                    )
                )
            # No point running downstream stages on un-parseable JSX.
            if issues:
                out[filename] = issues
            continue

        # 2. Auto-fixes (don't persist)
        try:
            # The fixer pipeline re-parses with esbuild after each fixer;
            # offload the blocking subprocess work off the event loop.
            fixed_source, _fixes = await asyncio.to_thread(
                apply_auto_fixes,
                source,
                models or [],
                {},
                state_keys,
                handlers=handlers or [],
                page_slugs=page_slugs or [],
                theme_palette=theme_palette or {},
                stock_provider_configured=should_strip_llm_image_urls(),
            )
        except Exception:
            fixed_source = source

        # 3. Semantic
        try:
            result = run_semantic_checks(
                fixed_source,
                models or [],
                logic or {},
                page_slugs or [],
                expected_component_name=component_name,
                handlers=handlers or [],
                theme_palette=theme_palette or {},
                stock_provider_configured=should_strip_llm_image_urls(),
            )
            for err in result.errors:
                issues.append(
                    DirtyFileIssue(
                        filename=filename,
                        rule="semantic",
                        line=None,
                        message=err,
                        severity="error",
                    )
                )
        except Exception as exc:  # pragma: no cover
            issues.append(
                DirtyFileIssue(
                    filename=filename,
                    rule="semantic",
                    line=None,
                    message=f"semantic check crashed: {exc}",
                    severity="error",
                )
            )

        # 4. Style coverage
        if theme_css:
            try:
                coverage_warnings = validate_style_coverage(
                    {component_name: fixed_source}, theme_css
                )
                for w in coverage_warnings:
                    issues.append(
                        DirtyFileIssue(
                            filename=filename,
                            rule="style_coverage",
                            line=None,
                            message=w,
                            severity="warning",
                        )
                    )
            except Exception:  # pragma: no cover
                pass

        if issues:
            out[filename] = issues
    return out


# --------------------------------------------------------------------------- #
# Fix-up prompt rendering
# --------------------------------------------------------------------------- #


def render_fix_up_prompt(
    original_prompt: str,
    issues: dict[str, list[DirtyFileIssue]],
) -> str:
    """Format a follow-up prompt body for ComponentBuilderMultiple.

    The original action prompt is included verbatim at the top so the
    agent retains the goal context; the issues list is appended in a
    "fix these" block. Errors first, warnings last.
    """
    # Warnings deliberately omitted from the fix-up prompt — the tier2
    # loop is gated by ``error_count > 0`` (see editing_workflow.py
    # ``_run_tier2_fix_up_loop``), so warnings never trigger a retry on
    # their own. Including them in the prompt body when the retry runs
    # for unrelated errors sends the LLM iterating on issues it can't
    # fix without changing semantics (e.g., unwired ``<button>`` warnings
    # for which no handler model exists). App ckfk4mun (2026-05-18)
    # logged the same ``<button>...has no onClick/href/type=submit``
    # warning across 4 semantic-check passes while the polish dispatch
    # burned through 45 tool calls trying — and failing — to address it.
    errors_by_file = {
        filename: [i for i in file_issues if i.severity == "error"]
        for filename, file_issues in issues.items()
    }
    errors_by_file = {f: lst for f, lst in errors_by_file.items() if lst}
    if not errors_by_file:
        return original_prompt

    lines: list[str] = []
    lines.append(
        "Your previous edits left validation errors. Fix them now using "
        "edit_artifact (preferred for surgical fixes) or full save (for "
        "rewrites). Each save runs the full validation pipeline."
    )
    lines.append("")
    for filename in sorted(errors_by_file):
        errors = errors_by_file[filename]
        lines.append(f"File: {filename}")
        lines.append("  Errors:")
        for issue in errors:
            loc = f"line {issue.line}: " if issue.line else ""
            lines.append(f"    - [{issue.rule}] {loc}{issue.message}")
        lines.append("")

    fix_up_block = "\n".join(lines).rstrip()
    return f"{original_prompt}\n\n" f"--- FIX-UP PASS ---\n" f"{fix_up_block}"


__all__ = [
    "DirtyFileIssue",
    "revalidate_importers",
    "sweep_dirty_files",
    "render_fix_up_prompt",
]
