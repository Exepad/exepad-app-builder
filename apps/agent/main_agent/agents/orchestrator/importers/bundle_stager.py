"""Stage raw design-bundle files as artifacts for the DesignImporter agent.

Replaces the `NormalizedSource` + per-format reader pipeline. This stager
does no parsing and no semantic normalization — it downloads each file from
GCS, saves it as an ADK artifact with a stable `bundle:<kind>:<relpath>` key,
and emits a human-readable `bundle:manifest.md` artifact that lists
everything staged. The format-specific skill (``stitch-importer``,
``claude-design-importer``) teaches the LLM how to interpret the
bundle contents — loaded by the DesignImporter at inference time via
its SkillToolset.

The stager is pure plumbing: it knows MIME → artifact-kind mapping and
filename → one-line-description heuristics, nothing else.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

import structlog
from google import genai

logger = structlog.get_logger(__name__)


# ----------------------------------------------------------------------------
# Artifact key convention
# ----------------------------------------------------------------------------

# `bundle:html:<relpath>`           — HTML the importer reads (pages, PRD docs).
# `bundle:script:<relpath>`         — React component sources (.jsx/.tsx) that
#                                     are siblings of `bundle:html:*` shells,
#                                     loaded via `<script type="text/babel" src=…>`.
#                                     The JSX translator pairs them with their
#                                     parent page during decomposition.
# `bundle:asset:<relpath>`          — binary/non-HTML assets (images, CSS, etc.).
# `bundle:doc:<relpath>`            — author-written notes (DESIGN.md, README.md).
# `bundle:context_image:<relpath>`  — user-pasted reference imagery (e.g. Claude
#                                     Design's `uploads/`); load for visual
#                                     intent context only, NEVER deploy.
# `bundle:manifest.md`              — the agent's entry-point index.

_MANIFEST_KEY = "bundle:manifest.md"

# Session-state key where the stager leaves its summary for the workflow to
# hand to the DesignImporter agent and the digester.
BUNDLE_SKILL_CONTEXT_STATE_KEY = "design_bundle_skill_context"

# Map from bundle `source` field to the kebab-case SKILL.md directory under
# `packages/schemas/data/agent_docs/design_bundle_importer/`.
_SOURCE_TO_SKILL: dict[str, str] = {
    "stitch": "stitch-importer",
    "claude-design": "claude-design-importer",
}

# Bytes cap per individual file. Bundles with huge assets are unusual; if one
# is hit, the stager still records the entry in the manifest but skips the
# artifact so memory doesn't explode.
_PER_FILE_BYTE_CAP = 4 * 1024 * 1024  # 4 MiB


# ----------------------------------------------------------------------------
# MIME / kind classification
# ----------------------------------------------------------------------------

_HTML_MIMES = {"text/html", "application/xhtml+xml"}
_IMAGE_MIMES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
    "image/gif",
    "image/svg+xml",
}


def _mime_for_entry(archive_relpath: str, declared_mime: Optional[str]) -> str:
    """Pick a MIME type. Trust the manifest when present; otherwise guess from the extension."""
    if declared_mime:
        return declared_mime
    _, ext = os.path.splitext(archive_relpath.lower())
    return {
        ".html": "text/html",
        ".htm": "text/html",
        ".md": "text/markdown",
        ".markdown": "text/markdown",
        ".css": "text/css",
        ".json": "application/json",
        ".txt": "text/plain",
        ".jsx": "text/jsx",
        ".tsx": "text/tsx",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
    }.get(ext, "application/octet-stream")


_SCRIPT_MIMES = {"text/jsx", "text/tsx"}


def _kind_for_entry(archive_relpath: str, mime: str) -> str:
    """Classify a bundle entry as 'html', 'script', 'asset', or 'doc'."""
    if mime in _HTML_MIMES:
        # product_requirements_document.html is an author-written doc,
        # but it's still HTML. Keep it in the 'html' namespace so the skill
        # can decide whether to read it based on filename.
        return "html"
    if mime in _SCRIPT_MIMES or archive_relpath.lower().endswith((".jsx", ".tsx")):
        # React component source. The JSX translator picks these up via the
        # `bundle:script:` prefix and pairs them with their parent HTML page.
        return "script"
    if mime == "text/markdown" or archive_relpath.lower().endswith(".md"):
        return "doc"
    return "asset"


def _artifact_key(kind: str, archive_relpath: str) -> str:
    return f"bundle:{kind}:{archive_relpath}"


def _describe_entry(archive_relpath: str, kind: str, mime: str) -> str:
    """Short human-readable description for the manifest.md index."""
    base = os.path.basename(archive_relpath)
    folder = os.path.dirname(archive_relpath)

    # Stitch pattern: <folder>/code.html + <folder>/screen.png.
    if base.lower() == "code.html" and folder:
        return f"Page HTML for folder `{folder}`"
    if base.lower() == "screen.png" and folder:
        return f"Design screenshot for folder `{folder}` (not sent to LLM; available via load_artifacts if needed)"
    if base.lower() == "design.md":
        return "Design-system notes (author-written guidance)"
    if base.lower() == "partials.html":
        return (
            "Reference partials — canonical place for shared chrome markup. "
            "Authors vary in what they put here: typically the NAV; sometimes "
            "the footer too; sometimes only one or neither (with the other "
            "inlined per-page). INSPECT this file before emitting a "
            "ChromeRegion that names it as source_artifact — if the selector "
            "you want isn't in this file, source_artifact must point at any "
            "per-page bundle:html:<page>.html instead. Do NOT emit as a "
            "deployable page."
        )
    if base.lower() == "product_requirements_document.html":
        return "Product requirements document (often an unfilled template — see skill for skip heuristic)"
    if kind == "html":
        return f"HTML document: `{archive_relpath}`"
    if kind == "script":
        return f"React/JSX source: `{archive_relpath}` ({mime})"
    if kind == "doc":
        return f"Document: `{archive_relpath}`"
    if kind == "context_image":
        return (
            f"Reference image pasted into the original prompt: `{archive_relpath}` "
            f"({mime}). Load via load_artifacts only as visual-intent context; "
            f"do NOT reference from output HTML."
        )
    if mime in _IMAGE_MIMES:
        return f"Image asset: `{archive_relpath}` ({mime})"
    if mime == "text/css":
        return f"Stylesheet: `{archive_relpath}`"
    return f"Asset: `{archive_relpath}` ({mime})"


# ----------------------------------------------------------------------------
# Staging helpers
# ----------------------------------------------------------------------------


async def _save_artifact(
    ctx,
    filename: str,
    data: bytes,
    mime: str,
) -> bool:
    """Persist a single artifact via the workflow's artifact service."""
    try:
        artifact = genai.types.Part.from_bytes(data=data, mime_type=mime)
        await ctx.artifact_service.save_artifact(
            session_id=ctx.session.id,
            user_id=ctx.session.user_id,
            app_name=ctx.session.app_name,
            filename=filename,
            artifact=artifact,
        )
        return True
    except Exception:  # noqa: BLE001
        logger.exception(
            "bundle_stager_save_failed",
            filename=filename,
            mime=mime,
            size=len(data),
        )
        return False


