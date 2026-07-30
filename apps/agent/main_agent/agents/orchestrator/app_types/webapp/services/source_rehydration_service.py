"""
Source rehydration service for the editing workflow.

Populates the ADK artifact store at the top of each edit turn from the
prior build's sources, which the runtime worker ships inline in the ``/r``
request payload (self-host has no shared durable store between the worker
and the agent). The ADK artifact store starts empty each turn (in-memory,
fresh session), so downstream consumers (dependency map builder, selected
component loader, batch validator, modify-component phase, style coverage
validator, seed artifact tools) rely on this service to make the prior
app's sources available via ``ArtifactManager.load_artifact_as_string``.

Payload contract
----------------
The worker sends ``payload.source_files`` — a flat dict mapping each
referenced **relative source path** (exactly the ``source`` paths recorded
in ``app_config``) to its text content. The agent seeds this verbatim into
session state under the ``source_files`` key (see ``agent_api.py`` payload
seeding). This service maps each ``app_config`` repo entry's ``source``
path to its bytes in that dict and writes the corresponding ADK artifact:

- ``repo.frontend.components[name].source`` → ``codefocus_component:{name}.tsx``
- ``repo.backend.handlers[name].source`` → ``handler_code:{name}.tsx``
- ``repo.seed[name].source`` → ``seed:{name}.csv``
- Theme CSS (fixed ``code/frontend/styles/theme.css``) → ``codefocus_style:theme.css``
- Compiled CSS (fixed ``compiled/frontend/styles/compiled.css``) → ``codefocus_style:compiled.css``

A component whose source is absent from the payload is rehydrated as a
minimal empty stub so the edit workflow can proceed; handlers/seeds/styles
without a source are simply reported missing.
"""

from __future__ import annotations

import asyncio
from typing import Any, Optional

import structlog
from google import genai
from google.adk.agents.invocation_context import InvocationContext

logger = structlog.get_logger(__name__)


# Fixed (unversioned) relative paths for Code Focus style artifacts. The
# worker keys these in ``source_files`` under the same paths.
_THEME_CSS_RELATIVE = "code/frontend/styles/theme.css"
_COMPILED_CSS_RELATIVE = "compiled/frontend/styles/compiled.css"

# MIME types for saved artifacts. ADK Part.from_bytes needs something
# concrete; downstream consumers read .inline_data.data directly.
_MIME_TSX = "text/plain"
_MIME_CSS = "text/plain"
_MIME_CSV = "text/plain"


def _lookup_source(source_files: dict, relative_source: str) -> Optional[bytes]:
    """Return the bytes for ``relative_source`` from the inline payload.

    Tolerant of a leading slash on either side. Returns ``None`` when the
    path is empty or absent from the payload.
    """
    if not relative_source:
        return None
    for key in (relative_source, relative_source.lstrip("/")):
        val = source_files.get(key)
        if val is not None:
            return val if isinstance(val, bytes) else str(val).encode("utf-8")
    return None


async def _save_artifact(
    ctx: InvocationContext, filename: str, data: bytes, mime_type: str
) -> None:
    """Save raw bytes under the given artifact filename."""
    artifact = genai.types.Part.from_bytes(data=data, mime_type=mime_type)
    await ctx.artifact_service.save_artifact(
        session_id=ctx.session.id,
        user_id=ctx.session.user_id,
        app_name=ctx.session.app_name,
        filename=filename,
        artifact=artifact,
    )


def _make_component_stub(artifact_filename: str) -> Optional[bytes]:
    """Create a minimal empty component stub for missing TSX blobs.

    Only applies to ``codefocus_component:`` artifacts. Returns ``None``
    for handlers, styles, seeds, or any other artifact type so the caller
    can fall back to its normal failure path.
    """
    prefix = "codefocus_component:"
    if not artifact_filename.startswith(prefix):
        return None
    # "codefocus_component:MainHeader.tsx" → "MainHeader"
    name = artifact_filename[len(prefix) :].removesuffix(".tsx")
    stub = f"export default function {name}() {{\n" f"  return <div></div>;\n" f"}}\n"
    return stub.encode("utf-8")


