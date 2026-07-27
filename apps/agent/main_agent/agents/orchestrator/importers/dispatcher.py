"""ImporterDispatcher — stages a design-bundle's files as artifacts and
hands control to the skill-based DesignImporter agent.

Called from CreationWorkflow BEFORE PreCreator when
``ctx.session.state["design_bundle_id"]`` is set. Responsibilities:

  1. Fetch the DesignBundle manifest from the Django backend via
     ``bundle_fetch.fetch_bundle_manifest``.
  2. Stage every bundle file as an artifact under ``bundle:<kind>:<relpath>``
     via :func:`bundle_stager.stage_bundle_artifacts`. Emits a human-readable
     ``bundle:manifest.md`` index the workflow passes to DesignImporter as
     ``manifest_markdown``.
  3. Record a small skill-context dict on session state under
     ``design_bundle_skill_context`` — the DesignImporter's instruction
     provider surfaces the chosen ``skill_name`` (``stitch-importer``
     or ``claude-design-importer``) so the LLM ``load_skill``s it via
     the SkillToolset.

No more ``NormalizedSource``, no per-format Python readers. Format-specific
decomposition lives in SKILL.md bodies under
``packages/schemas/data/agent_docs/design_bundle_importer/<skill>/`` and
is loaded by the DesignImporter at inference time.

Design imports are a cloud-only feature: the extracted bundle entries live in
a cloud object store the self-host container can't reach, so the dispatcher
requires an injected ``fetch_bytes`` and otherwise returns ``None`` (callers
treat that as "no bundle").

If anything fails (missing bundle_id, backend unreachable, unknown source,
no fetcher), the dispatcher logs + returns ``None``. The creation workflow
treats that as fatal when the user explicitly supplied a design bundle.
"""

from __future__ import annotations

import os
from typing import Awaitable, Callable, Optional

import structlog

from .bundle_fetch import fetch_bundle_manifest
from .bundle_stager import (
    BUNDLE_SKILL_CONTEXT_STATE_KEY,
    stage_bundle_artifacts,
)

logger = structlog.get_logger(__name__)


# Session state key the PreCreator + digester read to decide whether a
# design bundle is in play.
CREATION_INPUT_MODALITY_KEY = "creation_input_modality"


async def dispatch_design_bundle(
    ctx,
    *,
    design_bundle_id: Optional[str],
    fetch_bytes: Optional[Callable[[str], Awaitable[bytes]]] = None,
) -> Optional[dict]:
    """Stage a design bundle for the DesignImporter agent.

    Args:
        ctx: ADK ``InvocationContext`` — used for artifact saves + session info.
        design_bundle_id: UUID string. When ``None`` / empty, returns ``None``.
        fetch_bytes: async ``(path) -> bytes`` that pulls a staged bundle entry.
            REQUIRED — design bundles live in a cloud object store the self-host
            container has no access to, so without an injected fetcher the
            dispatcher returns ``None``. (The GCS-backed default fetcher was
            removed with the rest of the GCS coupling.) Tests inject a stub.

    Returns:
        A small skill-context dict on success::

            {
                "bundle_source": "stitch" | "claude-design",
                "bundle_id": "<uuid>",
                "skill_name": "stitch-importer" | "claude-design-importer",
                "manifest_artifact": "bundle:manifest.md",
                "staged_count": <int>,
                "staged_keys": [...],
            }

        Or ``None`` on any failure. Callers treat ``None`` as "no bundle"
        and proceed with the legacy description-driven path — the feature
        is purely additive.
    """
    if not design_bundle_id:
        return None

    # Design imports read extracted bundle entries from a cloud object store —
    # a cloud-only data path the self-host container can't reach. Short-circuit
    # cleanly so callers treat None as "no bundle" and continue.
    if os.getenv("ENVIRONMENT") == "selfhost":
        logger.info(
            "dispatch_design_bundle_skipped_selfhost",
            design_bundle_id=design_bundle_id,
            detail="design imports are a cloud feature; not available in self-host",
        )
        return None

    manifest_response = await fetch_bundle_manifest(design_bundle_id)
    if manifest_response is None:
        logger.warning(
            "dispatch_design_bundle_manifest_fetch_failed",
            design_bundle_id=design_bundle_id,
        )
        return None

    source = manifest_response.get("source") or ""
    manifest = manifest_response.get("manifest") or {}
    if not isinstance(manifest, dict):
        logger.warning(
            "dispatch_design_bundle_malformed_manifest",
            design_bundle_id=design_bundle_id,
            source=source,
        )
        return None

    if fetch_bytes is None:
        # No way to pull the bundle's extracted entries without the cloud
        # object store. Treat as "no bundle" and continue (the GCS fetcher
        # was removed with the rest of the GCS coupling).
        logger.info(
            "dispatch_design_bundle_no_fetcher",
            design_bundle_id=design_bundle_id,
            detail="design bundle fetch requires a cloud object store; not available in self-host",
        )
        return None
    try:
        skill_context = await stage_bundle_artifacts(
            ctx,
            bundle_id=design_bundle_id,
            manifest={**manifest, "source": source},
            fetch_bytes=fetch_bytes,
        )
    except Exception:  # noqa: BLE001
        logger.exception(
            "dispatch_design_bundle_stager_failed",
            design_bundle_id=design_bundle_id,
            source=source,
        )
        return None

    if not skill_context:
        logger.warning(
            "dispatch_design_bundle_nothing_staged",
            design_bundle_id=design_bundle_id,
            source=source,
        )
        return None

    logger.info(
        "dispatch_design_bundle_staged",
        design_bundle_id=design_bundle_id,
        source=source,
        skill=skill_context.get("skill_name"),
        staged=skill_context.get("staged_count"),
    )
    return skill_context


def stash_skill_context_on_session_state(
    session_state: dict,
    skill_context: dict,
) -> None:
    """Persist the skill-context pointer into ADK session state.

    The DesignImporter's instruction provider reads this to surface the
    ``skill_name`` (``stitch-importer`` etc.) so the LLM ``load_skill``s
    the right SKILL.md.
    """
    session_state[BUNDLE_SKILL_CONTEXT_STATE_KEY] = dict(skill_context)
    session_state[CREATION_INPUT_MODALITY_KEY] = "design_bundle"