# ----------------------------------------------------------------------------
# Per-source pre-filters
# ----------------------------------------------------------------------------


def _claude_design_variant_priority(basename: str) -> tuple[int, str]:
    """Score a Claude Design HTML variant. Lower score = preferred.

    Claude Design exports the same artifact as up to three HTML files:
    ``<stem> (standalone-src).html`` (readable, with thumbnail metadata),
    ``<stem>.html`` (canvas, with edit-mode <script>), and
    ``<stem> (standalone).html`` (minified, fonts inlined as base64).

    We prefer ``(standalone-src)`` because it's readable and unambiguously
    identifies a Claude Design export. The minified standalone is a last
    resort because it's a single ~500 KB line — useless for the LLM.
    """
    lowered = basename.lower()
    if lowered.endswith(" (standalone-src).html"):
        return (0, basename)
    if lowered.endswith(" (standalone).html"):
        return (2, basename)
    # Bare canvas: <stem>.html (no parens). Falls between src and standalone.
    return (1, basename)


def _claude_design_group_stem(basename: str) -> str:
    """Strip Claude Design variant suffixes to get the artifact group stem.

    ``Taskflow Board (standalone-src).html`` and ``Taskflow Board.html`` and
    ``Taskflow Board (standalone).html`` all share the stem ``Taskflow Board``.
    """
    lowered = basename.lower()
    for suffix in (" (standalone-src).html", " (standalone).html"):
        if lowered.endswith(suffix):
            return basename[: -len(suffix)]
    if lowered.endswith(".html"):
        return basename[: -len(".html")]
    return basename