async def _rehydrate_one(
    ctx: InvocationContext,
    artifact_filename: str,
    source_data: Optional[bytes],
    mime_type: str,
) -> str:
    """Save one inline source under the given artifact filename.

    Returns one of:
      - ``"ok"``    — real source present and saved successfully
      - ``"stub"``  — source absent; a minimal empty component stub was
                      created and saved instead
      - ``"failed"``— source absent and no stub applicable, or save failed

    Never raises — failures are logged and rolled up in the caller's stats.

    For missing component sources, a minimal empty stub is created so that
    the editor workflow can continue without special-case handling.
    """
    data = source_data
    used_stub = False
    if data is None:
        # For components, create a minimal stub so the edit workflow
        # proceeds normally. For other artifact types, report failure.
        stub = _make_component_stub(artifact_filename)
        if stub is not None:
            data = stub
            used_stub = True
            logger.warning(
                "source_rehydration_created_stub",
                artifact=artifact_filename,
            )
        else:
            logger.warning(
                "source_rehydration_missing_source",
                artifact=artifact_filename,
            )
            return "failed"
    try:
        await _save_artifact(ctx, artifact_filename, data, mime_type)
        return "stub" if used_stub else "ok"
    except Exception as e:
        logger.warning(
            "source_rehydration_save_failed",
            artifact=artifact_filename,
            error=str(e),
        )
        return "failed"


def _has_styles(app_config: dict) -> bool:
    """Return True if the app declares Code Focus styles.

    JSON-only apps without Tailwind don't have theme.css to rehydrate.
    """
    frontend_repo = (app_config.get("repo", {}) or {}).get("frontend", {}) or {}
    return bool(frontend_repo.get("tailwindConfig") or frontend_repo.get("styles"))


