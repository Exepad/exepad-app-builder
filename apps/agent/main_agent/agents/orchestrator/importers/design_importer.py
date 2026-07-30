"""DesignImporter — skill-based LLM agent with artifact + Pydantic I/O.

This agent runs after ``bundle_stager.stage_bundle_artifacts`` has saved the
raw uploaded design-tool files as ``bundle:*`` artifacts and left a skill
context pointer on session state under
``design_bundle_skill_context`` (key defined in
``bundle_stager.BUNDLE_SKILL_CONTEXT_STATE_KEY``).

Responsibilities:

  * Inspect the ``manifest_markdown`` provided in the user message to discover
    what files were staged.
  * Load additional ``bundle:*`` files on demand.
  * Emit a structured ``DecompositionPlan`` describing slug mappings, chrome
    role assignments, theme token mappings, navigation, and backend intent.

The DesignImporter LLM **never types HTML or CSS bodies**. After the LLM
finishes, the deterministic ``run_design_decomposition`` runner (see
``importers/tools/decomposition/runner.py``) reads the validated plan and
the original ``bundle:*`` artifacts, and writes every ``content:*.html``,
``codefocus_style:theme.css``, and metadata artifact byte-for-body-faithful
from the staged source. The synthesized creator plan is stored under
``design_decomposition_creator_plan`` in session state.

The agent has no write surface — its only output is the validated
``DecompositionPlan`` JSON stored under ``state["design_decomposition_plan"]``
by ADK's ``output_key`` machinery. The runner takes over from there.

The agent's instruction is a short preamble that points the LLM at the
``SkillToolset``: the dispatcher writes ``skill_name`` (one of
``stitch-importer`` / ``claude-design-importer``) into session state under
``design_bundle_skill_context`` and the LLM calls ``load_skill`` on it to
read the format-specific decomposition rules. The shared cross-format
contract is inlined at the top of each SKILL.md body, so a single
``load_skill`` call returns everything the importer needs.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Optional
from urllib.parse import unquote

import httpx
import structlog
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from google import genai
from google.adk.agents import LlmAgent
from google.adk.agents.readonly_context import ReadonlyContext
from google.adk.planners import BuiltInPlanner
from google.adk.tools import load_artifacts
from google.adk.tools.skill_toolset import SkillToolset
from google.genai import types
from pydantic import BaseModel, Field

from config import AgentName, get_agent_model
from main_agent.net.url_guard import assert_safe_url, UnsafeUrlError
from main_agent.agents.utils.agent_docs_loader import InstructionBuilder
from main_agent.agents.utils.skills import load_design_importer_skills
from main_agent.agents.utils.thought_signature_fix import (
    strip_thinking_from_response,
    strip_thinking_metadata,
)
from main_agent.agents.orchestrator.importers.tools.decomposition.plan import (
    DecompositionPlan,
)
from main_agent.agents.utils.artifact_manager import ArtifactManager
from main_agent.agents.tools.content_artifact_tools import save_plan_artifact_tool

load_dotenv()

logger = structlog.get_logger(__name__)


# ----------------------------------------------------------------------------
# Image download helpers used by the post-import materializer
# ----------------------------------------------------------------------------

_IMAGE_DOWNLOAD_TIMEOUT_SECONDS = 10.0
_IMAGE_DOWNLOAD_SIZE_CAP_BYTES = 4 * 1024 * 1024  # 4 MiB
_IMAGE_DOWNLOAD_MAX_REDIRECTS = 3
_IMAGE_REDIRECT_STATUSES = (301, 302, 303, 307, 308)

_CONTENT_TYPE_TO_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "image/avif": "avif",
}


def _ext_from_url(url: str) -> str:
    """Guess a file extension from the URL path (last dotted token)."""
    path = url.split("?", 1)[0].split("#", 1)[0]
    _, _, last = path.rpartition("/")
    if "." in last:
        ext = last.rsplit(".", 1)[-1].lower()
        if 1 <= len(ext) <= 5 and ext.isalnum():
            return ext
    return ""


def _ext_for_image_asset(mime: str, url: str) -> str:
    """Pick a stable file extension for an imported image blob."""
    return _CONTENT_TYPE_TO_EXT.get(mime.lower(), "") or _ext_from_url(url) or "bin"


# Status codes that indicate the upstream image is permanently gone — these
# trigger Pexels recovery. Transient errors (5xx, timeouts) do not.
_DEAD_SOURCE_STATUS_CODES = (404, 410, 451)
# Maximum Pexels recoveries per workflow. Past this we fall back to the
# downstream sibling-image fallback to avoid runaway API usage on a fully
# stale bundle. Pexels free tier is 200 requests/hour.
_PEXELS_RECOVERY_CAP_PER_WORKFLOW = 20
# Pexels Search API endpoint. Requires `PEXELS_API_KEY` in env.
_PEXELS_SEARCH_URL = "https://api.pexels.com/v1/search"


def _is_dead_source_error(error_message: str) -> bool:
    """Return True when the download error indicates a permanently-gone source.

    The materializer should only fall back to Pexels for permanent-gone
    statuses (404 / 410 / 451). Transient failures (timeouts, 5xx) might
    succeed on a retry and shouldn't pollute the failure budget.
    """
    if not error_message:
        return False
    for code in _DEAD_SOURCE_STATUS_CODES:
        if f"status {code}" in error_message:
            return True
    return False


def _pexels_query_from_img(img) -> str:
    """Pick the most descriptive label for a Pexels search.

    Prefers ``data-alt`` (the imported designer's caption), falling back
    to ``alt``. Strips Claude-Design's ``·``-separated style suffixes
    (e.g. ``"Brown eggs · ¾ ratio"`` → ``"Brown eggs"``) so the search
    isn't biased by ratio/orientation hints that confuse Pexels.
    """
    raw = (img.get("data-alt") or img.get("alt") or "").strip()
    if not raw:
        return ""
    # Drop everything after the first centered-dot or em-dash separator —
    # Claude Design uses these to pin photo direction / ratio. The search
    # quality drops sharply with those qualifiers in the query.
    cleaned = re.split(r"\s*[·—]\s*", raw, maxsplit=1)[0].strip()
    # Remove obvious shape qualifiers that pollute Pexels results.
    cleaned = re.sub(
        r"\b(?:flat lay|top.down|hero|crop|portrait|landscape|square|ratio)\b",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip()
    return cleaned or raw


async def _pexels_recover_url(query: str, target_width: int) -> Optional[str]:
    """Search Pexels for ``query`` and return the best matching image URL.

    Returns ``None`` when the API key is missing, the search fails, or no
    suitable photo is found. The selected URL prefers Pexels's
    ``large2x`` variant when ``target_width >= 1100`` else ``large``.
    """
    api_key = os.getenv("PEXELS_API_KEY", "")
    if not api_key:
        logger.warning("pexels_recovery_missing_api_key", query=query[:60])
        return None
    if not query:
        return None
    headers = {"Authorization": api_key}
    params = {"query": query, "per_page": 1}
    if target_width and target_width <= 800:
        params["orientation"] = "landscape"  # smaller crops bias landscape
    try:
        async with httpx.AsyncClient(timeout=_IMAGE_DOWNLOAD_TIMEOUT_SECONDS) as client:
            resp = await client.get(_PEXELS_SEARCH_URL, headers=headers, params=params)
    except httpx.HTTPError as exc:
        logger.warning("pexels_recovery_transport_error", error=str(exc), query=query[:60])
        return None
    if resp.status_code != 200:
        logger.warning(
            "pexels_recovery_non_200",
            status=resp.status_code,
            query=query[:60],
        )
        return None
    payload = resp.json() if resp.content else {}
    photos = (payload or {}).get("photos") or []
    if not photos:
        return None
    src_block = photos[0].get("src") or {}
    # Choose the best size given the original asset's intent. The Pexels
    # API returns: original > large2x > large > medium > small > tiny.
    if target_width and target_width >= 1100:
        return src_block.get("large2x") or src_block.get("large") or src_block.get("original")
    return src_block.get("large") or src_block.get("medium") or src_block.get("original")


async def _get_image_following_redirects(client: "httpx.AsyncClient", url: str):
    """GET ``url``, following up to N redirects, SSRF-validating EACH hop.

    Returns the final ``httpx.Response`` (any status), or raises
    :class:`UnsafeUrlError` if a hop targets an internal/metadata address.
    Returns ``None`` when the redirect cap is exceeded.
    """
    current = url
    for _ in range(_IMAGE_DOWNLOAD_MAX_REDIRECTS + 1):
        resp = await client.get(current)
        if resp.status_code not in _IMAGE_REDIRECT_STATUSES:
            return resp
        location = resp.headers.get("location")
        if not location:
            return resp  # malformed redirect — surfaced as a non-200 by caller
        current = str(httpx.URL(current).join(location))
        await assert_safe_url(current)  # re-validate before following
    return None  # too many redirects


async def _download_external_image(url: str) -> tuple[Optional[bytes], str]:
    """GET the URL with timeout + size cap. Returns (bytes_or_None, content_type).

    Returns ``(None, "<error message>")`` on failure. SSRF-guarded: the initial
    URL and every redirect hop must resolve to a public address, so an attacker
    can't point (or 302-redirect) an ``<img src>`` at cloud metadata / loopback.
    """
    try:
        await assert_safe_url(url)
    except UnsafeUrlError as exc:
        return None, f"blocked URL: {exc}"

    try:
        # follow_redirects=False: we follow manually so each hop is re-validated.
        async with httpx.AsyncClient(
            timeout=_IMAGE_DOWNLOAD_TIMEOUT_SECONDS, follow_redirects=False
        ) as client:
            resp = await _get_image_following_redirects(client, url)
    except UnsafeUrlError as exc:
        return None, f"blocked redirect: {exc}"
    except httpx.HTTPError as exc:
        return None, f"transport error: {exc}"
    if resp is None:
        return None, "too many redirects"
    if resp.status_code != 200:
        return None, f"status {resp.status_code}"
    content_type = (resp.headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if content_type and not content_type.startswith("image/"):
        return None, f"unexpected content-type {content_type!r}"
    data = resp.content
    if len(data) > _IMAGE_DOWNLOAD_SIZE_CAP_BYTES:
        return (
            None,
            f"payload {len(data)} bytes exceeds {_IMAGE_DOWNLOAD_SIZE_CAP_BYTES}-byte cap",
        )
    if not data:
        return None, "empty body"
    return data, content_type or "application/octet-stream"


# ----------------------------------------------------------------------------
# Post-import image materialization — mechanical, not LLM-owned
# ----------------------------------------------------------------------------

# The LLM decomposes HTML. Image bytes are then materialized mechanically:
# every imported ``content:*.html`` artifact is scanned with BeautifulSoup,
# external/bundle-relative image sources are uploaded into the app repo asset
# namespace, and the HTML artifact is rewritten with ``data-asset-relpath`` so
# ComponentBuilder can preserve the authored image.

_IMPORT_ASSET_PREFIX = "imports"
_DESIGN_IMPORT_ASSETS_STATE_KEY = "_design_import_assets"
_DESIGN_IMPORT_ASSET_MANIFEST_ARTIFACT = "design_import/asset-manifest.json"


def _design_import_asset_relpath(source_id: str, mime: str, fallback_url: str = "") -> str:
    """Return ``imports/<hash>.<ext>`` for a source URL/path."""
    h = hashlib.sha256(source_id.encode("utf-8")).hexdigest()[:16]
    ext = _ext_for_image_asset(mime, fallback_url or source_id)
    return f"{_IMPORT_ASSET_PREFIX}/{h}.{ext}"


def _inline_data_bytes_and_mime(artifact) -> tuple[Optional[bytes], str]:
    """Extract bytes + MIME from an ADK artifact Part."""
    if artifact is None or not hasattr(artifact, "inline_data") or artifact.inline_data is None:
        return None, ""
    data = artifact.inline_data.data
    if isinstance(data, str):
        data = data.encode("utf-8")
    mime = getattr(artifact.inline_data, "mime_type", "") or "application/octet-stream"
    return data, mime


async def _load_artifact_part(ctx, filename: str):
    return await ctx.artifact_service.load_artifact(
        session_id=ctx.session.id,
        user_id=ctx.session.user_id,
        app_name=ctx.session.app_name,
        filename=filename,
    )


async def _load_bundle_asset_bytes(
    ctx,
    *,
    src: str,
    artifact_keys: list[str],
) -> tuple[Optional[bytes], str, str]:
    """Resolve an imported relative image src to staged ``bundle:asset:*`` bytes.

    Returns ``(data, mime, artifact_key)`` or ``(None, error, "")``.
    """
    src_clean = (src or "").strip().split("?", 1)[0].split("#", 1)[0].lstrip("/")
    src_clean = unquote(src_clean)
    while src_clean.startswith("./"):
        src_clean = src_clean[2:]
    if not src_clean:
        return None, "empty bundle asset src", ""

    candidates = [f"bundle:asset:{src_clean}"]
    for key in artifact_keys:
        if not isinstance(key, str) or not key.startswith("bundle:asset:"):
            continue
        rel = key[len("bundle:asset:") :]
        if rel == src_clean or rel.endswith(f"/{src_clean}"):
            candidates.append(key)

    seen: set[str] = set()
    for key in candidates:
        if key in seen:
            continue
        seen.add(key)
        try:
            artifact = await _load_artifact_part(ctx, key)
        except Exception:  # noqa: BLE001
            continue
        data, mime = _inline_data_bytes_and_mime(artifact)
        if data:
            return data, mime, key
    return None, f"bundle asset not found for src {src!r}", ""


async def _upload_design_import_asset(
    *,
    app_uuid: str,
    relpath: str,
    data: bytes,
    mime: str,
) -> None:
    """Re-host one imported design asset to the app's object store.

    No-op in self-host: object-store re-hosting was removed with the GCS
    coupling, and design imports are a cloud-only feature unreachable here
    (see ``dispatch_design_bundle``). Kept as a seam so the image materializer
    and its tests retain their contract.
    """
    logger.debug(
        "design_import_asset_rehost_skipped",
        app_uuid=app_uuid,
        relpath=relpath,
        detail="object-store re-hosting removed (self-host has no GCS)",
    )


async def _save_text_artifact(ctx, filename: str, text: str, mime: str) -> None:
    artifact = genai.types.Part.from_bytes(data=text.encode("utf-8"), mime_type=mime)
    await ctx.artifact_service.save_artifact(
        session_id=ctx.session.id,
        user_id=ctx.session.user_id,
        app_name=ctx.session.app_name,
        filename=filename,
        artifact=artifact,
    )


async def _materialize_one_img(
    ctx,
    *,
    app_uuid: str,
    img,
    artifact_keys: list[str],
    asset_registry: dict,
    manifest: dict,
) -> bool:
    """Materialize one ``<img>`` tag. Returns True when the tag changed."""
    src = (img.get("src") or "").strip()
    if not src:
        return False

    is_external = src.startswith("http://") or src.startswith("https://")
    source_key = f"url:{src}" if is_external else f"bundle:{src}"
    cached = asset_registry.get(source_key)
    if cached:
        img["data-asset-relpath"] = cached["relpath"]
        if is_external:
            img["data-source-url"] = src
        else:
            img["data-source-path"] = src
        img["src"] = ""
        return True

    if is_external:
        data, mime_or_err = await _download_external_image(src)
        source_artifact = ""
        if data is None:
            # Pexels recovery: only for permanent-gone responses (404/410/451)
            # and only while the per-workflow cap is unspent. Transient
            # failures (timeouts, 5xx) bail without burning the budget.
            recovered_url: Optional[str] = None
            recovered_data: Optional[bytes] = None
            recovered_mime: str = ""
            recoveries = int(manifest.get("pexels_recoveries", 0))
            if (
                _is_dead_source_error(mime_or_err)
                and recoveries < _PEXELS_RECOVERY_CAP_PER_WORKFLOW
            ):
                query = _pexels_query_from_img(img)
                target_width = 0
                width_attr = (img.get("width") or "").strip()
                if width_attr.isdigit():
                    target_width = int(width_attr)
                else:
                    # Pull the Unsplash `w=N` query param if present —
                    # the original URL encodes the designer's intended size.
                    m = re.search(r"[?&]w=(\d+)", src)
                    if m:
                        target_width = int(m.group(1))
                pexels_url = await _pexels_recover_url(query, target_width)
                if pexels_url:
                    rec_data, rec_mime = await _download_external_image(pexels_url)
                    if rec_data is not None:
                        recovered_url = pexels_url
                        recovered_data = rec_data
                        recovered_mime = rec_mime
                        manifest["pexels_recoveries"] = recoveries + 1
                        logger.info(
                            "design_import_pexels_recovery_ok",
                            original=src[:120],
                            replacement=pexels_url[:120],
                            query=query[:80],
                        )
            if recovered_data is None:
                manifest["failures"].append({"src": src, "kind": "external", "error": mime_or_err})
                return False
            # Treat the recovered Pexels URL as the new effective source for
            # this asset — caching, hashing, manifest entry all key off it
            # so a duplicate stale-URL across artifacts will reuse the
            # recovered bytes instead of re-querying Pexels.
            src = recovered_url or src
            source_key = f"url:{src}"
            data = recovered_data
            mime = recovered_mime
        else:
            mime = mime_or_err
    else:
        data, mime_or_err, source_artifact = await _load_bundle_asset_bytes(
            ctx,
            src=src,
            artifact_keys=artifact_keys,
        )
        if data is None:
            manifest["failures"].append({"src": src, "kind": "bundle", "error": mime_or_err})
            return False
        mime = mime_or_err

    relpath = _design_import_asset_relpath(source_key, mime, src)
    content_hash = hashlib.sha256(data).hexdigest()
    try:
        await _upload_design_import_asset(
            app_uuid=app_uuid,
            relpath=relpath,
            data=data,
            mime=mime,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception(
            "design_import_asset_upload_failed",
            src=src[:120],
            relpath=relpath,
        )
        manifest["failures"].append(
            {"src": src, "kind": "external" if is_external else "bundle", "error": str(exc)}
        )
        return False

    entry = {
        "relpath": relpath,
        "mime": mime,
        "size": len(data),
        "source_hash": f"sha256:{content_hash}",
        "source_url": src if is_external else "",
        "source_path": "" if is_external else src,
        "source_artifact": source_artifact,
    }
    asset_registry[source_key] = entry
    manifest["assets"].append(entry)

    img["data-asset-relpath"] = relpath
    if is_external:
        img["data-source-url"] = src
    else:
        img["data-source-path"] = src
    img["src"] = ""
    return True


async def materialize_design_import_images(ctx, app_uuid: str) -> int:
    """Materialize every image referenced by imported ``content:*.html``.

    The DesignImporter LLM leaves image ``src`` values untouched. This helper
    mechanically uploads those bytes to ``<app_uuid>/assets/imports/...``,
    rewrites the HTML artifacts with stable ``data-asset-relpath`` attributes,
    and records ``_design_import_assets`` for the deploy manifest.
    """
    if not app_uuid:
        logger.warning("design_import_image_materializer_missing_app_uuid")
        return 0

    try:
        artifact_keys = await ctx.artifact_service.list_artifact_keys(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("design_import_image_materializer_list_failed", error=str(exc))
        return 0

    content_keys = [
        k
        for k in artifact_keys
        if isinstance(k, str) and k.startswith("content:") and k.endswith(".html")
    ]
    if not content_keys:
        return 0

    asset_registry: dict = dict(ctx.session.state.get(_DESIGN_IMPORT_ASSETS_STATE_KEY, {}) or {})
    manifest = {
        "assets": [],
        "failures": [],
        "processed_artifacts": [],
        # Counter for Pexels recoveries used by ``_materialize_one_img`` to
        # respect the per-workflow cap. Stays an int even on no-recovery
        # builds so downstream telemetry can always read it.
        "pexels_recoveries": 0,
    }
    rewritten_images = 0

    for artifact_key in sorted(content_keys):
        html = await ArtifactManager.load_artifact_as_string(ctx, artifact_key)
        if not html:
            continue
        soup = BeautifulSoup(html, "html.parser")
        changed = False
        for img in soup.find_all("img"):
            if await _materialize_one_img(
                ctx,
                app_uuid=app_uuid,
                img=img,
                artifact_keys=artifact_keys,
                asset_registry=asset_registry,
                manifest=manifest,
            ):
                changed = True
                rewritten_images += 1
        if changed:
            await _save_text_artifact(ctx, artifact_key, str(soup), "text/html")
        manifest["processed_artifacts"].append(artifact_key)

    ctx.session.state[_DESIGN_IMPORT_ASSETS_STATE_KEY] = asset_registry
    await _save_text_artifact(
        ctx,
        _DESIGN_IMPORT_ASSET_MANIFEST_ARTIFACT,
        json.dumps(manifest, indent=2, ensure_ascii=False),
        "application/json",
    )
    logger.info(
        "design_import_image_materializer_done",
        rewritten_images=rewritten_images,
        assets=len(asset_registry),
        failures=len(manifest["failures"]),
        pexels_recoveries=int(manifest.get("pexels_recoveries", 0)),
    )
    return rewritten_images


# ----------------------------------------------------------------------------
# Agent handoff schema
# ----------------------------------------------------------------------------


class DesignImporterInput(BaseModel):
    """Thin handoff struct — the agent reads source files from artifacts.

    The workflow pushes this as the agent's opening user message so the LLM
    sees the source format, user request context, target language, and manifest
    body immediately. The staged bundle files themselves remain artifacts and
    are loaded on demand via ``load_artifacts``.
    """

    source: str = Field(
        description="Format of the uploaded bundle (e.g. 'stitch', 'claude-design')."
    )
    app_name: str = Field(
        description=(
            "Requested app name from session state. **Copy this string verbatim "
            "into `creator_plan.app_name` — it is the user's chosen brand name.** "
            "The ONLY exception: when this string is empty or matches a "
            "placeholder pattern (case-insensitive equality after stripping "
            "whitespace) `''`, `untitled`, `new app`, `my app`, `test`, `app`, "
            "`create`, `make me an app`, infer a Title Case name from the "
            "design's brand mark or hero headline. Do NOT override "
            "non-placeholder names (e.g. `Chick Farm`, `School Dashboard`) "
            "even when the bundle's baked-in copy uses a different brand — "
            "the user controls branding."
        ),
    )
    app_description: str = Field(
        description=(
            "Original user prompt or request text. The uploaded design remains "
            "authoritative when this conflicts with the design content."
        ),
    )
    app_language_code: str = Field(
        default="en",
        description="ISO 639-1 language code of the target app.",
    )
    manifest_markdown: str = Field(
        description=(
            "Full text of the staged bundle manifest. This is the file index "
            "the agent should inspect before deciding which bundle:* artifacts "
            "to load."
        ),
    )


# ----------------------------------------------------------------------------
# Instruction provider
# ----------------------------------------------------------------------------


def design_importer_instruction_provider(context: ReadonlyContext) -> str:
    """Build the DesignImporter prompt — preamble + load_skill directive.

    The format-specific decomposition rules (and the shared cross-format
    contract) live as SKILL.md bodies under
    ``packages/schemas/data/agent_docs/design_bundle_importer/<skill>/``.
    The dispatcher writes the chosen ``skill_name`` into session state
    under ``design_bundle_skill_context``; this provider surfaces it in
    the prompt and tells the LLM to ``load_skill`` it.
    """
    state: dict = {}
    try:
        state = getattr(context, "state", None) or {}
    except Exception:  # noqa: BLE001
        state = {}

    ctx_info: dict = state.get("design_bundle_skill_context") or {}
    skill_name: str = str(ctx_info.get("skill_name") or "")

    preamble = (
        "# DesignBundleImporter\n"
        "\n"
        "A user uploaded a design-tool export. The raw files are already "
        "staged as `bundle:*` artifacts. Your job: produce a thin JSON "
        "decomposition plan describing how those bundle files should be "
        "split into pages, chrome (header/sidebar/footer), and theme "
        "tokens. **You do NOT emit HTML or CSS bodies.** A deterministic "
        "Python runner reads your plan and writes every `content:*.html`, "
        "`codefocus_style:theme.css`, and metadata artifact by extracting "
        "and cleaning the original `bundle:*` source bytes — so HTML / "
        "CSS / scripts are preserved 100% byte-faithfully.\n"
        "\n"
        "The staged bundle manifest is already included in your input as "
        "`manifest_markdown`. It is the human-readable index of every staged "
        "file, with MIME type and a short description. Read it first. The "
        "input also includes `app_name`, `app_description`, and "
        "`app_language_code`. **The uploaded design is authoritative for page "
        "set, layout, visual direction, and structural copy** — but the "
        "user's `app_name` is authoritative for branding (see the field's "
        "Pydantic description for the exact override-rule for placeholder "
        "names). Use `load_artifacts` only for the specific `bundle:*` "
        "entries you need to inspect when judging slugs, chrome regions, or "
        "theme token mappings.\n"
        "\n"
        "## ACTIVE FORMAT — LOAD YOUR SKILL FIRST\n"
        "\n"
        f"The dispatcher selected `skill_name = \"{skill_name}\"`. Before "
        "anything else, call `load_skill(skill_name=...)` with that exact "
        "name. The returned SKILL.md body inlines BOTH the shared "
        "cross-format contract (allow-listed output names, slug rules, "
        "navigation / backend-intent shapes, theme token mapping rules) "
        "AND the format-specific decomposition rules. Treat the loaded "
        "body as authoritative — it overrides any conflicting hint in "
        "the preamble below.\n"
        "\n"
        "Return exactly one JSON object matching the `DecompositionPlan` "
        "schema. Required fields:\n"
        "  * `format` — `claude_design` or `stitch`.\n"
        "  * `pages` — one PageMapping per page; every `bundle_artifact` "
        "must reference a real staged `bundle:html:*` key. `output_artifact` "
        "must match `content::page.html` (homepage) or "
        "`content:<kebab-slug>:page.html`.\n"
        "  * `chrome` — header / sidebar / footer extraction directives. "
        "`source_artifact` is any staged `bundle:*` key; `selector` is the "
        "CSS selector that picks the chrome region.\n"
        "  * `theme.pillars` — pick FOUR seed colors: `primary`, "
        "`secondary`, `surface`, `error`. Each value is either a source "
        "`--var` name from the bundle (preferred — e.g. `--barn`, "
        "`--cream`) OR a literal `#rrggbb` hex. The runner derives the "
        "remaining 26 M3 tokens (on-*, containers, surface tints, "
        "outlines, inverse) from these four with WCAG AA contrast "
        "guaranteed; you do NOT enumerate them.\n"
        "  * `navigation` — body of `design_import/navigation.json`.\n"
        "  * `creator_plan` — full CreatorOutput-compatible plan. The "
        "runner OVERRIDES `component_plans` (re-pointed at the artifacts "
        "the runner emits) and `design_system.{primary,secondary,surface,"
        "error}_color` plus fonts (resolved from theme tokens). Every "
        "other field — reasoning, app_name, design_style bullets, "
        "security plan, favicon — is kept verbatim. "
        "The CreatorOutput schema has NO inline app-wide plan field — it "
        "lives in an artifact. Save it via "
        "`save_plan_artifact(artifact_name='app', plan_md='...')` and set "
        "`app_building_plan_artifact = 'plan:app.md'`. DO NOT call "
        "save_plan_artifact for individual components — the runner "
        "overrides component_plans, so per-component plan artifacts would "
        "be orphaned and waste tokens.\n"
        "  * `notes` — short markdown summary of import decisions; the "
        "runner appends a `## Unmatched placeholders` section automatically "
        "when applicable.\n"
        "\n"
        "Do NOT embed HTML or CSS bodies in your output. The runner emits "
        "every byte of those from the staged sources."
    )

    return InstructionBuilder().add(preamble).build()


# DesignImporter SkillToolset — built once at import time. The LLM calls
# load_skill at inference time on whichever skill the dispatcher named in
# session state.
_DESIGN_IMPORTER_SKILL_TOOLSET = SkillToolset(skills=load_design_importer_skills())


# ----------------------------------------------------------------------------
# Agent definition
# ----------------------------------------------------------------------------


design_importer_agent = LlmAgent(
    name=AgentName.DESIGN_IMPORTER,
    model=get_agent_model(AgentName.DESIGN_IMPORTER),
    description=(
        "Reads a staged design-tool bundle (Stitch / Claude Design) via "
        "bundle:* artifacts and emits a DecompositionPlan describing slug "
        "mappings, chrome roles, theme token mappings, and backend intent. "
        "A deterministic runner then emits every content/theme artifact "
        "byte-for-body-faithful from the staged sources."
    ),
    instruction=design_importer_instruction_provider,
    input_schema=DesignImporterInput,
    output_schema=DecompositionPlan,
    output_key="design_decomposition_plan",
    before_model_callback=strip_thinking_metadata,
    after_model_callback=strip_thinking_from_response,
    generate_content_config=types.GenerateContentConfig(
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),
        # Bound the COMBINED thinking + visible-output budget so an
        # over-detailed DecompositionPlan can't hang the workflow with
        # finish_reason=MAX_TOKENS. Same rationale as Creator
        # (googleapis/python-genai#2062). 32768 is well above any
        # observed DesignDecomposer payload.
        max_output_tokens=32768,
    ),
    planner=BuiltInPlanner(
        thinking_config=types.ThinkingConfig(
            include_thoughts=True,
            thinking_budget=8192,
        )
    ),
    # ``_DESIGN_IMPORTER_SKILL_TOOLSET`` exposes list_skills / load_skill
    # / load_skill_resource for the format-specific decomposition rules.
    # ``load_artifacts`` lets the agent inspect ``bundle:*`` files when
    # judging slugs, chrome regions, or theme token mappings.
    # ``save_plan_artifact`` is required because ``DecompositionPlan``
    # embeds a ``CreatorOutput`` and the artifact-escalation contract
    # applies symmetrically — Creator-class output, Creator-class rules.
    tools=[
        _DESIGN_IMPORTER_SKILL_TOOLSET,
        load_artifacts,
        save_plan_artifact_tool,
    ],
)