def _detect_claude_design_mode(html_entries: list[dict]) -> str:
    """Classify a Claude Design bundle's export shape.

    Returns ``"single_canvas"`` when any HTML basename carries a Claude
    Design canvas variant suffix (``(standalone-src).html`` or
    ``(standalone).html``) — those suffixes are emitted only by the
    single-artifact "Design" feature in claude.ai.

    Returns ``"multi_page"`` otherwise — the newer multi-file project
    export shape (many top-level pages + external ``styles.css`` +
    optional ``partials.html`` reference doc).
    """
    for entry in html_entries:
        rel = (entry.get("archive_relpath") or "").lower()
        if rel.endswith(" (standalone-src).html") or rel.endswith(" (standalone).html"):
            return "single_canvas"
    return "multi_page"


def _is_partials_html(relpath: str) -> bool:
    """Return True if ``relpath`` names a Claude Design partials reference doc."""
    return os.path.basename(relpath).lower() == "partials.html"


@dataclass
class _ClaudeDesignFilterResult:
    """Output of ``_apply_claude_design_filter``.

    A dataclass (not a tuple) so callers don't have to count return-tuple
    positions when fields are added later.
    """

    canonical_html: list[dict]
    asset_refs: dict
    context_image_refs: dict
    partials_doc_refs: dict
    dropped: list[dict[str, str]]
    mode: str


def _apply_claude_design_filter(
    html_entries: list[dict],
    asset_refs: dict,
) -> _ClaudeDesignFilterResult:
    """Filter a Claude Design bundle for staging.

    Branches on ``_detect_claude_design_mode``:

    - ``single_canvas`` mode: group HTML entries by artifact stem, keep the
      highest-priority variant per group (``(standalone-src)`` > canvas >
      ``(standalone)``), drop the rest into ``dropped`` with reasons. Logs a
      warning when more than one top-level Claude artifact is detected.

    - ``multi_page`` mode: every top-level HTML is its own canonical entry
      (no variants exist in this format). ``partials.html`` is re-routed
      out of the html-staging path into ``partials_doc_refs`` so it stages
      under ``bundle:doc:`` and the LLM treats it as a reference doc, not a
      deployable page. No multi-group warning — multi-page is the expected
      shape.

    In both modes, ``asset_refs`` are filtered through
    ``_classify_claude_design_asset``: ``uploads/<image>`` is re-routed to
    ``context_image_refs`` (stage under ``bundle:context_image:*``);
    ``scraps/`` and non-image ``uploads/`` are dropped.
    """
    mode = _detect_claude_design_mode(html_entries)
    dropped: list[dict[str, str]] = []
    partials_doc_refs: dict = {}

    if mode == "single_canvas":
        canonical = _filter_single_canvas_html(html_entries, dropped)
    else:
        canonical = _filter_multi_page_html(html_entries, partials_doc_refs)

    filtered_assets, context_images = _classify_asset_refs(asset_refs, dropped)

    return _ClaudeDesignFilterResult(
        canonical_html=canonical,
        asset_refs=filtered_assets,
        context_image_refs=context_images,
        partials_doc_refs=partials_doc_refs,
        dropped=dropped,
        mode=mode,
    )