async def rehydrate_sources(
    ctx: InvocationContext,
    app_config: dict,
) -> dict[str, Any]:
    """Download all build outputs from durable GCS into the ADK artifact store.

    Covers four asset classes:
      - Code Focus components (versioned, per repo.frontend.components)
      - Backend handlers (versioned, per repo.backend.handlers)
      - Style artifacts (fixed paths: theme.css, compiled.css)
      - Seed CSVs (versioned, per repo.seed)

    Runs every download in parallel. Never raises — individual failures
    are logged and rolled up in the returned stats. Callers that need a
    particular asset should check the stats or gracefully degrade.

    The returned stats dict also includes ``components_missing_names`` and
    ``handlers_missing_names`` lists so callers can distinguish which
    specific entities failed to rehydrate and react accordingly (e.g.
    skip them in dependency mapping, recreate them via the builder, or
    fail fast before invoking the editor).
    """
    stats: dict[str, Any] = {
        "components_total": 0,
        "components_rehydrated": 0,
        "components_missing": 0,
        "components_missing_names": [],
        "handlers_total": 0,
        "handlers_rehydrated": 0,
        "handlers_missing": 0,
        "handlers_missing_names": [],
        "styles_total": 0,
        "styles_rehydrated": 0,
        "styles_missing": 0,
        "seeds_total": 0,
        "seeds_rehydrated": 0,
        "seeds_missing": 0,
        "seeds_missing_names": [],
    }

    app_uuid = ctx.session.state.get("app_uuid") or app_config.get("app_uuid") or ""
    if not app_uuid:
        logger.info("source_rehydration_skipped_no_app_uuid")
        return stats

    repo = app_config.get("repo", {}) or {}
    repo_frontend = repo.get("frontend", {}) or {}
    repo_components: dict = repo_frontend.get("components", {}) or {}
    repo_backend = repo.get("backend", {}) or {}
    repo_handlers: dict = repo_backend.get("handlers", {}) or {}
    repo_seed: dict = repo.get("seed", {}) or {}

    # Inline source bytes, keyed by relative source path, shipped by the
    # runtime worker in the /r payload and seeded into session state.
    source_files: dict = ctx.session.state.get("source_files") or {}
    if not source_files:
        logger.warning(
            "source_rehydration_no_inline_sources",
            app_uuid=app_uuid,
            hint="worker did not send payload.source_files; components will stub",
        )

    # (artifact_filename, source_data_or_none, mime_type, bucket_label, entity_name)
    # entity_name is the bare component/handler/seed name (e.g. "HomeContent")
    # so we can populate *_missing_names lists without re-parsing the artifact
    # filename later. source_data is None when the path is absent from the
    # inline payload; _rehydrate_one then stubs (components) or fails (others).
    tasks: list[tuple[str, Optional[bytes], str, str, str]] = []

    # ── Components ────────────────────────────────────────────────────
    for comp_name, comp_cfg in repo_components.items():
        if not isinstance(comp_cfg, dict):
            continue
        source_path = comp_cfg.get("source") or ""
        if not source_path:
            continue
        stats["components_total"] += 1
        data = _lookup_source(source_files, source_path)
        tasks.append(
            (f"codefocus_component:{comp_name}.tsx", data, _MIME_TSX, "components", comp_name)
        )

    # ── Handlers ──────────────────────────────────────────────────────
    for handler_name, handler_cfg in repo_handlers.items():
        if not isinstance(handler_cfg, dict):
            continue
        source_path = handler_cfg.get("source") or ""
        if not source_path:
            continue
        stats["handlers_total"] += 1
        data = _lookup_source(source_files, source_path)
        tasks.append(
            (f"handler_code:{handler_name}.tsx", data, _MIME_TSX, "handlers", handler_name)
        )

    # ── Styles (only for Code Focus apps) ─────────────────────────────
    if _has_styles(app_config):
        stats["styles_total"] += 1
        tasks.append(
            (
                "codefocus_style:theme.css",
                _lookup_source(source_files, _THEME_CSS_RELATIVE),
                _MIME_CSS,
                "styles",
                "theme.css",
            )
        )
        stats["styles_total"] += 1
        tasks.append(
            (
                "codefocus_style:compiled.css",
                _lookup_source(source_files, _COMPILED_CSS_RELATIVE),
                _MIME_CSS,
                "styles",
                "compiled.css",
            )
        )

    # ── Seeds ─────────────────────────────────────────────────────────
    for seed_name, seed_cfg in repo_seed.items():
        if not isinstance(seed_cfg, dict):
            continue
        source_path = seed_cfg.get("source") or ""
        if not source_path:
            continue
        stats["seeds_total"] += 1
        data = _lookup_source(source_files, source_path)
        tasks.append((f"seed:{seed_name}.csv", data, _MIME_CSV, "seeds", seed_name))

    if not tasks:
        logger.info("source_rehydration_nothing_to_do", app_uuid=app_uuid, **stats)
        return stats

    # Track which component artifacts were created as stubs so downstream
    # consumers (core.py, editing_workflow) can flag the degraded state.
    stubbed_components: list[str] = []

    # Save everything into the ADK artifact store.
    results = await asyncio.gather(
        *[_rehydrate_one(ctx, name, data, mime) for (name, data, mime, _b, _e) in tasks],
        return_exceptions=False,
    )

    # Roll results up per asset class.
    for (_name, _data, _mime, bucket, entity_name), status in zip(tasks, results):
        if status in ("ok", "stub"):
            stats[f"{bucket}_rehydrated"] += 1
            if status == "stub" and bucket == "components":
                stubbed_components.append(entity_name)
        else:
            stats[f"{bucket}_missing"] += 1
            names_key = f"{bucket}_missing_names"
            if names_key in stats:
                stats[names_key].append(entity_name)

    # Persist the list of stubbed components in session state so downstream
    # consumers (core.py, editing_workflow) can surface the degraded state —
    # a component whose prior source was missing from the inline payload was
    # rehydrated as an empty shell rather than its real content.
    if stubbed_components:
        ctx.session.state["_stubbed_components"] = stubbed_components
        logger.warning(
            "source_rehydration_stubbed_components",
            app_uuid=app_uuid,
            components=stubbed_components,
        )

    logger.info("source_rehydration_done", app_uuid=app_uuid, **stats)
    return stats
