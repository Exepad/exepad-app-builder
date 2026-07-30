"""Workflow-level post-pass for the design-import creator_plan.

The DesignImporter LLM is supposed to derive ``app_name`` and the entry
component name from the loaded design content. In practice it sometimes
emits placeholder-shaped values (``"InToTheHobby_Main_vId"``) or generic
blog-template component names (``"PostFeed"``) that have no relationship
to the actual design.

This module's ``ground_design_import_metadata`` runs AFTER
``_synthesize_creator_plan`` (which rebuilds component_plans from the
plan's pages/chrome) and AFTER the workflow has computed the
``bundle_digest`` (which carries the brand name extracted from the
source HTML's `<title>` / brand markup). It mutates ``creator_plan``
in place to:

  * Detect placeholder-shaped ``app_name`` and reseed from
    ``bundle_digest["brand_name"]``, the first content page's
    ``page_title``, or the first proper-noun chunk of ``page_summary``.
  * Detect generic blog/site placeholder names on content components
    (``PostFeed``, ``FeaturedContent``, etc.) and derive a
    page-title-based name when the page itself has a meaningful title.

The helper is async because Phase 3.2 will extend it to load Babel-shell
sibling JSX artifacts via ``ArtifactManager`` for the data extractor.
Phase 2 doesn't strictly need async — the signature is forward-compat.
"""

from __future__ import annotations

import re
from typing import Any, Optional

import structlog

logger = structlog.get_logger(__name__)


# Names the DesignImporter LLM frequently outputs as a generic blog/site
# scaffold when it doesn't ground the component plan in the actual
# design content. When a content-role component carries one of these
# AND the page has a meaningful title, derive a name from the title
# instead.
_GENERIC_CONTENT_COMPONENT_NAMES: frozenset[str] = frozenset({
    "PostFeed",
    "FeaturedContent",
    "Header",
    "Sidebar",
    "Footer",
    "MainContent",
    "Content",
    "Article",
    "Card",
    "Hero",
    "Page",
})


# Page-title chunks that don't survive into a derived component name —
# usually because they describe the role (Overview, Page, Section)
# rather than the brand or domain.
_GENERIC_TITLE_SUFFIXES: frozenset[str] = frozenset({
    "page",
    "overview",
    "view",
    "section",
    "panel",
    "screen",
})


# Regex patterns that strongly suggest a placeholder-shaped LLM output
# (think internal IDs, version slugs, template artifacts).
_PLACEHOLDER_SUBSTRINGS: tuple[str, ...] = ("_vId", "_Main_", "_TBD_")
_PLACEHOLDER_REGEX = re.compile(r"_v\d+(_|$)")


def _is_placeholder_shape(name: str) -> bool:
    """Return True when ``name`` looks like a template-artifact value
    rather than a real app name. Heuristics:
      * Contains a known placeholder substring (``_vId``, ``_Main_``,
        ``_TBD_``)
      * Matches the ``_v\\d+`` versioned-template suffix pattern
      * Has 3+ underscores (real app names rarely chain this many parts)
      * Is unusually long (> 40 chars)
    """
    if not name:
        return True
    if any(sub in name for sub in _PLACEHOLDER_SUBSTRINGS):
        return True
    if _PLACEHOLDER_REGEX.search(name):
        return True
    if name.count("_") >= 3:
        return True
    if len(name) > 40:
        return True
    return False


def _name_appears_in_source(name: str, *haystacks: str) -> bool:
    """Return True when any non-trivial substring of ``name`` (split on
    underscores / case boundaries, ≥3 chars) shows up in the haystack
    text. Used to confirm that an LLM-emitted name is at least
    plausibly grounded in the loaded design content."""
    if not name:
        return False
    haystack_text = " ".join(h for h in haystacks if h).lower()
    if not haystack_text:
        return False
    chunks = _split_into_chunks(name)
    for chunk in chunks:
        if len(chunk) >= 3 and chunk.lower() in haystack_text:
            return True
    return False


def _split_into_chunks(text: str) -> list[str]:
    """Split a name like ``InToTheHobby_Main`` into
    ``['In', 'To', 'The', 'Hobby', 'Main']`` for membership checks.
    Splits on underscores AND CamelCase boundaries.
    """
    if not text:
        return []
    parts: list[str] = []
    for piece in text.split("_"):
        if not piece:
            continue
        # CamelCase split: insert space before each capital, then split.
        spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", piece)
        parts.extend(p for p in spaced.split() if p)
    return parts