def _filter_single_canvas_html(
    html_entries: list[dict],
    dropped: list[dict[str, str]],
) -> list[dict]:
    """Pick one canonical HTML per artifact-group for single-canvas mode.

    Group HTML entries by basename stem; keep the highest-priority variant
    per group. Top-level groups represent distinct Claude Design artifacts
    (the unit the variant suffixes attach to); nested HTML is treated as
    its own passthrough group keyed by the full relpath.
    """
    top_level_stems: set[str] = set()
    groups: dict[str, list[dict]] = {}
    for entry in html_entries:
        relpath = entry.get("archive_relpath") or ""
        if not relpath:
            continue
        if "/" in relpath.strip("/"):
            groups.setdefault(relpath, []).append(entry)
            continue
        stem = _claude_design_group_stem(os.path.basename(relpath))
        groups.setdefault(stem, []).append(entry)
        top_level_stems.add(stem)

    canonical: list[dict] = []
    for stem, entries in groups.items():
        if len(entries) == 1:
            canonical.append(entries[0])
            continue
        ranked = sorted(
            entries,
            key=lambda e: _claude_design_variant_priority(
                os.path.basename(e.get("archive_relpath") or "")
            ),
        )
        winner = ranked[0]
        canonical.append(winner)
        for loser in ranked[1:]:
            dropped.append(
                {
                    "relpath": loser.get("archive_relpath") or "",
                    "reason": (
                        f"Duplicate Claude Design variant of `{stem}` — "
                        f"using `{winner.get('archive_relpath') or ''}` as canonical."
                    ),
                }
            )

    if len(top_level_stems) > 1:
        logger.warning(
            "claude_design_filter_multiple_artifact_groups",
            stems=sorted(top_level_stems),
        )
    return canonical


def _filter_multi_page_html(
    html_entries: list[dict],
    partials_doc_refs: dict,
) -> list[dict]:
    """Pass all HTMLs through; route ``partials.html`` to the doc namespace.

    Multi-page Claude Design exports have one HTML per page (no variants),
    so there's nothing to dedupe. The only special case is ``partials.html``
    — a reference doc with the canonical NAV/footer markup duplicated into
    each page; it is NOT a deployable page itself. Re-routed to
    ``partials_doc_refs`` for staging under ``bundle:doc:``.
    """
    canonical: list[dict] = []
    for entry in html_entries:
        relpath = entry.get("archive_relpath") or ""
        if not relpath:
            continue
        if _is_partials_html(relpath):
            # Stage under bundle:doc:* so the LLM treats it as a reference
            # doc, not a page. Keyed by relpath to match the asset_refs shape
            # _stage_ref_dict expects.
            partials_doc_refs[relpath] = {
                "gcs_path": entry.get("gcs_path") or "",
                "mime": entry.get("mime") or "text/html",
            }
            continue
        canonical.append(entry)
    return canonical


def _classify_asset_refs(
    asset_refs: dict,
    dropped: list[dict[str, str]],
) -> tuple[dict, dict]:
    """Split ``asset_refs`` into kept assets + context_images, with drops appended."""
    filtered_assets: dict = {}
    context_images: dict = {}
    for relpath, ref in asset_refs.items():
        if not isinstance(ref, dict):
            continue
        verdict, reason = _classify_claude_design_asset(relpath, ref)
        if verdict == "asset":
            filtered_assets[relpath] = ref
        elif verdict == "context_image":
            context_images[relpath] = ref
        else:  # "drop"
            dropped.append({"relpath": relpath, "reason": reason or ""})
    return filtered_assets, context_images


def _classify_claude_design_asset(relpath: str, ref: dict) -> tuple[str, Optional[str]]:
    """Classify a single Claude Design asset_refs entry.

    Returns ``(verdict, reason)`` where verdict is one of ``"asset"``,
    ``"context_image"``, ``"drop"``. ``reason`` is set only for drops.
    """
    normalized = relpath.lstrip("/").lower()
    if normalized.startswith("scraps/"):
        return "drop", "Discarded sketch from `scraps/` — not part of the design."
    if normalized.startswith("uploads/"):
        mime = _mime_for_entry(relpath, ref.get("mime"))
        if mime in _IMAGE_MIMES:
            return "context_image", None
        return "drop", (
            f"Non-image upload (`{mime}`) — not staged. "
            "uploads/ is for user-pasted reference imagery only."
        )
    return "asset", None


