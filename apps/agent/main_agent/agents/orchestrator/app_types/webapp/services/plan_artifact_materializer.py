"""Materialize building_plan artifacts into inline ``list[str]`` dict keys.

Creator never emits ``building_plan`` or ``app_building_plan`` inline —
those fields are intentionally absent from the Creator-facing Pydantic
schema so Gemini's structured-output mode cannot inflate the JSON payload
past its combined ``max_output_tokens`` cap. The Creator instead saves
each plan as a ``plan:*.md`` artifact and emits only the artifact
filename in ``*_building_plan_artifact``.

Every downstream consumer (ComponentBuilder, summary builders,
design-import parity check, decomposition) reads ``building_plan`` /
``app_building_plan`` as a ``list[str]`` dict key, so this module loads
each artifact at the workflow boundary right after Creator returns and
injects the parsed bullets under the canonical key.
After materialization the artifact-ref field is cleared and the inline
list is the single source of truth.

Public entry: :func:`materialize_plan_artifacts`. Idempotent and safe to
call multiple times on the same plan dict.
"""

from __future__ import annotations

import re
from typing import Any

import structlog
from google.adk.agents.invocation_context import InvocationContext

from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.errors import ErrorSeverity, PipelineError

logger = structlog.get_logger(__name__)


_IMAGE_DISTRIBUTION_MIN_CATALOG = 10
_IMAGE_DISTRIBUTION_THRESHOLD = 2  # if < N distinct UUIDs referenced across content
_IMAGE_DISTRIBUTION_MAX_PER_COMPONENT = 2


def _distribute_unused_catalog_images(plan: dict[str, Any], image_catalog: list[dict]) -> None:
    """Round-robin unused non-logo catalog UUIDs into empty ``image_references``.

    Safety net for Creator under-using the user's uploaded images. The Creator
    prompt at ``planner/docs/14_CONTENT_AND_MEDIA.md`` instructs the LLM to
    distribute UUIDs across sections, but Gemini periodically ignores it —
    seen 2026-05-12 on egwx9spy where 63 uploaded images yielded a single
    referenced UUID (the logo), leaving every content page to backfill via
    catalog keyword search and hiding the user's own photos entirely.

    Fires only when:
    - the catalog has ≥10 non-logo entries (enough to distribute), AND
    - fewer than 2 distinct UUIDs are referenced across all content
      components (clear under-use, not just a minor gap).

    Only fills EMPTY ``image_references`` arrays — UUIDs the LLM already
    chose are preserved. Logos are excluded so brand assets stay in the
    header/footer where Creator placed them. Assigns up to 2 UUIDs per
    content slot.
    """
    if not isinstance(plan, dict):
        return
    component_plans = plan.get("component_plans") or []
    if not isinstance(component_plans, list):
        return

    content_components = [
        cp for cp in component_plans if isinstance(cp, dict) and cp.get("role") == "content"
    ]
    if not content_components:
        return

    already_referenced: set[str] = set()
    for cp in component_plans:
        if not isinstance(cp, dict):
            continue
        for uuid in cp.get("image_references") or []:
            if isinstance(uuid, str):
                already_referenced.add(uuid)

    non_logo_pool = [
        img.get("uuid")
        for img in image_catalog
        if isinstance(img, dict)
        and img.get("uuid")
        and not img.get("is_logo", False)
        and img.get("uuid") not in already_referenced
    ]
    if len(image_catalog) - len(non_logo_pool) - len(already_referenced) < 0:
        # Defensive — counts shouldn't go negative but bail out if they do.
        return

    if (
        len(image_catalog) < _IMAGE_DISTRIBUTION_MIN_CATALOG
        or len(already_referenced) >= _IMAGE_DISTRIBUTION_THRESHOLD
        or not non_logo_pool
    ):
        return

    pool_iter = iter(non_logo_pool)
    injected: dict[str, list[str]] = {}
    for cp in content_components:
        if cp.get("image_references"):
            continue
        slot: list[str] = []
        for _ in range(_IMAGE_DISTRIBUTION_MAX_PER_COMPONENT):
            try:
                slot.append(next(pool_iter))
            except StopIteration:
                break
        if slot:
            cp["image_references"] = slot
            injected[cp.get("name") or "<unnamed>"] = slot
        else:
            break

    if injected:
        logger.warning(
            "image_distribution_safety_net_fired",
            catalog_size=len(image_catalog),
            non_logo_pool_size=len(non_logo_pool),
            llm_referenced_count=len(already_referenced),
            injected=injected,
        )