def _strip_generic_title_suffix(title: str) -> str:
    """Drop trailing generic role words from a title.

    ``"Dashboard Overview"`` → ``"Dashboard"`` only when the
    last word is in ``_GENERIC_TITLE_SUFFIXES``. Multi-word strips
    iterate.
    """
    cleaned = title.strip()
    while True:
        parts = cleaned.split()
        if len(parts) <= 1:
            break
        if parts[-1].lower().rstrip(".,:;") in _GENERIC_TITLE_SUFFIXES:
            cleaned = " ".join(parts[:-1])
            continue
        break
    return cleaned


def _first_proper_noun_phrase(text: str) -> str:
    """Extract the longest run of capitalized words from ``text`` —
    typically the brand or domain name in a page summary.

    ``"The main administrative hub for Ashford Day School ..."`` →
    ``"Ashford Day School"``.
    """
    if not text:
        return ""
    # Match runs of `Capitalized` words (allowing internal hyphens /
    # apostrophes). Skip leading sentence-start capitals by requiring
    # the run to be at least 2 words OR not at byte 0.
    matches = re.findall(r"(?:[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+)+)", text)
    if not matches:
        return ""
    # Prefer the longest match; ties broken by first occurrence.
    matches.sort(key=lambda m: (-len(m), text.find(m)))
    return matches[0]


def _pascal_case(text: str) -> str:
    """Convert ``"Dashboard Overview"`` → ``"DashboardOverview"``.
    Strips non-alphanumerics; preserves internal capitalization.
    """
    if not text:
        return ""
    parts = re.findall(r"[A-Za-z0-9]+", text)
    return "".join(p[:1].upper() + p[1:] for p in parts if p)


def _content_pages(creator_plan: dict) -> list[dict]:
    """Return component_plans entries with role='content' (in order)."""
    return [
        cp
        for cp in (creator_plan.get("component_plans") or [])
        if cp.get("role") == "content"
    ]


def _ground_app_name(
    creator_plan: dict,
    bundle_digest: Optional[dict],
) -> bool:
    """Reseed ``creator_plan["app_name"]`` if it looks like a placeholder
    or doesn't appear anywhere in the loaded design content. Returns
    True when a reseed actually occurred."""
    current = (creator_plan.get("app_name") or "").strip()
    content_pages = _content_pages(creator_plan)
    haystacks: list[str] = []
    if bundle_digest:
        haystacks.append(bundle_digest.get("brand_name", "") or "")
        haystacks.append(bundle_digest.get("domain_hints", "") or "")
    for cp in content_pages:
        haystacks.append(cp.get("page_title", "") or "")
        # First 500 chars of the summary keeps the haystack bounded.
        summary = (cp.get("page_summary", "") or "")[:500]
        haystacks.append(summary)

    placeholder = _is_placeholder_shape(current)
    grounded = current and _name_appears_in_source(current, *haystacks)

    if not placeholder and grounded:
        return False  # Already in good shape.

    # Reseed: prefer brand_name → first page_title → first proper noun
    # in the first page_summary. Falls back to the original value if
    # nothing better surfaces (don't regress when uncertain).
    candidates: list[str] = []
    if bundle_digest:
        brand = (bundle_digest.get("brand_name") or "").strip()
        if brand:
            candidates.append(brand)
    if content_pages:
        first = content_pages[0]
        title = (first.get("page_title") or "").strip()
        if title:
            stripped = _strip_generic_title_suffix(title)
            # Drop the title entirely if it's purely a generic role
            # word (e.g. ``"Page"``, ``"Overview"``) — those carry no
            # brand information and shouldn't be promoted to app_name.
            if stripped and stripped.lower().rstrip(".,:;") not in _GENERIC_TITLE_SUFFIXES:
                candidates.append(stripped)
        summary = (first.get("page_summary") or "").strip()
        proper = _first_proper_noun_phrase(summary)
        if proper:
            candidates.append(proper)

    new_name = next((c for c in candidates if c), "") or current
    if not new_name or new_name == current:
        return False

    creator_plan["app_name"] = new_name
    logger.info(
        "design_import_app_name_reseeded",
        old_app_name=current,
        new_app_name=new_name,
        was_placeholder=placeholder,
        was_grounded=bool(grounded),
    )
    return True