# ----------------------------------------------------------------------------
# Per-call staging state and inner stagers
# ----------------------------------------------------------------------------


@dataclass
class _StagingBuffer:
    """Mutable per-call state shared by the staging helpers."""

    ctx: Any
    bundle_id: str
    fetch_bytes: Callable[[str], Awaitable[bytes]]
    index_rows: list[dict[str, str]] = field(default_factory=list)
    staged_keys: list[str] = field(default_factory=list)


def _row(key: str, archive_relpath: str, mime: str, description: str, staged: str) -> dict:
    return {
        "key": key,
        "relpath": archive_relpath,
        "mime": mime,
        "description": description,
        "staged": staged,
    }


async def _stage_one(
    buf: _StagingBuffer,
    archive_relpath: str,
    gcs_path: str,
    declared_mime: Optional[str],
    kind_override: Optional[str] = None,
) -> None:
    mime = _mime_for_entry(archive_relpath, declared_mime)
    kind = kind_override or _kind_for_entry(archive_relpath, mime)
    key = _artifact_key(kind, archive_relpath)
    base_desc = _describe_entry(archive_relpath, kind, mime)

    try:
        data = await buf.fetch_bytes(gcs_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "bundle_stager_fetch_failed",
            bundle_id=buf.bundle_id,
            gcs_path=gcs_path,
            error=str(exc),
        )
        suffix = " (download failed — unavailable to LLM)"
        buf.index_rows.append(_row(key, archive_relpath, mime, base_desc + suffix, "no"))
        return

    if len(data) > _PER_FILE_BYTE_CAP:
        logger.warning(
            "bundle_stager_file_too_large",
            bundle_id=buf.bundle_id,
            relpath=archive_relpath,
            bytes=len(data),
            cap=_PER_FILE_BYTE_CAP,
        )
        suffix = f" (skipped: {len(data)} bytes > cap)"
        buf.index_rows.append(_row(key, archive_relpath, mime, base_desc + suffix, "no"))
        return

    saved = await _save_artifact(buf.ctx, key, data, mime)
    buf.index_rows.append(_row(key, archive_relpath, mime, base_desc, "yes" if saved else "no"))
    if saved:
        buf.staged_keys.append(key)


async def _stage_list_entries(buf: _StagingBuffer, entries: list[dict]) -> None:
    """Stage each ``{archive_relpath, gcs_path, mime}`` entry in a list.

    Used for every list-shaped manifest bucket (``html_files``,
    ``css_files``, ``js_files``, ``other_helpers``). The artifact-key
    namespace (``bundle:html:`` / ``bundle:asset:`` / ``bundle:doc:``) is
    decided by ``_kind_for_entry`` from the entry's mime — no caller-side
    branching needed.
    """
    for entry in entries:
        archive_relpath = entry.get("archive_relpath") or ""
        gcs_path = entry.get("gcs_path") or ""
        if not archive_relpath or not gcs_path:
            continue
        await _stage_one(buf, archive_relpath, gcs_path, entry.get("mime"))


async def _stage_ref_dict(
    buf: _StagingBuffer, refs: dict, kind_override: Optional[str] = None
) -> None:
    for archive_relpath, ref in refs.items():
        if not isinstance(ref, dict):
            continue
        gcs_path = ref.get("gcs_path") or ""
        if not gcs_path:
            continue
        await _stage_one(
            buf, archive_relpath, gcs_path, ref.get("mime"), kind_override=kind_override
        )


# ----------------------------------------------------------------------------
# Public entrypoint
# ----------------------------------------------------------------------------


