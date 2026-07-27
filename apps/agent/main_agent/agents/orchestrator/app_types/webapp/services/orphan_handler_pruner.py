"""Post-assembly orphan-handler pruner.

Removes handler entries from the assembled app_config when no generated
component references them. The common offender is a DesignImporter-
declared ``email`` handler for a contact form — the ComponentBuilder
wires those forms to the platform forms endpoint (`fetch('/_forms/submit')`)
instead, leaving the handler compiled to dead JS.

A handler is considered referenced when any saved component TSX contains
``useHandler("name")`` or ``useHandler('name')`` for that handler.
"""

from __future__ import annotations

import re
from typing import Any

import structlog

from main_agent.agents.utils.artifact_manager import ArtifactManager

logger = structlog.get_logger(__name__)


_HANDLER_CONFIG_KEYS: tuple[str, ...] = (
    # Webapp assembly format — handlers live under repo.backend.handlers
    # as a dict keyed by name.
    # Earlier schema variants also stored them as a list under backend.handlers.
    # Prune from whichever shape is actually present.
)


def _collect_handler_names_from_config(app_config: dict[str, Any]) -> list[str]:
    """Return every handler name declared in the assembled config."""
    names: list[str] = []

    repo = app_config.get("repo") or {}
    repo_backend = repo.get("backend") or {}
    repo_handlers = repo_backend.get("handlers")
    if isinstance(repo_handlers, dict):
        names.extend(repo_handlers.keys())
    elif isinstance(repo_handlers, list):
        for h in repo_handlers:
            if isinstance(h, dict) and h.get("name"):
                names.append(h["name"])

    backend = app_config.get("backend") or {}
    backend_handlers = backend.get("handlers")
    if isinstance(backend_handlers, list):
        for h in backend_handlers:
            if isinstance(h, dict) and h.get("name"):
                names.append(h["name"])
    elif isinstance(backend_handlers, dict):
        names.extend(backend_handlers.keys())

    # De-dupe while preserving order.
    seen: set[str] = set()
    ordered: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            ordered.append(n)
    return ordered


def _remove_handler_from_config(app_config: dict[str, Any], name: str) -> None:
    """Drop `name` from every shape of backend.handlers in the config."""
    repo = app_config.get("repo") or {}
    repo_backend = repo.get("backend") or {}
    repo_handlers = repo_backend.get("handlers")
    if isinstance(repo_handlers, dict):
        repo_handlers.pop(name, None)
    elif isinstance(repo_handlers, list):
        repo_backend["handlers"] = [
            h for h in repo_handlers if not (isinstance(h, dict) and h.get("name") == name)
        ]

    backend = app_config.get("backend") or {}
    backend_handlers = backend.get("handlers")
    if isinstance(backend_handlers, list):
        backend["handlers"] = [
            h for h in backend_handlers if not (isinstance(h, dict) and h.get("name") == name)
        ]
    elif isinstance(backend_handlers, dict):
        backend_handlers.pop(name, None)


_USE_HANDLER_RE = re.compile(r"""useHandler\s*\(\s*["']([^"']+)["']""")
_USE_MODEL_RE = re.compile(r"""useModel\s*\(\s*["']([^"']+)["']""")


def _handler_names_referenced_in_tsx(tsx: str) -> set[str]:
    return {m.group(1) for m in _USE_HANDLER_RE.finditer(tsx)}


def _model_names_referenced_in_tsx(tsx: str) -> set[str]:
    return {m.group(1) for m in _USE_MODEL_RE.finditer(tsx)}


async def _load_all_component_tsx(
    ctx,
    component_plans: list[dict],
    *,
    agent_name: str,
) -> dict[str, str]:
    """Load the saved TSX for every component. Missing artifacts → empty."""
    result: dict[str, str] = {}
    for cp in component_plans:
        name = cp.get("name")
        if not name:
            continue
        artifact_key = f"codefocus_component:{name}.tsx"
        try:
            tsx = await ArtifactManager.load_artifact_as_string(ctx, artifact_key)
        except Exception:  # noqa: BLE001
            logger.warning(
                f"[{agent_name}] Could not load component artifact",
                component=name,
            )
            continue
        result[name] = tsx or ""
    return result