def _ground_entry_component_names(creator_plan: dict) -> None:
    """Reseed generic content-component names from page_title.

    Walks ``component_plans`` for entries with ``role == "content"``
    and a name in ``_GENERIC_CONTENT_COMPONENT_NAMES``. When the page
    title is meaningful (non-empty after stripping generic role
    suffixes), replace the name with the PascalCased title.

    Header / sidebar / footer chrome components keep their generic
    names (``Header``, ``Sidebar``, ``Footer``) because those are
    accurate descriptions of the role, not placeholders.
    """
    for cp in _content_pages(creator_plan):
        current = (cp.get("name") or "").strip()
        if current not in _GENERIC_CONTENT_COMPONENT_NAMES:
            continue
        title = (cp.get("page_title") or "").strip()
        if not title:
            continue
        stripped = _strip_generic_title_suffix(title)
        # Skip when the stripped title is itself a generic role word
        # (``"Page"``, ``"Overview"``) — renaming `PostFeed` → `Page`
        # is a lateral move from one generic to another.
        if not stripped or stripped.lower().rstrip(".,:;") in _GENERIC_TITLE_SUFFIXES:
            continue
        new_name = _pascal_case(stripped)
        if not new_name or new_name == current:
            continue
        # Avoid collisions with another component's name in the same
        # plan (rare, but defensive).
        existing_names = {
            (other.get("name") or "")
            for other in (creator_plan.get("component_plans") or [])
            if other is not cp
        }
        if new_name in existing_names:
            new_name = f"{new_name}Shell"
        if new_name in existing_names:
            continue  # give up; keep the original
        cp["name"] = new_name
        logger.info(
            "design_import_component_renamed",
            old_name=current,
            new_name=new_name,
            page_slug=cp.get("page_slug"),
            page_title=title,
        )


async def ground_design_import_metadata(
    ctx: Any,
    creator_plan: dict,
    *,
    bundle_digest: Optional[dict] = None,
) -> dict:
    """Workflow-level post-pass that mutates ``creator_plan`` in place.

    Phase 2: re-grounds ``app_name`` and content-role component names
    against the loaded design content + bundle_digest.

    Phase 3.2: also runs the deterministic Babel-shell data extractor
    over each component's ``source_jsx_modules`` and (when models
    surface) promotes ``app_backend_plan.backend_type`` to
    ``"dynamic"``, populates ``app_backend_plan.models``, and stashes
    raw seed rows in ``ctx.session.state[StateKeys.EXTRACTED_SEED_DATA]``
    so ``SeedDataBuilder`` can short-circuit the LLM seed generation.

    Returns a metadata dict the workflow uses to populate
    ``design_import_meta`` on the final config:

    ```
    {
        "app_name_reseeded": bool,  # True when app_name was a placeholder
        "extracted_models": list[str],  # snake_case model names
        "extracted_wiring": list[dict],  # consumer-rewrite hints for Phase 3.3
    }
    ```
    """
    meta: dict = {
        "app_name_reseeded": False,
        "extracted_models": [],
        "extracted_wiring": [],
    }
    if not isinstance(creator_plan, dict):
        return meta
    meta["app_name_reseeded"] = _ground_app_name(creator_plan, bundle_digest)
    _ground_entry_component_names(creator_plan)
    if ctx is not None:
        extracted = await _ground_backend_from_jsx_modules(ctx, creator_plan)
        meta["extracted_models"] = extracted["model_names"]
        meta["extracted_wiring"] = extracted["wiring_candidates"]
    return meta