async def materialize_plan_artifacts(
    plan: dict[str, Any], ctx: InvocationContext
) -> dict[str, Any]:
    """Inline ``app_building_plan_artifact`` and per-component
    ``building_plan_artifact`` references into their ``list[str]``
    counterparts.

    Mutates ``plan`` in place; also returns it for caller convenience.

    Inline bullets (``building_plan`` / ``app_building_plan`` lists the
    Creator emits directly, e.g. on non-Gemini providers like
    deepseek-v4-flash that skip the ``save_plan_artifact`` tool flow) take
    precedence: the resolution order is inline > artifact > synthesis.

    Behavior:
    - Successful materialization: artifact body is parsed into
      ``building_plan`` / ``app_building_plan`` as a new dict key
      (these keys do not exist in the Creator-emitted dict) AND the
      artifact-ref field is cleared so downstream callers see a single
      source of truth.
    - Missing/empty artifact body: warns and leaves the dict unchanged.
      The post-materialization workflow guard catches plans where the
      content components never received bullets.
    - Idempotent: calling twice is safe; the second call sees an empty
      artifact ref (cleared on first pass) and is a true no-op.
    - Decomposition / design-import paths populate ``building_plan``
      directly via the runner (no artifact ref) — materializer skips
      those entries.
    - Naming-convention fallback: when a content / ``WebPageProps``
      component has empty ``building_plan_artifact`` AND empty
      ``building_plan``, attempt to load ``plan:{component_name}.md``
      (the deterministic key that ``save_plan_artifact`` writes). This
      recovers from a Gemini structured-output regression where the
      model successfully calls the tool but drops the resulting
      filename from its ``CreatorOutput`` JSON. Schema-level enforcement
      lives on ``CreatorOutput`` itself; the fallback is the safety net
      for whatever slips past validation.
    """
    if not isinstance(plan, dict):
        return plan

    # App-wide plan. Inline bullets (non-Gemini Path B) win over an artifact ref.
    app_inline = plan.get("app_building_plan")
    if isinstance(app_inline, list) and app_inline:
        plan["app_building_plan_artifact"] = ""
        logger.info(
            "plan_artifact_materialized_inline",
            scope="app",
            bullet_count=len(app_inline),
        )
        app_artifact = ""
    else:
        app_artifact = (plan.get("app_building_plan_artifact") or "").strip()
    if app_artifact:
        body = await ArtifactManager.load_artifact_as_string(ctx, app_artifact)
        if body:
            plan["app_building_plan"] = _parse_plan_markdown(body)
            plan["app_building_plan_artifact"] = ""
            logger.info(
                "plan_artifact_materialized",
                scope="app",
                filename=app_artifact,
                bullet_count=len(plan["app_building_plan"]),
            )
        else:
            logger.warning(
                "plan_artifact_missing_or_empty",
                scope="app",
                filename=app_artifact,
            )

    # Per-component plans
    component_plans = plan.get("component_plans") or []
    if isinstance(component_plans, list):
        _check_no_duplicate_building_plan_artifacts(component_plans)
        for cp in component_plans:
            if not isinstance(cp, dict):
                continue
            cp_inline = cp.get("building_plan")
            if isinstance(cp_inline, list) and cp_inline:
                # Inline bullets (non-Gemini Path B) win over any artifact ref;
                # no artifact load and no synthesis needed for this component.
                cp["building_plan_artifact"] = ""
                logger.info(
                    "plan_artifact_materialized_inline",
                    scope="component",
                    component=cp.get("name"),
                    bullet_count=len(cp_inline),
                )
                continue
            cp_artifact = (cp.get("building_plan_artifact") or "").strip()
            if not cp_artifact:
                # Naming-convention fallback. When Creator's structured
                # output drops ``building_plan_artifact`` on a content row
                # despite the save_plan_artifact tool having run (a known
                # Gemini 3 Flash Preview adherence regression on
                # optional-by-schema, required-by-prose fields), the saved
                # artifact still exists at the deterministic key
                # ``plan:{component_name}.md`` because save_plan_artifact's
                # ``artifact_name`` argument is the component name. Try
                # that key before giving up; downstream guard recovers a
                # build that would otherwise hard-fail. Limited to
                # ``role==content`` + ``page_type==WebPageProps`` (where
                # the schema-level rule applies) and only fires when the
                # component still has no inline ``building_plan`` either.
                if (
                    cp.get("role") == "content"
                    and cp.get("page_type", "WebPageProps") == "WebPageProps"
                    and not cp.get("building_plan")
                    and cp.get("name")
                ):
                    fallback_filename = f"plan:{cp['name']}.md"
                    fallback_body = await ArtifactManager.load_artifact_as_string(
                        ctx, fallback_filename
                    )
                    if fallback_body:
                        cp["building_plan"] = _parse_plan_markdown(fallback_body)
                        cp["building_plan_artifact"] = ""
                        logger.warning(
                            "plan_artifact_naming_convention_fallback",
                            scope="component",
                            component=cp.get("name"),
                            filename=fallback_filename,
                            bullet_count=len(cp["building_plan"]),
                        )
                continue
            body = await ArtifactManager.load_artifact_as_string(ctx, cp_artifact)
            if body:
                cp["building_plan"] = _parse_plan_markdown(body)
                cp["building_plan_artifact"] = ""
                logger.info(
                    "plan_artifact_materialized",
                    scope="component",
                    component=cp.get("name"),
                    filename=cp_artifact,
                    bullet_count=len(cp["building_plan"]),
                )
            else:
                logger.warning(
                    "plan_artifact_missing_or_empty",
                    scope="component",
                    component=cp.get("name"),
                    filename=cp_artifact,
                )

    # Synthesis safety net. Any content component still without a
    # ``building_plan`` after artifact resolution gets one synthesized from the
    # rich planning fields the Creator did emit (page summaries, title,
    # interactive elements, content artifact). This fires when the model
    # references a ``plan:*.md`` artifact it never actually saved — common with
    # models that emit the final structured plan in a single turn without the
    # intermediate ``save_plan_artifact`` tool calls (e.g. several OpenRouter /
    # LiteLLM providers, vs Gemini's multi-turn tool flow). Degrades gracefully
    # to a usable plan instead of hard-failing the whole build; the downstream
    # guard still fires only for plans with no recoverable detail at all.
    if isinstance(component_plans, list):
        for cp in component_plans:
            if not isinstance(cp, dict):
                continue
            if cp.get("role") != "content" or cp.get("building_plan"):
                continue
            synthesized = _synthesize_building_plan(cp)
            if synthesized:
                cp["building_plan"] = synthesized
                cp["building_plan_artifact"] = ""
                logger.warning(
                    "plan_artifact_synthesized_from_summary",
                    component=cp.get("name"),
                    bullet_count=len(synthesized),
                )

    # Image-distribution safety net. Runs after plan materialization so the
    # ``component_plans`` list reflects everything Creator emitted (and any
    # naming-convention fallbacks above). Reads the structured image catalog
    # from session state; no-op when absent or when Creator already
    # distributed enough UUIDs.
    image_catalog = ctx.session.state.get("image_catalog", []) or []
    if isinstance(image_catalog, list):
        _distribute_unused_catalog_images(plan, image_catalog)

    return plan