async def stage_bundle_artifacts(
    ctx,
    *,
    bundle_id: str,
    manifest: dict,
    fetch_bytes: Callable[[str], Awaitable[bytes]],
) -> dict[str, Any]:
    """Download each bundle file from GCS, save as an artifact, emit manifest.

    Args:
        ctx: ADK InvocationContext (carries artifact_service + session info).
        bundle_id: UUID of the DesignBundle row.
        manifest: The ``manifest`` dict from ``fetch_bundle_manifest`` —
            may contain ``html_files``, ``css_files``, ``js_files``,
            ``script_files`` (.jsx/.tsx React component sources),
            ``other_helpers`` (each a list of ``{archive_relpath, gcs_path,
            mime}``) and ``asset_refs`` (a dict keyed by ``archive_relpath``).
            See ``content_service.archive_ingestion_service._classify`` for
            how the backend assigns extensions to buckets — every category
            the backend may produce is staged here. Older manifests without
            ``script_files`` are still valid; the field defaults to ``[]``.
        fetch_bytes: async callable ``(gcs_path) -> bytes`` that pulls a
            single GCS blob. Dependency-injected for tests.

    Returns:
        A skill-context dict:

            {
                "bundle_source": "stitch" | "claude-design",
                "bundle_id": "<uuid>",
                "skill_name": "stitch-importer" | "claude-design-importer",
                "manifest_artifact": "bundle:manifest.md",
                "staged_count": <int>,
                "staged_keys": [ "bundle:html:...", ... ],
            }

        Returns an empty dict on catastrophic failure (no files staged).
    """
    source = manifest.get("source") or ""
    skill_name = _SOURCE_TO_SKILL.get(source, "")

    html_entries: list[dict] = list(manifest.get("html_files") or [])
    css_entries: list[dict] = list(manifest.get("css_files") or [])
    js_entries: list[dict] = list(manifest.get("js_files") or [])
    script_entries: list[dict] = list(manifest.get("script_files") or [])
    other_helpers: list[dict] = list(manifest.get("other_helpers") or [])
    asset_refs: dict = dict(manifest.get("asset_refs") or {})
    context_image_refs: dict = {}
    partials_doc_refs: dict = {}
    dropped: list[dict[str, str]] = []
    mode: Optional[str] = None

    if source == "claude-design":
        result = _apply_claude_design_filter(html_entries, asset_refs)
        html_entries = result.canonical_html
        asset_refs = result.asset_refs
        context_image_refs = result.context_image_refs
        partials_doc_refs = result.partials_doc_refs
        dropped = result.dropped
        mode = result.mode

    buf = _StagingBuffer(ctx=ctx, bundle_id=bundle_id, fetch_bytes=fetch_bytes)

    # html_files first — they come first in the manifest and the agent usually
    # wants to read them first. css/js/script/other_helpers follow so their
    # staged keys (``bundle:asset:styles.css``, ``bundle:script:game.jsx``,
    # ``bundle:doc:DESIGN.md``, etc.) are available when the importer's
    # handlers run. ``script_files`` rides ahead of ``other_helpers`` so the
    # JSX translator can pair scripts with pages without stalling on
    # late-bucket entries.
    await _stage_list_entries(buf, html_entries)
    await _stage_list_entries(buf, css_entries)
    await _stage_list_entries(buf, js_entries)
    await _stage_list_entries(buf, script_entries)
    await _stage_list_entries(buf, other_helpers)
    await _stage_ref_dict(buf, asset_refs)
    await _stage_ref_dict(buf, context_image_refs, kind_override="context_image")
    await _stage_ref_dict(buf, partials_doc_refs, kind_override="doc")

    if not buf.index_rows:
        # A bundle with only `dropped` entries (e.g., user uploaded only
        # `scraps/`) has nothing for the LLM to read — treat as empty.
        logger.warning("bundle_stager_empty", bundle_id=bundle_id, source=source)
        return {}

    # Emit manifest.md. The workflow reads this artifact and passes its text
    # directly to the DesignImporter as manifest_markdown.
    manifest_md = _render_manifest_markdown(
        bundle_id=bundle_id,
        source=source,
        skill_name=skill_name,
        rows=buf.index_rows,
        dropped=dropped,
        mode=mode,
    )
    await _save_artifact(ctx, _MANIFEST_KEY, manifest_md.encode("utf-8"), "text/markdown")

    logger.info(
        "bundle_stager_done",
        bundle_id=bundle_id,
        source=source,
        skill_name=skill_name,
        mode=mode,
        staged=len(buf.staged_keys),
        total=len(buf.index_rows),
    )

    skill_context: dict[str, Any] = {
        "bundle_source": source,
        "bundle_id": bundle_id,
        "skill_name": skill_name,
        "manifest_artifact": _MANIFEST_KEY,
        "staged_count": len(buf.staged_keys),
        "staged_keys": buf.staged_keys,
    }
    if mode is not None:
        skill_context["mode"] = mode
    return skill_context