async def _ground_backend_from_jsx_modules(
    ctx: Any,
    creator_plan: dict,
) -> dict:
    """Run the deterministic data extractor on every component plan
    that carries ``source_jsx_modules``.

    Returns ``{"model_names": list[str], "wiring_candidates": list[dict]}``.

    Mutates ``creator_plan`` in place:
      - sets ``app_backend_plan.backend_type = "dynamic"`` when models
        surface (and there isn't already a richer backend plan)
      - merges new models into ``app_backend_plan.models`` (skipping
        duplicates by name)

    Stashes raw seed rows in ``ctx.session.state[EXTRACTED_SEED_DATA]``
    keyed by snake-case model name. SeedDataBuilder picks them up and
    skips its LLM generation pass for those models.
    """
    # Lazy imports avoid creating a creation_workflow ↔ grounding
    # circular import at module load time.
    from main_agent.agents.orchestrator.importers.tools.jsx_to_tsx.data_extractor import (  # noqa: E501
        extract_babel_shell_data,
    )
    from main_agent.agents.utils.artifact_manager import ArtifactManager
    from main_agent.constants import StateKeys

    component_plans = creator_plan.get("component_plans") or []
    all_models: list[dict] = []
    all_wiring: list[dict] = []
    seed_data: dict[str, list[dict]] = {}

    for cp in component_plans:
        modules_meta = cp.get("source_jsx_modules") or []
        if not modules_meta:
            continue
        loaded: list[tuple[str, str]] = []
        for m in modules_meta:
            artifact_key = m.get("artifact")
            module_name = m.get("name") or ""
            if not artifact_key or not module_name:
                continue
            try:
                body = await ArtifactManager.load_artifact_as_string(
                    ctx, artifact_key
                )
            except Exception as exc:
                logger.warning(
                    "data_extractor_artifact_load_failed",
                    component=cp.get("name"),
                    module=module_name,
                    artifact=artifact_key,
                    error=str(exc),
                )
                continue
            if not body:
                continue
            loaded.append((module_name, body))

        if not loaded:
            continue

        result = extract_babel_shell_data(loaded)
        if not result.models:
            logger.info(
                "data_extractor_no_models_for_component",
                component=cp.get("name"),
                module_count=len(loaded),
                skipped_count=len(result.skipped),
            )
            continue

        for model in result.models:
            all_models.append(_to_model_plan_dict(model))
            seed_data[model.name] = list(model.seed_rows)
        for w in result.wiring_candidates:
            all_wiring.append(
                {
                    "component": cp.get("name"),
                    "module": w.module_name,
                    "symbol": w.symbol,
                    "model": w.model_name,
                    "source_module": w.source_module,
                }
            )
        logger.info(
            "data_extractor_models_surfaced",
            component=cp.get("name"),
            count=len(result.models),
            model_names=[m.name for m in result.models],
        )

    if not all_models:
        return {"model_names": [], "wiring_candidates": []}

    # Promote backend_type and merge models. Don't clobber an existing
    # rich plan — only force "dynamic" if it was None / "none" / absent.
    backend_plan = creator_plan.setdefault("app_backend_plan", {})
    if backend_plan.get("backend_type") in (None, "", "none"):
        backend_plan["backend_type"] = "dynamic"

    existing = backend_plan.setdefault("models", [])
    existing_names = {m.get("name") for m in existing if isinstance(m, dict)}
    for model_dict in all_models:
        if model_dict["name"] not in existing_names:
            existing.append(model_dict)
            existing_names.add(model_dict["name"])

    # Stash seed rows for SeedDataBuilder.
    state = getattr(getattr(ctx, "session", None), "state", None)
    if state is not None:
        prior = state.get(StateKeys.EXTRACTED_SEED_DATA) or {}
        prior.update(seed_data)
        state[StateKeys.EXTRACTED_SEED_DATA] = prior

    return {
        "model_names": [m["name"] for m in all_models],
        "wiring_candidates": all_wiring,
    }


def _to_model_plan_dict(model: Any) -> dict:
    """Convert ``ExtractedDataModel`` → dict shaped like ``ModelPlan``
    so ``BackendModelBuilder`` consumes it via the existing path.

    See ``apps/agent/main_agent/agents/orchestrator/app_types/shared/
    models/plan_models.py:ModelPlan / ColumnPlan`` for the schema.
    """
    columns = [
        {
            "name": col.name,
            "type": col.type,
            "required": col.required,
            "is_unique": False,
            "default_value": None,
            "references": None,
            "enum_values": None,
        }
        for col in model.columns
    ]
    return {
        "name": model.name,
        "columns": columns,
        # Design-import seeds are meant to demo the app to every
        # visitor — `shared` so all users see the imported rows.
        # `user`-scoped would mean each user starts with an empty DB
        # (the seed only goes to the first owner), defeating the
        # demonstration. The user can flip this post-creation if their
        # app actually needs per-user data isolation.
        "owner_scope": "shared",
        "seed_hint": (
            f"Seeded from imported design data ({len(model.seed_rows)} rows)."
        ),
    }