def _check_no_duplicate_building_plan_artifacts(component_plans: list[Any]) -> None:
    """Reject plans where ≥2 content components share a building_plan_artifact.

    Creator routinely emits PrivacyContent.building_plan_artifact ==
    TermsContent.building_plan_artifact == plan:AboutContent.md, which causes
    /privacy-policy and /terms to render brand storytelling instead of legal
    copy (seen 2026-05-12 on luna-rest / jmhd6gv7). Each content component
    must own its plan; legal pages must get a dedicated boilerplate plan, not
    borrow the About plan.

    Header/footer/system roles are exempt — they don't carry page semantics
    so the dedup only fires when ``role == "content"``.
    """
    refs: dict[str, list[str]] = {}
    for cp in component_plans:
        if not isinstance(cp, dict):
            continue
        if cp.get("role") != "content":
            continue
        ref = (cp.get("building_plan_artifact") or "").strip()
        if not ref:
            continue
        refs.setdefault(ref, []).append(cp.get("name") or "<unnamed>")
    collisions = {ref: names for ref, names in refs.items() if len(names) > 1}
    if not collisions:
        return
    details = "; ".join(f"{ref} shared by {names}" for ref, names in collisions.items())
    raise PipelineError(
        "Creator emitted duplicate building_plan_artifact references across "
        f"content components: {details}. Each content component MUST have "
        "its own building_plan_artifact (legal pages get a dedicated "
        "boilerplate plan; do not borrow plan:AboutContent.md for "
        "/privacy-policy or /terms).",
        severity=ErrorSeverity.FATAL,
        step_name="plan_artifact_materializer.materialize_plan_artifacts",
    )