def _render_manifest_markdown(
    *,
    bundle_id: str,
    source: str,
    skill_name: str,
    rows: list[dict[str, str]],
    dropped: Optional[list[dict[str, str]]] = None,
    mode: Optional[str] = None,
) -> str:
    """Render bundle:manifest.md as a table grouped by kind."""
    header_lines: list[str] = [
        "# Design Bundle Manifest",
        "",
        f"- **Bundle id:** `{bundle_id}`",
        f"- **Source:** `{source}`",
    ]
    if mode:
        header_lines.append(f"- **Mode:** `{mode}`")
    header_lines.extend(
        [
            (
                f"- **Skill in effect:** `{skill_name}`"
                if skill_name
                else "- **Skill in effect:** _(unknown source; follow the shared contract only)_"
            ),
            "",
            "Every entry below is staged as an ADK artifact. Load the ones you need via `load_artifacts(<key>)`. Return a `DecompositionPlan` JSON describing slug mappings, chrome roles, theme tokens, navigation, and backend intent — the deterministic decomposition runner reads your plan and emits every cleaned artifact from the staged sources.",
            "",
        ]
    )
    lines: list[str] = list(header_lines)

    grouped: dict[str, list[dict[str, str]]] = {
        "html": [],
        "script": [],
        "doc": [],
        "asset": [],
        "context_image": [],
    }
    for row in rows:
        key = row.get("key", "")
        # key format is `bundle:<kind>:<relpath>`
        parts = key.split(":", 2)
        kind = parts[1] if len(parts) >= 2 else "asset"
        grouped.setdefault(kind, []).append(row)

    if source == "claude-design" and mode == "single_canvas":
        html_title = "## Canonical page HTML (use this one — there is exactly one)"
    elif source == "claude-design" and mode == "multi_page":
        html_title = (
            "## Pages (one content:<slug>:page.html per entry; "
            "partials.html lives under Author-written notes)"
        )
    else:
        html_title = "## HTML pages and documents"
    section_titles = {
        "html": html_title,
        "script": (
            "## React/JSX sources (paired with bundle:html:* page shells via "
            "`<script type=\"text/babel\" src=\"…\">`; the JSX translator "
            "concatenates these and emits a single TSX component per page)"
        ),
        "doc": "## Author-written notes",
        "asset": "## Assets (images, stylesheets, etc.)",
        "context_image": (
            "## Reference imagery (user-pasted in the original prompt; "
            "do NOT use as deployable images; load via load_artifacts only "
            "for visual-intent context)"
        ),
    }

    for kind in ("html", "script", "doc", "asset", "context_image"):
        bucket = grouped.get(kind) or []
        if not bucket:
            continue
        lines.append(section_titles[kind])
        lines.append("")
        lines.append("| Artifact key | MIME | Description | Staged |")
        lines.append("|---|---|---|---|")
        for row in bucket:
            lines.append(
                f"| `{row['key']}` | `{row['mime']}` | {row['description']} | {row['staged']} |"
            )
        lines.append("")

    if dropped:
        lines.append("## Skipped duplicates and helpers")
        lines.append("")
        lines.append(
            "These bundle entries were filtered out before staging. They are "
            "NOT artifacts — listed here so you know what was in the upload "
            "and why it was excluded."
        )
        lines.append("")
        for row in dropped:
            relpath = row.get("relpath", "")
            reason = row.get("reason", "")
            lines.append(f"- `{relpath}` — {reason}")
        lines.append("")

    return "\n".join(lines)
