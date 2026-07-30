"""
Dependency map builder for the editing workflow.

Scans current handler + component TSX artifacts to build a three-way
dependency map that the editor agent uses to reason about cascading edits.

- model_to_handlers:      model name -> handlers that reference the table in SQL
- handler_to_components:  handler name -> components that call it via useHandler
- component_to_handlers:  component name -> handlers it calls (inverse)

SQL table references are identified with word-boundary regex against the
standard SQL keywords (FROM/JOIN/INTO/UPDATE/DELETE FROM). Per
BACKEND_HANDLERS_CONFIG.md, table names only appear inside SQL strings
passed to ctx.db.prepare(), so regex is reliable here.
"""

from __future__ import annotations

import asyncio
import re
from typing import TypedDict

import structlog
from google.adk.agents.invocation_context import InvocationContext

from main_agent.agents.utils.artifact_manager import ArtifactManager

logger = structlog.get_logger(__name__)


class DependencyMap(TypedDict):
    model_to_handlers: dict[str, list[str]]
    handler_to_components: dict[str, list[str]]
    component_to_handlers: dict[str, list[str]]


_SQL_TABLE_TEMPLATES = [
    r"\bFROM\s+{table}\b",
    r"\bJOIN\s+{table}\b",
    r"\bINTO\s+{table}\b",
    r"\bUPDATE\s+{table}\b",
    r"\bDELETE\s+FROM\s+{table}\b",
]

# Matches useHandler('name') or useHandler("name"), allowing whitespace.
_USEHANDLER_RE = re.compile(r"""useHandler\s*\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]""")


def _handler_references_table(tsx: str, table_name: str) -> bool:
    """Return True if the TSX contains any SQL reference to `table_name`.

    Case-insensitive (SQL keywords vary in casing). Word-boundary matched.
    """
    if not table_name:
        return False
    escaped = re.escape(table_name)
    for template in _SQL_TABLE_TEMPLATES:
        pattern = template.format(table=escaped)
        if re.search(pattern, tsx, flags=re.IGNORECASE):
            return True
    return False


def _extract_usehandler_names(tsx: str) -> set[str]:
    """Return the set of handler names referenced via useHandler('name') calls.

    Dynamic handler names (e.g. useHandler(variable)) are not detected —
    the editor can fall back to explicit action emission for those cases.
    """
    return set(_USEHANDLER_RE.findall(tsx))


async def build_dependency_map(
    ctx: InvocationContext,
    app_config: dict,
) -> DependencyMap:
    """Scan live artifacts to build a three-way dependency map.

    Cost: O(H + C) artifact loads + one regex scan per artifact. Runs once
    per editing workflow invocation, before the editor agent runs.
    """
    backend = app_config.get("backend", {}) or {}
    models = backend.get("models", []) or []
    handlers = backend.get("handlers", []) or []
    components = ((app_config.get("repo", {}) or {}).get("frontend", {}) or {}).get(
        "components", {}
    ) or {}

    model_names: list[str] = [
        m.get("name", "") for m in models if isinstance(m, dict) and m.get("name")
    ]
    handler_names: list[str] = [
        h.get("name", "") for h in handlers if isinstance(h, dict) and h.get("name")
    ]
    component_names: list[str] = list(components.keys())

    # Load handler + component TSX sources in parallel — O(H + C) round trips
    # collapsed to O(1) via asyncio.gather.
    handler_srcs, component_srcs = await asyncio.gather(
        asyncio.gather(
            *[
                ArtifactManager.load_artifact_as_string(ctx, f"handler_code:{n}.tsx")
                for n in handler_names
            ]
        ),
        asyncio.gather(
            *[
                ArtifactManager.load_artifact_as_string(ctx, f"codefocus_component:{n}.tsx")
                for n in component_names
            ]
        ),
    )
    handler_sources: dict[str, str] = {
        name: src for name, src in zip(handler_names, handler_srcs) if src
    }
    component_sources: dict[str, str] = {
        name: src for name, src in zip(component_names, component_srcs) if src
    }

    # model -> handlers
    model_to_handlers: dict[str, list[str]] = {m: [] for m in model_names}
    for h_name, h_src in handler_sources.items():
        for m_name in model_names:
            if _handler_references_table(h_src, m_name):
                model_to_handlers[m_name].append(h_name)

    # component -> handlers (direct scan)
    handler_set = set(handler_names)
    component_to_handlers: dict[str, list[str]] = {}
    for c_name, c_src in component_sources.items():
        refs = _extract_usehandler_names(c_src) & handler_set
        if refs:
            component_to_handlers[c_name] = sorted(refs)

    # handler -> components (invert)
    handler_to_components: dict[str, list[str]] = {h: [] for h in handler_names}
    for c_name, h_list in component_to_handlers.items():
        for h_name in h_list:
            handler_to_components.setdefault(h_name, []).append(c_name)

    logger.info(
        "Built dependency map",
        models=len(model_names),
        handlers=len(handler_names),
        components=len(component_names),
        component_sources_loaded=len(component_sources),
        handler_sources_loaded=len(handler_sources),
    )

    return DependencyMap(
        model_to_handlers=model_to_handlers,
        handler_to_components=handler_to_components,
        component_to_handlers=component_to_handlers,
    )