async def prune_orphan_handlers(
    ctx,
    app_config: dict[str, Any],
    component_plans: list[dict],
    *,
    agent_name: str = "OrphanPruner",
) -> list[str]:
    """Drop handlers no component references.

    Args:
        ctx: workflow InvocationContext (for artifact_service access).
        app_config: the assembled app config dict — mutated in place.
        component_plans: list of ComponentPlan dicts (used to iterate the
            saved TSX artifacts by component name).

    Returns:
        List of handler names that were pruned (empty when all are
        referenced or no handlers exist).
    """
    declared = _collect_handler_names_from_config(app_config)
    if not declared:
        return []

    tsx_by_component = await _load_all_component_tsx(ctx, component_plans, agent_name=agent_name)
    referenced: set[str] = set()
    for tsx in tsx_by_component.values():
        referenced.update(_handler_names_referenced_in_tsx(tsx))

    orphans = [n for n in declared if n not in referenced]
    for name in orphans:
        _remove_handler_from_config(app_config, name)
    return orphans


def _collect_model_names_from_config(app_config: dict[str, Any]) -> list[str]:
    """Return every model name declared in the assembled config."""
    names: list[str] = []
    for location in (
        (app_config.get("repo") or {}).get("backend") or {},
        app_config.get("backend") or {},
    ):
        models = location.get("models")
        if isinstance(models, list):
            for m in models:
                if isinstance(m, dict) and m.get("name"):
                    names.append(m["name"])
    seen: set[str] = set()
    ordered: list[str] = []
    for n in names:
        if n not in seen:
            seen.add(n)
            ordered.append(n)
    return ordered


async def report_model_usage_consistency(
    ctx,
    app_config: dict[str, Any],
    component_plans: list[dict],
    *,
    agent_name: str = "ModelConsistency",
) -> list[dict[str, Any]]:
    """Warn when a declared model is used by only some of the pages that
    display its entity.

    Classic offender: a marketing site declares a `products` model; the
    homepage wires `useModel('products')` but the dedicated products page
    keeps a hardcoded bento grid (because the layout doesn't fit a
    regular .map). The inconsistency means the products model seeds serve
    half the site — either drop the model from both, or wire both pages
    to it.

    Returns a list of ``{"model": name, "using": [names], "not_using":
    [names]}`` entries; empty list when every declared model is used by
    all or none of the pages. The caller decides what to do with the
    warnings (log, surface in notes.md, or block). We do NOT mutate the
    config — the LLM's decision to keep a page hardcoded is often
    legitimate (irregular layout).
    """
    declared = _collect_model_names_from_config(app_config)
    if not declared:
        return []

    tsx_by_component = await _load_all_component_tsx(ctx, component_plans, agent_name=agent_name)
    if not tsx_by_component:
        return []

    warnings: list[dict[str, Any]] = []
    for model_name in declared:
        using: list[str] = []
        not_using: list[str] = []
        for comp_name, tsx in tsx_by_component.items():
            if model_name in _model_names_referenced_in_tsx(tsx):
                using.append(comp_name)
            elif model_name.lower() in tsx.lower():
                # The component mentions the model's name in copy/HTML
                # but doesn't wire useModel — likely the inconsistency.
                not_using.append(comp_name)
        if using and not_using:
            warnings.append({"model": model_name, "using": using, "not_using": not_using})
            logger.warning(
                f"[{agent_name}] Model '{model_name}' used inconsistently: "
                f"wired in {using}; referenced but not wired in {not_using}. "
                "Consider wiring all pages to useModel OR dropping the model "
                "if the layouts don't support a regular .map().",
            )
    return warnings
