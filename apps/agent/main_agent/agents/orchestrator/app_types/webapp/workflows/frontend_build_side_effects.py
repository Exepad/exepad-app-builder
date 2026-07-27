"""Side-effect application for `FrontendBuildAction` runs.

After ``ComponentBuilderMultiple`` returns, the workflow has to apply
non-artifact mutations the agent couldn't perform itself:

- Page registry mutations (``page_creates``, ``page_removes``,
  ``page_slug_renames``).
- Auto-register newly-created supporting modules under whatever entry
  imports them (walked from the import graph).
- Drop deleted entry / module artifacts from `repo.frontend.components`
  and any page mounts.

This module is workflow-internal — it operates on dicts (the live
`current_config`) and ADK ctx state. It does NOT call agents.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Iterable

import structlog

from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.constants import StateKeys
from main_agent.services.dependency_graph import build_dependency_graph

from ..services.codefocus_assembly_service import ComponentEntry

logger = structlog.get_logger(__name__)


# --------------------------------------------------------------------------- #
# Result type
# --------------------------------------------------------------------------- #


@dataclass
class FrontendBuildSideEffects:
    """Mutations the workflow needs to fold into `_EditPhaseState`.

    Phase 9.5 dispatch reads these fields after each action and merges
    them into the shared phase state. The mutations are NOT applied
    in-place to current_config here — `_assemble_and_save` consumes
    `state.added_components` / `state.modified_names` /
    `state.removed_names` / `state.removed_page_uuids` and writes the
    final config there.
    """

    added_components: list[ComponentEntry] = field(default_factory=list)
    modified_names: list[str] = field(default_factory=list)
    removed_names: list[str] = field(default_factory=list)
    removed_page_uuids: list[str] = field(default_factory=list)
    # Pages added inline as part of `page_creates`. Tuples of
    # (uuid, slug, title, mounted_component_names). The workflow
    # appends these to `current_config.frontend.pages` post-agent.
    new_pages: list[tuple[str, str, str, list[str]]] = field(default_factory=list)
    # Slug remaps the workflow already applied to `current_config`
    # post-agent. {old_slug: new_slug}.
    slug_remaps: dict[str, str] = field(default_factory=dict)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


_ARTIFACT_PREFIX_COMPONENT = "codefocus_component:"
_ARTIFACT_PREFIX_MODULE = "codefocus_module:"


def _bare_name(filename: str) -> str:
    """Strip prefix + extension from an artifact filename."""
    base = filename
    for prefix in (_ARTIFACT_PREFIX_COMPONENT, _ARTIFACT_PREFIX_MODULE):
        if base.startswith(prefix):
            base = base[len(prefix) :]
            break
    if base.endswith(".tsx"):
        base = base[:-4]
    return base


def _generate_slug(title_or_name: str) -> str:
    """Best-effort slug from a title / component name."""
    text = title_or_name
    for suffix in ("Content", "Page", "View"):
        if text.endswith(suffix) and len(text) > len(suffix):
            text = text[: -len(suffix)]
    slug = re.sub(r"(?<=[a-z0-9])([A-Z])", r"-\1", text).lower()
    slug = re.sub(r"\s+", "-", slug)
    slug = re.sub(r"[^a-z0-9-]", "", slug)
    slug = slug.strip("-") or "page"
    return f"/{slug}"


# --------------------------------------------------------------------------- #
# Apply
# --------------------------------------------------------------------------- #


async def apply_frontend_build_side_effects(
    ctx,
    *,
    action,
    current_config: dict,
    sibling_modules_before: dict[str, str],
    artifact_sources_after: dict[str, str],
    files_created_this_turn: list[str],
    files_deleted_this_turn: list[str],
) -> FrontendBuildSideEffects:
    """Apply post-agent registry mutations and return the diff.

    ``sibling_modules_before`` is the snapshot of staged frontend artifact
    bodies BEFORE the agent ran (keyed by bare name).
    ``artifact_sources_after`` is keyed by full filename — what the agent
    saved (used for the dependency graph + import-based module parent
    inference).

    See `editor.py:FrontendBuildAction` and the plan §4 Phase 9.5 spec.
    """
    out = FrontendBuildSideEffects()
    frontend = current_config.setdefault("frontend", {})
    pages = frontend.setdefault("pages", [])
    repo = current_config.setdefault("repo", {})
    repo_frontend = repo.setdefault("frontend", {})
    repo_components = repo_frontend.setdefault("components", {})

    # ── Created files: split into entry components + supporting modules ─────
    created_entries: list[str] = []
    created_modules: list[str] = []
    for filename in files_created_this_turn:
        if filename.startswith(_ARTIFACT_PREFIX_COMPONENT):
            created_entries.append(_bare_name(filename))
        elif filename.startswith(_ARTIFACT_PREFIX_MODULE):
            created_modules.append(_bare_name(filename))

    # The authoritative set of component artifacts that currently EXIST (built
    # this turn OR in a prior turn). A weak model's Editor can plan a
    # PageCreate.mount_components entry the builder then folds into a MODIFIED
    # sibling instead of creating (live: app auqofu6p5 2026-06-29 — "PricingSection"
    # planned, but the pricing markup landed inside the modified HomeContent and
    # PricingSection.tsx was never written). Registering such a name into
    # repo.frontend.components + a page mount writes a config ref to a missing
    # module → the worker's materializeBuild raises "Missing component artifact"
    # and the ENTIRE edit hard-fails, dropping a deployed app to `error` and
    # losing its working preview. _entry_artifact_exists() screens mounts below.
    try:
        _present_artifacts = set(await ArtifactManager.list_artifacts(ctx) or [])
    except Exception:
        _present_artifacts = set()
    _created_entry_set = set(created_entries)

    def _entry_artifact_exists(name: str) -> bool:
        # Built this turn — definitive (does not need the artifact listing).
        if name in _created_entry_set:
            return True
        # Fail OPEN: if the artifact listing is unavailable we cannot tell, so we
        # keep the mount (preserves prior behaviour; never drops a real component).
        if not _present_artifacts:
            return True
        return f"{_ARTIFACT_PREFIX_COMPONENT}{name}.tsx" in _present_artifacts

    # ── page_slug_renames: update registry ──────────────────────────────────
    for rename in action.page_slug_renames:
        target = next(
            (p for p in pages if isinstance(p, dict) and p.get("uuid") == rename.page_uuid), None
        )
        if target is None:
            logger.warning(
                "frontend_build_side_effects: page_slug_rename target missing",
                page_uuid=rename.page_uuid,
            )
            continue
        old_slug = target.get("slug", "")
        target["slug"] = rename.new_slug
        if old_slug and old_slug != rename.new_slug:
            out.slug_remaps[old_slug] = rename.new_slug
        logger.info(
            "frontend_build_side_effects: slug renamed",
            page_uuid=rename.page_uuid,
            old=old_slug,
            new=rename.new_slug,
        )

    # ── page_creates: register new pages + mount entry components ───────────
    mounted_entries: set[str] = set()
    for create in action.page_creates:
        slug = create.slug or _generate_slug(create.title)
        existing = next(
            (p for p in pages if isinstance(p, dict) and p.get("slug") == slug),
            None,
        )
        page_uuid = (existing.get("uuid") if existing else "") or str(uuid.uuid4())
        page_title = create.title or slug.lstrip("/").replace("-", " ").title() or "Page"
        mount_names: list[str] = []
        for comp_name in create.mount_components:
            if not _entry_artifact_exists(comp_name):
                logger.warning(
                    "frontend_build_side_effects: skipping unbuilt mount component "
                    "(planned by the Editor but no codefocus_component artifact) "
                    "to keep the app_config deployable",
                    component=comp_name,
                    slug=slug,
                )
                continue
            mount_names.append(comp_name)
            mounted_entries.add(comp_name)

        if existing is None:
            pages.append(
                {
                    "uuid": page_uuid,
                    "slug": slug,
                    "title": page_title,
                    "content": [{"componentName": name} for name in mount_names],
                }
            )
            out.new_pages.append((page_uuid, slug, page_title, mount_names))
        else:
            # Upsert mounts onto existing page
            existing["title"] = page_title
            existing_content = existing.setdefault("content", [])
            existing_names = {
                c.get("componentName") for c in existing_content if isinstance(c, dict)
            }
            for name in mount_names:
                if name not in existing_names:
                    existing_content.append({"componentName": name})

        # Register entry components under repo.frontend.components — only the
        # mounts that survived the artifact-existence screen above (mount_names),
        # so a planned-but-unbuilt component is never written to the registry.
        for comp_name in mount_names:
            repo_components.setdefault(
                comp_name,
                {"role": "content", "summary": "", "supporting_modules": []},
            )
            out.added_components.append(
                ComponentEntry(
                    name=comp_name,
                    role="content",
                    page_slug=slug,
                    page_title=page_title,
                    summary="",
                )
            )

    # ── Created entries that weren't mounted via PageCreate: warn + record ──
    for entry_name in created_entries:
        if entry_name in mounted_entries:
            continue
        repo_components.setdefault(
            entry_name,
            {"role": "content", "summary": "", "supporting_modules": []},
        )
        logger.warning(
            "frontend_build_side_effects: created entry without page_creates mount",
            entry=entry_name,
        )

    # ── Created modules: auto-register under entries that import them ───────
    if created_modules:
        graph = build_dependency_graph(
            artifact_sources_after,
            file_names=[f"{_ARTIFACT_PREFIX_MODULE}{m}.tsx" for m in created_modules],
            direction="imported_by",
        )
        for module_name in created_modules:
            module_filename = f"{_ARTIFACT_PREFIX_MODULE}{module_name}.tsx"
            importers = graph.get(module_filename, {}).get("imported_by", [])
            entry_importers = [
                _bare_name(imp) for imp in importers if imp.startswith(_ARTIFACT_PREFIX_COMPONENT)
            ]
            if not entry_importers:
                logger.warning(
                    "frontend_build_side_effects: created module unimported, skipping registry",
                    module=module_name,
                )
                continue
            for entry_name in entry_importers:
                entry_meta = repo_components.setdefault(
                    entry_name,
                    {"role": "content", "summary": "", "supporting_modules": []},
                )
                modules = entry_meta.setdefault("supporting_modules", [])
                if module_name not in modules:
                    modules.append(module_name)

    # ── page_removes: drop pages + garbage-collect orphan components ────────
    if action.page_removes:
        kept_pages: list[dict] = []
        removed_uuids: list[str] = []
        for p in pages:
            if isinstance(p, dict) and any(
                p.get("uuid") == r.page_uuid for r in action.page_removes
            ):
                removed_uuids.append(p.get("uuid", ""))
            else:
                kept_pages.append(p)
        # Identify orphan components: present only on removed pages.
        components_on_kept: set[str] = set()
        for p in kept_pages:
            if not isinstance(p, dict):
                continue
            for c in p.get("content", []) or []:
                if isinstance(c, dict) and c.get("componentName"):
                    components_on_kept.add(c["componentName"])
        # Walk removed pages to find names that used to be there.
        components_on_removed: set[str] = set()
        for p in pages:
            if isinstance(p, dict) and any(
                p.get("uuid") == r.page_uuid for r in action.page_removes
            ):
                for c in p.get("content", []) or []:
                    if isinstance(c, dict) and c.get("componentName"):
                        components_on_removed.add(c["componentName"])
        orphans = components_on_removed - components_on_kept
        for orphan in orphans:
            # Don't garbage-collect if it's still referenced as a chrome
            # role (header/sidebar/footer).
            still_used = False
            for chrome in ("header", "sidebar", "footer"):
                for c in frontend.get(chrome, []) or []:
                    if isinstance(c, dict) and c.get("component") == orphan:
                        still_used = True
                        break
                if still_used:
                    break
            if still_used:
                continue
            repo_components.pop(orphan, None)
            out.removed_names.append(orphan)
        # Apply page list change in-place
        pages.clear()
        pages.extend(kept_pages)
        out.removed_page_uuids.extend(removed_uuids)

    # ── Deleted artifacts: drop from registry + page mounts ─────────────────
    for filename in files_deleted_this_turn:
        bare = _bare_name(filename)
        if filename.startswith(_ARTIFACT_PREFIX_COMPONENT):
            repo_components.pop(bare, None)
            out.removed_names.append(bare)
            for p in pages:
                if not isinstance(p, dict):
                    continue
                content = p.get("content")
                if isinstance(content, list):
                    p["content"] = [
                        c
                        for c in content
                        if not (isinstance(c, dict) and c.get("componentName") == bare)
                    ]
            for chrome in ("header", "sidebar", "footer"):
                items = frontend.get(chrome)
                if isinstance(items, list):
                    frontend[chrome] = [
                        c for c in items if not (isinstance(c, dict) and c.get("component") == bare)
                    ]
        elif filename.startswith(_ARTIFACT_PREFIX_MODULE):
            for entry_meta in repo_components.values():
                if not isinstance(entry_meta, dict):
                    continue
                mods = entry_meta.get("supporting_modules")
                if isinstance(mods, list) and bare in mods:
                    entry_meta["supporting_modules"] = [m for m in mods if m != bare]

    # ── Modified names: anything that survived AND whose source changed ─────
    for filename, source in artifact_sources_after.items():
        if not filename.startswith(_ARTIFACT_PREFIX_COMPONENT) and not filename.startswith(
            _ARTIFACT_PREFIX_MODULE
        ):
            continue
        if filename in files_created_this_turn or filename in files_deleted_this_turn:
            continue
        bare = _bare_name(filename)
        before = sibling_modules_before.get(bare, "")
        if before and before != source:
            # Track the entry name (for module modifications, walk back to
            # the importing entry so the validation pipeline picks the
            # right tsx + Tailwind compile target).
            if filename.startswith(_ARTIFACT_PREFIX_COMPONENT):
                if bare not in out.modified_names:
                    out.modified_names.append(bare)
            else:
                # Module modification — bubble up to importers
                for entry_name, entry_meta in repo_components.items():
                    if not isinstance(entry_meta, dict):
                        continue
                    mods = entry_meta.get("supporting_modules") or []
                    if bare in mods and entry_name not in out.modified_names:
                        out.modified_names.append(entry_name)

    return out


# --------------------------------------------------------------------------- #
# Synthesis: turn an action into a worker prompt (used by the editing
# workflow to feed the same `prompt` field of `FrontendBuildAction` AS-IS,
# but appending a brief note about structural side-effects so the agent
# knows about page mounts / removes / slug renames it should align with).
# --------------------------------------------------------------------------- #


# Threshold mirrors plan_artifact_materializer._IMAGE_DISTRIBUTION_MIN_CATALOG —
# below this size we don't bother nudging the agent toward catalog usage;
# the chance the LLM still under-distributes is low and the hint is noise.
_RENDER_PROMPT_MIN_CATALOG_FOR_HINT = 10
_RENDER_PROMPT_MAX_UUIDS_PER_HINT = 6


def render_action_prompt(action, image_catalog: list[dict] | None = None) -> str:
    """Return the worker-bound prompt for a `FrontendBuildAction`.

    Currently a thin pass-through that appends structured side-effect
    hints (page creates / removes / slug renames) so the agent can
    align cascade work with what the workflow will register post-run.

    Args:
        action: The Editor's ``FrontendBuildAction``.
        image_catalog: Optional list of catalog entries from session
            state (``ctx.session.state["image_catalog"]``). When
            provided AND ``action.page_creates`` is non-empty AND the
            catalog has at least ``_RENDER_PROMPT_MIN_CATALOG_FOR_HINT``
            non-logo entries, append a hint block listing specific UUIDs
            CBM should prefer for the new content pages. Mirrors the
            creation-flow safety net in ``plan_artifact_materializer.py``
            (``_distribute_unused_catalog_images``) — the materializer
            populates ``image_references`` on plan dicts; this hint plays
            the same role for edit-mode where there is no per-component
            plan dict.
    """
    parts: list[str] = [action.prompt.strip()]

    if action.page_creates:
        parts.append(
            "\n## Page creates the workflow will register post-run:\n"
            + "\n".join(
                f"- Title: {pc.title!r}, slug: {pc.slug or '(derive)'!r}, "
                f"mount_components: {pc.mount_components}"
                for pc in action.page_creates
            )
        )
        # Catalog hint — only when adding new pages, where empty
        # `image_references` for those pages would otherwise cause CBM
        # to fall back to keyword-search instead of using user uploads.
        if image_catalog and len(image_catalog) >= _RENDER_PROMPT_MIN_CATALOG_FOR_HINT:
            non_logo = [
                img
                for img in image_catalog
                if isinstance(img, dict) and img.get("uuid") and not img.get("is_logo", False)
            ]
            if len(non_logo) >= _RENDER_PROMPT_MIN_CATALOG_FOR_HINT:
                hint_uuids = non_logo[:_RENDER_PROMPT_MAX_UUIDS_PER_HINT]
                lines = []
                for img in hint_uuids:
                    desc = (img.get("description") or img.get("keywords") or "").strip()
                    if len(desc) > 80:
                        desc = desc[:77] + "..."
                    lines.append(f"- {img['uuid']}" + (f" — {desc}" if desc else ""))
                parts.append(
                    "\n## User-uploaded image catalog hint for new content pages:\n"
                    "The user has uploaded a catalog of images (see `image_urls` "
                    "in your input — full UUID → URL map). For the new content "
                    "pages above, PREFER these specific UUIDs over keyword-search "
                    "catalog lookups — they are the user's own assets and are "
                    "tied to the app's domain:\n"
                    + "\n".join(lines)
                    + "\n\nUse them via a PLAIN `<img src={image_urls['<UUID>']} "
                    'width={...} height={...} alt="..." />` tag — catalog URLs '
                    "are already resolved, so do NOT wrap them in `<ExepadImage>`. "
                    "If a UUID does not semantically match a section, fall back to "
                    'a keyword search with `<ExepadImage keywords="..." />`.'
                )
    if action.page_slug_renames:
        parts.append(
            "\n## Page slug renames the workflow will register post-run "
            "(rewrite every nav link / navigate() / Link to= reference "
            "across components NOW so the agent and the registry stay "
            "in sync):\n"
            + "\n".join(
                f"- page_uuid={r.page_uuid} → new_slug={r.new_slug!r}"
                for r in action.page_slug_renames
            )
        )
    if action.page_removes:
        parts.append(
            "\n## Page removes the workflow will register post-run "
            "(remove or redirect every nav link to these pages first):\n"
            + "\n".join(f"- page_uuid={r.page_uuid}" for r in action.page_removes)
        )
    return "\n".join(parts)


# --------------------------------------------------------------------------- #
# Sibling-modules snapshot (workflow uses this to seed `_codefocus_sibling_modules`
# before invoking ComponentBuilderMultiple, and to diff post-agent).
# --------------------------------------------------------------------------- #


async def collect_frontend_artifact_sources(ctx) -> dict[str, str]:
    """Return {filename: source} for every staged frontend artifact."""
    out: dict[str, str] = {}
    try:
        keys = await ctx.artifact_service.list_artifact_keys(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
        )
    except Exception:
        return out
    from main_agent.agents.utils.artifact_manager import ArtifactManager

    for key in keys or []:
        if not isinstance(key, str):
            continue
        if not (
            key.startswith(_ARTIFACT_PREFIX_COMPONENT)
            or key.startswith(_ARTIFACT_PREFIX_MODULE)
            or key.startswith("codefocus_style:")
        ):
            continue
        source = await ArtifactManager.load_artifact_as_string(ctx, key)
        if source:
            out[key] = source
    return out


def snapshot_to_bare_names(artifact_sources: dict[str, str]) -> dict[str, str]:
    """Convert a full-filename map into the bare-name shape used by
    ``_codefocus_sibling_modules``."""
    return {_bare_name(k): v for k, v in artifact_sources.items()}


__all__ = [
    "FrontendBuildSideEffects",
    "apply_frontend_build_side_effects",
    "render_action_prompt",
    "collect_frontend_artifact_sources",
    "snapshot_to_bare_names",
]