def _synthesize_building_plan(cp: dict[str, Any]) -> list[str]:
    """Build a usable ``building_plan`` from a component's other planning fields.

    Last-resort recovery for when a content component has no plan artifact body
    (the model referenced an artifact it never saved). The Creator still emits
    ``page_title`` / ``page_short_summary`` / ``page_summary`` /
    ``interactive_elements`` / ``content_artifact`` — enough to give
    ComponentBuilder actionable direction. Returns ``[]`` only when none of
    those fields carry any signal, in which case the downstream guard fires.
    """
    bullets: list[str] = []

    title = (cp.get("page_title") or "").strip()
    if title:
        bullets.append(f"Page title: {title}")

    short = (cp.get("page_short_summary") or "").strip()
    if short:
        bullets.append(short)

    summary = (cp.get("page_summary") or "").strip()
    if summary:
        for sentence in re.split(r"(?<=[.!?])\s+", summary):
            s = sentence.strip()
            if s and s != short:
                bullets.append(s)

    interactive = cp.get("interactive_elements")
    if isinstance(interactive, list) and interactive:
        items = ", ".join(str(x).strip() for x in interactive if str(x).strip())
        if items:
            bullets.append(f"Include interactive elements: {items}")

    content_ref = (cp.get("content_artifact") or "").strip()
    if content_ref:
        bullets.append(f"Load page copy/content from artifact: {content_ref}")

    # De-dupe while preserving order (title/short can repeat sentences).
    seen: set[str] = set()
    deduped: list[str] = []
    for b in bullets:
        if b not in seen:
            seen.add(b)
            deduped.append(b)
    return deduped


_BULLET_PREFIXES: tuple[str, ...] = ("- ", "* ", "+ ", "• ")


def _parse_plan_markdown(md: str) -> list[str]:
    """Split markdown into bullets.

    Each non-empty, non-header line becomes one entry, with leading bullet
    markers and surrounding whitespace stripped. Lines starting with ``#``
    are treated as section markers and skipped.
    """
    lines: list[str] = []
    for raw in md.splitlines():
        s = raw.strip()
        if not s:
            continue
        if s.startswith("#"):
            continue
        for prefix in _BULLET_PREFIXES:
            if s.startswith(prefix):
                s = s[len(prefix) :].strip()
                break
        if s:
            lines.append(s)
    return lines
